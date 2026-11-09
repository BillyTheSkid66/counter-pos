export const sourceLinks={
  eligibility:'https://www.pcisecuritystandards.org/faqs/1133/',
  library:'https://www.pcisecuritystandards.org/document_library/',
  channels:'https://www.pcisecuritystandards.org/faqs/1443/'
};
export const channelNames={terminal:'In-store terminals',online:'Online payments',phone:'Phone / virtual terminal',other:'Other / integrated payments'};
export const answerNames={yes:'Yes',no:'No',unknown:'Not sure',na:'Not applicable'};
export const blankWorkspace=()=>({version:1,business:{tradingName:'',legalName:'',address:'',contactName:'',email:'',verified:false},providers:[],updatedAt:null});
export function safeUrl(url){try{const parsed=new URL(url);return parsed.protocol==='https:'?parsed.href:null;}catch{return null;}}
export function containsCardData(text){
  if(/\b(?:cvv|cvc|security code)\s*[:=]\s*\d{3,4}\b/i.test(text))return true;
  const matches=String(text).match(/(?:\d[ -]?){13,19}/g)||[];
  return matches.some(match=>{const digits=match.replace(/\D/g,'');if(!/^[1-9]\d{12,18}$/.test(digits))return false;let sum=0;[...digits].reverse().forEach((d,i)=>{let n=Number(d);if(i%2){n*=2;if(n>9)n-=9;}sum+=n});return sum%10===0;});
}
const question=(id,title,help,evidence,extra={})=>({id,title,help,evidence,...extra});
export function preparationQuestions(provider){
  return [
    question('business','Are the business and assessment contact details current?','Check the legal entity, trading name, address and the person responsible for this assessment.','A checked business profile and the date it was reviewed.',{suggestion:'business'}),
    question('scope','Has your acquirer confirmed the questionnaire and scope for these payment channels?','Different channels can change your eligibility. Your provider or acquirer must confirm the form and version it accepts. A terminal brand alone does not determine the SAQ.','Provider email or portal reference confirming the questionnaire, version and payment channels.',{suggestion:'scope',source:sourceLinks.eligibility}),
    question('data-flow','Have you documented where card data goes for this provider?','Include every payment channel, terminal, connected till, website and third party. Check what your own systems can see, process or store.','A current payment-flow description or diagram. Do not include card numbers.'),
    question('storage','Have you checked whether your systems store any payment account data?','Check actual systems, exports, logs, receipts and support processes. Do not assume that outsourced processing means nothing is stored.','Review findings and system references; no card numbers, CVV or passwords.'),
    ...(provider.channels.includes('terminal')?[question('devices','Is your payment-device inventory current, with an inspection process?','Record terminal models, locations, ownership and who checks for tampering or substitution. Confirm the controls required by your accepted questionnaire.','Inventory reference, inspection process and a recent inspection record.')]:[]),
    question('third-parties','Have you recorded the provider’s responsibilities and relevant compliance evidence?','Ask which services their validation covers and which responsibilities remain with you. A provider’s certificate does not validate your business.','Service agreement, current provider evidence and responsibility references.'),
    question('access','Have you checked staff and administrator access to payment-related systems?','Review individual accounts, access levels, leavers and authentication controls against the applicable requirements.','Access review date, owner and supporting record.'),
    question('maintenance','Have you checked security maintenance and any required testing with the provider?','Confirm who manages patches, network controls and any required scans or tests. This website does not perform an ASV scan or determine whether one is required.','Maintenance ownership and confirmation of the tests required for your scope.'),
    question('training','Do staff know the payment-security procedures relevant to their work?','Check how staff recognise suspicious devices, handle payment information and report concerns.','Training or briefing reference and last review date.'),
    question('incident','Do you have a current process for reporting a payment-security incident?','Record who to contact, how to reach the provider and how to escalate a suspected incident.','Incident procedure reference and provider contact process.')
  ];
}
export function questionsFor(provider){return provider.pack?.questions||preparationQuestions(provider);}
export function scopeHint(provider){
  if(!provider.channels.length)return 'Select your payment channels. Your acquirer will need to confirm the assessment scope.';
  if(provider.channels.length!==1)return 'Mixed payment channels: ask your acquirer whether it wants separate or combined validation.';
  if(provider.channels[0]==='terminal'&&provider.terminalType==='p2pe')return 'Ask about SAQ P2PE only if the complete solution is PCI-listed and every eligibility criterion is met. An encrypted terminal alone is not enough.';
  if(provider.channels[0]==='terminal'&&provider.terminalType==='standalone')return 'Ask whether SAQ B-IP applies. Device approval, connectivity, isolation and every other eligibility criterion must be checked.';
  if(provider.channels[0]==='online'&&provider.onlineType==='outsourced')return 'Ask whether SAQ A applies to the exact integration. Outsourcing alone does not prove eligibility.';
  return 'Your acquirer needs to confirm scope. This workspace does not select or certify your SAQ.';
}
export function suggestionFor(question,business,provider){
  if(question.suggestion==='business'&&business.verified&&business.tradingName&&business.legalName&&business.address&&business.contactName&&business.email)return {value:'yes',evidence:`Business details checked ${business.verifiedAt||'by the business contact'}.`,reason:'Based on your checked business profile. Review before applying.'};
  if(question.suggestion==='scope'&&provider.scopeConfirmed&&provider.saq&&provider.scopeEvidence)return {value:'yes',evidence:provider.scopeEvidence,reason:'Based on the acquirer confirmation you recorded. Review before applying.'};
  return null;
}
export function reviewItems(provider){
  const issues=[];
  if(!provider.scopeConfirmed||!provider.saq||!provider.scopeEvidence)issues.push({id:'scope-confirmation',message:'Get acquirer confirmation of the questionnaire and scope.'});
  if(!provider.pack)issues.push({id:'official-form',message:'This is a preparation checklist. Map it to your provider’s actual form before submission.'});
  for(const q of questionsFor(provider)){
    const answer=provider.answers[q.id];
    if(!answer||answer.value==='unknown')issues.push({id:q.id,message:`Needs an answer: ${q.title}`});
    else if(answer.value==='no')issues.push({id:q.id,message:`Action needed: ${q.title}`});
    else if(!answer.evidence?.trim())issues.push({id:q.id,message:`Add ${answer.value==='na'?'a reason for not applicable':'a supporting reference'}: ${q.title}`});
  }
  return issues;
}
export function parseQuestionPack(text){
  if(text.length>1000000)throw new Error('This questionnaire is too large. Maximum size is 1 MB.');
  const pack=JSON.parse(text);
  if(!pack||typeof pack.title!=='string'||!pack.title.trim()||typeof pack.version!=='string'||!pack.version.trim()||!safeUrl(pack.sourceUrl))throw new Error('A questionnaire needs a title, version and HTTPS source link.');
  if(!Array.isArray(pack.questions)||!pack.questions.length||pack.questions.length>600)throw new Error('Use between 1 and 600 questions.');
  const ids=new Set();
  const questions=pack.questions.map(q=>{
    if(!q||typeof q.id!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(q.id)||Object.hasOwn(Object.prototype,q.id)||q.id==='prototype'||ids.has(q.id)||typeof q.title!=='string'||!q.title.trim()||q.title.length>6000)throw new Error('Each question needs a unique ID and question text.');
    ids.add(q.id);return {id:q.id,title:q.title.trim(),help:String(q.help||'Review the provider’s guidance for this question.').slice(0,6000),evidence:String(q.evidence||'Record the evidence or reason supporting your answer.').slice(0,6000)};
  });
  return {title:pack.title.slice(0,200),version:pack.version.slice(0,80),sourceUrl:safeUrl(pack.sourceUrl),questions};
}
export function validateWorkspace(value){
  if(!value||value.version!==1||!value.business||!Array.isArray(value.providers)||value.providers.length>100)throw new Error('This is not a supported workspace backup.');
  const business={};
  for(const key of ['tradingName','legalName','address','contactName','email']){if(typeof value.business[key]!=='string'||value.business[key].length>2000)throw new Error('Invalid business profile.');business[key]=value.business[key];}
  if(typeof value.business.verified!=='boolean')throw new Error('Invalid business confirmation.');
  business.verified=value.business.verified;business.verifiedAt=String(value.business.verifiedAt||'').slice(0,80);
  const ids=new Set();
  const providers=value.providers.map(p=>{
    if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||!Array.isArray(p.channels)||!p.channels.length||p.channels.some(c=>!channelNames[c]))throw new Error('Invalid payment provider.');
    ids.add(p.id);
    const pack=p.pack?parseQuestionPack(JSON.stringify(p.pack)):null;
    const allowedIds=new Set((pack?.questions||preparationQuestions(p)).map(q=>q.id));
    const answers=Object.create(null);for(const [id,answer] of Object.entries(p.answers||{})){
      if(!allowedIds.has(id))throw new Error('An answer does not match this questionnaire.');
      if(!answerNames[answer?.value])throw new Error('Invalid questionnaire answer.');
      answers[id]={value:answer.value,evidence:String(answer.evidence||'').slice(0,10000),reviewer:String(answer.reviewer||'').slice(0,160),reviewedAt:String(answer.reviewedAt||'').slice(0,80),origin:answer.origin==='suggested'?'suggested':'manual'};
    }
    return {id:p.id,name:p.name.slice(0,160),channels:[...new Set(p.channels)],portalUrl:safeUrl(p.portalUrl)||'',saq:String(p.saq||'').slice(0,80),scopeEvidence:String(p.scopeEvidence||'').slice(0,2000),scopeConfirmed:Boolean(p.scopeConfirmed),terminalType:['unknown','standalone','p2pe','integrated'].includes(p.terminalType)?p.terminalType:'unknown',onlineType:['unknown','outsourced','direct'].includes(p.onlineType)?p.onlineType:'unknown',answers,pack};
  });
  const result={version:1,business,providers,updatedAt:String(value.updatedAt||'').slice(0,80)};
  if(containsCardData(JSON.stringify(result)))throw new Error('Possible card data found. Remove card numbers and security codes before importing.');
  return result;
}
export function csvFor(workspace){
  const escape=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const rows=[['DRAFT ONLY','Business','Legal name','Address','Contact','Email','Provider','Channels','Questionnaire','Version','Question ID','Question','Answer','Evidence / reason','Reviewer','Reviewed at']];
  for(const p of workspace.providers)for(const q of questionsFor(p)){
    const a=p.answers[q.id]||{};
    rows.push(['Not an attestation',workspace.business.tradingName,workspace.business.legalName,workspace.business.address,workspace.business.contactName,workspace.business.email,p.name,p.channels.map(c=>channelNames[c]).join('; '),p.pack?.title||'Preparation checklist (not an SAQ)',p.pack?.version||'1',q.id,q.title,answerNames[a.value]||'Unanswered',a.evidence||'',a.reviewer||'',a.reviewedAt||'']);
  }
  return rows.map(row=>row.map(escape).join(',')).join('\r\n');
}
