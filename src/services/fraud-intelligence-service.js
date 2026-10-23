import { bankingDataService } from './banking-data-service.js';
import { analyzeTransactions } from './fraud-detection-service.js';
import { fraudInvestigationRepository } from '../repositories/fraud-investigation-repository.js';
import { HttpError } from '../middleware/errors.js';
import { toScaledDecimal,fromScaledDecimal } from '../utils/decimal.js';

const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row?.[k]!==undefined).map(k=>[k,row[k]]));
const customerFields=['CUSTOMER_ID','CUSTOMER_NAME','CUSTOMER_TYPE','BRANCH_CODE','CUSTOMER_STATUS','OPENING_DATE','LAST_UPDATED_TIMESTAMP'];
const profileFields=['CUSTOMER_PROFILE_ID','CUSTOMER_ID','COUNTRY','SEGMENT','PREFERRED_CHANNEL'];
const accountFields=['ACCOUNT_ID','ACCOUNT_TYPE','CURRENCY','BALANCE','AVAILABLE_BALANCE','ACCOUNT_STATUS','OPENING_DATE'];
const transactionFields=['TRANSACTION_ID','ACCOUNT_ID','CARD_ID','TRANSACTION_TYPE','TRANSACTION_STAGE','TRANSACTION_STATUS','TRANSACTION_AMOUNT','CURRENCY','TRANSACTION_TIMESTAMP','CHANNEL'];
const maskAccount=value=>value?`••••${String(value).slice(-4)}`:undefined;
const activeRelationship=(r,now=Date.now())=>{const today=new Date(now).toISOString().slice(0,10),from=String(r.EFFECTIVE_FROM||'').slice(0,10),to=r.EFFECTIVE_TO?String(r.EFFECTIVE_TO).slice(0,10):null;return(!from||from<=today)&&(!to||to>=today);};
const safeProfile=x=>pick(x,profileFields);
const safeCase=(x,allowSubject=false)=>({...pick(x,['SERVICE_CASE_ID','CUSTOMER_PROFILE_ID','CASE_TYPE','PRIORITY','CASE_STATUS','OPENED_TIMESTAMP','RESOLVED_TIMESTAMP','ASSIGNED_TEAM']),...(allowSubject?pick(x,['CASE_SUBJECT']):{})});
const safeKyc=x=>pick(x,['KYC_RECORD_ID','CUSTOMER_ID','KYC_STATUS','RISK_RATING','LAST_REVIEW_DATE','NEXT_REVIEW_DATE']);
const safeCard=x=>pick(x,['CARD_ID','CUSTOMER_ID','ACCOUNT_ID','CARD_TYPE','CARD_NETWORK','MASKED_CARD_NUMBER','CARD_STATUS','ISSUE_DATE','EXPIRY_DATE']);
const safePayment=x=>pick(x,['PAYMENT_ID','CUSTOMER_ID','SOURCE_ACCOUNT_ID','PAYMENT_TYPE','PAYMENT_AMOUNT','CURRENCY','INITIATED_TIMESTAMP','PAYMENT_STATUS','CHANNEL']);

