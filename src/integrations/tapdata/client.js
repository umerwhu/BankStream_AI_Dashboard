import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';

const sourceTables=['CUSTOMER','BANK_BRANCH','BANK_ACCOUNT','ACCOUNT_CUSTOMER_RELATIONSHIP','ACCOUNT_TRANSACTION','CARD','LOAN_ACCOUNT','LOAN_REPAYMENT','PAYMENT_BENEFICIARY','PAYMENT_INSTRUCTION','TERM_DEPOSIT','CUSTOMER_PROFILE','CUSTOMER_ADDRESS','CUSTOMER_KYC','CUSTOMER_INTERACTIONS','CUSTOMER_SERVICE_CASE','CUSTOMER_OFFERS','CUSTOMER_PREFERENCE','CUSTOMER_CONSENT','CUSTOMER_CAMPAIGN_RESPONSE'];
// Published services confirmed in the configured TapData workspace. The
// Customer 360 service supplies nested core banking entities not published as
// stand-alone routes in that workspace.
const publishedTables=['LOAN_ACCOUNT','LOAN_REPAYMENT','PAYMENT_BENEFICIARY','PAYMENT_INSTRUCTION','TERM_DEPOSIT','CUSTOMER_KYC','CUSTOMER_INTERACTIONS','CUSTOMER_SERVICE_CASE','CUSTOMER_OFFERS','CUSTOMER_PREFERENCE','CUSTOMER_CONSENT','CUSTOMER_CAMPAIGN_RESPONSE'];
const compositeTables=['BANK_BRANCH','BANK_ACCOUNT','ACCOUNT_CUSTOMER_RELATIONSHIP','ACCOUNT_TRANSACTION','CARD','CUSTOMER_PROFILE','CUSTOMER_ADDRESS'];
let tokenCache;

function collectionMap(){
  if(!env.tapdataCollectionMap)return Object.fromEntries(sourceTables.map(name=>[name,name]));
  let parsed;try{parsed=JSON.parse(env.tapdataCollectionMap);}catch{throw new HttpError(500,'TAPDATA_COLLECTION_MAP must be valid JSON','CONFIGURATION_ERROR');}
  const map={};for(const table of sourceTables){const value=parsed[table]??parsed[table.toLowerCase()]??table;if(typeof value!=='string'||! /^[A-Za-z0-9_.-]{1,120}$/.test(value))throw new HttpError(500,`Invalid TapData published API name for ${table}`,'CONFIGURATION_ERROR');map[table]=value;}
  return map;
}

async function accessToken(){
  if(env.tapdataAccessToken)return env.tapdataAccessToken;
  if(!env.tapdataTokenUrl)return '';
  if(!env.tapdataClientId||!env.tapdataClientSecret)throw new HttpError(503,'TapData OAuth client credentials are incomplete','TAPDATA_AUTH_NOT_CONFIGURED');
  if(tokenCache&&tokenCache.expiresAt>Date.now()+30_000)return tokenCache.value;
  const form=new URLSearchParams({grant_type:'client_credentials',client_id:env.tapdataClientId,client_secret:env.tapdataClientSecret});
  const headers={'Content-Type':'application/x-www-form-urlencoded'};
  if(env.tapdataTokenAuthMethod==='client_secret_basic'){headers.Authorization=`Basic ${Buffer.from(`${env.tapdataClientId}:${env.tapdataClientSecret}`).toString('base64')}`;form.delete('client_id');form.delete('client_secret');}
  else if(env.tapdataTokenAuthMethod!=='client_secret_post')throw new HttpError(500,'TAPDATA_TOKEN_AUTH_METHOD must be client_secret_post or client_secret_basic','CONFIGURATION_ERROR');
  let response;try{response=await fetch(env.tapdataTokenUrl,{method:'POST',headers,body:form,signal:AbortSignal.timeout(env.tapdataRequestTimeoutMs)});}catch{throw new HttpError(502,'TapData authorization service is unavailable','TAPDATA_AUTH_UNAVAILABLE');}
  if(!response.ok)throw new HttpError(502,'TapData authorization failed','TAPDATA_AUTH_FAILED');
  let body;try{body=await response.json();}catch{throw new HttpError(502,'TapData authorization returned invalid JSON','TAPDATA_AUTH_FAILED');}
  if(typeof body.access_token!=='string'||!body.access_token)throw new HttpError(502,'TapData authorization response did not include an access token','TAPDATA_AUTH_FAILED');
  tokenCache={value:body.access_token,expiresAt:Date.now()+(Number(body.expires_in)||300)*1000};return tokenCache.value;
}

