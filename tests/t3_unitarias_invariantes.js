const {loadCalc,loadData,alDia,ok,report,NEW}=require('./helpers');
const d=alDia(loadData()); const C=loadCalc(NEW,d);
const P={presupuesto:600000,leadTime:5,diasCoberturaMeta:20,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:true,limitarVazlo:false,blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,motor:'pulido',pisoAB:true};
const art=(o)=>({clave:'X',abc:'A',dpd:0,existencia:0,costo_iva:100,unidades_total:0,venta_total:0,score_compra:50,...o});
// --- SS pulido
ok(Math.abs(C.stockSeguridadPulido(0.79,5,1)-1.65*Math.sqrt(0.79*5))<1e-9,'SS Poisson');
ok(C.stockSeguridadPulido(0.79,5,1,[20,30,10,40,25,15,35,15]) > 1.65*Math.sqrt(0.79*5),'SS usa variabilidad mensual si es mayor');
ok(Math.abs(C.stockSeguridadPulido(0.02,5,1,[1,0,1,0,0,0,0,0])-1.65*Math.sqrt(0.1))<1e-9,'SS ignora ventas_mes con <8 pz');
ok(!Number.isInteger(C.stockSeguridadPulido(0.3,5,1)),'SS pulido no se redondea');
ok(Math.abs(C.stockSeguridadPulido(0.5,5,2)-2*C.stockSeguridadPulido(0.5,5,1))<1e-9,'factorSS escala lineal');
// --- objetivo y piso
const lento=u=>art({dpd:2/237,unidades_total:2,venta_total:3000,abc:u});
ok(C.calcularArticulo(lento('A'),P).cantPedir===1,'A lento en cero: piso 1 pz');
ok(C.calcularArticulo(lento('B'),P).cantPedir===1,'B lento en cero: piso 1 pz');
ok(C.calcularArticulo(lento('C'),P).cantPedir===0,'C lento: sin piso');
ok(C.calcularArticulo(lento('A'),{...P,pisoAB:false}).cantPedir===0,'piso apagado: 0');
ok(C.calcularArticulo(lento('A'),{...P,motor:'clasico'}).cantPedir===2,'clásico conserva objetivo 2 pz');
ok(C.calcularArticulo({...lento('A'),existencia:1},P).cantPedir===0,'A lento con 1 pz: no compra');
const rapido=art({dpd:0.79,unidades_total:187,venta_total:187*300,existencia:5});
const cr=C.calcularArticulo(rapido,P);
ok(cr.stockObj===Math.round(0.79*20+1.65*Math.sqrt(0.79*5)) && cr.cantPedir===cr.stockObj-5,'rápido: objetivo = round(DPD·20 + SS)', JSON.stringify(cr));
ok(Math.abs(cr.riesgo-(0.79*20-5)*300)<1e-6,'venta en riesgo = (DPD·20 − existencia)·precio');
ok(C.calcularArticulo({...rapido,existencia:50},P).riesgo===0,'sin riesgo si existencia cubre');
ok(C.calcularArticulo(art({dpd:0}),P).cantPedir===0,'sin demanda: 0');
ok(C.calcularArticulo(art({dpd:1,costo_iva:0}),P).cantPedir===0,'sin costo: 0');
ok(C.calcularArticulo(art({dpd:1,unidades_total:0}),P).riesgo===0,'precio 0 sin unidades: riesgo 0');
// --- mediana DPD por clase
const med=C.medianaDpdPorClase([art({abc:'A',dpd:1}),art({abc:'A',dpd:3}),art({abc:'A',dpd:0}),art({abc:'B',dpd:2})]);
ok(med.A===2 && med.B===2 && med.C===0,'mediana DPD ignora ceros', JSON.stringify(med));
// --- invariantes en el dataset real
const rnd=(()=>{let s=7;return()=>(s=(s*16807)%2147483647)/2147483647;})();
for(let i=0;i<150;i++){
  const p={...P,presupuesto:Math.round(20000+rnd()*1500000),diasCoberturaMeta:7+Math.floor(rnd()*54),leadTime:[3,5,9,15][Math.floor(rnd()*4)],
    factorSS:0.5+Math.round(rnd()*15)/10,limitarVazlo:rnd()<0.5,blindaje:rnd()<0.8,pisoAB:rnd()<0.7,
    filtroABC:[['A','B'],['A','B','C'],['A']][Math.floor(rnd()*3)],blindajeAlcance:[['A'],['A','B'],['A','B','C']][Math.floor(rnd()*3)]};
  const r=C.optimizarPedido(d.articulos,p); const tag=JSON.stringify({pres:p.presupuesto,dias:p.diasCoberturaMeta,lt:p.leadTime,bl:p.blindaje,lim:p.limitarVazlo});
  ok(r.totalCosto<=p.presupuesto+1e-6,'nunca excede presupuesto '+tag);
  ok(Math.abs(r.totalCosto+r.presupuestoRestante-p.presupuesto)<1e-3,'costo + restante = presupuesto '+tag);
  ok(new Set(r.pedido.map(x=>x.clave)).size===r.pedido.length,'sin claves duplicadas '+tag);
  ok(r.pedido.every(x=>x.cantFinal>0 && Number.isInteger(x.cantFinal) && x.cantFinal<=x.cantPedir),'cantidades enteras, >0 y ≤ necesidad '+tag);
  if(p.limitarVazlo) ok(r.pedido.every(x=>x.cantFinal<=(x.existenciaVazlo||0)),'limitado: ≤ stock Vazlo '+tag);
  ok(r.necesidadTotal>=r.totalCosto-1e-6,'necesidad total ≥ pedido '+tag);
  if(r.presupuestoRestante>1e6) ok(true,'');
  if(p.blindaje){ const ord=r.pedido.map(x=>({cero_rapido:0,ancla:1,general:2})[x.tramo]); ok(ord.every((v,i)=>i===0||v>=ord[i-1]),'orden de tramos T0→T1→T2 '+tag); }
  // dentro de T2 el orden financiado respeta venta en riesgo (no-creciente)
  const t2=r.pedido.filter(x=>x.tramo==='general'); ok(t2.every((x,i)=>i===0||x.riesgo<=t2[i-1].riesgo+1e-9),'T2 ordenado por riesgo '+tag);
  if(!p.pisoAB) ok(r.pedido.every(x=>x.dpd*Math.ceil(p.diasCoberturaMeta*C.factorLeadTime(p.leadTime))>=0.5 || x.cantFinal===0),'sin piso: no compra demanda < 0.5 pz '+tag);
}
// sobra presupuesto cuando la necesidad es menor (tope, no meta)
const big=C.optimizarPedido(d.articulos,{...P,presupuesto:5e6});
ok(big.presupuestoRestante>0 && Math.abs(big.totalCosto-big.necesidadTotal)<1e-3,'con presupuesto sobrado compra exactamente la necesidad');
process.exit(report('T3 Unitarias + invariantes motor pulido')?0:1);