let bundleCache=null,bundleCacheAt=0,bundlePending=null;
async function rawSourceBundle(scope){
  if(bankingDataService.mode==='mongodb'&&scope&&!scope.all&&(scope.customerIds||[]).length===1)return bankingDataService.getBundle(scope);
  if(bundleCache&&Date.now()-bundleCacheAt<2000)return bundleCache;
  if(bundlePending)return bundlePending;
  bundlePending=bankingDataService.getBundle();
  try{bundleCache=await bundlePending;bundleCacheAt=Date.now();return bundleCache;}finally{bundlePending=null;}
}
function scopeBundle(b,scope){
  if(!scope||scope.all)return b;
  const ids=new Set((scope.customerIds||[]).map(String)),profiles=(b.CUSTOMER_PROFILE||[]).filter(x=>ids.has(String(x.CUSTOMER_ID))),profileIds=new Set(profiles.map(x=>x.CUSTOMER_PROFILE_ID));
  const relationships=(b.ACCOUNT_CUSTOMER_RELATIONSHIP||[]).filter(r=>activeRelationship(r)).filter(x=>ids.has(String(x.CUSTOMER_ID))),accountIds=new Set(relationships.map(x=>x.ACCOUNT_ID));
  const loans=(b.LOAN_ACCOUNT||[]).filter(x=>ids.has(String(x.CUSTOMER_ID))),loanIds=new Set(loans.map(x=>x.LOAN_ACCOUNT_ID));
  const byCustomer=key=>(b[key]||[]).filter(x=>ids.has(String(x.CUSTOMER_ID)));
  const byProfile=key=>(b[key]||[]).filter(x=>profileIds.has(x.CUSTOMER_PROFILE_ID));
  return{...b,CUSTOMER:(b.CUSTOMER||[]).filter(x=>ids.has(String(x.CUSTOMER_ID))),CUSTOMER_PROFILE:profiles,CUSTOMER_ADDRESS:byProfile('CUSTOMER_ADDRESS'),CUSTOMER_KYC:byCustomer('CUSTOMER_KYC'),CUSTOMER_SERVICE_CASE:byProfile('CUSTOMER_SERVICE_CASE'),CUSTOMER_INTERACTIONS:byProfile('CUSTOMER_INTERACTIONS'),CUSTOMER_OFFERS:byProfile('CUSTOMER_OFFERS'),CUSTOMER_PREFERENCE:byProfile('CUSTOMER_PREFERENCE'),CUSTOMER_CONSENT:byProfile('CUSTOMER_CONSENT'),CUSTOMER_CAMPAIGN_RESPONSE:byProfile('CUSTOMER_CAMPAIGN_RESPONSE'),ACCOUNT_CUSTOMER_RELATIONSHIP:relationships,BANK_ACCOUNT:(b.BANK_ACCOUNT||[]).filter(x=>accountIds.has(x.ACCOUNT_ID)),ACCOUNT_TRANSACTION:(b.ACCOUNT_TRANSACTION||[]).filter(x=>accountIds.has(x.ACCOUNT_ID)),CARD:byCustomer('CARD'),LOAN_ACCOUNT:loans,LOAN_REPAYMENT:(b.LOAN_REPAYMENT||[]).filter(x=>loanIds.has(x.LOAN_ACCOUNT_ID)),PAYMENT_BENEFICIARY:byCustomer('PAYMENT_BENEFICIARY'),PAYMENT_INSTRUCTION:byCustomer('PAYMENT_INSTRUCTION'),TERM_DEPOSIT:byCustomer('TERM_DEPOSIT')};
}
async function sourceBundle(scope){return scopeBundle(await rawSourceBundle(scope),scope);}
export const fraudIntelligenceService={
  getSourceBundle:sourceBundle,
  async getTransactions(scope){
    const b=await sourceBundle(scope),dashboard=await this.getDashboard({},scope),flagged=new Set(dashboard.alerts.flatMap(a=>a.evidence.map(x=>x.id)));
    const accounts=new Map(b.BANK_ACCOUNT.map(x=>[x.ACCOUNT_ID,x])),relations=new Map(),names=new Map((b.CUSTOMER||[]).map(x=>[String(x.CUSTOMER_ID),x.CUSTOMER_NAME]));
    for(const r of b.ACCOUNT_CUSTOMER_RELATIONSHIP.filter(x=>activeRelationship(x))){const list=relations.get(r.ACCOUNT_ID)||[];list.push(String(r.CUSTOMER_ID));relations.set(r.ACCOUNT_ID,list);}
    return{source:b.source||'API',transactions:b.ACCOUNT_TRANSACTION.map(tx=>({...pick(tx,transactionFields),ACCOUNT_NUMBER:maskAccount(accounts.get(tx.ACCOUNT_ID)?.ACCOUNT_NUMBER),CUSTOMER_IDS:relations.get(tx.ACCOUNT_ID)||[],CUSTOMER_NAMES:(relations.get(tx.ACCOUNT_ID)||[]).map(id=>names.get(id)).filter(Boolean),POTENTIAL_INDICATOR:flagged.has(tx.TRANSACTION_ID)}))};
  },
  async getCustomers(scope){
    const b=await sourceBundle(scope),dashboard=await this.getDashboard({},scope),relations=b.ACCOUNT_CUSTOMER_RELATIONSHIP.filter(r=>activeRelationship(r));
    return{source:b.source||'API',customers:(b.CUSTOMER||[]).map(raw=>{const customer=pick(raw,customerFields),profile=safeProfile((b.CUSTOMER_PROFILE||[]).find(x=>String(x.CUSTOMER_ID)===String(raw.CUSTOMER_ID))||{});return{...customer,...profile,alertCount:dashboard.alerts.filter(a=>a.customerIds.includes(String(raw.CUSTOMER_ID))&&!['CLOSED_NO_FRAUD','CONFIRMED_FRAUD'].includes(a.investigation.status)).length,accountCount:relations.filter(r=>String(r.CUSTOMER_ID)===String(raw.CUSTOMER_ID)).length};})};
  },
  async getCustomer(customerId,scope){
    const b=await sourceBundle(scope),dashboard=await this.getDashboard({},scope),raw=(b.CUSTOMER||[]).find(x=>String(x.CUSTOMER_ID)===String(customerId));
    if(!raw)throw new HttpError(404,'Customer not found','NOT_FOUND');
    const rel=b.ACCOUNT_CUSTOMER_RELATIONSHIP.filter(r=>activeRelationship(r)).filter(x=>String(x.CUSTOMER_ID)===String(customerId));
    const accountIds=new Set(rel.map(x=>x.ACCOUNT_ID)),profile=(b.CUSTOMER_PROFILE||[]).find(x=>String(x.CUSTOMER_ID)===String(customerId)),profileId=profile?.CUSTOMER_PROFILE_ID;
    const loans=(b.LOAN_ACCOUNT||[]).filter(x=>String(x.CUSTOMER_ID)===String(customerId)),loanIds=new Set(loans.map(x=>x.LOAN_ACCOUNT_ID));
    const cases=(b.CUSTOMER_SERVICE_CASE||[]).filter(x=>profileId&&x.CUSTOMER_PROFILE_ID===profileId);
    const accounts=(b.BANK_ACCOUNT||[]).filter(x=>accountIds.has(x.ACCOUNT_ID)).map(x=>({...pick(x,accountFields),ACCOUNT_NUMBER:maskAccount(x.ACCOUNT_NUMBER)}));
    return{source:b.source||'API',customer:pick(raw,customerFields),profile:safeProfile(profile||{}),accounts,transactions:b.ACCOUNT_TRANSACTION.filter(x=>accountIds.has(x.ACCOUNT_ID)).map(x=>pick(x,transactionFields)),cards:(b.CARD||[]).filter(x=>String(x.CUSTOMER_ID)===String(customerId)).map(safeCard),loans:loans.map(x=>pick(x,['LOAN_ACCOUNT_ID','CUSTOMER_ID','LOAN_TYPE','LOAN_AMOUNT','OUTSTANDING_BALANCE','CURRENCY','INTEREST_RATE','START_DATE','MATURITY_DATE','NEXT_DUE_DATE','LOAN_STATUS'])),repayments:(b.LOAN_REPAYMENT||[]).filter(x=>loanIds.has(x.LOAN_ACCOUNT_ID)).map(x=>pick(x,['REPAYMENT_ID','LOAN_ACCOUNT_ID','DUE_DATE','DUE_AMOUNT','PAID_AMOUNT','PAYMENT_DATE','REPAYMENT_STATUS'])),payments:(b.PAYMENT_INSTRUCTION||[]).filter(x=>String(x.CUSTOMER_ID)===String(customerId)).map(safePayment),kyc:(b.CUSTOMER_KYC||[]).filter(x=>String(x.CUSTOMER_ID)===String(customerId)).map(safeKyc),serviceCases:cases.map(x=>safeCase(x,scope?.sensitiveFields)),interactions:(b.CUSTOMER_INTERACTIONS||[]).filter(x=>profileId&&x.CUSTOMER_PROFILE_ID===profileId).map(x=>pick(x,['CUSTOMER_INTERACTION_ID','CUSTOMER_PROFILE_ID','INTERACTION_TIMESTAMP','INTERACTION_TYPE','CHANNEL','SERVICE_CASE_ID'])),consent:(b.CUSTOMER_CONSENT||[]).filter(x=>profileId&&x.CUSTOMER_PROFILE_ID===profileId).map(x=>pick(x,['CONSENT_ID','CUSTOMER_PROFILE_ID','CONSENT_TYPE','CONSENT_STATUS','CAPTURED_TIMESTAMP','SOURCE_CHANNEL'])),preferences:(b.CUSTOMER_PREFERENCE||[]).filter(x=>profileId&&x.CUSTOMER_PROFILE_ID===profileId).map(x=>pick(x,['CUSTOMER_PREFERENCE_ID','CUSTOMER_PROFILE_ID','PREFERRED_LANGUAGE','STATEMENT_DELIVERY','NOTIFICATION_CHANNEL','DO_NOT_CONTACT'])),alerts:dashboard.alerts.filter(x=>x.customerIds.includes(String(customerId))) };
  },
  async getProductContext(scope){const b=await sourceBundle(scope);return{source:b.source||'API',loans:(b.LOAN_ACCOUNT||[]).map(x=>pick(x,['LOAN_ACCOUNT_ID','CUSTOMER_ID','LOAN_TYPE','LOAN_AMOUNT','OUTSTANDING_BALANCE','CURRENCY','NEXT_DUE_DATE','LOAN_STATUS'])),repayments:(b.LOAN_REPAYMENT||[]).map(x=>pick(x,['REPAYMENT_ID','LOAN_ACCOUNT_ID','DUE_DATE','DUE_AMOUNT','PAID_AMOUNT','PAYMENT_DATE','REPAYMENT_STATUS'])),cards:(b.CARD||[]).map(safeCard),termDeposits:(b.TERM_DEPOSIT||[]).map(x=>pick(x,['TERM_DEPOSIT_ID','CUSTOMER_ID','PRINCIPAL_AMOUNT','CURRENCY','INTEREST_RATE','OPEN_DATE','MATURITY_DATE','DEPOSIT_STATUS'])),payments:(b.PAYMENT_INSTRUCTION||[]).map(safePayment)};
  },
  async getOperationsContext(scope){const b=await sourceBundle(scope);return{source:b.source||'API',cases:(b.CUSTOMER_SERVICE_CASE||[]).map(x=>safeCase(x,scope?.sensitiveFields)),kyc:(b.CUSTOMER_KYC||[]).map(safeKyc),interactions:(b.CUSTOMER_INTERACTIONS||[]).map(x=>pick(x,['CUSTOMER_INTERACTION_ID','CUSTOMER_PROFILE_ID','INTERACTION_TIMESTAMP','INTERACTION_TYPE','CHANNEL','SERVICE_CASE_ID'])),offers:(b.CUSTOMER_OFFERS||[]).map(x=>pick(x,['PRODUCT_OFFER_ID','CUSTOMER_PROFILE_ID','PRODUCT_CODE','OFFER_TYPE','OFFER_STATUS','OFFER_DATE','EXPIRY_DATE'])),campaignResponses:(b.CUSTOMER_CAMPAIGN_RESPONSE||[]).map(x=>pick(x,['CAMPAIGN_RESPONSE_ID','CUSTOMER_PROFILE_ID','CAMPAIGN_CODE','RESPONSE_STATUS','SENT_TIMESTAMP','RESPONSE_TIMESTAMP','CHANNEL'])),consent:(b.CUSTOMER_CONSENT||[]).map(x=>pick(x,['CONSENT_ID','CUSTOMER_PROFILE_ID','CONSENT_TYPE','CONSENT_STATUS','CAPTURED_TIMESTAMP','SOURCE_CHANNEL'])),preferences:(b.CUSTOMER_PREFERENCE||[]).map(x=>pick(x,['CUSTOMER_PREFERENCE_ID','CUSTOMER_PROFILE_ID','PREFERRED_LANGUAGE','STATEMENT_DELIVERY','NOTIFICATION_CHANNEL','DO_NOT_CONTACT']))};
  },
  async getDashboard(filters={},scope){
    const b=await sourceBundle(scope),result=analyzeTransactions(b),investigations=await fraudInvestigationRepository.list(),im=new Map(investigations.map(x=>[x.alertId,x]));
    let alerts=result.alerts.map(a=>({...a,investigation:im.get(a.alertId)||{status:'NEW',assignedTo:null,audit:[]}}));
    if(filters.riskLevel)alerts=alerts.filter(a=>a.riskLevel===filters.riskLevel);
    if(filters.status)alerts=alerts.filter(a=>a.investigation.status===filters.status);
    if(filters.customerId)alerts=alerts.filter(a=>a.customerIds.includes(String(filters.customerId)));
    if(filters.query){const q=String(filters.query).toLowerCase();alerts=alerts.filter(a=>[a.title,a.accountId,...a.customerNames,...a.customerIds,...a.transactionReferences.map(x=>x.id)].some(x=>String(x||'').toLowerCase().includes(q)));}
    const all=result.alerts,transactions=new Map();for(const a of all)for(const t of a.evidence)transactions.set(`${t.id}|${t.currency}`,t);
    const flaggedValueScaled={};for(const t of transactions.values()){const amount=toScaledDecimal(t.amount);if(amount===null)continue;const absolute=amount<0n?-amount:amount;flaggedValueScaled[t.currency]=(flaggedValueScaled[t.currency]||0n)+absolute;}
    const flaggedValueByCurrency=Object.fromEntries(Object.entries(flaggedValueScaled).map(([currency,value])=>[currency,fromScaledDecimal(value)]));
    const open=all.filter(a=>!['CLOSED_NO_FRAUD','CONFIRMED_FRAUD'].includes(im.get(a.alertId)?.status));
    const highRiskCustomers=[...new Set(open.filter(a=>a.riskLevel==='HIGH').flatMap(a=>a.customerIds))].map(customerId=>{const matches=open.filter(a=>a.customerIds.includes(customerId));const first=matches[0],name=first?.customerNames[first.customerIds.indexOf(customerId)]||customerId;return{customerId,name,alertCount:matches.length};});
    return{source:result.source,generatedAt:result.generatedAt,mode:bankingDataService.mode,methodology:'Unvalidated heuristic indicators. Potential fraud only; a human investigator must determine the outcome.',analyzedTransactions:result.analyzedTransactions,excludedTransactions:result.excludedTransactions,summary:{suspiciousAlertCount:all.length,openInvestigations:all.filter(a=>!['CLOSED_NO_FRAUD','CONFIRMED_FRAUD'].includes(im.get(a.alertId)?.status)).length,highRiskAlertCount:all.filter(a=>a.riskLevel==='HIGH').length,mediumRiskAlertCount:all.filter(a=>a.riskLevel==='MEDIUM').length,flaggedTransactionCount:transactions.size,flaggedValueByCurrency,highRiskCustomers},alerts};
  },
  async getAlert(alertId,scope){const d=await this.getDashboard({},scope);const a=d.alerts.find(x=>x.alertId===alertId);if(!a)throw new HttpError(404,'Fraud alert not found','NOT_FOUND');return a;},
  async getChatContext({customerId,alertId,message},scope){
    if(typeof message!=='string'||!message.trim()||message.length>5000)throw new HttpError(400,'message is required and must be under 5000 characters','VALIDATION_ERROR');
    const d=await this.getDashboard({},scope);let alerts=d.alerts;if(customerId)alerts=alerts.filter(a=>a.customerIds.includes(String(customerId)));if(alertId)alerts=alerts.filter(a=>a.alertId===alertId);
    return{message:message.trim(),source:d.source,customerId:customerId||null,summary:d.summary,alerts:alerts.slice(0,20)};
  }
};
