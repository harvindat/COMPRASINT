// T9 · Validador de archivos ERP (Actualizar Datos)
// Reportes sintéticos con el MISMO layout que exporta el ERP (Microsip). Se rompen a
// propósito de cada forma que el validador debe detectar y se verifica que:
//   · el error se reporta en el archivo correcto y BLOQUEA la integración
//   · los avisos NO bloquean
//   · con archivos correctos el dataset es idéntico al pipeline sin validador
//   · la UI marca la casilla, bloquea "Procesar" y muestra el panel de validación
const fs=require('fs'), vm=require('vm'), XLSX=require('xlsx'), {JSDOM}=require('jsdom');
const {ok,report,NEW}=require('./helpers');

/* ── Constructores de reportes (layout real) ── */
const N=null, fill=(n)=>Array(n).fill(N);
const serial=(y,m,d)=>Date.UTC(y,m-1,d)/86400000+25569;
const ARTS=[]; for(let i=1;i<=60;i++) ARTS.push({clave:'10-'+String(i).padStart(3,'0'),nombre:'ARTICULO '+i,linea:i%2?'SOPORTE':'HORQUILLA',ex:i%3===0?0:i,costo:100+i,sal:i*2,rot:i/10,venta:i*500,uds:i});
function articulos(o={}){ const rows=[['Clave','Nombre','Línea','U.med.','U.compra','Clave SAT','Almacenable','Juego','Ultima compra','Estatus']];
  (o.arts||ARTS).forEach(a=>rows.push([a.clave,a.nombre,a.linea,'PIEZA','PIEZA','25172001','S','N',N,'Activo'])); if(o.mut) o.mut(rows); return rows; }
function exival(o={}){ const fecha=o.fecha||'Al 23 de octubre del 2026';
  const rows=[['HARVIN DISTRIBUCIONES'],['Existencia y valor del inventario'],[fecha],['Valuación: Último costo'],
    ['Artículo',...fill(6),'U. med.',N,N,N,'Existencia',N,'Último costo',N,N,'Valor total'],fill(17)];
  let arts=(o.arts||ARTS); if(o.sinCeros) arts=arts.filter(a=>a.ex>0);
  let sEx=0,sVal=0; arts.forEach(a=>{ rows.push([a.clave,N,a.nombre,...fill(4),'PIEZA',N,N,N,a.ex,N,a.costo,N,N,a.ex*a.costo]); sEx+=a.ex; sVal+=a.ex*a.costo; });
  rows.push([`Total ${arts.length.toLocaleString('en-US')} artículos`,...fill(10),sEx,N,0,N,N,sVal]);
  const ceros=arts.filter(a=>a.ex===0).length; if(ceros) rows.push([`${ceros.toLocaleString('en-US')} artículos sin existencia`]);
  if(o.mut) o.mut(rows); return rows; }
function rotinv(o={}){ const rows=[['HARVIN DISTRIBUCIONES'],['Rotación del inventario'],[o.fecha||'Del 1 de enero al 23 de octubre del 2026'],
    ['Artículo',...fill(8),'U. med.',N,N,N,'Salidas',N,N,'Inventario promedio',N,'Rotación'],fill(19)];
  let s=0; ARTS.forEach((a,i)=>{ rows.push([a.clave,N,a.nombre,...fill(6),'PIEZA',N,N,N,a.sal,N,N,a.sal/(a.rot||1),N,(o.rotTotal&&i<3)?'Total':a.rot]); s+=a.sal; });
  rows.push([`Total ${ARTS.length} artículos`,...fill(12),s,N,N,0,N,0]); if(o.mut) o.mut(rows); return rows; }
function compras(o={}){ const rows=[['HARVIN DISTRIBUCIONES'],['Diarios del inventario'],[o.fecha||'Del 1 de enero al 23 de octubre del 2026'],['Concepto: Recepción de mercancía'],
    ['Fecha','Folio',N,'Descripción',...fill(8),'Unidades',N,N,N,'Costo unitario',N,'Costo total']];
  let tot=0,nd=0; for(let d=0;d<10;d++){ const lines=ARTS.slice(d*6,d*6+6); const t=lines.reduce((s,a)=>s+3*a.costo,0); nd++; tot+=t;
    rows.push([serial(2026,1+d,5),'RC'+(100+d),...fill(10),18,N,N,N,t/18,N,t]);
    lines.forEach(a=>rows.push([N,N,N,a.nombre,...fill(8),3,'PIEZA',N,N,a.costo,N,3*a.costo])); }
  rows.push([`Total ${nd} documentos`,...fill(11),0,N,N,N,0,N,tot]); if(o.mut) o.mut(rows); return rows; }
