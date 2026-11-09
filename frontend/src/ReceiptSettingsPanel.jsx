import React,{useEffect,useState}from'react';
import{Save}from'lucide-react';
import{counterApi}from'./api.js';

export default function ReceiptSettingsPanel({toast}){
  const session=JSON.parse(sessionStorage.getItem('counter:session')||'{}');
  const[form,setForm]=useState(null),[busy,setBusy]=useState(false);
  const load=async()=>setForm(await counterApi.receiptSettings({token:session.token,organisationId:session.organisation.id}));
  useEffect(()=>{load().catch(e=>toast?.(e.message))},[]);
  const save=async()=>{setBusy(true);try{await counterApi.updateReceiptSettings({token:session.token,organisationId:session.organisation.id,settings:form});toast?.('Receipt settings saved')}catch(e){toast?.(e.message)}finally{setBusy(false)}};
  const change=(key,value)=>setForm(current=>({...current,[key]:value}));
  if(!form)return <div className="page">Loading receipt settings…</div>;
  return <div className="page"><div className="settings-wrap">
    <div className="settings-menu"><button className="selected">Store & receipts</button><button disabled>Payments</button><button disabled>Tax</button><button disabled>Data & exports</button></div>
    <div className="panel settings-panel"><h2>Receipt and business details</h2><p>Printed on customer receipts and used for VAT records.</p>
      <label>Trading name<input value={form.businessName} onChange={e=>change('businessName',e.target.value)}/></label>
      <div className="form-row"><label>Phone<input value={form.phone} onChange={e=>change('phone',e.target.value)}/></label><label>Email<input value={form.email} onChange={e=>change('email',e.target.value)}/></label></div>
      <label>Business address<textarea value={form.address} onChange={e=>change('address',e.target.value)}/></label>
      <label>VAT registration number<input value={form.vatNumber} onChange={e=>change('vatNumber',e.target.value)}/></label>
      <label>Receipt footer<input value={form.footer} onChange={e=>change('footer',e.target.value)}/></label>
      <label>Returns policy<textarea value={form.returnsPolicy} onChange={e=>change('returnsPolicy',e.target.value)}/></label>
      <div className="form-actions"><button className="primary" disabled={busy} onClick={save}><Save/>Save changes</button></div>
    </div>
  </div></div>;
}
