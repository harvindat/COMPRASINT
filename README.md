# CEDI Intelligence — Sistema de Compra Inteligente
**Harvin Distribuciones · v2.0.0**

Sistema de análisis y compra inteligente para CEDI (Centro de Distribución) de refacciones automotrices. Dashboard ejecutivo de alto nivel con motor de optimización de pedidos, análisis ABC, análisis de clientes ancla, exportación a Excel y actualización periódica de datos desde el navegador.

---

## Características principales

- **Dashboard ejecutivo** — KPIs en tiempo real, cobertura de inventario, artículos en riesgo
- **Compra Inteligente** — Simulador con sliders de presupuesto, lead time, stock de seguridad y cobertura objetivo
- **Análisis ABC** — Clasificación automática por valor de venta con tabla navegable de todo el catálogo
- **Clientes Ancla** — Análisis de los clientes estratégicos que concentran la mayor parte de las ventas
- **Inventario** — Vista completa con filtros por línea, ABC y estado de stock
- **Exportación** — 6 tipos de reportes descargables en Excel (.xlsx)
- **Actualizar Datos** — Carga los 5 reportes Excel nuevos (semanas/meses) directamente en el navegador; el sistema detecta el período automáticamente, recalcula todos los KPIs y permite descargar el nuevo `cedi_data.js`. No requiere Python para la actualización rutinaria.

---

## Período dinámico

El sistema ya no asume un período fijo de 5 meses. Detecta automáticamente el rango real de fechas a partir del archivo de COMPRAS (fecha mínima → fecha de corte) y recalcula la demanda diaria (DPD), demanda mensual (DMD) y todos los KPIs sobre los días reales del período cargado. Al actualizar con nuevos meses, todo se reajusta solo.

---

## Variables del simulador de compra

| Variable | Rango | Descripción |
|----------|-------|-------------|
| Presupuesto semanal | $50K – $1M | Restricción de gasto para el pedido |
| Lead time proveedor | 3 / 5 / 9 / 15 días | Ajusta el factor multiplicador del pedido |
| Días de cobertura objetivo | 7 – 60 días | Meta de días de stock post-pedido |
| Factor stock de seguridad | 0.5× – 2.0× | Multiplica el SS calculado por el modelo |
| Filtro ABC | A / B / C / D | Incluir/excluir categorías del pedido |
| Existencia Vazlo | On / Off | Lee el stock del almacén del proveedor para validar surtido |
| Limitar a stock Vazlo | On / Off | Modo agresivo: topa el pedido al stock del proveedor y reasigna presupuesto |

## Existencia Vazlo (stock del proveedor)

El sistema puede cruzar el pedido sugerido contra la **existencia real del almacén del proveedor** para pedir solo mercancía que sí puede ser surtida.

**Carga del archivo** (`EXISTENCIAVAZLO.xlsx`, formato flexible: detecta columnas de clave y existencia automáticamente):
1. **Actualizar Datos** → casilla opcional "Existencia proveedor (Vazlo)". Al guardar en GitHub, el dato viaja dentro de `cedi_data.js` y queda permanente. Si se actualizan los 5 reportes sin subir un Vazlo nuevo, el dato anterior se **conserva** (carry-over) con aviso de antigüedad.
2. **Compra Inteligente** → carga rápida solo en sesión, sin pasar por el flujo completo.

**Aviso de dato ya cargado:** al entrar a Compra Inteligente con existencia Vazlo ya presente (desde Actualizar Datos, GitHub o una carga previa), aparece un aviso con el nombre del archivo, las claves con stock y la **frescura del dato** (✓ actualizado hoy · hace N días · ⚠ advertencia si supera 7 días o proviene de carry-over), preguntando si se quiere tomar en cuenta el archivo de la última carga, con acciones de un clic: *Sí, calcular contra stock Vazlo*, *Solo informativo* o *No usar ahora*.

