import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';
import { mongoDatabase } from './client.js';

const tables=['CUSTOMER','BANK_BRANCH','BANK_ACCOUNT','ACCOUNT_CUSTOMER_RELATIONSHIP','ACCOUNT_TRANSACTION','CARD','LOAN_ACCOUNT','LOAN_REPAYMENT','PAYMENT_BENEFICIARY','PAYMENT_INSTRUCTION','TERM_DEPOSIT','CUSTOMER_PROFILE','CUSTOMER_ADDRESS','CUSTOMER_KYC','CUSTOMER_INTERACTIONS','CUSTOMER_SERVICE_CASE','CUSTOMER_OFFERS','CUSTOMER_PREFERENCE','CUSTOMER_CONSENT','CUSTOMER_CAMPAIGN_RESPONSE'];
const jsonSafe=value=>{if(Array.isArray(value))return value.map(jsonSafe);if(value&&typeof value==='object'){if(['Long','Decimal128','ObjectId'].includes(value._bsontype))return String(value);if(value instanceof Date)return value.toISOString();return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='_id').map(([key,item])=>[key,jsonSafe(item)]));}return value;};
export const mongoBankingRepository={
  async getBundle(){
    let map;try{map=JSON.parse(env.mongoCollectionMap||'{}');}catch{throw new HttpError(500,'MONGODB_COLLECTION_MAP must be valid JSON','CONFIGURATION_ERROR');}
    const configured=tables.filter(table=>typeof map[table]==='string'&&map[table].trim());
    if(!configured.length)throw new HttpError(503,'Configure MONGODB_COLLECTION_MAP with collection names verified against the deployed schema','MONGODB_SCHEMA_NOT_CONFIGURED');
    const db=await mongoDatabase(),bundle={source:'MONGODB_INTEGRATED_DATA',generatedAt:null,retrievedAt:new Date().toISOString()};
    for(const table of configured){const name=map[table];if(!/^[A-Za-z0-9_.-]{1,120}$/.test(name))throw new HttpError(500,`Invalid collection mapping for ${table}`,'CONFIGURATION_ERROR');bundle[table]=(await db.collection(name).find({}).limit(env.mongoReadLimit).toArray()).map(jsonSafe);}
    for(const table of ['ACCOUNT_TRANSACTION','BANK_ACCOUNT','ACCOUNT_CUSTOMER_RELATIONSHIP'])if(!Array.isArray(bundle[table]))throw new HttpError(503,`MongoDB mapping is missing required ${table} collection`,'MONGODB_SCHEMA_INCOMPLETE');
    return bundle;
  },
  async getCustomerBundle(customerId){
    let map;try{map=JSON.parse(env.mongoCollectionMap||'{}');}catch{throw new HttpError(500,'MONGODB_COLLECTION_MAP must be valid JSON','CONFIGURATION_ERROR');}
    const db=await mongoDatabase();let Long;try{({Long}=await import('mongodb'));}catch{throw new HttpError(503,'MongoDB driver is unavailable','MONGODB_UNAVAILABLE');}
    const values=[String(customerId)];if(/^\d+$/.test(String(customerId)))values.push(Long.fromString(String(customerId)));
    const bundle={source:'MONGODB_INTEGRATED_DATA',generatedAt:null,retrievedAt:new Date().toISOString()},find=async(table,query)=>{const name=map[table];if(typeof name!=='string'||!name.trim())return[];if(!/^[A-Za-z0-9_.-]{1,120}$/.test(name))throw new HttpError(500,`Invalid collection mapping for ${table}`,'CONFIGURATION_ERROR');return(await db.collection(name).find(query).limit(env.mongoReadLimit).toArray()).map(jsonSafe);};
    for(const table of ['CUSTOMER','CUSTOMER_PROFILE','ACCOUNT_CUSTOMER_RELATIONSHIP','CUSTOMER_KYC','CARD','LOAN_ACCOUNT','PAYMENT_BENEFICIARY','PAYMENT_INSTRUCTION','TERM_DEPOSIT'])bundle[table]=await find(table,{CUSTOMER_ID:{$in:values}});
    bundle.CUSTOMER_ADDRESS=await find('CUSTOMER_ADDRESS',{CUSTOMER_PROFILE_ID:{$in:bundle.CUSTOMER_PROFILE.map(x=>x.CUSTOMER_PROFILE_ID)}});
    bundle.CUSTOMER_SERVICE_CASE=await find('CUSTOMER_SERVICE_CASE',{CUSTOMER_PROFILE_ID:{$in:bundle.CUSTOMER_PROFILE.map(x=>x.CUSTOMER_PROFILE_ID)}});
    for(const table of ['CUSTOMER_INTERACTIONS','CUSTOMER_OFFERS','CUSTOMER_PREFERENCE','CUSTOMER_CONSENT','CUSTOMER_CAMPAIGN_RESPONSE'])bundle[table]=await find(table,{CUSTOMER_PROFILE_ID:{$in:bundle.CUSTOMER_PROFILE.map(x=>x.CUSTOMER_PROFILE_ID)}});
    const accountIds=[...new Set(bundle.ACCOUNT_CUSTOMER_RELATIONSHIP.map(x=>x.ACCOUNT_ID))],loanIds=bundle.LOAN_ACCOUNT.map(x=>x.LOAN_ACCOUNT_ID);
    bundle.BANK_ACCOUNT=await find('BANK_ACCOUNT',{ACCOUNT_ID:{$in:accountIds}});bundle.ACCOUNT_TRANSACTION=await find('ACCOUNT_TRANSACTION',{ACCOUNT_ID:{$in:accountIds}});bundle.LOAN_REPAYMENT=await find('LOAN_REPAYMENT',{LOAN_ACCOUNT_ID:{$in:loanIds}});
    for(const table of ['BANK_BRANCH'])bundle[table]=await find(table,{});
    if(!Array.isArray(bundle.ACCOUNT_TRANSACTION)||!Array.isArray(bundle.BANK_ACCOUNT)||!Array.isArray(bundle.ACCOUNT_CUSTOMER_RELATIONSHIP))throw new HttpError(503,'MongoDB feed lacks the required account or transaction collections','MONGODB_SCHEMA_INCOMPLETE');return bundle;
  }
};
