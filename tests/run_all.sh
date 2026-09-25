#!/usr/bin/env bash
# Batería completa del motor de compra y la exportación. Requiere Node ≥18 y `npm i` en esta carpeta.
cd "$(dirname "$0")"
set -e
node t1_regresion_clasico.js
node t2_pulido_equivalencia.js
node t3_unitarias_invariantes.js
node t4_ui_jsdom.js
node t5_export_excel.js
node t6_ui_export.js
node t7_pipeline_clientes.js
rm -rf _out
echo "TODAS LAS PRUEBAS PASARON"