**Modos de uso en Compra Inteligente** (selector de 3 opciones; al cambiar de modo, el pedido se **recalcula automáticamente**):
- **No usar existencia Vazlo** — comportamiento clásico.
- **Informativo** — el cálculo no cambia; se agrega la columna *Exist. Vazlo* con semáforo de surtido (● completo · ◐ parcial · ○ sin stock), el filtro de surtido en el detalle del pedido, el *costo surtible* en los totales y estadísticas en el panel de resultados.
- **Calcular contra stock Vazlo (limitado)** — la cantidad a pedir se topa al stock del proveedor y los artículos sin existencia Vazlo salen de la cascada de presupuesto, de modo que **el 100% del pedido resultante es surtible**, el presupuesto se reasigna a lo que el proveedor sí tiene y **el resultado del encabezado varía**.

Al aplicar el filtro de surtido o la búsqueda en el detalle del pedido, los totales del encabezado se recalculan sobre el subconjunto filtrado y se muestra un badge **FILTRADO** con el conteo "X de Y" para que el cambio sea inconfundible.

El export a Excel incluye *Existencia Vazlo*, *Surtido Proveedor* y *Uds Surtibles*, además de los parámetros del modo Vazlo en la hoja de resumen.

### Factores de lead time
| Lead Time | Factor | Efecto |
|-----------|--------|--------|
| 3 días | ×0.85 | Reduce pedido (entrega rápida) |
| 5 días | ×1.00 | Base |
| 9 días | ×1.20 | Incrementa pedido |
| 15 días | ×1.50 | Pedido volumen alto |

### Modelo matemático
```
DPD = Unidades vendidas / días del período (detectado automáticamente)
SS  = 1.65 × (DPD × 0.30) × √(LeadTime) × factorSS
ROP = DPD × LeadTime + SS
Qty = max(0, DPD × diasObjetivo × factorLT + SS - stockActual)
```

### Score de prioridad de compra (0–100)
```
Score = 40% × abcScore + 25% × rotacionNorm + 20% × pctAncla + 15% × coberturaBaja
```

---

## Datos del sistema

| Archivo | Contenido | Período |
|---------|-----------|---------|
| ARTÍCULOS | Catálogo maestro (12,710 SKUs activos) | — |
| EXIVAL | Inventario valorizado al corte (último costo) | 29 May 2026 |
| ROTINV | Rotación del inventario | Ene–May 2026 |
| COMPRAS | Historial de compras (11,854 líneas, 616 pedidos) | Ene–May 2026 |
| VECLIEARTS | Ventas por cliente con detalle de artículos (31 clientes) | Ene–May 2026 |

---

## Estructura del proyecto

```
cedi-intelligence/
├── index.html
├── README.md
├── .gitignore
├── src/
│   ├── app.js                    # Controlador de navegación + API window.App
│   ├── styles/
│   │   └── main.css              # Estilos globales
│   ├── data/
│   │   ├── cedi_data.json        # Datos procesados (gitignored)
│   │   └── cedi_data.js          # Datos como variable global window.CEDI_DATA (gitignored)
│   ├── utils/
│   │   ├── calculations.js       # Motor matemático de compra inteligente
│   │   ├── dataProcessor.js      # Pipeline de procesamiento Excel en navegador (espejo de process_data.py)
│   │   └── formatters.js         # Formateo de moneda, números, período y UI helpers
│   └── components/
│       ├── dashboard.js          # Dashboard ejecutivo
│       ├── compra.js             # Simulador de compra inteligente
│       ├── abc.js                # Análisis ABC
│       ├── clientes.js           # Análisis clientes ancla
│       ├── inventario.js         # Vista de inventario completo
│       ├── exportar.js           # Centro de exportación Excel
│       └── actualizar.js         # Carga y procesamiento de datos nuevos
└── scripts/
    └── process_data.py           # Script Python para reprocesar datos (procesamiento por lotes)
```

---

## Cómo correr el proyecto

