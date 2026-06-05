/* ============================================================
   bootstrap.js — Arranque con datos siempre frescos
   CEDI Intelligence · Harvin Distribuciones
   ------------------------------------------------------------
   Carga src/data/cedi_data.js evitando el caché del navegador y
   del CDN de GitHub Pages (parámetro ?t= único por carga) y solo
   DESPUÉS arranca la app (app.js). De esta forma, en cuanto un
   nuevo cedi_data.js queda publicado por "Guardar en GitHub",
   cualquier recarga normal muestra los datos nuevos en cuanto
   GitHub Pages termina de reconstruir (~30–60s), sin necesidad de
   un refresco forzado (Ctrl+Shift+R).

   Por qué funciona: GitHub Pages (Fastly) cachea por URL completa,
   incluida la query string. Un ?t= distinto en cada carga produce
   una URL nueva que el caché no tiene, así que sirve siempre la
   última versión construida.
   ============================================================ */
(function () {
  'use strict';

  var DATA_URL = 'src/data/cedi_data.js';
  var APP_URL  = 'src/app.js';
  var v = Date.now(); // sello único por carga → ignora cachés intermedios

  function inject(src, onload, onerror) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false; // preserva orden de ejecución
    if (onload)  s.onload = onload;
    if (onerror) s.onerror = onerror;
    (document.body || document.head || document.documentElement).appendChild(s);
    return s;
  }

  function mostrarError(msg) {
    var app = document.getElementById('app');
    if (app) {
      app.innerHTML =
        '<div style="padding:40px;font-family:sans-serif;color:#C0392B">' +
        '<strong>Error:</strong> ' + msg +
        '<br><br>Recarga la página. Si persiste, verifica que ' +
        '<code>src/data/cedi_data.js</code> exista en el repositorio.</div>';
    }
  }

  function arrancarApp() {
    // app.js se auto-inicializa y ya encontrará window.CEDI_DATA listo.
    inject(APP_URL + '?t=' + v, null, function () {
      mostrarError('No se pudo cargar la aplicación (app.js).');
    });
  }

  // 1) Cargar datos SIN caché (URL única por carga).
  inject(DATA_URL + '?t=' + v, arrancarApp, function () {
    // Fallback: reintento sin query (p. ej. al abrir como archivo local
    // file://, donde algunos navegadores rechazan el query en file URLs).
    inject(DATA_URL, arrancarApp, function () {
      mostrarError('No se pudo cargar el archivo de datos (cedi_data.js).');
    });
  });
})();
