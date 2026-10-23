import { env } from '../config/env.js';
import { bankingApiClient } from './banking-api-client.js';
import { tapdataClient } from '../integrations/tapdata/client.js';
import { mongoBankingRepository } from '../integrations/mongodb/banking-repository.js';
import { demoFraudBundle } from '../data/demo-fraud-bundle.js';
import { HttpError } from '../middleware/errors.js';

let tapdataSnapshot=null;
let tapdataExpiresAt=0;
let tapdataRefresh=null;

export const bankingDataService={
  get mode(){return env.dataSource==='demo'?'demo':env.dataSource==='api'||env.dataSource==='tapdata'?'tapdata-api':env.dataSource;},
  async getBundle(scope){
    if(env.dataSource==='mongodb'){if(scope&&!scope.all&&(scope.customerIds||[]).length===1)return mongoBankingRepository.getCustomerBundle(scope.customerIds[0]);return mongoBankingRepository.getBundle();}
    if(env.dataSource==='tapdata'){
      if(tapdataSnapshot&&Date.now()<tapdataExpiresAt)return tapdataSnapshot;
      if(!tapdataRefresh)tapdataRefresh=tapdataClient.getBankingBundle().then(bundle=>{tapdataSnapshot=bundle;tapdataExpiresAt=Date.now()+env.tapdataCacheTtlMs;return bundle;}).finally(()=>{tapdataRefresh=null;});
      return tapdataRefresh;
    }
    if(env.dataSource==='api')return bankingApiClient.getFraudBundle();
    if(env.dataSource==='demo')return demoFraudBundle;
    throw new HttpError(500,'DATA_SOURCE must be demo, tapdata, api, or mongodb','CONFIGURATION_ERROR');
  }
};
