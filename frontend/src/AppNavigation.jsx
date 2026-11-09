import React,{useEffect,useState} from 'react';
import {AlertTriangle,BarChart3,LayoutGrid,MoreHorizontal,Package,RefreshCw,Settings,ShieldCheck,ShoppingBag,Star,Users} from 'lucide-react';
import {counterApi,getApiConnectionState,subscribeApiConnection} from './api.js';

const navigation=[['Sell',ShoppingBag],['Inventory',Package],['Customers',Users],['Loyalty',Star],['Reports',BarChart3],['Manage',LayoutGrid],['Settings',Settings],['Platform',ShieldCheck]];

function ConnectionBanner(){
  const[status,setStatus]=useState(getApiConnectionState),[retrying,setRetrying]=useState(false);
  useEffect(()=>subscribeApiConnection(setStatus),[]);
  if(status!=='offline')return null;
  const retry=async()=>{setRetrying(true);try{await counterApi.health()}catch{}finally{setRetrying(false)}};
  return <div className="connection-banner" role="alert"><AlertTriangle/><span><strong>Server connection lost</strong> Payments and changes are blocked. Existing information may be out of date.</span><button disabled={retrying} onClick={retry}><RefreshCw/>{retrying?'Checking…':'Retry'}</button></div>;
}

export default function AppNavigation({page,setPage,apiStatus,role,features={},platformAdmin=false}){
  const[moreOpen,setMoreOpen]=useState(false),[connection,setConnection]=useState(getApiConnectionState),connected=connection==='connected';
  useEffect(()=>subscribeApiConnection(setConnection),[]);
  let allowed=role==='cashier'?['Sell','Customers']:role==='stock'?['Inventory','Manage']:navigation.map(item=>item[0]);
  if(!features.pos)allowed=allowed.filter(name=>!['Sell','Customers'].includes(name));
  if(!features.loyalty)allowed=allowed.filter(name=>name!=='Loyalty');
  if(!features.reports)allowed=allowed.filter(name=>name!=='Reports');
  if(!platformAdmin)allowed=allowed.filter(name=>name!=='Platform');
  const available=navigation.filter(([name])=>allowed.includes(name));
  const primaryNames=new Set(['Sell','Inventory','Customers','Reports']);
  const primary=available.filter(([name])=>primaryNames.has(name)).slice(0,4);
  const visibleNames=new Set(primary.map(([name])=>name));
  const secondary=available.filter(([name])=>!visibleNames.has(name));
  const choose=name=>{setPage(name);setMoreOpen(false)};
  return <><ConnectionBanner/><aside className="sidebar"><div className="brand"><span className="brandmark">C</span><strong>Counter</strong></div><nav>{primary.map(([name,Icon])=><button key={name} className={page===name?'active':''} onClick={()=>choose(name)}><Icon/><span>{name}</span></button>)}<div className={`secondary-nav ${moreOpen?'open':''}`}>{secondary.map(([name,Icon])=><button key={name} className={page===name?'active':''} onClick={()=>choose(name)}><Icon/><span>{name}</span></button>)}</div>{secondary.length?<button className={`mobile-more ${secondary.some(([name])=>name===page)?'active':''}`} aria-label="More navigation" aria-expanded={moreOpen} onClick={()=>setMoreOpen(value=>!value)}><MoreHorizontal/><span>More</span></button>:null}</nav><div className={`sidefoot ${connected?'backend-connected':'backend-local'}`}><div><span className="connection-dot"/><span>{features.pos?'Till 1':'Stock'} · {connected?'Online':connection==='checking'?'Connecting':'Offline'}</span></div><small>{connection==='checking'?'Connecting securely…':connected?'Server connected':'Connection lost'}</small></div></aside></>;
}
