/* ============================================================
   app.js — Controlador principal de navegación
   CEDI Intelligence · Harvin Distribuciones
   ============================================================ */

(function() {
  'use strict';

  const pages = {
    dashboard: window.PageDashboard,
    compra:    window.PageCompra,
    abc:       window.PageABC,
    clientes:  window.PageClientes,
    inventario:window.PageInventario,
    exportar:  window.PageExportar,
    actualizar:window.PageActualizar
  };

  let currentPage = null;

  function navigate(pageId) {
    if (!pages[pageId]) return;

    // Destroy charts of current page if applicable
    if (currentPage && pages[currentPage] && pages[currentPage].destroyCharts) {
      try { pages[currentPage].destroyCharts(); } catch(e) {}
    }

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show selected
    const pageEl = document.getElementById('page-' + pageId);
    if (pageEl) pageEl.classList.add('active');

    const navEl = document.querySelector(`[data-page="${pageId}"]`);
    if (navEl) navEl.classList.add('active');

    currentPage = pageId;

    // Render the page
    if (pages[pageId] && pages[pageId].render) {
      try {
        pages[pageId].render();
      } catch(e) {
        console.error('Error rendering page ' + pageId + ':', e);
        const el = document.getElementById('page-' + pageId);
        if (el) el.innerHTML = `<div style="padding:40px;color:#C0392B"><strong>Error al cargar la página:</strong> ${e.message}</div>`;
      }
    }
  }

  function init() {
    // Validate data loaded
    if (!window.CEDI_DATA) {
      document.getElementById('app').innerHTML = '<div style="padding:40px;font-family:sans-serif"><strong>Error:</strong> No se encontró el archivo de datos CEDI. Verifica que cedi_data.js esté en src/data/</div>';
      return;
    }

    if (!window.CALC || !window.FMT) {
      document.getElementById('app').innerHTML = '<div style="padding:40px;font-family:sans-serif"><strong>Error:</strong> No se cargaron los módulos de utilidades.</div>';
      return;
    }

    // Poblar período dinámico en el sidebar desde meta
    try {
      const meta = window.CEDI_DATA.meta || {};
      const elP = document.getElementById('sidebar-periodo');
      const elC = document.getElementById('sidebar-corte');
      if (elP) elP.textContent = 'Período: ' + (meta.periodo || '—');
      if (elC) elC.textContent = 'Corte: ' + (meta.fecha_corte || '—');
    } catch (e) {}

    // Nav click handlers
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page) navigate(page);
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.altKey) {
        const map = { '1':'dashboard','2':'compra','3':'abc','4':'clientes','5':'inventario','6':'exportar','7':'actualizar' };
        if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
      }
    });

    // Load dashboard on start
    navigate('dashboard');
  }

  // Exponer API mínima para que otros módulos (ej. Actualizar) puedan
  // redirigir o refrescar la vista tras aplicar un nuevo dataset.
  window.App = { navigate: navigate };

  // Init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
