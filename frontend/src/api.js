const API_URL = (import.meta.env?.VITE_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
let connectionState = 'checking';
const notifyConnection = state => {
  if (connectionState === state) return;
  connectionState = state;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('counter:connection',{detail:state}));
};
export const getApiConnectionState = () => connectionState;
export const subscribeApiConnection = listener => {
  const handler = event => listener(event.detail);
  window.addEventListener('counter:connection',handler);
  return () => window.removeEventListener('counter:connection',handler);
};

async function request(path, options = {}) {
  const method=(options.method||'GET').toUpperCase();
  if(connectionState==='offline'&&!['GET','HEAD'].includes(method))throw new Error('Counter is offline. Payments and changes are blocked until the connection is restored.');
  let response;
  try{response=await fetch(`${API_URL}${path}`, {...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...options.headers}});notifyConnection(response.status>=500?'offline':'connected')}
  catch(error){if(error?.name!=='AbortError')notifyConnection('offline');throw error?.name==='AbortError'?error:new Error('Counter cannot reach the server. Payments and changes are blocked until the connection is restored.')}
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || body.error || `API request failed (${response.status})`),{status:response.status});
  }
  return response.json();
}

export const counterApi = {
  health: ({signal} = {}) => request('/health', {signal}),
  publicPlans:()=>request('/api/public/plans'),
  startTrial:trial=>request('/api/public/trials',{method:'POST',body:JSON.stringify(trial)}),
  platformSubscriptions:({token})=>request('/api/platform/subscriptions',{headers:{Authorization:`Bearer ${token}`}}),
  platformAudit:({token,id})=>request(`/api/platform/subscriptions/${id}/audit`,{headers:{Authorization:`Bearer ${token}`}}),
  updatePlatformSubscription:({token,id,changes})=>request(`/api/platform/subscriptions/${id}`,{method:'PATCH',body:JSON.stringify(changes),headers:{Authorization:`Bearer ${token}`}}),
  supportSession:({token,id})=>request(`/api/platform/subscriptions/${id}/support-session`,{method:'POST',headers:{Authorization:`Bearer ${token}`}}),
  login:(email,password,code)=>request('/api/auth/login',{method:'POST',body:JSON.stringify({email,password,code:code||undefined})}),
  pinLogin:(email,pin,code)=>request('/api/auth/pin',{method:'POST',body:JSON.stringify({email,pin,code:code||undefined})}),
  security:(token)=>request('/api/auth/security',{headers:{Authorization:`Bearer ${token}`}}),
  securityAction:(token,action,body={})=>request(`/api/auth/${action}`,{method:'POST',body:JSON.stringify(body),headers:{Authorization:`Bearer ${token}`}}),
  requestReset:email=>request('/api/auth/password-reset',{method:'POST',body:JSON.stringify({email})}),
  completeReset:(token,password)=>request('/api/auth/password-reset/complete',{method:'POST',body:JSON.stringify({token,password})}),
  staff:({token,organisationId})=>request('/api/staff',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createStaff:({token,organisationId,staff})=>request('/api/staff',{method:'POST',body:JSON.stringify(staff),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  receiptSettings:({token,organisationId})=>request('/api/receipt-settings',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  updateReceiptSettings:({token,organisationId,settings})=>request('/api/receipt-settings',{method:'PUT',body:JSON.stringify(settings),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  products: ({token, organisationId, signal}) => request('/api/products', {
    signal,
    headers: {Authorization: `Bearer ${token}`, 'x-organisation-id': organisationId},
  }),
  categories:({token,organisationId})=>request('/api/categories',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createCategory:({token,organisationId,category})=>request('/api/categories',{method:'POST',body:JSON.stringify(category),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  updateCategory:({token,organisationId,id,changes})=>request(`/api/categories/${id}`,{method:'PATCH',body:JSON.stringify(changes),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  assignFamilyCategory:({token,organisationId,id,categoryId})=>request(`/api/product-families/${id}/category`,{method:'PUT',body:JSON.stringify({categoryId}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  inventory:({token,organisationId})=>request('/api/inventory',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  adjustInventory:({token,organisationId,adjustment})=>request('/api/inventory/adjust',{method:'POST',body:JSON.stringify(adjustment),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  stocktake:({token,organisationId,counts,reason})=>request('/api/inventory/stocktake',{method:'POST',body:JSON.stringify({counts,reason}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  setReorderLevel:({token,organisationId,id,reorderLevel})=>request(`/api/inventory/${id}/reorder-level`,{method:'PUT',body:JSON.stringify({reorderLevel}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  productFamilies: ({token, organisationId, signal}) => request('/api/product-families', {
    signal,
    headers: {Authorization: `Bearer ${token}`, 'x-organisation-id': organisationId},
  }),
  createProductFamily: ({token, organisationId, product}) => request('/api/product-families', {
    method: 'POST', body: JSON.stringify(product),
    headers: {Authorization: `Bearer ${token}`, 'x-organisation-id': organisationId},
  }),
  updateProductVariant:({token,organisationId,id,variant})=>request(`/api/product-variants/${id}`,{method:'PATCH',body:JSON.stringify(variant),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  pendingCheckout:organisationId=>JSON.parse(sessionStorage.getItem(`counter:checkout:${organisationId}`)||'null'),
  checkout:async({token,organisationId,...body})=>{
    const storageKey=`counter:checkout:${organisationId}`;
    const saved=counterApi.pendingCheckout(organisationId);
    const payload=JSON.parse(JSON.stringify(body));
    if(saved&&JSON.stringify(saved.body)!==JSON.stringify(payload))throw new Error('Resolve the pending checkout before starting another sale.');
    const pending=saved||{key:crypto.randomUUID(),body:payload};
    sessionStorage.setItem(storageKey,JSON.stringify(pending));
    try{
      const result=await request('/api/checkout',{method:'POST',body:JSON.stringify(pending.body),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId,'Idempotency-Key':pending.key}});
      sessionStorage.removeItem(storageKey);return result;
    }catch(error){if(error.status>=400&&error.status<500&&![401,403,429].includes(error.status))sessionStorage.removeItem(storageKey);throw error;}
  },
  retryCheckout:async({token,organisationId})=>{await counterApi.health();const saved=counterApi.pendingCheckout(organisationId);if(!saved)throw new Error('No pending checkout');return counterApi.checkout({token,organisationId,...saved.body})},
  transactions: ({token,organisationId}) => request('/api/transactions',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  managementReport:({token,organisationId,days=7})=>request(`/api/reports/management?days=${days}`,{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  transaction: ({token,organisationId,id}) => request(`/api/transactions/${id}`,{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  refundTransaction: ({token,organisationId,id,managerPin,reason}) => request(`/api/transactions/${id}/refund`,{method:'POST',body:JSON.stringify({managerPin,reason}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  partialRefund:({token,organisationId,id,items,managerPin,reason,refundMethod='original'})=>request(`/api/transactions/${id}/return`,{method:'POST',body:JSON.stringify({items,managerPin,reason,refundMethod}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  parkedBaskets:({token,organisationId})=>request('/api/parked-baskets',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  parkBasket:({token,organisationId,basket})=>request('/api/parked-baskets',{method:'POST',body:JSON.stringify(basket),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  removeParkedBasket:({token,organisationId,id})=>request(`/api/parked-baskets/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  storeCredit:({token,organisationId,code})=>request(`/api/store-credits/${encodeURIComponent(code)}`,{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  tillSession:({token,organisationId})=>request('/api/till-session',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  openTill:({token,organisationId,openingFloat})=>request('/api/till-session/open',{method:'POST',body:JSON.stringify({openingFloat}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  cashMovement:({token,organisationId,type,amount,reason})=>request('/api/till-session/movement',{method:'POST',body:JSON.stringify({type,amount,reason}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  closeTill:({token,organisationId,closingCount,managerPin,reason})=>request('/api/till-session/close',{method:'POST',body:JSON.stringify({closingCount,managerPin,reason}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  purchasing:({token,organisationId})=>request('/api/purchasing',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createSupplier:({token,organisationId,name,email})=>request('/api/suppliers',{method:'POST',body:JSON.stringify({name,email:email||undefined}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createPurchaseOrder:({token,organisationId,supplierId,items})=>request('/api/purchase-orders',{method:'POST',body:JSON.stringify({supplierId,items}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  receivePurchaseOrder:({token,organisationId,id})=>request(`/api/purchase-orders/${id}/receive`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  customers:({token,organisationId})=>request('/api/customers',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createCustomer:({token,organisationId,customer})=>request('/api/customers',{method:'POST',body:JSON.stringify(customer),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  customer:({token,organisationId,id})=>request(`/api/customers/${id}`,{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  loyaltyProgram:({token,organisationId})=>request('/api/loyalty-program',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  updateLoyaltyProgram:({token,organisationId,programme})=>request('/api/loyalty-program',{method:'PUT',body:JSON.stringify(programme),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createRewardTier:({token,organisationId,tier})=>request('/api/loyalty-reward-tiers',{method:'POST',body:JSON.stringify(tier),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  deleteRewardTier:({token,organisationId,id})=>request(`/api/loyalty-reward-tiers/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  promotions:({token,organisationId})=>request('/api/promotions',{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createPromotion:({token,organisationId,promotion})=>request('/api/promotions',{method:'POST',body:JSON.stringify(promotion),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  announcements:({token,organisationId,archived=false})=>request(`/api/announcements${archived?'?archived=true':''}`,{headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  createAnnouncement:({token,organisationId,announcement})=>request('/api/announcements',{method:'POST',body:JSON.stringify(announcement),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  updateAnnouncement:({token,organisationId,id,announcement})=>request(`/api/announcements/${id}`,{method:'PATCH',body:JSON.stringify(announcement),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  archiveAnnouncement:({token,organisationId,id})=>request(`/api/announcements/${id}/archive`,{method:'POST',body:'{}',headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  readAnnouncements:({token,organisationId,ids})=>request('/api/announcements/read',{method:'POST',body:JSON.stringify({ids}),headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
  deleteAnnouncement:({token,organisationId,id})=>request(`/api/announcements/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`,'x-organisation-id':organisationId}}),
};
