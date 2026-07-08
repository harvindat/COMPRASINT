/* ============================================================
   usuarios.js — Panel de Administración de Usuarios
   CEDI Intelligence · Harvin Distribuciones
   ------------------------------------------------------------
   EXCLUSIVO del Super Usuario (b3t0). Permite:
     · Agregar usuarios (Operador o Super Usuario)
     · Eliminar / desactivar usuarios y restaurar los base
     · Restablecer contraseñas
   Las contraseñas NUNCA se guardan en texto plano: se derivan con
   PBKDF2 (Auth.hashPassword) y solo viajan sal + hash dentro de
   src/data/users_data.js, que puede guardarse en GitHub para que
   el cambio sea permanente en todos los equipos.

   El usuario base b3t0 es INMUTABLE: no puede eliminarse, degradarse
   ni sobrescribirse desde este panel (blindaje en auth.js).
   ============================================================ */

window.PageUsuarios = (function () {
  'use strict';

  var USERS_PATH = 'src/data/users_data.js';
  var baseline = null;   // snapshot al entrar, para "Descartar cambios"
  var dirtyGit = false;  // hay cambios aplicados en sesión sin guardar en GitHub

  function cloneDyn(src) {
    var d = src || window.CEDI_USERS || {};
    return JSON.parse(JSON.stringify({
      meta: d.meta || { actualizado: null, por: null },
      users: d.users || {},
      removed: Array.isArray(d.removed) ? d.removed : []
    }));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ─── Render principal ─────────────────────────────────── */
  function render() {
    var page = document.getElementById('page-usuarios');
    if (!page) return;

    // Doble candado: además del gate de app.js, el panel se niega a
    // renderizarse si la sesión no es de Super Usuario.
    if (!window.Auth || !window.Auth.isSuper()) {
      page.innerHTML =
        '<div class="locked-panel">' +
          '<div class="lp-icon">⛔</div>' +
          '<div class="lp-title">Panel exclusivo del Super Usuario</div>' +
          '<div class="lp-text">La administración de usuarios solo está disponible para la cuenta <strong>b3t0</strong>.</div>' +
        '</div>';
      return;
    }

    if (!baseline) baseline = cloneDyn();

    page.innerHTML =
      '<div class="page-header">' +
        '<div class="page-title">Usuarios</div>' +
        '<div class="page-sub">Administración de cuentas · panel exclusivo del Super Usuario</div>' +
      '</div>' +

      '<div id="usuarios-banner"></div>' +

      '<div class="card mb-16" style="border-left:3px solid var(--c-accent)">' +
        '<div class="card-title">Cómo funciona</div>' +
        '<div style="font-size:13px;color:var(--c-text2);line-height:1.7">' +
          '<p>Los cambios (agregar, eliminar, restablecer contraseña) se aplican <strong>de inmediato en esta sesión</strong>. ' +
          'Para que apliquen en todos los equipos y sobrevivan a recargas, usa <strong>Guardar en GitHub</strong>: se hace commit de ' +
          '<code>' + USERS_PATH + '</code> con las cuentas administradas.</p>' +
          '<p class="mt-4">Las contraseñas nunca se guardan ni viajan en texto plano — solo derivaciones PBKDF2 (sal + hash), igual que las cuentas base. ' +
          'La cuenta <strong>b3t0</strong> está blindada: no puede eliminarse ni modificarse desde aquí.</p>' +
        '</div>' +
      '</div>' +

      '<div class="section-row cols-2" style="margin-bottom:16px;align-items:start">' +
        '<div class="card">' +
          '<div class="card-title">Cuentas del sistema</div>' +
          '<div id="usuarios-tabla"></div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">＋ Agregar usuario</div>' +
          '<div class="auth-error" id="nuevo-error"></div>' +
          '<div class="auth-field">' +
            '<label for="nu-user">Usuario (para iniciar sesión)</label>' +
            '<input id="nu-user" type="text" autocomplete="off" spellcheck="false" placeholder="ej. carlos" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="nu-display">Nombre para mostrar</label>' +
            '<input id="nu-display" type="text" autocomplete="off" placeholder="ej. Carlos" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="nu-role">Rol</label>' +
            '<select id="nu-role" style="width:100%">' +
              '<option value="operador" selected>Operador (todo excepto Usuarios)</option>' +
              '<option value="super">Super Usuario (acceso total, incluye este panel)</option>' +
            '</select>' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="nu-pass">Contraseña (mínimo 8 caracteres)</label>' +
            '<div class="auth-pass-wrap">' +
              '<input id="nu-pass" type="password" autocomplete="new-password" />' +
              '<button type="button" class="auth-pass-toggle" id="nu-pass-toggle">Ver</button>' +
            '</div>' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="nu-pass2">Confirmar contraseña</label>' +
            '<input id="nu-pass2" type="password" autocomplete="new-password" />' +
          '</div>' +
          '<button class="btn btn-primary" id="btn-agregar" style="width:100%">＋ Agregar usuario</button>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title">Persistencia</div>' +
        '<div style="font-size:13px;color:var(--c-text2);line-height:1.6;margin-bottom:14px">' +
          '<strong>Guardar en GitHub:</strong> hace commit de <code>' + USERS_PATH + '</code> con las cuentas administradas (permanente en todos los equipos).<br>' +
          '<strong>Descargar users_data.js:</strong> guarda el archivo para reemplazarlo manualmente.<br>' +
          '<strong>Descartar cambios:</strong> vuelve al estado que tenía el archivo al entrar a este panel.' +
        '</div>' +
        '<div class="btn-row" style="margin-bottom:0">' +
          '<button class="btn btn-primary" id="btn-users-github">⬆ Guardar en GitHub</button>' +
          '<button class="btn btn-outline" id="btn-users-descargar">↓ Descargar users_data.js</button>' +
          '<button class="btn btn-outline" id="btn-users-descartar">Descartar cambios</button>' +
        '</div>' +
      '</div>';

    renderTabla();
    renderBanner();
    attachEvents();
  }

  /* ─── Tabla de cuentas ─────────────────────────────────── */
  function renderTabla() {
    var cont = document.getElementById('usuarios-tabla');
    if (!cont) return;
    var lista = window.Auth.listUsers();

    var rows = lista.map(function (u) {
      var roleBadge = u.roleKey === 'super'
        ? '<span class="badge" style="background:rgba(218,54,51,0.15);color:var(--c-accent);font-weight:700">SUPER</span>'
        : '<span class="badge" style="background:rgba(255,255,255,0.06);color:var(--c-text2)">Operador</span>';
      var origen = u.origen === 'agregado' ? 'Agregado' : (u.origen === 'base+reset' ? 'Base · contraseña restablecida' : 'Base');
      var estado = u.activo
        ? '<span style="color:var(--c-green)">● Activo</span>'
        : '<span style="color:var(--c-text3)">○ Desactivado</span>';
      var tags = '';
      if (u.protegido) tags += ' <span style="font-size:10px;color:var(--c-text3);border:1px solid var(--c-border);border-radius:4px;padding:1px 5px">🔒 protegido</span>';
      if (u.esSesion) tags += ' <span style="font-size:10px;color:var(--c-green);border:1px solid var(--c-green);border-radius:4px;padding:1px 5px">tu sesión</span>';

      var acciones = '';
      if (u.protegido) {
        acciones = '<span style="font-size:11px;color:var(--c-text3)">Inmutable</span>';
      } else if (!u.activo) {
        acciones = '<button class="btn btn-outline btn-sm" data-accion="restaurar" data-user="' + esc(u.username) + '">↺ Restaurar</button>';
      } else {
        acciones =
          '<button class="btn btn-outline btn-sm" data-accion="reset" data-user="' + esc(u.username) + '" style="margin-right:6px">⚿ Contraseña</button>' +
          (u.esSesion
            ? '<span style="font-size:11px;color:var(--c-text3)" title="No puedes eliminar tu propia sesión">—</span>'
            : '<button class="btn btn-outline btn-sm" data-accion="eliminar" data-user="' + esc(u.username) + '" style="color:var(--c-red);border-color:var(--c-red)">✕ Eliminar</button>');
      }

      return '<tr' + (u.activo ? '' : ' style="opacity:0.55"') + '>' +
        '<td class="clave">' + esc(u.username) + tags + '</td>' +
        '<td>' + esc(u.display) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="font-size:11px;color:var(--c-text3)">' + origen + '</td>' +
        '<td>' + estado + '</td>' +
        '<td class="right">' + acciones + '</td>' +
      '</tr>';
    }).join('');

    cont.innerHTML =
      '<div class="tbl-wrap"><table class="data-table">' +
        '<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Origen</th><th>Estado</th><th class="right">Acciones</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<div id="reset-inline"></div>';

    cont.querySelectorAll('button[data-accion]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var user = btn.dataset.user, accion = btn.dataset.accion;
        if (accion === 'eliminar') eliminarUsuario(user);
        else if (accion === 'restaurar') restaurarUsuario(user);
        else if (accion === 'reset') abrirResetInline(user);
      });
    });
  }

  /* ─── Banner de cambios sin guardar ────────────────────── */
  function renderBanner() {
    var el = document.getElementById('usuarios-banner');
    if (!el) return;
    el.innerHTML = dirtyGit
      ? '<div class="card mb-16" style="border-left:3px solid #d9a441">' +
          '<div style="font-size:13px;color:var(--c-text2)">⚠ Hay cambios aplicados <strong>solo en esta sesión</strong>. ' +
          'Si recargas la página se perderán. Usa <strong>Guardar en GitHub</strong> para hacerlos permanentes.</div>' +
        '</div>'
      : '';
  }

  function marcarCambio() {
    dirtyGit = true;
    window.CEDI_USERS.meta = window.CEDI_USERS.meta || {};
    window.CEDI_USERS.meta.actualizado = new Date().toISOString().slice(0, 10);
    window.CEDI_USERS.meta.por = (window.Auth.getUser() || {}).username || null;
    window.Auth.refreshUsers();
    renderTabla();
    renderBanner();
  }

  /* ─── Operaciones ──────────────────────────────────────── */
  function mostrarError(msg) {
    var el = document.getElementById('nuevo-error');
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }
  function limpiarError() {
    var el = document.getElementById('nuevo-error');
    if (el) { el.classList.remove('show'); el.textContent = ''; }
  }

  function agregarUsuario() {
    limpiarError();
    var userEl = document.getElementById('nu-user');
    var username = (userEl.value || '').trim().toLowerCase();
    var display = (document.getElementById('nu-display').value || '').trim() || username;
    var roleKey = document.getElementById('nu-role').value === 'super' ? 'super' : 'operador';
    var pass = document.getElementById('nu-pass').value;
    var pass2 = document.getElementById('nu-pass2').value;

    if (!/^[a-z0-9._-]{3,20}$/.test(username)) return mostrarError('Usuario inválido: 3–20 caracteres, solo minúsculas, números, punto, guion o guion bajo.');
    if (username === 'b3t0') return mostrarError('Ese nombre está reservado para el Super Usuario base.');
    var existentes = window.Auth.listUsers();
    for (var i = 0; i < existentes.length; i++) {
      if (existentes[i].username === username) return mostrarError('El usuario "' + username + '" ya existe' + (existentes[i].activo ? '.' : ' (está desactivado — restáuralo desde la tabla).'));
    }
    if (!pass || pass.length < 8) return mostrarError('La contraseña debe tener al menos 8 caracteres.');
    if (pass !== pass2) return mostrarError('Las contraseñas no coinciden.');

    var btn = document.getElementById('btn-agregar');
    btn.disabled = true; btn.textContent = '⏳ Generando credenciales…';

    window.Auth.hashPassword(pass).then(function (h) {
      window.CEDI_USERS.users = window.CEDI_USERS.users || {};
      window.CEDI_USERS.users[username] = {
        display: display,
        role: roleKey === 'super' ? 'Super Usuario' : 'Operador',
        roleKey: roleKey,
        saltB64: h.saltB64,
        hashB64: h.hashB64,
        perms: roleKey === 'super' ? ['*'] : window.Auth.PERMS_OPERADOR.slice()
      };
      // Si estaba en la lista de desactivados por algún motivo, sacarlo
      var idx = (window.CEDI_USERS.removed || []).indexOf(username);
      if (idx !== -1) window.CEDI_USERS.removed.splice(idx, 1);

      ['nu-user', 'nu-display', 'nu-pass', 'nu-pass2'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('nu-role').value = 'operador';
      marcarCambio();
    }).catch(function (e) {
      mostrarError(e.message || 'No se pudieron generar las credenciales.');
    }).finally(function () {
      btn.disabled = false; btn.textContent = '＋ Agregar usuario';
    });
  }

  function eliminarUsuario(username) {
    var sesion = (window.Auth.getUser() || {}).username;
    if (username === sesion) { alert('No puedes eliminar tu propia sesión.'); return; }
    if (!confirm('¿Eliminar al usuario "' + username + '"?\n\nPerderá el acceso al sistema. Si es una cuenta base podrás restaurarla después; si fue agregada desde este panel, se borra definitivamente.')) return;

    var d = window.CEDI_USERS;
    if (d.users && d.users[username]) {
      // Usuario agregado (o base con contraseña restablecida): quitar el registro dinámico
      delete d.users[username];
    }
    // Si además es cuenta base, desactivarla vía "removed"
    var esBase = window.Auth.listUsers().some(function (u) { return u.username === username; });
    if (esBase) {
      d.removed = d.removed || [];
      if (d.removed.indexOf(username) === -1) d.removed.push(username);
    }
    marcarCambio();
  }

  function restaurarUsuario(username) {
    var d = window.CEDI_USERS;
    var idx = (d.removed || []).indexOf(username);
    if (idx !== -1) d.removed.splice(idx, 1);
    marcarCambio();
  }

  /* Restablecer contraseña con formulario inline bajo la tabla */
  function abrirResetInline(username) {
    var wrap = document.getElementById('reset-inline');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="card" style="margin-top:12px;border-left:3px solid var(--c-accent)">' +
        '<div class="card-title">⚿ Restablecer contraseña de <span class="mono">' + esc(username) + '</span></div>' +
        '<div class="auth-error" id="reset-error"></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
          '<div class="auth-field" style="flex:1;min-width:180px;margin-bottom:0">' +
            '<label for="rs-pass">Nueva contraseña (mín. 8)</label>' +
            '<input id="rs-pass" type="password" autocomplete="new-password" />' +
          '</div>' +
          '<div class="auth-field" style="flex:1;min-width:180px;margin-bottom:0">' +
            '<label for="rs-pass2">Confirmar</label>' +
            '<input id="rs-pass2" type="password" autocomplete="new-password" />' +
          '</div>' +
          '<button class="btn btn-primary btn-sm" id="rs-aplicar">Restablecer</button>' +
          '<button class="btn btn-outline btn-sm" id="rs-cancelar">Cancelar</button>' +
        '</div>' +
      '</div>';

    document.getElementById('rs-cancelar').addEventListener('click', function () { wrap.innerHTML = ''; });
    document.getElementById('rs-aplicar').addEventListener('click', function () {
      var err = document.getElementById('reset-error');
      err.classList.remove('show'); err.textContent = '';
      var p1 = document.getElementById('rs-pass').value;
      var p2 = document.getElementById('rs-pass2').value;
      if (!p1 || p1.length < 8) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.classList.add('show'); return; }
      if (p1 !== p2) { err.textContent = 'Las contraseñas no coinciden.'; err.classList.add('show'); return; }

      var btn = document.getElementById('rs-aplicar');
      btn.disabled = true; btn.textContent = '⏳…';
      // Conservar rol y permisos actuales del usuario
      var actual = window.Auth.listUsers().filter(function (u) { return u.username === username; })[0] || {};
      window.Auth.hashPassword(p1).then(function (h) {
        window.CEDI_USERS.users = window.CEDI_USERS.users || {};
        window.CEDI_USERS.users[username] = {
          display: actual.display || username,
          role: actual.role || 'Operador',
          roleKey: actual.roleKey === 'super' ? 'super' : 'operador',
          saltB64: h.saltB64,
          hashB64: h.hashB64,
          perms: actual.roleKey === 'super' ? ['*'] : window.Auth.PERMS_OPERADOR.slice()
        };
        wrap.innerHTML = '';
        marcarCambio();
      }).catch(function (e) {
        err.textContent = e.message || 'No se pudo restablecer.'; err.classList.add('show');
        btn.disabled = false; btn.textContent = 'Restablecer';
      });
    });
  }

  /* ─── Persistencia: users_data.js ──────────────────────── */
  function generarContenidoUsers() {
    var d = cloneDyn();
    var header =
      '/* ============================================================\n' +
      '   users_data.js — Usuarios administrados · CEDI Intelligence\n' +
      '   ------------------------------------------------------------\n' +
      '   Generado por el panel "Usuarios" (Super Usuario).\n' +
      '   Solo contiene derivaciones PBKDF2 (sal + hash), NUNCA\n' +
      '   contraseñas en texto plano. NO editar a mano salvo emergencia.\n' +
      '   Actualizado: ' + (d.meta.actualizado || '—') + ' · por: ' + (d.meta.por || '—') + '\n' +
      '   ============================================================ */\n';
    return header + 'window.CEDI_USERS = ' + JSON.stringify(d, null, 2) + ';\n';
  }

  function descargarUsers() {
    var blob = new Blob([generarContenidoUsers()], { type: 'application/javascript' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'users_data.js';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function descartarCambios() {
    if (!dirtyGit) { alert('No hay cambios pendientes.'); return; }
    if (!confirm('¿Descartar todos los cambios de usuarios de esta sesión y volver al estado inicial?')) return;
    window.CEDI_USERS = cloneDyn(baseline);
    dirtyGit = false;
    window.Auth.refreshUsers();
    renderTabla();
    renderBanner();
  }

  /* Modal de GitHub (mismo patrón que Actualizar Datos: token de un
     solo uso, nunca se almacena) apuntando a users_data.js */
  function abrirModalGitHubUsers() {
    var cfg = window.GitHubSync.getConfig();
    var modal = document.getElementById('gh-users-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.className = 'auth-overlay open';
    modal.id = 'gh-users-modal';
    modal.innerHTML =
      '<div class="auth-card" role="dialog" aria-modal="true" aria-label="Guardar usuarios en GitHub" style="max-width:420px">' +
        '<button class="auth-close" id="ghu-close" aria-label="Cerrar">×</button>' +
        '<div class="auth-title">⬆ Guardar usuarios en GitHub</div>' +
        '<div class="auth-sub">' + cfg.owner + '/' + cfg.repo + ' · ' + cfg.branch + ' · ' + USERS_PATH + '</div>' +
        '<div class="auth-error" id="ghu-error"></div>' +
        '<div id="ghu-success" style="display:none"></div>' +
        '<div id="ghu-form-wrap">' +
          '<div style="font-size:12px;color:var(--c-text2);line-height:1.6;margin-bottom:14px">' +
            'Pega tu <strong>Personal Access Token</strong> de GitHub. Se usa solo para este commit y <strong>no se guarda</strong> en ningún lado.' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="ghu-token">Token de GitHub</label>' +
            '<div class="auth-pass-wrap">' +
              '<input id="ghu-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_… o ghp_…" />' +
              '<button type="button" class="auth-pass-toggle" id="ghu-token-toggle">Ver</button>' +
            '</div>' +
          '</div>' +
          '<div class="auth-field">' +
            '<label for="ghu-msg">Mensaje de commit (opcional)</label>' +
            '<input id="ghu-msg" type="text" value="Administrar usuarios · ' + new Date().toISOString().slice(0, 10) + '" />' +
          '</div>' +
          '<button class="btn btn-primary auth-submit" id="ghu-submit">Guardar en el repositorio</button>' +
        '</div>' +
        '<div class="auth-foot">El token no se almacena. Desaparece al cerrar esta ventana o recargar.</div>' +
      '</div>';
    document.body.appendChild(modal);

    var close = function () { try { modal.remove(); } catch (e) {} };
    modal.querySelector('#ghu-close').addEventListener('click', close);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });

    var tokenEl = modal.querySelector('#ghu-token');
    var toggle = modal.querySelector('#ghu-token-toggle');
    toggle.addEventListener('click', function () {
      var t = tokenEl.type === 'password' ? 'text' : 'password';
      tokenEl.type = t;
      toggle.textContent = t === 'password' ? 'Ver' : 'Ocultar';
    });

    var submit = function () {
      var errEl = modal.querySelector('#ghu-error');
      var btn = modal.querySelector('#ghu-submit');
      var token = tokenEl.value;
      errEl.classList.remove('show'); errEl.textContent = '';
      if (!token || !token.trim()) { errEl.textContent = 'Ingresa tu token de GitHub.'; errEl.classList.add('show'); return; }
      btn.disabled = true; btn.textContent = 'Guardando…';

      window.GitHubSync.commitFile(token, USERS_PATH, generarContenidoUsers(), modal.querySelector('#ghu-msg').value).then(function (res) {
        token = null; tokenEl.value = '';
        if (res.ok) {
          dirtyGit = false;
          baseline = cloneDyn(); // el nuevo estado es ahora el punto de partida
          renderBanner();
          modal.querySelector('#ghu-form-wrap').style.display = 'none';
          var ok = modal.querySelector('#ghu-success');
          ok.style.display = 'block';
          ok.innerHTML =
            '<div style="text-align:center;padding:6px 0 4px">' +
              '<div style="font-size:40px;color:var(--c-green)">✓</div>' +
              '<div style="font-family:var(--font-display);font-size:18px;color:var(--c-text);margin-top:8px;font-weight:700">Usuarios guardados en GitHub</div>' +
              '<div style="font-size:12px;color:var(--c-text2);margin-top:8px;line-height:1.6">Los cambios aplicarán en todos los equipos en cuanto GitHub Pages publique el commit (1–2 min).</div>' +
              (res.commitUrl ? '<a href="' + res.commitUrl + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="margin-top:14px">Ver commit en GitHub →</a>' : '') +
            '</div>';
        } else {
          errEl.textContent = res.error || 'No se pudo guardar.';
          errEl.classList.add('show');
          btn.disabled = false; btn.textContent = 'Guardar en el repositorio';
        }
      });
    };
    modal.querySelector('#ghu-submit').addEventListener('click', submit);
    tokenEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    setTimeout(function () { tokenEl.focus(); }, 50);
  }

  /* ─── Eventos ──────────────────────────────────────────── */
  function attachEvents() {
    var btnAdd = document.getElementById('btn-agregar');
    if (btnAdd) btnAdd.addEventListener('click', agregarUsuario);

    var toggle = document.getElementById('nu-pass-toggle');
    if (toggle) toggle.addEventListener('click', function () {
      var el = document.getElementById('nu-pass');
      var t = el.type === 'password' ? 'text' : 'password';
      el.type = t;
      toggle.textContent = t === 'password' ? 'Ver' : 'Ocultar';
    });

    var btnGh = document.getElementById('btn-users-github');
    if (btnGh) btnGh.addEventListener('click', abrirModalGitHubUsers);
    var btnDl = document.getElementById('btn-users-descargar');
    if (btnDl) btnDl.addEventListener('click', descargarUsers);
    var btnDx = document.getElementById('btn-users-descartar');
    if (btnDx) btnDx.addEventListener('click', descartarCambios);
  }

  return { render: render };
})();
