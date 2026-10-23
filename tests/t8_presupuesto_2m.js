// T8 · Presupuesto parametrizable hasta $2,000,000
// Motor (invariantes, cascada de tramos, saturación), equivalencia contra los
// motores de referencia a montos altos, saneo de entradas, UI (slider, caja de
// monto exacto, persistencia al re-render) y exportación Excel a $2M.
const {JSDOM}=require('jsdom'); const fs=require('fs');
const {loadCalc,loadData,alDia,sig,ok,report,NEW,OLD}=require('./helpers');
const E2=require('./fixtures/engine2_referencia.js');

const base=loadData(); const datasets={github:base, aldia:alDia(base)};
const PRES=[700000,1000000,1200000,1500000,1800000,1990000,2000000];
const BASE={leadTime:5,diasCoberturaMeta:30,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:false,limitarVazlo:false,
  blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,motor:'pulido',pisoAB:true};
const near=(a,b,t=1e-3)=>Math.abs(a-b)<=t;

/* ── 1. Invariantes del motor en todo el rango alto ── */
let combos=0;
for(const [dn,d] of Object.entries(datasets)){
  const C=loadCalc(NEW,d); const costo={}; d.articulos.forEach(a=>{costo[a.clave]=a.costo_iva||0;});
  for(const motor of ['pulido','clasico']) for(const bl of [true,false]) for(const vz of ['off','info','lim'])
  for(const cfg of [{},{diasCoberturaMeta:60,filtroABC:['A','B','C']},{topeT0:0.30,topeT1:0.40,blindajeAlcance:['A','B']},{topeT0:1,topeT1:0}])
  for(const pres of PRES){
    if(vz!=='off' && !(d.meta.vazlo&&d.meta.vazlo.cargado) && dn==='github') continue;
    const p={...BASE,...cfg,motor,blindaje:bl,usarVazlo:vz!=='off',limitarVazlo:vz==='lim',presupuesto:pres};
    const r=C.optimizarPedido(d.articulos,p); combos++;
    const tag=`${dn} ${motor} bl=${bl} vz=${vz} cfg=${JSON.stringify(cfg)} pres=${pres}`;
    ok(r.totalCosto<=pres+1e-6,'nunca excede el presupuesto · '+tag);
    ok(near(r.totalCosto+r.presupuestoRestante,pres),'costo + restante = presupuesto · '+tag, r.totalCosto+r.presupuestoRestante);
    ok(near(r.pctUsado,r.totalCosto/pres*100,1e-9),'% usado consistente · '+tag);
    ok(near(r.pedido.reduce((s,x)=>s+x.cantFinal*x.costoUnit,0),r.totalCosto),'Σ cant×costo = total · '+tag);
    ok(new Set(r.pedido.map(x=>x.clave)).size===r.pedido.length,'sin claves duplicadas · '+tag);
    ok(r.pedido.every(x=>Number.isInteger(x.cantFinal)&&x.cantFinal>0&&x.cantFinal<=x.cantPedir),'cantidades enteras 1..necesidad · '+tag);
    if(p.limitarVazlo) ok(r.pedido.every(x=>x.cantFinal<=(x.existenciaVazlo||0)),'limitado ≤ stock Vazlo · '+tag);
    // Un candidato "fuera por presupuesto" solo es válido si la bolsa al llegar su turno no alcanzaba ni 1 pieza
    const fuera=Object.values(r.diagnostico.porClave).filter(e=>e.estado==='fuera_presupuesto');
    ok(fuera.every(e=>e.bolsaAntes<costo[e.clave]),'fuera = bolsa < 1 pz · '+tag);
    if(fuera.length===0 && !p.limitarVazlo) ok(near(r.totalCosto,r.necesidadTotal),'sin fuera → compra exactamente la necesidad · '+tag, `${r.totalCosto} vs ${r.necesidadTotal}`);
    if(bl){
      const T={}; r.tramos.forEach(t=>{T[t.id]=t;}); const b=r.diagnostico.bolsas;
      ok(near(r.tramos.reduce((s,t)=>s+t.costo,0),r.totalCosto),'Σ tramos = total · '+tag);
      ok(near(b.t0,pres*p.topeT0),'bolsa T0 = pres×T0 · '+tag);
      ok(near(b.t1,pres*p.topeT1+(b.t0-T.cero_rapido.costo)),'bolsa T1 = pres×T1 + sobrante T0 · '+tag);
      ok(near(b.t2,Math.max(0,pres*(1-p.topeT0-p.topeT1)+(b.t1-T.ancla.costo))),'bolsa T2 = pres×General + sobrante T1 · '+tag);
      ok(near(r.presupuestoRestante,b.t2-T.general.costo),'restante = bolsa T2 − gasto T2 · '+tag);
      ok(T.cero_rapido.costo<=b.t0+1e-6 && T.ancla.costo<=b.t1+1e-6 && T.general.costo<=b.t2+1e-6,'ningún tramo excede su bolsa · '+tag);
    }
  }
  // Saturación: arriba de la necesidad, más presupuesto no cambia el pedido (es tope, no meta)
  for(const motor of ['pulido','clasico']){
    const pInf={...BASE,motor,presupuesto:1e9}; const rInf=C.optimizarPedido(d.articulos,pInf);
    const nec=rInf.necesidadTotal;
    for(const pres of PRES) if(pres>=nec){
      const r=C.optimizarPedido(d.articulos,{...pInf,presupuesto:pres});
      ok(sig(r)===sig(rInf),`${dn} ${motor} pres=${pres} ≥ necesidad ${Math.round(nec)}: pedido idéntico a presupuesto ilimitado`);
      ok(near(r.presupuestoRestante,pres-nec),`${dn} ${motor} pres=${pres}: sobrante = pres − necesidad`);
    }
    console.log(`${dn} · ${motor} · necesidad total (30d, A+B): $${Math.round(nec).toLocaleString('es-MX')}`);
  }
}

