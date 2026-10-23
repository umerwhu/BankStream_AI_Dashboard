import { env } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';

export const bankingApiClient = {
  get mode() { return env.bankingApiBaseUrl ? 'api' : 'not-configured'; },
  async getFraudBundle() {
    if (!env.bankingApiBaseUrl) throw new HttpError(503, 'Set BANKING_API_BASE_URL from the approved integrated-data API configuration', 'INTEGRATION_NOT_CONFIGURED');
    if (!env.fraudDataPath) throw new HttpError(503, 'Set BANKING_DATA_PATH from the approved integrated-data API specification', 'INTEGRATION_NOT_CONFIGURED');
    const url = new URL(env.fraudDataPath, env.bankingApiBaseUrl);
    const headers = env.bankingApiAuthHeader && env.bankingApiAuthValue ? { [env.bankingApiAuthHeader]: env.bankingApiAuthValue } : {};
    let response;
    for(let attempt=0;attempt<3;attempt++){
      try { response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});if(![429,502,503,504].includes(response.status)||attempt===2)break;const retryAfter=Number(response.headers.get('retry-after'));await new Promise(resolve=>setTimeout(resolve,Math.min(Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:250*2**attempt,2000))); }
      catch{if(attempt===2)throw new HttpError(502,'Integrated banking data API is unavailable','UPSTREAM_UNAVAILABLE');await new Promise(resolve=>setTimeout(resolve,250*2**attempt));}
    }
    if(!response)throw new HttpError(502,'Integrated banking data API is unavailable','UPSTREAM_UNAVAILABLE');
    if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 502, 'Integrated fraud data API request failed', 'UPSTREAM_ERROR');
    let data;try{data=await response.json();}catch{throw new HttpError(502,'Integrated banking data API returned invalid JSON','INVALID_UPSTREAM_RESPONSE');}
    if (!data || typeof data !== 'object' || !Array.isArray(data.ACCOUNT_TRANSACTION) || !Array.isArray(data.BANK_ACCOUNT) || !Array.isArray(data.ACCOUNT_CUSTOMER_RELATIONSHIP)) throw new HttpError(422, 'Fraud API response does not match the documented source-table mapping', 'INVALID_FRAUD_FEED');
    return { ...data, source: 'INTEGRATED_API' };
  }
};
