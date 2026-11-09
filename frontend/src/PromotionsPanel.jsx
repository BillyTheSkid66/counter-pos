import React,{useEffect,useState}from'react';
import*as I from'lucide-react';
import{counterApi}from'./api.js';

export default function PromotionsPanel({toast}){
  const session=JSON.parse(sessionStorage.getItem('counter:session')||'{}'),token=session.token,organisationId=session.organisation?.id;
  const[items,setItems]=useState([]),[families,setFamilies]=useState([]),[selected,setSelected]=useState([]),[form,setForm]=useState({name:'Any 4 for £10',groupName:'Mix & match ranges',quantity:'4',bundlePrice:'10'});
  const load=async()=>{const[p,f]=await Promise.all([counterApi.promotions({token,organisationId}),counterApi.productFamilies({token,organisationId})]);setItems(p);setFamilies(f)};
  useEffect(()=>{load().catch(e=>toast(e.message))},[]);
  const toggle=id=>setSelected(value=>value.includes(id)?value.filter(x=>x!==id):[...value,id]);
  const save=async()=>{try{await counterApi.createPromotion({token,organisationId,promotion:{...form,quantity:Number(form.quantity),bundlePrice:Number(form.bundlePrice),familyIds:selected}});setSelected([]);await load();toast('Mix & match promotion activated')}catch(e){toast(e.message)}};
  return <div className="promotion-layout">
    <div className="panel"><div className="panel-head"><div><h2>Active promotions</h2><p>Server-calculated offers across selected ranges</p></div></div>{items.length?items.map(p=><div className="rule" key={p.id}><span className="rule-icon"><I.BadgePercent/></span><div className="grow"><strong>{p.name}</strong><small>{p.group_name} · {p.families.join(', ')}</small></div><span className="status">{p.qualifying_quantity} for £{Number(p.bundle_price).toFixed(2)}</span></div>):<div className="empty-products"><I.Tags/><h3>No promotions yet</h3></div>}</div>
    <div className="panel promo-builder"><h2>New multi-range deal</h2>{Object.keys(form).map(key=><label key={key}>{key.replace(/([A-Z])/g,' $1')}<input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<label>Eligible product ranges</label><div className="range-picker">{families.map(f=><label key={f.id}><input type="checkbox" checked={selected.includes(f.id)} onChange={()=>toggle(f.id)}/><span><strong>{f.name}</strong><small>{f.brand} · {f.variants.length} variants</small></span></label>)}</div><button className="primary" disabled={!selected.length} onClick={save}><I.Sparkles/>Activate deal</button></div>
  </div>;
}
