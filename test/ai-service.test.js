import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

process.env.AI_PROVIDER='deepseek';process.env.AI_MODEL='deepseek-chat';process.env.AI_BASE_URL='https://deepseek.example.test';process.env.DEEPSEEK_API_KEY='test-only-secret';process.env.STATE_DIR=await mkdtemp(path.join(tmpdir(),'bankstream-ai-test-'));
const {answerFraudQuestion,analyzeCustomer}=await import('../src/services/ai-service.js');
const fixture={customer:{CUSTOMER_ID:100001,CUSTOMER_NAME:'Synthetic Test Customer'},profile:{CUSTOMER_PROFILE_ID:'CP100001',CUSTOMER_ID:100001,EMAIL:'private@example.test',PHONE_NUMBER:'555'},accounts:[{ACCOUNT_ID:'A-1',ACCOUNT_STATUS:'ACTIVE'}],transactions:[{TRANSACTION_ID:'T-1',TRANSACTION_STATUS:'FAILED'}],loans:[],repayments:[],termDeposits:[],kyc:[],serviceCases:[],consent:[{CONSENT_ID:'C-1',CONSENT_TYPE:'MARKETING',CONSENT_STATUS:'GRANTED'}],preferences:[],alerts:[],source:'demo',retrievedAt:'2026-10-22T01:00:00Z'};

test('DeepSeek adapter sends the backend-supplied minimal context and returns the provider answer',async()=>{
  const originalFetch=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({choices:[{message:{content:'Potential indicator only. Source: TX-1.'}}]});};
  try{const result=await answerFraudQuestion({context:{customer:{customerId:'C-1',accounts:[{accountId:'A-1',currency:'USD'}]}},message:'Summarize this relationship'});assert.equal(result.provider,'deepseek');assert.equal(result.model,'deepseek-chat');assert.match(result.answer,/Potential indicator only/);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://deepseek.example.test/chat/completions');assert.equal(calls[0].options.headers.Authorization,'Bearer test-only-secret');const payload=JSON.parse(calls[0].options.body);assert.equal(payload.messages[1].role,'user');assert.match(payload.messages[1].content,/customerId/);assert.match(payload.messages[1].content,/Summarize this relationship/);}finally{globalThis.fetch=originalFetch;}
});

test('assistant validates required message input before provider call',async()=>{await assert.rejects(()=>answerFraudQuestion({context:{},message:'  '}),error=>error.status===400);});

test('customer analysis sends current records, validates model-selected evidence, and persists deduplicated actions',async()=>{
  const originalFetch=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({choices:[{message:{content:JSON.stringify({insights:['A failed transaction is recorded.'],patterns:[],risks:[],actions:[{title:'Review failed transaction',priority:'HIGH',expectedBenefit:'Understand the failure',reasoning:'A failed transaction is present.',nextStep:'Review the transaction record.',evidenceKeys:['E4']}],limitations:[]})}}]});};
  try{const first=await analyzeCustomer({customer:fixture}),second=await analyzeCustomer({customer:fixture});assert.equal(first.customerId,'100001');assert.equal(first.actions[0].sourceReferences[0].id,'T-1');assert.equal(second.actions[0].recommendationId,first.actions[0].recommendationId);assert.equal(calls.length,2);const payload=JSON.parse(calls[0].options.body);const prompt=payload.messages[1].content;assert.deepEqual(payload.response_format,{type:'json_object'});assert.match(prompt,/independently select and rank/);assert.match(prompt,/E4/);assert.doesNotMatch(prompt,/private@example\.test|555/);const rows=JSON.parse(await readFile(path.join(process.env.STATE_DIR,'recommendations.json'),'utf8'));assert.equal(rows.length,1);assert.equal(rows[0].status,'PROPOSED');}
  finally{globalThis.fetch=originalFetch;await rm(process.env.STATE_DIR,{recursive:true,force:true});}
});

test('customer analysis rejects evidence references outside the retrieved context',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({insights:[],patterns:[],risks:[],actions:[{title:'Investigate',priority:'HIGH',expectedBenefit:'Resolve',reasoning:'Evidence',nextStep:'Review',evidenceKeys:['E404']}],limitations:[]})}}]});
  try{await assert.rejects(()=>analyzeCustomer({customer:fixture}),error=>error.code==='AI_INVALID_EVIDENCE');}finally{globalThis.fetch=originalFetch;await rm(process.env.STATE_DIR,{recursive:true,force:true});}
});

test('customer analysis repairs a bad citation using only retrieved evidence before saving',async()=>{
  const originalFetch=globalThis.fetch;let call=0;globalThis.fetch=async()=>{call++;const key=call===1?'E404':'E4';return Response.json({choices:[{message:{content:JSON.stringify({insights:['A failed transaction is recorded.'],patterns:[],risks:[],actions:[{title:'Review failed transaction',priority:'HIGH',expectedBenefit:'Understand the failure',reasoning:'A failed transaction is present.',nextStep:'Review the transaction record.',evidenceKeys:[key]}],limitations:[]})}}]});};
  try{const result=await analyzeCustomer({customer:fixture});assert.equal(call,2);assert.equal(result.actions[0].sourceReferences[0].id,'T-1');const rows=JSON.parse(await readFile(path.join(process.env.STATE_DIR,'recommendations.json'),'utf8'));assert.equal(rows.length,1);assert.equal(rows[0].sourceReferences[0].id,'T-1');}
  finally{globalThis.fetch=originalFetch;await rm(process.env.STATE_DIR,{recursive:true,force:true});}
});
