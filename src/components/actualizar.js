/* ============================================================
   actualizar.js — Centro de Actualización de Datos
   Permite cargar nuevos archivos Excel (semanas/meses nuevos)
   y regenerar todo el dataset en el navegador.
   ============================================================ */

window.PageActualizar = (function() {

  const SLOTS = [
    { key: 'ARTICULOS',  label: 'Catálogo de artículos', hint: 'ARTICULOS.xlsx', icon: '◫' },
    { key: 'EXIVAL',     label: 'Existencia y valor',     hint: 'EXIVAL.xlsx',   icon: '⬛' },
    { key: 'ROTINV',     label: 'Rotación de inventario', hint: 'ROTINV.xlsx',   icon: '↻' },
    { key: 'COMPRAS',    label: 'Compras del período',    hint: 'COMPRAS.xlsx',  icon: '↓' },
    { key: 'VECLIEARTS', label: 'Ventas por cliente',     hint: 'VECLIEARTS.xlsx', icon: '◉' },
  ];

  let files = {};        // { KEY: File }
  let resultado = null;  // dataset procesado

  function render() {
    files = {};
    resultado = null;
    const html = `
      <div class="page-header">
        <div class="page-title">Actualizar Datos</div>
        <div class="page-sub">Carga nuevos archivos Excel para actualizar todo el sistema con datos más recientes</div>
      </div>

      <div class="card mb-16" style="border-left:3px solid var(--c-accent)">
        <div class="card-title">Cómo funciona</div>
        <div style="font-size:13px;color:var(--c-text2);line-height:1.7">
          <p>1. Exporta los 5 reportes del sistema en el mismo formato que los archivos originales.</p>
          <p class="mt-4">2. Arrastra o selecciona cada archivo en su casilla. El sistema detecta automáticamente el período (semanas o meses) a partir de las fechas en COMPRAS.</p>
          <p class="mt-4">3. Presiona <strong>Procesar</strong> para validar y previsualizar los nuevos KPIs.</p>
          <p class="mt-4">4. Aplica los cambios para actualizar el dashboard en la sesión actual, o descarga el nuevo <code>cedi_data.js</code> para reemplazar el archivo en el proyecto de forma permanente.</p>
        </div>
      </div>

      <div class="control-group mb-16" style="max-width:280px">
        <div class="control-label">Fecha de corte (opcional)</div>
        <input type="date" id="fecha-corte" value="" style="width:100%" />
        <div style="font-size:11px;color:var(--c-text3);margin-top:4px">Si se deja vacío, usa la última fecha de compra</div>
      </div>

      <div class="export-grid mb-16" id="slots-grid">
        ${SLOTS.map(s => slotHTML(s)).join('')}
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="btn-procesar" disabled>⟁ Procesar archivos</button>
        <button class="btn btn-outline" id="btn-limpiar">Limpiar</button>
      </div>

      <div id="proceso-status"></div>
      <div id="preview-resultado"></div>
    `;

    document.getElementById('page-actualizar').innerHTML = html;
    attachEvents();
  }

  function slotHTML(s) {
    return `
      <div class="export-card slot-card" data-slot="${s.key}" id="slot-${s.key}">
        <div class="export-icon">${s.icon}</div>
        <div class="export-title">${s.label}</div>
        <div class="export-desc" id="slot-status-${s.key}">Esperando archivo · <span class="mono">${s.hint}</span></div>
        <label class="btn btn-outline btn-sm" style="cursor:pointer">
          Seleccionar archivo
          <input type="file" accept=".xlsx,.xls" data-slot="${s.key}" style="display:none" />
        </label>
      </div>`;
  }

  function attachEvents() {
    document.querySelectorAll('input[type=file][data-slot]').forEach(inp => {
      inp.addEventListener('change', e => {
        const key = inp.dataset.slot;
        const f = e.target.files[0];
        if (f) setFile(key, f);
      });
    });

    // Drag & drop
    document.querySelectorAll('.slot-card').forEach(card => {
      const key = card.dataset.slot;
      card.addEventListener('dragover', e => { e.preventDefault(); card.style.borderColor = 'var(--c-accent)'; });
      card.addEventListener('dragleave', e => { card.style.borderColor = ''; });
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.style.borderColor = '';
        const f = e.dataTransfer.files[0];
        if (f) setFile(key, f);
      });
    });

    const btnProc = document.getElementById('btn-procesar');
    if (btnProc) btnProc.addEventListener('click', procesar);
    const btnLimpiar = document.getElementById('btn-limpiar');
    if (btnLimpiar) btnLimpiar.addEventListener('click', render);
  }

  function setFile(key, file) {
    files[key] = file;
    const status = document.getElementById('slot-status-' + key);
    if (status) {
      status.innerHTML = `<span style="color:var(--c-green)">✓ ${file.name}</span> · ${(file.size/1024).toFixed(0)} KB`;
    }
    const card = document.getElementById('slot-' + key);
    if (card) card.style.borderColor = 'var(--c-green)';

    // Habilitar procesar si están los 5
    const allLoaded = SLOTS.every(s => files[s.key]);
    const btn = document.getElementById('btn-procesar');
    if (btn) btn.disabled = !allLoaded;
  }

  async function procesar() {
    const status = document.getElementById('proceso-status');
    const btn = document.getElementById('btn-procesar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando…'; }
    if (status) status.innerHTML = `<div class="card mb-16"><div class="loading-msg">Procesando archivos Excel… esto puede tardar unos segundos.</div></div>`;

    const corteEl = document.getElementById('fecha-corte');
    const corte = corteEl && corteEl.value ? corteEl.value : null;

    try {
      const { dataset, counts } = await window.DataProcessor.processFiles(files, corte);
      resultado = dataset;
      renderPreview(dataset, counts);
      if (status) status.innerHTML = '';
    } catch (e) {
      console.error('Error procesando:', e);
      if (status) status.innerHTML = `<div class="card mb-16" style="border-left:3px solid var(--c-red)"><div class="card-title" style="color:var(--c-red)">Error al procesar</div><div style="font-size:13px;color:var(--c-text2)">${e.message}<br><br>Verifica que los archivos tengan el mismo formato que los originales (mismas columnas y estructura).</div></div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⟁ Procesar archivos'; }
    }
  }

  function renderPreview(d, counts) {
    const F = window.FMT;
    const k = d.kpis;
    const old = window.CEDI_DATA ? window.CEDI_DATA.kpis : null;

    function delta(nuevo, viejo) {
      if (viejo == null) return '';
      const diff = nuevo - viejo;
      if (Math.abs(diff) < 0.01) return '<span style="color:var(--c-text3);font-size:11px">sin cambio</span>';
      const arrow = diff > 0 ? '▲' : '▼';
      const col = diff > 0 ? 'var(--c-green)' : 'var(--c-red)';
      return `<span style="color:${col};font-size:11px">${arrow} ${F.compact(Math.abs(diff))}</span>`;
    }

    const preview = document.getElementById('preview-resultado');
    preview.innerHTML = `
      <div class="result-panel mb-16">
        <div class="rp-label">Dataset procesado correctamente · Período detectado: ${d.meta.periodo}</div>
        <div class="rp-value" style="font-size:24px">${d.meta.dias_periodo} días · ${d.meta.num_meses} meses</div>
        <div class="rp-sub">${d.meta.fecha_inicio} → ${d.meta.fecha_corte}</div>
        <div class="rp-grid">
          <div><div class="rp-item-label">Artículos</div><div class="rp-item-val">${F.number(d.articulos.length)}</div></div>
          <div><div class="rp-item-label">Clientes</div><div class="rp-item-val">${d.clientes.length}</div></div>
          <div><div class="rp-item-label">En riesgo</div><div class="rp-item-val">${d.riesgo.length}</div></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-title">Filas leídas por archivo</div>
        <div class="totals-row">
          <div class="totals-item"><div class="totals-label">Artículos</div><div class="totals-val">${F.number(counts.articulos)}</div></div>
          <div class="totals-item"><div class="totals-label">Inventario</div><div class="totals-val">${F.number(counts.exival)}</div></div>
          <div class="totals-item"><div class="totals-label">Rotación</div><div class="totals-val">${F.number(counts.rotinv)}</div></div>
          <div class="totals-item"><div class="totals-label">Compras</div><div class="totals-val">${F.number(counts.compras)}</div></div>
          <div class="totals-item"><div class="totals-label">Ventas</div><div class="totals-val">${F.number(counts.ventas)}</div></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-title">Comparativa de KPIs (nuevo vs actual)</div>
        <table class="data-table">
          <thead><tr><th>KPI</th><th class="right">Nuevo</th><th class="right">Actual</th><th class="right">Cambio</th></tr></thead>
          <tbody>
            <tr><td>Inventario s/IVA</td><td class="right">${F.compact(k.total_inv)}</td><td class="right">${old?F.compact(old.total_inv):'—'}</td><td class="right">${delta(k.total_inv, old&&old.total_inv)}</td></tr>
            <tr><td>Venta del período</td><td class="right">${F.compact(k.venta_5m)}</td><td class="right">${old?F.compact(old.venta_5m):'—'}</td><td class="right">${delta(k.venta_5m, old&&old.venta_5m)}</td></tr>
            <tr><td>Venta mensual prom.</td><td class="right">${F.compact(k.venta_mensual)}</td><td class="right">${old?F.compact(old.venta_mensual):'—'}</td><td class="right">${delta(k.venta_mensual, old&&old.venta_mensual)}</td></tr>
            <tr><td>Compras del período</td><td class="right">${F.compact(k.compras_5m)}</td><td class="right">${old?F.compact(old.compras_5m):'—'}</td><td class="right">${delta(k.compras_5m, old&&old.compras_5m)}</td></tr>
            <tr><td>Cobertura (días)</td><td class="right">${Math.round(k.cobertura_dias)}</td><td class="right">${old?Math.round(old.cobertura_dias):'—'}</td><td class="right"></td></tr>
            <tr><td>Arts con venta</td><td class="right">${F.number(k.arts_con_venta)}</td><td class="right">${old?F.number(old.arts_con_venta):'—'}</td><td class="right"></td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Aplicar cambios</div>
        <div style="font-size:13px;color:var(--c-text2);line-height:1.6;margin-bottom:14px">
          <strong>Aplicar en sesión:</strong> actualiza el dashboard ahora mismo (temporal, hasta recargar la página).<br>
          <strong>Descargar cedi_data.js:</strong> guarda el archivo para reemplazarlo en <code>src/data/</code> y dejar el cambio permanente en el proyecto.
        </div>
        <div class="btn-row" style="margin-bottom:0">
          <button class="btn btn-green" id="btn-aplicar">✓ Aplicar en sesión</button>
          <button class="btn btn-primary" id="btn-descargar-js">↓ Descargar cedi_data.js</button>
        </div>
      </div>
    `;

    const btnAplicar = document.getElementById('btn-aplicar');
    if (btnAplicar) btnAplicar.addEventListener('click', aplicarSesion);
    const btnDescargar = document.getElementById('btn-descargar-js');
    if (btnDescargar) btnDescargar.addEventListener('click', descargarJS);
  }

  function aplicarSesion() {
    if (!resultado) return;
    window.CEDI_DATA = resultado;
    // Refrescar el período del sidebar
    try {
      const meta = window.CEDI_DATA.meta || {};
      const elP = document.getElementById('sidebar-periodo');
      const elC = document.getElementById('sidebar-corte');
      if (elP) elP.textContent = 'Período: ' + (meta.periodo || '—');
      if (elC) elC.textContent = 'Corte: ' + (meta.fecha_corte || '—');
    } catch (e) {}

    const status = document.getElementById('proceso-status');
    if (status) status.innerHTML = `<div class="card mb-16" style="border-left:3px solid var(--c-green)"><div style="font-size:13px;color:var(--c-green-text)">✓ Datos aplicados a la sesión actual. <a href="#" id="ir-dashboard" style="color:var(--c-green-text);font-weight:600;text-decoration:underline">Ver el Dashboard actualizado →</a> Para hacer los cambios permanentes, descarga el archivo cedi_data.js y reemplázalo en <code>src/data/</code>.</div></div>`;
    const link = document.getElementById('ir-dashboard');
    if (link) link.addEventListener('click', e => {
      e.preventDefault();
      if (window.App && window.App.navigate) window.App.navigate('dashboard');
    });
  }

  function descargarJS() {
    if (!resultado) return;
    const blob = window.DataProcessor.generarArchivoJS(resultado);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cedi_data.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { render };
})();