function ventas(o={}){ const rows=[[...fill(9),'HARVIN DISTRIBUCIONES'],[...fill(9),'Ventas por cliente'],fill(18),['Tipo cliente: Todos'],[o.fecha||'Periodo del 01/ene./2026 al 23/oct./2026'],['Cliente'],fill(18)];
  const cl=[['1001','CLIENTE UNO',0],['1002','CLIENTE DOS',1],['1003','CLIENTE TRES',2],['1004','CLIENTE CUATRO',3],['1005','CLIENTE CINCO',4]];
  cl.forEach(([id,nom,k])=>{ rows.push([id,N,N,nom,...fill(14)]); rows.push(['Artículo',...fill(11),'Venta',N,N,N,'Unidades',N]);
    let s=0; ARTS.filter((a,i)=>i%5===k).forEach(a=>{ rows.push([a.clave,N,N,N,a.nombre,...fill(9),a.venta,N,a.uds,N]); s+=a.venta; });
    rows.push([...fill(12),'Total '+nom,N,s,N,N,N]); rows.push(fill(18)); });
  if(o.mut) o.mut(rows); return rows; }

const libro=rows=>{ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Report'); return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}); };
const archivo=(name,buf)=>({name,size:buf.length,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length)});
const SET=(o={})=>({ARTICULOS:archivo('Artículos.xlsx',libro(o.ARTICULOS||articulos())),EXIVAL:archivo('EXIVAL.xlsx',libro(o.EXIVAL||exival())),
  ROTINV:archivo('ROTINV.xlsx',libro(o.ROTINV||rotinv())),COMPRAS:archivo('COMPRAS.xlsx',libro(o.COMPRAS||compras())),VECLIEARTS:archivo('VECLIEARTS.xlsx',libro(o.VECLIEARTS||ventas())),...(o.extra||{})});

