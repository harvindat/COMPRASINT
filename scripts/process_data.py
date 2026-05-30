#!/usr/bin/env python3
"""
process_data.py — Pipeline de procesamiento de datos CEDI Intelligence
Harvin Distribuciones · v2.0.0

Genera cedi_data.json y cedi_data.js a partir de los 5 archivos Excel fuente.
El período (días, meses, etiqueta) se calcula DINÁMICAMENTE a partir de las
fechas reales en COMPRAS, de modo que al cargar nuevos meses de data todos los
KPIs y cálculos de demanda se recalculan automáticamente.

Uso:
    python3 scripts/process_data.py --data-dir /ruta/a/archivos
    python3 scripts/process_data.py --data-dir . --output-dir src/data

Archivos esperados (nombres flexibles, ver --map):
    ARTICULOS.xlsx  EXIVAL.xlsx  ROTINV.xlsx  COMPRAS.xlsx  VECLIEARTS.xlsx
"""

import json
import os
import sys
import re
import tempfile
import zipfile
import argparse
import warnings
import datetime as dt
import pandas as pd
import numpy as np

warnings.filterwarnings('ignore')

IVA = 1.16

MESES_ES = {1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr', 5: 'May', 6: 'Jun',
            7: 'Jul', 8: 'Ago', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dic'}


# ────────────────────────────────────────────────────────────
# Lectura robusta de XLSX (parcha XML incompatible con openpyxl)
# ────────────────────────────────────────────────────────────
def patch_xlsx(path):
    files = {}
    with zipfile.ZipFile(path, 'r') as zin:
        for item in zin.namelist():
            with zin.open(item) as f:
                content = f.read()
            if item.endswith('.xml') or item.endswith('.rels'):
                try:
                    text = content.decode('utf-8', errors='replace')
                    for pat in [r'\s+WindowWidth="[^"]*"', r'\s+WindowHeight="[^"]*"',
                                r'\s+xWindow="[^"]*"', r'\s+yWindow="[^"]*"',
                                r'\s+firstPageNo="[^"]*"']:
                        text = re.sub(pat, '', text)
                    files[item] = text.encode('utf-8')
                except Exception:
                    files[item] = content
            else:
                files[item] = content
    tmp = tempfile.mktemp(suffix='.xlsx')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item, content in files.items():
            zout.writestr(item, content)
    df = pd.read_excel(tmp, header=None, engine='openpyxl')
    os.unlink(tmp)
    return df


# ────────────────────────────────────────────────────────────
# Loaders por archivo
# ────────────────────────────────────────────────────────────
RE_SKU = re.compile(r'^[A-Za-z0-9][A-Za-z0-9\-\/. ]*$')


def es_sku(v):
    """True si la celda es un SKU real (alfanumérico) y NO una fila de
    resumen/total que estos reportes intercalan. Acepta claves con prefijo
    alfabético: VKS101, V5-894, HR-4356R, KITBMW1, AM-KIT 1, etc."""
    if v is None:
        return False
    s = str(v).strip()
    if not s:
        return False
    low = s.lower()
    if 'total' in low or 'artículos' in low or 'articulos' in low or 'sin existencia' in low:
        return False
    return bool(RE_SKU.match(s))


def load_articulos(path):
    df = pd.read_excel(path)
    cols = ['clave', 'nombre', 'linea', 'umed', 'ucompra', 'clave_sat',
            'almacenable', 'juego', 'ultima_compra', 'estatus']
    df.columns = cols[:df.shape[1]]
    df['clave'] = df['clave'].astype(str).str.strip()
    df = df[df['clave'].apply(es_sku)].copy()
    return df


def find_col(raw, textos, fallback, max_scan=8):
    """Busca el índice de columna cuyo encabezado (filas 0..max_scan) coincide con
    alguno de los textos. Devuelve fallback si no lo encuentra. Tolera que el
    reporte mueva columnas en exportaciones futuras."""
    want = [t.lower() for t in textos]
    lim = min(max_scan, len(raw))
    for i in range(lim):
        row = raw.iloc[i]
        for j in range(len(row)):
            c = row.iloc[j]
            if pd.isna(c):
                continue
            s = str(c).strip().lower()
            if any(w == s or w in s for w in want):
                return j
    return fallback


def load_exival(path):
    raw = patch_xlsx(path)
    c_exist = find_col(raw, ['Existencia'], 11)
    c_costo = find_col(raw, ['Último costo', 'Ultimo costo'], 13)
    c_valor = find_col(raw, ['Valor total'], 16)
    df = raw.iloc[6:].copy().reset_index(drop=True)
    df.columns = range(df.shape[1])
    df = df[[0, 2, c_exist, c_costo, c_valor]].copy()
    df.columns = ['clave', 'descripcion', 'existencia', 'costo_neto', 'valor_total']
    df = df[df['clave'].apply(es_sku)].copy()
    df['clave'] = df['clave'].astype(str).str.strip()
    df['existencia'] = pd.to_numeric(df['existencia'], errors='coerce').fillna(0)
    df['costo_neto'] = pd.to_numeric(df['costo_neto'], errors='coerce').fillna(0)
    df['costo_iva'] = df['costo_neto'] * IVA
    df['valor_total'] = pd.to_numeric(df['valor_total'], errors='coerce').fillna(0)
    return df


def load_rotinv(path):
    raw = patch_xlsx(path)
    c_sal = find_col(raw, ['Salidas'], 13)
    c_rot = find_col(raw, ['Rotación', 'Rotacion'], 18)
    df = raw.iloc[4:].copy().reset_index(drop=True)
    df.columns = range(df.shape[1])
    df = df[[0, c_sal, c_rot]].copy()
    df.columns = ['clave', 'salidas', 'rotacion']
    df = df[df['clave'].apply(es_sku)].copy()
    df['clave'] = df['clave'].astype(str).str.strip()
    for c in ['salidas', 'rotacion']:
        df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0)
    return df


