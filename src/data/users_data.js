/* ============================================================
   users_data.js — Usuarios administrados · CEDI Intelligence
   ------------------------------------------------------------
   Este archivo lo genera y actualiza el panel "Usuarios"
   (exclusivo del Super Usuario) mediante Guardar en GitHub.
   NO editar a mano salvo emergencia.

   Estructura:
     users   → usuarios agregados por el administrador
               { usuario: { display, role, roleKey, saltB64, hashB64, perms } }
               Solo se guardan derivaciones PBKDF2 (sal + hash),
               NUNCA contraseñas en texto plano.
     removed → usuarios base desactivados (no aplica al super usuario)
   ============================================================ */
window.CEDI_USERS = {
  meta: { actualizado: null, por: null },
  users: {},
  removed: []
};
