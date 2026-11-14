/* timing.js — giản đồ thời gian trực tiếp (canvas): CLK, RESET, HET_N, Q1, Q0, bus HEX, 6 đèn. */
(function (root) {
  'use strict';
  const ROWS = [
    { id: 'PHASE', label: 'Pha', phase: true },
    { id: 'CLK', label: 'CLK', color: '#ffb02e' },
    { id: 'RST_N', label: 'RST_N', color: '#ff8a3d' },
    { id: 'RSY', label: 'RSY', color: '#ff8a3d' },
    { id: 'HET_N', label: 'HET_N', color: '#b57cff' },
    { id: 'Q1', label: 'Q1', color: '#35e58a' },
    { id: 'Q0', label: 'Q0', color: '#35e58a' },
    { id: 'HEX', label: 'HEX', bus: true, color: '#ff5b3a' },
    { id: 'XA', label: 'XA', color: '#2bff7a' }, { id: 'VA', label: 'VA', color: '#ffd23a' }, { id: 'Q1', alias: 'DA', label: 'ĐA', color: '#ff4a4a' },
    { id: 'XB', label: 'XB', color: '#2bff7a' }, { id: 'VB', label: 'VB', color: '#ffd23a' }, { id: 'Q1_N', alias: 'DB', label: 'ĐB', color: '#ff4a4a' }
  ];
  const PHASE_COL = { '00': '#1f8a57', '01': '#9a7d14', '10': '#2f62b3', '11': '#8a4a1a' };
  const PHASE_NAME = { '00': 'P0 · A:X', '01': 'P1 · A:V', '10': 'P2 · B:X', '11': 'P3 · B:V' };

  function create(canvas, period) {
    const T = { period, windowClocks: 20, hist: {}, now: 0 };
    const ctx = canvas.getContext('2d');
    const keys = new Set(['CLK', 'RST_N', 'RSY', 'HET_N', 'Q1', 'Q0', 'XA', 'VA', 'XB', 'VB', 'Q1_N']);
    T.reset = sim => {
      T.hist = {}; T.now = sim.t;
      for (const k of keys) T.hist[k] = [[sim.t, sim.get(k)]];
      T.hist.HEX = [[sim.t, sim.hex()]]; T.hist.PHASE = [[sim.t, sim.state()]];
    };
    T.record = (sim, t, net) => {
      if (keys.has(net)) { const h = T.hist[net]; const v = sim.get(net); if (h[h.length - 1][1] !== v) h.push([t, v]); }
      if (/^C[UC]\d$/.test(net)) { const h = T.hist.HEX, v = sim.hex(); if (h[h.length - 1][1] !== v) h.push([t, v]); }
      if (net === 'Q0' || net === 'Q1') { const h = T.hist.PHASE, v = sim.state(); if (h[h.length - 1][1] !== v) h.push([t, v]); }
    };
    T.prune = t => { const lim = t - 60 * T.period; for (const k in T.hist) { const h = T.hist[k]; let i = 0; while (i < h.length - 2 && h[i + 1][0] < lim) i++; if (i > 0) h.splice(0, i); } };
    T.setWindow = n => { T.windowClocks = n; };

    function resize() {
      const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return r;
    }
    T.draw = (tNow) => {
      const r = resize(), W = r.width, H = r.height; if (W < 50) return;
      ctx.clearRect(0, 0, W, H);
      const LW = 58, pad = 6, top = 16, rowH = Math.max(14, (H - top - 4) / ROWS.length), span = T.windowClocks * T.period;
      const t0 = tNow - span, X = t => LW + (t - t0) / span * (W - LW - pad);
      // lưới nhịp
      ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textBaseline = 'middle';
      const k0 = Math.ceil(t0 / T.period);
      for (let k = k0; k * T.period <= tNow; k++) {
        const x = X(k * T.period); ctx.strokeStyle = k % 5 === 0 ? '#1f2c4b' : '#131c33'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, H); ctx.stroke();
        if (k % 5 === 0 && x > LW + 14) { ctx.fillStyle = '#5d6b8a'; ctx.textAlign = 'center'; ctx.fillText(String(k), x, 7); }
      }
      ROWS.forEach((row, i) => {
        const y0 = top + i * rowH, yc = y0 + rowH / 2, hh = rowH * 0.62;
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.012)' : 'rgba(255,255,255,0.03)'; ctx.fillRect(LW, y0, W - LW, rowH);
        ctx.fillStyle = '#a9b6d6'; ctx.textAlign = 'left'; ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.fillText(row.label, 8, yc);
        const h = T.hist[row.id]; if (!h) return;
        // chỉ số đoạn đầu tiên cần vẽ
        let s = 0; while (s + 1 < h.length && h[s + 1][0] <= t0) s++;
        for (let j = s; j < h.length; j++) {
          const ta = Math.max(h[j][0], t0), tb = j + 1 < h.length ? Math.min(h[j + 1][0], tNow) : tNow; if (tb <= ta) continue;
          const xa = X(ta), xb = X(tb), v = h[j][1];
          if (row.phase) {
            ctx.fillStyle = v.includes('X') ? 'rgba(255,77,77,.4)' : PHASE_COL[v]; ctx.fillRect(xa, y0 + 2, xb - xa, rowH - 4);
            if (xb - xa > 50) { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '10.5px ui-monospace,Menlo,monospace'; ctx.fillText(v.includes('X') ? 'X' : PHASE_NAME[v], (xa + xb) / 2, yc); }
          } else if (row.bus) {
            const bad = v === 'X';
            ctx.strokeStyle = bad ? '#ff4d4d' : row.color; ctx.lineWidth = 1.3; ctx.fillStyle = bad ? 'rgba(255,77,77,.22)' : 'rgba(255,91,58,.10)';
            ctx.beginPath(); ctx.rect(xa, yc - hh / 2, Math.max(xb - xa, 1), hh); ctx.fill(); ctx.stroke();
            if (xb - xa > 22) { ctx.fillStyle = bad ? '#ff8a8a' : '#ffd0c4'; ctx.textAlign = 'center'; ctx.font = '10.5px ui-monospace,Menlo,monospace'; ctx.fillText(v, (xa + xb) / 2, yc + 0.5); }
          } else {
            const hi = yc - hh / 2, lo = yc + hh / 2;
            if (v === 'X') { ctx.fillStyle = 'rgba(255,77,77,.35)'; ctx.fillRect(xa, hi, xb - xa, hh); ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1; ctx.strokeRect(xa, hi, xb - xa, hh); continue; }
            const y = v ? hi : lo; ctx.strokeStyle = v ? row.color : '#4b5876'; ctx.lineWidth = v ? 1.8 : 1.4;
            ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
            if (v) { ctx.fillStyle = row.color + '22'; ctx.fillRect(xa, hi, xb - xa, hh); }
            if (j > s && xa > LW + 1) { const pv = h[j - 1][1]; ctx.strokeStyle = row.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(xa, pv === 'X' ? lo : (pv ? hi : lo)); ctx.lineTo(xa, y); ctx.stroke(); }
          }
        }
      });
      // đầu đọc
      ctx.strokeStyle = '#ffffff55'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(tNow), top - 2); ctx.lineTo(X(tNow), H); ctx.stroke(); ctx.setLineDash([]);
    };
    return T;
  }
  const API = { create, PHASE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.TIMING = API;
})(typeof window !== 'undefined' ? window : globalThis);