def load_ventas(path):
    raw = patch_xlsx(path)
    rows = []
    cur_id, cur_nom = None, None
    for idx in range(5, len(raw)):
        row = raw.iloc[idx]
        c0, c3, c4 = row.iloc[0], row.iloc[3], row.iloc[4]
        c14, c16 = row.iloc[14], row.iloc[16]
        s0 = str(c0).strip() if pd.notna(c0) else ''
        s3 = str(c3).strip() if pd.notna(c3) else ''
        s4 = str(c4).strip() if pd.notna(c4) else ''
        if s0.isdigit() and len(s0) > 2 and s3 and pd.isna(c14) and pd.isna(c4):
            cur_id, cur_nom = s0, s3
        elif es_sku(s0) and pd.notna(c14) and s4:
            v = pd.to_numeric(c14, errors='coerce')
            u = pd.to_numeric(c16, errors='coerce')
            if pd.notna(v) and v > 0:
                rows.append({'cliente_id': cur_id, 'cliente_nombre': cur_nom,
                             'clave': s0, 'descripcion': s4,
                             'venta': v, 'unidades': u if pd.notna(u) else 0})
    df = pd.DataFrame(rows)
    df['clave'] = df['clave'].astype(str).str.strip()
    return df


def load_compras(path):
    raw = patch_xlsx(path)
    rows = []
    cur_fecha, cur_folio = None, None
    for idx in range(5, len(raw)):
        row = raw.iloc[idx]
        fecha_val, folio_val = row.iloc[0], row.iloc[1]
        desc_val = row.iloc[3]
        cant_val, costo_val, total_val = row.iloc[12], row.iloc[16], row.iloc[18]
        s_fecha = str(fecha_val)
        if pd.notna(fecha_val) and re.search(r'20\d{2}', s_fecha):
            cur_fecha, cur_folio = fecha_val, folio_val
        elif pd.notna(desc_val) and str(desc_val).strip():
            cant = pd.to_numeric(cant_val, errors='coerce')
            costo = pd.to_numeric(costo_val, errors='coerce')
            total = pd.to_numeric(total_val, errors='coerce')
            if pd.notna(cant) and cant > 0 and pd.notna(costo) and costo > 0:
                rows.append({'fecha': cur_fecha, 'folio': cur_folio,
                             'descripcion': str(desc_val).strip(),
                             'cantidad': cant, 'costo_unit': costo,
                             'costo_total': total if pd.notna(total) else cant * costo})
    df = pd.DataFrame(rows)
    df['fecha'] = pd.to_datetime(df['fecha'], errors='coerce')
    df = df[df['fecha'].notna()].copy()
    df['mes'] = df['fecha'].dt.month
    df['anio'] = df['fecha'].dt.year
    return df


