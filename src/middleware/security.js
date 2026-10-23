export function securityHeaders(_req,res,next){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
}
export function rateLimit({windowMs=60_000,max=120}={}){
  const buckets=new Map();
  return(req,res,next)=>{
    const key=req.ip||req.socket.remoteAddress||'unknown',now=Date.now();let entry=buckets.get(key);
    if(!entry||entry.resetAt<=now){entry={count:0,resetAt:now+windowMs};buckets.set(key,entry);}
    entry.count++;res.setHeader('RateLimit-Limit',max);res.setHeader('RateLimit-Remaining',Math.max(0,max-entry.count));
    if(entry.count>max){res.setHeader('Retry-After',Math.max(1,Math.ceil((entry.resetAt-now)/1000)));return res.status(429).json({error:{code:'RATE_LIMITED',message:'Too many requests. Try again shortly.'}});}
    if(buckets.size>5000)for(const [k,v]of buckets)if(v.resetAt<=now)buckets.delete(k);
    next();
  };
}
