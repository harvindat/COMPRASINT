/* ============================================================
   inventario.js — Vista de inventario completo
   ============================================================ */

window.PageInventario = (function() {
  let currentPage = 1;
  const PAGE_SIZE = 80;
  let searchQuery = '';
  let filterLinea = '';
  let filterABC = '';
  let filterStock = 'todos'; // todos | con_stock | sin_stock | sin_venta

  function render() {
    const D = window.CEDI_DATA;
    const F = window.FMT;
    const { kpis, lineas } = D;

    const lineaOptions = lineas.map(l => `<option value="${l.linea}">${l.linea}</option>`).join('');

    const html = `
      <div class="page-header">
        <div class="page-title">Inventario</div>
        <div class="page-sub">Vista completa del inventario al corte ${F.fechaCorte()}</div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-label">Valor total s/IVA</div>
          <div class="kpi-value">${F.compact(kpis.total_inv)}</div>
          <div class="kpi-sub-label">Último costo de compra</div>
        </div>
        <div class="kpi-card accent">
          <div class="kpi-label">Valor total c/IVA</div>
          <div class="kpi-value">${F.compact(kpis.total_inv_iva)}</div>
          <div class="kpi-sub-label">+ 16% IVA</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Con stock disponible</div>
          <div class="kpi-value">${F.number(kpis.arts_con_stock)}</div>
          <div class="kpi-sub-label">artículos con existencia &gt; 0</div>
        </div>
        <div class="kpi-card red">
          <div class="kpi-label">Agotados (stock = 0)</div>
          <div class="kpi-value">${F.number(kpis.arts_sin_stock)}</div>
          <div class="kpi-sub-label">requieren reposición</div>
        </div>
        <div class="kpi-card red">
          <div class="kpi-label">Sin ventas en el período</div>
          <div class="kpi-value">${F.number(kpis.arts_sin_venta)}</div>
          <div class="kpi-sub-label">capital potencialmente inmovilizado</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Líneas de producto</div>
          <div class="kpi-value">${lineas.length}</div>
          <div class="kpi-sub-label">con ventas activas</div>
        </div>
      </div>

      <div class="card">
        <div class="flex justify-between mb-12" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <div class="card-title" style="margin-bottom:0">Catálogo de inventario</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <div class="search-wrap" style="margin-bottom:0;width:220px">
              <span class="search-icon">⌕</span>
              <input type="text" id="search-inv" placeholder="Buscar clave o nombre…" style="font-size:12px" />
            </div>
            <select id="filter-linea" style="width:160px;font-size:12px">
              <option value="">Todas las líneas</option>
              ${lineaOptions}
            </select>
            <select id="filter-abc" style="width:120px;font-size:12px">
              <option value="">Todas ABC</option>
              <option value="A">Clase A</option>
              <option value="B">Clase B</option>
              <option value="C">Clase C</option>
              <option value="D">Sin ventas</option>
            </select>
            <select id="filter-stock" style="width:150px;font-size:12px">
              <option value="todos">Todos</option>
              <option value="con_stock">Con stock</option>
              <option value="sin_stock">Sin stock (0)</option>
              <option value="sin_venta">Sin ventas</option>
              <option value="riesgo">En riesgo (&lt;14d)</option>
            </select>
            <button class="btn btn-green btn-sm" id="btn-export-inv">↓ Excel</button>
          </div>
        </div>
        <div id="inv-table-content"></div>
        <div id="inv-pagination" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:var(--c-text2)"></div>
      </div>
    `;

    document.getElementById('page-inventario').innerHTML = html;

    // Events
    const searchEl = document.getElementById('search-inv');
    if (searchEl) searchEl.addEventListener('input', () => { searchQuery = searchEl.value; currentPage = 1; renderTabla(); });

    const filterLineaEl = document.getElementById('filter-linea');
    if (filterLineaEl) filterLineaEl.addEventListener('change', () => { filterLinea = filterLineaEl.value; currentPage = 1; renderTabla(); });

    const filterAbcEl = document.getElementById('filter-abc');
    if (filterAbcEl) filterAbcEl.addEventListener('change', () => { filterABC = filterAbcEl.value; currentPage = 1; renderTabla(); });

    const filterStockEl = document.getElementById('filter-stock');
    if (filterStockEl) filterStockEl.addEventListener('change', () => { filterStock = filterStockEl.value; currentPage = 1; renderTabla(); });

    const btnExp = document.getElementById('btn-export-inv');
    if (btnExp) btnExp.addEventListener('click', exportarInventario);

    renderTabla();
  }

  function getFiltered() {
    const D = window.CEDI_DATA;
    let arts = D.articulos;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      arts = arts.filter(a => (a.clave || '').toLowerCase().includes(q) || (a.descripcion || '').toLowerCase().includes(q));
    }
    if (filterLinea) arts = arts.filter(a => a.linea === filterLinea);
    if (filterABC) arts = arts.filter(a => a.abc === filterABC);
    if (filterStock === 'con_stock') arts = arts.filter(a => a.existencia > 0);
    if (filterStock === 'sin_stock') arts = arts.filter(a => a.existencia <= 0);
    if (filterStock === 'sin_venta') arts = arts.filter(a => a.venta_total <= 0);
    if (filterStock === 'riesgo') arts = arts.filter(a => a.dpd > 0 && (a.dias_cobertura || 0) < 14);

    return arts;
  }

  function renderTabla() {
    const F = window.FMT;
    const arts = getFiltered();

    const total = arts.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    currentPage = Math.min(currentPage, pages || 1);
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = arts.slice(start, start + PAGE_SIZE);

    // Totals
    const totalInv = arts.reduce((s, a) => s + (a.valor_total || 0), 0);
    const totalUds = arts.reduce((s, a) => s + (a.existencia || 0), 0);

    const rows = slice.map(a => {
      const diasCov = Math.round(a.dias_cobertura || 0);
      const diasCls = F.diasColor(diasCov);
      const stockCls = a.existencia <= 0 ? 'color:var(--c-red)' : a.existencia < 5 ? 'color:var(--c-amber)' : '';
      return `
        <tr>
          <td class="clave">${a.clave}</td>
          <td class="desc" style="max-width:280px">${a.descripcion || ''}</td>
          <td style="font-size:11px;color:var(--c-text2)">${a.linea || ''}</td>
          <td>${F.abcBadge(a.abc)}</td>
          <td class="right" style="${stockCls}">${F.number(a.existencia)}</td>
          <td class="right">${F.currency(a.costo_neto)}</td>
          <td class="right">${F.currency(a.costo_iva)}</td>
          <td class="right">${F.currency(a.valor_total)}</td>
          <td class="right">${F.currency(a.venta_total)}</td>
          <td class="right">${(a.rotacion || 0).toFixed(2)}</td>
          <td class="right">${a.dpd > 0 ? `<span class="dias-cob ${diasCls}">${diasCov}d</span>` : '<span style="color:var(--c-text3)">—</span>'}</td>
        </tr>`;
    }).join('');

    const content = document.getElementById('inv-table-content');
    if (content) {
      content.innerHTML = `
        <div class="totals-row">
          <div class="totals-item"><div class="totals-label">Artículos filtrados</div><div class="totals-val accent">${F.number(total)}</div></div>
          <div class="totals-item"><div class="totals-label">Unidades totales</div><div class="totals-val">${F.number(totalUds)}</div></div>
          <div class="totals-item"><div class="totals-label">Valor inventario</div><div class="totals-val green">${F.compact(totalInv)}</div></div>
        </div>
        <div class="tbl-wrap" style="max-height:500px;overflow-y:auto;margin-top:10px">
          <table class="data-table">
            <thead><tr>
              <th>Clave</th><th>Descripción</th><th>Línea</th><th>ABC</th>
              <th class="right">Stock</th><th class="right">Costo s/IVA</th>
              <th class="right">Costo c/IVA</th><th class="right">Valor inv.</th>
              <th class="right">Venta 5m</th><th class="right">Rotación</th>
              <th class="right">Cobertura</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const pgWrap = document.getElementById('inv-pagination');
    if (pgWrap) {
      if (pages > 1) {
        pgWrap.innerHTML = `
          <span>${F.number(total)} registros · mostrando ${start+1}–${Math.min(start+PAGE_SIZE,total)}</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="window.PageInventario.goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>← Ant</button>
            <span style="padding:6px 10px;font-size:12px">${currentPage}/${pages}</span>
            <button class="btn btn-outline btn-sm" onclick="window.PageInventario.goPage(${currentPage+1})" ${currentPage>=pages?'disabled':''}>Sig →</button>
          </div>`;
      } else {
        pgWrap.innerHTML = `<span>${F.number(total)} registros</span>`;
      }
    }
  }

  function goPage(p) {
    currentPage = p;
    renderTabla();
  }

  function exportarInventario() {
    const F = window.FMT;
    const arts = getFiltered();

    const rows = arts.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'Clase ABC': a.abc,
      'Existencia': a.existencia,
      'Costo Unit. s/IVA': F.round2(a.costo_neto),
      'Costo Unit. c/IVA': F.round2(a.costo_iva),
      'Valor Inventario s/IVA': F.round2(a.valor_total),
      'Valor Inventario c/IVA': F.round2(a.valor_total * 1.16),
      'Venta período': F.round2(a.venta_total),
      'Unidades vendidas': a.unidades_total,
      'Rotación': F.round2(a.rotacion),
      'Salidas 5m': a.salidas,
      'DPD': F.round2(a.dpd),
      'Días Cobertura': Math.round(a.dias_cobertura || 0),
      'Score Prioridad': Math.round(a.score_compra || 0)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [10,35,18,8,10,16,16,18,18,14,14,10,10,10,12,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    XLSX.writeFile(wb, `Inventario_CEDI_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return { render, goPage };
})();
