import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='';
process.env.STATE_DIR=await mkdtemp(path.join(os.tmpdir(),'bankstream-fraud-test-'));
const [{analyzeTransactions},{demoFraudBundle},{fraudIntelligenceService},{fraudInvestigationService},{fraudInvestigationRepository}]=await Promise.all([
  import('../src/services/fraud-detection-service.js'),import('../src/data/demo-fraud-bundle.js'),import('../src/services/fraud-intelligence-service.js'),import('../src/services/fraud-investigation-service.js'),import('../src/repositories/fraud-investigation-repository.js')
]);
after(async()=>{await rm(process.env.STATE_DIR,{recursive:true,force:true});});

test('demo feed produces rapid activity and same-type amount indicators',()=>{
  const result=analyzeTransactions(demoFraudBundle);
  assert.equal(result.source,'SIMULATED_DEMO_DATA');
  assert.equal(result.alerts.length,2);
  assert.ok(result.alerts.some(x=>x.ruleCode==='RAPID_POSTED_ACTIVITY'&&x.riskLevel==='HIGH'));
  assert.ok(result.alerts.some(x=>x.ruleCode==='ACCOUNT_AMOUNT_OUTLIER'));
  assert.equal(result.analyzedTransactions,17);
  assert.equal(result.excludedTransactions,1);
  for(const alert of result.alerts){assert.match(alert.explanation,/not a fraud finding/i);assert.match(alert.maskedAccountReference,/^••••\d{4}$/);assert.ok(!JSON.stringify(alert.context).includes('NATIONAL_IDENTIFICATION_NUMBER'));assert.ok(!JSON.stringify(alert.context).includes('PHONE_NUMBER'));}
});

test('authorization and reversed postings are excluded from posted activity rules',()=>{
  const baseTime=new Date().toISOString(),bundle={source:'test',CUSTOMER:[],BANK_ACCOUNT:[{ACCOUNT_ID:'A1',ACCOUNT_NUMBER:'1234',CURRENCY:'USD'}],ACCOUNT_CUSTOMER_RELATIONSHIP:[{ACCOUNT_ID:'A1',CUSTOMER_ID:1,OWNERSHIP_ROLE:'PRIMARY',EFFECTIVE_FROM:'2020-01-01'}],ACCOUNT_TRANSACTION:[
    {TRANSACTION_ID:'ORIGINAL',ACCOUNT_ID:'A1',TRANSACTION_TYPE:'CARD_PURCHASE',TRANSACTION_STAGE:'POSTED',TRANSACTION_STATUS:'COMPLETED',TRANSACTION_AMOUNT:'100.0000',CURRENCY:'USD',TRANSACTION_TIMESTAMP:baseTime},
    {TRANSACTION_ID:'REVERSAL',ACCOUNT_ID:'A1',TRANSACTION_TYPE:'REVERSAL',TRANSACTION_STAGE:'REVERSAL',TRANSACTION_STATUS:'REVERSED',TRANSACTION_AMOUNT:'100.0000',CURRENCY:'USD',TRANSACTION_TIMESTAMP:baseTime,RELATED_TRANSACTION_ID:'ORIGINAL'},
    {TRANSACTION_ID:'AUTH',ACCOUNT_ID:'A1',TRANSACTION_TYPE:'CARD_PURCHASE',TRANSACTION_STAGE:'AUTHORIZATION',TRANSACTION_STATUS:'COMPLETED',TRANSACTION_AMOUNT:'9000.0000',CURRENCY:'USD',TRANSACTION_TIMESTAMP:baseTime}
  ]};
  const result=analyzeTransactions(bundle);
  assert.equal(result.analyzedTransactions,0);assert.equal(result.excludedTransactions,3);assert.equal(result.alerts.length,0);
});

test('repeated rejected attempts and reversal events create explainable potential indicators only',()=>{
  const now=Date.now(),transaction=(id,status,stage,minutesAgo=5)=>({TRANSACTION_ID:id,ACCOUNT_ID:'A1',TRANSACTION_TYPE:'CARD_PURCHASE',TRANSACTION_STAGE:stage,TRANSACTION_STATUS:status,TRANSACTION_AMOUNT:'25.0000',CURRENCY:'USD',TRANSACTION_TIMESTAMP:new Date(now-minutesAgo*60_000).toISOString()});
  const bundle={source:'test',CUSTOMER:[{CUSTOMER_ID:1,CUSTOMER_NAME:'Test'}],BANK_ACCOUNT:[{ACCOUNT_ID:'A1',ACCOUNT_NUMBER:'1234',ACCOUNT_STATUS:'ACTIVE',CURRENCY:'USD'}],ACCOUNT_CUSTOMER_RELATIONSHIP:[{ACCOUNT_ID:'A1',CUSTOMER_ID:1,EFFECTIVE_FROM:'2020-01-01'}],ACCOUNT_TRANSACTION:[transaction('R1','REJECTED','AUTHORIZATION'),transaction('R2','REJECTED','AUTHORIZATION',4),transaction('R3','REJECTED','AUTHORIZATION',3),transaction('V1','REVERSED','REVERSAL',2),transaction('V2','REVERSED','REVERSAL',1),transaction('V3','REVERSED','REVERSAL',0)]};
  const result=analyzeTransactions(bundle,{now});
  assert.equal(result.analyzedTransactions,0);
  assert.equal(result.alerts.length,2);
  assert.ok(result.alerts.some(x=>x.ruleCode==='REPEATED_REJECTED_ACTIVITY'&&x.evidence.length===3));
  assert.ok(result.alerts.some(x=>x.ruleCode==='REPEATED_REVERSALS'&&x.evidence.length===3));
  assert.ok(result.alerts.every(x=>/not establish fraud/i.test(x.explanation)));
});

