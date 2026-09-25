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

  /* ─── STOCK DE SEGURIDAD · MOTOR PULIDO ─────────────────
     σ de la demanda durante el lead time:
       · Poisson √(DPD·LT) como mínimo (demanda por piezas sueltas)
       · si el artículo trae ventas_mes (piezas por mes) con ≥8 pz
         en total, se usa la variabilidad mensual real escalada al
         lead time: σmes·√(LT/30), si es mayor que Poisson.
     SIN redondeo hacia arriba: el redondeo se hace una sola vez
     sobre el stock objetivo (Math.round). Así desaparece el piso
     artificial de 2 piezas del motor clásico.                    */
  function stockSeguridadPulido(dpd, leadTimeDias, factorSS, ventasMes) {
    const z = 1.65;
    let sLT = Math.sqrt(Math.max(0, dpd * leadTimeDias));
    if (Array.isArray(ventasMes) && ventasMes.length >= 3) {
      const tot = ventasMes.reduce((s, x) => s + (+x || 0), 0);
      if (tot >= 8) {
        const mu = tot / ventasMes.length;
        const sd = Math.sqrt(ventasMes.reduce((s, x) => s + Math.pow((+x || 0) - mu, 2), 0) / ventasMes.length);
        sLT = Math.max(sLT, sd * Math.sqrt(leadTimeDias / 30));
      }
    }
    return z * sLT * factorSS;
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

    const pulido = params.motor === 'pulido';
    const diasCobertura = existencia > 0 ? Math.round(existencia / dpd) : 0;
    // Cantidad objetivo = cubrir N días + SS
    const diasObj = Math.ceil(diasCoberturaMeta * flt);
    let ss, rop, stockObj;
    if (pulido) {
      ss = stockSeguridadPulido(dpd, leadTimeDias, factorSS, art.ventas_mes);
      rop = Math.round(dpd * leadTimeDias + ss);
      stockObj = Math.round(dpd * diasObj + ss);
      // Artículos cuya demanda del horizonte es < media pieza: objetivo 0,
      // salvo el piso opcional de 1 pz para clases A/B (se financia al final
      // de la fila porque su venta en riesgo es casi nula).
      if (dpd * diasObj < 0.5) {
        const piso = (params.pisoAB !== false) && (art.abc === 'A' || art.abc === 'B') ? 1 : 0;
        stockObj = Math.min(stockObj, piso);
      }
    } else {
      ss = stockSeguridad(dpd, leadTimeDias, factorSS);
      rop = puntoReorden(dpd, leadTimeDias, ss);
      stockObj = Math.ceil(dpd * diasObj + ss);
    }
    const cantPedir = Math.max(0, stockObj - existencia);
    const costoTotal = cantPedir * costoIva;

    const out = {
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
    if (pulido) {
      // Venta en riesgo: venta esperada del horizonte que la existencia
      // actual NO alcanza a surtir, valuada a precio promedio de venta.
      const precio = (art.unidades_total || 0) > 0 ? (art.venta_total || 0) / art.unidades_total : 0;
      out.precioVenta = precio;
      out.riesgo = Math.max(0, dpd * diasCoberturaMeta - existencia) * precio;
    }
    return out;
  }

  /* Orden de prioridad según motor: clásico = score; pulido = venta en
     riesgo (desc) y, en empate, score.                                  */
  function ordenPrioridad(motor) {
    return motor === 'pulido'
      ? (a, b) => ((b.riesgo || 0) - (a.riesgo || 0)) || (b.score - a.score)
      : (a, b) => b.score - a.score;
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
  /* ─── MEDIANA DE ROTACIÓN POR CLASE ABC ────────────────
     Se usa para definir "rápido-movedor": un artículo cuya rotación
     está por encima de la mediana de su propia clase. Así el umbral
     es relativo (una A rápida no se compara contra una C rápida). */
  function medianaRotacionPorClase(articulos) {
    const byClass = { A: [], B: [], C: [], D: [] };
    articulos.forEach(a => {
      const c = a.abc || 'D';
      if (byClass[c] && (a.rotacion || 0) > 0) byClass[c].push(a.rotacion);
    });
    const med = {};
    Object.keys(byClass).forEach(c => {
      const arr = byClass[c].sort((x, y) => x - y);
      if (!arr.length) { med[c] = 0; return; }
      const mid = Math.floor(arr.length / 2);
      med[c] = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });
    return med;
  }

  /* ─── MEDIANA DE DPD POR CLASE (motor pulido) ───────────
     "Rápido-movedor" por demanda real (piezas/día) en vez de la
     rotación de ROTINV, que se dispara en artículos casi siempre en
     cero aunque vendan 1–2 piezas.                                   */
  function medianaDpdPorClase(articulos) {
    const byClass = { A: [], B: [], C: [], D: [] };
    articulos.forEach(a => {
      const c = a.abc || 'D';
      if (byClass[c] && (a.dpd || 0) > 0) byClass[c].push(a.dpd);
    });
    const med = {};
    Object.keys(byClass).forEach(c => {
      const arr = byClass[c].sort((x, y) => x - y);
      if (!arr.length) { med[c] = 0; return; }
      const mid = Math.floor(arr.length / 2);
      med[c] = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });
    return med;
  }

  /* ─── FINANCIAR UNA LISTA CONTRA UNA BOLSA DE PRESUPUESTO ─
     Núcleo compartido por la cascada plana y por cada tramo del
     modo blindaje. Recorre los items (ya ordenados) y asigna la
     bolsa en cascada, respetando los modos Vazlo. Devuelve el
     pedido financiado, lo que sobró de la bolsa (rollover) y el
     conteo de lo que quedó FUERA por falta de presupuesto.
       ctx = { usarVazlo, limitarVazlo, tramo }                      */
  function financiarLista(items, bolsa, ctx) {
    const pedido = [];
    let restante = bolsa;
    let costo = 0, uds = 0, arts = 0;
    let excluidosVazlo = 0, recortadosVazlo = 0;
    let fueraArts = 0, fueraCosto = 0;
    // Diagnóstico por renglón (solo informativo, lo usa la exportación a Excel):
    // posición en la fila del tramo y qué pasó con cada candidato.
    const evaluados = [];
    let pos = 0;

    for (const item of items) {
      pos++;
      if (item.costoUnit <= 0) continue;
      let topePedir = item.cantPedir;
      let recortado = false;

      // Modo agresivo: topar a la existencia del proveedor
      if (ctx.limitarVazlo) {
        const ev = item.existenciaVazlo || 0;
        if (ev <= 0) { excluidosVazlo++; evaluados.push({ clave: item.clave, pos, estado: 'excluido_vazlo', cantFinal: 0, topePedir: 0, bolsaAntes: restante }); continue; }
        if (ev < topePedir) { topePedir = ev; recortadosVazlo++; recortado = true; }
      }

      const maxAffordable = restante > 0 ? Math.floor(restante / item.costoUnit) : 0;
      const cantFinal = Math.min(topePedir, maxAffordable);

      if (cantFinal > 0) {
        const costoFinal = cantFinal * item.costoUnit;
        let surtido = null;
        if (ctx.usarVazlo) {
          const ev = item.existenciaVazlo || 0;
          surtido = ev >= cantFinal ? 'completo' : (ev > 0 ? 'parcial' : 'sin_stock');
        }
        pedido.push({ ...item, cantFinal, costoFinal, surtido, tramo: ctx.tramo });
        evaluados.push({ clave: item.clave, pos, cantFinal, topePedir, bolsaAntes: restante,
          estado: cantFinal < topePedir ? 'parcial_presupuesto' : (recortado ? 'recortado_vazlo' : 'financiado') });
        restante -= costoFinal; costo += costoFinal; uds += cantFinal; arts++;
      } else {
        // No alcanzó ni una unidad con la bolsa disponible → fuera por presupuesto
        fueraArts++; fueraCosto += topePedir * item.costoUnit;
        evaluados.push({ clave: item.clave, pos, estado: 'fuera_presupuesto', cantFinal: 0, topePedir, bolsaAntes: restante });
      }
    }

    return { pedido, restante, costo, uds, arts, excluidosVazlo, recortadosVazlo, fueraArts, fueraCosto, evaluados };
  }

  /* ─── DIAGNÓSTICO PARA EXPORTACIÓN ─────────────────────
     Junta, por clave, el tramo, la posición en la fila, el tamaño de la
     fila y el desenlace de cada candidato evaluado. No afecta el cálculo
     del pedido: solo se adjunta al resultado como `diagnostico`.        */
  function armarDiagnostico(listas, extra) {
    const porClave = {};
    listas.forEach(({ tramo, items, r }) => {
      const de = items.length;
      r.evaluados.forEach(e => { porClave[e.clave] = { ...e, tramo, de }; });
    });
    return Object.assign({ porClave }, extra || {});
  }

  /* ─── ARMAR RESULTADO ESTÁNDAR ─────────────────────────
     Toma el pedido consolidado + acumulados y produce el objeto
     de salida idéntico en forma para plana y blindada (para que
     la UI y el export no distingan entre modos).                 */
  function armarResultado(pedido, presupuesto, presupuestoRestante, ctx, extra) {
    const totalCosto = pedido.reduce((s, i) => s + i.costoFinal, 0);
    const totalUnidades = pedido.reduce((s, i) => s + i.cantFinal, 0);

    let vazloStats = null;
    if (ctx.usarVazlo) {
      vazloStats = { completo: 0, parcial: 0, sinStock: 0, costoSurtible: 0, udsSurtibles: 0,
                     excluidos: ctx.excluidosVazlo || 0, recortados: ctx.recortadosVazlo || 0 };
      for (const it of pedido) {
        const ev = it.existenciaVazlo || 0;
        if (it.surtido === 'completo') vazloStats.completo++;
        else if (it.surtido === 'parcial') vazloStats.parcial++;
        else vazloStats.sinStock++;
        const udsSurt = Math.min(it.cantFinal, ev);
        vazloStats.udsSurtibles += udsSurt;
        vazloStats.costoSurtible += udsSurt * it.costoUnit;
      }
      vazloStats.techoAlcanzado = ctx.limitarVazlo && presupuestoRestante > 0;
    }

    const byABC = { A: { arts: 0, costo: 0 }, B: { arts: 0, costo: 0 }, C: { arts: 0, costo: 0 }, D: { arts: 0, costo: 0 } };
    for (const item of pedido) {
      const cat = item.abc || 'D';
      if (byABC[cat]) { byABC[cat].arts++; byABC[cat].costo += item.costoFinal; }
    }

    return Object.assign({
      pedido,
      totalArts: pedido.length,
      totalUnidades,
      totalCosto,
      presupuestoUsado: totalCosto,
      presupuestoRestante,
      pctUsado: presupuesto > 0 ? (totalCosto / presupuesto * 100) : 0,
      byABC,
      usarVazlo: ctx.usarVazlo,
      limitarVazlo: ctx.limitarVazlo,
      vazloStats
    }, extra || {});
  }

  /* ─── OPTIMIZAR PEDIDO CON PRESUPUESTO ──────────────────
     Dos modos:

     A) Cascada PLANA (blindaje=false, comportamiento clásico):
        1. Calcular pedido ideal por artículo
        2. Ordenar por score de prioridad (desc)
        3. Asignar presupuesto en cascada

     B) Cascada BLINDADA por tramos (blindaje=true):
        El presupuesto se reparte en tramos con prioridad, con un tope
        (%) por tramo. Lo que no se usa en un tramo baja (rollover) al
        siguiente, así lo crítico se financia PRIMERO:

        · Tramo 0 — Cero-stock rápido-movedores: existencia==0, con
          demanda y rotación ≥ mediana de su clase. Alcance ABC
          configurable (blindajeAlcance). Es el más protegido.
        · Tramo 1 — Top ancla "nunca deben faltar": los artículos de
          mayor venta a clientes ancla (top N por venta_ancla) que
          estén en cero o por debajo de su punto de reorden.
        · Tramo 2 — Cascada general por score: todo lo demás, con el
          presupuesto que reste.

     Modo Vazlo (usarVazlo): cada artículo del pedido lleva
     existenciaVazlo y clasificación de surtido (completo/parcial/
     sin_stock). Con limitarVazlo=true la cantidad se topa al stock
     del proveedor y los sin-stock quedan fuera de la cascada.
  ─────────────────────────────────────────────────────── */
  function optimizarPedido(articulos, params) {
    const { presupuesto, filtroABC, soloConDemanda } = params;
    const leadTimeDias = params.leadTimeDias != null ? params.leadTimeDias : params.leadTime;
    const usarVazlo = !!params.usarVazlo;
    const limitarVazlo = usarVazlo && !!params.limitarVazlo;
    const blindaje = !!params.blindaje;
    const motor = params.motor === 'pulido' ? 'pulido' : 'clasico';
    const cmp = ordenPrioridad(motor);
    const paramsNorm = { ...params, leadTimeDias, motor };
    const vazCtx = { usarVazlo, limitarVazlo };

    // Universo con demanda (base para todos los modos)
    let base = articulos;
    if (soloConDemanda) base = base.filter(a => a.dpd > 0 && a.costo_iva > 0);
    const abcFiltro = (filtroABC && filtroABC.length > 0) ? filtroABC : ['A', 'B', 'C', 'D'];

    /* ══════════ MODO PLANO (clásico) ══════════ */
    if (!blindaje) {
      const arts = base.filter(a => abcFiltro.includes(a.abc));
      const calculados = arts.map(a => calcularArticulo(a, paramsNorm)).filter(r => r.cantPedir > 0);
      calculados.sort(cmp);
      const r = financiarLista(calculados, presupuesto, { ...vazCtx, tramo: 'general' });
      return armarResultado(r.pedido, presupuesto, r.restante,
        { ...vazCtx, excluidosVazlo: r.excluidosVazlo, recortadosVazlo: r.recortadosVazlo },
        { blindaje: false, motor, necesidadTotal: calculados.reduce((s, i) => s + i.costoTotal, 0),
          diagnostico: armarDiagnostico([{ tramo: 'general', items: calculados, r }],
            { abcFiltro, criterioOrden: motor === 'pulido' ? 'riesgo' : 'score' }) });
    }

    /* ══════════ MODO BLINDAJE (por tramos) ══════════ */
    const alcance = (params.blindajeAlcance && params.blindajeAlcance.length > 0)
      ? params.blindajeAlcance : ['A'];
    const topeT0 = params.topeT0 != null ? params.topeT0 : 0.50; // cero-stock rápido
    const topeT1 = params.topeT1 != null ? params.topeT1 : 0.25; // top ancla
    const topAnclaN = params.topAnclaN != null ? params.topAnclaN : 200;

    // Rápido-movedor: clásico = rotación ROTINV ≥ mediana de su clase;
    // pulido = DPD ≥ mediana de DPD de su clase.
    const campoRapido = motor === 'pulido' ? (a => a.dpd || 0) : (a => a.rotacion || 0);
    const medRot = motor === 'pulido' ? medianaDpdPorClase(articulos) : medianaRotacionPorClase(articulos);
    const usados = new Set();

    // ── Tramo 0: cero-stock rápido-movedores ──
    const t0src = base.filter(a =>
      (a.existencia || 0) === 0 &&
      alcance.includes(a.abc) &&
      campoRapido(a) >= (medRot[a.abc] || 0)
    );
    const t0items = t0src.map(a => calcularArticulo(a, paramsNorm))
      .filter(r => r.cantPedir > 0)
      .sort(cmp);
    t0items.forEach(i => usados.add(i.clave));
    const r0 = financiarLista(t0items, presupuesto * topeT0, { ...vazCtx, tramo: 'cero_rapido' });

    // ── Tramo 1: top ancla que necesita reposición ──
    // Top N por venta_ancla (absoluto), que estén en cero o bajo reorden y no financiados en T0.
    const anclaRank = articulos
      .filter(a => (a.venta_ancla || 0) > 0)
      .sort((a, b) => b.venta_ancla - a.venta_ancla)
      .slice(0, topAnclaN);
    const anclaClaves = new Set(anclaRank.map(a => a.clave));
    const rankAncla = {}; anclaRank.forEach((a, i) => { rankAncla[a.clave] = i + 1; });
    const t1src = base.filter(a => anclaClaves.has(a.clave) && !usados.has(a.clave));
    const t1items = t1src.map(a => {
        const r = calcularArticulo(a, paramsNorm);
        r.ventaAncla = a.venta_ancla || 0;
        return r;
      })
      // "en cero o bajo reorden": la existencia no cubre el punto de reorden
      .filter(r => r.cantPedir > 0 && r.existencia <= r.rop)
      .sort((a, b) => b.ventaAncla - a.ventaAncla);
    t1items.forEach(i => usados.add(i.clave));
    const bolsaT1 = presupuesto * topeT1 + r0.restante;
    const r1 = financiarLista(t1items, bolsaT1, { ...vazCtx, tramo: 'ancla' });

    // ── Tramo 2: cascada general con lo que reste ──
    const t2src = base.filter(a => abcFiltro.includes(a.abc) && !usados.has(a.clave));
    const t2items = t2src.map(a => calcularArticulo(a, paramsNorm))
      .filter(r => r.cantPedir > 0)
      .sort(cmp);
    const bolsaT2 = presupuesto * (1 - topeT0 - topeT1) + r1.restante;
    const r2 = financiarLista(t2items, Math.max(0, bolsaT2), { ...vazCtx, tramo: 'general' });

    const pedido = [...r0.pedido, ...r1.pedido, ...r2.pedido];
    const presupuestoRestante = r2.restante;

    const tramos = [
      { id: 'cero_rapido', nombre: 'Cero-stock rápido', arts: r0.arts, costo: r0.costo,
        candidatos: t0items.length, fueraArts: r0.fueraArts, fueraCosto: r0.fueraCosto },
      { id: 'ancla', nombre: 'Top ancla', arts: r1.arts, costo: r1.costo,
        candidatos: t1items.length, fueraArts: r1.fueraArts, fueraCosto: r1.fueraCosto },
      { id: 'general', nombre: 'Cascada general', arts: r2.arts, costo: r2.costo,
        candidatos: t2items.length, fueraArts: r2.fueraArts, fueraCosto: r2.fueraCosto }
    ];

    const excluidosVazlo = r0.excluidosVazlo + r1.excluidosVazlo + r2.excluidosVazlo;
    const recortadosVazlo = r0.recortadosVazlo + r1.recortadosVazlo + r2.recortadosVazlo;

    return armarResultado(pedido, presupuesto, presupuestoRestante,
      { ...vazCtx, excluidosVazlo, recortadosVazlo },
      { blindaje: true, blindajeAlcance: alcance, topeT0, topeT1, tramos, motor,
        necesidadTotal: [...t0items, ...t1items, ...t2items].reduce((s, i) => s + i.costoTotal, 0),
        diagnostico: armarDiagnostico([
          { tramo: 'cero_rapido', items: t0items, r: r0 },
          { tramo: 'ancla', items: t1items, r: r1 },
          { tramo: 'general', items: t2items, r: r2 }
        ], { abcFiltro, alcance, rankAncla, topAnclaN, medianas: medRot,
             campoRapido: motor === 'pulido' ? 'dpd' : 'rotacion',
             criterioOrden: motor === 'pulido' ? 'riesgo' : 'score',
             bolsas: { t0: presupuesto * topeT0, t1: bolsaT1, t2: Math.max(0, bolsaT2) } }) });
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

  return { factorLeadTime, stockSeguridad, stockSeguridadPulido, medianaDpdPorClase, medianaRotacionPorClase, puntoReorden, calcularArticulo, optimizarPedido, articulosEnRiesgo, coberturaGlobal, diasPeriodo, numMeses, IVA };
})();