# ────────────────────────────────────────────────────────────
# Cálculo dinámico del período
# ────────────────────────────────────────────────────────────
def calcular_periodo(df_compras, corte=None):
    """Deriva días, meses y etiqueta del período a partir de fechas reales.
    Retorna dict con dias_periodo, num_meses, periodo (label), fecha_inicio, fecha_corte."""
    fmin = df_compras['fecha'].min()
    fmax = df_compras['fecha'].max()
    if corte:
        fmax = pd.to_datetime(corte)
    dias = (fmax - fmin).days + 1
    if dias < 1:
        dias = 1
    num_meses = round(dias / 30.4, 2)
    label = f"{MESES_ES.get(fmin.month, '')}–{MESES_ES.get(fmax.month, '')} {fmax.year}"
    if fmin.year != fmax.year:
        label = f"{MESES_ES.get(fmin.month, '')} {fmin.year}–{MESES_ES.get(fmax.month, '')} {fmax.year}"
    return {
        'dias_periodo': int(dias),
        'num_meses': num_meses,
        'periodo': label,
        'fecha_inicio': fmin.strftime('%Y-%m-%d'),
        'fecha_corte': fmax.strftime('%Y-%m-%d'),
    }


# ────────────────────────────────────────────────────────────
# Procesamiento principal
# ────────────────────────────────────────────────────────────
def process(files, output_dir, corte=None):
    print("Cargando archivos...")
    for name, path in files.items():
        if not os.path.exists(path):
            print(f"  ERROR: No encontrado: {path}")
            sys.exit(1)

    df_art = load_articulos(files['ARTICULOS'])
    print(f"  ARTICULOS: {len(df_art):,} registros")
    df_ex = load_exival(files['EXIVAL'])
    print(f"  EXIVAL: {len(df_ex):,} registros")
    df_rot = load_rotinv(files['ROTINV'])
    print(f"  ROTINV: {len(df_rot):,} registros")
    df_ventas = load_ventas(files['VECLIEARTS'])
    print(f"  VENTAS: {len(df_ventas):,} líneas, {df_ventas['cliente_id'].nunique()} clientes")
    df_compras = load_compras(files['COMPRAS'])
    print(f"  COMPRAS: {len(df_compras):,} líneas")

    # Período dinámico
    periodo = calcular_periodo(df_compras, corte=corte)
    DIAS_PERIODO = periodo['dias_periodo']
    NUM_MESES = periodo['num_meses'] if periodo['num_meses'] > 0 else 1
    print(f"\nPeríodo detectado: {periodo['periodo']} "
          f"({DIAS_PERIODO} días, {NUM_MESES} meses)")

    # Master table
    ventas_art = df_ventas.groupby('clave').agg(
        venta_total=('venta', 'sum'), unidades_total=('unidades', 'sum'),
        num_clientes=('cliente_id', 'nunique')).reset_index()

    master = df_ex.merge(df_rot, on='clave', how='left')
    master = master.merge(df_art[['clave', 'nombre', 'linea']], on='clave', how='left')
    master = master.merge(ventas_art, on='clave', how='left')
    for c in ['salidas', 'inv_promedio', 'rotacion', 'venta_total', 'unidades_total', 'num_clientes']:
        master[c] = pd.to_numeric(master.get(c, 0), errors='coerce').fillna(0)

    # Demanda diaria/mensual basadas en el período REAL
    master['dpd'] = master['unidades_total'] / DIAS_PERIODO
    master['dmd'] = master['unidades_total'] / NUM_MESES

    # Clientes ancla (top 4)
    top4_ids = df_ventas.groupby('cliente_id')['venta'].sum().nlargest(4).index.tolist()
    ventas_ancla = df_ventas[df_ventas['cliente_id'].isin(top4_ids)].groupby('clave').agg(
        venta_ancla=('venta', 'sum')).reset_index()
    master = master.merge(ventas_ancla, on='clave', how='left')
    master['venta_ancla'] = master['venta_ancla'].fillna(0)
    master['pct_ancla'] = np.where(master['venta_total'] > 0,
                                   master['venta_ancla'] / master['venta_total'], 0)

    # ABC por venta
    master_activo = master[master['venta_total'] > 0].copy().sort_values('venta_total', ascending=False)
    total_venta = master_activo['venta_total'].sum()
    master_activo['acum'] = master_activo['venta_total'].cumsum() / total_venta
    master_activo['abc'] = master_activo['acum'].apply(
        lambda x: 'A' if x <= 0.70 else ('B' if x <= 0.90 else 'C'))
    master = master.merge(master_activo[['clave', 'abc']], on='clave', how='left')
    master['abc'] = master['abc'].fillna('D')

    # Score de prioridad
    rot_max = master['rotacion'].quantile(0.95) or 1
    master['rot_norm'] = (master['rotacion'] / rot_max).clip(0, 1)
    master['cobertura_dias'] = np.where(master['dpd'] > 0,
                                        (master['existencia'] / master['dpd']).round(0), 0)
    master['inv_cob_score'] = (1 - (master['cobertura_dias'] / 365).clip(0, 1))
    abc_score = {'A': 1.0, 'B': 0.65, 'C': 0.35, 'D': 0.0}
    master['abc_score'] = master['abc'].map(abc_score)
    master['score_compra'] = (
        0.40 * master['abc_score'] + 0.25 * master['rot_norm'] +
        0.20 * master['pct_ancla'] + 0.15 * master['inv_cob_score']) * 100

    # KPIs
    total_inv = float(master['valor_total'].sum())
    venta_t = float(master['venta_total'].sum())
    compras_t = float(df_compras['costo_total'].sum())
    venta_mensual = venta_t / NUM_MESES
    cobertura = total_inv / (venta_t / DIAS_PERIODO) if venta_t > 0 else 0

    # Métricas de clientes ancla (top 4) — dinámicas
    venta_ancla_total = float(df_ventas[df_ventas['cliente_id'].isin(top4_ids)]['venta'].sum())
    pct_ancla_total = round(venta_ancla_total / venta_t * 100, 1) if venta_t > 0 else 0
    arts_ancla = set(df_ventas[df_ventas['cliente_id'].isin(top4_ids)]['clave'])
    arts_no_ancla = set(df_ventas[~df_ventas['cliente_id'].isin(top4_ids)]['clave'])
    arts_exclusivos_ancla = len(arts_ancla - arts_no_ancla)
    arts_compartidos_ancla = len(arts_ancla & arts_no_ancla)

    kpis = {
        'total_inv': round(total_inv, 2),
        'total_inv_iva': round(total_inv * IVA, 2),
        'venta_5m': round(venta_t, 2),
        'venta_mensual': round(venta_mensual, 2),
        'compras_5m': round(compras_t, 2),
        'cobertura_dias': round(cobertura, 1),
        'total_articulos': int(len(df_art)),
        'arts_con_stock': int((master['existencia'] > 0).sum()),
        'arts_sin_stock': int((master['existencia'] == 0).sum()),
        'arts_con_venta': int((master['venta_total'] > 0).sum()),
        'arts_sin_venta': int((master['venta_total'] == 0).sum()),
        'total_clientes': int(df_ventas['cliente_id'].nunique()),
        'total_pedidos': int(df_compras['folio'].nunique()),
        'total_lineas_compra': int(len(df_compras)),
        'venta_ancla_total': round(venta_ancla_total, 2),
        'pct_ancla_total': pct_ancla_total,
        'num_clientes_ancla': len(top4_ids),
        'arts_exclusivos_ancla': arts_exclusivos_ancla,
        'arts_compartidos_ancla': arts_compartidos_ancla,
    }

    abc_data = master.groupby('abc').agg(arts=('clave', 'count'),
                                         venta=('venta_total', 'sum'),
                                         inv=('valor_total', 'sum')).reset_index()
    abc_list = [{'cat': r['abc'], 'arts': int(r['arts']),
                 'venta': round(r['venta'], 2), 'inv': round(r['inv'], 2)}
                for _, r in abc_data.iterrows()]

    linea_data = master.groupby('linea').agg(
        arts=('clave', 'count'), venta=('venta_total', 'sum'),
        inv=('valor_total', 'sum'), uds=('unidades_total', 'sum')).reset_index().sort_values('venta', ascending=False)
    linea_list = [{'linea': str(r['linea']), 'arts': int(r['arts']),
                   'venta': round(r['venta'], 2), 'inv': round(r['inv'], 2),
                   'uds': round(r['uds'], 0)}
                  for _, r in linea_data.iterrows() if r['venta'] > 0]

    compras_mes = df_compras.groupby(['anio', 'mes'])['costo_total'].sum().reset_index().sort_values(['anio', 'mes'])
    compras_mes_list = [{'mes': MESES_ES.get(int(r['mes']), str(int(r['mes']))),
                         'total': round(r['costo_total'], 2)}
                        for _, r in compras_mes.iterrows()]

    clientes_data = df_ventas.groupby(['cliente_id', 'cliente_nombre']).agg(
        venta=('venta', 'sum'), arts=('clave', 'nunique')).reset_index().sort_values('venta', ascending=False)
    clientes_list = [{'id': r['cliente_id'], 'nombre': str(r['cliente_nombre']),
                      'venta': round(r['venta'], 2), 'arts': int(r['arts']),
                      'pct': round(r['venta'] / venta_t * 100, 1) if venta_t else 0,
                      'ancla': r['cliente_id'] in top4_ids}
                     for _, r in clientes_data.iterrows()]

    cols_out = ['clave', 'descripcion', 'linea', 'existencia', 'costo_neto', 'costo_iva',
                'valor_total', 'salidas', 'rotacion', 'dpd', 'dmd', 'venta_total',
                'unidades_total', 'num_clientes', 'venta_ancla', 'pct_ancla', 'abc',
                'score_compra', 'cobertura_dias']
    mc = master[cols_out].copy()
    for c in ['existencia', 'salidas', 'rotacion', 'dpd', 'dmd', 'venta_total',
              'unidades_total', 'num_clientes', 'venta_ancla', 'pct_ancla',
              'score_compra', 'cobertura_dias', 'costo_neto', 'costo_iva', 'valor_total']:
        mc[c] = pd.to_numeric(mc[c], errors='coerce').fillna(0).round(4)
    mc['linea'] = mc['linea'].fillna('SIN LÍNEA')
    mc['descripcion'] = mc['descripcion'].fillna('')
    mc['dias_cobertura'] = mc['cobertura_dias']
    arts_list = mc.drop(columns=['cobertura_dias']).to_dict(orient='records')

    riesgo = mc[(mc['dpd'] > 0) & (mc['cobertura_dias'] < 14) &
                (mc['abc'].isin(['A', 'B']))].nlargest(30, 'score_compra')
    riesgo_list = riesgo[['clave', 'descripcion', 'linea', 'existencia', 'dias_cobertura',
                          'abc', 'score_compra', 'dpd', 'costo_iva']].to_dict(orient='records')

    top50 = mc[mc['venta_total'] > 0].nlargest(50, 'venta_total')[
        ['clave', 'descripcion', 'linea', 'existencia', 'costo_iva', 'venta_total',
         'unidades_total', 'rotacion', 'abc', 'score_compra', 'dias_cobertura', 'dpd']
    ].to_dict(orient='records')

    meta = {
        'generado': dt.datetime.now().strftime('%Y-%m-%d'),
        'empresa': 'HARVIN DISTRIBUCIONES',
        'version_pipeline': '2.0.0',
        **periodo,
    }

    data = {
        'meta': meta, 'kpis': kpis, 'abc': abc_list, 'lineas': linea_list,
        'compras_mes': compras_mes_list, 'clientes': clientes_list,
        'top50_articulos': top50, 'riesgo': riesgo_list,
        'articulos': arts_list, 'top4_ids': top4_ids
    }

    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, 'cedi_data.json')
    js_path = os.path.join(output_dir, 'cedi_data.js')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('window.CEDI_DATA = ')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';')

    print(f"\nGenerado: {json_path} ({os.path.getsize(json_path) / 1e6:.2f} MB)")
    print(f"Generado: {js_path} ({os.path.getsize(js_path) / 1e6:.2f} MB)")
    print(f"Artículos: {len(arts_list):,} · Clientes: {len(clientes_list)} · "
          f"En riesgo: {len(riesgo_list)}")
    print("¡Proceso completado!")
    return data


