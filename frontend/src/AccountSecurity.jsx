import React,{useEffect,useState} from 'react';
import {counterApi} from './api.js';

export default function AccountSecurity({session,onSignedOut}){
  const [enabled,setEnabled]=useState(false),[secret,setSecret]=useState(''),[code,setCode]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{counterApi.security(session.token).then(x=>setEnabled(x.mfaEnabled)).catch(e=>setMessage(e.message));},[session.token]);
  const act=async action=>{setBusy(true);setMessage('');try{await action()}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  return <section className="panel account-security"><h2>Account security</h2><p>{enabled?'Authenticator enabled. Enter a fresh code when signing in.':'Protect your account with an authenticator app. Platform owners must enable this before accessing business data.'}</p>
    {!enabled&&!secret?<button className="primary" disabled={busy} onClick={()=>act(async()=>{const result=await counterApi.securityAction(session.token,'mfa/setup');setSecret(result.secret)})}>Set up authenticator</button>:null}
    {secret?<form onSubmit={e=>{e.preventDefault();act(async()=>{await counterApi.securityAction(session.token,'mfa/confirm',{code});onSignedOut()})}}><p>Add a time-based account in your authenticator using this setup key. Keep the key private.</p><code style={{overflowWrap:'anywhere'}}>{secret}</code><label>Authenticator code<input aria-label="Authenticator code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)} required/></label><button className="primary" disabled={busy}>Enable and sign out</button></form>:null}
    <p>Signing out everywhere revokes all your current sessions, including support sessions.</p><button className="quiet" disabled={busy} onClick={()=>act(async()=>{await counterApi.securityAction(session.token,'logout-all');onSignedOut()})}>Sign out everywhere</button>
    {message?<p role="alert">{message}</p>:null}
  </section>;
}

export function PasswordRecovery({navigate}){
  const [token]=useState(()=>{const value=location.hash.slice(1);history.replaceState({},'',location.pathname);return value});
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const submit=async e=>{e.preventDefault();setBusy(true);try{if(token){await counterApi.completeReset(token,password);setDone(true);setMessage('Password updated. Sign in with your email and password. Your authenticator remains enabled if you set one up.')}else{const result=await counterApi.requestReset(email);setMessage(result.message)}}catch(error){setMessage(error.message)}finally{setBusy(false)}};
  return <div className="login-screen"><div className="login-card"><h1>{token?'Set a new password':'Password recovery'}</h1>{!done?<form onSubmit={submit}>{token?<label>New password<input type="password" minLength={12} maxLength={72} autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>:<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}<button className="primary" disabled={busy}>{token?'Save password':'Send recovery email'}</button></form>:null}{message?<p role="status">{message}</p>:null}<button className="quiet" onClick={()=>navigate('/login')}>Back to sign in</button></div></div>;
}
