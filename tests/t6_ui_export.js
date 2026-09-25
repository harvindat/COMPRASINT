// UI: botón "↓ Excel" usa la exportación enriquecida; si falla, cae a la básica
const {JSDOM}=require('jsdom'); const fs=require('fs'); const {ok,report,NEW}=require('./helpers');
const dom=new JSDOM(`<!DOCTYPE html><body><div id="page-compra"></div></body>`,{runScripts:'outside-only'}); const w=dom.window;
let blobs=[], basica=0, alerts=[];
w.URL.createObjectURL=b=>{blobs.push(b);return 'blob:x';}; w.URL.revokeObjectURL=()=>{};
w.alert=m=>alerts.push(m);
w.XLSX={utils:{book_new:()=>({}),json_to_sheet:r=>({rows:r}),book_append_sheet:()=>{}},writeFile:()=>{basica++;}};
for(const f of ['utils/formatters.js','data/cedi_data.js','utils/calculations.js','utils/exportPedido.js','components/compra.js']) w.eval(fs.readFileSync(NEW+f,'utf8'));
w.ExcelJS=require('exceljs'); w.Blob=require('buffer').Blob; w.HTMLAnchorElement.prototype.click=function(){};           // en el navegador se carga del CDN al exportar
const wait=ms=>new Promise(r=>setTimeout(r,ms)); const $=i=>w.document.getElementById(i);
(async()=>{
  w.PageCompra.render(); $('btn-calcular').click(); await wait(300);
  $('btn-export-pedido').click();
  ok($('btn-export-pedido').disabled && /Generando/.test($('btn-export-pedido').textContent),'botón muestra "Generando Excel…" mientras exporta');
  for(let i=0;i<60 && !blobs.length;i++) await wait(100);
  ok(blobs.length===1 && blobs[0].size>100000,'descarga el libro enriquecido', blobs[0]&&blobs[0].size);
  ok(basica===0 && alerts.length===0,'no usa la exportación básica');
  await wait(50); ok(!$('btn-export-pedido').disabled && /Excel/.test($('btn-export-pedido').textContent),'botón se restablece');
  // el libro descargado se puede abrir y trae las 5 hojas
  const buf=Buffer.from(await blobs[0].arrayBuffer()); const wb=new (require('exceljs').Workbook)(); await wb.xlsx.load(buf);
  ok(wb.worksheets.map(x=>x.name).join('|')==='Resumen|Pedido|Análisis completo|Fuera por presupuesto|Metodología','libro con 5 hojas');
  // fallback: si el módulo falla, alerta y descarga la básica
  w.EXPORT_PEDIDO.exportar=async()=>{throw new Error('CDN caído');};
  $('btn-export-pedido').click(); await wait(200);
  ok(basica===1 && /CDN caído/.test(alerts[0]||''),'fallback a exportación básica con aviso');
  process.exit(report('T6 UI exportación')?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
