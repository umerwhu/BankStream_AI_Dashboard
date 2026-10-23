import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';

let clientPromise;
export async function mongoDatabase(){
  if(!env.mongoUri)throw new HttpError(503,'MongoDB is not configured','MONGODB_NOT_CONFIGURED');
  if(!clientPromise)clientPromise=import('mongodb').then(({MongoClient})=>{const client=new MongoClient(env.mongoUri,{serverSelectionTimeoutMS:8000,maxPoolSize:10,promoteLongs:false});return client.connect().then(()=>client.db(env.mongoDatabase||undefined));}).catch(()=>{clientPromise=null;throw new HttpError(503,'MongoDB driver or connection is unavailable','MONGODB_UNAVAILABLE');});
  return clientPromise;
}
