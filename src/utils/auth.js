/* ============================================================
   auth.js — Autenticación y control de acceso
   CEDI Intelligence · Harvin Distribuciones
   ------------------------------------------------------------
   Estándares aplicados (lado cliente):
   · Contraseñas NUNCA en texto plano: se guardan como derivación
     PBKDF2-HMAC-SHA256 (150 000 iteraciones, sal de 16 bytes por
     usuario) verificada con la Web Crypto API.
   · Sesión con expiración (8 h) almacenada en sessionStorage
     (se borra al cerrar la pestaña).
   · Bloqueo temporal tras 5 intentos fallidos.
   · Páginas sensibles (Compra Inteligente / Actualizar Datos)
     bloqueadas para invitados.

   NOTA DE SEGURIDAD: este es un sitio 100% estático (GitHub Pages,
   sin backend). La verificación corre en el navegador, por lo que
   ofrece control de acceso y disuasión razonables, pero NO equivale
   a seguridad de servidor. Para protección fuerte real se requiere
   un backend que valide credenciales. Aun así, aquí no se exponen
   contraseñas en claro: solo hashes derivados.
   ============================================================ */

window.Auth = (function () {
  'use strict';

  // -------- Configuración --------
  var PBKDF2_ITER = 150000;
  var DK_BITS = 256;
  var SESSION_MS = 8 * 60 * 60 * 1000;   // 8 horas
  var MAX_ATTEMPTS = 5;
  var LOCK_MS = 60 * 1000;               // 60 s de bloqueo
  var SESSION_KEY = 'harvin_session_v1';

  // Páginas que requieren estar autenticado
  var GATED = ['compra', 'actualizar', 'exportar'];

  // -------- Tabla de usuarios (hashes PBKDF2, sin texto plano) --------
  // perms: ['*'] = todo el sitio. De lo contrario, lista de páginas permitidas.
  var USERS = {
    b3t0: {
      username: 'b3t0',
      display: 'b3t0',
      role: 'Super Usuario',
      roleKey: 'super',
      saltB64: '4uwGmUnwaUAxM6dNWJrs1g==',
      hashB64: 'qw7Rz0vVgZ4R2b+IeDxzsdLk7SmTU9ZSzBRRD73NflE=',
      perms: ['*']
    },
    daniel: {
      username: 'daniel',
      display: 'daniel',
      role: 'Operador',
      roleKey: 'operador',
      saltB64: 'unJBGCJ3kiR8owa4deuLvA==',
      hashB64: '8WP987gv2+vc2FS0Tp4nCpP7IHiIUfbp/Wkn6n3xXdg=',
      perms: ['dashboard', 'compra', 'abc', 'clientes', 'inventario', 'exportar', 'actualizar']
    },
    cindy: {
      username: 'cindy',
      display: 'cindy',
      role: 'Operador',
      roleKey: 'operador',
      saltB64: 'U8hxmaSNLWaOUdc7PZ8Cxg==',
      hashB64: 'JrXODHuAMtsbCSjgSs5HfzvnuXvGVfXavzs52AsmunI=',
      // Mismos permisos que daniel
      perms: ['dashboard', 'compra', 'abc', 'clientes', 'inventario', 'exportar', 'actualizar']
    }
  };

  // -------- Estado interno --------
  var attempts = {};          // { username: { count, until } }
  var changeCbs = [];
  var current = null;         // usuario en sesión (sin hash)

  // -------- Utilidades cripto --------
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bytesToB64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function cryptoOk() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  function derive(password, saltBytes) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (km) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' },
          km, DK_BITS
        );
      });
  }

  // Comparación en tiempo (casi) constante
  function constEq(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
    return diff === 0;
  }

  // -------- Sesión --------
  function saveSession(user) {
    var data = { u: user.username, role: user.roleKey, exp: Date.now() + SESSION_MS };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function loadSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.u || !d.exp || Date.now() > d.exp) { clearSession(); return null; }
      var u = USERS[d.u];
      if (!u) { clearSession(); return null; }
      return publicUser(u);
    } catch (e) { return null; }
  }
  function publicUser(u) {
    return { username: u.username, display: u.display, role: u.role, roleKey: u.roleKey, perms: u.perms.slice() };
  }

  // -------- API pública --------
  function getUser() { return current; }
  function isLoggedIn() { return !!current; }

  function can(pageId) {
    if (GATED.indexOf(pageId) === -1) return true;   // páginas públicas
    if (!current) return false;
    if (current.perms.indexOf('*') !== -1) return true;
    return current.perms.indexOf(pageId) !== -1;
  }
  function isGated(pageId) { return GATED.indexOf(pageId) !== -1; }

  function onChange(cb) { if (typeof cb === 'function') changeCbs.push(cb); }
  function emitChange() { changeCbs.forEach(function (cb) { try { cb(current); } catch (e) {} }); }

  function login(username, password) {
    username = (username || '').trim().toLowerCase();
    var u = USERS[username];

    // Bloqueo por intentos
    var st = attempts[username];
    if (st && st.until && Date.now() < st.until) {
      var secs = Math.ceil((st.until - Date.now()) / 1000);
      return Promise.resolve({ ok: false, error: 'Demasiados intentos. Espera ' + secs + ' s.' });
    }
    if (!cryptoOk()) {
      return Promise.resolve({ ok: false, error: 'Tu navegador no soporta verificación segura (Web Crypto). Usa HTTPS y un navegador moderno.' });
    }
    if (!u) {
      registerFail(username);
      return Promise.resolve({ ok: false, error: 'Usuario o contraseña incorrectos.' });
    }

    var saltBytes = b64ToBytes(u.saltB64);
    var expected = b64ToBytes(u.hashB64);
    return derive(password || '', saltBytes).then(function (bits) {
      var got = new Uint8Array(bits);
      if (constEq(got, expected)) {
        attempts[username] = { count: 0, until: 0 };
        current = publicUser(u);
        saveSession(u);
        emitChange();
        return { ok: true, user: current };
      }
      registerFail(username);
      return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    }).catch(function () {
      return { ok: false, error: 'Error al verificar credenciales.' };
    });
  }

  function registerFail(username) {
    var st = attempts[username] || { count: 0, until: 0 };
    st.count++;
    if (st.count >= MAX_ATTEMPTS) { st.until = Date.now() + LOCK_MS; st.count = 0; }
    attempts[username] = st;
  }

  function logout() {
    current = null;
    clearSession();
    emitChange();
  }

  function init() {
    current = loadSession();
  }

  return {
    init: init,
    login: login,
    logout: logout,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    can: can,
    isGated: isGated,
    onChange: onChange,
    GATED: GATED
  };
})();


