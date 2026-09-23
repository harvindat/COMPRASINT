// Motor v2 parametrizable: con flags en "actual" reproduce EXACTO calculations.js
module.exports = function(arts, p, aux) {
  const H = p.diasCoberturaMeta, LT = p.leadTime, fSS = p.factorSS;
  const flt = LT<=3?0.85:LT<=5?1:LT<=9?1.2:LT<=15?1.5:1.65;
  const z = 1.65;
  function calc(a) {
    const dpd = aux.dpd ? aux.dpd(a) : a.dpd, ex = a.existencia||0, c = a.costo_iva||0;
    if (dpd === 0 || c === 0) return { clave:a.clave, cantPedir:0 };
    let ss, stockObj, diasObj = Math.ceil(H*flt);
    if (p.ssMode === 'actual') { ss = Math.ceil(z*dpd*0.30*Math.sqrt(LT)*fSS); stockObj = Math.ceil(dpd*diasObj+ss); }
    else if (p.ssMode === 'redondeo') { ss = z*dpd*0.30*Math.sqrt(LT)*fSS; stockObj = Math.round(dpd*diasObj+ss); }
    else { // real: sigma del periodo de reposición con variabilidad mensual observada (o Poisson si hay poca historia)
      const m = aux.monthly[a.clave]; let sLT;
      const pois = Math.sqrt(dpd*LT);
      if (m && m.reduce((s,x)=>s+x,0) >= 8) { const mu=m.reduce((s,x)=>s+x,0)/m.length; const sd=Math.sqrt(m.reduce((s,x)=>s+(x-mu)**2,0)/m.length); sLT = Math.max(pois, sd*Math.sqrt(LT/30)); }
      else sLT = pois;
      ss = z*sLT*fSS; stockObj = Math.round(dpd*diasObj + ss);
      if (dpd*diasObj < 0.5) stockObj = Math.min(stockObj, (a.abc==='A'||a.abc==='B') && p.pisoAB ? 1 : 0);
    }
    const rop = (p.ssMode==='actual') ? Math.ceil(dpd*LT+ss) : Math.round(dpd*LT+ss);
    const cantPedir = Math.max(0, stockObj - ex);
    const precio = a.unidades_total>0 ? a.venta_total/a.unidades_total : 0;
    const riesgo = Math.max(0, dpd*H - ex) * precio;   // venta esperada que se perdería en el horizonte
    return { clave:a.clave, abc:a.abc, existencia:ex, cantPedir, costoUnit:c, costoTotal:cantPedir*c, score:a.score_compra||0,
      rop, ss, stockObj, dpd, riesgo, existenciaVazlo: a.existencia_vazlo };
  }
  const cmp = p.orden === 'riesgo' ? ((a,b)=>(b.riesgo-a.riesgo)||(b.score-a.score)) : ((a,b)=>b.score-a.score);
  function fin(items, bolsa, tramo) {
    const ped=[]; let rest=bolsa, fuera=0;
    for (const it of items) {
      if (it.costoUnit<=0) continue; let tope=it.cantPedir;
      if (p.limitarVazlo) { const ev=it.existenciaVazlo||0; if (ev<=0) continue; if (ev<tope) tope=ev; }
      const maxA = rest>0?Math.floor(rest/it.costoUnit):0; const q=Math.min(tope,maxA);
      if (q>0) { ped.push({...it, cantFinal:q, costoFinal:q*it.costoUnit, tramo}); rest-=q*it.costoUnit; } else fuera++;
    }
    return {ped,rest,fuera};
  }
  const base = arts.filter(a => (aux.dpd?aux.dpd(a):a.dpd)>0 && a.costo_iva>0 && !(p.excluir && p.excluir(a)));
  const medOf = f => { const o={}; ['A','B','C','D'].forEach(c=>{ const v=arts.filter(a=>(a.abc||'D')===c && f(a)>0).map(f).sort((x,y)=>x-y); const m=Math.floor(v.length/2); o[c]=!v.length?0:(v.length%2?v[m]:(v[m-1]+v[m])/2); }); return o; };
  const fr = p.rapido==='dpd' ? (a=>a.dpd||0) : (a=>a.rotacion||0);
  const med = medOf(fr);
  const used=new Set();
  const t0=base.filter(a=>(a.existencia||0)===0 && p.blindajeAlcance.includes(a.abc) && fr(a)>=(med[a.abc]||0)).map(calc).filter(r=>r.cantPedir>0).sort(cmp);
  t0.forEach(i=>used.add(i.clave)); const r0=fin(t0,p.presupuesto*p.topeT0,'cero_rapido');
  const rank=arts.filter(a=>(a.venta_ancla||0)>0).sort((a,b)=>b.venta_ancla-a.venta_ancla).slice(0,p.topAnclaN);
  const rk=new Set(rank.map(a=>a.clave)); const va={}; arts.forEach(a=>va[a.clave]=a.venta_ancla||0);
  const t1=base.filter(a=>rk.has(a.clave)&&!used.has(a.clave)).map(calc).filter(r=>r.cantPedir>0&&r.existencia<=r.rop).sort((a,b)=>va[b.clave]-va[a.clave]);
  t1.forEach(i=>used.add(i.clave)); const r1=fin(t1,p.presupuesto*p.topeT1+r0.rest,'ancla');
  const t2=base.filter(a=>p.filtroABC.includes(a.abc)&&!used.has(a.clave)).map(calc).filter(r=>r.cantPedir>0).sort(cmp);
  const r2=fin(t2,Math.max(0,p.presupuesto*(1-p.topeT0-p.topeT1)+r1.rest),'general');
  const info={}; [['cero_rapido',t0],['ancla',t1],['general',t2]].forEach(([t,l])=>l.forEach((x,i)=>info[x.clave]={tramo:t,pos:i+1,de:l.length,need:x.cantPedir,riesgo:x.riesgo}));
  const calcAll={}; arts.forEach(a=>{const c=calc(a); calcAll[a.clave]={ss:c.ss,rop:c.rop,obj:c.stockObj,need:c.cantPedir,riesgo:c.riesgo};});
  return { pedido:[...r0.ped,...r1.ped,...r2.ped], info, calcAll, med,
    tramos:[['cero_rapido',r0,t0],['ancla',r1,t1],['general',r2,t2]].map(([id,r,l])=>({id,arts:r.ped.length,costo:r.ped.reduce((s,x)=>s+x.costoFinal,0),cand:l.length,need:l.reduce((s,x)=>s+x.costoTotal,0),fuera:r.fuera})) };
};
