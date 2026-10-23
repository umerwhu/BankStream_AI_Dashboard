import { env } from '../config/env.js';
import { HttpError } from './errors.js';

export function authenticate(req,_res,next){
  if(env.nodeEnv==='production'){
    if(!env.trustIdentityProxy)return next(new HttpError(503,'Configure the trusted identity-proxy adapter before production use','AUTH_NOT_CONFIGURED'));
    const userId=req.get('x-authenticated-user');
    const roles=(req.get('x-authenticated-roles')||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(!userId)return next(new HttpError(401,'Authentication required','UNAUTHENTICATED'));
    const customerIds=(req.get('x-authorized-customer-ids')||'').split(',').map(x=>x.trim()).filter(x=>/^\d+$/.test(x));
    req.user={id:userId,roles,customerScope:{all:req.get('x-portfolio-access')==='true',customerIds,sensitiveFields:req.get('x-authorized-sensitive-fields')==='true'}};
  }else req.user={id:'demo-investigator',roles:['analyst','investigator','supervisor'],customerScope:{all:true,customerIds:[],sensitiveFields:true}};
  next();
}
export function requireRole(...allowed){return(req,_res,next)=>{if(!req.user||!allowed.some(role=>req.user.roles.includes(role)))return next(new HttpError(403,'Insufficient role for this operation','FORBIDDEN'));next();};}
