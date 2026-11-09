import React,{useEffect,useMemo,useState,useRef}from'react';

import*as I from'lucide-react';

import{counterApi,getApiConnectionState,subscribeApiConnection}from'./api.js';



const money=n=>`£${Number(n).toFixed(2)}`;



export default function DatabaseSell({toast}){

  const session=JSON.parse(sessionStorage.getItem('counter:session')||'{}');

  const organisationId=session.organisation?.id;

  const token=session.token;

  const[families,setFamilies]=useState([]);

  const[promos,setPromos]=useState([]);

  const[customers,setCustomers]=useState([]);

  const[programme,setProgramme]=useState({enabled:true,points_per_pound:1,tiers:[]});

  const[customer,setCustomer]=useState('');

  const[redeem,setRedeem]=useState(0);

  const[cart,setCart]=useState([]);

  const[pick,setPick]=useState(null);

  const[busy,setBusy]=useState(false);

  const submitting=useRef(false);

  const[pending,setPending]=useState(()=>Boolean(counterApi.pendingCheckout(organisationId)));

  const[scan,setScan]=useState('');

  const[connection,setConnection]=useState(getApiConnectionState);

  const[parked,setParked]=useState([]),[showParked,setShowParked]=useState(false),[showSplit,setShowSplit]=useState(false),[cashPart,setCashPart]=useState(''),[showCredit,setShowCredit]=useState(false),[creditCode,setCreditCode]=useState(''),[credit,setCredit]=useState(null),[checkingCredit,setCheckingCredit]=useState(false);



  const load=async()=>{

    const[f,p,c,lty,parks]=await Promise.all([

      counterApi.productFamilies({token,organisationId}),

      counterApi.promotions({token,organisationId}),

      counterApi.customers({token,organisationId}),

      session.subscription?.features?.loyalty?counterApi.loyaltyProgram({token,organisationId}):Promise.resolve({programme:{enabled:false,tiers:[]}}),

      counterApi.parkedBaskets({token,organisationId}),

    ]);

    setFamilies(f);setPromos(p);setCustomers(c);setProgramme(lty.programme);setParked(parks);

  };

  useEffect(()=>subscribeApiConnection(setConnection),[]);

  useEffect(()=>{load().catch(error=>toast(error.message))},[]);



  const add=(v,f)=>{

    setCart(c=>{const x=c.find(i=>i.id===v.id);return x?c.map(i=>i.id===v.id?{...i,qty:Math.min(i.qty+1,i.stock)}:i):[...c,{...v,familyId:f.id,familyName:f.name,qty:1}]});

    setPick(null);

  };

  const scanBarcode=e=>{if(e.key!=='Enter')return;const code=scan.trim(),family=families.find(f=>f.variants.some(v=>v.gtin===code||v.sku.toLowerCase()===code.toLowerCase())),variant=family?.variants.find(v=>v.gtin===code||v.sku.toLowerCase()===code.toLowerCase());if(variant){add(variant,family);setScan('');toast(`${variant.name} scanned`)}else toast('Barcode not found')};

  const chosen=customers.find(c=>c.id===customer);

  const price=useMemo(()=>{

    const regular=cart.reduce((s,x)=>s+x.retailPrice*x.qty,0);

    let saving=0,name='';

    for(const p of promos){

      const u=cart.filter(x=>p.family_ids?.includes(x.familyId)).flatMap(x=>Array(x.qty).fill(x.retailPrice)).sort((a,b)=>b-a);

      const q=Number(p.qualifying_quantity);let d=0;

      for(let i=0;i+q<=u.length;i+=q)d+=Math.max(0,u.slice(i,i+q).reduce((a,b)=>a+b,0)-Number(p.bundle_price));

      if(d>saving){saving=d;name=p.name}

    }

    const selected=(programme.tiers||[]).find(t=>t.points_cost===redeem&&t.active);

    const loyalty=selected&&chosen?.points>=selected.points_cost&&regular-saving>=selected.reward_value?selected.reward_value:0;

    return{regular,promo:saving,loyalty,total:regular-saving-loyalty,name,selected};

  },[cart,promos,redeem,chosen,programme]);



  const park=async()=>{try{await counterApi.parkBasket({token,organisationId,basket:{items:cart.map(x=>({variantId:x.id,quantity:x.qty})),customerId:customer||null,redeemPoints:redeem,note:`Basket ${parked.length+1}`}});setCart([]);setCustomer('');setRedeem(0);await load();toast('Basket parked')}catch(e){toast(e.message)}};

  const resume=async p=>{const restored=p.items.flatMap(item=>{const family=families.find(f=>f.variants.some(v=>v.id===item.variantId)),variant=family?.variants.find(v=>v.id===item.variantId);return variant?[{...variant,familyId:family.id,familyName:family.name,qty:Math.min(item.quantity,variant.stock)}]:[]});setCart(restored);setCustomer(p.customer_id||'');setRedeem(p.redeem_points||0);setShowParked(false);setParked(current=>current.filter(x=>x.id!==p.id));try{await counterApi.removeParkedBasket({token,organisationId,id:p.id});await load();toast('Parked basket resumed')}catch{toast('Basket resumed, but could not remove the saved copy')}};

  const checkCredit=async()=>{setCheckingCredit(true);setCredit(null);try{const result=await counterApi.storeCredit({token,organisationId,code:creditCode.trim()});setCredit(result)}catch(e){toast(e.message)}finally{setCheckingCredit(false)}};

  const useCredit=()=>{const amount=Math.min(credit.balance,price.total),difference=Number((price.total-amount).toFixed(2)),payments=[{method:'store_credit',amount,referenceCode:credit.code}];if(difference>0)payments.push({method:'card',amount:difference});setShowCredit(false);pay(undefined,payments);setCredit(null);setCreditCode('')};

  const pay=async(method,payments,retry=false)=>{

    if(submitting.current)return;

    submitting.current=true;setBusy(true);

    try{

      const r=retry?await counterApi.retryCheckout({token,organisationId}):await counterApi.checkout({token,organisationId,items:cart.map(x=>({variantId:x.id,quantity:x.qty})),paymentMethod:method,payments,customerId:customer||null,redeemPoints:price.loyalty?redeem:0});

      setCart([]);setRedeem(0);setCustomer('');

      toast(`Receipt #${r.receiptNumber} saved · ${r.pointsEarned} points earned`);

      load().catch(()=>toast(`Receipt #${r.receiptNumber} saved. Refresh stock when connected.`));

    }catch(e){toast(e.message)}finally{setPending(Boolean(counterApi.pendingCheckout(organisationId)));setBusy(false);submitting.current=false;}

  };



  return <>{pending?<div className="offline-payment"><strong>A checkout needs confirmation. Do not take payment again.</strong><button className="primary" disabled={busy} onClick={()=>pay(undefined,undefined,true)}>Retry pending checkout</button></div>:null}<fieldset disabled={busy||pending} style={{border:0,padding:0,margin:0,minWidth:0}}><div className="sell-layout">

    <section className="catalog">

      <div className="search barcode-search"><I.ScanBarcode/><input autoFocus value={scan} onChange={e=>setScan(e.target.value)} onKeyDown={scanBarcode} placeholder="Scan GTIN or enter SKU"/><span>Enter</span></div>

      <div className="catalog-head"><h2>Products</h2><span className="flag good">Live stock</span></div>

      <div className="product-grid">{families.map(f=><button className="product family-tile" key={f.id} onClick={()=>setPick(f)}>

        <div className="product-art"><span>💧</span></div><div className="product-copy"><strong>{f.name}</strong><span>{f.brand} · {f.sizeLabel}</span><b>From {money(Math.min(...f.variants.map(v=>v.retailPrice)))}</b>{promos.some(p=>p.family_ids?.includes(f.id))&&<small className="deal-badge">Mix & match</small>}</div>

      </button>)}</div>

    </section>

    <aside className="basket">

      <div className="basket-head"><h2>Basket</h2><div className="basket-tools"><button className="iconbtn" title="Park basket" disabled={!cart.length} onClick={park}><I.Pause/></button><button className="iconbtn" title="Parked baskets" onClick={()=>setShowParked(true)}><I.Inbox/>{parked.length>0&&<small>{parked.length}</small>}</button><button className="iconbtn" onClick={()=>{setCart([]);setRedeem(0)}}><I.Trash2/></button></div></div>

      {connection==='offline'?<div className="offline-payment"><I.WifiOff/><span><strong>Payments paused</strong><small>Reconnect to complete or park this basket.</small></span></div>:null}

      <select className="customer-select" value={customer} onChange={e=>{setCustomer(e.target.value);setRedeem(0)}}><option value="">Add customer</option>{customers.map(c=><option value={c.id} key={c.id}>{c.display_name} · {c.points} pts</option>)}</select>

      {chosen&&programme.enabled&&<div className="loyalty-checkout loyalty-options"><I.Star/><span><strong>{chosen.points} points</strong><small>This sale earns {Math.floor(price.total*programme.points_per_pound)} points</small></span><div>{(programme.tiers||[]).filter(t=>t.active&&chosen.points>=t.points_cost).map(t=><button key={t.id} className={redeem===t.points_cost?'selected':''} disabled={price.regular-price.promo<t.reward_value} onClick={()=>setRedeem(v=>v===t.points_cost?0:t.points_cost)}>{t.points_cost} pts · {money(t.reward_value)}</button>)}</div></div>}

      <div className="cart-lines">{cart.map(x=><div className="db-cart-line" key={x.id}><span>💧</span><div><strong>{x.familyName}</strong><small>{x.options.flavour} · {x.options.strength}</small></div><div className="stepper"><button onClick={()=>{setRedeem(0);setCart(c=>c.map(i=>i.id===x.id?{...i,qty:i.qty-1}:i).filter(i=>i.qty>0))}}>−</button><span>{x.qty}</span><button onClick={()=>add(x,{id:x.familyId,name:x.familyName})}>+</button></div><b>{money(x.retailPrice*x.qty)}</b></div>)}</div>

      <div className="totals"><div><span>Regular subtotal</span><span>{money(price.regular)}</span></div>{price.promo>0&&<div className="saving"><span>{price.name}</span><b>−{money(price.promo)}</b></div>}{price.loyalty>0&&<div className="saving"><span>Loyalty reward</span><b>−{money(price.loyalty)}</b></div>}<div className="grand"><span>Total</span><strong>{money(price.total)}</strong></div><div className="payment"><button disabled={!cart.length||busy||price.total<=0} onClick={()=>pay('cash')}>Cash</button><button disabled={!cart.length||busy||price.total<=0} onClick={()=>pay('card')}>Card</button><button className="split-pay" disabled={!cart.length||busy||price.total<=0} onClick={()=>{setCashPart((price.total/2).toFixed(2));setShowSplit(true)}}>Split payment</button><button className="split-pay" disabled={!cart.length||busy||price.total<=0} onClick={()=>setShowCredit(true)}>Store / exchange credit</button></div></div>

    </aside>

    {pick&&<div className="modal-backdrop"><div className="modal picker-modal"><div className="modal-head"><h2>{pick.name}</h2><button className="iconbtn" onClick={()=>setPick(null)}><I.X/></button></div><div className="strength-grid">{pick.variants.map(v=><button key={v.id} disabled={!v.stock} onClick={()=>add(v,pick)}><strong>{v.options.flavour}</strong><span>{v.options.strength} · {money(v.retailPrice)}</span><small>{v.stock} in stock</small></button>)}</div></div></div>}

    {showParked&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h2>Parked baskets</h2><p>{parked.length} waiting</p></div><button className="iconbtn" onClick={()=>setShowParked(false)}><I.X/></button></div>{parked.length?parked.map(p=><div className="parked-row" key={p.id}><div className="grow"><strong>{p.note||'Parked basket'}</strong><small>{p.items.reduce((s,x)=>s+x.quantity,0)} items · {p.customer_name||'No customer'}</small></div><button className="primary" onClick={()=>resume(p)}>Resume</button></div>):<div className="empty">No parked baskets</div>}</div></div>}

    {showSplit&&<div className="modal-backdrop"><div className="modal split-modal"><div className="modal-head"><div><h2>Split payment</h2><p>Total {money(price.total)}</p></div><button className="iconbtn" onClick={()=>setShowSplit(false)}><I.X/></button></div><div className="form-grid"><label>Cash amount<input type="number" min="0.01" max={price.total-.01} step="0.01" value={cashPart} onChange={e=>setCashPart(e.target.value)}/></label><label>Card amount<input readOnly value={(price.total-Number(cashPart||0)).toFixed(2)}/></label></div><div className="form-actions"><button className="primary" disabled={Number(cashPart)<=0||Number(cashPart)>=price.total} onClick={()=>{setShowSplit(false);pay(undefined,[{method:'cash',amount:Number(cashPart)},{method:'card',amount:Number((price.total-Number(cashPart)).toFixed(2))}])}}>Take split payment</button></div></div></div>}

    {showCredit&&<div className="modal-backdrop"><div className="modal split-modal"><div className="modal-head"><div><h2>Store / exchange credit</h2><p>Check the code before taking payment</p></div><button className="iconbtn" onClick={()=>setShowCredit(false)}><I.X/></button></div><label>Credit code<input autoFocus value={creditCode} onChange={e=>{setCreditCode(e.target.value.toUpperCase());setCredit(null)}} placeholder="SC-6-ABC123"/></label><div className="form-actions"><button className="quiet" disabled={checkingCredit||creditCode.trim().length<4} onClick={checkCredit}>{checkingCredit?'Checking…':'Check balance'}</button></div>{credit&&<div className="credit-summary"><span>Available balance<strong>{money(credit.balance)}</strong></span><span>Basket total<strong>{money(price.total)}</strong></span>{credit.balance<price.total&&<span>Card price difference<strong>{money(price.total-credit.balance)}</strong></span>}<button className="primary" disabled={!credit.active||credit.balance<=0} onClick={useCredit}>{credit.balance>=price.total?'Pay with credit':'Use credit + card'}</button></div>}</div></div>}

  </div></fieldset></>;

}

