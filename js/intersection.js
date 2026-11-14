/* intersection.js — ngã tư thu nhỏ: đèn khớp với 6 tín hiệu của mạch, xe dừng/đi theo đèn. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a, p, t) => { const e = document.createElementNS(NS, n); if (a) for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); if (t !== undefined) e.textContent = t; return e; };
  const COL = { g: ['#2bff7a', '#12331f'], y: ['#ffd23a', '#3b3510'], r: ['#ff4040', '#3a1414'] };

  function create(svg) {
    const I = { lamps: {}, cars: [], lights: { A: 'r', B: 'r' }, spawnT: [0, 0, 0, 0], rnd: Math.random };
    el('rect', { x: 0, y: 0, width: 360, height: 360, fill: '#0b1224' }, svg);
    el('rect', { x: 150, y: 0, width: 60, height: 360, fill: '#1b2236' }, svg);
    el('rect', { x: 0, y: 150, width: 360, height: 60, fill: '#1b2236' }, svg);
    el('line', { x1: 180, y1: 0, x2: 180, y2: 140, stroke: '#394a73', 'stroke-dasharray': '8 8' }, svg); el('line', { x1: 180, y1: 220, x2: 180, y2: 360, stroke: '#394a73', 'stroke-dasharray': '8 8' }, svg);
    el('line', { x1: 0, y1: 180, x2: 140, y2: 180, stroke: '#394a73', 'stroke-dasharray': '8 8' }, svg); el('line', { x1: 220, y1: 180, x2: 360, y2: 180, stroke: '#394a73', 'stroke-dasharray': '8 8' }, svg);
    // vạch dừng
    [[150, 138, 30, 3], [180, 219, 30, 3], [138, 180, 3, 30], [219, 150, 3, 30]].forEach(([x, y, w, h]) => el('rect', { x, y, width: w, height: h, fill: '#cfd8ee', opacity: .8 }, svg));
    // hộp đèn: A (bắc, nam), B (tây, đông)
    const boxes = [['A', 'n', 218, 92], ['A', 's', 112, 232], ['B', 'w', 92, 112], ['B', 'e', 232, 218]];
    for (const [d, id, x, y] of boxes) {
      const vertical = true, g = el('g', { transform: `translate(${x},${y})` }, svg);
      el('rect', { x: 0, y: 0, width: 18, height: 48, rx: 5, fill: '#0a0f1d', stroke: '#3a4a78' }, g);
      const lamps = {}; ['r', 'y', 'g'].forEach((k, i) => { lamps[k] = el('circle', { cx: 9, cy: 9 + i * 15, r: 5.5, fill: COL[k][1] }, g); });
      (I.lamps[d] = I.lamps[d] || []).push(lamps);
      el('text', { x: 9, y: 62, 'text-anchor': 'middle', fill: '#8b99b8', 'font-size': 10, 'font-family': 'ui-monospace,monospace' }, g, d);
    }
    el('text', { x: 180, y: 14, 'text-anchor': 'middle', fill: '#6f7ea3', 'font-size': 10.5 }, svg, 'Hướng A');
    el('text', { x: 18, y: 172, 'text-anchor': 'middle', fill: '#6f7ea3', 'font-size': 10.5 }, svg, 'Hướng B');
    const gCars = el('g', null, svg);

    /* làn: [nhóm, x0, y0, dx, dy, vị trí vạch dừng dọc theo hướng đi] */
    const LANES = [
      { g: 'A', x: 165, y: -14, dx: 0, dy: 1, stop: 138, len: 360 },   // A đi xuống
      { g: 'A', x: 195, y: 374, dx: 0, dy: -1, stop: 222, len: 360 },  // A đi lên
      { g: 'B', x: -14, y: 195, dx: 1, dy: 0, stop: 138, len: 360 },   // B sang phải
      { g: 'B', x: 374, y: 165, dx: -1, dy: 0, stop: 222, len: 360 }   // B sang trái
    ];
    const SP = 48, CAR_L = 18, GAP = 6;
    const COLORS = ['#7aa2ff', '#ff9b7a', '#c79bff', '#8fe3c0', '#ffd27a', '#9fd6ff'];
    const along = (L, c) => (L.dx + L.dy > 0 ? (L.dx ? c.x : c.y) : (L.dx ? -c.x : -c.y));   // toạ độ dọc theo chiều đi (tăng dần)
    const stopAlong = L => (L.dx + L.dy > 0 ? L.stop : -L.stop);

    I.setLights = (A, B) => { // mỗi tham số: 'g' | 'y' | 'r' | 'x'
      I.lights.A = A; I.lights.B = B;
      for (const d of ['A', 'B']) for (const lp of I.lamps[d]) for (const k of ['r', 'y', 'g']) lp[k].setAttribute('fill', I.lights[d] === k ? COL[k][0] : COL[k][1]);
    };
    I.update = (dt, running) => {
      if (!running) return;
      LANES.forEach((L, li) => {
        I.spawnT[li] -= dt;
        const laneCars = I.cars.filter(c => c.li === li);
        if (I.spawnT[li] <= 0) {
          I.spawnT[li] = 1.6 + I.rnd() * 2.4;
          const tail = laneCars.length ? laneCars.reduce((m, c) => Math.min(m, c.s), 1e9) : 1e9;
          if (tail > -14 + CAR_L + GAP) { const c = { li, s: -14, rect: null }; c.rect = el('rect', { width: L.dx ? CAR_L : 11, height: L.dx ? 11 : CAR_L, rx: 3, fill: COLORS[(I.rnd() * COLORS.length) | 0], opacity: .95 }, gCars); I.cars.push(c); }
        }
      });
      for (const L of LANES) L._cars = [];
      I.cars.forEach(c => LANES[c.li]._cars.push(c));
      for (const L of LANES) {
        const cars = L._cars.sort((a, b) => b.s - a.s); const light = I.lights[L.g]; const sl = Math.abs(L.stop) === L.stop ? (L.dx + L.dy > 0 ? L.stop : 360 - L.stop) : 0;
        // s = quãng đường đã đi từ mép; vạch dừng tại s = stopS
        const stopS = (L.dx + L.dy > 0) ? L.stop : (360 - L.stop);
        cars.forEach((c, i) => {
          const front = c.s + CAR_L, ahead = i > 0 ? cars[i - 1].s - GAP : Infinity; let limit = ahead - CAR_L;
          const toLine = stopS - front;
          const mustStop = (light !== 'g') && toLine >= -1 && !(light === 'y' && toLine < 16);
          if (mustStop) limit = Math.min(limit, c.s + toLine);
          const ns = Math.min(c.s + SP * dt, limit); if (ns > c.s) c.s = ns;
        });
      }
      for (let i = I.cars.length - 1; i >= 0; i--) { const c = I.cars[i], L = LANES[c.li];
        if (c.s > 380) { c.rect.remove(); I.cars.splice(i, 1); continue; }
        const x = L.dx ? (L.dx > 0 ? c.s : 360 - c.s - CAR_L) : L.x - 5.5, y = L.dy ? (L.dy > 0 ? c.s : 360 - c.s - CAR_L) : L.y - 5.5;
        c.rect.setAttribute('x', x); c.rect.setAttribute('y', y); }
    };
    I.clear = () => { I.cars.forEach(c => c.rect.remove()); I.cars = []; };
    return I;
  }
  const API = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ISEC = API;
})(typeof window !== 'undefined' ? window : globalThis);
