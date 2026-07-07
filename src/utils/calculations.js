/* ============================================================
   calculations.js — Motor de Compra Inteligente
   CEDI Intelligence · Harvin Distribuciones
   ============================================================ */

window.CALC = (function() {

  const IVA = 1.16;

  /* DIAS_PERIODO ahora es dinámico: se toma de los metadatos del dataset
     cargado (meta.dias_periodo). Si no existe, usa 150 (5 meses) como fallback.
     Esto permite que al cargar nuevos meses de data los cálculos de demanda
     diaria/mensual se recalculen automáticamente. */
  function diasPeriodo() {
    try {
      if (window.CEDI_DATA && window.CEDI_DATA.meta && window.CEDI_DATA.meta.dias_periodo) {
        return window.CEDI_DATA.meta.dias_periodo;
      }
    } catch (e) {}
    return 150;
  }

  function numMeses() {
    try {
      if (window.CEDI_DATA && window.CEDI_DATA.meta && window.CEDI_DATA.meta.num_meses) {
        return window.CEDI_DATA.meta.num_meses;
      }
    } catch (e) {}
    return 5;
  }

  /* ─── FACTOR DE LEAD TIME ─────────────────────────────── */
  function factorLeadTime(dias) {
    if (dias <= 3)  return 0.85;
    if (dias <= 5)  return 1.00;
    if (dias <= 9)  return 1.20;
    if (dias <= 15) return 1.50;
    return 1.65;
  }

  /* ─── STOCK DE SEGURIDAD ─────────────────────────────── */
  // Z = 1.65 para 95% nivel de servicio
  function stockSeguridad(dpd, leadTimeDias, factorSS) {
    const z = 1.65;
    // Simplificado: SS = Z * sigma_demanda * sqrt(LT)
    // Usamos dpd * 0.3 como proxy de desviación estándar
    const sigma = dpd * 0.30;
    return Math.ceil(z * sigma * Math.sqrt(leadTimeDias) * factorSS);
  }

  /* ─── PUNTO DE REORDEN ────────────────────────────────── */
  function puntoReorden(dpd, leadTimeDias, ss) {
    return Math.ceil(dpd * leadTimeDias + ss);
  }

  /* ─── CANTIDAD A PEDIR (sin restricción de presupuesto) ─ */
  function cantidadIdeal(existencia, rop, dmd, leadTimeDias, factorLT) {
    const coberturaMeta = Math.ceil(30 * factorLT); // días de cobertura objetivo
    const metaStock = Math.ceil(dmd * (coberturaMeta / 30));
    const neto = Math.max(0, metaStock - existencia + rop);
    return neto;
  }

  /* ─── CALCULAR PEDIDO PARA UN ARTÍCULO ───────────────── */
  function calcularArticulo(art, params) {
    // Acepta tanto leadTime como leadTimeDias para robustez
    const leadTimeDias = params.leadTimeDias != null ? params.leadTimeDias : params.leadTime;
    const factorSS = params.factorSS != null ? params.factorSS : 1.0;
    const diasCoberturaMeta = params.diasCoberturaMeta != null ? params.diasCoberturaMeta : 30;
    const flt = factorLeadTime(leadTimeDias);
    const dpd = art.dpd || 0;
    const dmd = art.dmd || 0;
    const existencia = art.existencia || 0;
    const costoIva = art.costo_iva || 0;

    if (dpd === 0 || costoIva === 0) {
      return { clave: art.clave, cantPedir: 0, costoTotal: 0, prioridad: 0, reason: 'sin_demanda' };
    }

    const ss = stockSeguridad(dpd, leadTimeDias, factorSS);
    const rop = puntoReorden(dpd, leadTimeDias, ss);
    const diasCobertura = existencia > 0 ? Math.round(existencia / dpd) : 0;

    // Cantidad objetivo = cubrir N días + SS
    const diasObj = Math.ceil(diasCoberturaMeta * flt);
    const stockObj = Math.ceil(dpd * diasObj + ss);
    const cantPedir = Math.max(0, stockObj - existencia);
    const costoTotal = cantPedir * costoIva;

    return {
      clave: art.clave,
      descripcion: art.descripcion,
      linea: art.linea,
      abc: art.abc,
      existencia,
      diasCobertura,
      rop,
      ss,
      stockObj,
      cantPedir,
      costoUnit: costoIva,
      costoTotal,
      score: art.score_compra || 0,
      pctAncla: art.pct_ancla || 0,
      dmd,
      dpd,
      // Existencia en el almacén del proveedor (Vazlo). null = sin dato cargado.
      existenciaVazlo: (art.existencia_vazlo != null) ? art.existencia_vazlo : null
    };
  }

  /* ─── OPTIMIZAR PEDIDO CON PRESUPUESTO ──────────────────
     Algoritmo:
     1. Calcular pedido ideal por artículo
     2. Ordenar por score de prioridad (desc)
     3. Asignar presupuesto en cascada
     4. Si queda presupuesto, escalar artículos A proporcionalmente

     Modo Vazlo (usarVazlo=true):
       · Cada artículo del pedido lleva existenciaVazlo (stock del
         almacén del proveedor) y una clasificación de surtido:
         'completo'  → el proveedor cubre TODO lo pedido
         'parcial'   → el proveedor cubre solo una parte
         'sin_stock' → el proveedor no tiene existencia
       · Si limitarVazlo=true (modo agresivo): la cantidad a pedir se
         TOPA a la existencia del proveedor y los artículos sin stock
         Vazlo quedan fuera de la cascada, de modo que el presupuesto
         se reasigna a mercancía que el proveedor SÍ puede surtir.
  ─────────────────────────────────────────────────────── */
  function optimizarPedido(articulos, params) {
    const { presupuesto, factorSS, diasCoberturaMeta, filtroABC, soloConDemanda } = params;
    const leadTimeDias = params.leadTimeDias != null ? params.leadTimeDias : params.leadTime;
    const usarVazlo = !!params.usarVazlo;
    const limitarVazlo = usarVazlo && !!params.limitarVazlo;

    let arts = articulos;
    if (soloConDemanda) arts = arts.filter(a => a.dpd > 0 && a.costo_iva > 0);
    if (filtroABC && filtroABC.length > 0) arts = arts.filter(a => filtroABC.includes(a.abc));

    // Normalizar params para que calcularArticulo siempre reciba leadTimeDias
    const paramsNorm = { ...params, leadTimeDias };

    // Calcular pedido ideal por artículo
    const calculados = arts.map(a => calcularArticulo(a, paramsNorm)).filter(r => r.cantPedir > 0);

    // Ordenar por score descendente
    calculados.sort((a, b) => b.score - a.score);

    // Asignar presupuesto en cascada
    let presupuestoRestante = presupuesto;
    const pedido = [];
    let totalArts = 0, totalUnidades = 0, totalCosto = 0;
    let excluidosVazlo = 0;     // arts con demanda pero sin stock del proveedor (solo modo limitar)
    let recortadosVazlo = 0;    // arts cuya cantidad se topó al stock del proveedor

    for (const item of calculados) {
      if (presupuestoRestante <= 0) break;
      if (item.costoUnit <= 0) continue;

      let topePedir = item.cantPedir;

      // ── Modo agresivo: limitar al stock real del proveedor ──
      if (limitarVazlo) {
        const ev = item.existenciaVazlo || 0;
        if (ev <= 0) { excluidosVazlo++; continue; } // el presupuesto se reasigna al siguiente
        if (ev < topePedir) { topePedir = ev; recortadosVazlo++; }
      }

      const maxAffordable = Math.floor(presupuestoRestante / item.costoUnit);
      const cantFinal = Math.min(topePedir, maxAffordable);

      if (cantFinal > 0) {
        const costoFinal = cantFinal * item.costoUnit;
        let surtido = null;
        if (usarVazlo) {
          const ev = item.existenciaVazlo || 0;
          surtido = ev >= cantFinal ? 'completo' : (ev > 0 ? 'parcial' : 'sin_stock');
        }
        pedido.push({ ...item, cantFinal, costoFinal, surtido });
        presupuestoRestante -= costoFinal;
        totalArts++;
        totalUnidades += cantFinal;
        totalCosto += costoFinal;
      }
    }

    // Estadísticas de surtido Vazlo
    let vazloStats = null;
    if (usarVazlo) {
      vazloStats = { completo: 0, parcial: 0, sinStock: 0, costoSurtible: 0, udsSurtibles: 0, excluidos: excluidosVazlo, recortados: recortadosVazlo };
      for (const it of pedido) {
        const ev = it.existenciaVazlo || 0;
        if (it.surtido === 'completo') vazloStats.completo++;
        else if (it.surtido === 'parcial') vazloStats.parcial++;
        else vazloStats.sinStock++;
        const udsSurt = Math.min(it.cantFinal, ev);
        vazloStats.udsSurtibles += udsSurt;
        vazloStats.costoSurtible += udsSurt * it.costoUnit;
      }
      // Techo Vazlo: en modo limitado, si sobró presupuesto significa que YA se
      // financió toda la demanda que el proveedor puede surtir. El restante no
      // puede gastarse en Vazlo aunque se amplíe el presupuesto.
      vazloStats.techoAlcanzado = limitarVazlo && presupuestoRestante > 0;
    }

    // Estadísticas del pedido
    const byABC = { A: { arts: 0, costo: 0 }, B: { arts: 0, costo: 0 }, C: { arts: 0, costo: 0 }, D: { arts: 0, costo: 0 } };
    for (const item of pedido) {
      const cat = item.abc || 'D';
      if (byABC[cat]) { byABC[cat].arts++; byABC[cat].costo += item.costoFinal; }
    }

    return {
      pedido,
      totalArts,
      totalUnidades,
      totalCosto,
      presupuestoUsado: totalCosto,
      presupuestoRestante,
      pctUsado: presupuesto > 0 ? (totalCosto / presupuesto * 100) : 0,
      byABC,
      usarVazlo,
      limitarVazlo,
      vazloStats
    };
  }

  /* ─── ARTÍCULOS EN RIESGO DE QUIEBRE ─────────────────── */
  function articulosEnRiesgo(articulos, leadTimeDias, umbralDias) {
    return articulos
      .filter(a => a.dpd > 0 && a.abc !== 'D')
      .map(a => {
        const diasCobertura = a.existencia > 0 ? Math.round(a.existencia / a.dpd) : 0;
        const ss = stockSeguridad(a.dpd, leadTimeDias, 1.0);
        const rop = puntoReorden(a.dpd, leadTimeDias, ss);
        return { ...a, diasCobertura, ss, rop };
      })
      .filter(a => a.diasCobertura <= umbralDias)
      .sort((a, b) => b.score_compra - a.score_compra);
  }

  /* ─── COBERTURA GLOBAL ────────────────────────────────── */
  function coberturaGlobal(totalInventario, ventaMensual) {
    if (ventaMensual <= 0) return 0;
    return (totalInventario / ventaMensual) * 30;
  }

  return { factorLeadTime, stockSeguridad, puntoReorden, calcularArticulo, optimizarPedido, articulosEnRiesgo, coberturaGlobal, diasPeriodo, numMeses, IVA };
})();