function rowsFrom(payload){
  if(Array.isArray(payload))return payload;
  if(!payload||typeof payload!=='object')return null;
  for(const key of ['items','records','rows','results','list'])if(Array.isArray(payload[key]))return payload[key];
  if(Array.isArray(payload.data))return payload.data;
  if(payload.data&&typeof payload.data==='object')return rowsFrom(payload.data);
  if(payload.result&&typeof payload.result==='object')return rowsFrom(payload.result);
  return null;
}

function makeFindUrl(collection,page,filter){
  if(!env.bankingApiBaseUrl||!env.tapdataFindPathTemplate)throw new HttpError(503,'Configure TAPDATA_API_BASE_URL and TAPDATA_FIND_PATH_TEMPLATE from the deployed published API specification','INTEGRATION_NOT_CONFIGURED');
  const path=env.tapdataFindPathTemplate.replaceAll('{collection}',encodeURIComponent(collection));
  if(path.includes('{'))throw new HttpError(500,'Unknown placeholder in TAPDATA_FIND_PATH_TEMPLATE','CONFIGURATION_ERROR');
  const url=new URL(path,env.bankingApiBaseUrl);
  if(env.tapdataFindRequestStyle==='query'){url.searchParams.set('filter',JSON.stringify({...filter,limit:env.tapdataPageSize,skip:(page-1)*env.tapdataPageSize}));}
  else if(env.tapdataFindRequestStyle!=='body')throw new HttpError(500,'TAPDATA_FIND_REQUEST_STYLE must be body or query','CONFIGURATION_ERROR');
  return url;
}

async function requestPage(collection,page,filter){
  const token=await accessToken(),headers={Accept:'application/json'};if(token)headers.Authorization=`Bearer ${token}`;
  let body;if(env.tapdataFindRequestStyle==='body'){headers['Content-Type']='application/json';body=JSON.stringify({filter,page,pageSize:env.tapdataPageSize});}
  let response;
  for(let attempt=0;attempt<3;attempt++){
    try{response=await fetch(makeFindUrl(collection,page,filter),{method:env.tapdataFindMethod,headers,...(body?{body}:{}),signal:AbortSignal.timeout(env.tapdataRequestTimeoutMs)});if(![429,502,503,504].includes(response.status)||attempt===2)break;await new Promise(resolve=>setTimeout(resolve,250*2**attempt));}
    catch{if(attempt===2)throw new HttpError(502,`TapData request failed for published table ${collection}`,'TAPDATA_UPSTREAM_UNAVAILABLE');await new Promise(resolve=>setTimeout(resolve,250*2**attempt));}
  }
  if(!response?.ok)throw new HttpError(response?.status===404?404:502,`TapData published API request failed for ${collection}`,'TAPDATA_UPSTREAM_ERROR');
  let payload;try{payload=await response.json();}catch{throw new HttpError(502,`TapData returned invalid JSON for ${collection}`,'TAPDATA_INVALID_RESPONSE');}
  const rows=rowsFrom(payload);if(!rows)throw new HttpError(422,`TapData response for ${collection} does not contain a recognized records array`,'TAPDATA_SCHEMA_MISMATCH');
  return {rows,payload};
}

async function fetchTable(table,collection,filter){
  const output=[];let page=1;
  while(output.length<env.tapdataScanLimit){
    const {rows,payload}=await requestPage(collection,page,filter);if(!rows.length)break;
    output.push(...rows.slice(0,env.tapdataScanLimit-output.length));
    const meta=payload?.pagination||payload?.meta||payload?.data?.pagination||{};
    const hasMore=meta.hasNextPage??meta.hasMore??payload?.hasMore;
    const rawTotal=meta.total??payload?.count??payload?.totalCount??payload?.total;
    const total=Number(rawTotal&&typeof rawTotal==='object'?(rawTotal.count??rawTotal.total):rawTotal);
    if(rows.length<env.tapdataPageSize||hasMore===false||(!Number.isNaN(total)&&total>0&&output.length>=total))break;
    if(hasMore!==true&&rows.length<env.tapdataPageSize)break;
    page++;
  }
  return output;
}

