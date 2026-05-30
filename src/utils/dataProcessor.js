/* ============================================================
   dataProcessor.js — Procesamiento de archivos Excel en el navegador
   Replica scripts/process_data.py usando SheetJS (XLSX).
   Permite actualizar el dataset cargando nuevos meses de data
   sin necesidad de ejecutar Python.
   ============================================================ */

window.DataProcessor = (function() {

  const IVA = 1.16;
  const MESES_ES = { 1:'Ene',2:'Feb',3:'Mar',4:'Abr',5:'May',6:'Jun',7:'Jul',8:'Ago',9:'Sep',10:'Oct',11:'Nov',12:'Dic' };

  /* ─── Helpers ─────────────────────────────────────────── */
  function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // Valida que una celda de clave sea un SKU real (alfanumérico) y NO una fila
  // de resumen/total que estos reportes intercalan (ej. "Total 12,691 artículos",
  // "2,715 artículos sin existencia"). Acepta claves con prefijo alfabético
  // como VKS101, V5-894, HR-4356R, KITBMW1, AM-KIT 1, etc.
  const RE_SKU = /^[A-Za-z0-9][A-Za-z0-9\-\/. ]*$/;
  function esSKU(v) {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    if (!s) return false;
    const low = s.toLowerCase();
    if (low.indexOf('total') !== -1) return false;
    if (low.indexOf('artículos') !== -1 || low.indexOf('articulos') !== -1) return false;
    if (low.indexOf('sin existencia') !== -1) return false;
    return RE_SKU.test(s);
  }

  function readSheet(workbook) {
    // Devuelve matriz de filas (array de arrays) de la primera hoja
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  }

  // Busca el índice de columna cuyo encabezado (en filas 0..maxScan) coincide con
  // alguno de los textos dados. Devuelve fallback si no lo encuentra. Hace que el
  // pipeline tolere que el reporte mueva columnas en exportaciones futuras.
  function findCol(rows, textos, fallback, maxScan) {
    const lim = Math.min(maxScan || 8, rows.length);
    const want = textos.map(t => t.toLowerCase());
    for (let i = 0; i < lim; i++) {
      const r = rows[i];
      if (!r) continue;
      for (let j = 0; j < r.length; j++) {
        const c = r[j];
        if (c == null) continue;
        const s = String(c).trim().toLowerCase();
        if (want.some(w => s === w || s.indexOf(w) !== -1)) return j;
      }
    }
    return fallback;
  }

  function parseFecha(v) {
    // SheetJS puede devolver número serial Excel o string
    if (v == null) return null;
    if (typeof v === 'number') {
      // Excel serial date → JS Date
      const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
      if (d) return new Date(d.y, d.m - 1, d.d);
    }
    const s = String(v);
    const m = s.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d2 = new Date(s);
    return isNaN(d2.getTime()) ? null : d2;
  }

  /* ─── Loaders (espejo del Python) ─────────────────────── */
  function loadArticulos(rows) {
    // Tiene header en fila 0
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] == null) continue;
      if (!esSKU(r[0])) continue;
      const clave = String(r[0]).trim();
      out.push({ clave, nombre: r[1] || '', linea: r[2] || 'SIN LÍNEA' });
    }
    return out;
  }

  function loadExival(rows) {
    // Datos empiezan en fila 6. Detecta columnas por encabezado con fallback a índices conocidos.
    const cExist = findCol(rows, ['Existencia'], 11);
    const cCosto = findCol(rows, ['Último costo', 'Ultimo costo'], 13);
    const cValor = findCol(rows, ['Valor total'], 16);
    const out = [];
    for (let i = 6; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] == null) continue;
      if (!esSKU(r[0])) continue;
      const clave = String(r[0]).trim();
      const costo_neto = toNum(r[cCosto]);
      out.push({
        clave, descripcion: r[2] || '',
        existencia: toNum(r[cExist]),
        costo_neto, costo_iva: costo_neto * IVA,
        valor_total: toNum(r[cValor])
      });
    }
    return out;
  }

  function loadRotinv(rows) {
    // Datos desde fila 4. Detecta columnas por encabezado con fallback a índices conocidos.
    const cSal = findCol(rows, ['Salidas'], 13);
    const cRot = findCol(rows, ['Rotación', 'Rotacion'], 18);
    const out = [];
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] == null) continue;
      if (!esSKU(r[0])) continue;
      const clave = String(r[0]).trim();
      out.push({ clave, salidas: toNum(r[cSal]), rotacion: toNum(r[cRot]) });
    }
    return out;
  }

  function loadVentas(rows) {
    const out = [];
    let curId = null, curNom = null;
    for (let i = 5; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const c0 = r[0], c3 = r[3], c4 = r[4], c14 = r[14], c16 = r[16];
      const s0 = c0 != null ? String(c0).trim() : '';
      const s3 = c3 != null ? String(c3).trim() : '';
      const s4 = c4 != null ? String(c4).trim() : '';
      // Fila de cliente: código en col0 (numérico), nombre en col3, sin importe ni descripción de artículo
      if (/^\d+$/.test(s0) && s0.length > 2 && s3 && c14 == null && c4 == null) {
        curId = s0; curNom = s3;
      // Fila de artículo: SKU válido en col0, descripción en col4, importe en col14
      } else if (esSKU(s0) && c14 != null && s4) {
        const v = toNum(c14);
        if (v > 0) {
          out.push({ cliente_id: curId, cliente_nombre: curNom, clave: s0, venta: v, unidades: toNum(c16) });
        }
      }
    }
    return out;
  }

  function loadCompras(rows) {
    const out = [];
    let curFecha = null;
    let curFolio = null;
    for (let i = 5; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const fechaVal = r[0], folioVal = r[1], descVal = r[3];
      const cantVal = r[12], costoVal = r[16], totalVal = r[18];
      if (fechaVal != null && /20\d{2}/.test(String(fechaVal))) {
        curFecha = parseFecha(fechaVal); curFolio = folioVal;
      } else if (descVal != null && String(descVal).trim()) {
        const cant = toNum(cantVal), costo = toNum(costoVal);
        if (cant > 0 && costo > 0) {
          out.push({ fecha: curFecha, folio: curFolio,
                     costo_total: totalVal != null ? toNum(totalVal) : cant * costo });
        }
      }
    }
    return out;
  }

  /* ─── Período dinámico ────────────────────────────────── */
  function calcularPeriodo(compras, corte) {
    const fechas = compras.map(c => c.fecha).filter(Boolean);
    if (!fechas.length) return { dias_periodo: 150, num_meses: 5, periodo: 'período', fecha_inicio: '', fecha_corte: '' };
    let fmin = new Date(Math.min(...fechas.map(d => d.getTime())));
    let fmax = new Date(Math.max(...fechas.map(d => d.getTime())));
    if (corte) { const c = parseFecha(corte); if (c) fmax = c; }
    const dias = Math.round((fmax - fmin) / 86400000) + 1;
    const numMeses = Math.round(dias / 30.4 * 100) / 100;
    let label = `${MESES_ES[fmin.getMonth()+1]}–${MESES_ES[fmax.getMonth()+1]} ${fmax.getFullYear()}`;
    if (fmin.getFullYear() !== fmax.getFullYear())
      label = `${MESES_ES[fmin.getMonth()+1]} ${fmin.getFullYear()}–${MESES_ES[fmax.getMonth()+1]} ${fmax.getFullYear()}`;
    const fmt = d => d.toISOString().slice(0,10);
    return { dias_periodo: Math.max(dias,1), num_meses: numMeses > 0 ? numMeses : 1,
             periodo: label, fecha_inicio: fmt(fmin), fecha_corte: fmt(fmax) };
  }

  /* ─── Construir dataset completo ──────────────────────── */
  function buildDataset(parsed, corte) {
    const { articulos, exival, rotinv, ventas, compras } = parsed;

    const periodo = calcularPeriodo(compras, corte);
    const DIAS = periodo.dias_periodo;
    const MESES = periodo.num_meses > 0 ? periodo.num_meses : 1;

    // Index maps
    const artMap = {}; articulos.forEach(a => artMap[a.clave] = a);
    const rotMap = {}; rotinv.forEach(r => rotMap[r.clave] = r);

    // Ventas por artículo
    const ventaArt = {};
    const clientesSet = {};
    ventas.forEach(v => {
      if (!ventaArt[v.clave]) ventaArt[v.clave] = { venta: 0, uds: 0, clientes: new Set() };
      ventaArt[v.clave].venta += v.venta;
      ventaArt[v.clave].uds += v.unidades;
      ventaArt[v.clave].clientes.add(v.cliente_id);
    });

    // Clientes totales
    const ventaCliente = {};
    ventas.forEach(v => {
      if (!ventaCliente[v.cliente_id]) ventaCliente[v.cliente_id] = { nombre: v.cliente_nombre, venta: 0, arts: new Set() };
      ventaCliente[v.cliente_id].venta += v.venta;
      ventaCliente[v.cliente_id].arts.add(v.clave);
    });
    const clientesArr = Object.entries(ventaCliente)
      .map(([id, d]) => ({ id, nombre: d.nombre, venta: d.venta, arts: d.arts.size }))
      .sort((a, b) => b.venta - a.venta);
    const top4_ids = clientesArr.slice(0, 4).map(c => c.id);

    // Venta ancla por artículo
    const ventaAnclaArt = {};
    ventas.forEach(v => {
      if (top4_ids.includes(v.cliente_id)) {
        ventaAnclaArt[v.clave] = (ventaAnclaArt[v.clave] || 0) + v.venta;
      }
    });

    // Master (basado en exival)
    let master = exival.map(e => {
      const rot = rotMap[e.clave] || {};
      const art = artMap[e.clave] || {};
      const va = ventaArt[e.clave] || { venta: 0, uds: 0, clientes: new Set() };
      const ventaAncla = ventaAnclaArt[e.clave] || 0;
      const ventaTotal = va.venta;
      return {
        clave: e.clave,
        descripcion: e.descripcion || art.nombre || '',
        linea: art.linea || 'SIN LÍNEA',
        existencia: e.existencia,
        costo_neto: e.costo_neto,
        costo_iva: e.costo_iva,
        valor_total: e.valor_total,
        salidas: rot.salidas || 0,
        rotacion: rot.rotacion || 0,
        dpd: va.uds / DIAS,
        dmd: va.uds / MESES,
        venta_total: ventaTotal,
        unidades_total: va.uds,
        num_clientes: va.clientes.size,
        venta_ancla: ventaAncla,
        pct_ancla: ventaTotal > 0 ? ventaAncla / ventaTotal : 0
      };
    });

    // ABC
    const activos = master.filter(m => m.venta_total > 0).sort((a, b) => b.venta_total - a.venta_total);
    const totalVenta = activos.reduce((s, m) => s + m.venta_total, 0);
    let acum = 0;
    const abcMap = {};
    activos.forEach(m => {
      acum += m.venta_total;
      const pct = totalVenta > 0 ? acum / totalVenta : 1;
      abcMap[m.clave] = pct <= 0.70 ? 'A' : (pct <= 0.90 ? 'B' : 'C');
    });
    master.forEach(m => { m.abc = abcMap[m.clave] || 'D'; });

    // Score — rotMax = percentil 95 con interpolación lineal (idéntico a numpy.quantile)
    const rots = master.map(m => m.rotacion).sort((a, b) => a - b);
    function quantile(sorted, q) {
      if (!sorted.length) return 1;
      const pos = (sorted.length - 1) * q;
      const lo = Math.floor(pos), hi = Math.ceil(pos);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    }
    const rotMax = quantile(rots, 0.95) || 1;
    const abcScore = { A: 1.0, B: 0.65, C: 0.35, D: 0.0 };
    master.forEach(m => {
      m.cobertura_dias = m.dpd > 0 ? Math.round(m.existencia / m.dpd) : 0;
      m.dias_cobertura = m.cobertura_dias;
      const rotNorm = Math.min(m.rotacion / rotMax, 1);
      const invCob = 1 - Math.min(m.cobertura_dias / 365, 1);
      m.score_compra = (0.40 * abcScore[m.abc] + 0.25 * rotNorm + 0.20 * m.pct_ancla + 0.15 * invCob) * 100;
      // Redondeos
      ['dpd','dmd','rotacion','pct_ancla','score_compra','costo_neto','costo_iva','valor_total','venta_total','venta_ancla']
        .forEach(k => { m[k] = Math.round((m[k] || 0) * 10000) / 10000; });
    });

    // KPIs
    const totalInv = master.reduce((s, m) => s + m.valor_total, 0);
    const ventaT = master.reduce((s, m) => s + m.venta_total, 0);
    const comprasT = compras.reduce((s, c) => s + c.costo_total, 0);
    const folios = new Set(compras.map(c => c.folio).filter(Boolean));

    // Métricas de clientes ancla (top 4) — dinámicas
    let ventaAnclaTotal = 0;
    const setAncla = new Set(), setNoAncla = new Set();
    ventas.forEach(v => {
      if (top4_ids.includes(v.cliente_id)) { ventaAnclaTotal += v.venta; setAncla.add(v.clave); }
      else setNoAncla.add(v.clave);
    });
    let exclusivos = 0, compartidos = 0;
    setAncla.forEach(c => { if (setNoAncla.has(c)) compartidos++; else exclusivos++; });

    const kpis = {
      total_inv: Math.round(totalInv * 100) / 100,
      total_inv_iva: Math.round(totalInv * IVA * 100) / 100,
      venta_5m: Math.round(ventaT * 100) / 100,
      venta_mensual: Math.round(ventaT / MESES * 100) / 100,
      compras_5m: Math.round(comprasT * 100) / 100,
      cobertura_dias: ventaT > 0 ? Math.round(totalInv / (ventaT / DIAS) * 10) / 10 : 0,
      total_articulos: articulos.length,
      arts_con_stock: master.filter(m => m.existencia > 0).length,
      arts_sin_stock: master.filter(m => m.existencia === 0).length,
      arts_con_venta: master.filter(m => m.venta_total > 0).length,
      arts_sin_venta: master.filter(m => m.venta_total === 0).length,
      total_clientes: clientesArr.length,
      total_pedidos: folios.size,
      total_lineas_compra: compras.length,
      venta_ancla_total: Math.round(ventaAnclaTotal * 100) / 100,
      pct_ancla_total: ventaT > 0 ? Math.round(ventaAnclaTotal / ventaT * 1000) / 10 : 0,
      num_clientes_ancla: top4_ids.length,
      arts_exclusivos_ancla: exclusivos,
      arts_compartidos_ancla: compartidos
    };

    // ABC summary
    const abcAgg = {};
    master.forEach(m => {
      if (!abcAgg[m.abc]) abcAgg[m.abc] = { arts: 0, venta: 0, inv: 0 };
      abcAgg[m.abc].arts++; abcAgg[m.abc].venta += m.venta_total; abcAgg[m.abc].inv += m.valor_total;
    });
    const abc = Object.entries(abcAgg).map(([cat, d]) => ({
      cat, arts: d.arts, venta: Math.round(d.venta * 100) / 100, inv: Math.round(d.inv * 100) / 100
    })).sort((a, b) => a.cat.localeCompare(b.cat));

    // Líneas
    const lineaAgg = {};
    master.forEach(m => {
      if (!lineaAgg[m.linea]) lineaAgg[m.linea] = { arts: 0, venta: 0, inv: 0, uds: 0 };
      lineaAgg[m.linea].arts++; lineaAgg[m.linea].venta += m.venta_total;
      lineaAgg[m.linea].inv += m.valor_total; lineaAgg[m.linea].uds += m.unidades_total;
    });
    const lineas = Object.entries(lineaAgg).map(([linea, d]) => ({
      linea, arts: d.arts, venta: Math.round(d.venta * 100) / 100,
      inv: Math.round(d.inv * 100) / 100, uds: Math.round(d.uds)
    })).filter(l => l.venta > 0).sort((a, b) => b.venta - a.venta);

    // Compras por mes
    const mesAgg = {};
    compras.forEach(c => {
      if (!c.fecha) return;
      const key = c.fecha.getFullYear() * 100 + (c.fecha.getMonth() + 1);
      if (!mesAgg[key]) mesAgg[key] = { mes: c.fecha.getMonth() + 1, total: 0 };
      mesAgg[key].total += c.costo_total;
    });
    const compras_mes = Object.keys(mesAgg).sort().map(k => ({
      mes: MESES_ES[mesAgg[k].mes], total: Math.round(mesAgg[k].total * 100) / 100
    }));

    // Clientes
    const clientes = clientesArr.map(c => ({
      id: c.id, nombre: c.nombre, venta: Math.round(c.venta * 100) / 100,
      arts: c.arts, pct: ventaT > 0 ? Math.round(c.venta / ventaT * 1000) / 10 : 0,
      ancla: top4_ids.includes(c.id)
    }));

    // Top50 y riesgo
    const top50 = master.filter(m => m.venta_total > 0)
      .sort((a, b) => b.venta_total - a.venta_total).slice(0, 50)
      .map(m => ({ clave: m.clave, descripcion: m.descripcion, linea: m.linea,
                   existencia: m.existencia, costo_iva: m.costo_iva, venta_total: m.venta_total,
                   unidades_total: m.unidades_total, rotacion: m.rotacion, abc: m.abc,
                   score_compra: m.score_compra, dias_cobertura: m.dias_cobertura, dpd: m.dpd }));

    const riesgo = master.filter(m => m.dpd > 0 && m.cobertura_dias < 14 && ['A','B'].includes(m.abc))
      .sort((a, b) => b.score_compra - a.score_compra).slice(0, 30)
      .map(m => ({ clave: m.clave, descripcion: m.descripcion, linea: m.linea,
                   existencia: m.existencia, dias_cobertura: m.dias_cobertura, abc: m.abc,
                   score_compra: m.score_compra, dpd: m.dpd, costo_iva: m.costo_iva }));

    const meta = {
      generado: new Date().toISOString().slice(0, 10),
      empresa: 'HARVIN DISTRIBUCIONES',
      version_pipeline: '2.0.0-browser',
      ...periodo
    };

    return { meta, kpis, abc, lineas, compras_mes, clientes, top50_articulos: top50, riesgo, articulos: master, top4_ids };
  }

  /* ─── API pública: procesar archivos File ─────────────── */
  async function processFiles(fileMap, corte) {
    // fileMap: { ARTICULOS: File, EXIVAL: File, ROTINV: File, COMPRAS: File, VECLIEARTS: File }
    async function readWb(file) {
      const buf = await file.arrayBuffer();
      return XLSX.read(buf, { type: 'array', cellDates: false });
    }

    const parsed = {
      articulos: loadArticulos(readSheet(await readWb(fileMap.ARTICULOS))),
      exival:    loadExival(readSheet(await readWb(fileMap.EXIVAL))),
      rotinv:    loadRotinv(readSheet(await readWb(fileMap.ROTINV))),
      ventas:    loadVentas(readSheet(await readWb(fileMap.VECLIEARTS))),
      compras:   loadCompras(readSheet(await readWb(fileMap.COMPRAS)))
    };

    const counts = {
      articulos: parsed.articulos.length, exival: parsed.exival.length,
      rotinv: parsed.rotinv.length, ventas: parsed.ventas.length, compras: parsed.compras.length
    };

    const dataset = buildDataset(parsed, corte);
    return { dataset, counts };
  }

  /* ─── Generar archivo cedi_data.js descargable ────────── */
  function generarArchivoJS(dataset) {
    const json = JSON.stringify(dataset);
    const content = 'window.CEDI_DATA = ' + json + ';';
    const blob = new Blob([content], { type: 'application/javascript' });
    return blob;
  }

  return { processFiles, buildDataset, generarArchivoJS, calcularPeriodo };
})();
