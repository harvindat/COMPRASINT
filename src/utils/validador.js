/* ============================================================
   validador.js — Validación de los archivos ERP antes de integrar
   CEDI Intelligence · Harvin Distribuciones
   ------------------------------------------------------------
   Revisa CADA archivo (lectura, tipo de reporte, encabezados y
   columnas, filas de datos, cuadre contra la fila "Total" del
   propio reporte, fechas) y después los CRUCES entre archivos
   (período, cobertura del catálogo, ventas que se perderían).

   Niveles:
     error  → bloquea la integración (no se genera el dataset)
     aviso  → se integra, pero se muestra para revisión
     info   → dato de contexto

   Las posiciones de columna que se validan son las MISMAS que usan
   los loaders de dataProcessor.js; si el ERP mueve una columna, el
   validador lo detecta antes de que se lea un dato equivocado.
   ============================================================ */

window.Validador = (function () {
  'use strict';

  /* ─── utilidades (idénticas a dataProcessor.js) ───────── */
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
  function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }
  const esNumero = v => typeof v === 'number' ? isFinite(v) : (v != null && String(v).trim() !== '' && !isNaN(parseFloat(String(v).replace(/,/g, ''))));
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const fmtN = n => Math.round(n).toLocaleString('es-MX');
  const fmt$ = n => '$' + (Math.round(n * 100) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cuadra = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-6);
  const lista = (arr, n) => arr.slice(0, n || 5).join(', ') + (arr.length > (n || 5) ? ` y ${fmtN(arr.length - (n || 5))} más` : '');

  const NOMBRES = {
    ARTICULOS: 'Catálogo de artículos', EXIVAL: 'Existencia y valor (EXIVAL)', ROTINV: 'Rotación de inventario (ROTINV)',
    COMPRAS: 'Compras del período (COMPRAS)', VECLIEARTS: 'Ventas por cliente (VECLIEARTS)', VAZLO: 'Existencia proveedor (Vazlo)'
  };

  function nuevoReporte(key, archivo) {
    return { key, nombre: NOMBRES[key] || key, archivo: archivo || '', errores: [], avisos: [], info: [], stats: {}, ok: true };
  }
  function cerrar(r) { r.ok = r.errores.length === 0; return r; }

  /* ─── Tipo de reporte por su título / encabezado ──────── */
  const FIRMAS = [
    ['EXIVAL', t => /existencia y valor del inventario/.test(t)],
    ['ROTINV', t => /rotacion del inventario/.test(t)],
    ['COMPRAS', t => /diarios del inventario/.test(t)],
    ['VECLIEARTS', t => /ventas por cliente/.test(t)]
  ];
  function detectarTipo(rows) {
    const textos = [];
    for (let i = 0; i < Math.min(8, rows.length); i++) (rows[i] || []).forEach(c => { if (c != null && typeof c === 'string') textos.push(norm(c)); });
    const t = textos.join(' | ');
    for (const [k, f] of FIRMAS) if (f(t)) return k;
    const h = (rows[0] || []).map(norm);
    if (h[0] === 'clave' && h[1] === 'nombre') return 'ARTICULOS';
    return null;
  }

  /* ─── Fechas en el encabezado del reporte ─────────────── */
  const MESES = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
    jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  function fechasEncabezado(rows) {
    const out = [];
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      (rows[i] || []).forEach(c => {
        if (typeof c !== 'string') return;
        const s = norm(c);
        let m; const re1 = /(\d{1,2})\/([a-z]{3,4})\.?\/(\d{4})/g;          // 01/ene./2026
        while ((m = re1.exec(s))) if (MESES[m[2]]) out.push({ y: +m[3], m: MESES[m[2]], d: +m[1] });
        const re2 = /(\d{1,2}) de ([a-z]+)(?: del? (\d{4}))?/g;              // 23 de octubre del 2026
        const tmp = [];
        while ((m = re2.exec(s))) if (MESES[m[2]]) tmp.push({ y: m[3] ? +m[3] : null, m: MESES[m[2]], d: +m[1] });
        const anio = (tmp.find(x => x.y) || {}).y;
        tmp.forEach(x => { if (!x.y) x.y = anio; if (x.y) out.push(x); });
      });
    }
    if (!out.length) return null;
    return { ini: iso(out[0].y, out[0].m, out[0].d), fin: iso(out[out.length - 1].y, out[out.length - 1].m, out[out.length - 1].d) };
  }

  /* Busca la celda de encabezado con texto EXACTO en las primeras filas */
  function encabezado(rows, textos, maxScan) {
    const want = textos.map(norm);
    for (let i = 0; i < Math.min(maxScan || 8, rows.length); i++) {
      const r = rows[i] || [];
      for (let j = 0; j < r.length; j++) if (r[j] != null && want.includes(norm(r[j]))) return { fila: i, col: j };
    }
    return null;
  }
  const colLetra = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  function filaTotal(rows, re) {
    for (let i = rows.length - 1; i >= Math.max(0, rows.length - 15); i--) {
      const r = rows[i]; if (!r || r[0] == null) continue;
      const m = String(r[0]).match(re); if (m) return { fila: i, n: toNum(m[1]), r };
    }
    return null;
  }

  /* Comprueba el tipo de reporte; devuelve false si no corresponde a la casilla */
  function revisarTipo(rep, key, rows) {
    const tipo = detectarTipo(rows);
    rep.stats.tipoDetectado = tipo;
    if (tipo && tipo !== key) {
      rep.errores.push(`Este archivo parece ser "${NOMBRES[tipo]}", no "${NOMBRES[key]}". Revisa que esté en la casilla correcta.`);
      return false;
    }
    if (!tipo) {
      rep.errores.push(`No se reconoce como el reporte "${NOMBRES[key]}": no se encontró su título/encabezado en las primeras filas. Exporta el reporte con el mismo formato de siempre.`);
      return false;
    }
    return true;
  }

  /* ════════ ARTÍCULOS ════════ */
  function validarArticulos(rows, rep) {
    const h = (rows[0] || []).map(norm);
    if (h[0] !== 'clave' || h[1] !== 'nombre' || !(h[2] === 'linea')) {
      rep.errores.push(`Encabezados inesperados en la fila 1: se esperaba "Clave | Nombre | Línea" en las columnas A-C y vino "${(rows[0] || []).slice(0, 3).join(' | ')}".`);
      return;
    }
    const claves = [], dup = [], invalidas = [], seen = new Set();
    let inactivos = 0; const cEst = h.indexOf('estatus');
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r || r[0] == null || String(r[0]).trim() === '') continue;
      if (!esSKU(r[0])) { invalidas.push(String(r[0]).slice(0, 20)); continue; }
      const k = String(r[0]).trim();
      if (seen.has(k)) dup.push(k); seen.add(k); claves.push(k);
      if (cEst >= 0 && r[cEst] != null && norm(r[cEst]) !== 'activo') inactivos++;
    }
    rep.stats.filas = claves.length; rep.stats.claves = seen;
    if (!claves.length) rep.errores.push('El catálogo no trae artículos (0 claves válidas).');
    if (dup.length) rep.avisos.push(`${fmtN(dup.length)} claves repetidas en el catálogo (se usa la última): ${lista(dup)}.`);
    if (invalidas.length) rep.avisos.push(`${fmtN(invalidas.length)} renglones con clave no válida se ignoran: ${lista(invalidas)}.`);
    if (inactivos) rep.info.push(`${fmtN(inactivos)} artículos con estatus distinto de "Activo".`);
  }

  /* ════════ EXIVAL ════════ */
  function validarExival(rows, rep) {
    const hEx = encabezado(rows, ['Existencia']), hCo = encabezado(rows, ['Último costo', 'Ultimo costo']), hVa = encabezado(rows, ['Valor total']);
    const falt = [['Existencia', hEx], ['Último costo', hCo], ['Valor total', hVa]].filter(x => !x[1]).map(x => x[0]);
    if (falt.length) { rep.errores.push(`No se encontraron las columnas: ${falt.join(', ')}. Exporta EXIVAL con el formato de siempre.`); return; }
    const val = rows.slice(0, 6).map(r => (r || []).find(c => typeof c === 'string' && /valuacion/.test(norm(c)))).find(Boolean);
    if (val && !/ultimo costo/.test(norm(val))) rep.avisos.push(`El reporte viene con "${val}"; el sistema espera valuación por Último costo.`);
    const cEx = hEx.col, cCo = hCo.col, cVa = hVa.col, INI = 6;
    // Datos ANTES de la fila donde el sistema empieza a leer → se perderían
    for (let i = 0; i < INI && i < rows.length; i++) {
      const r = rows[i]; if (r && esSKU(r[0]) && esNumero(r[cEx]) && i > hEx.fila) { rep.errores.push(`Hay artículos desde la fila ${i + 1}; el sistema lee EXIVAL a partir de la fila 7. El reporte cambió de estructura.`); break; }
    }
    let n = 0, sumEx = 0, sumVal = 0, ceros = 0, neg = 0, sinCosto = 0, noNum = 0;
    const seen = new Set(), dup = [];
    for (let i = INI; i < rows.length; i++) {
      const r = rows[i]; if (!r || r[0] == null || !esSKU(r[0])) continue;
      const k = String(r[0]).trim(); n++;
      if (seen.has(k)) dup.push(k); seen.add(k);
      if (r[cEx] != null && !esNumero(r[cEx])) noNum++;
      const ex = toNum(r[cEx]); sumEx += ex; sumVal += toNum(r[cVa]);
      if (ex === 0) ceros++; if (ex < 0) neg++;
      if (ex > 0 && !(toNum(r[cCo]) > 0)) sinCosto++;
    }
    Object.assign(rep.stats, { filas: n, existencia: sumEx, valor: sumVal, ceros, claves: seen });
    if (!n) { rep.errores.push('EXIVAL no trae artículos.'); return; }
    if (dup.length) rep.errores.push(`${fmtN(dup.length)} claves repetidas en EXIVAL (duplicarían inventario): ${lista(dup)}.`);
    if (noNum) rep.errores.push(`${fmtN(noNum)} renglones con existencia no numérica en la columna ${colLetra(cEx)}.`);
    const tot = filaTotal(rows, /^total\s+([\d,]+)\s+art/i);
    if (!tot) rep.avisos.push('No se encontró la fila "Total N artículos" para cuadrar el reporte.');
    else {
      if (tot.n !== n) rep.errores.push(`El reporte dice ${fmtN(tot.n)} artículos y se leyeron ${fmtN(n)}. Hay renglones que no se pudieron leer.`);
      if (!cuadra(sumEx, toNum(tot.r[cEx]))) rep.errores.push(`La existencia leída (${fmtN(sumEx)} pz) no cuadra con el total del reporte (${fmtN(toNum(tot.r[cEx]))} pz).`);
      if (!cuadra(sumVal, toNum(tot.r[cVa]))) rep.errores.push(`El valor leído (${fmt$(sumVal)}) no cuadra con el total del reporte (${fmt$(toNum(tot.r[cVa]))}).`);
    }
    // Artículos en existencia 0: el robot los necesita (tramo cero-stock)
    const sinEx = rows.slice(-15).map(r => r && r[0] != null && String(r[0]).match(/([\d,]+)\s+art[ií]culos sin existencia/i)).find(Boolean);
    if (sinEx) {
      const nSin = toNum(sinEx[1]);
      if (nSin !== ceros) rep.errores.push(`El reporte dice ${fmtN(nSin)} artículos sin existencia y se leyeron ${fmtN(ceros)} en cero.`);
    } else if (ceros === 0) {
      rep.errores.push('EXIVAL viene SIN artículos en existencia 0 (se exportó solo lo que tiene stock). Sin ellos el sistema pierde los agotados y su venta. Reexporta EXIVAL incluyendo los artículos sin existencia.');
    }
    if (neg) rep.avisos.push(`${fmtN(neg)} artículos con existencia negativa.`);
    if (sinCosto) rep.avisos.push(`${fmtN(sinCosto)} artículos con existencia pero sin último costo (no se pueden valuar ni comprar).`);
    rep.info.push(`${fmtN(n)} artículos · ${fmtN(sumEx)} pz · ${fmt$(sumVal)} · ${fmtN(ceros)} en cero`);
  }

  /* ════════ ROTINV ════════ */
  function validarRotinv(rows, rep) {
    const hSa = encabezado(rows, ['Salidas']), hRo = encabezado(rows, ['Rotación', 'Rotacion']);
    const falt = [['Salidas', hSa], ['Rotación', hRo]].filter(x => !x[1]).map(x => x[0]);
    if (falt.length) { rep.errores.push(`No se encontraron las columnas: ${falt.join(', ')}.`); return; }
    const INI = 4;
    for (let i = hSa.fila + 1; i < INI && i < rows.length; i++) { const r = rows[i]; if (r && esSKU(r[0]) && esNumero(r[hSa.col])) { rep.errores.push(`Hay artículos desde la fila ${i + 1}; el sistema lee ROTINV a partir de la fila 5.`); break; } }
    let n = 0, sal = 0, noNum = 0, rotTotal = 0; const seen = new Set(), dup = [];
    for (let i = INI; i < rows.length; i++) {
      const r = rows[i]; if (!r || r[0] == null || !esSKU(r[0])) continue;
      const k = String(r[0]).trim(); n++; if (seen.has(k)) dup.push(k); seen.add(k);
      // El ERP escribe "Total" en la rotación cuando el inventario promedio es 0
      // (rotación indefinida). Se lee como 0: es conocido, no bloquea.
      if (r[hRo.col] != null && !esNumero(r[hRo.col])) { if (norm(r[hRo.col]) === 'total') rotTotal++; else noNum++; }
      sal += toNum(r[hSa.col]);
    }
    Object.assign(rep.stats, { filas: n, salidas: sal, claves: seen });
    if (!n) { rep.errores.push('ROTINV no trae artículos.'); return; }
    if (dup.length) rep.avisos.push(`${fmtN(dup.length)} claves repetidas en ROTINV (se usa la última): ${lista(dup)}.`);
    if (noNum) rep.errores.push(`${fmtN(noNum)} renglones con rotación no numérica.`);
    if (rotTotal) rep.avisos.push(`${fmtN(rotTotal)} artículos traen rotación "Total" (inventario promedio 0, se vendió todo): se toman como rotación 0.`);
    const tot = filaTotal(rows, /^total\s+([\d,]+)\s+art/i);
    if (!tot) rep.avisos.push('No se encontró la fila "Total N artículos" para cuadrar el reporte.');
    else {
      if (tot.n !== n) rep.errores.push(`El reporte dice ${fmtN(tot.n)} artículos y se leyeron ${fmtN(n)}.`);
      if (!cuadra(sal, toNum(tot.r[hSa.col]))) rep.errores.push(`Las salidas leídas (${fmtN(sal)}) no cuadran con el total del reporte (${fmtN(toNum(tot.r[hSa.col]))}).`);
    }
    rep.info.push(`${fmtN(n)} artículos · ${fmtN(sal)} pz de salidas`);
  }

  /* ════════ COMPRAS ════════ */
  // Posiciones FIJAS que usa loadCompras (dataProcessor.js)
  const COMPRAS_COLS = [['Fecha', 0], ['Folio', 1], ['Descripción', 3], ['Unidades', 12], ['Costo unitario', 16], ['Costo total', 18]];
  function validarCompras(rows, rep) {
    const hF = encabezado(rows, ['Fecha']);
    if (!hF) { rep.errores.push('No se encontró el encabezado "Fecha" del reporte de compras.'); return; }
    const hr = (rows[hF.fila] || []).map(norm);
    const movidas = COMPRAS_COLS.filter(([t, c]) => hr[c] !== norm(t));
    if (movidas.length) {
      rep.errores.push('Columnas fuera de lugar: ' + movidas.map(([t, c]) => {
        const real = hr.indexOf(norm(t));
        return `"${t}" se espera en ${colLetra(c)}${real >= 0 ? ' y vino en ' + colLetra(real) : ' y no se encontró'}`;
      }).join('; ') + '. El sistema leería cantidades/costos equivocados.');
      return;
    }
    const concepto = rows.slice(0, 6).map(r => (r || []).find(c => typeof c === 'string' && /concepto/.test(norm(c)))).find(Boolean);
    if (concepto && !/recepcion de mercancia/.test(norm(concepto))) rep.avisos.push(`El reporte trae "${concepto}"; el sistema espera "Concepto: Recepción de mercancía".`);
    let folios = 0, lineas = 0, excl = 0, sumTodas = 0, sumIncl = 0, fmin = null, fmax = null, huerfanas = 0;
    const esFecha = v => (v instanceof Date) || (typeof v === 'number' && v > 30000 && v < 80000) || (typeof v === 'string' && /20\d{2}/.test(v));
    const aIso = v => { if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); } if (v instanceof Date) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate()); const m = String(v).match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/); return m ? iso(+m[1], +m[2], +m[3]) : null; };
    let hayFolio = false;
    for (let i = hF.fila + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      if (r[0] != null && /^total/i.test(String(r[0]))) continue;
      if (esFecha(r[0])) { folios++; hayFolio = true; const f = aIso(r[0]); if (f) { if (!fmin || f < fmin) fmin = f; if (!fmax || f > fmax) fmax = f; } }
      else if (r[3] != null && String(r[3]).trim()) {
        if (!hayFolio) huerfanas++;
        lineas++; const t = r[18] != null ? toNum(r[18]) : toNum(r[12]) * toNum(r[16]); sumTodas += t;
        if (toNum(r[12]) > 0 && toNum(r[16]) > 0) sumIncl += t; else excl++;
      }
    }
    Object.assign(rep.stats, { filas: lineas - excl, folios, total: sumIncl, fechaMin: fmin, fechaMax: fmax });
    if (!folios) { rep.errores.push('No se reconocieron fechas de folio en la columna A: el período no se podría calcular.'); return; }
    if (!lineas) { rep.errores.push('El reporte de compras no trae renglones de artículos.'); return; }
    if (huerfanas) rep.errores.push(`${fmtN(huerfanas)} renglones de artículo antes del primer folio/fecha.`);
    const tot = filaTotal(rows, /^total\s+([\d,]+)\s+doc/i);
    if (!tot) rep.avisos.push('No se encontró la fila "Total N documentos" para cuadrar el reporte.');
    else {
      if (tot.n !== folios) rep.errores.push(`El reporte dice ${fmtN(tot.n)} documentos y se leyeron ${fmtN(folios)} folios.`);
      if (!cuadra(sumTodas, toNum(tot.r[18]))) rep.errores.push(`El costo total leído (${fmt$(sumTodas)}) no cuadra con el total del reporte (${fmt$(toNum(tot.r[18]))}).`);
    }
    if (excl) rep.avisos.push(`${fmtN(excl)} renglones con unidades o costo en 0/negativo no se cuentan como compra.`);
    rep.info.push(`${fmtN(folios)} documentos · ${fmtN(lineas)} renglones · ${fmt$(sumIncl)} · fechas ${fmin} → ${fmax}`);
  }

  /* ════════ VECLIEARTS ════════ */
  function validarVentas(rows, rep) {
    // Encabezado de artículo: "Venta" en M–O, "Unidades" en Q (loadVentas lee O=venta y Q=unidades)
    let hdr = null;
    for (let i = 0; i < Math.min(40, rows.length); i++) { const r = rows[i] || []; if (norm(r[0]) === 'articulo' && r.some(c => norm(c) === 'venta')) { hdr = r.map(norm); break; } }
    if (!hdr) { rep.errores.push('No se encontró el encabezado de artículos ("Artículo … Venta … Unidades").'); return; }
    const cV = hdr.indexOf('venta'), cU = hdr.indexOf('unidades');
    if (cV < 12 || cV > 14 || cU !== 16) {
      rep.errores.push(`Columnas fuera de lugar: "Venta" vino en ${colLetra(cV)} (se espera M–O) y "Unidades" en ${cU >= 0 ? colLetra(cU) : '—'} (se espera Q). El sistema leería importes/unidades equivocados.`);
      return;
    }
    let clientes = 0, lineas = 0, sumAll = 0, sumPos = 0, neg = 0, sinUds = 0, sinCliente = 0, sumTotCli = 0, nTotCli = 0, noNum = 0, filaNoNum = 0;
    for (let i = 5; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const s0 = r[0] != null ? String(r[0]).trim() : '';
      if (/^\d+$/.test(s0) && s0.length > 2 && r[3] != null && String(r[3]).trim() && r[14] == null && r[4] == null) clientes++;
      else if (esSKU(s0) && r[14] != null && r[4] != null && String(r[4]).trim()) {
        if (!clientes) sinCliente++;
        if (!esNumero(r[14])) { noNum++; if (!filaNoNum) filaNoNum = i + 1; continue; }
        lineas++; const v = toNum(r[14]); sumAll += v;
        if (v > 0) { sumPos += v; if (!(toNum(r[16]) > 0)) sinUds++; } else neg++;
      }
      if (r[12] != null && /^total /i.test(String(r[12]))) { nTotCli++; sumTotCli += toNum(r[14]); }
    }
    Object.assign(rep.stats, { filas: lineas, clientes, venta: sumPos });
    if (!clientes) { rep.errores.push('No se reconocieron clientes (código en columna A y nombre en D).'); return; }
    if (!lineas) { rep.errores.push('El reporte de ventas no trae renglones de artículos.'); return; }
    if (noNum) rep.errores.push(`${fmtN(noNum)} renglones con importe de venta no numérico (primero en la fila ${filaNoNum}).`);
    if (sinCliente) rep.errores.push(`${fmtN(sinCliente)} renglones de artículo antes del primer cliente.`);
    if (!nTotCli) rep.avisos.push('No se encontraron las filas "Total <cliente>" para cuadrar el reporte.');
    else {
      if (nTotCli !== clientes) rep.errores.push(`El reporte trae ${fmtN(nTotCli)} totales de cliente y se leyeron ${fmtN(clientes)} clientes.`);
      if (!cuadra(sumAll, sumTotCli)) rep.errores.push(`La venta leída (${fmt$(sumAll)}) no cuadra con la suma de totales por cliente (${fmt$(sumTotCli)}).`);
    }
    if (neg) rep.avisos.push(`${fmtN(neg)} renglones con venta en 0 o negativa (devoluciones) no se cuentan.`);
    if (sinUds) rep.avisos.push(`${fmtN(sinUds)} renglones con venta pero sin unidades: no suman a la demanda diaria.`);
    rep.info.push(`${fmtN(clientes)} clientes · ${fmtN(lineas)} renglones · ${fmt$(sumPos)}`);
  }

  /* ════════ VAZLO (opcional) ════════
     El parseo lo hace dataProcessor.loadVazlo; aquí se revisa su resultado. */
  function validarVazlo(rows, rep, extra) {
    const v = extra && extra.vazlo;
    if (!v || !v.filas) { rep.errores.push('No se detectaron claves con existencia (columnas de clave y existencia).'); return; }
    rep.stats.filas = v.filas; rep.stats.claves = new Set(Object.keys(v.map));
    rep.info.push(`${fmtN(Object.keys(v.map).length)} claves con existencia`);
  }

  const VALIDADORES = { ARTICULOS: validarArticulos, EXIVAL: validarExival, ROTINV: validarRotinv, COMPRAS: validarCompras, VECLIEARTS: validarVentas, VAZLO: validarVazlo };

  /* ─── API: validar un archivo ya leído (filas de la 1ª hoja) ── */
  function validarArchivo(key, rows, archivo, extra) {
    const rep = nuevoReporte(key, archivo);
    try {
      if (!Array.isArray(rows) || !rows.length || rows.every(r => !r || r.every(c => c == null || c === ''))) {
        rep.errores.push('El archivo está vacío (la primera hoja no tiene datos).');
        return cerrar(rep);
      }
      if (key !== 'VAZLO' && !revisarTipo(rep, key, rows)) return cerrar(rep);
      const fe = key !== 'ARTICULOS' && key !== 'VAZLO' ? fechasEncabezado(rows) : null;
      if (fe) { rep.stats.fechaIni = fe.ini; rep.stats.fechaFin = fe.fin; }
      else if (key !== 'ARTICULOS' && key !== 'VAZLO') rep.avisos.push('No se encontró la fecha del reporte en el encabezado.');
      VALIDADORES[key](rows, rep, extra);
      if (key === 'COMPRAS' && fe && rep.stats.fechaMax && rep.stats.fechaMax > fe.fin) rep.errores.push(`Hay compras con fecha ${rep.stats.fechaMax}, posterior al cierre del reporte (${fe.fin}).`);
    } catch (e) {
      rep.errores.push('Error inesperado al revisar el archivo: ' + (e && e.message ? e.message : e));
    }
    return cerrar(rep);
  }

  /* Error de lectura (archivo dañado, con contraseña, no es Excel, …) */
  function errorLectura(key, archivo, e) {
    const rep = nuevoReporte(key, archivo);
    const msg = e && e.message ? e.message : String(e);
    let causa = 'el archivo está dañado o no es un Excel válido';
    if (/password|encrypt|cifrad/i.test(msg)) causa = 'el archivo está protegido con contraseña';
    else if (/unsupported|zip|signature|corrupt|end of data|invalid/i.test(msg)) causa = 'el archivo está dañado, incompleto o no es un .xlsx/.xls real';
    rep.errores.push(`No se pudo leer: ${causa}. Vuelve a exportarlo desde el ERP y guárdalo como Excel (.xlsx). Detalle: ${msg.slice(0, 160)}`);
    return cerrar(rep);
  }

  /* ─── Cruces entre archivos (después de leer los 5) ───── */
  function validarCruces(parsed, archivos) {
    const rep = nuevoReporte('CRUCES', ''); rep.nombre = 'Cruces entre archivos';
    try {
      // 1) Período: los reportes deben cerrar el mismo día y arrancar el mismo día
      const fines = ['EXIVAL', 'ROTINV', 'COMPRAS', 'VECLIEARTS'].map(k => [k, archivos[k] && archivos[k].stats.fechaFin]).filter(x => x[1]);
      const inis = ['ROTINV', 'COMPRAS', 'VECLIEARTS'].map(k => [k, archivos[k] && archivos[k].stats.fechaIni]).filter(x => x[1]);
      const dias = (a, b) => Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);
      const rango = arr => { const v = arr.map(x => x[1]).sort(); return v.length ? dias(v[0], v[v.length - 1]) : 0; };
      const det = arr => arr.map(([k, f]) => `${k} ${f}`).join(' · ');
      const rf = rango(fines), ri = rango(inis);
      if (rf > 7) rep.errores.push(`Los reportes no cierran en la misma fecha (${det(fines)}). Expórtalos todos al mismo corte.`);
      else if (rf > 0) rep.avisos.push(`Las fechas de cierre difieren ${rf} día(s): ${det(fines)}.`);
      if (ri > 7) rep.errores.push(`Los reportes no inician en la misma fecha (${det(inis)}): la demanda diaria saldría mal.`);
      else if (ri > 0) rep.avisos.push(`Las fechas de inicio difieren ${ri} día(s): ${det(inis)}.`);
      if (fines.length && rf === 0) rep.stats.corteSugerido = fines[0][1];

      // 2) Cobertura del catálogo en EXIVAL (EXIVAL es la base de artículos del sistema)
      const cat = new Set(parsed.articulos.map(a => a.clave));
      const exv = new Set(parsed.exival.map(e => e.clave));
      const faltan = [...cat].filter(c => !exv.has(c));
      const pctFaltan = cat.size ? faltan.length / cat.size : 0;
      rep.stats.catalogoSinExival = faltan.length;
      if (pctFaltan > 0.02) rep.errores.push(`${fmtN(faltan.length)} artículos del catálogo (${(pctFaltan * 100).toFixed(1)}%) no vienen en EXIVAL. EXIVAL parece incompleto (¿se exportó sin los artículos en cero o con un filtro?).`);
      else if (faltan.length) rep.avisos.push(`${fmtN(faltan.length)} artículos del catálogo no vienen en EXIVAL (no aparecerán en el sistema): ${lista(faltan)}.`);
      const fueraCat = [...exv].filter(c => !cat.has(c));
      if (fueraCat.length) rep.avisos.push(`${fmtN(fueraCat.length)} claves de EXIVAL no están en el catálogo (quedan como "SIN LÍNEA"): ${lista(fueraCat)}.`);

      // 3) Venta que se perdería: renglones de VECLIEARTS cuya clave no está en EXIVAL
      let vTot = 0, vFuera = 0; const clFuera = new Set();
      parsed.ventas.forEach(v => { vTot += v.venta; if (!exv.has(v.clave)) { vFuera += v.venta; clFuera.add(v.clave); } });
      const pv = vTot > 0 ? vFuera / vTot : 0;
      rep.stats.ventaFuera = vFuera;
      if (pv > 0.01) rep.errores.push(`${fmt$(vFuera)} de venta (${(pv * 100).toFixed(1)}%, ${fmtN(clFuera.size)} artículos) es de claves que no vienen en EXIVAL y se perdería del análisis.`);
      else if (vFuera > 0) rep.avisos.push(`${fmt$(vFuera)} de venta (${(pv * 100).toFixed(2)}%) es de ${fmtN(clFuera.size)} claves que no vienen en EXIVAL: ${lista([...clFuera])}.`);

      // 4) ROTINV vs EXIVAL
      const rotSinEx = parsed.rotinv.filter(r => !exv.has(r.clave)).length;
      if (rotSinEx) rep.info.push(`${fmtN(rotSinEx)} claves de ROTINV no están en EXIVAL (se ignoran).`);

      // 5) Vazlo vs catálogo
      if (parsed.vazlo && parsed.vazlo.filas) {
        const vz = Object.keys(parsed.vazlo.map); const m = vz.filter(c => cat.has(c)).length;
        if (vz.length && m / vz.length < 0.5) rep.avisos.push(`Solo ${fmtN(m)} de ${fmtN(vz.length)} claves del archivo Vazlo existen en el catálogo. Revisa que sea el archivo correcto.`);
      }
    } catch (e) {
      rep.errores.push('Error inesperado en los cruces: ' + (e && e.message ? e.message : e));
    }
    return cerrar(rep);
  }

  /* Resumen para mostrar y para guardar en meta (sin Sets) */
  function resumen(reporte) {
    const todos = [...Object.values(reporte.archivos || {}), ...(reporte.cruces ? [reporte.cruces] : [])];
    const errores = todos.reduce((s, r) => s + r.errores.length, 0), avisos = todos.reduce((s, r) => s + r.avisos.length, 0);
    return { ok: errores === 0, errores, avisos, fecha: new Date().toISOString().slice(0, 10),
      archivos: todos.map(r => ({ key: r.key, archivo: r.archivo, errores: r.errores.slice(), avisos: r.avisos.slice(), info: r.info.slice(),
        filas: r.stats.filas != null ? r.stats.filas : null, fechaIni: r.stats.fechaIni || null, fechaFin: r.stats.fechaFin || null })) };
  }

  return { validarArchivo, validarCruces, errorLectura, detectarTipo, fechasEncabezado, resumen, NOMBRES };
})();
