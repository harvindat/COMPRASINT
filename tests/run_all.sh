#!/usr/bin/env bash
# Corre toda la batería de pruebas del motor de compra. Requiere Node ≥18 y `npm i jsdom@24` en esta carpeta.
cd "$(dirname "$0")"
set -e
node t1_regresion_clasico.js
node t2_pulido_equivalencia.js
node t3_unitarias_invariantes.js
node t4_ui_jsdom.js
echo "TODAS LAS PRUEBAS PASARON"