def resolver_archivos(data_dir):
    """Busca los 5 archivos por nombre flexible (case-insensitive, con prefijos)."""
    patrones = {
        'ARTICULOS': ['articulo'], 'EXIVAL': ['exival', 'existencia'],
        'ROTINV': ['rotinv', 'rotacion'], 'COMPRAS': ['compra'],
        'VECLIEARTS': ['veclie', 'venta'],
    }
    encontrados = {}
    archivos = [f for f in os.listdir(data_dir) if f.lower().endswith(('.xlsx', '.xls'))]
    for key, pats in patrones.items():
        for f in archivos:
            if any(p in f.lower() for p in pats):
                encontrados[key] = os.path.join(data_dir, f)
                break
    return encontrados


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Procesa archivos Excel del CEDI (período dinámico)')
    parser.add_argument('--data-dir', default='.', help='Directorio con archivos Excel fuente')
    parser.add_argument('--output-dir', default='src/data', help='Directorio de salida JSON/JS')
    parser.add_argument('--corte', default=None, help='Fecha de corte YYYY-MM-DD (opcional)')
    args = parser.parse_args()

    files = resolver_archivos(args.data_dir)
    requeridos = ['ARTICULOS', 'EXIVAL', 'ROTINV', 'COMPRAS', 'VECLIEARTS']
    faltan = [r for r in requeridos if r not in files]
    if faltan:
        print(f"ERROR: No se encontraron archivos para: {', '.join(faltan)}")
        print(f"Archivos en {args.data_dir}: {os.listdir(args.data_dir)}")
        sys.exit(1)

    process(files, args.output_dir, corte=args.corte)
