// El motor pulido en producción debe reproducir la simulación validada (engine2, V5piso)
const {loadCalc,loadData,alDia,ok,report,NEW}=require('./helpers');
const E2=require('./fixtures/engine2_referencia.js'); const monthly=require('./fixtures/ventas_mes_bdharvin.json');
const d=alDia(loadData()); const N=loadCalc(NEW,d);
const key=arr=>arr.map(x=>`${x.clave}|${x.cantFinal}|${x.tramo}`).join('\n');
function prod(p,conMes){ const arts=conMes? d.articulos.map(a=>({...a,ventas_mes:monthly[a.clave]})) : d.articulos; return N.optimizarPedido(arts,{...p,motor:'pulido'}); }
function sim(p,conMes){ return E2(d.articulos,{...p,ssMode:'real',rapido:'dpd',orden:'riesgo'},{monthly:conMes?monthly:{}}); }
let n=0;
for(const pres of [100000,300000,600000,800000,1e9])
for(const lt of [5,9]) for(const dias of [20,30])
for(const piso of [true,false]) for(const lim of [false,true]) for(const conMes of [false,true]){
  const p={presupuesto:pres,leadTime:lt,diasCoberturaMeta:dias,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:true,limitarVazlo:lim,
    blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,pisoAB:piso};
  const a=prod(p,conMes), b=sim(p,conMes); n++;
  ok(key(a.pedido)===key(b.pedido),`pres=${pres} lt=${lt} dias=${dias} piso=${piso} lim=${lim} mes=${conMes}`, `${a.pedido.length} vs ${b.pedido.length}`);
}
// Cifras de referencia (600K, 20 días, V5piso)
const p6={presupuesto:600000,leadTime:5,diasCoberturaMeta:20,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:true,limitarVazlo:true,blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,pisoAB:true};
const r1=prod(p6,false), r2=prod(p6,true);
console.log('600K pulido sin ventas_mes (Poisson):',Math.round(r1.totalCosto),r1.totalArts,'SKUs |',JSON.stringify(r1.tramos.map(t=>[t.id,t.arts,Math.round(t.costo)])));
console.log('600K pulido con ventas_mes (σ real):',Math.round(r2.totalCosto),r2.totalArts,'SKUs | necesidad total',Math.round(r2.necesidadTotal));
const rS=N.optimizarPedido(d.articulos,{...p6,motor:'pulido',pisoAB:false});
console.log('600K pulido sin piso:',Math.round(rS.totalCosto),rS.totalArts,'SKUs · restante',Math.round(rS.presupuestoRestante));
console.log('combinaciones:',n);
process.exit(report('T2 Motor pulido == simulación validada')?0:1);
