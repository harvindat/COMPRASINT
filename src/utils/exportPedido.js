/* ============================================================
   exportPedido.js — Exportación ENRIQUECIDA del pedido a Excel
   CEDI Intelligence · Harvin Distribuciones
   ------------------------------------------------------------
   Solo interviene al exportar. No modifica el cálculo ni la vista
   web: toma el resultado ya calculado (optimizarPedido) y arma un
   libro con, por artículo:
     · VARIABLES DEL ROBOT (demanda, SS, ROP, objetivo, rotación,
       clientes, ancla, score / venta en riesgo, tramo y posición)
     · DECISIÓN DEL ROBOT (cantidad, costo, acumulado, Vazlo)
     · MOTOR ALTERNO (lo que pediría el otro motor con los mismos
       parámetros)
     · COMPLEMENTARIO (cliente principal, anclas que lo compran)
     · VEREDICTO y JUSTIFICACIÓN en texto
   Hojas: Resumen · Pedido · Análisis completo · Fuera por
   presupuesto · Metodología.

   Usa ExcelJS (estilos, encabezados agrupados, filtros, paneles
   congelados). Se carga del CDN SOLO al exportar; si no se puede
   cargar, compra.js cae a la exportación básica (SheetJS).
   ============================================================ */

window.EXPORT_PEDIDO = (function () {
  'use strict';

  const CDN = [
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
  ];

  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return new Promise((resolve, reject) => {
      let i = 0;
      const intentar = () => {
        if (i >= CDN.length) { reject(new Error('No se pudo cargar ExcelJS desde el CDN')); return; }
        const s = document.createElement('script');
        s.src = CDN[i++];
        const t = setTimeout(() => { s.onerror = s.onload = null; intentar(); }, 20000);
        s.onload = () => { clearTimeout(t); window.ExcelJS ? resolve(window.ExcelJS) : intentar(); };
        s.onerror = () => { clearTimeout(t); intentar(); };
        document.head.appendChild(s);
      };
      intentar();
    });
  }

  /* ─── utilidades ─────────────────────────────────────── */
  const TRAMO = { cero_rapido: 'T0 Cero-stock rápido', ancla: 'T1 Top ancla', general: 'T2 Cascada general' };
  const SURTIDO = { completo: 'COMPLETO', parcial: 'PARCIAL', sin_stock: 'SIN STOCK' };
  const money = v => '$' + Math.round(v || 0).toLocaleString('es-MX');
  const r2 = v => Math.round((v || 0) * 100) / 100;
  const r3 = v => Math.round((v || 0) * 1000) / 1000;
  function colLetra(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  /* ─── 1. ANÁLISIS: una fila por artículo evaluado ────── */
  function analizar(ctx) {
    const { result, params, data, CALC } = ctx;
    const arts = data.articulos || [];
    const motor = result.motor === 'pulido' ? 'pulido' : 'clasico';
    const diag = result.diagnostico || { porClave: {} };
    const pc = { ...params, leadTimeDias: params.leadTime, motor };
    const N = params.diasCoberturaMeta;
    const flt = CALC.factorLeadTime(params.leadTime);
    const diasObj = Math.ceil(N * flt);

    // medianas "rápido-movedor" (del cálculo si hubo blindaje; si no, se recalculan)
    const campoRapido = diag.campoRapido || (motor === 'pulido' ? 'dpd' : 'rotacion');
    const medianas = diag.medianas || (campoRapido === 'dpd' ? CALC.medianaDpdPorClase(arts) : CALC.medianaRotacionPorClase(arts));
    // rank ancla (del cálculo si hubo blindaje; si no, top N por venta ancla)
    let rankAncla = diag.rankAncla;
    if (!rankAncla) {
      rankAncla = {};
      arts.filter(a => (a.venta_ancla || 0) > 0).sort((a, b) => b.venta_ancla - a.venta_ancla)
        .slice(0, params.topAnclaN || 200).forEach((a, i) => { rankAncla[a.clave] = i + 1; });
    }

    // motor alterno con los mismos parámetros
    const otro = motor === 'pulido' ? 'clasico' : 'pulido';
    let alterno = {};
    try {
      const ra = CALC.optimizarPedido(arts, { ...params, motor: otro });
      ra.pedido.forEach(x => { alterno[x.clave] = { cant: x.cantFinal, tramo: x.tramo }; });
    } catch (e) { alterno = null; }

    // orden y acumulado del pedido
    const pedMap = {};
    let acum = 0;
    result.pedido.forEach((x, i) => { pedMap[x.clave] = { ...x, orden: i + 1, acumAntes: acum }; acum += x.costoFinal; });

    const universo = arts.filter(a => pedMap[a.clave] || diag.porClave[a.clave] || ((a.dpd || 0) > 0 && (a.costo_iva || 0) > 0));
    const filas = universo.map(a => {
      const p = pedMap[a.clave];
      const c = p || CALC.calcularArticulo(a, pc);
      const d = diag.porClave[a.clave];
      const valRap = campoRapido === 'dpd' ? (a.dpd || 0) : (a.rotacion || 0);
      const med = medianas[a.abc || 'D'] || 0;
      const f = {
        clave: a.clave, descripcion: a.descripcion || '', linea: a.linea || '', abc: a.abc || 'D',
        uds: a.unidades_total || 0, dpd: a.dpd || 0, dmd: a.dmd || 0,
        ss: c.ss != null ? c.ss : 0, rop: c.rop != null ? c.rop : 0, obj: c.stockObj != null ? c.stockObj : 0,
        need: c.cantPedir || 0, existencia: a.existencia || 0,
        cob: (a.dpd || 0) > 0 ? Math.round((a.existencia || 0) / a.dpd) : null,
        rot: a.rotacion || 0, med, rapido: valRap > 0 && valRap >= med,
        clientes: a.num_clientes || 0, vancla: a.venta_ancla || 0, pancla: a.pct_ancla || 0,
        rank: rankAncla[a.clave] || null, score: a.score_compra || 0,
        riesgo: c.riesgo != null ? c.riesgo : null,
        tramo: p ? p.tramo : (d ? d.tramo : null), pos: d ? d.pos : null, de: d ? d.de : null,
        cant: p ? p.cantFinal : 0, costo: a.costo_iva || 0, orden: p ? p.orden : null, acumAntes: p ? p.acumAntes : null,
        vz: a.existencia_vazlo != null ? a.existencia_vazlo : null, surtido: p ? p.surtido : null,
        alt: alterno ? (alterno[a.clave] || { cant: 0, tramo: null }) : null,
        cliTop: a.cliente_top || '', cliTopPct: a.cliente_top_pct != null ? a.cliente_top_pct : null,
        nAnclas: a.n_anclas != null ? a.n_anclas : null,
        dEstado: d ? d.estado : null, topePedir: d ? d.topePedir : null,
        piso: motor === 'pulido' && (a.dpd || 0) * diasObj < 0.5
      };
      // estado y veredicto
      if (p) {
        f.estado = 'COMPRA';
        f.veredicto = f.cant >= f.need ? 'CUBRE NECESIDAD'
          : (f.dEstado === 'recortado_vazlo' || (result.limitarVazlo && f.vz != null && f.cant >= f.vz)) ? 'CUBRE PARCIAL · stock Vazlo' : 'CUBRE PARCIAL · presupuesto';
      } else if (f.dEstado === 'fuera_presupuesto') { f.estado = 'FUERA POR PRESUPUESTO'; f.veredicto = 'NO CUBRE · presupuesto'; }
      else if (f.dEstado === 'excluido_vazlo') { f.estado = 'SIN STOCK VAZLO'; f.veredicto = 'NO CUBRE · proveedor sin stock'; }
      else if ((a.dpd || 0) <= 0) { f.estado = 'SIN DEMANDA'; f.veredicto = 'NO APLICA'; }
      else if ((a.costo_iva || 0) <= 0) { f.estado = 'SIN COSTO EN ERP'; f.veredicto = 'NO APLICA'; }
      else if (f.need <= 0) { f.estado = 'EXISTENCIA CUBRE OBJETIVO'; f.veredicto = 'NO REQUIERE'; }
      else { f.estado = 'EXCLUIDO POR FILTRO ABC'; f.veredicto = 'NO CUBRE · filtro ABC'; }
      f.just = justificar(f, { motor, N, diasObj, params, result, campoRapido, otro });
      return f;
    });
    return { filas, motor, otro, N, diasObj, flt, campoRapido, alternoOk: !!alterno };
  }

  /* ─── 2. JUSTIFICACIÓN en texto ──────────────────────── */
  function justificar(f, k) {
    const s = [];
    if (f.dpd <= 0) { s.push('Sin venta en el periodo del dataset: el robot no calcula necesidad.'); return s.join(' '); }
    s.push(`DEMANDA: ${Math.round(f.uds)} pz vendidas en el periodo (${r3(f.dpd)}/día ≈ ${r2(f.dmd).toFixed(1)}/mes), clase ${f.abc}.`);
    const ssTxt = k.motor === 'pulido' ? r2(f.ss).toFixed(1) : String(f.ss);
    s.push(`OBJETIVO: ${k.diasObj} días × ${r3(f.dpd)} = ${(f.dpd * k.diasObj).toFixed(1)} pz + SS ${ssTxt} → objetivo ${f.obj} pz; existencia ${f.existencia} → necesidad ${f.need} pz.`);
    if (f.piso && f.obj > 0) s.push('Demanda del horizonte < ½ pz: objetivo = piso de 1 pz (clase A/B).');
    const crit = k.motor === 'pulido' ? `venta en riesgo ${money(f.riesgo)}` : `score ${r2(f.score).toFixed(1)}`;
    const rapTxt = k.campoRapido === 'dpd'
      ? `DPD ${r3(f.dpd)} ≥ mediana de su clase ${r3(f.med)}`
      : `rotación ${r2(f.rot).toFixed(2)} ≥ mediana de su clase ${r2(f.med).toFixed(2)}`;
    const posTxt = f.pos ? ` #${f.pos} de ${f.de}` : '';
    if (f.estado === 'COMPRA') {
      let why;
      if (f.tramo === 'cero_rapido') why = `existencia 0, clase ${f.abc} y rápido-movedor (${rapTxt}): tramo blindado, se financia primero; dentro del tramo ordena por ${crit}`;
      else if (f.tramo === 'ancla') why = `Top-${f.rank} en venta a clientes ancla (${money(f.vancla)}) con existencia ${f.existencia} ≤ punto de reorden ${f.rop}`;
      else if (f.piso && f.riesgo === 0) why = 'compra de servicio (piso de 1 pz), financiada al final de la fila con el presupuesto sobrante';
      else why = `prioridad por ${crit}`;
      s.push(`DECISIÓN: COMPRA ${f.cant} pz (${money(f.cant * f.costo)}) en ${TRAMO[f.tramo] || f.tramo}${posTxt}; ${why}. Acumulado al entrar ${money(f.acumAntes)} de ${money(k.params.presupuesto)}.`);
      if (f.veredicto === 'CUBRE PARCIAL · presupuesto') s.push(`Solo alcanzó para ${f.cant} de ${f.topePedir || f.need} pz: se agotó la bolsa del tramo.`);
      if (f.veredicto === 'CUBRE PARCIAL · stock Vazlo') s.push(`Topado al stock del proveedor (${f.vz} pz).`);
    } else if (f.estado === 'FUERA POR PRESUPUESTO') {
      s.push(`DECISIÓN: candidato en ${TRAMO[f.tramo] || f.tramo}${posTxt} (${crit}); el presupuesto se agotó antes de su turno.`);
    } else if (f.estado === 'SIN STOCK VAZLO') {
      s.push('DECISIÓN: candidato válido, pero en modo "calcular contra stock Vazlo" el proveedor no tiene existencia; su dinero se reasignó.');
    } else if (f.estado === 'EXISTENCIA CUBRE OBJETIVO') {
      s.push(`DECISIÓN: no compra; su existencia (${f.existencia} pz${f.cob != null ? ', ≈' + f.cob + ' días' : ''}) ya cubre el objetivo.`);
    } else if (f.estado === 'EXCLUIDO POR FILTRO ABC') {
      s.push(`DECISIÓN: necesita ${f.need} pz pero su clase ${f.abc} no está en el filtro ABC de la cascada general.`);
    } else if (f.estado === 'SIN COSTO EN ERP') {
      s.push('DECISIÓN: último costo en 0 en EXIVAL; no se puede valuar.');
    }
    s.push(`CLIENTES: ${f.clientes}${f.cliTop ? ` · principal ${f.cliTop}${f.cliTopPct != null ? ' (' + Math.round(f.cliTopPct * 100) + '%)' : ''}` : ''} · ${Math.round(f.pancla * 100)}% de su venta a clientes ancla${f.rank ? `, Top-${f.rank} ancla` : ''}.`);
    if (f.vz != null) s.push(`VAZLO: ${f.vz} pz en proveedor${f.surtido ? ' → surtido ' + (SURTIDO[f.surtido] || f.surtido).toLowerCase() : ''}.`);
    if (f.alt && f.alt.cant !== f.cant) s.push(`MOTOR ${k.otro === 'pulido' ? 'PULIDO' : 'CLÁSICO'}: pediría ${f.alt.cant} pz.`);
    return s.join(' ');
  }

  /* ─── 3. LIBRO ExcelJS ───────────────────────────────── */
  const C = { navy: 'FF1F3864', azul: 'FF2F5597', morado: 'FF7030A0', verde: 'FF0B6E4F', gris: 'FF595959', rojo: 'FFC00000',
    sub: 'FFD9E1F2', ok: 'FFC6EFCE', warn: 'FFFFEB9C', bad: 'FFFFC7CE', neutro: 'FFEDEDED', info: 'FFDDEBF7', blanco: 'FFFFFFFF' };
  const FMT = { int: '#,##0;(#,##0);-', mon: '$#,##0;($#,##0);-', mon2: '$#,##0.00;($#,##0.00);-', pct: '0.0%', d1: '0.0', d2: '0.00', d3: '0.000' };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const FONT = (o) => Object.assign({ name: 'Arial', size: 9 }, o || {});
  const COLOR_VEREDICTO = v => v === 'CUBRE NECESIDAD' ? C.ok : v.startsWith('CUBRE PARCIAL') ? C.warn : v.startsWith('NO CUBRE') ? C.bad : v === 'NO REQUIERE' ? C.info : C.neutro;
  const COLOR_ESTADO = e => e === 'COMPRA' ? C.ok : e === 'FUERA POR PRESUPUESTO' ? C.warn : e === 'EXISTENCIA CUBRE OBJETIVO' ? C.info : e === 'SIN STOCK VAZLO' ? C.bad : C.neutro;
  const COLOR_TRAMO = t => t === 'cero_rapido' ? C.bad : t === 'ancla' ? C.warn : t === 'general' ? C.ok : null;

  function definirColumnas(an, hojaPedido) {
    const pul = an.motor === 'pulido';
    const otroTxt = an.otro === 'pulido' ? 'pulido' : 'clásico';
    // [grupo, encabezado, ancho, formato, getter(fila) | {f: (r, L) => fórmula, v: valor}]
    const cols = [
      ['ID', 'Orden de compra', 7, FMT.int, f => f.orden],
      ['ID', 'Clave', 11, null, f => f.clave],
      ['ID', 'Descripción', 42, null, f => f.descripcion],
      ['ID', 'Línea', 16, null, f => f.linea],
      ['VAR', 'ABC', 6, null, f => f.abc],
      ['VAR', 'Uds vendidas periodo', 9, FMT.int, f => f.uds],
      ['VAR', 'DPD (pz/día)', 8, FMT.d3, f => r3(f.dpd)],
      ['VAR', 'Demanda mes', 8, FMT.d1, f => r2(f.dmd)],
      ['VAR', `Demanda ${an.N}d`, 8, FMT.d1, { f: (r, L) => `${L['DPD (pz/día)']}${r}*${an.N}`, v: f => f.dpd * an.N }],
      ['VAR', 'SS', 6, pul ? FMT.d1 : FMT.int, f => pul ? r2(f.ss) : f.ss],
      ['VAR', 'ROP', 6, FMT.int, f => f.rop],
      ['VAR', 'Objetivo', 8, FMT.int, f => f.obj],
      ['VAR', 'Necesidad robot', 9, FMT.int, f => f.need],
      ['VAR', 'Existencia', 8, FMT.int, f => f.existencia],
      ['VAR', 'Cobertura días', 8, FMT.int, f => f.cob],
      ['VAR', 'Rotación', 8, FMT.d2, f => r2(f.rot)],
      ['VAR', an.campoRapido === 'dpd' ? 'Mediana DPD clase' : 'Mediana rot clase', 8, an.campoRapido === 'dpd' ? FMT.d3 : FMT.d2, f => an.campoRapido === 'dpd' ? r3(f.med) : r2(f.med)],
      ['VAR', '¿Rápido?', 7, null, f => f.rapido ? 'SÍ' : 'NO'],
      ['VAR', '# Clientes', 7, FMT.int, f => f.clientes],
      ['VAR', 'Venta anclas $', 11, FMT.mon, f => r2(f.vancla)],
      ['VAR', '% ancla', 7, FMT.pct, f => f.pancla],
      ['VAR', 'Rank ancla', 7, FMT.int, f => f.rank],
      ['VAR', 'Score', 7, FMT.d1, f => r2(f.score)],
      ...(pul ? [['VAR', `Venta en riesgo ${an.N}d $`, 11, FMT.mon, f => r2(f.riesgo)]] : []),
      ['VAR', 'Tramo', 19, null, f => TRAMO[f.tramo] || ''],
      ['VAR', 'Posición en tramo', 8, FMT.int, f => f.pos],
      ['VAR', 'Candidatos tramo', 9, FMT.int, f => f.de],
      ['DEC', 'CANT. A PEDIR', 9, FMT.int, f => f.cant],
      ['DEC', 'Costo unit c/IVA', 10, FMT.mon2, f => r2(f.costo)],
      ['DEC', '$ compra', 11, FMT.mon, { f: (r, L) => `${L['CANT. A PEDIR']}${r}*${L['Costo unit c/IVA']}${r}`, v: f => f.cant * f.costo }],
      hojaPedido
        ? ['DEC', 'Acumulado al entrar', 12, FMT.mon, { f: (r, L, r0) => r === r0 ? '0' : `SUM(${L['$ compra']}$${r0}:${L['$ compra']}${r - 1})`, v: f => f.acumAntes }]
        : ['DEC', 'Acumulado al entrar', 12, FMT.mon, f => f.acumAntes],
      ['DEC', 'Exist. Vazlo', 9, FMT.int, f => f.vz],
      ['DEC', 'Surtido Vazlo', 11, null, f => SURTIDO[f.surtido] || ''],
      ['DEC', 'Uds surtibles', 8, FMT.int, { f: (r, L) => `IF(${L['Exist. Vazlo']}${r}="","",MIN(${L['CANT. A PEDIR']}${r},${L['Exist. Vazlo']}${r}))`, v: f => f.vz == null ? '' : Math.min(f.cant, f.vz) }],
      ...(an.alternoOk ? [
        ['ALT', `Cant. motor ${otroTxt}`, 9, FMT.int, f => f.alt.cant],
        ['ALT', `$ motor ${otroTxt}`, 11, FMT.mon, { f: (r, L) => `${L[`Cant. motor ${otroTxt}`]}${r}*${L['Costo unit c/IVA']}${r}`, v: f => f.alt.cant * f.costo }],
        ['ALT', `Tramo motor ${otroTxt}`, 18, null, f => TRAMO[f.alt.tramo] || ''],
        ['ALT', 'Diferencia pz (actual − alterno)', 9, FMT.int, { f: (r, L) => `${L['CANT. A PEDIR']}${r}-${L[`Cant. motor ${otroTxt}`]}${r}`, v: f => f.cant - f.alt.cant }]
      ] : []),
      ['COMP', 'Cliente principal', 26, null, f => f.cliTop || '—'],
      ['COMP', '% del cliente principal', 8, FMT.pct, f => f.cliTopPct],
      ['COMP', 'Clientes ancla que lo compran', 8, FMT.int, f => f.nAnclas],
      ['VER', 'ESTADO ROBOT', 24, null, f => f.estado],
      ['VER', 'VEREDICTO', 24, null, f => f.veredicto],
      ['VER', 'JUSTIFICACIÓN', 120, null, f => f.just]
    ];
    const grupos = {
      ID: ['ARTÍCULO', C.navy], VAR: ['VARIABLES DEL ROBOT', C.azul],
      DEC: [`DECISIÓN ROBOT · motor ${an.motor === 'pulido' ? 'pulido' : 'clásico'}`, C.morado],
      ALT: [`MOTOR ${otroTxt.toUpperCase()} (mismos parámetros)`, C.verde],
      COMP: ['COMPLEMENTARIO', C.gris], VER: ['VEREDICTO', C.rojo]
    };
    return { cols, grupos };
  }

  function hojaDetalle(wb, nombre, filas, an, hojaPedido, titulo) {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
    const { cols, grupos } = definirColumnas(an, hojaPedido);
    const L = {}; cols.forEach((c, i) => { L[c[1]] = colLetra(i + 1); });
    ws.getCell('A1').value = titulo; ws.getCell('A1').font = FONT({ bold: true, size: 12, color: { argb: C.navy } });
    // fila 2: grupos
    let i = 0;
    while (i < cols.length) {
      let j = i; while (j + 1 < cols.length && cols[j + 1][0] === cols[i][0]) j++;
      ws.mergeCells(2, i + 1, 2, j + 1);
      const cell = ws.getCell(2, i + 1);
      cell.value = grupos[cols[i][0]][0]; cell.fill = fill(grupos[cols[i][0]][1]);
      cell.font = FONT({ bold: true, color: { argb: C.blanco }, size: 10 }); cell.alignment = { horizontal: 'center' };
      i = j + 1;
    }
    // fila 3: encabezados
    cols.forEach((c, k) => {
      const cell = ws.getCell(3, k + 1);
      cell.value = c[1]; cell.fill = fill(grupos[c[0]][1]);
      cell.font = FONT({ bold: true, color: { argb: C.blanco } });
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      ws.getColumn(k + 1).width = c[2];
    });
    ws.getRow(3).height = 42;
    const r0 = 4;
    filas.forEach((f, idx) => {
      const r = r0 + idx;
      const row = ws.getRow(r);
      cols.forEach((c, k) => {
        const g = c[4];
        let v;
        if (typeof g === 'function') v = g(f);
        else { const res = g.v(f); v = { formula: g.f(r, L, r0), result: res }; }
        if (v === undefined || (typeof v === 'number' && !isFinite(v))) v = null;
        const cell = row.getCell(k + 1);
        cell.value = v;
        if (c[3]) cell.numFmt = c[3];
      });
      row.font = FONT();
      const est = row.getCell(cols.findIndex(c => c[1] === 'ESTADO ROBOT') + 1); est.fill = fill(COLOR_ESTADO(f.estado));
      const ver = row.getCell(cols.findIndex(c => c[1] === 'VEREDICTO') + 1); ver.fill = fill(COLOR_VEREDICTO(f.veredicto));
      const ct = COLOR_TRAMO(f.tramo); if (ct && f.estado === 'COMPRA') row.getCell(cols.findIndex(c => c[1] === 'Tramo') + 1).fill = fill(ct);
    });
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
    return { ws, L, r0, rLast: r0 + filas.length - 1, cols };
  }

  function hojaResumen(ws, ctx, an, refs) {
    const { result, params } = ctx;
    ws.getColumn(1).width = 3; ws.getColumn(2).width = 52; [3, 4, 5, 6].forEach(c => { ws.getColumn(c).width = 16; }); ws.getColumn(7).width = 70;
    let r = 1;
    const put = (c, v, o) => { const cell = ws.getCell(r, c); cell.value = v; cell.font = FONT(Object.assign({ size: 10 }, (o && o.font) || {})); if (o && o.fmt) cell.numFmt = o.fmt; if (o && o.fill) cell.fill = fill(o.fill); if (o && o.wrap) cell.alignment = { wrapText: true, vertical: 'top' }; return cell; };
    const titulo = (t, hdrs) => { put(2, t, { font: { bold: true }, fill: C.sub }); (hdrs || []).forEach((h, k) => put(3 + k, h, { font: { bold: true }, fill: C.sub })); r++; };
    put(2, 'Pedido COMPRASINT — resumen y justificación', { font: { bold: true, size: 14, color: { argb: C.navy } } }); r++;
    const m = ctx.data.meta || {};
    put(2, `Generado ${new Date().toLocaleString('es-MX')} · datos ${m.periodo || ''} (corte ${m.fecha_corte || '—'}) · Vazlo ${ctx.vazloMeta && ctx.vazloMeta.fecha_carga ? 'cargado ' + ctx.vazloMeta.fecha_carga : 'sin cargar'}`, { font: { size: 9, color: { argb: C.gris } } }); r += 2;

    titulo('PARÁMETROS', ['Valor']);
    const P = [
      ['Motor de cálculo', an.motor === 'pulido' ? 'PULIDO' : 'CLÁSICO'],
      ...(an.motor === 'pulido' ? [['Piso 1 pz A/B', params.pisoAB !== false ? 'SÍ' : 'NO']] : []),
      ['Presupuesto', params.presupuesto, FMT.mon],
      ['Días de cobertura objetivo', params.diasCoberturaMeta],
      ['Lead time (días) · factor', `${params.leadTime} · ×${an.flt.toFixed(2)} → objetivo ${an.diasObj} días`],
      ['Factor stock de seguridad', params.factorSS],
      ['Filtro ABC cascada general', (params.filtroABC || []).join(', ')],
      ['Blindaje', result.blindaje ? `ACTIVO · alcance ${(result.blindajeAlcance || []).join('+')} · topes ${Math.round((result.topeT0 || 0) * 100)}% / ${Math.round((result.topeT1 || 0) * 100)}%` : 'No usado'],
      ['Existencia Vazlo', result.usarVazlo ? (result.limitarVazlo ? 'Limitado al stock del proveedor' : 'Informativo') : 'No usada'],
      ['Criterio de prioridad', an.motor === 'pulido' ? 'Venta en riesgo $ (empate: score)' : 'Score'],
      ['Rápido-movedor', an.campoRapido === 'dpd' ? 'DPD ≥ mediana de DPD de su clase' : 'Rotación ≥ mediana de rotación de su clase']
    ];
    P.forEach(p => { put(2, p[0]); put(3, p[1], { fmt: p[2], font: { color: { argb: 'FF0000FF' } } }); r++; });
    r++;
    titulo('RESULTADO', ['Valor']);
    [['Artículos en el pedido', result.totalArts, FMT.int], ['Unidades', result.totalUnidades, FMT.int], ['Costo total c/IVA', { formula: `SUM(Pedido!${refs.ped.L['$ compra']}${refs.ped.r0}:${refs.ped.L['$ compra']}${refs.ped.rLast})`, result: result.totalCosto }, FMT.mon],
     ['Presupuesto restante', result.presupuestoRestante, FMT.mon], ['% del presupuesto usado', (result.pctUsado || 0) / 100, FMT.pct],
     ...(result.necesidadTotal != null ? [['Necesidad total calculada c/IVA', result.necesidadTotal, FMT.mon]] : [])
    ].forEach(p => { put(2, p[0]); put(3, p[1], { fmt: p[2] }); r++; });
    r++;
    if (result.tramos) {
      titulo('TRAMOS DEL BLINDAJE', ['Candidatos', 'Financiados', '$', 'Fuera x presupuesto']);
      result.tramos.forEach(t => { put(2, t.nombre); put(3, t.candidatos, { fmt: FMT.int }); put(4, t.arts, { fmt: FMT.int }); put(5, t.costo, { fmt: FMT.mon }); put(6, t.fueraArts, { fmt: FMT.int }); r++; });
      r++;
    }
    const A = refs.an; const rng = n => `'Análisis completo'!$${A.L[n]}$${A.r0}:$${A.L[n]}$${A.rLast}`;
    titulo('ESTADO DE CADA ARTÍCULO EVALUADO (hoja Análisis completo)', ['Artículos', '$ necesidad', 'Significado']);
    [['COMPRA', 'Entra al pedido'], ['FUERA POR PRESUPUESTO', 'Candidato; el dinero se agotó antes de su turno'],
     ['SIN STOCK VAZLO', 'Candidato; el proveedor no tiene existencia (modo limitado)'], ['EXISTENCIA CUBRE OBJETIVO', 'Ya tiene lo necesario'],
     ['EXCLUIDO POR FILTRO ABC', 'Necesita pero su clase no está en el filtro'], ['SIN COSTO EN ERP', 'Costo 0']]
      .forEach(([e, n]) => {
        put(2, e, { fill: COLOR_ESTADO(e) });
        put(3, { formula: `COUNTIF(${rng('ESTADO ROBOT')},"${e}")` }, { fmt: FMT.int });
        put(4, { formula: `SUMPRODUCT((${rng('ESTADO ROBOT')}="${e}")*${rng('Necesidad robot')}*${rng('Costo unit c/IVA')})` }, { fmt: FMT.mon });
        put(5, n, { font: { color: { argb: C.gris } } }); r++;
      });
    r++;
    titulo('VEREDICTO DEL PEDIDO (hoja Pedido)', ['Artículos', 'Piezas', '$']);
    const P2 = n => `Pedido!$${refs.ped.L[n]}$${refs.ped.r0}:$${refs.ped.L[n]}$${refs.ped.rLast}`;
    ['CUBRE NECESIDAD', 'CUBRE PARCIAL · presupuesto', 'CUBRE PARCIAL · stock Vazlo'].forEach(v => {
      put(2, v, { fill: COLOR_VEREDICTO(v) });
      put(3, { formula: `COUNTIF(${P2('VEREDICTO')},"${v}")` }, { fmt: FMT.int });
      put(4, { formula: `SUMIF(${P2('VEREDICTO')},"${v}",${P2('CANT. A PEDIR')})` }, { fmt: FMT.int });
      put(5, { formula: `SUMIF(${P2('VEREDICTO')},"${v}",${P2('$ compra')})` }, { fmt: FMT.mon }); r++;
    });
    r++;
    if (an.alternoOk) {
      const otroTxt = an.otro === 'pulido' ? 'pulido' : 'clásico';
      titulo(`COMPARATIVO CONTRA MOTOR ${otroTxt.toUpperCase()} (mismos parámetros)`, ['Artículos', '$']);
      put(2, `Pedido del motor ${an.motor === 'pulido' ? 'pulido' : 'clásico'} (este)`); put(3, result.totalArts, { fmt: FMT.int }); put(4, result.totalCosto, { fmt: FMT.mon }); r++;
      put(2, `Pedido del motor ${otroTxt}`); put(3, { formula: `COUNTIF(${rng(`Cant. motor ${otroTxt}`)},">0")` }, { fmt: FMT.int }); put(4, { formula: `SUM(${rng(`$ motor ${otroTxt}`)})` }, { fmt: FMT.mon }); r++;
      r++;
    }
    const sinCli = !ctx.data.articulos.some(a => a.cliente_top);
    if (sinCli) {
      put(2, 'Nota: "Cliente principal" y "Clientes ancla que lo compran" aparecen vacíos porque el dataset actual se generó antes de esta versión. Se llenan al volver a procesar los reportes en Actualizar Datos.', { font: { italic: true, color: { argb: C.gris } }, wrap: true });
      ws.mergeCells(r, 2, r, 7); ws.getRow(r).height = 30; r++;
    }
  }

  function hojaFuera(wb, an) {
    const ws = wb.addWorksheet('Fuera por presupuesto', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
    const fuera = an.filas.filter(f => f.estado === 'FUERA POR PRESUPUESTO')
      .sort((a, b) => (a.tramo || '').localeCompare(b.tramo || '') || (a.pos || 0) - (b.pos || 0));
    const hdr = ['Tramo', 'Posición', 'Clave', 'Descripción', 'ABC', 'Necesidad pz', 'Costo unit c/IVA', '$ necesario', '$ adicional acumulado',
      an.motor === 'pulido' ? 'Venta en riesgo $' : 'Score', 'DPD', 'Existencia', 'Exist. Vazlo'];
    const w = [19, 8, 11, 42, 6, 9, 11, 11, 13, 11, 8, 8, 9];
    hdr.forEach((h, k) => { const c = ws.getCell(1, k + 1); c.value = h; c.fill = fill(C.navy); c.font = FONT({ bold: true, color: { argb: C.blanco } }); c.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' }; ws.getColumn(k + 1).width = w[k]; });
    ws.getRow(1).height = 36;
    fuera.forEach((f, i) => {
      const r = i + 2;
      const need = f.topePedir || f.need;
      const vals = [TRAMO[f.tramo] || '', f.pos, f.clave, f.descripcion, f.abc, need, r2(f.costo), { formula: `F${r}*G${r}`, result: need * f.costo },
        { formula: `SUMIF($A$2:A${r},A${r},$H$2:H${r})`, result: null }, an.motor === 'pulido' ? r2(f.riesgo) : r2(f.score), r3(f.dpd), f.existencia, f.vz];
      const fm = [null, FMT.int, null, null, null, FMT.int, FMT.mon2, FMT.mon, FMT.mon, an.motor === 'pulido' ? FMT.mon : FMT.d1, FMT.d3, FMT.int, FMT.int];
      vals.forEach((v, k) => { const c = ws.getCell(r, k + 1); c.value = v; if (fm[k]) c.numFmt = fm[k]; c.font = FONT(); });
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hdr.length } };
    const nota = fuera.length + 3;
    ws.getCell(nota, 3).value = '"$ adicional acumulado" = presupuesto extra que haría falta para que ese renglón entre, dentro de su tramo y en el orden del robot.';
    ws.getCell(nota, 3).font = FONT({ italic: true, color: { argb: C.gris } });
  }

  function hojaMetodologia(wb, an) {
    const ws = wb.addWorksheet('Metodología');
    ws.getColumn(1).width = 28; ws.getColumn(2).width = 110;
    const pul = an.motor === 'pulido';
    const M = [
      ['Columna', 'Qué significa / cómo se calcula'],
      ['DPD (pz/día)', 'Demanda por día = unidades vendidas en el periodo ÷ días del periodo.'],
      ['Demanda mes / Nd', 'DPD × 30.4 y DPD × días de cobertura objetivo.'],
      ['SS', pul ? 'Stock de seguridad = 1.65 × √(DPD × lead time) × factor SS (sin redondear). Si el artículo trae ventas mensuales se usa la variabilidad real si es mayor.' : 'Stock de seguridad = redondear hacia arriba(1.65 × 0.30·DPD × √lead time × factor SS).'],
      ['ROP', 'Punto de reorden = DPD × lead time + SS. En el tramo Top ancla solo entran artículos con existencia ≤ ROP.'],
      ['Objetivo', pul ? `redondear(DPD × ${an.diasObj} días + SS). Si la demanda del horizonte es < ½ pz: 0, o 1 pz (piso) para clases A/B.` : `redondear hacia arriba(DPD × ${an.diasObj} días + SS).`],
      ['Necesidad robot', 'Objetivo − existencia (mínimo 0), antes de presupuesto.'],
      ['Rotación / Mediana / ¿Rápido?', an.campoRapido === 'dpd' ? 'Rápido-movedor = DPD ≥ mediana de DPD de su clase ABC. La rotación (ROTINV) se muestra como referencia.' : 'Rápido-movedor = rotación ROTINV ≥ mediana de rotación de su clase ABC.'],
      ['Venta anclas / % ancla / Rank', 'Venta del artículo a los 4 clientes de mayor venta; % sobre la venta del artículo; lugar en el Top-200 por venta ancla.'],
      ['Score', '40% ABC + 25% rotación normalizada + 20% % ancla + 15% (1 − cobertura/365).'],
      ...(pul ? [['Venta en riesgo', `max(0, DPD × ${an.N} − existencia) × precio promedio de venta. Es el criterio de prioridad del motor pulido.`]] : []),
      ['Tramo / Posición / Candidatos', 'T0 cero-stock rápido (blindado), T1 Top ancla bajo reorden, T2 cascada general. Posición = lugar en la fila de su tramo; candidatos = tamaño de la fila.'],
      ['Acumulado al entrar', 'Dinero ya comprometido en el pedido cuando se financió este renglón.'],
      ['Motor alterno', 'Lo que pediría el otro motor (pulido/clásico) con exactamente los mismos parámetros.'],
      ['Cliente principal', 'Cliente con mayor venta del artículo en el periodo y su % de la venta del artículo.'],
      ['Veredicto', 'CUBRE NECESIDAD = se compra todo lo que el robot calculó; CUBRE PARCIAL = limitado por presupuesto o stock Vazlo; NO CUBRE / NO REQUIERE para los no comprados.']
    ];
    M.forEach((m, i) => {
      const a = ws.getCell(i + 1, 1), b = ws.getCell(i + 1, 2);
      a.value = m[0]; b.value = m[1]; b.alignment = { wrapText: true, vertical: 'top' };
      a.font = FONT({ bold: true, color: i === 0 ? { argb: C.blanco } : undefined }); b.font = FONT({ bold: i === 0, color: i === 0 ? { argb: C.blanco } : undefined });
      if (i === 0) { a.fill = fill(C.navy); b.fill = fill(C.navy); }
    });
  }

  async function construirLibro(ExcelJS, ctx) {
    const an = analizar(ctx);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'COMPRASINT'; wb.created = new Date();
    wb.calcProperties.fullCalcOnLoad = true;
    const ordenPed = an.filas.filter(f => f.estado === 'COMPRA').sort((a, b) => a.orden - b.orden);
    const orderEst = { 'COMPRA': 0, 'FUERA POR PRESUPUESTO': 1, 'SIN STOCK VAZLO': 2, 'EXCLUIDO POR FILTRO ABC': 3, 'EXISTENCIA CUBRE OBJETIVO': 4, 'SIN COSTO EN ERP': 5, 'SIN DEMANDA': 6 };
    const ordenAn = an.filas.slice().sort((a, b) => (orderEst[a.estado] - orderEst[b.estado]) || ((a.orden || a.pos || 1e9) - (b.orden || b.pos || 1e9)) || (b.dpd - a.dpd));
    const wsRes = wb.addWorksheet('Resumen');   // primera hoja; se llena al final
    const ped = hojaDetalle(wb, 'Pedido', ordenPed, an, true, `Pedido del robot · ${ordenPed.length} artículos · ${money(ctx.result.totalCosto)} de ${money(ctx.params.presupuesto)}`);
    const anl = hojaDetalle(wb, 'Análisis completo', ordenAn, an, false, `Todos los artículos evaluados (${ordenAn.length}) · por qué se compran o no`);
    hojaFuera(wb, an);
    hojaMetodologia(wb, an);
    hojaResumen(wsRes, ctx, an, { ped, an: anl });
    return { wb, an };
  }

  async function exportar(ctx) {
    const ExcelJS = await cargarExcelJS();
    const { wb } = await construirLibro(ExcelJS, ctx);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Pedido_CEDI_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { exportar, construirLibro, analizar, cargarExcelJS };
})();
