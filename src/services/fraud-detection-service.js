import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';
import { toScaledDecimal,fromScaledDecimal,decimalMedian,multiplierScaled,DECIMAL_SCALE } from '../utils/decimal.js';

const dateValue = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };
const recordRef = tx => ({ table: 'BANKCORE.ACCOUNT_TRANSACTION', id: tx.TRANSACTION_ID, timestamp: tx.TRANSACTION_TIMESTAMP });
const select = (row, fields) => Object.fromEntries(fields.filter(field => row?.[field] !== undefined).map(field => [field, row[field]]));
const maskAccount = value => value ? `••••${String(value).slice(-4)}` : undefined;

export function analyzeTransactions(bundle, { now = Date.now() } = {}) {
  if (!bundle || !Array.isArray(bundle.ACCOUNT_TRANSACTION) || !Array.isArray(bundle.BANK_ACCOUNT) || !Array.isArray(bundle.ACCOUNT_CUSTOMER_RELATIONSHIP)) {
    throw new HttpError(422, 'Fraud feed must include ACCOUNT_TRANSACTION, BANK_ACCOUNT and ACCOUNT_CUSTOMER_RELATIONSHIP records from the approved API mapping', 'INVALID_FRAUD_FEED');
  }
  const accounts = new Map(bundle.BANK_ACCOUNT.map(x => [x.ACCOUNT_ID, x]));
  const customers = new Map((bundle.CUSTOMER || []).map(x => [String(x.CUSTOMER_ID), x]));
  const profiles = new Map((bundle.CUSTOMER_PROFILE || []).map(x => [String(x.CUSTOMER_ID), x]));
  const cards = new Map((bundle.CARD || []).map(x => [x.CARD_ID, x]));
  const customerAccounts = new Map();
  const effectiveDate= new Date(now).toISOString().slice(0,10);
  for (const rel of bundle.ACCOUNT_CUSTOMER_RELATIONSHIP) {
    if (!rel.ACCOUNT_ID || rel.CUSTOMER_ID == null) continue;
    const from=String(rel.EFFECTIVE_FROM||'').slice(0,10),to=rel.EFFECTIVE_TO?String(rel.EFFECTIVE_TO).slice(0,10):null;
    if(from&&from>effectiveDate||to&&to<effectiveDate)continue;
    const list = customerAccounts.get(rel.ACCOUNT_ID) || []; list.push(String(rel.CUSTOMER_ID)); customerAccounts.set(rel.ACCOUNT_ID, list);
  }
  const reversedTransactionIds=new Set(bundle.ACCOUNT_TRANSACTION.filter(tx=>tx.TRANSACTION_STAGE==='REVERSAL'||tx.TRANSACTION_STATUS==='REVERSED').map(tx=>tx.RELATED_TRANSACTION_ID).filter(Boolean));
  const valid = [];
  for (const tx of bundle.ACCOUNT_TRANSACTION) {
    if (!tx.TRANSACTION_ID || !accounts.has(tx.ACCOUNT_ID) || !dateValue(tx.TRANSACTION_TIMESTAMP) || toScaledDecimal(tx.TRANSACTION_AMOUNT) === null || !/^[A-Z]{3}$/.test(tx.CURRENCY||'') || typeof tx.TRANSACTION_TYPE!=='string') continue;
    // Only completed posted records enter financial amount and velocity analysis.
    if (tx.TRANSACTION_STAGE !== 'POSTED' || tx.TRANSACTION_STATUS !== 'COMPLETED') continue;
    if (reversedTransactionIds.has(tx.TRANSACTION_ID)) continue;
    valid.push(tx);
  }
  const byAccountCurrency = new Map();
  for (const tx of valid) { const key = `${tx.ACCOUNT_ID}|${tx.CURRENCY}`; const a=byAccountCurrency.get(key)||[]; a.push(tx); byAccountCurrency.set(key,a); }
  const alerts=[];
  const addAlert = ({ rule, severity, title, explanation, transactions, metrics, accountId, currency }) => {
    const refs=transactions.map(recordRef); const customerIds=[...new Set(transactions.flatMap(t=>customerAccounts.get(t.ACCOUNT_ID)||[]))];
    const id=`${rule.toLowerCase()}-${crypto.createHash('sha256').update(`${accountId}|${currency}|${refs.map(x=>x.id).sort().join(',')}`).digest('hex').slice(0,16)}`;
    const acc=accounts.get(accountId), customerProfiles=customerIds.map(cid=>profiles.get(cid)).filter(Boolean), profileIds=new Set(customerProfiles.map(x=>x.CUSTOMER_PROFILE_ID));
    const loans=(bundle.LOAN_ACCOUNT||[]).filter(l=>customerIds.includes(String(l.CUSTOMER_ID))), loanIds=new Set(loans.map(x=>x.LOAN_ACCOUNT_ID));
    const sameAccountPayments=(bundle.PAYMENT_INSTRUCTION||[]).filter(p=>customerIds.includes(String(p.CUSTOMER_ID))&&String(p.SOURCE_ACCOUNT_ID)===String(accountId));const beneficiaryIds=new Set(sameAccountPayments.map(p=>String(p.BENEFICIARY_ID||'')).filter(Boolean));const relatedBeneficiaries=(bundle.PAYMENT_BENEFICIARY||[]).filter(p=>beneficiaryIds.has(String(p.BENEFICIARY_ID))).map(p=>select(p,['BENEFICIARY_ID','CUSTOMER_ID','BENEFICIARY_STATUS']));const highKycRecords=(bundle.CUSTOMER_KYC||[]).filter(k=>customerIds.includes(String(k.CUSTOMER_ID))&&k.RISK_RATING==='HIGH').map(k=>select(k,['KYC_RECORD_ID','CUSTOMER_ID','KYC_STATUS','RISK_RATING','LAST_REVIEW_DATE','NEXT_REVIEW_DATE']));const correlatedContext={activeCustomerRelationships:customerAccounts.get(accountId)||[],highKycRatingRecords:highKycRecords,sameAccountPaymentInstructions:sameAccountPayments.map(p=>select(p,['PAYMENT_ID','CUSTOMER_ID','SOURCE_ACCOUNT_ID','BENEFICIARY_ID','PAYMENT_TYPE','PAYMENT_AMOUNT','CURRENCY','INITIATED_TIMESTAMP','PAYMENT_STATUS'])),relatedBeneficiaries,interpretation:'Related product, payment, ownership, or KYC records are context for human review only. They do not independently confirm fraud or change rule severity.'};
    alerts.push({ alertId:id, ruleCode:rule, riskLevel:severity, title, explanation, customerIds, customerNames:customerIds.map(cid=>customers.get(cid)?.CUSTOMER_NAME||cid), accountId, maskedAccountReference:maskAccount(acc?.ACCOUNT_NUMBER), currency, transactionReferences:refs, metrics, correlatedContext, evidence:transactions.map(t=>({ ...recordRef(t), type:t.TRANSACTION_TYPE, stage:t.TRANSACTION_STAGE, status:t.TRANSACTION_STATUS, amount:t.TRANSACTION_AMOUNT, currency:t.CURRENCY, channel:t.CHANNEL, cardId:t.CARD_ID, cardStatus:cards.get(t.CARD_ID)?.CARD_STATUS })), context:{ customerProfiles:customerProfiles.map(x=>select(x,['CUSTOMER_PROFILE_ID','CUSTOMER_ID','SEGMENT','COUNTRY','PREFERRED_CHANNEL'])), loans:loans.map(x=>select(x,['LOAN_ACCOUNT_ID','CUSTOMER_ID','LOAN_TYPE','OUTSTANDING_BALANCE','CURRENCY','NEXT_DUE_DATE','LOAN_STATUS'])), repayments:(bundle.LOAN_REPAYMENT||[]).filter(r=>loanIds.has(r.LOAN_ACCOUNT_ID)).map(x=>select(x,['REPAYMENT_ID','LOAN_ACCOUNT_ID','DUE_DATE','DUE_AMOUNT','PAID_AMOUNT','PAYMENT_DATE','REPAYMENT_STATUS'])), cards:(bundle.CARD||[]).filter(c=>customerIds.includes(String(c.CUSTOMER_ID))).map(x=>select(x,['CARD_ID','CUSTOMER_ID','ACCOUNT_ID','CARD_TYPE','CARD_NETWORK','MASKED_CARD_NUMBER','CARD_STATUS','EXPIRY_DATE'])), payments:(bundle.PAYMENT_INSTRUCTION||[]).filter(p=>customerIds.includes(String(p.CUSTOMER_ID))).map(x=>select(x,['PAYMENT_ID','CUSTOMER_ID','SOURCE_ACCOUNT_ID','PAYMENT_TYPE','PAYMENT_AMOUNT','CURRENCY','INITIATED_TIMESTAMP','PAYMENT_STATUS','CHANNEL'])), kyc:(bundle.CUSTOMER_KYC||[]).filter(k=>customerIds.includes(String(k.CUSTOMER_ID))).map(x=>select(x,['KYC_RECORD_ID','CUSTOMER_ID','KYC_STATUS','RISK_RATING','LAST_REVIEW_DATE','NEXT_REVIEW_DATE'])), serviceCases:(bundle.CUSTOMER_SERVICE_CASE||[]).filter(c=>profileIds.has(c.CUSTOMER_PROFILE_ID)).map(x=>select(x,['SERVICE_CASE_ID','CUSTOMER_PROFILE_ID','CASE_TYPE','PRIORITY','CASE_STATUS','OPENED_TIMESTAMP','RESOLVED_TIMESTAMP','ASSIGNED_TEAM'])) } });
  };
  const windowMs=env.velocityWindowMinutes*60_000;
  for (const [key, txs] of byAccountCurrency) {
    txs.sort((a,b)=>dateValue(a.TRANSACTION_TIMESTAMP)-dateValue(b.TRANSACTION_TIMESTAMP));
    const [accountId,currency]=key.split('|');
    let burst=[];
    for(let end=0;end<txs.length;end++){
      let start=end;while(start>0&&dateValue(txs[end].TRANSACTION_TIMESTAMP)-dateValue(txs[start-1].TRANSACTION_TIMESTAMP)<=windowMs)start--;
      const sample=txs.slice(start,end+1);
      if(sample.length>=env.velocityTransactionCount){burst=sample;break;}
    }
    if(burst.length>=env.velocityTransactionCount){
      const minutes=(dateValue(burst.at(-1).TRANSACTION_TIMESTAMP)-dateValue(burst[0].TRANSACTION_TIMESTAMP))/60000;
      addAlert({rule:'RAPID_POSTED_ACTIVITY',severity:'HIGH',title:'Rapid posted transaction activity',explanation:`${burst.length} completed, posted transactions occurred on the same account within ${minutes.toFixed(1)} minutes. This threshold is a review heuristic, not a fraud finding.`,transactions:burst,metrics:{transactionCount:burst.length,windowMinutes:Number(minutes.toFixed(2)),configuredThreshold:env.velocityTransactionCount},accountId,currency});
    }
    const recentCutoff=now-24*60*60*1000;
    const types=new Set(txs.map(t=>t.TRANSACTION_TYPE));
    for(const transactionType of types){
      const sameType=txs.filter(t=>t.TRANSACTION_TYPE===transactionType);
      const historical=sameType.filter(t=>dateValue(t.TRANSACTION_TIMESTAMP)<recentCutoff).map(t=>{const n=toScaledDecimal(t.TRANSACTION_AMOUNT);return n<0n?-n:n;});
      if(historical.length<4)continue;
      const base=decimalMedian(historical),multiplier=multiplierScaled(env.amountOutlierMultiplier),outliers=sameType.filter(t=>{if(dateValue(t.TRANSACTION_TIMESTAMP)<recentCutoff)return false;const n=toScaledDecimal(t.TRANSACTION_AMOUNT),abs=n<0n?-n:n;return abs*DECIMAL_SCALE>base*multiplier;});
      if(base>0n&&outliers.length){
        const max=outliers.map(t=>{const n=toScaledDecimal(t.TRANSACTION_AMOUNT);return n<0n?-n:n;}).reduce((a,b)=>a>b?a:b);
        addAlert({rule:'ACCOUNT_AMOUNT_OUTLIER',severity:max*DECIMAL_SCALE>base*5n*DECIMAL_SCALE?'HIGH':'MEDIUM',title:'Transaction amount differs from account history',explanation:`${outliers.length} ${transactionType} transaction(s) exceed ${env.amountOutlierMultiplier}× the account’s historical median for the same transaction type (${fromScaledDecimal(base)} ${currency}). This is not a fraud finding.`,transactions:outliers,metrics:{transactionType,historicalTransactionCount:historical.length,historicalMedianAmount:fromScaledDecimal(base),largestObservedAmount:fromScaledDecimal(max),configuredMultiplier:env.amountOutlierMultiplier},accountId,currency});
      }
    }
  }
  // Rejected authorization events and reversal records are screened as
  // operational signals, but never included in posted financial totals.
  const failureWindowMs=env.repeatedFailureWindowHours*60*60_000;
  const failureGroups=new Map();
  for(const tx of bundle.ACCOUNT_TRANSACTION){
    if(!tx.TRANSACTION_ID||!accounts.has(tx.ACCOUNT_ID)||!dateValue(tx.TRANSACTION_TIMESTAMP)||! /^[A-Z]{3}$/.test(tx.CURRENCY||''))continue;
    const isRejected=tx.TRANSACTION_STATUS==='REJECTED';
    const isReversal=tx.TRANSACTION_STAGE==='REVERSAL'||tx.TRANSACTION_STATUS==='REVERSED';
    if(!isRejected&&!isReversal)continue;
    if(dateValue(tx.TRANSACTION_TIMESTAMP)<now-failureWindowMs)continue;
    const category=isRejected?'REPEATED_REJECTED_ACTIVITY':'REPEATED_REVERSALS';
    const key=`${tx.ACCOUNT_ID}|${tx.CURRENCY}|${category}`;
    const rows=failureGroups.get(key)||[];rows.push(tx);failureGroups.set(key,rows);
  }
  for(const [key,rows] of failureGroups){
    if(rows.length<env.repeatedFailureCount)continue;
    rows.sort((a,b)=>dateValue(a.TRANSACTION_TIMESTAMP)-dateValue(b.TRANSACTION_TIMESTAMP));
    const [accountId,currency,category]=key.split('|');
    const isRejected=category==='REPEATED_REJECTED_ACTIVITY';
    const level=rows.length>=env.repeatedFailureCount*2?'HIGH':'MEDIUM';
    addAlert({rule:category,severity:level,title:isRejected?'Repeated rejected transaction attempts':'Repeated transaction reversals',explanation:`${rows.length} ${isRejected?'rejected':'reversed'} transaction records were returned for this account in the last ${env.repeatedFailureWindowHours} hours. Review the linked records and account context; this pattern is a triage signal and does not establish fraud.`,transactions:rows,metrics:{eventCount:rows.length,windowHours:env.repeatedFailureWindowHours,configuredThreshold:env.repeatedFailureCount,eventStatus:isRejected?'REJECTED':'REVERSAL_OR_REVERSED'},accountId,currency});
  }
  // Repeated cash withdrawals are separated from the general velocity rule so
  // investigators can see the pattern category directly. Only posted,
  // completed records are considered, with reversals already removed above.
  for(const [key,txs] of byAccountCurrency){
    const withdrawals=txs.filter(tx=>tx.TRANSACTION_TYPE==='WITHDRAWAL'&&dateValue(tx.TRANSACTION_TIMESTAMP)>=now-24*60*60_000).sort((a,b)=>dateValue(a.TRANSACTION_TIMESTAMP)-dateValue(b.TRANSACTION_TIMESTAMP));
    if(withdrawals.length<env.velocityTransactionCount)continue;
    const [accountId,currency]=key.split('|');
    addAlert({rule:'REPEATED_WITHDRAWALS',severity:withdrawals.length>=env.velocityTransactionCount*2?'HIGH':'MEDIUM',title:'Repeated posted withdrawals',explanation:`${withdrawals.length} completed, posted withdrawals were returned for this account in the last 24 hours. Review customer history and related activity; this threshold is a review heuristic, not a fraud finding.`,transactions:withdrawals,metrics:{transactionCount:withdrawals.length,windowHours:24,configuredThreshold:env.velocityTransactionCount},accountId,currency});
  }
  return { source:bundle.source||'API', generatedAt:new Date(now).toISOString(), analyzedTransactions:valid.length, excludedTransactions:bundle.ACCOUNT_TRANSACTION.length-valid.length, alerts:alerts.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.riskLevel]-({HIGH:0,MEDIUM:1,LOW:2}[b.riskLevel]))||b.evidence.length-a.evidence.length) };
}
