/* ============================================================
   compra.js — Módulo de Compra Inteligente con Simulador
   ============================================================ */

window.PageCompra = (function() {
  let currentResult = null;
  let currentPage = 1;
  const PAGE_SIZE = 50;
  let sortField = 'score';
  let sortDir = -1;

  const defaults = {
    presupuesto: 200000,
    leadTime: 5,
    diasCoberturaMeta: 30,
    factorSS: 1.0,
    filtroABC: ['A', 'B'],
    soloConDemanda: true
  };

  let params = { ...defaults };

  function render() {
    const html = `
      <div class="page-header">
        <div class="page-title">Compra Inteligente</div>
        <div class="page-sub">Simulador de pedido óptimo con restricción de presupuesto</div>
      </div>

      <div class="section-row cols-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-title">Variables del pedido</div>
          <div class="control-grid">
            <div class="control-group">
              <div class="control-label">Presupuesto semanal</div>
              <div class="control-value" id="val-presupuesto">$200,000</div>
              <div class="slider-wrap">
                <span class="slider-min">$50K</span>
                <input type="range" id="sl-presupuesto" min="50000" max="1000000" step="10000" value="200000" />
                <span class="slider-max">$1M</span>
              </div>
            </div>
            <div class="control-group">
              <div class="control-label">Días de cobertura objetivo</div>
              <div class="control-value" id="val-cobertura">30 días</div>
              <div class="slider-wrap">
                <span class="slider-min">7d</span>
                <input type="range" id="sl-cobertura" min="7" max="60" step="1" value="30" />
                <span class="slider-max">60d</span>
              </div>
            </div>
            <div class="control-group">
              <div class="control-label">Factor stock de seguridad</div>
              <div class="control-value" id="val-ss">1.0×</div>
              <div class="slider-wrap">
                <span class="slider-min">0.5×</span>
                <input type="range" id="sl-ss" min="0.5" max="2.0" step="0.1" value="1.0" />
                <span class="slider-max">2.0×</span>
              </div>
            </div>
            <div class="control-group">
              <div class="control-label">Lead time del proveedor</div>
              <div class="lt-buttons" id="lt-buttons">
                <button class="lt-btn" data-lt="3">3 días</button>
                <button class="lt-btn active" data-lt="5">5 días</button>
                <button class="lt-btn" data-lt="9">9 días</button>
                <button class="lt-btn" data-lt="15">15 días</button>
              </div>
              <div style="font-size:11px;color:var(--c-text3);margin-top:6px" id="lt-factor-label">Factor multiplicador: ×1.00 (base)</div>
            </div>
          </div>

          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
            <div class="control-group" style="flex:1;min-width:160px">
              <div class="control-label">Filtro ABC</div>
              <div style="display:flex;gap:6px;margin-top:4px">
                <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="abc-A" checked> <span class="badge badge-A">A</span></label>
                <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="abc-B" checked> <span class="badge badge-B">B</span></label>
                <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="abc-C"> <span class="badge badge-C">C</span></label>
                <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="abc-D"> <span class="badge badge-D">D</span></label>
              </div>
            </div>
            <div class="control-group" style="flex:1;min-width:160px">
              <div class="control-label">Opciones</div>
              <label style="font-size:12px;display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer">
                <input type="checkbox" id="opt-demanda" checked> Solo artículos con demanda activa
              </label>
            </div>
          </div>

          <div class="btn-row mt-12">
            <button class="btn btn-primary" id="btn-calcular">⟁ Calcular pedido</button>
            <button class="btn btn-outline" id="btn-reset">Resetear</button>
          </div>
        </div>

        <div id="result-panel-wrap">
          <div class="result-panel" id="result-panel-main">
            <div class="rp-label">Estado</div>
            <div class="rp-value" style="font-size:18px;color:rgba(255,255,255,0.4)">Configura las variables y presiona "Calcular pedido"</div>
          </div>
        </div>
      </div>

      <div class="card" id="resultado-tabla" style="display:none">
        <div class="flex justify-between mb-12" style="flex-wrap:wrap;gap:8px">
          <div class="card-title" style="margin-bottom:0">Detalle del pedido</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <div class="search-wrap" style="margin-bottom:0;width:220px">
              <span class="search-icon">⌕</span>
              <input type="text" id="search-pedido" placeholder="Buscar clave o descripción…" style="font-size:12px" />
            </div>
            <select id="sort-pedido" style="width:160px;font-size:12px">
              <option value="score">Ordenar: Prioridad</option>
              <option value="costoFinal">Ordenar: Costo total</option>
              <option value="cantFinal">Ordenar: Cantidad</option>
              <option value="abc">Ordenar: ABC</option>
              <option value="diasCobertura">Ordenar: Cobertura actual</option>
            </select>
            <button class="btn btn-green btn-sm" id="btn-export-pedido">↓ Excel</button>
          </div>
        </div>
        <div id="tabla-pedido-content"></div>
        <div id="pagination-wrap" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:var(--c-text2)"></div>
      </div>
    `;

    document.getElementById('page-compra').innerHTML = html;
    attachEvents();
  }

  function attachEvents() {
    // Sliders
    const sliders = [
      { id: 'sl-presupuesto', display: 'val-presupuesto', fmt: v => '$' + parseInt(v).toLocaleString('es-MX'), key: 'presupuesto' },
      { id: 'sl-cobertura', display: 'val-cobertura', fmt: v => v + ' días', key: 'diasCoberturaMeta' },
      { id: 'sl-ss', display: 'val-ss', fmt: v => parseFloat(v).toFixed(1) + '×', key: 'factorSS' }
    ];
    sliders.forEach(({ id, display, fmt, key }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        document.getElementById(display).textContent = fmt(el.value);
        params[key] = parseFloat(el.value);
      });
    });

    // Lead time buttons
    document.querySelectorAll('.lt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        params.leadTime = parseInt(btn.dataset.lt);
        const factor = window.CALC.factorLeadTime(params.leadTime);
        const label = document.getElementById('lt-factor-label');
        if (label) {
          const desc = factor < 1 ? '(reducción de stock)' : factor === 1 ? '(base)' : '(incremento de stock)';
          label.textContent = `Factor multiplicador: ×${factor.toFixed(2)} ${desc}`;
        }
      });
    });

    // ABC checkboxes
    ['A','B','C','D'].forEach(cat => {
      const el = document.getElementById('abc-' + cat);
      if (el) el.addEventListener('change', updateFiltroABC);
    });

    // Options
    const optDemanda = document.getElementById('opt-demanda');
    if (optDemanda) optDemanda.addEventListener('change', () => { params.soloConDemanda = optDemanda.checked; });

    // Buttons
    const btnCalc = document.getElementById('btn-calcular');
    if (btnCalc) btnCalc.addEventListener('click', calcular);

    const btnReset = document.getElementById('btn-reset');
    if (btnReset) btnReset.addEventListener('click', resetParams);

    const btnExport = document.getElementById('btn-export-pedido');
    if (btnExport) btnExport.addEventListener('click', exportarPedido);

    const searchEl = document.getElementById('search-pedido');
    if (searchEl) searchEl.addEventListener('input', () => { currentPage = 1; renderTablaPedido(); });

    const sortEl = document.getElementById('sort-pedido');
    if (sortEl) sortEl.addEventListener('change', () => {
      sortField = sortEl.value;
      sortDir = -1;
      currentPage = 1;
      renderTablaPedido();
    });
  }

  function updateFiltroABC() {
    params.filtroABC = ['A','B','C','D'].filter(cat => {
      const el = document.getElementById('abc-' + cat);
      return el && el.checked;
    });
  }

  function calcular() {
    const D = window.CEDI_DATA;
    const C = window.CALC;
    const F = window.FMT;

    updateFiltroABC();

    const btn = document.getElementById('btn-calcular');
    if (btn) { btn.textContent = '⏳ Calculando…'; btn.disabled = true; }

    setTimeout(() => {
      try {
        const result = C.optimizarPedido(D.articulos, params);
        currentResult = result;
        currentPage = 1;
        renderResultPanel(result);
        document.getElementById('resultado-tabla').style.display = 'block';
        renderTablaPedido();
      } catch(e) {
        console.error('Error calculando pedido:', e);
      } finally {
        if (btn) { btn.textContent = '⟁ Calcular pedido'; btn.disabled = false; }
      }
    }, 50);
  }

  function renderResultPanel(result) {
    const F = window.FMT;
    const panel = document.getElementById('result-panel-wrap');
    if (!panel) return;

    const flt = window.CALC.factorLeadTime(params.leadTime);
    const pctUsado = result.pctUsado.toFixed(1);

    const abcRows = ['A','B','C','D'].map(cat => {
      const d = result.byABC[cat];
      if (!d || d.arts === 0) return '';
      return `<span class="badge badge-${cat}" style="margin-right:4px">${cat}: ${d.arts} arts · ${F.compact(d.costo)}</span>`;
    }).join('');

    panel.innerHTML = `
      <div class="result-panel">
        <div class="rp-label">Pedido óptimo calculado · Lead time ${params.leadTime} días · Factor ×${flt.toFixed(2)}</div>
        <div class="rp-value">${F.compact(result.totalCosto)}</div>
        <div class="rp-sub">${pctUsado}% del presupuesto utilizado · ${F.compact(result.presupuestoRestante)} disponible</div>
        <div class="rp-grid">
          <div><div class="rp-item-label">Artículos a pedir</div><div class="rp-item-val">${F.number(result.totalArts)}</div></div>
          <div><div class="rp-item-label">Unidades totales</div><div class="rp-item-val">${F.number(result.totalUnidades)}</div></div>
          <div><div class="rp-item-label">Cobertura objetivo</div><div class="rp-item-val">${params.diasCoberturaMeta} días</div></div>
        </div>
        <div style="margin-top:14px;display:flex;gap:6px;flex-wrap:wrap">${abcRows}</div>
      </div>`;
  }

  function renderTablaPedido() {
    if (!currentResult) return;
    const F = window.FMT;
    const searchEl = document.getElementById('search-pedido');
    const query = searchEl ? searchEl.value.toLowerCase() : '';

    let pedido = currentResult.pedido;
    if (query) {
      pedido = pedido.filter(a =>
        (a.clave || '').toLowerCase().includes(query) ||
        (a.descripcion || '').toLowerCase().includes(query)
      );
    }

    // Sort
    pedido = [...pedido].sort((a, b) => {
      let va = a[sortField] || 0, vb = b[sortField] || 0;
      if (typeof va === 'string') va = va.charCodeAt(0);
      if (typeof vb === 'string') vb = vb.charCodeAt(0);
      return (va - vb) * sortDir;
    });

    const total = pedido.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    currentPage = Math.min(currentPage, pages || 1);
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = pedido.slice(start, start + PAGE_SIZE);

    // Totals
    const totalUds = pedido.reduce((s, a) => s + a.cantFinal, 0);
    const totalCosto = pedido.reduce((s, a) => s + a.costoFinal, 0);

    const rows = slice.map(a => {
      const diasCls = F.diasColor(a.diasCobertura);
      const score = Math.round(a.score || 0);
      const anclaTag = a.pctAncla > 0.3 ? ' <span class="badge badge-ancla" style="font-size:9px">ancla</span>' : '';
      return `
        <tr>
          <td class="clave">${a.clave}</td>
          <td class="desc">${a.descripcion}${anclaTag}</td>
          <td>${F.abcBadge(a.abc)}</td>
          <td class="right mono">${F.number(a.existencia)}</td>
          <td class="right"><span class="dias-cob ${diasCls}">${Math.round(a.diasCobertura)}d</span></td>
          <td class="right" style="font-weight:600;color:var(--c-accent)">${F.number(a.cantFinal)}</td>
          <td class="right">${F.currency(a.costoUnit)}</td>
          <td class="right" style="font-weight:500">${F.currency(a.costoFinal)}</td>
          <td>
            <div class="score-bar">
              <div class="score-track"><div class="score-fill ${F.scoreColor(score)}" style="width:${score}%"></div></div>
              <span class="score-num">${score}</span>
            </div>
          </td>
        </tr>`;
    }).join('');

    const content = document.getElementById('tabla-pedido-content');
    if (content) {
      content.innerHTML = `
        <div class="totals-row">
          <div class="totals-item"><div class="totals-label">Artículos en pedido</div><div class="totals-val accent">${F.number(total)}</div></div>
          <div class="totals-item"><div class="totals-label">Unidades totales</div><div class="totals-val">${F.number(totalUds)}</div></div>
          <div class="totals-item"><div class="totals-label">Costo total c/IVA</div><div class="totals-val green">${F.currency(totalCosto)}</div></div>
          <div class="totals-item"><div class="totals-label">Presupuesto restante</div><div class="totals-val">${F.currency(currentResult.presupuestoRestante)}</div></div>
        </div>
        <div class="tbl-wrap" style="max-height:420px;overflow-y:auto;margin-top:10px">
          <table class="data-table">
            <thead><tr>
              <th>Clave</th><th>Descripción</th><th>ABC</th>
              <th class="right">Stock</th><th class="right">Cob. actual</th>
              <th class="right">Cant. pedir</th><th class="right">Costo unit.</th>
              <th class="right">Costo total</th><th>Prioridad</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    // Pagination
    const pgWrap = document.getElementById('pagination-wrap');
    if (pgWrap && pages > 1) {
      pgWrap.innerHTML = `
        <span>Mostrando ${start+1}–${Math.min(start+PAGE_SIZE,total)} de ${total}</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="window.PageCompra.goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>← Anterior</button>
          <span style="padding:6px 10px;font-size:12px">Página ${currentPage} / ${pages}</span>
          <button class="btn btn-outline btn-sm" onclick="window.PageCompra.goPage(${currentPage+1})" ${currentPage>=pages?'disabled':''}>Siguiente →</button>
        </div>`;
    } else if (pgWrap) {
      pgWrap.innerHTML = '';
    }
  }

  function goPage(p) {
    currentPage = p;
    renderTablaPedido();
  }

  function resetParams() {
    params = { ...defaults };
    render();
  }

  function exportarPedido() {
    if (!currentResult || !currentResult.pedido.length) {
      alert('Primero calcula un pedido para exportar.');
      return;
    }
    const F = window.FMT;
    const rows = currentResult.pedido.map(a => ({
      'Clave': a.clave,
      'Descripción': a.descripcion,
      'Línea': a.linea,
      'ABC': a.abc,
      'Stock Actual': a.existencia,
      'Días Cobertura Actual': Math.round(a.diasCobertura),
      'Stock Seguridad': a.ss,
      'Pto. Reorden': a.rop,
      'Cantidad a Pedir': a.cantFinal,
      'Costo Unit. s/IVA': F.round2(a.costoUnit / 1.16),
      'Costo Unit. c/IVA': F.round2(a.costoUnit),
      'Costo Total c/IVA': F.round2(a.costoFinal),
      'Score Prioridad': Math.round(a.score),
      '% Clientes Ancla': F.round2(a.pctAncla * 100)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [8,30,18,5,10,14,12,12,14,16,16,16,12,14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido');

    // Summary sheet
    const summary = [
      { 'Parámetro': 'Presupuesto', 'Valor': '$' + params.presupuesto.toLocaleString('es-MX') },
      { 'Parámetro': 'Lead Time (días)', 'Valor': params.leadTime },
      { 'Parámetro': 'Factor Lead Time', 'Valor': window.CALC.factorLeadTime(params.leadTime) },
      { 'Parámetro': 'Días Cobertura Objetivo', 'Valor': params.diasCoberturaMeta },
      { 'Parámetro': 'Factor Stock Seguridad', 'Valor': params.factorSS },
      { 'Parámetro': 'Filtro ABC', 'Valor': params.filtroABC.join(',') },
      { 'Parámetro': '---', 'Valor': '---' },
      { 'Parámetro': 'Total Artículos Pedido', 'Valor': currentResult.totalArts },
      { 'Parámetro': 'Total Unidades', 'Valor': currentResult.totalUnidades },
      { 'Parámetro': 'Costo Total c/IVA', 'Valor': F.round2(currentResult.totalCosto) },
      { 'Parámetro': 'Presupuesto Restante', 'Valor': F.round2(currentResult.presupuestoRestante) },
      { 'Parámetro': '% Presupuesto Usado', 'Valor': F.round2(currentResult.pctUsado) },
      { 'Parámetro': 'Fecha Generación', 'Valor': new Date().toLocaleDateString('es-MX') },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Parámetros');

    XLSX.writeFile(wb, `Pedido_CEDI_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return { render, goPage };
})();
