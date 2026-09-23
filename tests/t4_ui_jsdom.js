const {JSDOM}=require('jsdom'); const fs=require('fs');
const {ok,report,NEW}=require('./helpers');
const {VirtualConsole}=require('jsdom'); const vc=new VirtualConsole(); vc.on('jsdomError',e=>console.log('JSDOM ERR',e.message)); vc.on('error',e=>console.log('ERR',e));
const dom=new JSDOM(`<!DOCTYPE html><body><div id="page-compra"></div></body>`,{runScripts:'outside-only',virtualConsole:vc});
const w=dom.window; const exported={};
w.XLSX={utils:{book_new:()=>({s:[]}),json_to_sheet:r=>({rows:r}),book_append_sheet:(wb,ws,n)=>{exported[n]=ws.rows;}},writeFile:(wb,f)=>{exported.file=f;}};
w.alert=()=>{};
for(const f of ['utils/formatters.js','data/cedi_data.js','utils/calculations.js','components/compra.js']) w.eval(fs.readFileSync(NEW+f,'utf8'));
const $=id=>w.document.getElementById(id);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  w.PageCompra.render();
  ok(!!$('motor-panel'),'panel de motor renderizado');
  const act=w.document.querySelector('.motor-btn.active'); ok(act && act.dataset.motor==='pulido','default = motor pulido');
  ok($('opt-piso') && $('opt-piso').checked,'piso A/B activo por default');
  $('btn-calcular').click(); await wait(200);
  const lbl=()=>w.document.querySelector('#result-panel-wrap .rp-label').textContent;
  ok(/Motor pulido/.test(lbl()),'panel muestra motor pulido',lbl());
  ok(/Necesidad total calculada/.test(w.document.querySelector('#result-panel-wrap .rp-sub').textContent),'muestra necesidad total');
  ok(w.document.querySelectorAll('#tabla-pedido-content tbody tr').length>0,'tabla de pedido con renglones');
  // export
  $('btn-export-pedido').click();
  ok(exported.Pedido && 'Venta en Riesgo $' in exported.Pedido[0],'export incluye Venta en Riesgo');
  ok(exported['Parámetros'].some(r=>r['Parámetro']==='Motor de cálculo'&&r.Valor==='PULIDO'),'export registra motor');
  const nPul=exported.Pedido.length;
  // ordenar por riesgo
  $('sort-pedido').value='riesgo'; $('sort-pedido').dispatchEvent(new w.Event('change')); await wait(20);
  ok(w.document.querySelectorAll('#tabla-pedido-content tbody tr').length>0,'orden por riesgo funciona');
  // cambiar a clásico → recalcula y coincide con el motor clásico directo
  w.document.querySelector('.motor-btn[data-motor="clasico"]').click(); await wait(200);
  ok(/Motor clásico/.test(lbl()),'cambia a motor clásico',lbl());
  ok(!$('opt-piso') || $('piso-wrap').style.display==='none','piso oculto en clásico');
  $('btn-export-pedido').click();
  const direct=w.CALC.optimizarPedido(w.CEDI_DATA.articulos,{presupuesto:700000,leadTime:5,diasCoberturaMeta:30,factorSS:1.0,filtroABC:['A','B'],soloConDemanda:true,usarVazlo:false,limitarVazlo:false,blindaje:true,blindajeAlcance:['A'],topeT0:0.70,topeT1:0.15,topAnclaN:200,motor:'clasico'});
  ok(exported.Pedido.length===direct.totalArts,'UI clásico = motor clásico directo',exported.Pedido.length+' vs '+direct.totalArts);
  ok(!('Venta en Riesgo $' in exported.Pedido[0]),'clásico sin columna de riesgo');
  // piso apagado reduce/altera el pedido pulido
  w.document.querySelector('.motor-btn[data-motor="pulido"]').click(); await wait(200);
  $('opt-piso').checked=false; $('opt-piso').dispatchEvent(new w.Event('change')); $('btn-calcular').click(); await wait(200);
  $('btn-export-pedido').click();
  ok(exported['Parámetros'].some(r=>r['Parámetro']==='Piso 1 pz A/B'&&r.Valor==='NO'),'export registra piso apagado');
  // reset regresa a defaults
  $('btn-reset').click(); await wait(20);
  ok(w.document.querySelector('.motor-btn.active').dataset.motor==='pulido' && $('opt-piso').checked,'reset vuelve a pulido + piso');
  // Bug corregido: clic en alcance del blindaje / motor ya no rompe el lead time
  w.document.querySelector('.blindaje-scope[data-scope="AB"]').click();
  w.document.querySelector('.motor-btn[data-motor="clasico"]').click(); await wait(200);
  w.document.querySelector('.motor-btn[data-motor="pulido"]').click(); await wait(200);
  $('btn-calcular').click(); await wait(200);
  ok(/Lead time 5 días/.test(lbl()),'lead time intacto tras clic en alcance/motor',lbl());
  ok([...w.document.querySelectorAll('#lt-buttons .lt-btn.active')].map(b=>b.dataset.lt).join()==='5','botón LT activo se conserva');
  w.document.querySelector('#lt-buttons .lt-btn[data-lt="9"]').click(); $('btn-calcular').click(); await wait(200);
  ok(/Lead time 9 días/.test(lbl()),'botón de lead time sigue funcionando',lbl());
  console.log('pedido UI pulido (defaults UI $700K/30d):',nPul,'SKUs · clásico:',direct.totalArts);
  process.exit(report('T4 UI (jsdom) Compra Inteligente')?0:1);
})();
