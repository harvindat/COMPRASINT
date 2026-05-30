/* ============================================================
   clientes.js — Análisis de Clientes Ancla
   ============================================================ */

window.PageClientes = (function() {
  let charts = {};
  let selectedClient = null;
  let currentPage = 1;
  const PAGE_SIZE = 50;

  function render() {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    const { clientes, kpis } = D;
    const total_venta = kpis.venta_5m;
    const ancla = clientes.filter(c => c.ancla);
    const resto = clientes.filter(c => !c.ancla);

    // Pre-aggregate articles per client from articulos data
    // Each article has pct_ancla and venta_ancla

    const html = `
      <div class="page-header">
        <div class="page-title">Clientes Ancla</div>
        <div class="page-sub">Los ${kpis.num_clientes_ancla || ancla.length} clientes estratégicos que marcan la tendencia del mercado</div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-label">Venta total anclas</div>
          <div class="kpi-value">${F.compact(kpis.venta_ancla_total != null ? kpis.venta_ancla_total : ancla.reduce((s,c)=>s+c.venta,0))}</div>
          <div class="kpi-sub-label">${kpis.pct_ancla_total != null ? kpis.pct_ancla_total : 0}% del total del período</div>
        </div>
        <div class="kpi-card accent">
          <div class="kpi-label">Artículos exclusivos anclas</div>
          <div class="kpi-value">${F.number(kpis.arts_exclusivos_ancla || 0)}</div>
          <div class="kpi-sub-label">Solo comprados por estos ${kpis.num_clientes_ancla || ancla.length} clientes</div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-label">Artículos compartidos</div>
          <div class="kpi-value">${F.number(kpis.arts_compartidos_ancla || 0)}</div>
          <div class="kpi-sub-label">Anclas + resto de clientes</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Clientes totales período</div>
          <div class="kpi-value">${kpis.total_clientes}</div>
          <div class="kpi-sub-label">${resto.length} clientes no-ancla</div>
        </div>
      </div>

      <div class="section-row cols-2">
        <div class="card">
          <div class="card-title">Concentración de ventas</div>
          <div class="chart-wrap" style="height:200px"><canvas id="chartClientes" role="img" aria-label="Concentración de ventas por cliente">Ventas por cliente</canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Los 4 clientes ancla</div>
          ${ancla.map((c, i) => {
            const col = F.avatarColors(i);
            return `
              <div class="client-card" style="cursor:pointer" onclick="window.PageClientes.selectClient('${c.id}')">
                <div class="client-avatar" style="background:${col.bg};color:${col.color}">${F.initials(c.nombre)}</div>
                <div class="client-info">
                  <div class="client-name">${c.nombre} <span class="badge badge-ancla">ancla</span></div>
                  <div class="client-meta">${c.arts} artículos · ${c.pct.toFixed(1)}% del total</div>
                  <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(c.pct*2,100)}%;background:${col.color}"></div></div>
                </div>
                <div class="client-venta">
                  <div class="client-venta-num">${F.compact(c.venta)}</div>
                  <div class="client-venta-pct" style="color:${col.color}">${c.pct.toFixed(1)}%</div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="section-row cols-2">
        <div class="card">
          <div class="card-title">Todos los clientes</div>
          ${renderTablaClientes(clientes, total_venta)}
        </div>
        <div class="card" id="client-detail-card">
          <div class="card-title">Detalle de cliente</div>
          <div class="loading-msg" style="height:120px">Selecciona un cliente ancla para ver su detalle</div>
        </div>
      </div>

      <div class="card" id="client-arts-card" style="display:none">
        <div class="flex justify-between mb-12" style="flex-wrap:wrap;gap:8px">
          <div class="card-title" id="client-arts-title" style="margin-bottom:0">Artículos del cliente</div>
          <button class="btn btn-green btn-sm" id="btn-export-cliente">↓ Excel</button>
        </div>
        <div id="client-arts-content"></div>
        <div id="client-arts-pagination" style="margin-top:8px;font-size:12px;color:var(--c-text2)"></div>
      </div>
    `;

    document.getElementById('page-clientes').innerHTML = html;
    renderCharts(clientes, total_venta);

    const btnExp = document.getElementById('btn-export-cliente');
    if (btnExp) btnExp.addEventListener('click', exportarCliente);
  }

  function renderTablaClientes(clientes, total) {
    const F = window.FMT;
    let cumPct = 0;
    const rows = clientes.map((c, i) => {
      cumPct += c.pct;
      const anclaTag = c.ancla ? ' <span class="badge badge-ancla" style="font-size:9px">ancla</span>' : '';
      return `
        <tr style="cursor:pointer" onclick="window.PageClientes.selectClient('${c.id}')">
          <td>${i+1}</td>
          <td>${c.nombre}${anclaTag}</td>
          <td class="right">${F.currency(c.venta)}</td>
          <td class="right">${c.pct.toFixed(1)}%</td>
          <td class="right">${cumPct.toFixed(1)}%</td>
          <td class="right">${c.arts}</td>
        </tr>`;
    }).join('');
    return `
      <div class="tbl-wrap" style="max-height:380px;overflow-y:auto">
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>Cliente</th>
            <th class="right">Venta</th><th class="right">%</th>
            <th class="right">% Acum.</th><th class="right">Arts</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function selectClient(clientId) {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    selectedClient = clientId;

    const cliente = D.clientes.find(c => c.id === clientId);
    if (!cliente) return;

    // Find articles with high ancla concentration
    // We use venta_ancla from articulos — filter those where the client contributed
    // Since we don't have per-client article breakdown in the compressed data,
    // we show top articles by venta_ancla for ancla clients
    const col = F.avatarColors(D.clientes.findIndex(c => c.id === clientId));

    const detailCard = document.getElementById('client-detail-card');
    if (detailCard) {
      detailCard.innerHTML = `
        <div class="card-title">Detalle: ${cliente.nombre}</div>
        <div class="client-card" style="padding-top:0;border-bottom:none">
          <div class="client-avatar" style="width:48px;height:48px;font-size:16px;background:${col.bg};color:${col.color}">${F.initials(cliente.nombre)}</div>
          <div class="client-info">
            <div class="client-name">${cliente.nombre} ${cliente.ancla ? '<span class="badge badge-ancla">ancla</span>' : ''}</div>
            <div class="client-meta">ID: ${cliente.id}</div>
          </div>
        </div>
        <div class="stat-row"><span class="stat-key">Venta total del período</span><span class="stat-val" style="color:var(--c-green)">${F.currency(cliente.venta)}</span></div>
        <div class="stat-row"><span class="stat-key">Participación en ventas</span><span class="stat-val">${cliente.pct.toFixed(2)}%</span></div>
        <div class="stat-row"><span class="stat-key">Artículos distintos comprados</span><span class="stat-val">${F.number(cliente.arts)}</span></div>
        <div class="stat-row"><span class="stat-key">Venta promedio mensual</span><span class="stat-val">${F.currency(F.ventaMensual(cliente.venta))}</span></div>
        <div class="stat-row"><span class="stat-key">Ticket promedio por artículo</span><span class="stat-val">${F.currency(cliente.venta/cliente.arts)}</span></div>
        ${cliente.ancla ? `
        <div class="mt-8" style="padding:10px;background:var(--c-green-bg);border-radius:var(--r-sm)">
          <div style="font-size:11px;color:var(--c-green-text);font-weight:600">Cliente Ancla Estratégico</div>
          <div style="font-size:11px;color:var(--c-green-text);margin-top:3px">Su comportamiento de compra es indicador de demanda del mercado</div>
        </div>` : ''}
      `;
    }

    if (cliente.ancla) {
      const artsCard = document.getElementById('client-arts-card');
      if (artsCard) artsCard.style.display = 'block';
      const title = document.getElementById('client-arts-title');
      if (title) title.textContent = `Top artículos con mayor participación de clientes ancla`;
      renderArtsCliente();
    }
  }

  function renderArtsCliente() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    // Top articles by venta_ancla
    const arts = D.articulos
      .filter(a => a.venta_ancla > 0)
      .sort((a, b) => b.venta_ancla - a.venta_ancla);

    const total = arts.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = arts.slice(start, start + PAGE_SIZE);

    const rows = slice.map(a => {
      const pctAncla = Math.round((a.pct_ancla || 0) * 100);
      const barColor = pctAncla >= 70 ? '#C8A84B' : pctAncla >= 40 ? '#1D9E75' : '#888780';
      return `
        <tr>
          <td class="clave">${a.clave}</td>
          <td class="desc">${a.descripcion}</td>
          <td>${F.abcBadge(a.abc)}</td>
          <td class="right">${F.currency(a.venta_ancla)}</td>
          <td class="right">${F.currency(a.venta_total)}</td>
          <td>
            <div class="score-bar">
              <div class="score-track"><div class="score-fill" style="width:${pctAncla}%;background:${barColor}"></div></div>
              <span class="score-num">${pctAncla}%</span>
            </div>
          </td>
          <td class="right">${F.number(a.existencia)}</td>
          <td class="right">${F.currency(a.costo_iva)}</td>
        </tr>`;
    }).join('');

    const content = document.getElementById('client-arts-content');
    if (content) {
      content.innerHTML = `
        <div class="tbl-wrap" style="max-height:400px;overflow-y:auto">
          <table class="data-table">
            <thead><tr>
              <th>Clave</th><th>Descripción</th><th>ABC</th>
              <th class="right">Venta Ancla</th><th class="right">Venta Total</th>
              <th>% Ancla</th><th class="right">Stock</th><th class="right">Costo c/IVA</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const pgWrap = document.getElementById('client-arts-pagination');
    if (pgWrap && pages > 1) {
      pgWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${F.number(total)} artículos · pág ${currentPage}/${pages}</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="window.PageClientes.goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>← Ant</button>
            <button class="btn btn-outline btn-sm" onclick="window.PageClientes.goPage(${currentPage+1})" ${currentPage>=pages?'disabled':''}>Sig →</button>
          </div>
        </div>`;
    } else if (pgWrap) {
      pgWrap.innerHTML = `<span>${F.number(total)} artículos con venta ancla</span>`;
    }
  }

  function renderCharts(clientes, total) {
    destroyCharts();
    const top8 = clientes.slice(0, 8);
    const ctx = document.getElementById('chartClientes');
    if (!ctx) return;

    const colors = ['#1D9E75','#0F6E56','#EF9F27','#D85A30','#378ADD','#185FA5','#7F77DD','#888780'];
    charts.clientes = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: top8.map(c => c.nombre.split(' ').slice(0,2).join(' ')),
        datasets: [{
          data: top8.map(c => c.venta),
          backgroundColor: colors,
          borderWidth: 2, borderColor: '#FFFFFF'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.label + ': $' + ctx.parsed.toLocaleString('es-MX') + ' (' + (ctx.parsed/total*100).toFixed(1) + '%)' } }
        }
      }
    });
  }

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  function goPage(p) {
    currentPage = p;
    renderArtsCliente();
  }

  function exportarCliente() {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    const arts = D.articulos.filter(a => a.venta_ancla > 0).sort((a,b) => b.venta_ancla - a.venta_ancla);

    const rows = arts.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'Clase ABC': a.abc,
      'Venta Clientes Ancla': F.round2(a.venta_ancla),
      'Venta Total': F.round2(a.venta_total),
      '% Participación Ancla': F.round2((a.pct_ancla || 0) * 100),
      'Stock Actual': a.existencia,
      'Costo c/IVA': F.round2(a.costo_iva),
      'Score Prioridad': Math.round(a.score_compra || 0)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [10,35,18,8,16,14,18,10,12,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Análisis Clientes Ancla');
    XLSX.writeFile(wb, `Clientes_Ancla_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return { render, selectClient, goPage, destroyCharts };
})();
