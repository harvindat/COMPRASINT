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
    presupuesto: 700000,
    leadTime: 5,
    diasCoberturaMeta: 30,
    factorSS: 1.0,
    filtroABC: ['A', 'B'],
    soloConDemanda: true,
    usarVazlo: false,     // leer existencia del almacén del proveedor
    limitarVazlo: false,  // modo agresivo: topar pedido al stock del proveedor
    // ── Blindaje de compra (cascada por tramos) — ACTIVO por default ──
    blindaje: true,                // arranca encendido: financia primero lo crítico
    blindajeAlcance: ['A'],        // clases que entran al blindaje de cero-stock (A / A,B / A,B,C)
    topeT0: 0.70,                  // % presupuesto reservado a cero-stock rápido-movedores
    topeT1: 0.15,                  // % presupuesto reservado a top ancla
    topAnclaN: 200                 // top N por venta_ancla considerados "críticos"
  };

  let params = { ...defaults };
  let filtroSurtido = 'todos'; // filtro de tabla: todos | con_stock | completo | parcial | sin_stock

  /* ─── Estado del dato Vazlo en el dataset vigente ─────── */
  function vazloDisponible() {
    try {
      const d = window.CEDI_DATA;
      return !!(d && d.meta && d.meta.vazlo && d.meta.vazlo.cargado);
    } catch (e) { return false; }
  }
  function vazloMeta() {
    try { return (window.CEDI_DATA.meta && window.CEDI_DATA.meta.vazlo) || {}; } catch (e) { return {}; }
  }

  /* Días transcurridos desde la última carga del archivo del proveedor */
  function vazloAntiguedadDias() {
    const f = vazloMeta().fecha_carga;
    if (!f) return null;
    const m = String(f).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const carga = new Date(+m[1], +m[2] - 1, +m[3]);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((hoy - carga) / 86400000));
  }

  /* Etiqueta de frescura del dato: hoy / hace N días / advertencia si es viejo */
  function vazloFrescuraHTML() {
    const dias = vazloAntiguedadDias();
    const v = vazloMeta();
    if (dias == null) return '';
    if (dias === 0) return `<span style="color:var(--c-green)">✓ Datos actualizados hoy</span>`;
    if (dias <= 7) return `<span style="color:var(--c-text2)">Cargado hace ${dias} día${dias === 1 ? '' : 's'} (${v.fecha_carga})</span>`;
    return `<span style="color:#d9a441">⚠ Cargado hace ${dias} días (${v.fecha_carga}) — considera pedir a Vazlo un archivo nuevo</span>`;
  }

  /* Cambia el modo Vazlo desde cualquier control (radios o aviso) y
     recalcula automáticamente si ya hay un pedido en pantalla. */
  function setVazloModo(modo) {
    params.usarVazlo = modo !== 'off';
    params.limitarVazlo = modo === 'lim';
    if (!params.usarVazlo) filtroSurtido = 'todos';
    const panel = document.getElementById('vazlo-panel');
    if (panel) { panel.innerHTML = vazloPanelHTML(); attachVazloEvents(); }
    const aviso = document.getElementById('vazlo-aviso');
    if (aviso) aviso.innerHTML = '';
    if (currentResult) calcular();
  }

  /* ─── Aviso al entrar: ya hay archivo del proveedor cargado ─────
     Aparece cuando existe dato Vazlo (de Actualizar Datos, GitHub o
     una carga previa en sesión) y aún no se ha decidido un modo.
     Pregunta si se quiere tomar en cuenta el archivo de la última
     carga, con acciones de un clic. */
  function vazloAvisoHTML() {
    if (!vazloDisponible() || vazloModo() !== 'off') return '';
    const v = vazloMeta();
    const dias = vazloAntiguedadDias();
    const esHoy = dias === 0;
    const carry = v.carry_over ? ' <span style="color:#d9a441">(conservado de una actualización anterior)</span>' : '';
    return `
      <div class="card mb-16" style="border-left:3px solid ${esHoy ? 'var(--c-green)' : '#d9a441'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:260px">
            <div class="card-title" style="margin-bottom:4px">⛁ Ya hay existencia del proveedor cargada</div>
            <div style="font-size:12px;color:var(--c-text2);line-height:1.6">
              Archivo <strong>${v.archivo || 'EXISTENCIAVAZLO.xlsx'}</strong> · ${window.FMT.number(v.con_stock || 0)} claves con stock${carry}<br>
              ${vazloFrescuraHTML()}<br>
              ¿Quieres tomar en cuenta el archivo de la última carga en el cálculo del pedido?
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-green btn-sm" id="aviso-vazlo-lim">✓ Sí, calcular contra stock Vazlo</button>
            <button class="btn btn-outline btn-sm" id="aviso-vazlo-info">Solo informativo</button>
            <button class="btn btn-outline btn-sm" id="aviso-vazlo-no">No usar ahora</button>
          </div>
        </div>
      </div>`;
  }

  function attachAvisoEvents() {
    const bLim = document.getElementById('aviso-vazlo-lim');
    if (bLim) bLim.addEventListener('click', () => setVazloModo('lim'));
    const bInfo = document.getElementById('aviso-vazlo-info');
    if (bInfo) bInfo.addEventListener('click', () => setVazloModo('info'));
    const bNo = document.getElementById('aviso-vazlo-no');
    if (bNo) bNo.addEventListener('click', () => {
      const aviso = document.getElementById('vazlo-aviso');
      if (aviso) aviso.innerHTML = '';
    });
  }

  function render() {
    const html = `
      <div class="page-header">
        <div class="page-title">Compra Inteligente</div>
        <div class="page-sub">Simulador de pedido óptimo con restricción de presupuesto</div>
      </div>

      <div id="vazlo-aviso">${vazloAvisoHTML()}</div>

      <div class="section-row cols-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-title">Variables del pedido</div>
          <div class="control-grid">
            <div class="control-group">
              <div class="control-label">Presupuesto semanal</div>
              <div class="control-value" id="val-presupuesto">$700,000</div>
              <div class="slider-wrap">
                <span class="slider-min">$50K</span>
                <input type="range" id="sl-presupuesto" min="50000" max="1000000" step="10000" value="700000" />
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

          <div class="control-group" style="margin-top:12px;padding:12px;border:1px solid var(--c-border);border-radius:8px" id="blindaje-panel">
            ${blindajePanelHTML()}
          </div>

          <div class="control-group" style="margin-top:12px;padding:12px;border:1px solid var(--c-border);border-radius:8px" id="vazlo-panel">
            ${vazloPanelHTML()}
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
            <select id="filtro-surtido" style="width:190px;font-size:12px;display:none">
              <option value="todos">Surtido: Todos</option>
              <option value="con_stock">Con existencia Vazlo (&gt;0)</option>
              <option value="completo">Surtido completo</option>
              <option value="parcial">Surtido parcial</option>
              <option value="sin_stock">Sin existencia Vazlo</option>
            </select>
            <select id="sort-pedido" style="width:160px;font-size:12px">
              <option value="score">Ordenar: Prioridad</option>
              <option value="costoFinal">Ordenar: Costo total</option>
              <option value="cantFinal">Ordenar: Cantidad</option>
              <option value="abc">Ordenar: ABC</option>
              <option value="diasCobertura">Ordenar: Cobertura actual</option>
              <option value="existenciaVazlo">Ordenar: Exist. Vazlo</option>
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

  /* ─── Panel "Blindaje de compra" (cascada por tramos) ──
     Reserva presupuesto para lo crítico ANTES de la cascada general:
       Tramo 0 (más protegido): cero-stock rápido-movedores
       Tramo 1: top ancla que necesita reposición
       Tramo 2: cascada general con el resto
     El % de "General" se calcula = 100 - T0 - T1 (no baja de 0). */
  function pctGeneral() {
    const g = Math.round((1 - params.topeT0 - params.topeT1) * 100);
    return Math.max(0, g);
  }

  function blindajePanelHTML() {
    const on = !!params.blindaje;
    const alc = (params.blindajeAlcance || ['A']).join('');
    const alcVal = alc === 'A' ? 'A' : (alc === 'AB' ? 'AB' : 'ABC');
    const scopeBtn = (val, label) => `
      <button type="button" class="lt-btn blindaje-scope ${alcVal === val ? 'active' : ''}" data-scope="${val}" ${on ? '' : 'disabled'}>${label}</button>`;
    const controles = `
      <div id="blindaje-controls" style="margin-top:10px;${on ? '' : 'opacity:0.45;pointer-events:none'}">
        <div style="font-size:11px;color:var(--c-text3);margin-bottom:8px;line-height:1.5">
          El presupuesto se reparte en tramos con prioridad. Lo que no se usa en un tramo baja al siguiente.
        </div>
        <div class="control-label" style="margin-bottom:4px">Alcance del blindaje cero-stock</div>
        <div class="lt-buttons" id="blindaje-scope-btns" style="margin-bottom:12px">
          ${scopeBtn('A', 'Solo A')}
          ${scopeBtn('AB', 'A + B')}
          ${scopeBtn('ABC', 'A + B + C')}
        </div>

        <div class="control-group" style="margin-bottom:10px">
          <div class="control-label" style="display:flex;justify-content:space-between">
            <span>① Cero-stock rápido-movedores</span>
            <span class="control-value" id="val-topeT0" style="font-size:13px">${Math.round(params.topeT0 * 100)}%</span>
          </div>
          <input type="range" id="sl-topeT0" min="0" max="100" step="5" value="${Math.round(params.topeT0 * 100)}" ${on ? '' : 'disabled'} style="width:100%" />
        </div>

        <div class="control-group" style="margin-bottom:10px">
          <div class="control-label" style="display:flex;justify-content:space-between">
            <span>② Top ancla "nunca deben faltar"</span>
            <span class="control-value" id="val-topeT1" style="font-size:13px">${Math.round(params.topeT1 * 100)}%</span>
          </div>
          <input type="range" id="sl-topeT1" min="0" max="100" step="5" value="${Math.round(params.topeT1 * 100)}" ${on ? '' : 'disabled'} style="width:100%" />
        </div>

        <div style="font-size:12px;color:var(--c-text2);display:flex;justify-content:space-between;padding-top:6px;border-top:1px dashed var(--c-border)">
          <span>③ Cascada general (resto)</span>
          <span id="val-general" style="font-weight:600;color:var(--c-text)">${pctGeneral()}%</span>
        </div>
      </div>`;

    return `
      <div class="control-label" style="display:flex;align-items:center;gap:6px">
        Blindaje de compra
        <span style="font-size:10px;color:${on ? 'var(--c-green)' : 'var(--c-text3)'};border:1px solid ${on ? 'var(--c-green)' : 'var(--c-border)'};border-radius:4px;padding:1px 6px">${on ? 'ACTIVO' : 'INACTIVO'}</span>
      </div>
      <label style="font-size:12px;display:flex;align-items:flex-start;gap:8px;margin-top:8px;cursor:pointer">
        <input type="checkbox" id="opt-blindaje" ${on ? 'checked' : ''} style="margin-top:2px">
        <span><strong>Blindar artículos en cero por venta</strong><br>
        <span style="color:var(--c-text3);font-size:11px">Financia primero los cero-stock rápido-movedores y los top ancla, antes de la cascada general por score.</span></span>
      </label>
      ${controles}`;
  }

  function refrescarBlindajePanel() {
    const panel = document.getElementById('blindaje-panel');
    if (panel) { panel.innerHTML = blindajePanelHTML(); attachBlindajeEvents(); }
  }

  function attachBlindajeEvents() {
    const toggle = document.getElementById('opt-blindaje');
    if (toggle) toggle.addEventListener('change', () => {
      params.blindaje = toggle.checked;
      refrescarBlindajePanel();
      if (currentResult) calcular();
    });

    document.querySelectorAll('.blindaje-scope').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.scope;
        params.blindajeAlcance = v === 'A' ? ['A'] : (v === 'AB' ? ['A', 'B'] : ['A', 'B', 'C']);
        document.querySelectorAll('.blindaje-scope').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (currentResult) calcular();
      });
    });

    // Sliders de tope: T0 + T1 no pueden pasar de 100%
    const sT0 = document.getElementById('sl-topeT0');
    const sT1 = document.getElementById('sl-topeT1');
    const syncGeneral = () => {
      const g = document.getElementById('val-general');
      if (g) g.textContent = pctGeneral() + '%';
    };
    if (sT0) sT0.addEventListener('input', () => {
      let v0 = parseInt(sT0.value) / 100;
      if (v0 + params.topeT1 > 1) { params.topeT1 = 1 - v0; if (sT1) sT1.value = Math.round(params.topeT1 * 100); document.getElementById('val-topeT1').textContent = Math.round(params.topeT1 * 100) + '%'; }
      params.topeT0 = v0;
      document.getElementById('val-topeT0').textContent = Math.round(v0 * 100) + '%';
      syncGeneral();
    });
    if (sT0) sT0.addEventListener('change', () => { if (currentResult) calcular(); });
    if (sT1) sT1.addEventListener('input', () => {
      let v1 = parseInt(sT1.value) / 100;
      if (params.topeT0 + v1 > 1) { params.topeT0 = 1 - v1; if (sT0) sT0.value = Math.round(params.topeT0 * 100); document.getElementById('val-topeT0').textContent = Math.round(params.topeT0 * 100) + '%'; }
      params.topeT1 = v1;
      document.getElementById('val-topeT1').textContent = Math.round(v1 * 100) + '%';
      syncGeneral();
    });
    if (sT1) sT1.addEventListener('change', () => { if (currentResult) calcular(); });
  }

  /* ─── Panel de opciones "Existencia Vazlo" ─────────────
     Selector de 3 modos con recálculo automático:
       off  → el cálculo ignora al proveedor
       info → columna + filtro de surtido, el pedido no cambia
       lim  → el pedido SE CALCULA contra el stock del proveedor
     · Sin dato → carga rápida en sesión sin pasar por el flujo
       completo de 5 archivos de Actualizar Datos. */
  function vazloModo() {
    return params.usarVazlo ? (params.limitarVazlo ? 'lim' : 'info') : 'off';
  }

  function vazloPanelHTML() {
    const disp = vazloDisponible();
    const v = vazloMeta();
    if (disp) {
      const modo = vazloModo();
      const radio = (val, titulo, desc) => `
        <label style="font-size:12px;display:flex;align-items:flex-start;gap:8px;margin-top:8px;cursor:pointer;padding:8px 10px;border:1px solid ${modo === val ? 'var(--c-accent)' : 'var(--c-border)'};border-radius:6px;${modo === val ? 'background:rgba(218,54,51,0.06)' : ''}">
          <input type="radio" name="vazlo-mode" value="${val}" ${modo === val ? 'checked' : ''} style="margin-top:2px">
          <span><strong>${titulo}</strong><br><span style="color:var(--c-text3);font-size:11px">${desc}</span></span>
        </label>`;
      return `
        <div class="control-label" style="display:flex;align-items:center;gap:6px">
          Existencia del proveedor (Vazlo)
          <span style="font-size:10px;color:var(--c-green);border:1px solid var(--c-green);border-radius:4px;padding:1px 6px">DATO CARGADO · ${v.fecha_carga || '—'}</span>
        </div>
        <div style="font-size:11px;color:var(--c-text3);margin-top:2px">
          ${window.FMT.number(v.matched || 0)} claves cruzadas · ${window.FMT.number(v.con_stock || 0)} con stock en el almacén del proveedor · ${vazloFrescuraHTML()}<br>
          Al cambiar el modo, el pedido se recalcula automáticamente.
        </div>
        ${radio('off', 'No usar existencia Vazlo', 'El cálculo ignora el stock del proveedor (comportamiento clásico).')}
        ${radio('info', 'Informativo', 'Agrega la columna Exist. Vazlo y el filtro de surtido. El pedido NO cambia.')}
        ${radio('lim', 'Calcular contra stock Vazlo', 'El pedido se topa al stock del proveedor y el presupuesto se reasigna a lo que SÍ puede surtir. El resultado del encabezado cambia.')}
        <div style="font-size:11px;color:var(--c-text3);margin-top:8px">
          ¿Archivo nuevo del proveedor?
          <label style="cursor:pointer;color:var(--c-accent);text-decoration:underline">Reemplazar en sesión<input type="file" id="file-vazlo-inline" accept=".xlsx,.xls" style="display:none"></label>
          · Para hacerlo permanente usa <strong>Actualizar Datos → Guardar en GitHub</strong> (puedes subir solo este archivo, sin los otros 5).
        </div>`;
    }
    return `
      <div class="control-label">Existencia del proveedor (Vazlo)</div>
      <div style="font-size:12px;color:var(--c-text2);margin-top:4px;line-height:1.6">
        Aún no hay existencia del proveedor cargada. Cárgala aquí para validar qué artículos del pedido
        <strong>sí puede surtir el proveedor</strong>, o hazlo desde <strong>Actualizar Datos</strong> (puedes subir solo ese archivo)
        para guardarla en GitHub y que quede habilitada de forma permanente.
      </div>
      <label class="btn btn-outline btn-sm" style="cursor:pointer;margin-top:8px;display:inline-block">
        ⛁ Cargar EXISTENCIAVAZLO.xlsx (solo esta sesión)
        <input type="file" id="file-vazlo-inline" accept=".xlsx,.xls" style="display:none">
      </label>
      <div id="vazlo-inline-status" style="font-size:11px;color:var(--c-text3);margin-top:6px"></div>`;
  }

  function attachVazloEvents() {
    attachAvisoEvents();
    document.querySelectorAll('input[name="vazlo-mode"]').forEach(r => {
      r.addEventListener('change', () => setVazloModo(r.value));
    });

    const inline = document.getElementById('file-vazlo-inline');
    if (inline) inline.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const status = document.getElementById('vazlo-inline-status');
      if (status) status.textContent = '⏳ Leyendo archivo del proveedor…';
      try {
        const parsedV = await window.DataProcessor.parseVazloFile(f);
        if (!parsedV.filas) throw new Error('No se detectaron claves con existencia en el archivo. Verifica que tenga columnas de clave y existencia.');
        const stats = window.DataProcessor.aplicarVazloEnSesion(parsedV.map, f.name);
        if (!stats) throw new Error('No hay dataset base cargado en la sesión.');
        params.usarVazlo = true;
        // Redibujar el panel con el nuevo estado y ocultar el aviso
        const panel = document.getElementById('vazlo-panel');
        if (panel) { panel.innerHTML = vazloPanelHTML(); attachVazloEvents(); }
        const aviso = document.getElementById('vazlo-aviso');
        if (aviso) aviso.innerHTML = '';
        // Si ya había un pedido calculado, recalcular de inmediato con el dato nuevo
        if (currentResult) calcular();
      } catch (err) {
        console.error('Error cargando existencia Vazlo:', err);
        const status2 = document.getElementById('vazlo-inline-status');
        if (status2) { status2.style.color = 'var(--c-red)'; status2.textContent = '✗ ' + err.message; }
      }
    });
  }

  function attachEvents() {
    attachVazloEvents();
    attachBlindajeEvents();

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

    const filtroEl = document.getElementById('filtro-surtido');
    if (filtroEl) filtroEl.addEventListener('change', () => {
      filtroSurtido = filtroEl.value;
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

    // Blindaje: si el dataset en sesión ya no trae dato Vazlo, desactivar el modo
    if (params.usarVazlo && !vazloDisponible()) {
      params.usarVazlo = false;
      params.limitarVazlo = false;
      filtroSurtido = 'todos';
      const panel = document.getElementById('vazlo-panel');
      if (panel) { panel.innerHTML = vazloPanelHTML(); attachVazloEvents(); }
    }

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

    // Bloque de surtido Vazlo
    let vazloBlock = '';
    if (result.usarVazlo && result.vazloStats) {
      const vs = result.vazloStats;
      const pctSurtible = result.totalCosto > 0 ? (vs.costoSurtible / result.totalCosto * 100).toFixed(1) : '0.0';
      const modo = result.limitarVazlo
        ? `Modo agresivo: pedido topado al stock del proveedor · ${F.number(vs.excluidos)} arts sin stock excluidos · ${F.number(vs.recortados)} recortados`
        : 'Modo informativo: el cálculo no se limitó al stock del proveedor';
      vazloBlock = `
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--c-border)">
          <div class="rp-label" style="margin-bottom:6px">Surtido contra existencia Vazlo · ${pctSurtible}% del costo es surtible</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="badge" style="background:rgba(46,160,67,0.15);color:var(--c-green)">● Completo: ${F.number(vs.completo)}</span>
            <span class="badge" style="background:rgba(217,164,65,0.15);color:#d9a441">◐ Parcial: ${F.number(vs.parcial)}</span>
            <span class="badge" style="background:rgba(218,54,51,0.15);color:var(--c-red)">○ Sin stock: ${F.number(vs.sinStock)}</span>
            <span class="badge" style="background:rgba(255,255,255,0.06);color:var(--c-text2)">Surtible: ${F.compact(vs.costoSurtible)}</span>
          </div>
          <div style="font-size:11px;color:var(--c-text3);margin-top:6px">${modo}</div>
        </div>`;
    }

    // Bloque de tramos (modo blindaje)
    let blindajeBlock = '';
    if (result.blindaje && result.tramos) {
      const TR_COLOR = { cero_rapido: 'var(--c-red)', ancla: 'var(--c-accent-2, #7aa2f7)', general: 'var(--c-text2)' };
      const rows = result.tramos.map(t => {
        const fuera = t.fueraArts > 0
          ? `<span style="color:#d9a441;font-size:11px">${F.number(t.fueraArts)} fuera x presup. (${F.compact(t.fueraCosto)})</span>`
          : `<span style="color:var(--c-green);font-size:11px">tramo cubierto ✓</span>`;
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--c-border)">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:8px;height:8px;border-radius:50%;background:${TR_COLOR[t.id] || 'var(--c-text3)'}"></span>
              <span style="font-size:12px">${t.nombre}</span>
              <span style="font-size:11px;color:var(--c-text3)">${F.number(t.arts)}/${F.number(t.candidatos)} arts</span>
            </div>
            <div style="text-align:right">
              <div style="font-size:12px;font-weight:600">${F.compact(t.costo)}</div>
              <div>${fuera}</div>
            </div>
          </div>`;
      }).join('');
      blindajeBlock = `
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--c-border)">
          <div class="rp-label" style="margin-bottom:4px">Blindaje por tramos · alcance ${(result.blindajeAlcance || []).join('+')}</div>
          ${rows}
        </div>`;
    }

    panel.innerHTML = `
      <div class="result-panel">
        <div class="rp-label">Pedido óptimo calculado · Lead time ${params.leadTime} días · Factor ×${flt.toFixed(2)}${result.blindaje ? ' · Blindaje activo' : ''}${result.usarVazlo ? ' · Existencia Vazlo activa' : ''}</div>
        <div class="rp-value">${F.compact(result.totalCosto)}</div>
        <div class="rp-sub">${pctUsado}% del presupuesto utilizado · ${F.compact(result.presupuestoRestante)} disponible</div>
        <div class="rp-grid">
          <div><div class="rp-item-label">Artículos a pedir</div><div class="rp-item-val">${F.number(result.totalArts)}</div></div>
          <div><div class="rp-item-label">Unidades totales</div><div class="rp-item-val">${F.number(result.totalUnidades)}</div></div>
          <div><div class="rp-item-label">Cobertura objetivo</div><div class="rp-item-val">${params.diasCoberturaMeta} días</div></div>
        </div>
        <div style="margin-top:14px;display:flex;gap:6px;flex-wrap:wrap">${abcRows}</div>
        ${blindajeBlock}
        ${vazloBlock}
      </div>`;
  }

  function renderTablaPedido() {
    if (!currentResult) return;
    const F = window.FMT;
    const searchEl = document.getElementById('search-pedido');
    const query = searchEl ? searchEl.value.toLowerCase() : '';

    const vazloOn = !!currentResult.usarVazlo;

    // Mostrar/ocultar el filtro de surtido según el modo del cálculo
    const filtroEl = document.getElementById('filtro-surtido');
    if (filtroEl) {
      filtroEl.style.display = vazloOn ? '' : 'none';
      filtroEl.value = vazloOn ? filtroSurtido : 'todos';
    }

    let pedido = currentResult.pedido;
    if (query) {
      pedido = pedido.filter(a =>
        (a.clave || '').toLowerCase().includes(query) ||
        (a.descripcion || '').toLowerCase().includes(query)
      );
    }

    // Filtro de surtido contra existencia del proveedor
    if (vazloOn && filtroSurtido !== 'todos') {
      pedido = pedido.filter(a => {
        const ev = a.existenciaVazlo || 0;
        if (filtroSurtido === 'con_stock') return ev > 0;
        return a.surtido === filtroSurtido;
      });
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
    // Costo surtible: la parte del pedido filtrado que el proveedor SÍ puede entregar
    const costoSurtible = vazloOn
      ? pedido.reduce((s, a) => s + Math.min(a.cantFinal, a.existenciaVazlo || 0) * a.costoUnit, 0)
      : 0;

    const rows = slice.map(a => {
      const diasCls = F.diasColor(a.diasCobertura);
      const score = Math.round(a.score || 0);
      const anclaTag = a.pctAncla > 0.3 ? ' <span class="badge badge-ancla" style="font-size:9px">ancla</span>' : '';
      const TRAMO_TAG = {
        cero_rapido: '<span class="badge" style="font-size:9px;background:rgba(218,54,51,0.15);color:var(--c-red)">cero-rápido</span>',
        ancla: '<span class="badge" style="font-size:9px;background:rgba(122,162,247,0.15);color:#7aa2f7">top-ancla</span>'
      };
      const tramoTag = (currentResult.blindaje && TRAMO_TAG[a.tramo]) ? ' ' + TRAMO_TAG[a.tramo] : '';
      let vazloCell = '';
      if (vazloOn) {
        const ev = a.existenciaVazlo || 0;
        const col = a.surtido === 'completo' ? 'var(--c-green)' : (a.surtido === 'parcial' ? '#d9a441' : 'var(--c-red)');
        const icon = a.surtido === 'completo' ? '●' : (a.surtido === 'parcial' ? '◐' : '○');
        vazloCell = `<td class="right mono" style="color:${col};font-weight:600" title="${a.surtido === 'completo' ? 'El proveedor cubre todo el pedido' : a.surtido === 'parcial' ? 'El proveedor cubre parcialmente' : 'Sin existencia en el proveedor'}">${icon} ${F.number(ev)}</td>`;
      }
      return `
        <tr>
          <td class="clave">${a.clave}</td>
          <td class="desc">${a.descripcion}${anclaTag}${tramoTag}</td>
          <td>${F.abcBadge(a.abc)}</td>
          <td class="right mono">${F.number(a.existencia)}</td>
          ${vazloCell}
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
      const surtibleItem = vazloOn
        ? `<div class="totals-item"><div class="totals-label">Costo surtible (Vazlo)</div><div class="totals-val" style="color:var(--c-green)">${F.currency(costoSurtible)}</div></div>`
        : '';
      const vazloTh = vazloOn ? '<th class="right">Exist. Vazlo</th>' : '';

      // Indicador de filtrado: cuando el filtro de surtido o la búsqueda están
      // activos, el encabezado muestra "X de Y" y un badge para que sea
      // inconfundible que los totales corresponden al subconjunto filtrado.
      const totalCompleto = currentResult.pedido.length;
      const hayFiltro = total !== totalCompleto;
      const FILTRO_LABEL = {
        con_stock: 'Con existencia Vazlo', completo: 'Surtido completo',
        parcial: 'Surtido parcial', sin_stock: 'Sin existencia Vazlo'
      };
      const filtroActivo = [];
      if (vazloOn && filtroSurtido !== 'todos') filtroActivo.push(FILTRO_LABEL[filtroSurtido] || filtroSurtido);
      if (query) filtroActivo.push(`"${query}"`);
      const filtroBadge = hayFiltro
        ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
             <span style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--c-accent);border:1px solid var(--c-accent);border-radius:4px;padding:2px 8px">FILTRADO: ${filtroActivo.join(' + ') || 'activo'}</span>
             <span style="font-size:11px;color:var(--c-text3)">Los totales de abajo corresponden solo a los artículos filtrados · el pedido completo es ${F.number(totalCompleto)} arts</span>
           </div>`
        : '';
      const artsVal = hayFiltro
        ? `${F.number(total)} <span style="font-size:12px;color:var(--c-text3);font-weight:400">de ${F.number(totalCompleto)}</span>`
        : F.number(total);
      const sufijo = hayFiltro ? ' (filtrado)' : '';
      content.innerHTML = `
        ${filtroBadge}
        <div class="totals-row">
          <div class="totals-item"><div class="totals-label">Artículos en pedido${sufijo}</div><div class="totals-val accent">${artsVal}</div></div>
          <div class="totals-item"><div class="totals-label">Unidades totales${sufijo}</div><div class="totals-val">${F.number(totalUds)}</div></div>
          <div class="totals-item"><div class="totals-label">Costo total c/IVA${sufijo}</div><div class="totals-val green">${F.currency(totalCosto)}</div></div>
          ${surtibleItem}
          <div class="totals-item"><div class="totals-label">Presupuesto restante</div><div class="totals-val">${F.currency(currentResult.presupuestoRestante)}</div></div>
        </div>
        <div class="tbl-wrap" style="max-height:420px;overflow-y:auto;margin-top:10px">
          <table class="data-table">
            <thead><tr>
              <th>Clave</th><th>Descripción</th><th>ABC</th>
              <th class="right">Stock</th>${vazloTh}<th class="right">Cob. actual</th>
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
    filtroSurtido = 'todos';
    render();
  }

  function exportarPedido() {
    if (!currentResult || !currentResult.pedido.length) {
      alert('Primero calcula un pedido para exportar.');
      return;
    }
    const F = window.FMT;
    const vazloOn = !!currentResult.usarVazlo;
    const blindajeOn = !!currentResult.blindaje;
    const SURTIDO_LABEL = { completo: 'COMPLETO', parcial: 'PARCIAL', sin_stock: 'SIN STOCK' };
    const TRAMO_LABEL = { cero_rapido: 'CERO-STOCK RÁPIDO', ancla: 'TOP ANCLA', general: 'CASCADA GENERAL' };
    const rows = currentResult.pedido.map(a => {
      const base = {
        'Clave': a.clave,
        'Descripción': a.descripcion,
        'Línea': a.linea,
        'ABC': a.abc,
        'Stock Actual': a.existencia
      };
      if (blindajeOn) base['Tramo Blindaje'] = TRAMO_LABEL[a.tramo] || a.tramo || '';
      if (vazloOn) {
        base['Existencia Vazlo'] = a.existenciaVazlo || 0;
        base['Surtido Proveedor'] = SURTIDO_LABEL[a.surtido] || '';
        base['Uds Surtibles'] = Math.min(a.cantFinal, a.existenciaVazlo || 0);
      }
      return Object.assign(base, {
        'Días Cobertura Actual': Math.round(a.diasCobertura),
        'Stock Seguridad': a.ss,
        'Pto. Reorden': a.rop,
        'Cantidad a Pedir': a.cantFinal,
        'Costo Unit. s/IVA': F.round2(a.costoUnit / 1.16),
        'Costo Unit. c/IVA': F.round2(a.costoUnit),
        'Costo Total c/IVA': F.round2(a.costoFinal),
        'Score Prioridad': Math.round(a.score),
        '% Clientes Ancla': F.round2(a.pctAncla * 100)
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    const cols = vazloOn
      ? [8,30,18,5,10,14,16,12,10,12,12,14,16,16,16,12,14]
      : [8,30,18,5,10,14,12,12,14,16,16,16,12,14];
    ws['!cols'] = cols.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido');

    // Summary sheet
    const summary = [
      { 'Parámetro': 'Presupuesto', 'Valor': '$' + params.presupuesto.toLocaleString('es-MX') },
      { 'Parámetro': 'Lead Time (días)', 'Valor': params.leadTime },
      { 'Parámetro': 'Factor Lead Time', 'Valor': window.CALC.factorLeadTime(params.leadTime) },
      { 'Parámetro': 'Días Cobertura Objetivo', 'Valor': params.diasCoberturaMeta },
      { 'Parámetro': 'Factor Stock Seguridad', 'Valor': params.factorSS },
      { 'Parámetro': 'Filtro ABC', 'Valor': params.filtroABC.join(',') },
      { 'Parámetro': 'Blindaje de compra', 'Valor': blindajeOn ? 'ACTIVO' : 'No usado' },
      ...(blindajeOn ? [
        { 'Parámetro': 'Alcance blindaje cero-stock', 'Valor': (currentResult.blindajeAlcance || []).join(',') },
        { 'Parámetro': 'Tope Tramo Cero-stock rápido', 'Valor': Math.round((currentResult.topeT0 || 0) * 100) + '%' },
        { 'Parámetro': 'Tope Tramo Top ancla', 'Valor': Math.round((currentResult.topeT1 || 0) * 100) + '%' },
        ...(currentResult.tramos || []).map(t => ({
          'Parámetro': `Tramo ${t.nombre}`,
          'Valor': `${t.arts} arts · ${F.round2(t.costo)} · ${t.fueraArts} fuera x presup.`
        }))
      ] : []),
      { 'Parámetro': 'Existencia Vazlo', 'Valor': vazloOn ? 'ACTIVA' : 'No usada' },
      ...(vazloOn ? [
        { 'Parámetro': 'Modo Vazlo', 'Valor': currentResult.limitarVazlo ? 'Limitado al stock del proveedor' : 'Informativo' },
        { 'Parámetro': 'Fecha carga Vazlo', 'Valor': vazloMeta().fecha_carga || '—' },
        { 'Parámetro': 'Arts surtido completo', 'Valor': currentResult.vazloStats ? currentResult.vazloStats.completo : 0 },
        { 'Parámetro': 'Arts surtido parcial', 'Valor': currentResult.vazloStats ? currentResult.vazloStats.parcial : 0 },
        { 'Parámetro': 'Arts sin stock proveedor', 'Valor': currentResult.vazloStats ? currentResult.vazloStats.sinStock : 0 },
        { 'Parámetro': 'Costo surtible c/IVA', 'Valor': currentResult.vazloStats ? F.round2(currentResult.vazloStats.costoSurtible) : 0 },
      ] : []),
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