/* ── Motor de procesamiento (mismo código del navegador) ── */
function contexto(conValidador=true){ const ctx={window:{},console,Math,JSON,Date,XLSX}; vm.createContext(ctx);
  if(conValidador) vm.runInContext(fs.readFileSync(NEW+'utils/validador.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync(NEW+'utils/dataProcessor.js','utf8'),ctx); return ctx.window; }
const W=contexto();
async function procesar(set,corte){ try{ const r=await W.DataProcessor.processFiles(set,corte); return {ok:true,...r}; } catch(e){ return {ok:false,err:e,validacion:e.validacion}; } }
const errs=(v,k)=>((k==='CRUCES'?v.cruces:v.archivos[k])||{errores:[]}).errores.join(' | ');
const avs=(v,k)=>((k==='CRUCES'?v.cruces:v.archivos[k])||{avisos:[]}).avisos.join(' | ');
async function caso(nombre,set,key,re,opts={}){
  const r=await procesar(set,opts.corte);
  if(opts.aviso){ ok(r.ok,`${nombre}: no bloquea`, r.err&&r.err.message+' '+JSON.stringify(r.validacion&&r.validacion.archivos[key]&&r.validacion.archivos[key].errores));
    if(r.ok) ok(re.test(avs(r.validacion,key)),`${nombre}: aviso en ${key}`, avs(r.validacion,key)); return r; }
  ok(!r.ok && !!r.validacion,`${nombre}: BLOQUEA la integración`, r.ok?'se integró':r.err&&r.err.message);
  if(r.validacion) ok(re.test(errs(r.validacion,key)),`${nombre}: error en ${key}`, errs(r.validacion,key)||JSON.stringify(Object.fromEntries(Object.entries(r.validacion.archivos).map(([k,v])=>[k,v.errores]))));
  return r;
}

(async()=>{
  /* 1. Archivos correctos */
  const bueno=await procesar(SET());
  ok(bueno.ok,'archivos correctos se integran',bueno.err&&(bueno.err.message+' '+JSON.stringify(bueno.validacion)));
  if(bueno.ok){
    const v=bueno.validacion; const todos=[...Object.values(v.archivos),v.cruces];
    ok(todos.every(r=>r.ok&&r.errores.length===0),'0 errores con archivos correctos',JSON.stringify(todos.map(r=>[r.key,r.errores])));
    ok(todos.every(r=>r.avisos.length===0),'0 avisos con archivos correctos',JSON.stringify(todos.map(r=>[r.key,r.avisos])));
    ok(v.corteAplicado==='2026-10-23'&&v.corteOrigen==='reportes','corte = fecha de cierre común de los reportes',v.corteAplicado);
    ok(bueno.dataset.meta.fecha_corte==='2026-10-23'&&bueno.dataset.meta.dias_periodo===292,'meta usa el corte de los reportes (5-ene → 23-oct = 292 días)',bueno.dataset.meta.dias_periodo);
    ok(bueno.dataset.meta.validacion&&bueno.dataset.meta.validacion.ok&&bueno.dataset.meta.validacion.archivos.length===6,'resumen de validación guardado en meta');
    ok(v.archivos.EXIVAL.stats.filas===60&&v.archivos.EXIVAL.stats.ceros===20&&v.archivos.COMPRAS.stats.folios===10&&v.archivos.VECLIEARTS.stats.clientes===5,'conteos por archivo');
    // El validador NO altera los datos: mismo dataset que el pipeline sin validador (mismo corte)
    const W0=contexto(false); const sin=await W0.DataProcessor.processFiles(SET(),'2026-10-23');
    const a=JSON.parse(JSON.stringify(bueno.dataset)), b=JSON.parse(JSON.stringify(sin.dataset)); delete a.meta.validacion;
    ok(JSON.stringify(a)===JSON.stringify(b),'dataset idéntico al pipeline sin validador');
    const man=await procesar(SET(),'2026-10-20'); ok(man.ok&&man.validacion.corteOrigen==='manual'&&man.dataset.meta.fecha_corte==='2026-10-20','fecha de corte manual tiene prioridad');
  }

  /* 2. Lectura */
  { const s=SET(); s.EXIVAL=archivo('EXIVAL.xlsx',Buffer.from('PK\u0003\u0004 esto no es un xlsx '.repeat(30))); await caso('xlsx corrupto',s,'EXIVAL',/no se pudo leer/i); }
  { const s=SET(); s.COMPRAS=archivo('COMPRAS.xlsx',Buffer.from([1,2,3,4,5,6,7,8])); await caso('binario basura',s,'COMPRAS',/no se pudo leer|vac[ií]o|no se reconoce/i); }
  { const s=SET(); s.ROTINV=archivo('ROTINV.xlsx',libro([[]])); await caso('hoja vacía',s,'ROTINV',/vac[ií]o/i); }
  { const s=SET(); delete s.VECLIEARTS; await caso('falta un archivo',s,'VECLIEARTS',/falta/i); }
  /* 3. Archivo en la casilla equivocada */
  await caso('ROTINV en la casilla de EXIVAL',SET({EXIVAL:rotinv()}),'EXIVAL',/parece ser "Rotaci/);
  await caso('VECLIEARTS en la casilla de COMPRAS',SET({COMPRAS:ventas()}),'COMPRAS',/parece ser "Ventas/);
  await caso('EXIVAL en la casilla de Artículos',SET({ARTICULOS:exival()}),'ARTICULOS',/parece ser "Existencia/);
  await caso('reporte desconocido',SET({ROTINV:[['OTRO REPORTE'],['Lista de precios'],['x','y','z']]}),'ROTINV',/no se reconoce/i);
  /* 4. EXIVAL */
  await caso('EXIVAL sin artículos en cero',SET({EXIVAL:exival({sinCeros:true})}),'EXIVAL',/SIN art[ií]culos en existencia 0/);
  await caso('EXIVAL con un renglón menos que su total',SET({EXIVAL:exival({mut:r=>r.splice(10,1)})}),'EXIVAL',/dice 60 art[ií]culos y se leyeron 59/);
  await caso('EXIVAL existencia no cuadra',SET({EXIVAL:exival({mut:r=>{r[8][11]=999;}})}),'EXIVAL',/existencia le[ií]da/);
  await caso('EXIVAL valor no cuadra',SET({EXIVAL:exival({mut:r=>{r[8][16]=1e6;}})}),'EXIVAL',/valor le[ií]do/);
  await caso('EXIVAL clave duplicada',SET({EXIVAL:exival({mut:r=>{r[9][0]=r[8][0];}})}),'EXIVAL',/repetidas/);
  await caso('EXIVAL sin columna Último costo',SET({EXIVAL:exival({mut:r=>{r[4][13]='Costo';}})}),'EXIVAL',/columnas: [ÚU]ltimo costo/);
  await caso('EXIVAL existencia con texto',SET({EXIVAL:exival({mut:r=>{r[8][11]='N/D';}})}),'EXIVAL',/no num[ée]rica/);
  await caso('EXIVAL datos desde la fila 6',SET({EXIVAL:exival({mut:r=>{r[5]=r[6].slice();r.splice(6,1);}})}),'EXIVAL',/fila 6/);
  await caso('EXIVAL conteo "sin existencia" no cuadra',SET({EXIVAL:exival({mut:r=>{r[r.length-1][0]='25 artículos sin existencia';}})}),'EXIVAL',/25 art[ií]culos sin existencia/);
  { const r=await caso('EXIVAL sin costo en artículo con stock (aviso)',SET({EXIVAL:exival({mut:r=>{r[7][13]=N;}})}),'EXIVAL',/sin [úu]ltimo costo/,{aviso:true}); }
  /* 5. ROTINV */
  await caso('ROTINV "Total" en rotación (aviso)',SET({ROTINV:rotinv({rotTotal:true})}),'ROTINV',/rotaci[oó]n "Total"/,{aviso:true});
  await caso('ROTINV sin columna Salidas',SET({ROTINV:rotinv({mut:r=>{r[3][13]='Entradas';}})}),'ROTINV',/Salidas/);
  await caso('ROTINV salidas no cuadran',SET({ROTINV:rotinv({mut:r=>{r[7][13]=5000;}})}),'ROTINV',/salidas le[ií]das/i);
  await caso('ROTINV rotación con texto',SET({ROTINV:rotinv({mut:r=>{r[7][18]='N/A';}})}),'ROTINV',/no num[ée]rica/);
  /* 6. COMPRAS */
  await caso('COMPRAS columna Unidades movida',SET({COMPRAS:compras({mut:r=>r.forEach(x=>x.splice(5,0,N))})}),'COMPRAS',/fuera de lugar.*Unidades/);
  await caso('COMPRAS documentos no cuadran',SET({COMPRAS:compras({mut:r=>{r[r.length-1][0]='Total 11 documentos';}})}),'COMPRAS',/dice 11 documentos/);
  await caso('COMPRAS costo no cuadra',SET({COMPRAS:compras({mut:r=>{r[6][18]=99999;}})}),'COMPRAS',/costo total le[ií]do/);
  await caso('COMPRAS sin fechas reconocibles',SET({COMPRAS:compras({mut:r=>r.forEach((x,i)=>{if(i>4&&typeof x[0]==='number')x[0]='sin fecha';})})}),'COMPRAS',/fechas de folio/);
  await caso('COMPRAS con fecha posterior al cierre',SET({COMPRAS:compras({mut:r=>{r[5][0]=serial(2026,11,2);}})}),'COMPRAS',/posterior al cierre/);
  await caso('COMPRAS concepto distinto (aviso)',SET({COMPRAS:compras({mut:r=>{r[3][0]='Concepto: Salida por traspaso';}})}),'COMPRAS',/Recepci[oó]n de mercanc/,{aviso:true});
  /* 7. VECLIEARTS */
  await caso('VECLIEARTS columna Unidades movida',SET({VECLIEARTS:ventas({mut:r=>r.forEach(x=>{if(x[0]==='Artículo'){x[16]=N;x[17]='Unidades';}})})}),'VECLIEARTS',/fuera de lugar/);
  await caso('VECLIEARTS total de cliente no cuadra',SET({VECLIEARTS:ventas({mut:r=>{const t=r.find(x=>x[12]==='Total CLIENTE DOS');t[14]+=1000;}})}),'VECLIEARTS',/no cuadra con la suma de totales/);
  await caso('VECLIEARTS importe con texto',SET({VECLIEARTS:ventas({mut:r=>{const x=r.find(x=>x[0]==='10-001');x[14]='ERR';}})}),'VECLIEARTS',/importe de venta no num/);
  await caso('VECLIEARTS sin unidades (aviso)',SET({VECLIEARTS:ventas({mut:r=>{const x=r.find(x=>x[0]==='10-001');x[16]=N;}})}),'VECLIEARTS',/sin unidades/,{aviso:true});
  /* 8. ARTÍCULOS */
  await caso('Artículos con encabezados distintos',SET({ARTICULOS:articulos({mut:r=>{r[0]=['Codigo','Descripcion','Grupo'];}})}),'ARTICULOS',/no se reconoce|Encabezados inesperados/i);
  await caso('Artículos clave repetida (aviso)',SET({ARTICULOS:articulos({mut:r=>r.push(r[1].slice())})}),'ARTICULOS',/repetidas/,{aviso:true});
  /* 9. Cruces */
  await caso('reportes con cierres distintos (>7 días)',SET({VECLIEARTS:ventas({fecha:'Periodo del 01/ene./2026 al 30/sep./2026'})}),'CRUCES',/no cierran en la misma fecha/);
  await caso('reportes con inicios distintos (>7 días)',SET({ROTINV:rotinv({fecha:'Del 1 de marzo al 23 de octubre del 2026'})}),'CRUCES',/no inician en la misma fecha/);
  { const r=await caso('cierres a 1 día (aviso)',SET({EXIVAL:exival({fecha:'Al 22 de octubre del 2026'})}),'CRUCES',/difieren 1 d[ií]a/,{aviso:true});
    if(r.ok) ok(r.validacion.corteOrigen!=='reportes'||r.validacion.corteAplicado==null,'sin corte común no se inventa corte'); }
  { const pocos=ARTS.slice(0,50); await caso('EXIVAL no cubre el catálogo',SET({EXIVAL:exival({arts:pocos})}),'CRUCES',/no vienen en EXIVAL\. EXIVAL parece incompleto/); }
  { const r=await procesar(SET({EXIVAL:exival({arts:ARTS.slice(0,59)})}));
    ok(!r.ok&&/venta.*no vienen en EXIVAL/.test(errs(r.validacion,'CRUCES')),'venta que se perdería >1% bloquea',errs(r.validacion||{archivos:{}},'CRUCES')); }
  /* 10. Vazlo (opcional) */
  { const vz=[['Clave','Existencia'],...ARTS.map(a=>[a.clave,5])];
    const r=await procesar(SET({extra:{VAZLO:archivo('EXISTENCIAVAZLO.xlsx',libro(vz))}})); ok(r.ok&&r.validacion.archivos.VAZLO.ok&&r.dataset.meta.vazlo.matched===60,'Vazlo correcto se integra');
    await caso('Vazlo sin claves',SET({extra:{VAZLO:archivo('EXISTENCIAVAZLO.xlsx',libro([['nada'],['que ver']]))}}),'VAZLO',/no se detectaron claves/i);
    const r2=await procesar(SET({extra:{VAZLO:archivo('EXISTENCIAVAZLO.xlsx',libro([['Clave','Existencia'],...Array.from({length:40},(_,i)=>['ZZ-'+i,3]),['10-001',2]]))}}));
    ok(r2.ok&&/claves del archivo Vazlo existen/.test(avs(r2.validacion,'CRUCES')),'Vazlo de otro catálogo → aviso'); }
  /* 11. Fechas del encabezado */
  const fe=W.Validador.fechasEncabezado;
  ok(JSON.stringify(fe([['Del 1 de enero al 23 de octubre del 2026']]))==='{"ini":"2026-01-01","fin":"2026-10-23"}','fecha "Del … al … del 2026"');
  ok(JSON.stringify(fe([['Periodo del 01/ene./2026 al 23/oct./2026']]))==='{"ini":"2026-01-01","fin":"2026-10-23"}','fecha "01/ene./2026"');
  ok(JSON.stringify(fe([['Al 23 de octubre del 2026']]))==='{"ini":"2026-10-23","fin":"2026-10-23"}','fecha "Al … del 2026"');
  ok(JSON.stringify(fe([['Del 15 de diciembre del 2025 al 10 de enero del 2026']]))==='{"ini":"2025-12-15","fin":"2026-01-10"}','fecha entre años');

  /* 12. UI de Actualizar Datos (jsdom) */
  const dom=new JSDOM(`<!DOCTYPE html><body><div id="page-actualizar"></div><div id="proceso-status"></div></body>`,{runScripts:'outside-only'}); const w=dom.window;
  w.XLSX=XLSX; for(const f of ['utils/formatters.js','utils/validador.js','utils/dataProcessor.js','components/actualizar.js']) w.eval(fs.readFileSync(NEW+f,'utf8'));
  const $=i=>w.document.getElementById(i); const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const PA=w.PageActualizar; PA.render();
  const s=SET({EXIVAL:exival({sinCeros:true})});
  for(const k of ['ARTICULOS','EXIVAL','ROTINV','COMPRAS','VECLIEARTS']) await PA.setFile(k,s[k]);
  ok($('slot-EXIVAL').dataset.validacion==='error','casilla EXIVAL marcada en error',$('slot-EXIVAL').dataset.validacion);
  ok(/SIN art[ií]culos en existencia 0/.test($('slot-status-EXIVAL').textContent),'casilla muestra el motivo');
  ok(['ARTICULOS','ROTINV','COMPRAS','VECLIEARTS'].every(k=>$('slot-'+k).dataset.validacion==='ok'),'las demás casillas en ok');
  ok($('btn-procesar').disabled,'Procesar bloqueado mientras haya un archivo con error');
  ok(!!$('aviso-slots-error'),'aviso general de archivo con error');
  await PA.setFile('EXIVAL',SET().EXIVAL);
  ok($('slot-EXIVAL').dataset.validacion==='ok'&&!$('btn-procesar').disabled,'al reemplazar por el archivo correcto se habilita Procesar');
  $('btn-procesar').click(); for(let i=0;i<50&&!$('panel-validacion');i++) await wait(50);
  ok($('panel-validacion')&&$('panel-validacion').dataset.estado==='ok','panel de validación en verde tras procesar');
  ok(!!$('btn-aplicar')&&!!$('btn-guardar-github'),'con validación correcta aparecen Aplicar / Guardar en GitHub');
  ok(/2026-10-23/.test($('panel-validacion').textContent)&&/cierre com[uú]n/.test($('panel-validacion').textContent),'panel informa el corte usado');
  // cruce con error → no hay botones para aplicar/guardar
  PA.render(); const s2=SET({VECLIEARTS:ventas({fecha:'Periodo del 01/ene./2026 al 30/sep./2026'})});
  for(const k of ['ARTICULOS','EXIVAL','ROTINV','COMPRAS','VECLIEARTS']) await PA.setFile(k,s2[k]);
  ok(!$('btn-procesar').disabled,'archivos válidos individualmente → se puede procesar');
  $('btn-procesar').click(); for(let i=0;i<50&&!$('panel-validacion');i++) await wait(50);
  ok($('panel-validacion')&&$('panel-validacion').dataset.estado==='error','cruce con error → panel en rojo');
  ok(!$('btn-aplicar')&&!$('btn-guardar-github')&&!$('btn-descargar-js'),'con errores NO se puede aplicar, guardar ni descargar');
  ok(/no cierran en la misma fecha/.test($('panel-validacion').textContent),'panel explica el error de cruce');
  // archivo ilegible en casilla
  PA.render(); await PA.setFile('ROTINV',archivo('ROTINV.xlsx',Buffer.from('xx'.repeat(50))));
  ok($('slot-ROTINV').dataset.validacion==='error'&&/no se pudo leer|no se reconoce|vac[ií]o/i.test($('slot-status-ROTINV').textContent),'archivo ilegible marcado en su casilla',$('slot-status-ROTINV').textContent);
  // archivo en la casilla equivocada
  await PA.setFile('COMPRAS',SET().VECLIEARTS);
  ok($('slot-COMPRAS').dataset.validacion==='error'&&/parece ser/.test($('slot-status-COMPRAS').textContent),'archivo en casilla equivocada marcado');

  process.exit(report('T9 Validador de archivos ERP')?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
