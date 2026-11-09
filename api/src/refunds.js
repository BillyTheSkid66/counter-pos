import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {withTenant} from './db.js';
import {requireAuth,tenantContext} from './auth.js';
import {allocate,cents,pounds,refundLineAmount} from './money.js';

export async function sessionSummary(client,id){
  const {rows:[session]}=await client.query('select * from till_sessions where id=$1',[id]);
  if(!session)return null;
  const {rows:[cash]}=await client.query(`select
    coalesce(sum(amount) filter(where provider is distinct from 'internal-refund' and status in('completed','refunded')),0) sales,
    coalesce(sum(amount) filter(where provider='internal-refund'),0) refunds
    from payments where till_session_id=$1 and method='cash'`,[id]);
  const {rows:[moves]}=await client.query("select coalesce(sum(case when movement_type='paid_in' then amount else -amount end),0) total from cash_movements where session_id=$1",[id]);
  return {...session,openingFloat:Number(session.opening_float),cashSales:Number(cash.sales),cashRefunds:Number(cash.refunds),adjustments:Number(moves.total),expectedCash:pounds(cents(session.opening_float)+cents(cash.sales)-cents(cash.refunds)+cents(moves.total))};
}

const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
export function registerRefundRoutes(app){
  const handler=full=>async request=>{
    const saleId=z.string().guid().parse(request.params.id);
    const input=z.object({managerPin:z.string().regex(/^\d{4,8}$/),reason:z.string().trim().min(2).max(300),
      refundMethod:z.enum(['original','store_credit']).default('original'),
      items:full?z.undefined().optional():z.array(z.object({saleItemId:z.string().guid(),quantity:z.number().int().positive()})).min(1).max(100)
    }).parse(request.body);
    if(input.items&&new Set(input.items.map(i=>i.saleItemId)).size!==input.items.length)throw fail('Duplicate return items are not allowed',400);
    return withTenant(tenantContext(request),async client=>{
      const org=request.headers['x-organisation-id'];
      const {rows:[approval]}=await client.query('select app_approve_manager_pin($1,$2,$3) approved',[org,request.user.id,input.managerPin]);
      if(!approval?.approved)throw fail('Manager PIN approval failed',403);
      const {rows:[initial]}=await client.query('select customer_id from sales where id=$1',[saleId]);
      if(initial?.customer_id)await client.query('select id from customers where id=$1 for update',[initial.customer_id]);
      const {rows:[session]}=await client.query('select id from till_sessions where closed_at is null order by opened_at limit 1 for update');
      if(!session)throw fail('Open the till before issuing a refund',422);
      const {rows:[sale]}=await client.query("select * from sales where id=$1 and status in('completed','partially_refunded') for update",[saleId]);
      if(!sale)throw fail('Transaction is already refunded or unavailable');
      if(full&&sale.status!=='completed')throw fail('Use an item return for a partially refunded transaction');
      const {rows:lines}=await client.query(`select i.*,coalesce((select sum(ri.quantity) from refund_items ri where ri.sale_item_id=i.id),0) refunded
        from sale_items i where sale_id=$1 order by i.id`,[saleId]);
      const refundable=allocate(cents(sale.grand_total),lines.map(i=>cents(i.line_total)));
      lines.forEach((line,i)=>line.refundable_total=pounds(refundable[i]));
      const selected=(full?lines.map(i=>({saleItemId:i.id,quantity:Number(i.quantity)})):input.items).map(item=>{
        const line=lines.find(i=>i.id===item.saleItemId);
        if(!line||item.quantity>Number(line.quantity)-Number(line.refunded))throw fail('Refund quantity exceeds the remaining sold quantity');
        return {...line,refundQuantity:item.quantity,amount:refundLineAmount(line,item.quantity)};
      });
      const total=pounds(selected.reduce((sum,i)=>sum+cents(i.amount),0));
      const {rows:[previous]}=await client.query('select coalesce(sum(total),0) total from refunds where sale_id=$1',[saleId]);
      if(cents(previous.total)+cents(total)>cents(sale.grand_total))throw fail('Refund would exceed the amount paid');
      const {rows:[refund]}=await client.query('insert into refunds(organisation_id,sale_id,actor_user_id,total,reason,refund_method) values($1,$2,$3,$4,$5,$6) returning *',[org,saleId,request.user.id,total,input.reason,input.refundMethod]);
      for(const item of [...selected].sort((a,b)=>String(a.variant_id).localeCompare(String(b.variant_id)))){
        await client.query('insert into refund_items(organisation_id,refund_id,sale_item_id,quantity,amount) values($1,$2,$3,$4,$5)',[org,refund.id,item.id,item.refundQuantity,item.amount]);
        if(item.variant_id){
          await client.query(`insert into variant_stock_balances(organisation_id,location_id,variant_id,quantity) values($1,$2,$3,$4)
            on conflict(organisation_id,location_id,variant_id) do update set quantity=variant_stock_balances.quantity+excluded.quantity,updated_at=now()`,[org,sale.location_id,item.variant_id,item.refundQuantity]);
          await client.query("insert into inventory_movements(organisation_id,location_id,variant_id,movement_type,quantity_delta,reference_type,reference_id,created_by,reason) values($1,$2,$3,'refund',$4,'refund',$5,$6,$7)",[org,sale.location_id,item.variant_id,item.refundQuantity,refund.id,request.user.id,input.reason]);
        }
      }
      const {rows:payments}=await client.query(`select p.*,p.amount-coalesce((select sum(r.amount) from payments r where r.original_payment_id=p.id),0) remaining
        from payments p where sale_id=$1 and provider is distinct from 'internal-refund' and status in('completed','refunded') order by p.id`,[saleId]);
      const {rows:[legacy]}=await client.query("select count(*) n from payments where sale_id=$1 and provider='internal-refund' and original_payment_id is null",[saleId]);
      if(Number(legacy.n)>0||cents(previous.total)>payments.reduce((sum,p)=>sum+cents(p.amount)-cents(p.remaining),0))throw fail('This older partially refunded sale needs manual reconciliation before another refund');
      const remaining=payments.map(p=>cents(p.remaining));
      if(cents(total)>remaining.reduce((a,b)=>a+b,0))throw fail('Refund exceeds the remaining payments');
      const amounts=allocate(cents(total),remaining);
      let creditCode=null;
      if(input.refundMethod==='store_credit'&&total>0){
        creditCode=`SC-${randomBytes(12).toString('hex').toUpperCase()}`;
        await client.query('insert into store_credits(organisation_id,code,customer_id,refund_id,original_amount,balance) values($1,$2,$3,$4,$5,$5)',[org,creditCode,sale.customer_id,refund.id,total]);
      }
      const allocations=[];
      for(let i=0;i<payments.length;i++){
        if(!amounts[i])continue;
        const p=payments[i],amount=pounds(amounts[i]),method=input.refundMethod==='store_credit'?'store_credit':p.method;
        if(input.refundMethod==='original'&&p.method==='store_credit'){
          const restored=await client.query('update store_credits set balance=balance+$1 where upper(code)=upper($2) returning id',[amount,p.provider_reference]);
          if(!restored.rowCount)throw fail('Original store credit cannot be restored; choose a new store credit refund');
        }
        await client.query("insert into payments(organisation_id,sale_id,method,provider,amount,status,till_session_id,original_payment_id,refund_id) values($1,$2,$3,'internal-refund',$4,'refunded',$5,$6,$7)",[org,saleId,method,amount,session.id,p.id,refund.id]);
        allocations.push({method,amount});
      }
      const fully=lines.every(line=>Number(line.refunded)+(selected.find(i=>i.id===line.id)?.refundQuantity||0)>=Number(line.quantity));
      await client.query('update sales set status=$1 where id=$2',[fully?'refunded':'partially_refunded',saleId]);
      const {rows:[loyalty]}=await client.query("select customer_id,coalesce(sum(points_delta) filter(where reason not in('Partial refund adjustment','Refund reversal')),0) original,coalesce(sum(points_delta) filter(where reason in('Partial refund adjustment','Refund reversal')),0) adjusted from loyalty_entries where sale_id=$1 group by customer_id",[saleId]);
      if(loyalty){
        const fraction=fully?1:(cents(sale.grand_total)?(cents(previous.total)+cents(total))/cents(sale.grand_total):0);
        const delta=-Math.round(Number(loyalty.original)*fraction)-Number(loyalty.adjusted);
        if(delta)await client.query("insert into loyalty_entries(organisation_id,customer_id,sale_id,points_delta,reason) values($1,$2,$3,$4,'Partial refund adjustment')",[org,loyalty.customer_id,saleId,delta]);
      }
      await client.query("insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'sale.items_returned','refund',$3,$4)",[org,request.user.id,refund.id,JSON.stringify({saleId,total,allocations,refundMethod:input.refundMethod})]);
      return {refundId:refund.id,saleId,total,status:fully?'refunded':'partially_refunded',refundMethod:input.refundMethod,creditCode,allocations};
    });
  };
  for(const [path,full] of [['refund',true],['return',false],['partial-refund',false]])app.post(`/api/transactions/:id/${path}`,{preHandler:requireAuth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},handler(full));
}