test('investigation lifecycle persists audit, validates transitions, and requires a decision note',async()=>{
  const dashboard=await fraudIntelligenceService.getDashboard();assert.equal(dashboard.mode,'demo');assert.equal(dashboard.summary.suspiciousAlertCount,2);
  const alert=dashboard.alerts[0];
  const first=await fraudInvestigationService.update(alert.alertId,{status:'UNDER_REVIEW',assignedTo:'Fraud Operations'},'demo-investigator');
  assert.equal(first.status,'UNDER_REVIEW');assert.equal(first.audit.length,1);
  await assert.rejects(()=>fraudInvestigationService.update(alert.alertId,{status:'CONFIRMED_FRAUD'},'demo-investigator'),e=>e.status===400);
  const closed=await fraudInvestigationService.update(alert.alertId,{status:'CLOSED_NO_FRAUD',decisionNote:'Reviewed source records with customer; no fraud found.'},'demo-investigator');
  assert.equal(closed.status,'CLOSED_NO_FRAUD');assert.equal(closed.audit.length,2);assert.ok(closed.audit.every(x=>x.actor==='demo-investigator'));
  const persisted=await fraudInvestigationRepository.list();assert.equal(persisted[0].alertId,alert.alertId);assert.equal(persisted[0].status,'CLOSED_NO_FRAUD');
});

test('customer scope limits dashboard and Customer 360 results and masks account identifiers',async()=>{
  const scope={all:false,customerIds:['100458']};
  const customers=await fraudIntelligenceService.getCustomers(scope);
  assert.equal(customers.customers.length,1);assert.equal(String(customers.customers[0].CUSTOMER_ID),'100458');
  assert.equal('EMAIL' in customers.customers[0],false);assert.equal('NATIONAL_IDENTIFICATION_NUMBER' in customers.customers[0],false);
  const profile=await fraudIntelligenceService.getCustomer('100458',scope);
  assert.equal('DATE_OF_BIRTH' in profile.customer,false);assert.equal('PHONE_NUMBER' in profile.profile,false);
  assert.ok(profile.accounts.every(a=>!String(a.ACCOUNT_NUMBER).includes('142350')));
  const other=await fraudIntelligenceService.getDashboard({}, {all:false,customerIds:['100242']});
  assert.equal(other.summary.suspiciousAlertCount,0);
  assert.ok(other.alerts.every(a=>a.customerIds.every(id=>id==='100242')));
});
test('alert context correlates KYC, payment, beneficiary, and ownership records without treating them as proof',()=>{
  const now=Date.now(),bundle={source:'test',CUSTOMER:[{CUSTOMER_ID:1,CUSTOMER_NAME:'Test'}],CUSTOMER_KYC:[{KYC_RECORD_ID:'K1',CUSTOMER_ID:1,KYC_STATUS:'VERIFIED',RISK_RATING:'HIGH'}],BANK_ACCOUNT:[{ACCOUNT_ID:'A1',ACCOUNT_NUMBER:'1234',ACCOUNT_STATUS:'ACTIVE',CURRENCY:'USD'}],ACCOUNT_CUSTOMER_RELATIONSHIP:[{ACCOUNT_ID:'A1',CUSTOMER_ID:1,EFFECTIVE_FROM:'2020-01-01'}],PAYMENT_INSTRUCTION:[{PAYMENT_ID:'P1',CUSTOMER_ID:1,SOURCE_ACCOUNT_ID:'A1',BENEFICIARY_ID:'B1',PAYMENT_TYPE:'DOMESTIC',PAYMENT_AMOUNT:'12.0000',CURRENCY:'USD',INITIATED_TIMESTAMP:new Date(now).toISOString(),PAYMENT_STATUS:'REJECTED'}],PAYMENT_BENEFICIARY:[{BENEFICIARY_ID:'B1',CUSTOMER_ID:1,BENEFICIARY_STATUS:'ACTIVE'}],ACCOUNT_TRANSACTION:['X1','X2','X3'].map((id,index)=>({TRANSACTION_ID:id,ACCOUNT_ID:'A1',TRANSACTION_TYPE:'CARD_PURCHASE',TRANSACTION_STAGE:'AUTHORIZATION',TRANSACTION_STATUS:'REJECTED',TRANSACTION_AMOUNT:'12.0000',CURRENCY:'USD',TRANSACTION_TIMESTAMP:new Date(now-index*60_000).toISOString()}))};
  const alert=analyzeTransactions(bundle,{now}).alerts[0];assert.equal(alert.riskLevel,'MEDIUM');assert.equal(alert.correlatedContext.highKycRatingRecords[0].KYC_RECORD_ID,'K1');assert.equal(alert.correlatedContext.sameAccountPaymentInstructions[0].PAYMENT_ID,'P1');assert.equal(alert.correlatedContext.relatedBeneficiaries[0].BENEFICIARY_ID,'B1');assert.match(alert.correlatedContext.interpretation,/do not independently confirm fraud/i);
});
