import test from 'node:test';
import assert from 'node:assert/strict';

test('TapData adapter uses the published MDM Customer 360 route and original table service names',async()=>{
  Object.assign(process.env,{DATA_SOURCE:'tapdata',TAPDATA_API_BASE_URL:'https://tapdata.example.test',TAPDATA_FIND_PATH_TEMPLATE:'/api/v1/{collection}',TAPDATA_COLLECTION_MAP:'{"CUSTOMER":"MDM_CUSTOMER360"}',TAPDATA_TOKEN_URL:'https://auth.example.test/oauth/token',TAPDATA_CLIENT_ID:'test-client',TAPDATA_CLIENT_SECRET:'test-only-secret',TAPDATA_TOKEN_AUTH_METHOD:'client_secret_post',TAPDATA_ACCESS_TOKEN:'',TAPDATA_PAGE_SIZE:'200',TAPDATA_SCAN_LIMIT:'1000',TAPDATA_REQUEST_TIMEOUT_MS:'1000',TAPDATA_FIND_METHOD:'GET',TAPDATA_FIND_REQUEST_STYLE:'query',TAPDATA_FIND_FILTER:'{}'});
  const originalFetch=globalThis.fetch,calls=[];globalThis.fetch=async(input,init={})=>{
    const url=new URL(input);calls.push({url,init});
    if(url.hostname==='auth.example.test')return Response.json({access_token:'test-only-token',expires_in:3600});
    const service=url.pathname.split('/').at(-1);
    const rows=service==='MDM_CUSTOMER360'?[{CUSTOMER_ID:7,CUSTOMER_NAME:'Test customer',ACCOUNT_CUSTOMER_RELATIONSHIP:[{_id:'rel-1',ACCOUNT_ID:'A-1',CUSTOMER_ID:7,ACCOUNT:{ACCOUNT_ID:'A-1',ACCOUNT_TYPE:'CHECKING',ACCOUNT_STATUS:'ACTIVE',CURRENCY:'USD',BALANCE:'12.0000',ACCOUNT_TRANSACTION:[{TRANSACTION_ID:'T-1',ACCOUNT_ID:'A-1'}],BANK_CARD:[]}}],CUSTOMER_PROFILE:{CUSTOMER_PROFILE_ID:'P-1',CUSTOMER_ID:7,CUSTOMER_ADDRESS:[]}}]:[];
    return Response.json({data:rows,total:rows.length});
  };
  try{
    const {tapdataClient}=await import(`../src/integrations/tapdata/client.js?test=${Date.now()}`),bundle=await tapdataClient.getBankingBundle();
    assert.equal(bundle.source,'TAPDATA_PUBLISHED_API');
    assert.equal(bundle.CUSTOMER[0].CUSTOMER_ID,7);
    assert.equal(bundle.BANK_ACCOUNT[0].ACCOUNT_ID,'A-1');
    assert.equal(bundle.ACCOUNT_TRANSACTION[0].TRANSACTION_ID,'T-1');
    assert.ok(calls.some(({url})=>url.pathname==='/api/v1/MDM_CUSTOMER360'));
    assert.ok(calls.some(({url})=>url.pathname==='/api/v1/CUSTOMER_PREFERENCE'));
    const apiCall=calls.find(({url})=>url.pathname==='/api/v1/MDM_CUSTOMER360');
    assert.equal(apiCall.init.headers.Authorization,'Bearer test-only-token');
    assert.deepEqual(JSON.parse(apiCall.url.searchParams.get('filter')),{limit:200,skip:0});
  }finally{globalThis.fetch=originalFetch;}
});
