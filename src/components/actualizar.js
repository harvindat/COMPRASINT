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
    { key: 'VAZLO',      label: 'Existencia proveedor (Vazlo)', hint: 'EXISTENCIAVAZLO.xlsx', icon: '⛁', optional: true },
  ];

  let files = {};          // { KEY: File }
  let resultado = null;    // dataset procesado
  let modoSoloVazlo = false; // true cuando solo se actualiza la existencia del proveedor

  function render() {
    files = {};
    resultado = null;
    modoSoloVazlo = false;
    const html = `
      <div class="page-header">
        <div class="page-title">Actualizar Datos</div>
        <div class="page-sub">Carga nuevos archivos Excel para actualizar todo el sistema con datos más recientes</div>
      </div>

      <div class="card mb-16" style="border-left:3px solid var(--c-accent)">
        <div class="card-title">Cómo funciona</div>
        <div style="font-size:13px;color:var(--c-text2);line-height:1.7">
          <p>1. Exporta los 5 reportes del sistema en el mismo formato que los archivos originales. Opcionalmente agrega el archivo de <strong>existencia del proveedor (Vazlo)</strong> para habilitar la validación de surtido en Compra Inteligente.</p>
          <p class="mt-4" style="color:var(--c-text);"><strong>Actualización rápida:</strong> si SOLO quieres actualizar la existencia del proveedor, carga únicamente <code>EXISTENCIAVAZLO.xlsx</code> — no necesitas los otros 5 archivos. Se cruza contra el catálogo vigente y podrás guardarlo en GitHub igual que siempre.</p>
          <p class="mt-4">2. Arrastra o selecciona cada archivo en su casilla. El sistema detecta automáticamente el período (semanas o meses) a partir de las fechas en COMPRAS. Si ya habías cargado existencia Vazlo antes y no subes una nueva, el dato anterior se conserva.</p>
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
    const optTag = s.optional ? ' <span style="font-size:10px;color:var(--c-text3);border:1px solid var(--c-border);border-radius:4px;padding:1px 5px;vertical-align:middle">OPCIONAL</span>' : '';
    const prevVazlo = s.key === 'VAZLO' && window.CEDI_DATA && window.CEDI_DATA.meta && window.CEDI_DATA.meta.vazlo && window.CEDI_DATA.meta.vazlo.cargado;
    const soloTag = s.key === 'VAZLO'
      ? '<br><span style="color:var(--c-accent);font-size:11px">Se puede cargar solo, sin los otros 5 archivos</span>'
      : '';
    const baseStatus = (prevVazlo
      ? `Dato vigente del ${window.CEDI_DATA.meta.vazlo.fecha_carga} · si no cargas uno nuevo, se conserva`
      : `Esperando archivo · <span class="mono">${s.hint}</span>`) + soloTag;
    return `
      <div class="export-card slot-card" data-slot="${s.key}" id="slot-${s.key}" ${s.optional ? 'style="border-style:dashed"' : ''}>
        <div class="export-icon">${s.icon}</div>
        <div class="export-title">${s.label}${optTag}</div>
        <div class="export-desc" id="slot-status-${s.key}">${baseStatus}</div>
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

    actualizarBotonProcesar();
  }

  /* Habilita "Procesar" en dos escenarios:
       a) Los 5 archivos obligatorios están cargados (flujo completo).
       b) SOLO está el archivo Vazlo y hay dataset base en sesión →
          modo de actualización aislada de existencia del proveedor. */
  function actualizarBotonProcesar() {
    const oblig = SLOTS.filter(s => !s.optional);
    const numOblig = oblig.filter(s => files[s.key]).length;
    const allLoaded = numOblig === oblig.length;
    const soloVazlo = !!files.VAZLO && numOblig === 0 &&
                      window.CEDI_DATA && Array.isArray(window.CEDI_DATA.articulos) && window.CEDI_DATA.articulos.length > 0;
    modoSoloVazlo = soloVazlo && !allLoaded;

    const btn = document.getElementById('btn-procesar');
    if (btn) {
      btn.disabled = !(allLoaded || soloVazlo);
      btn.textContent = labelProcesar();
    }
    // Hint contextual bajo los botones
    const status = document.getElementById('proceso-status');
    if (status && !resultado) {
      if (modoSoloVazlo) {
        status.innerHTML = `<div class="card mb-16" style="border-left:3px solid var(--c-accent)"><div style="font-size:12px;color:var(--c-text2)">⛁ <strong>Modo actualización rápida:</strong> se procesará SOLO la existencia del proveedor y se cruzará contra el catálogo vigente en sesión. Los demás datos (ventas, compras, inventario) no cambian.</div></div>`;
      } else if (!allLoaded && files.VAZLO && numOblig > 0) {
        status.innerHTML = `<div class="card mb-16" style="border-left:3px solid #d9a441"><div style="font-size:12px;color:var(--c-text2)">Para procesar necesitas <strong>los 5 archivos obligatorios completos</strong>, o bien <strong>únicamente</strong> el de existencia Vazlo (quita los demás para usar la actualización rápida).</div></div>`;
      } else {
        status.innerHTML = '';
      }
    }
  }

  function labelProcesar() {
    return modoSoloVazlo ? '⛁ Procesar solo existencia Vazlo' : '⟁ Procesar archivos';
  }

  async function procesar() {
    const status = document.getElementById('proceso-status');
    const btn = document.getElementById('btn-procesar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando…'; }
    if (status) status.innerHTML = `<div class="card mb-16"><div class="loading-msg">Procesando archivos Excel… esto puede tardar unos segundos.</div></div>`;

    try {
      if (modoSoloVazlo) {
        await procesarSoloVazlo();
      } else {
        const corteEl = document.getElementById('fecha-corte');
        const corte = corteEl && corteEl.value ? corteEl.value : null;
        const { dataset, counts } = await window.DataProcessor.processFiles(files, corte);
        resultado = dataset;
        renderPreview(dataset, counts);
      }
      if (status) status.innerHTML = '';
    } catch (e) {
      console.error('Error procesando:', e);
      if (status) status.innerHTML = `<div class="card mb-16" style="border-left:3px solid var(--c-red)"><div class="card-title" style="color:var(--c-red)">Error al procesar</div><div style="font-size:13px;color:var(--c-text2)">${e.message}<br><br>Verifica que los archivos tengan el mismo formato que los originales (mismas columnas y estructura).</div></div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = labelProcesar(); }
    }
  }

  /* ─── Flujo aislado: SOLO existencia del proveedor ──────
     Cruza el archivo Vazlo contra el dataset vigente en sesión
     (sin reprocesar los 5 reportes internos) y deja el resultado
     listo para Aplicar / Guardar en GitHub / Descargar. */
  async function procesarSoloVazlo() {
    const f = files.VAZLO;
    if (!f) throw new Error('No hay archivo de existencia Vazlo seleccionado.');
    const parsedV = await window.DataProcessor.parseVazloFile(f);
    if (!parsedV.filas) {
      throw new Error('No se detectaron claves con existencia en el archivo del proveedor. Verifica que tenga columnas de clave y existencia.');
    }
    const res = window.DataProcessor.datasetConVazlo(parsedV.map, f.name);
    if (!res) throw new Error('No hay dataset base cargado en la sesión. Recarga la página o procesa primero los 5 archivos.');
    resultado = res.dataset;
    renderPreviewSoloVazlo(res.dataset, f.name);
  }

  function renderPreviewSoloVazlo(d, nombreArchivo) {
    const F = window.FMT;
    const v = d.meta.vazlo;
    const preview = document.getElementById('preview-resultado');
    preview.innerHTML = `
      <div class="result-panel mb-16">
        <div class="rp-label">Existencia Vazlo procesada · ${nombreArchivo}</div>
        <div class="rp-value" style="font-size:24px">${F.number(v.matched)} claves cruzadas</div>
        <div class="rp-sub">Dataset base sin cambios · Período vigente: ${d.meta.periodo || '—'} · Corte: ${d.meta.fecha_corte || '—'}</div>
        <div class="rp-grid">
          <div><div class="rp-item-label">Claves en archivo</div><div class="rp-item-val">${F.number(v.claves_archivo)}</div></div>
          <div><div class="rp-item-label">Con stock proveedor</div><div class="rp-item-val" style="color:var(--c-green)">${F.number(v.con_stock)}</div></div>
          <div><div class="rp-item-label">Sin cruce (no en catálogo)</div><div class="rp-item-val">${F.number(v.sin_match)}</div></div>
        </div>
      </div>

      <div class="card mb-16" style="border-left:3px solid var(--c-accent)">
        <div class="card-title">Solo se actualiza la existencia del proveedor</div>
        <div style="font-size:13px;color:var(--c-text2);line-height:1.7">
          Ventas, compras, inventario y KPIs <strong>no cambian</strong> — se conserva el dataset vigente y únicamente se
          reemplaza la existencia Vazlo. Al guardar en GitHub, el dato viaja dentro de <code>cedi_data.js</code> y
          la próxima vez que abras el sistema, <strong>Compra Inteligente</strong> tendrá el selector de modos Vazlo
          habilitado automáticamente para recalcular el pedido.
        </div>
      </div>

      <div class="card">
        <div class="card-title">Aplicar cambios</div>
        <div style="font-size:13px;color:var(--c-text2);line-height:1.6;margin-bottom:14px">
          <strong>Aplicar en sesión:</strong> actualiza la existencia Vazlo ahora mismo (temporal, hasta recargar la página).<br>
          <strong>Guardar en GitHub:</strong> hace commit del <code>cedi_data.js</code> con la nueva existencia Vazlo. Te pedirá tu token de GitHub (no se guarda en ningún lado).<br>
          <strong>Descargar cedi_data.js:</strong> guarda el archivo para reemplazarlo manualmente en <code>src/data/</code>.
        </div>
        <div class="btn-row" style="margin-bottom:0">
          <button class="btn btn-green" id="btn-aplicar">✓ Aplicar en sesión</button>
          <button class="btn btn-primary" id="btn-guardar-github">⬆ Guardar en GitHub</button>
          <button class="btn btn-outline" id="btn-descargar-js">↓ Descargar cedi_data.js</button>
        </div>
      </div>
    `;

    const btnAplicar = document.getElementById('btn-aplicar');
    if (btnAplicar) btnAplicar.addEventListener('click', aplicarSesion);
    const btnGithub = document.getElementById('btn-guardar-github');
    if (btnGithub) btnGithub.addEventListener('click', abrirModalGitHub);
    const btnDescargar = document.getElementById('btn-descargar-js');
    if (btnDescargar) btnDescargar.addEventListener('click', descargarJS);
  }

  function vazloPanelHTML(d) {
    const v = d.meta && d.meta.vazlo;
    if (!v || !v.cargado) {
      return `<div class="card mb-16" style="border-left:3px solid var(--c-border)">
        <div class="card-title">Existencia Vazlo</div>
        <div style="font-size:13px;color:var(--c-text2)">No se cargó archivo del proveedor. La Compra Inteligente funcionará sin la columna "Existencia Vazlo". Puedes cargarlo aquí después o directamente en el módulo de Compra Inteligente.</div>
      </div>`;
    }
    const F = window.FMT;
    const carry = v.carry_over ? ` <span style="color:var(--c-yellow, #d9a441);font-size:11px">(conservado de la carga del ${v.fecha_carga} — considera actualizarlo)</span>` : '';
    return `<div class="card mb-16" style="border-left:3px solid var(--c-accent)">
      <div class="card-title">Existencia Vazlo · cruce con catálogo${carry}</div>
      <div class="totals-row">
        <div class="totals-item"><div class="totals-label">Claves en archivo</div><div class="totals-val">${F.number(v.claves_archivo || 0)}</div></div>
        <div class="totals-item"><div class="totals-label">Cruzadas con catálogo</div><div class="totals-val accent">${F.number(v.matched || 0)}</div></div>
        <div class="totals-item"><div class="totals-label">Con stock proveedor</div><div class="totals-val green">${F.number(v.con_stock || 0)}</div></div>
        <div class="totals-item"><div class="totals-label">Sin cruce (no en catálogo)</div><div class="totals-val">${F.number(v.sin_match || 0)}</div></div>
      </div>
      <div style="font-size:12px;color:var(--c-text3);margin-top:8px">Al aplicar o guardar en GitHub, la existencia del proveedor viaja dentro de <code>cedi_data.js</code> y queda disponible para la Compra Inteligente.</div>
    </div>`;
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
          ${counts.vazlo != null ? `<div class="totals-item"><div class="totals-label">Exist. Vazlo</div><div class="totals-val" style="color:var(--c-accent)">${F.number(counts.vazlo)}</div></div>` : ''}
        </div>
      </div>

      ${vazloPanelHTML(d)}

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
          <strong>Guardar en GitHub:</strong> hace commit del nuevo <code>cedi_data.js</code> directo al repositorio. Te pedirá tu token de GitHub (no se guarda en ningún lado).<br>
          <strong>Descargar cedi_data.js:</strong> guarda el archivo para reemplazarlo manualmente en <code>src/data/</code>.
        </div>
        <div class="btn-row" style="margin-bottom:0">
          <button class="btn btn-green" id="btn-aplicar">✓ Aplicar en sesión</button>
          <button class="btn btn-primary" id="btn-guardar-github">⬆ Guardar en GitHub</button>
          <button class="btn btn-outline" id="btn-descargar-js">↓ Descargar cedi_data.js</button>
        </div>
      </div>
    `;

    const btnAplicar = document.getElementById('btn-aplicar');
    if (btnAplicar) btnAplicar.addEventListener('click', aplicarSesion);
    const btnGithub = document.getElementById('btn-guardar-github');
    if (btnGithub) btnGithub.addEventListener('click', abrirModalGitHub);
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
    if (status) {
      status.innerHTML = modoSoloVazlo
        ? `<div class="card mb-16" style="border-left:3px solid var(--c-green)"><div style="font-size:13px;color:var(--c-green-text)">✓ Existencia Vazlo aplicada a la sesión actual. <a href="#" id="ir-destino" style="color:var(--c-green-text);font-weight:600;text-decoration:underline">Ir a Compra Inteligente para recalcular →</a> Para hacerla permanente usa <strong>Guardar en GitHub</strong>.</div></div>`
        : `<div class="card mb-16" style="border-left:3px solid var(--c-green)"><div style="font-size:13px;color:var(--c-green-text)">✓ Datos aplicados a la sesión actual. <a href="#" id="ir-destino" style="color:var(--c-green-text);font-weight:600;text-decoration:underline">Ver el Dashboard actualizado →</a> Para hacer los cambios permanentes, descarga el archivo cedi_data.js y reemplázalo en <code>src/data/</code>.</div></div>`;
    }
    const link = document.getElementById('ir-destino');
    if (link) link.addEventListener('click', e => {
      e.preventDefault();
      if (window.App && window.App.navigate) window.App.navigate(modoSoloVazlo ? 'compra' : 'dashboard');
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

  /* ─── Guardar en GitHub (token de un solo uso, nunca se almacena) ─── */
  function abrirModalGitHub() {
    if (!resultado) return;
    const cfg = window.GitHubSync.getConfig();

    let modal = document.getElementById('gh-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.className = 'auth-overlay open';
    modal.id = 'gh-modal';
    modal.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-label="Guardar en GitHub" style="max-width:420px">
        <button class="auth-close" id="gh-close" aria-label="Cerrar">×</button>
        <div class="auth-title">⬆ Guardar en GitHub</div>
        <div class="auth-sub">${cfg.owner}/${cfg.repo} · ${cfg.branch} · ${cfg.path}</div>
        <div class="auth-error" id="gh-error"></div>
        <div id="gh-success" style="display:none"></div>
        <div id="gh-form-wrap">
          <div style="font-size:12px;color:var(--c-text2);line-height:1.6;margin-bottom:14px">
            Pega tu <strong>Personal Access Token</strong> de GitHub. Se usa solo para este commit y
            <strong>no se guarda</strong> en ningún lado. Usa un token <em>fine-grained</em> acotado a este
            repositorio con permiso <span class="mono">Contents: Read and write</span>.
          </div>
          <div class="auth-field">
            <label for="gh-token">Token de GitHub</label>
            <div class="auth-pass-wrap">
              <input id="gh-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_… o ghp_…" />
              <button type="button" class="auth-pass-toggle" id="gh-token-toggle" aria-label="Mostrar/ocultar">Ver</button>
            </div>
          </div>
          <div class="auth-field">
            <label for="gh-msg">Mensaje de commit (opcional)</label>
            <input id="gh-msg" type="text" value="${modoSoloVazlo ? 'Actualizar existencia Vazlo (proveedor) · ' + (resultado.meta.vazlo && resultado.meta.vazlo.fecha_carga || '') : 'Actualizar datos CEDI · ' + resultado.meta.periodo}" />
          </div>
          <button class="btn btn-primary auth-submit" id="gh-submit">Guardar en el repositorio</button>
        </div>
        <div class="auth-foot">El token no se almacena. Desaparece al cerrar esta ventana o recargar.</div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => { try { modal.remove(); } catch (e) {} };
    modal.querySelector('#gh-close').addEventListener('click', close);
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

    const tokenEl = modal.querySelector('#gh-token');
    const toggle = modal.querySelector('#gh-token-toggle');
    toggle.addEventListener('click', () => {
      const t = tokenEl.type === 'password' ? 'text' : 'password';
      tokenEl.type = t;
      toggle.textContent = t === 'password' ? 'Ver' : 'Ocultar';
    });

    modal.querySelector('#gh-submit').addEventListener('click', () => guardarGitHub(modal));
    tokenEl.addEventListener('keydown', e => { if (e.key === 'Enter') guardarGitHub(modal); });
    setTimeout(() => tokenEl.focus(), 50);
  }

  function guardarGitHub(modal) {
    const errEl = modal.querySelector('#gh-error');
    const btn = modal.querySelector('#gh-submit');
    let token = modal.querySelector('#gh-token').value;
    const msg = modal.querySelector('#gh-msg').value;

    errEl.classList.remove('show'); errEl.textContent = '';
    if (!token || !token.trim()) {
      errEl.textContent = 'Ingresa tu token de GitHub.';
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true; btn.textContent = 'Guardando…';
    const contenido = window.DataProcessor.generarContenidoJS(resultado);

    window.GitHubSync.commit(token, contenido, msg).then(res => {
      // Descartar el token de memoria local cuanto antes
      token = null;
      modal.querySelector('#gh-token').value = '';

      if (res.ok) {
        modal.querySelector('#gh-form-wrap').style.display = 'none';
        const ok = modal.querySelector('#gh-success');
        ok.style.display = 'block';
        ok.innerHTML = `
          <div style="text-align:center;padding:6px 0 4px">
            <div style="font-size:40px;color:var(--c-green)">✓</div>
            <div style="font-family:var(--font-display);font-size:18px;color:var(--c-text);margin-top:8px;font-weight:700">Guardado en GitHub</div>
            <div style="font-size:12px;color:var(--c-text2);margin-top:8px;line-height:1.6">
              El commit se aplicó al repositorio. GitHub Pages puede tardar 1–2 min en reflejar el cambio en el sitio.
            </div>
            ${res.commitUrl ? `<a href="${res.commitUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="margin-top:14px">Ver commit en GitHub →</a>` : ''}
          </div>`;
        // También aplicamos en sesión para ver el cambio sin esperar
        aplicarSesion();
      } else {
        errEl.textContent = res.error || 'No se pudo guardar.';
        errEl.classList.add('show');
        btn.disabled = false; btn.textContent = 'Guardar en el repositorio';
      }
    });
  }

  return { render };
})();