function uniqueRows(rows,key){const found=new Map();for(const row of rows){const id=row?.[key];if(id!==undefined&&id!==null)found.set(String(id),row);}return [...found.values()];}

function expandCustomer360(customers){
  const bundle=Object.fromEntries(compositeTables.map(name=>[name,[]]));
  for(const customer of customers){
    const profile=customer.CUSTOMER_PROFILE;
    if(profile&&typeof profile==='object'){
      bundle.CUSTOMER_PROFILE.push(profile);
      if(Array.isArray(profile.CUSTOMER_ADDRESS))bundle.CUSTOMER_ADDRESS.push(...profile.CUSTOMER_ADDRESS);
    }
    if(customer.BANK_BRANCH&&typeof customer.BANK_BRANCH==='object')bundle.BANK_BRANCH.push(customer.BANK_BRANCH);
    for(const relationship of Array.isArray(customer.ACCOUNT_CUSTOMER_RELATIONSHIP)?customer.ACCOUNT_CUSTOMER_RELATIONSHIP:[]){
      const {ACCOUNT,...link}=relationship||{};bundle.ACCOUNT_CUSTOMER_RELATIONSHIP.push(link);
      if(!ACCOUNT||typeof ACCOUNT!=='object')continue;
      const {ACCOUNT_TRANSACTION=[],BANK_CARD=[],...account}=ACCOUNT;bundle.BANK_ACCOUNT.push(account);
      if(Array.isArray(ACCOUNT_TRANSACTION))bundle.ACCOUNT_TRANSACTION.push(...ACCOUNT_TRANSACTION);
      if(Array.isArray(BANK_CARD))bundle.CARD.push(...BANK_CARD);
    }
  }
  for(const [table,key] of Object.entries({BANK_BRANCH:'BRANCH_CODE',BANK_ACCOUNT:'ACCOUNT_ID',ACCOUNT_CUSTOMER_RELATIONSHIP:'_id',ACCOUNT_TRANSACTION:'TRANSACTION_ID',CARD:'CARD_ID',CUSTOMER_PROFILE:'CUSTOMER_PROFILE_ID',CUSTOMER_ADDRESS:'ADDRESS_ID'}))bundle[table]=uniqueRows(bundle[table],key);
  return bundle;
}

export const tapdataClient={
  get mode(){return env.bankingApiBaseUrl?'tapdata-api':'not-configured';},
  async getBankingBundle(){
    const map=collectionMap();let filter={};try{filter=JSON.parse(process.env.TAPDATA_FIND_FILTER||'{}');}catch{throw new HttpError(500,'TAPDATA_FIND_FILTER must be valid JSON','CONFIGURATION_ERROR');}
    if(!filter||typeof filter!=='object'||Array.isArray(filter))throw new HttpError(500,'TAPDATA_FIND_FILTER must be a JSON object','CONFIGURATION_ERROR');
    const bundle={source:'TAPDATA_PUBLISHED_API',generatedAt:null,retrievedAt:null};
    // Customer 360 is the authoritative published route for customer and
    // nested account, transaction, card, profile, address, and branch records.
    const customerRows=await fetchTable('CUSTOMER',map.CUSTOMER,filter);
    if(!customerRows.length)throw new HttpError(503,'TapData Customer 360 returned no customer rows; verify its published route and filter','TAPDATA_SCHEMA_INCOMPLETE');
    bundle.CUSTOMER=customerRows.map(({ACCOUNT_CUSTOMER_RELATIONSHIP,CUSTOMER_PROFILE,BANK_BRANCH,...customer})=>customer);
    Object.assign(bundle,expandCustomer360(customerRows));
    const unavailableTables=[];
    const results=await Promise.all(publishedTables.map(async table=>{
      try{return [table,await fetchTable(table,map[table],filter)];}
      catch(error){if(error.status===404)return [table,null];throw error;}
    }));
    for(const [table,rows] of results){if(rows===null){bundle[table]=[];unavailableTables.push(table);}else bundle[table]=rows;}
    for(const table of sourceTables)bundle[table]??=[];
    bundle.dataAvailability={
      unavailableTables,
      derivedTables:compositeTables,
      lastRetrievedAt:null
    };
    bundle.retrievedAt=new Date().toISOString();
    bundle.dataAvailability.lastRetrievedAt=bundle.retrievedAt;
    return bundle;
  }
};
