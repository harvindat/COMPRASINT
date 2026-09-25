// Pipeline: cliente principal y # anclas por artículo (JS) — y paridad con Python
const fs=require('fs'), vm=require('vm'), {execSync}=require('child_process'), path=require('path');
const {ok,report,NEW}=require('./helpers');
const c={window:{},console,Math,JSON,Date}; vm.createContext(c);
vm.runInContext(fs.readFileSync(NEW+'utils/dataProcessor.js','utf8'),c);
const DP=c.window.DataProcessor;
const clientes=[['101','CLIENTE A',[['X1',500,5],['X2',100,1]]],['102','CLIENTE B',[['X1',300,3],['X3',50,1]]],['103','CLIENTE C',[['X2',900,9]]],
  ['104','CLIENTE D',[['X1',10,1]]],['105','CLIENTE E',[['X2',5,1],['X1',1,1]]]];
const ventas=[]; clientes.forEach(([id,nom,arts])=>arts.forEach(([cl,v,u])=>ventas.push({cliente_id:id,cliente_nombre:nom,clave:cl,venta:v,unidades:u})));
const parsed={articulos:[{clave:'X1',nombre:'A1',linea:'L'},{clave:'X2',nombre:'A2',linea:'L'},{clave:'X3',nombre:'A3',linea:'L'},{clave:'X4',nombre:'A4',linea:'L'}],
  exival:['X1','X2','X3','X4'].map(k=>({clave:k,descripcion:k,existencia:1,costo_neto:10,costo_iva:11.6,valor_total:11.6})),
  rotinv:[], ventas, compras:[{fecha:new Date(2026,0,1),folio:'F1',costo_total:100},{fecha:new Date(2026,2,1),folio:'F2',costo_total:100}]};
const d=DP.buildDataset(parsed); const m={}; d.articulos.forEach(a=>m[a.clave]=a);
// top4 por venta: C(900) A(600) B(350) D(10) → E(6) no es ancla
ok(m.X1.cliente_top==='CLIENTE A' && Math.abs(m.X1.cliente_top_pct-500/811)<1e-4,'X1 cliente principal A',JSON.stringify(m.X1));
ok(m.X1.n_anclas===3,'X1 comprado por 3 anclas (A,B,D)',m.X1.n_anclas);
ok(m.X2.cliente_top==='CLIENTE C' && m.X2.n_anclas===2,'X2 principal C, 2 anclas');
ok(m.X3.cliente_top==='CLIENTE B' && m.X3.cliente_top_pct===1 && m.X3.n_anclas===1,'X3 principal B 100%');
ok(m.X4.cliente_top==='' && m.X4.cliente_top_pct===0 && m.X4.n_anclas===0,'X4 sin venta');
// Python: mismas columnas en la salida
const py=fs.readFileSync(path.join(__dirname,'..','scripts','process_data.py'),'utf8');
ok(/'cliente_top', 'cliente_top_pct', 'n_anclas'/.test(py),'process_data.py exporta las mismas columnas');
process.exit(report('T7 Pipeline cliente principal / anclas')?0:1);
