// Exportación enriquecida: consistencia del libro contra el resultado del motor
const fs=require('fs'), vm=require('vm'), path=require('path');
const ExcelJS=require('exceljs');
const {loadData,alDia,ok,report,NEW}=require('./helpers');
const data=alDia(loadData());
function ctxWin(){ const c={window:{CEDI_DATA:data},console,Math,JSON,Date,Promise,setTimeout}; vm.createContext(c);
  for(const f of ['utils/calculations.js','utils/exportPedido.js']) vm.runInContext(fs.readFileSync(NEW+f,'utf8'),c); return c.window; }
const W=ctxWin();
const BASE={presupuesto:600000,leadTime:5,diasCoberturaMeta:20,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:true,limitarVazlo:false,blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,pisoAB:true};
const OUT=path.join(__dirname,'_out'); fs.mkdirSync(OUT,{recursive:true});
const casos=[['pulido_600k',{motor:'pulido'}],['clasico_600k',{motor:'clasico'}],['pulido_lim',{motor:'pulido',limitarVazlo:true}],
  ['clasico_plano',{motor:'clasico',blindaje:false}],['pulido_100k',{motor:'pulido',presupuesto:100000}],['pulido_abc',{motor:'pulido',filtroABC:['A','B','C'],diasCoberturaMeta:30,leadTime:9}]];
(async()=>{
 for(const [nom,o] of casos){
  const params={...BASE,...o}; const result=W.CALC.optimizarPedido(data.articulos,params);
  // diagnóstico coherente con los tramos
  if(result.tramos) result.tramos.forEach(t=>{
    const ev=Object.values(result.diagnostico.porClave).filter(e=>e.tramo===t.id);
    ok(ev.filter(e=>e.cantFinal>0).length===t.arts,`${nom} diag financiados = tramo ${t.id}`);
    ok(ev.filter(e=>e.estado==='fuera_presupuesto').length===t.fueraArts,`${nom} diag fuera = tramo ${t.id}`);
    ok(ev.length===t.candidatos,`${nom} diag candidatos = tramo ${t.id}`); });
  const t0=Date.now();
  const {wb,an}=await W.EXPORT_PEDIDO.construirLibro(ExcelJS,{result,params,data,CALC:W.CALC,vazloMeta:{fecha_carga:'2026-09-21'}});
  const ms=Date.now()-t0;
  ok(JSON.stringify(wb.worksheets.map(w=>w.name))===JSON.stringify(['Resumen','Pedido','Análisis completo','Fuera por presupuesto','Metodología']),`${nom} hojas en orden`);
  const P=wb.getWorksheet('Pedido'); const hdr=P.getRow(3).values; const col=h=>hdr.indexOf(h);
  const rows=[]; P.eachRow((r,i)=>{ if(i>=4) rows.push(r); });
  ok(rows.length===result.totalArts,`${nom} Pedido tiene ${result.totalArts} renglones`,rows.length);
  const cCant=col('CANT. A PEDIR'), cCosto=col('Costo unit c/IVA'), cClave=col('Clave'), cJ=col('JUSTIFICACIÓN'), cE=col('ESTADO ROBOT'), cAc=col('Acumulado al entrar'), cD=col('$ compra');
  let tot=0, okOrden=true, okJ=true, acc=0, okAcc=true;
  rows.forEach((r,i)=>{ const it=result.pedido[i]; if(r.getCell(cClave).value!==it.clave||r.getCell(cCant).value!==it.cantFinal) okOrden=false;
    tot+=r.getCell(cCant).value*r.getCell(cCosto).value; const j=r.getCell(cJ).value||''; if(!/DECISIÓN: COMPRA/.test(j)||r.getCell(cE).value!=='COMPRA') okJ=false;
    const ac=r.getCell(cAc).value; if(Math.abs((ac.result||0)-acc)>0.01) okAcc=false; acc+=it.costoFinal; });
  ok(okOrden,`${nom} Pedido en el orden y cantidades del robot`); ok(Math.abs(tot-result.totalCosto)<1,`${nom} $ del libro = costo del robot`,tot+' vs '+result.totalCosto);
  ok(okJ,`${nom} cada renglón con estado COMPRA y justificación`); ok(okAcc,`${nom} acumulado al entrar`);
  // Análisis completo
  const A=an.filas; const cnt=e=>A.filter(f=>f.estado===e).length;
  ok(cnt('COMPRA')===result.totalArts,`${nom} análisis COMPRA = pedido`);
  if(result.tramos) ok(cnt('FUERA POR PRESUPUESTO')===result.tramos.reduce((s,t)=>s+t.fueraArts,0),`${nom} análisis FUERA = motor`);
  ok(A.every(f=>f.just&&f.just.length>40),`${nom} justificación en todas las filas`);
  ok(A.filter(f=>f.estado==='EXISTENCIA CUBRE OBJETIVO').every(f=>f.need===0),`${nom} existencia cubre ⇒ necesidad 0`);
  ok(A.filter(f=>f.estado==='COMPRA').every(f=>f.cant<=f.need),`${nom} compra ≤ necesidad`);
  ok(A.filter(f=>f.veredicto==='CUBRE NECESIDAD').every(f=>f.cant>=f.need),`${nom} veredicto CUBRE coherente`);
  if(params.limitarVazlo) ok(A.filter(f=>f.estado==='COMPRA').every(f=>f.cant<=f.vz),`${nom} limitado ≤ Vazlo`);
  ok(A.filter(f=>f.pos!=null).every(f=>f.pos>=1&&f.pos<=f.de),`${nom} posición dentro del tramo`);
  // motor alterno = corrida directa
  const otro=params.motor==='pulido'?'clasico':'pulido'; const ra=W.CALC.optimizarPedido(data.articulos,{...params,motor:otro});
  const altTot=A.reduce((s,f)=>s+f.alt.cant,0); ok(altTot===ra.totalUnidades,`${nom} motor alterno = corrida directa`,altTot+' vs '+ra.totalUnidades);
  const file=path.join(OUT,nom+'.xlsx'); await wb.xlsx.writeFile(file);
  console.log(`${nom}: ${result.totalArts} arts pedido · ${A.length} evaluados · ${ms} ms · ${(fs.statSync(file).size/1e6).toFixed(1)} MB`);
 }
 // el cálculo no cambia por agregar diagnóstico (pedido idéntico a correrlo otra vez)
 const r1=W.CALC.optimizarPedido(data.articulos,{...BASE,motor:'pulido'}), r2=W.CALC.optimizarPedido(data.articulos,{...BASE,motor:'pulido'});
 ok(JSON.stringify(r1.pedido.map(x=>[x.clave,x.cantFinal]))===JSON.stringify(r2.pedido.map(x=>[x.clave,x.cantFinal])),'cálculo determinista');
 process.exit(report('T5 Exportación enriquecida')?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
