// Persist raw threat weights; normalize only the public projection. Largest
// remainders preserve an exact integer total of 100, including cold checkpoints.
function shares(sim) {
  const weights = Array.from({length:4}, (_, i) => {
    const p=sim.p1.active[i], n=Number(p?.m.aggro)||0;
    return p?.hp>0&&!p.m.retired&&Number.isFinite(n)?Math.max(0,n):0;
  });
  const total=weights.reduce((a,b)=>a+b,0);
  if(!total)return weights.map(()=>0);
  const exact=weights.map(n=>n/total*100), result=exact.map(Math.floor);
  const order=exact.map((n,i)=>({i,fraction:n-result[i]})).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
  for(let n=100-result.reduce((a,b)=>a+b,0),i=0;i<n;i++)result[order[i].i]++;
  return result;
}
module.exports={shares};
