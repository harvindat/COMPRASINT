/* ============================================================
   dashboard.js — Página principal del dashboard ejecutivo
   ============================================================ */

window.PageDashboard = (function() {
  let charts = {};

  function render() {
    const D = window.CEDI_DATA;
    const { kpis, abc, lineas, compras_mes, clientes, riesgo } = D;
    const F = window.FMT;

    const coberturaBadge = kpis.cobertura_dias > 120
      ? '<span class="kpi-badge danger">Exceso crítico</span>'
      : kpis.cobertura_dias > 60
      ? '<span class="kpi-badge warn">Revisar</span>'
      : '<span class="kpi-badge ok">Óptimo</span>';

    const artsSinVentaBadge = kpis.arts_sin_venta > 7000
      ? '<span class="kpi-badge danger">Capital inmovilizado</span>'
      : '<span class="kpi-badge warn">Revisar</span>';

    const html = `
      <div class="page-header">
        <div class="page-title">Dashboard Ejecutivo</div>
        <div class="page-sub">Análisis del período ${F.periodoLabel()} · HARVIN DISTRIBUCIONES</div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-label">Inventario al corte</div>
          <div class="kpi-value">${F.compact(kpis.total_inv)}</div>
          <div class="kpi-sub-label">Sin IVA · ${F.compact(kpis.total_inv_iva)} con IVA</div>
          <div class="mt-4"><span class="kpi-badge ok">Valuación último costo</span></div>
        </div>
        <div class="kpi-card accent">
          <div class="kpi-label">Venta mensual promedio</div>
          <div class="kpi-value">${F.compact(kpis.venta_mensual)}</div>
          <div class="kpi-sub-label">Total ${F.numMeses()} meses: ${F.compact(kpis.venta_5m)}</div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-label">Compras del período</div>
          <div class="kpi-value">${F.compact(kpis.compras_5m)}</div>
          <div class="kpi-sub-label">${F.number(kpis.total_pedidos || 616)} pedidos · ${F.number(kpis.total_lineas_compra || 11854)} líneas</div>
        </div>
        <div class="kpi-card red">
          <div class="kpi-label">Cobertura de stock</div>
          <div class="kpi-value">${Math.round(kpis.cobertura_dias)} días</div>
          <div class="kpi-sub-label">${(kpis.cobertura_dias/30).toFixed(1)} meses de inventario</div>
          ${coberturaBadge}
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Artículos activos (con venta)</div>
          <div class="kpi-value">${F.number(kpis.arts_con_venta)}</div>
          <div class="kpi-sub-label">de ${F.number(kpis.total_articulos)} en catálogo</div>
          <div class="mt-4"><span class="kpi-badge ok">${Math.round(kpis.arts_con_venta/kpis.total_articulos*100)}% del catálogo</span></div>
        </div>
        <div class="kpi-card red">
          <div class="kpi-label">Sin ventas en el período</div>
          <div class="kpi-value">${F.number(kpis.arts_sin_venta)}</div>
          <div class="kpi-sub-label">artículos con stock activo</div>
          ${artsSinVentaBadge}
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Con stock disponible</div>
          <div class="kpi-value">${F.number(kpis.arts_con_stock)}</div>
          <div class="kpi-sub-label">${F.number(kpis.arts_sin_stock)} artículos en cero</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Clientes activos</div>
          <div class="kpi-value">${kpis.total_clientes}</div>
          <div class="kpi-sub-label">${kpis.num_clientes_ancla || 4} clientes ancla = ${kpis.pct_ancla_total || 0}% ventas</div>
        </div>
      </div>

      <div class="section-row cols-2">
        <div class="card">
          <div class="card-title">Compras por mes (costo sin IVA)</div>
          <div class="chart-wrap" style="height:200px"><canvas id="chartComprasMes" role="img" aria-label="Gráfica de compras mensuales">Compras mensuales Harvin Distribuciones</canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Ventas por línea de producto</div>
          <div class="chart-wrap" style="height:200px"><canvas id="chartLineas" role="img" aria-label="Ventas por línea de producto">Ventas por línea</canvas></div>
        </div>
      </div>

      <div class="section-row cols-3">
        <div class="card">
          <div class="card-title">Clasificación ABC</div>
          ${renderABC(abc, kpis.venta_5m)}
        </div>
        <div class="card">
          <div class="card-title">Top clientes ancla</div>
          ${renderTopClientes(clientes)}
        </div>
        <div class="card">
          <div class="card-title">Distribución ABC (gráfica)</div>
          <div class="chart-wrap" style="height:180px"><canvas id="chartABC" role="img" aria-label="Distribución ABC de artículos">Distribución ABC</canvas></div>
        </div>
      </div>

      <div class="card mt-12">
        <div class="flex justify-between mb-12">
          <div class="card-title" style="margin-bottom:0">⚠ Artículos en riesgo de quiebre (ABC A/B — cobertura &lt; 14 días)</div>
          <span class="badge badge-danger">${riesgo.length} artículos</span>
        </div>
        ${renderTablaRiesgo(riesgo)}
      </div>
    `;

    document.getElementById('page-dashboard').innerHTML = html;
    renderCharts(compras_mes, lineas, abc);
  }

  function renderABC(abc, total) {
    const cats = { A: abc.find(x => x.cat === 'A'), B: abc.find(x => x.cat === 'B'), C: abc.find(x => x.cat === 'C'), D: abc.find(x => x.cat === 'D') };
    const F = window.FMT;
    let html = '';
    for (const [cat, data] of Object.entries(cats)) {
      if (!data) continue;
      const pctVenta = total > 0 ? (data.venta / total * 100) : 0;
      html += `
        <div class="stat-row">
          <span class="stat-key flex-center gap-8"><span class="badge badge-${cat}">${cat}</span> ${F.number(data.arts)} arts</span>
          <span class="stat-val">${F.compact(data.venta)} <span class="text-muted">(${pctVenta.toFixed(1)}%)</span></span>
        </div>`;
    }
    return html;
  }

  function renderTopClientes(clientes) {
    const F = window.FMT;
    const top5 = clientes.slice(0, 5);
    const total = clientes.reduce((s, c) => s + c.venta, 0);
    return top5.map((c, i) => {
      const col = F.avatarColors(i);
      const anclaTag = c.ancla ? ' <span class="badge badge-ancla">ancla</span>' : '';
      return `
        <div class="client-card">
          <div class="client-avatar" style="background:${col.bg};color:${col.color}">${F.initials(c.nombre)}</div>
          <div class="client-info">
            <div class="client-name">${c.nombre}${anclaTag}</div>
            <div class="client-meta">${c.arts} artículos · ${c.pct.toFixed(1)}% del total</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${c.pct}%;background:${col.color}"></div></div>
          </div>
          <div class="client-venta">
            <div class="client-venta-num">${F.compact(c.venta)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTablaRiesgo(riesgo) {
    const F = window.FMT;
    if (!riesgo || riesgo.length === 0) return '<div class="loading-msg">Sin artículos en riesgo</div>';
    const rows = riesgo.map(a => {
      const diasCls = F.diasColor(a.dias_cobertura);
      const score = Math.round(a.score_compra || 0);
      const sfill = F.scoreColor(score);
      return `
        <tr>
          <td class="clave">${a.clave}</td>
          <td class="desc">${a.descripcion}</td>
          <td>${F.abcBadge(a.abc)}</td>
          <td class="right">${F.number(a.existencia)}</td>
          <td class="right"><span class="dias-cob ${diasCls}">${Math.round(a.dias_cobertura)} días</span></td>
          <td class="right">${F.currency(a.costo_iva)}</td>
          <td>
            <div class="score-bar">
              <div class="score-track"><div class="score-fill ${sfill}" style="width:${score}%"></div></div>
              <span class="score-num">${score}</span>
            </div>
          </td>
        </tr>`;
    }).join('');
    return `
      <div class="tbl-wrap" style="max-height:320px;overflow-y:auto">
        <table class="data-table">
          <thead><tr>
            <th>Clave</th><th>Descripción</th><th>ABC</th>
            <th class="right">Stock</th><th class="right">Cobertura</th>
            <th class="right">Costo c/IVA</th><th>Prioridad</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderCharts(compras_mes, lineas, abc) {
    destroyCharts();

    // Chart: Compras por mes
    const ctxC = document.getElementById('chartComprasMes');
    if (ctxC) {
      charts.compras = new Chart(ctxC, {
        type: 'bar',
        data: {
          labels: compras_mes.map(m => m.mes),
          datasets: [{ label: 'Compras', data: compras_mes.map(m => m.total), backgroundColor: '#C8A84B', borderRadius: 4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '$' + ctx.parsed.y.toLocaleString('es-MX') } } },
          scales: {
            y: { ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K', font: { size: 10 } }, grid: { color: '#EEECEA' } },
            x: { ticks: { font: { size: 11 } }, grid: { display: false } }
          }
        }
      });
    }

    // Chart: Ventas por línea (top 6)
    const top6 = lineas.slice(0, 6);
    const ctxL = document.getElementById('chartLineas');
    if (ctxL) {
      charts.lineas = new Chart(ctxL, {
        type: 'bar',
        data: {
          labels: top6.map(l => l.linea.length > 14 ? l.linea.substring(0, 14) + '…' : l.linea),
          datasets: [{ label: 'Venta', data: top6.map(l => l.venta), backgroundColor: '#1D9E75', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '$' + ctx.parsed.x.toLocaleString('es-MX') } } },
          scales: {
            x: { ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'K', font: { size: 10 } }, grid: { color: '#EEECEA' } },
            y: { ticks: { font: { size: 10 } }, grid: { display: false } }
          }
        }
      });
    }

    // Chart: ABC donut
    const abcActivos = abc.filter(x => x.cat !== 'D');
    const ctxA = document.getElementById('chartABC');
    if (ctxA) {
      charts.abc = new Chart(ctxA, {
        type: 'doughnut',
        data: {
          labels: abcActivos.map(x => 'Clase ' + x.cat),
          datasets: [{
            data: abcActivos.map(x => x.arts),
            backgroundColor: ['#1D9E75', '#378ADD', '#EF9F27'],
            borderWidth: 2, borderColor: '#FFFFFF'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '65%',
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed + ' arts' } }
          }
        }
      });
    }
  }

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  return { render, destroyCharts };
})();
