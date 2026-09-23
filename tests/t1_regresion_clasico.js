// El motor clásico (motor ausente o 'clasico') debe ser IDÉNTICO al calculations.js original
const {loadCalc,loadData,alDia,sig,ok,report,NEW,OLD}=require('./helpers');
const base=loadData(); const datasets={github:base, aldia:alDia(base)};
let n=0;
for(const [dn,d] of Object.entries(datasets)){
  const O=loadCalc(OLD,d), N=loadCalc(NEW,d);
  for(const pres of [50000,300000,600000,800000,1500000,1e9])
  for(const lt of [3,5,9,15])
  for(const dias of [7,20,30,60])
  for(const bl of [true,false])
  for(const vz of ['off','info','lim'])
  for(const abc of [['A','B'],['A','B','C'],['A']]){
    const p={presupuesto:pres,leadTime:lt,diasCoberturaMeta:dias,factorSS:1.0,filtroABC:abc,soloConDemanda:true,usarVazlo:vz!=='off',limitarVazlo:vz==='lim',
      blindaje:bl,blindajeAlcance:dias===20?['A','B']:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200};
    const ro=O.optimizarPedido(d.articulos,p);
    for(const m of [undefined,'clasico']){
      const rn=N.optimizarPedido(d.articulos,m?{...p,motor:m}:p); n++;
      ok(sig(ro)===sig(rn) && ro.totalCosto===rn.totalCosto && ro.presupuestoRestante===rn.presupuestoRestante && JSON.stringify(ro.tramos||null)===JSON.stringify(rn.tramos||null),
        `${dn} pres=${pres} lt=${lt} dias=${dias} bl=${bl} vz=${vz} abc=${abc} motor=${m}`);
    }
  }
  // funciones auxiliares
  for(const dpd of [0.01,0.2,0.79,3]) for(const lt of [3,5,15]) ok(O.stockSeguridad(dpd,lt,1)===N.stockSeguridad(dpd,lt,1),`ss ${dpd} ${lt}`);
  const eo=O.articulosEnRiesgo(d.articulos,5,14), en=N.articulosEnRiesgo(d.articulos,5,14);
  ok(JSON.stringify(eo)===JSON.stringify(en),`articulosEnRiesgo ${dn}`);
}
console.log('combinaciones comparadas:',n);
process.exit(report('T1 Regresión motor clásico vs original')?0:1);
