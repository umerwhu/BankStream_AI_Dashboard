const SCALE=10_000n;
export function toScaledDecimal(value){
  const s=String(value??'');if(!/^-?\d+(?:\.\d{1,4})?$/.test(s))return null;
  const negative=s.startsWith('-'),body=negative?s.slice(1):s,[whole,fraction='']=body.split('.');
  const scaled=BigInt(whole)*SCALE+BigInt((fraction+'0000').slice(0,4));return negative?-scaled:scaled;
}
export function fromScaledDecimal(value){
  const negative=value<0n,n=negative?-value:value,whole=n/SCALE,fraction=String(n%SCALE).padStart(4,'0');
  return `${negative?'-':''}${whole}.${fraction}`;
}
export function decimalMedian(values){
  const sorted=values.filter(x=>x!==null).sort((a,b)=>a<b?-1:a>b?1:0);if(!sorted.length)return null;
  const mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2n;
}
export function multiplierScaled(value){
  const decimal=toScaledDecimal(value);return decimal===null||decimal<0n?3n*SCALE:decimal;
}
export const DECIMAL_SCALE=SCALE;
