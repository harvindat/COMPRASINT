const fs=require('fs'), vm=require('vm');
const path=require('path'); const NEW=path.join(__dirname,'..','src')+'/', FIX=path.join(__dirname,'fixtures')+'/';
function loadCalc(root, data){ const ctx={window:{},console,Math,JSON}; ctx.window.CEDI_DATA=data; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(root==='ORIGINAL'?FIX+'calculations_original.js':root+'utils/calculations.js','utf8'),ctx); return ctx.window.CALC; }
const OLD='ORIGINAL';
function loadData(){ const ctx={window:{}}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(NEW+'data/cedi_data.js','utf8'),ctx); return ctx.window.CEDI_DATA; }
// dataset "al día" (igual que el informe): INV HARVIN + tránsito, Vazlo 21-sep, score recalculado
function alDia(data){
  const d=JSON.parse(JSON.stringify(data)); const extra=require('./fixtures/existencias_21sep.json'); const arts=d.articulos;
  arts.forEach(a=>{ if(a.clave in extra.inv) a.existencia=(extra.inv[a.clave]||0)+(extra.tr[a.clave]||0);
    a.existencia_vazlo=(a.clave in extra.vz)?Math.max(0,Math.round(extra.vz[a.clave].ttl||0)):0; });
  const rots=arts.map(a=>a.rotacion).sort((a,b)=>a-b); const pos=(rots.length-1)*0.95, lo=Math.floor(pos), hi=Math.ceil(pos);
  const rotMax=(rots[lo]+(rots[hi]-rots[lo])*(pos-lo))||1; const abcS={A:1,B:0.65,C:0.35,D:0};
  arts.forEach(a=>{ a.cobertura_dias=a.dpd>0?Math.round(a.existencia/a.dpd):0; const rn=Math.min(a.rotacion/rotMax,1), ic=1-Math.min(a.cobertura_dias/365,1);
    a.score_compra=Math.round((0.40*abcS[a.abc]+0.25*rn+0.20*a.pct_ancla+0.15*ic)*100*10000)/10000; });
  return d;
}
const sig=r=>r.pedido.map(x=>`${x.clave}|${x.cantFinal}|${x.tramo}|${x.costoFinal.toFixed(4)}|${x.surtido}`).join('\n');
let pass=0, fail=0; const fails=[];
function ok(cond,name,extra){ if(cond){pass++;} else {fail++; fails.push(name+(extra?' :: '+extra:''));} }
function report(title){ console.log(`${title}: ${pass} OK, ${fail} FALLAS`); fails.slice(0,20).forEach(f=>console.log('  ✗ '+f)); return fail===0; }
module.exports={loadCalc,loadData,alDia,sig,ok,report,NEW,OLD,FIX};