### Opción 1 — Sin servidor (recomendado para pruebas locales)
```bash
# Abrir directamente en el navegador
open index.html
# O en Windows
start index.html
```

> **Nota:** Chrome puede bloquear la carga de archivos .js locales por CORS. Si ocurre esto, usar la opción 2.

### Opción 2 — Con servidor local
```bash
# Python 3
python3 -m http.server 8080
# Luego abrir: http://localhost:8080

# Node.js (si tienes npx)
npx serve .
```

### Opción 3 — VS Code Live Server
Instala la extensión **Live Server** y click derecho en `index.html` → "Open with Live Server".

---

## Actualizar datos (semanas / meses nuevos)

Hay dos formas de actualizar el sistema cuando llegan datos nuevos. Ambas producen resultados **idénticos** (validado al centavo).

### Opción A — Desde el navegador (recomendada, sin Python)

1. Exporta los 5 reportes del ERP con el mismo formato de siempre: `ARTICULOS`, `EXIVAL`, `ROTINV`, `COMPRAS`, `VECLIEARTS`.
2. Abre el sistema y ve a la sección **Actualizar Datos** (Alt + 7).
3. Arrastra o selecciona cada archivo en su casilla. Opcionalmente fija una fecha de corte; si la dejas vacía, usa la última fecha de compra.
4. Presiona **Procesar archivos**. El sistema detecta el período automáticamente y muestra una comparativa de KPIs (nuevo vs actual).
5. Elige:
   - **Aplicar en sesión** — actualiza el dashboard al instante (temporal, hasta recargar).
   - **Descargar cedi_data.js** — guarda el archivo para reemplazarlo en `src/data/` y dejar el cambio permanente.

El procesamiento ocurre 100% en el navegador (SheetJS), sin enviar datos a ningún servidor.

### Opción B — Con Python (procesamiento por lotes)

```bash
pip install pandas openpyxl
python3 scripts/process_data.py --data-dir /ruta/a/los/excel --output-dir src/data
```

Esto regenera `src/data/cedi_data.json` y `src/data/cedi_data.js`.

> Ambos pipelines (navegador y Python) comparten exactamente la misma lógica: detección de período dinámico, validación de SKU (acepta claves alfanuméricas como `VKS101`, `V5-894`, `HR-4356R` y descarta filas de totales), clasificación ABC, score de prioridad y cálculo de KPIs.

---

## Dependencias externas (CDN)

| Librería | Versión | Uso |
|----------|---------|-----|
| Chart.js | 4.4.1 | Gráficas y visualizaciones |
| SheetJS (xlsx) | 0.20.3 | Lectura de Excel (actualización) y exportación |
| Google Fonts | DM Sans, DM Mono, Playfair Display | Tipografía |

---

## Métricas del CEDI (período detectado: Ene–May 2026, 149 días)

| Métrica | Valor |
|---------|-------|
| Inventario al corte (s/IVA) | $8,097,384 |
| Inventario al corte (c/IVA) | $9,392,966 |
| Venta total del período | $6,077,661 |
| Venta mensual promedio | $1,240,339 |
| Compras del período | $9,553,662 |
| Cobertura de inventario | 199 días (6.6 meses) |
| Artículos en inventario | 12,691 |
| Artículos activos (con venta) | 5,074 |
| Clientes ancla (top 4) | 59.9% de ventas totales |

> Estas cifras se recalculan automáticamente cada vez que se cargan datos nuevos.

---

## Atajos de teclado

| Atajo | Acción |
|-------|--------|
| Alt + 1 | Dashboard |
| Alt + 2 | Compra Inteligente |
| Alt + 3 | Análisis ABC |
| Alt + 4 | Clientes Ancla |
| Alt + 5 | Inventario |
| Alt + 6 | Exportar |
| Alt + 7 | Actualizar Datos |

---

**Desarrollado:** Mayo 2026  
**Empresa:** Harvin Distribuciones  
**Versión:** 2.0.0 — período dinámico + actualización en navegador