/* ============================================================
   AuthUI — Interfaz: modal de login + cápsula de usuario
   ============================================================ */
window.AuthUI = (function () {
  'use strict';

  var LOGO = 'src/assets/harvin-logo.png';
  var overlay = null;

  function buildOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    overlay.id = 'auth-overlay';
    overlay.innerHTML =
      '<div class="auth-card" role="dialog" aria-modal="true" aria-label="Iniciar sesión">' +
        '<button class="auth-close" id="auth-close" aria-label="Cerrar">×</button>' +
        '<img class="auth-logo" src="' + LOGO + '" alt="Harvin Distribuciones" />' +
        '<div class="auth-title">Iniciar sesión</div>' +
        '<div class="auth-sub">Acceso restringido · FE-1517</div>' +
        '<div class="auth-error" id="auth-error"></div>' +
        '<form id="auth-form" autocomplete="off">' +
          '<div class="auth-field">' +
            '<label for="auth-user">Usuario</label>' +
            '<input id="auth-user" name="auth-user" type="text" autocomplete="username" spellcheck="false" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="auth-pass">Contraseña</label>' +
            '<div class="auth-pass-wrap">' +
              '<input id="auth-pass" name="auth-pass" type="password" autocomplete="current-password" />' +
              '<button type="button" class="auth-pass-toggle" id="auth-pass-toggle" aria-label="Mostrar/ocultar">Ver</button>' +
            '</div>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary auth-submit" id="auth-submit">Entrar</button>' +
        '</form>' +
        '<div class="auth-foot">CEDI Intelligence · Harvin Distribuciones<br/>Las funciones de compra y actualización requieren sesión.</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var form = overlay.querySelector('#auth-form');
    var closeBtn = overlay.querySelector('#auth-close');
    var toggle = overlay.querySelector('#auth-pass-toggle');
    var passEl = overlay.querySelector('#auth-pass');

    toggle.addEventListener('click', function () {
      var t = passEl.type === 'password' ? 'text' : 'password';
      passEl.type = t;
      toggle.textContent = t === 'password' ? 'Ver' : 'Ocultar';
    });
    closeBtn.addEventListener('click', closeLogin);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeLogin(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('open')) closeLogin(); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      doSubmit();
    });
    return overlay;
  }

  function showError(msg) {
    var el = overlay.querySelector('#auth-error');
    el.textContent = msg;
    el.classList.add('show');
  }
  function clearError() {
    var el = overlay.querySelector('#auth-error');
    el.classList.remove('show');
    el.textContent = '';
  }

  function doSubmit() {
    var btn = overlay.querySelector('#auth-submit');
    var user = overlay.querySelector('#auth-user').value;
    var pass = overlay.querySelector('#auth-pass').value;
    clearError();
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    window.Auth.login(user, pass).then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Entrar';
      if (res.ok) {
        var target = overlay.dataset.target || '';
        closeLogin();
        if (target && window.App && window.App.navigate) window.App.navigate(target);
      } else {
        overlay.querySelector('#auth-pass').value = '';
        showError(res.error || 'No se pudo iniciar sesión.');
      }
    });
  }

  function openLogin(targetPage) {
    buildOverlay();
    overlay.dataset.target = targetPage || '';
    clearError();
    overlay.querySelector('#auth-pass').value = '';
    overlay.classList.add('open');
    setTimeout(function () { overlay.querySelector('#auth-user').focus(); }, 50);
  }
  function closeLogin() {
    if (overlay) overlay.classList.remove('open');
  }

  // Cápsula de usuario / botón de login en el sidebar
  function renderUserBox() {
    var box = document.getElementById('user-box');
    if (!box) return;
    var u = window.Auth.getUser();
    if (u) {
      var initial = (u.display || 'U').charAt(0).toUpperCase();
      box.innerHTML =
        '<div class="user-chip">' +
          '<div class="user-avatar">' + initial + '</div>' +
          '<div class="user-meta">' +
            '<div class="user-name">' + u.display + '</div>' +
            '<div class="user-role">' + u.role + '</div>' +
          '</div>' +
        '</div>' +
        '<button class="btn-auth" id="btn-logout"><span class="txt">Cerrar sesión</span></button>';
      box.querySelector('#btn-logout').addEventListener('click', function () {
        window.Auth.logout();
      });
    } else {
      box.innerHTML =
        '<div class="user-chip">' +
          '<div class="user-avatar" style="background:linear-gradient(135deg,#3a3a40,#1a1a1e);box-shadow:none">·</div>' +
          '<div class="user-meta">' +
            '<div class="user-name">Invitado</div>' +
            '<div class="user-role guest">Solo lectura</div>' +
          '</div>' +
        '</div>' +
        '<button class="btn-auth primary" id="btn-login"><span class="txt">Iniciar sesión</span></button>';
      box.querySelector('#btn-login').addEventListener('click', function () { openLogin(''); });
    }
  }

  // Marca los items de navegación bloqueados con un candado
  function refreshNavLocks() {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      var page = btn.dataset.page;
      var lock = btn.querySelector('.nav-lock');
      var needsLock = window.Auth.isGated(page) && !window.Auth.can(page);
      if (needsLock) {
        btn.classList.add('locked');
        if (!lock) {
          lock = document.createElement('span');
          lock.className = 'nav-lock';
          lock.textContent = '🔒';
          btn.appendChild(lock);
        }
      } else {
        btn.classList.remove('locked');
        if (lock) lock.remove();
      }
    });
  }

  function refreshAll() {
    renderUserBox();
    refreshNavLocks();
  }

  return {
    openLogin: openLogin,
    closeLogin: closeLogin,
    renderUserBox: renderUserBox,
    refreshNavLocks: refreshNavLocks,
    refreshAll: refreshAll
  };
})();
