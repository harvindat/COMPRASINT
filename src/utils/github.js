/* ============================================================
   github.js — Guardado directo en GitHub (API Contents)
   CEDI Intelligence · Harvin Distribuciones
   ------------------------------------------------------------
   Hace commit del nuevo cedi_data.js directamente al repositorio
   usando un Personal Access Token que el USUARIO pega en el
   momento. El token:
     · NUNCA se guarda en el código ni en el repositorio.
     · NUNCA se escribe en disco, localStorage ni sessionStorage.
     · Vive solo en memoria durante la llamada y se descarta.
   Por eso el sitio no queda expuesto: la credencial es del
   usuario final y desaparece al recargar la página.

   Recomendación de token (mínimo privilegio):
     · Fine-grained token, acotado SOLO a este repositorio.
     · Permiso: "Contents" → Read and write. Nada más.
   ============================================================ */

window.GitHubSync = (function () {
  'use strict';

  // Configuración del destino (ajústala si cambias de repo/rama).
  var CONFIG = {
    owner: 'harvindat',
    repo: 'COMPRASINT',
    branch: 'main',
    path: 'src/data/cedi_data.js'
  };

  function getConfig() { return Object.assign({}, CONFIG); }
  function setConfig(c) { CONFIG = Object.assign({}, CONFIG, c || {}); }

  // Codifica texto UTF-8 a base64 (lo que exige la API de GitHub).
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function apiBase() {
    return 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + CONFIG.path;
  }

  function headers(token) {
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  // Obtiene el SHA actual del archivo (necesario para sobrescribir).
  function getCurrentSha(token) {
    var url = apiBase() + '?ref=' + encodeURIComponent(CONFIG.branch);
    return fetch(url, { headers: headers(token) }).then(function (res) {
      if (res.status === 200) {
        return res.json().then(function (j) { return j.sha; });
      }
      if (res.status === 404) { return null; } // el archivo no existe aún
      if (res.status === 401) { throw new Error('Token inválido o sin autorización (401). Verifica el token.'); }
      if (res.status === 403) { throw new Error('Acceso prohibido (403). El token no tiene permiso de "Contents" sobre este repositorio o se agotó el límite de la API.'); }
      return res.text().then(function (t) { throw new Error('No se pudo leer el archivo actual (' + res.status + '). ' + t.slice(0, 200)); });
    });
  }

  /*
    commit(token, contenido, mensaje)
      token     : PAT del usuario (solo en memoria)
      contenido : string completo del nuevo cedi_data.js
      mensaje   : mensaje de commit
    Devuelve Promise<{ ok, commitUrl, sha, error }>
  */
  function commit(token, contenido, mensaje) {
    token = (token || '').trim();
    if (!token) return Promise.resolve({ ok: false, error: 'Falta el token de GitHub.' });
    if (!contenido) return Promise.resolve({ ok: false, error: 'No hay datos procesados para guardar.' });

    return getCurrentSha(token).then(function (sha) {
      var body = {
        message: mensaje || ('Actualizar cedi_data.js — ' + new Date().toISOString()),
        content: utf8ToB64(contenido),
        branch: CONFIG.branch
      };
      if (sha) body.sha = sha; // si existe, lo sobrescribimos

      return fetch(apiBase(), {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers(token)),
        body: JSON.stringify(body)
      });
    }).then(function (res) {
      if (res.status === 200 || res.status === 201) {
        return res.json().then(function (j) {
          return {
            ok: true,
            commitUrl: (j.commit && j.commit.html_url) || '',
            sha: (j.content && j.content.sha) || ''
          };
        });
      }
      if (res.status === 401) return { ok: false, error: 'Token inválido o expirado (401).' };
      if (res.status === 403) return { ok: false, error: 'El token no tiene permiso de escritura sobre este repositorio (403).' };
      if (res.status === 409) return { ok: false, error: 'Conflicto (409): el archivo cambió en el repositorio. Reintenta.' };
      if (res.status === 422) return { ok: false, error: 'Datos rechazados por GitHub (422). Revisa la rama y la ruta del archivo.' };
      return res.text().then(function (t) { return { ok: false, error: 'Error al guardar (' + res.status + '). ' + t.slice(0, 200) }; });
    }).catch(function (e) {
      return { ok: false, error: e.message || 'Error de red al contactar con GitHub.' };
    });
  }

  return { commit: commit, getConfig: getConfig, setConfig: setConfig };
})();
