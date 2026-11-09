import test from 'node:test';
import assert from 'node:assert/strict';
import {blankWorkspace,preparationQuestions,scopeHint,suggestionFor,reviewItems,parseQuestionPack,validateWorkspace,safeUrl,containsCardData,csvFor} from '../src/model.js';
const provider=()=>({id:'provider-1',name:'Example provider',channels:['terminal'],answers:{},saq:'',scopeEvidence:'',scopeConfirmed:false,terminalType:'unknown',onlineType:'unknown',portalUrl:'',pack:null});
test('unknown or mixed channels never produce an accepted SAQ',()=>{
  assert.match(scopeHint(provider()),/acquirer needs to confirm/);
  assert.match(scopeHint({...provider(),channels:['terminal','online']}),/separate or combined/);
  assert.match(scopeHint({...provider(),terminalType:'p2pe'}),/only if the complete solution/);
});
test('answers are only suggested from complete checked facts',()=>{
  const q=preparationQuestions(provider())[0],b=blankWorkspace().business;
  assert.equal(suggestionFor(q,b,provider()),null);
  const checked={tradingName:'Test',legalName:'Test Ltd',address:'Test Street',contactName:'Test Person',email:'test@example.com',verified:true};
  assert.equal(suggestionFor(q,checked,provider()).value,'yes');
  assert.equal(suggestionFor(q,{...checked,verified:false},provider()),null);
  assert.equal(suggestionFor(preparationQuestions(provider())[3],checked,provider()),null);
});
test('a completed preparation checklist is still flagged as not the official form',()=>{
  const p=provider();for(const q of preparationQuestions(p))p.answers[q.id]={value:'yes',evidence:'Checked record'};
  assert.ok(reviewItems(p).some(i=>i.id==='official-form'));
  assert.ok(reviewItems(p).some(i=>i.id==='scope-confirmation'));
  p.answers.devices={value:'na',evidence:''};assert.ok(reviewItems(p).some(i=>/a reason for not applicable/.test(i.message)));
});
test('questionnaire imports preserve exact wording and reject duplicates or unsafe links',()=>{
  const valid={title:'Provider form',version:'4.0.1 revision 1',sourceUrl:'https://example.com/form',questions:[{id:'12.1',title:'Exact provider question?'}]};
  assert.equal(parseQuestionPack(JSON.stringify(valid)).questions[0].title,'Exact provider question?');
  assert.throws(()=>parseQuestionPack(JSON.stringify({...valid,sourceUrl:'javascript:alert(1)'})));
  assert.throws(()=>parseQuestionPack(JSON.stringify({...valid,questions:[valid.questions[0],valid.questions[0]]})));
  assert.throws(()=>parseQuestionPack(JSON.stringify({...valid,questions:[{id:'__proto__',title:'Unsafe'}]})));
  assert.throws(()=>parseQuestionPack(JSON.stringify({...valid,questions:[{id:'toString',title:'Unsafe'}]})));
});
test('a workspace backup validates providers and does not accept unrelated answer IDs',()=>{
  const workspace=blankWorkspace();workspace.providers=[provider()];
  assert.equal(validateWorkspace(workspace).providers[0].name,'Example provider');
  workspace.providers[0].answers.constructor={value:'yes'};assert.throws(()=>validateWorkspace(workspace));
});
test('card numbers and explicit security-code values are rejected',()=>{
  assert.equal(containsCardData('4111 1111 1111 1111'),true);
  assert.equal(containsCardData('CVV: 123'),true);
  assert.equal(containsCardData('Record REF-1234, card ending 1111'),false);
  const workspace=blankWorkspace();workspace.business.address='4111111111111111';assert.throws(()=>validateWorkspace(workspace));
});
test('exports identify drafts and neutralise spreadsheet formula injection',()=>{
  const workspace=blankWorkspace();workspace.business.tradingName='\t=HYPERLINK("https://example.com")';workspace.providers=[provider()];
  const csv=csvFor(workspace);assert.match(csv,/DRAFT ONLY/);assert.match(csv,/Not an attestation/);assert.ok(csv.includes('"\'\t=HYPERLINK'));
});
test('only HTTPS portal and source links can be opened',()=>{
  assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('http://example.com'),null);assert.equal(safeUrl('https://example.com'),'https://example.com/');
});