/* ── 2. Equivalencia contra motores de referencia a montos altos ── */
for(const [dn,d] of Object.entries(datasets)){
  const O=loadCalc(OLD,d), N=loadCalc(NEW,d);
  for(const pres of [1200000,1600000,2000000]) for(const bl of [true,false]) for(const vz of ['off','info','lim']) for(const abc of [['A','B'],['A','B','C']]) for(const dias of [30,60]){
    const p={presupuesto:pres,leadTime:5,diasCoberturaMeta:dias,factorSS:1.0,filtroABC:abc,soloConDemanda:true,usarVazlo:vz!=='off',limitarVazlo:vz==='lim',blindaje:bl,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200};
    const ro=O.optimizarPedido(d.articulos,p), rn=N.optimizarPedido(d.articulos,{...p,motor:'clasico'});
    ok(sig(ro)===sig(rn)&&ro.totalCosto===rn.totalCosto&&ro.presupuestoRestante===rn.presupuestoRestante,`${dn} clásico == original pres=${pres} bl=${bl} vz=${vz} abc=${abc} dias=${dias}`);
  }
}
{
  const d=datasets.aldia; const N=loadCalc(NEW,d); const key=a=>a.map(x=>`${x.clave}|${x.cantFinal}|${x.tramo}`).join('\n');
  for(const pres of [1200000,1600000,2000000]) for(const dias of [20,30,60]) for(const lim of [false,true]) for(const piso of [true,false]){
    const p={presupuesto:pres,leadTime:5,diasCoberturaMeta:dias,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:true,limitarVazlo:lim,blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,pisoAB:piso};
    ok(key(N.optimizarPedido(d.articulos,{...p,motor:'pulido'}).pedido)===key(E2(d.articulos,{...p,ssMode:'real',rapido:'dpd',orden:'riesgo'},{monthly:{}}).pedido),`pulido == simulación validada pres=${pres} dias=${dias} lim=${lim} piso=${piso}`);
  }
}

