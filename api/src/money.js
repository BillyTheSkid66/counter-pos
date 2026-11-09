export const cents = value => Math.round(Number(value) * 100);
export const pounds = value => value / 100;

// Largest-remainder allocation preserves every penny, including small discounts.
export function allocate(total, weights) {
  const sum = weights.reduce((a,b)=>a+b,0);
  if(!sum) return weights.map(()=>0);
  const parts=weights.map((weight,index)=>({index,value:Math.floor(total*weight/sum),remainder:(total*weight)%sum}));
  let remaining=total-parts.reduce((a,p)=>a+p.value,0);
  for(const p of [...parts].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)) if(remaining-->0)p.value++;
  return parts.map(p=>p.value);
}

export function priceLines(lines, discount, promotion=null) {
  const gross=lines.map(line=>cents(line.retail_price)*line.quantity);
  const promotionDiscounts=promotion?allocate(cents(promotion.saving),gross.map((amount,i)=>promotion.families.includes(lines[i].family_id)?amount:0)):gross.map(()=>0);
  const afterPromotion=gross.map((amount,i)=>amount-promotionDiscounts[i]);
  const discounts=allocate(cents(discount)-(promotion?cents(promotion.saving):0),afterPromotion);
  return lines.map((line,index)=>{
    const total=afterPromotion[index]-discounts[index];
    const rate=Number(line.tax_rate);
    return {...line,total:pounds(total),tax:pounds(Math.round(total*rate/(100+rate)))};
  });
}

export function refundLineAmount(line, quantity) {
  // Historical releases stored undiscounted lines. Scale by the actual sale total.
  const total=cents(line.refundable_total ?? line.line_total);
  const previous=Number(line.refunded||0);
  return pounds(Math.round(total*(previous+quantity)/Number(line.quantity))-Math.round(total*previous/Number(line.quantity)));
}
