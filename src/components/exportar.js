/* ============================================================
   exportar.js — Centro de exportación
   ============================================================ */

window.PageExportar = (function() {

  function render() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    const html = `
      <div class="page-header">
        <div class="page-title">Exportar</div>
        <div class="page-sub">Descarga los reportes y análisis en formato Excel</div>
      </div>

      <div class="export-grid">

        <div class="export-card">
          <div class="export-icon">📊</div>
          <div class="export-title">Inventario completo</div>
          <div class="export-desc">Todos los artículos con stock, costos (s/IVA y c/IVA), valor de inventario, clasificación ABC y cobertura de días.</div>
          <button class="btn btn-primary btn-sm" onclick="window.PageExportar.exportInventario()">↓ Descargar Excel</button>
        </div>

        <div class="export-card">
          <div class="export-icon">📈</div>
          <div class="export-title">Análisis ABC completo</div>
          <div class="export-desc">Clasificación A/B/C/D de todos los artículos con ventas, rotación, DPD, score de prioridad y % de clientes ancla.</div>
          <button class="btn btn-primary btn-sm" onclick="window.PageExportar.exportABC()">↓ Descargar Excel</button>
        </div>

        <div class="export-card">
          <div class="export-icon">🏪</div>
          <div class="export-title">Artículos en riesgo de quiebre</div>
          <div class="export-desc">Artículos ABC A/B con menos de 14 días de cobertura. Prioritarios para compra inmediata.</div>
          <button class="btn btn-primary btn-sm" onclick="window.PageExportar.exportRiesgo()">↓ Descargar Excel</button>
        </div>

        <div class="export-card">
          <div class="export-icon">👥</div>
          <div class="export-title">Análisis clientes ancla</div>
          <div class="export-desc">Artículos con participación de clientes ancla, ventas por cliente estratégico y métricas de concentración.</div>
          <button class="btn btn-primary btn-sm" onclick="window.PageExportar.exportClientes()">↓ Descargar Excel</button>
        </div>

        <div class="export-card" style="border: 2px solid var(--c-accent)">
          <div class="export-icon">⟁</div>
          <div class="export-title">Pedido de compra inteligente</div>
          <div class="export-desc">Genera el pedido óptimo con los parámetros por defecto ($200K, lead time 5d, cobertura 30d). Para parámetros personalizados usa el módulo de Compra Inteligente.</div>
          <button class="btn btn-primary btn-sm" onclick="window.PageExportar.exportPedidoDefault()">↓ Generar y descargar</button>
        </div>

        <div class="export-card">
          <div class="export-icon">📋</div>
          <div class="export-title">Resumen ejecutivo KPIs</div>
          <div class="export-desc">KPIs principales del CEDI, distribución por línea, resumen por ABC y métricas de clientes en una hoja.</div>
          <button class="btn btn-primary btn-sm" onclick="window.PageExportar.exportResumen()">↓ Descargar Excel</button>
        </div>

      </div>

      <div class="card mt-16">
        <div class="card-title">Nota sobre costos y precios</div>
        <div style="font-size:13px;color:var(--c-text2);line-height:1.7">
          <p>Todos los costos en el sistema son el <strong>último costo de compra registrado</strong>, base sin IVA.</p>
          <p class="mt-8">Para calcular el costo con IVA se aplica el factor ×1.16 (IVA 16%).</p>
          <p class="mt-8">Los archivos de exportación incluyen ambas columnas (s/IVA y c/IVA) para máxima flexibilidad operativa.</p>
          <p class="mt-8">El score de prioridad de compra considera: clasificación ABC (40%), rotación normalizada (25%), concentración en clientes ancla (20%) y cobertura actual (15%).</p>
        </div>
      </div>
    `;

    document.getElementById('page-exportar').innerHTML = html;
  }

  function exportInventario() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    const rows = D.articulos.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'Clase ABC': a.abc,
      'Existencia': a.existencia,
      'Costo Unit. s/IVA': F.round2(a.costo_neto),
      'Costo Unit. c/IVA': F.round2(a.costo_iva),
      'Valor Inv. s/IVA': F.round2(a.valor_total),
      'Valor Inv. c/IVA': F.round2(a.valor_total * 1.16),
      'Venta 5m': F.round2(a.venta_total),
      'Unidades 5m': a.unidades_total,
      'Rotación': F.round2(a.rotacion),
      'DPD': F.round2(a.dpd),
      'Días Cobertura': Math.round(a.dias_cobertura || 0),
      'Score': Math.round(a.score_compra || 0)
    }));

    downloadXLSX(rows, 'Inventario_Completo', 'Inventario');
  }

  function exportABC() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    const rows = D.articulos.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'Clase ABC': a.abc,
      'Venta período': F.round2(a.venta_total),
      'Unidades 5m': a.unidades_total,
      'Stock Actual': a.existencia,
      'Costo c/IVA': F.round2(a.costo_iva),
      'Valor Inv.': F.round2(a.valor_total),
      'Rotación': F.round2(a.rotacion),
      'DPD': F.round2(a.dpd),
      'Días Cobertura': Math.round(a.dias_cobertura || 0),
      '% Ancla': F.round2((a.pct_ancla || 0) * 100),
      'Score Prioridad': Math.round(a.score_compra || 0),
      'Núm. Clientes': a.num_clientes
    }));

    downloadXLSX(rows, 'Analisis_ABC', 'ABC');
  }

  function exportRiesgo() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    const arts = D.articulos
      .filter(a => a.dpd > 0 && ['A','B'].includes(a.abc) && (a.dias_cobertura || 0) < 14)
      .sort((a, b) => (b.score_compra || 0) - (a.score_compra || 0));

    const rows = arts.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'Clase ABC': a.abc,
      'Stock Actual': a.existencia,
      'Días Cobertura': Math.round(a.dias_cobertura || 0),
      'DPD': F.round2(a.dpd),
      'Costo c/IVA': F.round2(a.costo_iva),
      'Venta 5m': F.round2(a.venta_total),
      'Score Prioridad': Math.round(a.score_compra || 0)
    }));

    downloadXLSX(rows, 'Articulos_Riesgo_Quiebre', 'Riesgo');
  }

  function exportClientes() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    // Clientes summary
    const clientes = D.clientes.map(c => ({
      'ID Cliente': c.id,
      'Nombre': c.nombre,
      'Venta Total 5m': F.round2(c.venta),
      '% del Total': F.round2(c.pct),
      'Artículos Comprados': c.arts,
      'Cliente Ancla': c.ancla ? 'Sí' : 'No'
    }));

    // Articles with ancla participation
    const artancla = D.articulos.filter(a => a.venta_ancla > 0)
      .sort((a,b) => b.venta_ancla - a.venta_ancla)
      .map(a => ({
        'Clave': a.clave,
        'Descripción': a.descripcion,
        'Línea': a.linea,
        'ABC': a.abc,
        'Venta Ancla': F.round2(a.venta_ancla),
        'Venta Total': F.round2(a.venta_total),
        '% Ancla': F.round2((a.pct_ancla || 0) * 100),
        'Stock': a.existencia,
        'Costo c/IVA': F.round2(a.costo_iva)
      }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(clientes);
    ws1['!cols'] = [12,35,16,10,14,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Clientes');

    const ws2 = XLSX.utils.json_to_sheet(artancla);
    ws2['!cols'] = [10,35,18,8,14,14,12,10,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Artículos Ancla');

    XLSX.writeFile(wb, `Clientes_Ancla_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function exportPedidoDefault() {
    const C = window.CALC;
    const D = window.CEDI_DATA;
    const F = window.FMT;

    const params = {
      presupuesto: 200000, leadTime: 5, diasCoberturaMeta: 30,
      factorSS: 1.0, filtroABC: ['A','B'], soloConDemanda: true
    };

    const result = C.optimizarPedido(D.articulos, params);

    const rows = result.pedido.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'ABC': a.abc,
      'Stock Actual': a.existencia,
      'Días Cob. Actual': Math.round(a.diasCobertura),
      'SS': a.ss,
      'ROP': a.rop,
      'Cant. Pedir': a.cantFinal,
      'Costo Unit. s/IVA': F.round2(a.costoUnit / 1.16),
      'Costo Unit. c/IVA': F.round2(a.costoUnit),
      'Costo Total c/IVA': F.round2(a.costoFinal),
      'Score': Math.round(a.score || 0),
      '% Ancla': F.round2(a.pctAncla * 100)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [10,35,18,5,10,12,8,8,10,16,16,16,8,10].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido $200K');

    const params_rows = [
      { Parámetro: 'Presupuesto', Valor: '$200,000' },
      { Parámetro: 'Lead Time', Valor: '5 días' },
      { Parámetro: 'Factor LT', Valor: '×1.00' },
      { Parámetro: 'Días Cobertura', Valor: '30 días' },
      { Parámetro: 'Factor SS', Valor: '1.0' },
      { Parámetro: 'Filtro ABC', Valor: 'A, B' },
      { Parámetro: '---', Valor: '---' },
      { Parámetro: 'Artículos en pedido', Valor: result.totalArts },
      { Parámetro: 'Unidades totales', Valor: result.totalUnidades },
      { Parámetro: 'Costo total c/IVA', Valor: F.round2(result.totalCosto) },
      { Parámetro: 'Presupuesto restante', Valor: F.round2(result.presupuestoRestante) },
      { Parámetro: 'Fecha generación', Valor: new Date().toLocaleDateString('es-MX') }
    ];
    const wsP = XLSX.utils.json_to_sheet(params_rows);
    wsP['!cols'] = [24, 20].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsP, 'Parámetros');

    XLSX.writeFile(wb, `Pedido_Compra_200K_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function exportResumen() {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    const { kpis, abc, lineas, clientes } = D;

    const wb = XLSX.utils.book_new();

    // KPIs sheet
    const kpiRows = [
      { Indicador: 'Valor Inventario s/IVA', Valor: kpis.total_inv },
      { Indicador: 'Valor Inventario c/IVA', Valor: F.round2(kpis.total_inv * 1.16) },
      { Indicador: 'Venta Total período', Valor: kpis.venta_5m },
      { Indicador: 'Venta Mensual Promedio', Valor: kpis.venta_mensual },
      { Indicador: 'Compras Total período', Valor: kpis.compras_5m },
      { Indicador: 'Cobertura Inventario (días)', Valor: kpis.cobertura_dias },
      { Indicador: 'Total Artículos Catálogo', Valor: kpis.total_articulos },
      { Indicador: 'Artículos con Stock', Valor: kpis.arts_con_stock },
      { Indicador: 'Artículos sin Stock', Valor: kpis.arts_sin_stock },
      { Indicador: 'Artículos con Ventas', Valor: kpis.arts_con_venta },
      { Indicador: 'Artículos sin Ventas 5m', Valor: kpis.arts_sin_venta },
      { Indicador: 'Total Clientes Período', Valor: kpis.total_clientes },
      { Indicador: 'Período Analizado', Valor: (D.meta.periodo || '') + ' (' + (D.meta.dias_periodo || '') + ' días)' },
      { Indicador: 'Fecha Corte', Valor: D.meta.fecha_corte || '' }
    ];
    const wsK = XLSX.utils.json_to_sheet(kpiRows);
    wsK['!cols'] = [30, 20].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsK, 'KPIs');

    // ABC sheet
    const abcRows = abc.map(x => ({
      Clase: x.cat, Artículos: x.arts,
      'Venta 5m': F.round2(x.venta),
      '% Venta': F.round2(x.venta / kpis.venta_5m * 100),
      'Inv. s/IVA': F.round2(x.inv)
    }));
    const wsA = XLSX.utils.json_to_sheet(abcRows);
    XLSX.utils.book_append_sheet(wb, wsA, 'ABC');

    // Lineas sheet
    const lineaRows = lineas.map(l => ({
      Línea: l.linea, Artículos: l.arts,
      'Venta 5m': F.round2(l.venta),
      'Inv. s/IVA': F.round2(l.inv),
      Unidades: l.uds
    }));
    const wsL = XLSX.utils.json_to_sheet(lineaRows);
    wsL['!cols'] = [25,10,14,14,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsL, 'Por Línea');

    // Clientes sheet
    const clienteRows = clientes.map(c => ({
      ID: c.id, Nombre: c.nombre,
      'Venta 5m': F.round2(c.venta),
      '% Total': F.round2(c.pct),
      Artículos: c.arts,
      Ancla: c.ancla ? 'Sí' : 'No'
    }));
    const wsCl = XLSX.utils.json_to_sheet(clienteRows);
    wsCl['!cols'] = [10,35,14,10,10,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsCl, 'Clientes');

    XLSX.writeFile(wb, `Resumen_Ejecutivo_CEDI_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function downloadXLSX(rows, filename, sheetname) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetname);
    XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return { render, exportInventario, exportABC, exportRiesgo, exportClientes, exportPedidoDefault, exportResumen };
})();
