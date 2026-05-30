/* ============================================================
   formatters.js — Formateo de números, moneda y texto
   ============================================================ */

window.FMT = (function() {

  const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const mxn2 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const num2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function currency(v) { return mxn.format(v || 0); }
  function currency2(v) { return mxn2.format(v || 0); }
  function number(v) { return num.format(v || 0); }
  function number2(v) { return num2.format(v || 0); }
  function percent(v) { return pct.format(v || 0) + '%'; }
  function round2(v) { return Math.round((v || 0) * 100) / 100; }

  function compact(v) {
    v = v || 0;
    if (Math.abs(v) >= 1e6) return '$' + num2.format(v / 1e6) + 'M';
    if (Math.abs(v) >= 1e3) return '$' + num2.format(v / 1e3) + 'K';
    return currency(v);
  }

  function initials(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  function scoreColor(score) {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  function diasColor(dias) {
    if (dias <= 0) return 'danger';
    if (dias <= 7) return 'danger';
    if (dias <= 20) return 'warn';
    return 'ok';
  }

  function abcBadge(abc) {
    const map = { A: 'badge-A', B: 'badge-B', C: 'badge-C', D: 'badge-D' };
    return `<span class="badge ${map[abc] || 'badge-D'}">${abc}</span>`;
  }

  function semaforo(dias) {
    const cls = diasColor(dias);
    return `<span class="semaforo ${cls}"></span>`;
  }

  function avatarColors(i) {
    const colors = [
      { bg: '#EEEDFE', color: '#534AB7' },
      { bg: '#E1F5EE', color: '#0F6E56' },
      { bg: '#FAEEDA', color: '#854F0B' },
      { bg: '#FAECE7', color: '#993C1D' },
      { bg: '#E6F1FB', color: '#185FA5' },
      { bg: '#FBEAF0', color: '#993556' },
    ];
    return colors[i % colors.length];
  }

  /* ─── PERÍODO DINÁMICO (desde meta del dataset) ────────── */
  function meta() {
    try { return (window.CEDI_DATA && window.CEDI_DATA.meta) || {}; } catch (e) { return {}; }
  }
  function periodoLabel() { return meta().periodo || 'período'; }
  function numMeses() { return meta().num_meses || 5; }
  function diasPeriodo() { return meta().dias_periodo || 150; }
  function fechaCorte() { return meta().fecha_corte || ''; }
  // "Venta del período" en lugar de "Venta 5 meses" hardcodeado
  function labelVentaPeriodo() {
    const n = numMeses();
    return `Venta ${n} meses`;
  }
  // Venta promedio mensual de un total
  function ventaMensual(total) { return (total || 0) / numMeses(); }

  return { currency, currency2, number, number2, percent, compact, round2, initials, scoreColor, diasColor, abcBadge, semaforo, avatarColors, periodoLabel, numMeses, diasPeriodo, fechaCorte, labelVentaPeriodo, ventaMensual };
})();