/* ── 3. Saneo de entradas en el motor ── */
{
  const d=datasets.github; const C=loadCalc(NEW,d);
  for(const bad of [NaN,undefined,null,'abc',-5,0]){
    const r=C.optimizarPedido(d.articulos,{...BASE,presupuesto:bad});
    ok(r.totalCosto===0&&r.presupuestoRestante===0&&r.pedido.length===0&&!Number.isNaN(r.pctUsado),`presupuesto inválido (${String(bad)}) → pedido vacío sin NaN`);
  }
  ok(sig(C.optimizarPedido(d.articulos,{...BASE,presupuesto:'2000000'}))===sig(C.optimizarPedido(d.articulos,{...BASE,presupuesto:2000000})),'presupuesto como texto "2000000" = número');
  const a=C.optimizarPedido(d.articulos,{...BASE,presupuesto:2e6,topeT0:0.8,topeT1:0.5}), b=C.optimizarPedido(d.articulos,{...BASE,presupuesto:2e6,topeT0:0.8,topeT1:0.2});
  ok(sig(a)===sig(b)&&near(a.presupuestoRestante,b.presupuestoRestante)&&a.diagnostico.bolsas.t2>=0,'topes T0+T1 > 100% se recortan (General no queda negativo)');
}

/* ── 4. UI (jsdom) ── */
const vc=new (require('jsdom').VirtualConsole)(); vc.on('jsdomError',e=>console.log('JSDOM ERR',e.message));
const dom=new JSDOM(`<!DOCTYPE html><body><div id="page-compra"></div></body>`,{runScripts:'outside-only',virtualConsole:vc}); const w=dom.window;
w.alert=()=>{}; let blobs=[]; w.URL.createObjectURL=b=>{blobs.push(b);return 'blob:x';}; w.URL.revokeObjectURL=()=>{};
for(const f of ['utils/formatters.js','data/cedi_data.js','utils/calculations.js','utils/exportPedido.js','components/compra.js']) w.eval(fs.readFileSync(NEW+f,'utf8'));
w.ExcelJS=require('exceljs'); w.Blob=require('buffer').Blob; w.HTMLAnchorElement.prototype.click=function(){};
const $=i=>w.document.getElementById(i); const wait=ms=>new Promise(r=>setTimeout(r,ms));
const fire=(el,ev)=>el.dispatchEvent(new w.Event(ev));
const total=()=>w.document.querySelector('#result-panel-wrap .rp-value').textContent;
(async()=>{
  const PC=w.PageCompra; const F=w.FMT;
  PC.render();
  const sl=$('sl-presupuesto'), inp=$('in-presupuesto');
  ok(PC.LIM_PRES.max===2000000&&PC.LIM_PRES.min===50000,'límites del presupuesto = $50K–$2M');
  ok(sl.max==='2000000'&&sl.min==='50000'&&sl.step==='10000','slider con máximo 2,000,000');
  ok(w.document.querySelector('#page-compra .slider-max').textContent==='$2M','etiqueta máxima $2M',w.document.querySelector('#page-compra .slider-max').textContent);
  ok(inp&&inp.max==='2000000'&&inp.value==='700000','caja de monto exacto presente con $700,000');
  ok($('val-presupuesto').textContent==='$700,000','arranca en $700,000 (base de medición)');
  // slider al tope
  sl.value='2000000'; fire(sl,'input');
  ok(sl.value==='2000000','el slider acepta 2,000,000',sl.value);
  ok($('val-presupuesto').textContent==='$2,000,000'&&PC.estado().presupuesto===2000000&&inp.value==='2000000','slider $2M → etiqueta, estado y caja sincronizados');
  $('btn-calcular').click(); await wait(300);
  const direct=w.CALC.optimizarPedido(w.CEDI_DATA.articulos,PC.estado());
  ok(PC.estado().presupuesto===2000000,'el motor recibe 2,000,000');
  ok(total()===F.compact(direct.totalCosto),'panel = motor directo a $2M',total()+' vs '+F.compact(direct.totalCosto));
  ok(/del presupuesto utilizado/.test(w.document.querySelector('#result-panel-wrap .rp-sub').textContent),'muestra % usado');
  ok(!!$('aviso-sobrante')===(direct.presupuestoRestante>=1000 && direct.tramos.every(t=>t.fueraArts===0)),'aviso de presupuesto sobrante coherente con el resultado');
  ok(!!$('aviso-sobrante'),'a $2M con 30d A+B la necesidad es menor: se avisa el sobrante');
  // caja de monto exacto
  inp.value='1755500'; fire(inp,'input'); fire(inp,'change');
  ok(PC.estado().presupuesto===1755500&&$('val-presupuesto').textContent==='$1,755,500','monto exacto $1,755,500 se respeta al peso');
  inp.value='5000000'; fire(inp,'input'); fire(inp,'change');
  ok(PC.estado().presupuesto===2000000&&inp.value==='2000000','monto > $2M se topa a $2M');
  inp.value='-10'; fire(inp,'change');
  ok(PC.estado().presupuesto===50000&&inp.value==='50000','monto negativo → mínimo $50K');
  inp.value='1500000'; fire(inp,'change'); inp.value=''; fire(inp,'input'); fire(inp,'change');
  ok(PC.estado().presupuesto===1500000&&inp.value==='1500000','caja vacía conserva el valor vigente');
  ok(PC.sanearPresupuesto('$1,250,000')===1250000&&PC.sanearPresupuesto('1234567.6')===1234568,'saneo de texto con $ y comas, redondeo a peso');
  // persistencia al navegar (re-render): antes el slider volvía a $700K mientras el cálculo usaba otro monto
  inp.value='1750000'; fire(inp,'change');
  $('sl-cobertura').value='45'; fire($('sl-cobertura'),'input');
  w.document.querySelector('#lt-buttons .lt-btn[data-lt="9"]').click();
  $('abc-C').checked=true; fire($('abc-C'),'change');
  PC.render();   // = salir y volver a Compra Inteligente
  ok($('sl-presupuesto').value==='1750000'&&$('val-presupuesto').textContent==='$1,750,000'&&$('in-presupuesto').value==='1750000','re-render conserva el presupuesto en pantalla',$('val-presupuesto').textContent);
  ok($('sl-cobertura').value==='45'&&$('val-cobertura').textContent==='45 días','re-render conserva días de cobertura');
  ok(w.document.querySelector('#lt-buttons .lt-btn.active').dataset.lt==='9'&&/×1\.20/.test($('lt-factor-label').textContent),'re-render conserva lead time y su factor');
  ok($('abc-C').checked&&$('abc-A').checked&&!$('abc-D').checked,'re-render conserva filtro ABC');
  $('btn-calcular').click(); await wait(300);
  const d2=w.CALC.optimizarPedido(w.CEDI_DATA.articulos,{...PC.estado()});
  ok(PC.estado().presupuesto===1750000&&PC.estado().diasCoberturaMeta===45&&PC.estado().leadTime===9,'lo que se ve = lo que calcula');
  ok(total()===F.compact(d2.totalCosto),'panel tras re-render = motor directo',total());
  // exportación enriquecida a $2M
  inp.value='2000000'; fire(inp,'change'); $('btn-calcular').click(); await wait(300);
  const rUI=w.CALC.optimizarPedido(w.CEDI_DATA.articulos,PC.estado());
  $('btn-export-pedido').click(); for(let i=0;i<80&&!blobs.length;i++) await wait(100);
  ok(blobs.length===1,'exporta el Excel a $2M');
  const wb=new (require('exceljs').Workbook)(); await wb.xlsx.load(Buffer.from(await blobs[0].arrayBuffer()));
  const res=wb.getWorksheet('Resumen'); let presCell=null, restCell=null, pctCell=null;
  res.eachRow(row=>{ const k=row.getCell(2).value; if(k==='Presupuesto') presCell=row.getCell(3).value; if(k==='Presupuesto restante') restCell=row.getCell(3).value; if(k==='% del presupuesto usado') pctCell=row.getCell(3).value; });
  ok(presCell===2000000,'Resumen: Presupuesto = 2,000,000',presCell);
  ok(near(restCell,rUI.presupuestoRestante)&&near(pctCell,rUI.pctUsado/100,1e-9),'Resumen: restante y % usado = motor');
  ok(String(wb.getWorksheet('Pedido').getCell('A1').value).includes('de $2,000,000'),'título hoja Pedido menciona $2,000,000',wb.getWorksheet('Pedido').getCell('A1').value);
  ok(wb.getWorksheet('Pedido').rowCount-3===rUI.totalArts,'hoja Pedido = artículos del motor');
  // reset
  $('btn-reset').click(); await wait(20);
  ok($('val-presupuesto').textContent==='$700,000'&&$('sl-presupuesto').value==='700000'&&PC.estado().presupuesto===700000,'Resetear vuelve a $700,000');
  console.log('combinaciones de motor evaluadas:',combos);
  process.exit(report('T8 Presupuesto parametrizable hasta $2M')?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
