/* ============================================================
   abc.js — Análisis ABC completo
   ============================================================ */

window.PageABC = (function() {
  let charts = {};
  let currentFilter = 'todos';
  let currentPage = 1;
  const PAGE_SIZE = 60;
  let searchQuery = '';

  function render() {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    const { abc, kpis, lineas } = D;
    const total_venta = kpis.venta_5m;

    const abcMap = {};
    abc.forEach(x => { abcMap[x.cat] = x; });

    const html = `
      <div class="page-header">
        <div class="page-title">Análisis ABC</div>
        <div class="page-sub">Clasificación de artículos por valor de venta · ${F.periodoLabel()}</div>
      </div>

      <div class="section-row cols-3b">
        ${['A','B','C','D'].map(cat => {
          const d = abcMap[cat] || { arts: 0, venta: 0, inv: 0 };
          const pctVenta = total_venta > 0 ? (d.venta / total_venta * 100).toFixed(1) : '0.0';
          const pctArts = kpis.total_articulos > 0 ? (d.arts / kpis.total_articulos * 100).toFixed(1) : '0.0';
          const labels = { A: 'Alta rotación · 70% ventas', B: 'Rotación media · 20% ventas', C: 'Baja rotación · 10% ventas', D: 'Sin ventas en período' };
          return `
            <div class="kpi-card ${cat === 'A' ? 'green' : cat === 'B' ? 'blue' : cat === 'C' ? 'accent' : ''}">
              <div class="kpi-label">${F.abcBadge(cat)} Clase ${cat}</div>
              <div class="kpi-value">${F.number(d.arts)}</div>
              <div class="kpi-sub-label">${pctArts}% del catálogo</div>
              <div class="kpi-sub-label">${F.compact(d.venta)} · ${pctVenta}% venta</div>
              <div class="mt-4" style="font-size:10px;color:var(--c-text3)">${labels[cat]}</div>
            </div>`;
        }).join('')}
      </div>

      <div class="section-row cols-2">
        <div class="card">
          <div class="card-title">Participación en ventas por clase</div>
          <div class="chart-wrap" style="height:220px"><canvas id="chartAbcVenta" role="img" aria-label="Participación en ventas por clase ABC">ABC ventas</canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Ventas por línea (top líneas)</div>
          <div class="bar-chart-simple" id="bc-lineas">
            ${renderBarLineas(lineas)}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex justify-between mb-12" style="flex-wrap:wrap;gap:8px;align-items:center">
          <div class="card-title" style="margin-bottom:0">Catálogo completo por clasificación</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <div style="display:flex;gap:4px">
              ${['todos','A','B','C','D'].map(f =>
                `<button class="lt-btn ${f === currentFilter ? 'active' : ''}" onclick="window.PageABC.setFilter('${f}')">${f === 'todos' ? 'Todos' : f}</button>`
              ).join('')}
            </div>
            <div class="search-wrap" style="margin-bottom:0;width:200px">
              <span class="search-icon">⌕</span>
              <input type="text" id="search-abc" placeholder="Buscar artículo…" style="font-size:12px" value="${searchQuery}" />
            </div>
            <button class="btn btn-green btn-sm" id="btn-export-abc">↓ Excel</button>
          </div>
        </div>
        <div id="abc-table-content"></div>
        <div id="abc-pagination" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:var(--c-text2)"></div>
      </div>
    `;

    document.getElementById('page-abc').innerHTML = html;

    // Events
    const searchEl = document.getElementById('search-abc');
    if (searchEl) searchEl.addEventListener('input', () => {
      searchQuery = searchEl.value;
      currentPage = 1;
      renderTablaABC();
    });

    const btnExport = document.getElementById('btn-export-abc');
    if (btnExport) btnExport.addEventListener('click', exportarABC);

    renderCharts(abc, total_venta);
    renderTablaABC();
  }

  function renderBarLineas(lineas) {
    const F = window.FMT;
    const max = lineas[0]?.venta || 1;
    return lineas.slice(0, 8).map(l => `
      <div class="bar-row">
        <div class="bar-label">${l.linea}</div>
        <div class="bar-track-h"><div class="bar-fill-h" style="width:${Math.round(l.venta/max*100)}%"></div></div>
        <div class="bar-val">${F.compact(l.venta)}</div>
      </div>`).join('');
  }

  function setFilter(f) {
    currentFilter = f;
    currentPage = 1;
    // Update buttons
    document.querySelectorAll('#page-abc .lt-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#page-abc .lt-btn').forEach(btn => {
      if (btn.textContent === (f === 'todos' ? 'Todos' : f)) btn.classList.add('active');
    });
    renderTablaABC();
  }

  function renderTablaABC() {
    const D = window.CEDI_DATA;
    const F = window.FMT;

    let arts = D.articulos;
    if (currentFilter !== 'todos') arts = arts.filter(a => a.abc === currentFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      arts = arts.filter(a => (a.clave || '').toLowerCase().includes(q) || (a.descripcion || '').toLowerCase().includes(q));
    }

    // Sort: A first, then by venta desc
    arts = [...arts].sort((a, b) => {
      const abcOrder = { A: 0, B: 1, C: 2, D: 3 };
      const oa = abcOrder[a.abc] ?? 4, ob = abcOrder[b.abc] ?? 4;
      if (oa !== ob) return oa - ob;
      return (b.venta_total || 0) - (a.venta_total || 0);
    });

    const total = arts.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    currentPage = Math.min(currentPage, pages || 1);
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = arts.slice(start, start + PAGE_SIZE);

    const rows = slice.map(a => {
      const score = Math.round(a.score_compra || 0);
      const diasCls = F.diasColor(a.dias_cobertura || 0);
      return `
        <tr>
          <td class="clave">${a.clave}</td>
          <td class="desc">${a.descripcion || ''}</td>
          <td>${a.linea || ''}</td>
          <td>${F.abcBadge(a.abc)}</td>
          <td class="right">${F.number(a.existencia)}</td>
          <td class="right">${F.currency(a.costo_iva)}</td>
          <td class="right">${F.currency(a.valor_total)}</td>
          <td class="right">${F.currency(a.venta_total)}</td>
          <td class="right">${F.number(a.unidades_total)}</td>
          <td class="right">${(a.rotacion || 0).toFixed(2)}</td>
          <td class="right"><span class="dias-cob ${diasCls}">${Math.round(a.dias_cobertura || 0)}d</span></td>
          <td>
            <div class="score-bar">
              <div class="score-track"><div class="score-fill ${F.scoreColor(score)}" style="width:${score}%"></div></div>
              <span class="score-num">${score}</span>
            </div>
          </td>
        </tr>`;
    }).join('');

    const content = document.getElementById('abc-table-content');
    if (content) {
      content.innerHTML = `
        <div class="tbl-wrap" style="max-height:480px;overflow-y:auto">
          <table class="data-table">
            <thead><tr>
              <th>Clave</th><th>Descripción</th><th>Línea</th><th>ABC</th>
              <th class="right">Stock</th><th class="right">Costo c/IVA</th>
              <th class="right">Valor inv.</th><th class="right">Venta 5m</th>
              <th class="right">Uds</th><th class="right">Rotación</th>
              <th class="right">Cobertura</th><th>Prioridad</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const pgWrap = document.getElementById('abc-pagination');
    if (pgWrap && pages > 1) {
      pgWrap.innerHTML = `
        <span>${F.number(total)} artículos · mostrando ${start+1}–${Math.min(start+PAGE_SIZE,total)}</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="window.PageABC.goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>← Ant</button>
          <span style="padding:6px 10px;font-size:12px">${currentPage}/${pages}</span>
          <button class="btn btn-outline btn-sm" onclick="window.PageABC.goPage(${currentPage+1})" ${currentPage>=pages?'disabled':''}>Sig →</button>
        </div>`;
    } else if (pgWrap) {
      pgWrap.innerHTML = `<span>${F.number(total)} artículos</span>`;
    }
  }

  function renderCharts(abc, totalVenta) {
    destroyCharts();
    const abcActivos = abc.filter(x => x.cat !== 'D');
    const ctx = document.getElementById('chartAbcVenta');
    if (ctx) {
      charts.abcVenta = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: abcActivos.map(x => `Clase ${x.cat} (${(x.venta/totalVenta*100).toFixed(0)}%)`),
          datasets: [{
            data: abcActivos.map(x => x.venta),
            backgroundColor: ['#1D9E75','#378ADD','#EF9F27'],
            borderWidth: 2, borderColor: '#141418'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.label + ': $' + ctx.parsed.toLocaleString('es-MX') } }
          }
        }
      });
    }
  }

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  function goPage(p) {
    currentPage = p;
    renderTablaABC();
  }

  function exportarABC() {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    const rows = D.articulos.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'Clase ABC': a.abc,
      'Stock Actual': a.existencia,
      'Costo Unit. s/IVA': F.round2(a.costo_neto),
      'Costo Unit. c/IVA': F.round2(a.costo_iva),
      'Valor Inventario': F.round2(a.valor_total),
      'Venta período': F.round2(a.venta_total),
      'Unidades período': a.unidades_total,
      'Rotación': F.round2(a.rotacion),
      'Salidas 5m': a.salidas,
      'DPD (dem/día)': F.round2(a.dpd),
      'Cobertura (días)': Math.round(a.dias_cobertura || 0),
      '% Clientes Ancla': F.round2((a.pct_ancla || 0) * 100),
      'Score Prioridad': Math.round(a.score_compra || 0),
      'Núm. Clientes': a.num_clientes
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [10,35,18,8,10,14,14,14,14,12,10,10,12,12,14,12,10].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Análisis ABC');
    XLSX.writeFile(wb, `Analisis_ABC_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return { render, setFilter, goPage, destroyCharts };
})();
