/* scene.js — ngã tư 2D bằng canvas: đường, vỉa hè, nhà cửa, cây, đèn tín hiệu có đếm lùi,
   xe (ô tô, taxi, buýt, tải, xe máy), người đi bộ, ngày/chiều/đêm, đèn pha, mưa.
   Đèn lấy trực tiếp từ 6 ngõ ra của mạch (setLights). */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const CX = 500, CY = 350;          // tâm ngã tư
  const HW = 70, SWK = 22;           // nửa bề rộng đường, bề rộng vỉa hè
  const STOP = 98;                   // vạch dừng cách tâm
  const HX = 640, HY = 480;          // nửa kích thước thế giới mô phỏng
  const BOX = HW;                    // nửa cạnh ô giao nhau
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, t = f < 0 ? 0 : 255, p = Math.abs(f);
    return `rgb(${Math.round(r + (t - r) * p)},${Math.round(g + (t - g) * p)},${Math.round(b + (t - b) * p)})`;
  }
  const pick = (r, a) => a[(r() * a.length) | 0];

  /* ---------- sprite sáng (cache) ---------- */
  const spriteCache = {};
  function glow(color, r) {
    const k = color + r; if (spriteCache[k]) return spriteCache[k];
    const cv = document.createElement('canvas'); cv.width = cv.height = r * 2; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, color); gr.addColorStop(.35, color.replace(/[\d.]+\)$/, '.35)')); gr.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return (spriteCache[k] = cv);
  }
  function cone(len, wid) {
    const k = 'cone' + len + wid; if (spriteCache[k]) return spriteCache[k];
    const cv = document.createElement('canvas'); cv.width = len; cv.height = wid * 2; const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, 'rgba(255,244,196,.8)'); gr.addColorStop(.5, 'rgba(255,240,180,.28)'); gr.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, wid - 5); g.lineTo(len, 0); g.lineTo(len, wid * 2); g.lineTo(0, wid + 5); g.closePath(); g.fill();
    return (spriteCache[k] = cv);
  }

  /* ---------- đèn 7 đoạn ---------- */
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  function seg7(c, x, y, w, h, d, col) {
    const t = Math.max(1.6, w * .24), hh = (h - 3 * t) / 2, on = SEG[d] || '';
    const s = { a: [x + t, y, w - 2 * t, t], g: [x + t, y + t + hh, w - 2 * t, t], d: [x + t, y + h - t, w - 2 * t, t], f: [x, y + t, t, hh], b: [x + w - t, y + t, t, hh], e: [x, y + 2 * t + hh, t, hh], c: [x + w - t, y + 2 * t + hh, t, hh] };
    for (const k in s) { c.fillStyle = on.indexOf(k) >= 0 ? col : 'rgba(255,255,255,.06)'; c.fillRect(s[k][0], s[k][1], s[k][2], s[k][3]); }
  }

  /* ---------- loại xe ---------- */
  const TYPES = {
    car: { len: 44, wid: 21, vmax: 92, a: 38, b: 50, T: 1.0, s0: 9, cols: ['#c0392b', '#2e86de', '#d5d8dc', '#1e272e', '#f1c40f', '#16a085', '#8e44ad', '#e67e22', '#ecf0f1', '#576574', '#b33771'] },
    suv: { len: 49, wid: 23, vmax: 86, a: 34, b: 48, T: 1.05, s0: 9, cols: ['#2d3436', '#636e72', '#0a3d62', '#b2bec3', '#6d214f', '#1b9cfc'] },
    taxi: { len: 44, wid: 21, vmax: 90, a: 38, b: 50, T: 1.0, s0: 9, cols: ['#1fb86a', '#f9ca24'] },
    bus: { len: 104, wid: 27, vmax: 68, a: 22, b: 38, T: 1.3, s0: 11, cols: ['#e74c3c', '#2f80ed', '#f5b041'] },
    truck: { len: 84, wid: 26, vmax: 64, a: 20, b: 36, T: 1.3, s0: 10, cols: ['#d35400', '#2c3e50', '#16a085', '#c0392b'] },
    moto: { len: 22, wid: 9, vmax: 104, a: 52, b: 60, T: .7, s0: 5, cols: ['#222a35', '#7f1d1d', '#1d3b7f', '#555d6b', '#0f5132'] }
  };
  const HELMETS = ['#ffd23a', '#ff5b3a', '#35e58a', '#4ea1ff', '#ffffff', '#b57cff', '#222222'];
  const CLOTHES = ['#3b6fb6', '#c0392b', '#2e8b57', '#d4a017', '#6c5ce7', '#2d3436', '#e17055', '#00a8a8'];

  /* ---------- đèn tín hiệu ---------- */
  const LCOL = { r: '#ff3b30', y: '#ffc926', g: '#2bff7a' };
  const HEADS = [
    { g: 'A', x: 370, y: 431, o: 'h', cn: 'below' },
    { g: 'A', x: 630, y: 269, o: 'h', cn: 'above' },
    { g: 'B', x: 419, y: 238, o: 'v', cn: 'left' },
    { g: 'B', x: 581, y: 462, o: 'v', cn: 'right' }
  ];
  // vạch dừng: [nhóm, x, y, w, h]
  const STOPS = [
    ['A', CX - STOP - 2, CY, 4, HW], ['A', CX + STOP - 2, CY - HW, 4, HW],
    ['B', CX - HW, CY - STOP - 2, HW, 4], ['B', CX, CY + STOP - 2, HW, 4]
  ];
  // vạch người đi bộ: id, đường bị cắt, góc đầu, góc cuối
  const CWS = [
    { id: 'E', road: 'A', x: CX + 70, y: CY - HW, w: 22, h: 2 * HW, a: [581, 269], b: [581, 431], out: [1, 0] },
    { id: 'W', road: 'A', x: CX - 92, y: CY - HW, w: 22, h: 2 * HW, a: [419, 269], b: [419, 431], out: [-1, 0] },
    { id: 'N', road: 'B', x: CX - HW, y: CY - 92, w: 2 * HW, h: 22, a: [419, 269], b: [581, 269], out: [0, -1] },
    { id: 'S', road: 'B', x: CX - HW, y: CY + 70, w: 2 * HW, h: 22, a: [419, 431], b: [581, 431], out: [0, 1] }
  ];

  /* ---------- làn xe ---------- */
  function makeLanes() {
    const L = [];
    const dirs = [['A', 1, 0], ['A', -1, 0], ['B', 0, 1], ['B', 0, -1]];
    for (const [g, dx, dy] of dirs) for (let k = 0; k < 2; k++) {
      L.push({ g, dx, dy, nx: -dy, ny: dx, off: 17.5 + 35 * k, k, ext: g === 'A' ? HX : HY, vs: [], ang: Math.atan2(dy, dx) });
    }
    return L;
  }
  const lanePos = (L, u, lat) => { const o = L.off + (lat || 0); return [CX + L.dx * u + L.nx * o, CY + L.dy * u + L.ny * o]; };

  /* ---------- khối phố (tạo bằng hạt giống cố định) ---------- */
  const ROOFS = ['#7b8494', '#a1887f', '#b5655a', '#5e7f8c', '#8d99a8', '#6b7a5e', '#c2b280', '#4b5563', '#9a7b6a', '#8e6e95', '#6c8ea4'];
  const lotCache = {};
  function lot(qx, qy, i, j) {
    const key = qx + ',' + qy + ',' + i + ',' + j; if (lotCache[key]) return lotCache[key];
    const w = 104, h = 92, g = 12, ox = CX + qx * (HW + SWK), oy = CY + qy * (HW + SWK);
    const x = qx > 0 ? ox + g + i * (w + g) : ox - g - i * (w + g) - w, y = qy > 0 ? oy + g + j * (h + g) : oy - g - j * (h + g) - h;
    const r = rng((qx * 73856093) ^ (qy * 19349663) ^ (i * 83492791) ^ (j * 2654435761) ^ 977);
    let kind = 'building'; const p = r();
    if (i === 0 && j === 0) kind = (qx > 0 && qy < 0) ? 'plaza' : (qx < 0 && qy > 0) ? 'park' : 'building';
    else if (p > .84) kind = 'parking'; else if (p > .68) kind = 'park';
    const d = { kind, x, y, w, h, r, roof: pick(r, ROOFS), hgt: .6 + r() * 1.1 };
    lotCache[key] = d; return d;
  }
  function tree(c, x, y, rad, r) {
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x + rad * .35, y + rad * .45, rad, rad * .9, 0, 0, TAU); c.fill();
    c.fillStyle = '#2b6538'; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
    c.fillStyle = '#3a8447'; c.beginPath(); c.arc(x - rad * .22, y - rad * .22, rad * .72, 0, TAU); c.fill();
    c.fillStyle = '#58a55f'; c.beginPath(); c.arc(x - rad * .38, y - rad * .4, rad * .3, 0, TAU); c.fill();
    if (r && r() < .3) { c.fillStyle = '#ffd2e1'; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + (r() - .5) * rad, y + (r() - .5) * rad, 1.4, 0, TAU); c.fill(); } }
  }
  function drawLot(c, d) {
    const { x, y, w, h, r } = d, rr2 = rng(Math.floor(d.x * 7 + d.y * 13));
    if (d.kind === 'building') {
      const hs = d.hgt; c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(x + 9 * hs, y + 11 * hs, w, h);
      c.fillStyle = shade(d.roof, -.25); rr(c, x - 1, y - 1, w + 2, h + 2, 4); c.fill();
      c.fillStyle = d.roof; rr(c, x + 2, y + 2, w - 4, h - 4, 3); c.fill();
      c.strokeStyle = shade(d.roof, .25); c.lineWidth = 1.5; rr(c, x + 6, y + 6, w - 12, h - 12, 2); c.stroke();
      const n = 2 + ((rr2() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const fx = x + 12 + rr2() * (w - 40), fy = y + 12 + rr2() * (h - 36), t = rr2();
        if (t < .5) { c.fillStyle = '#3b4250'; c.fillRect(fx, fy, 16, 11); c.fillStyle = '#9aa4b5'; c.beginPath(); c.arc(fx + 8, fy + 5.5, 4, 0, TAU); c.fill(); c.strokeStyle = '#3b4250'; c.lineWidth = 1; c.beginPath(); c.moveTo(fx + 4, fy + 5.5); c.lineTo(fx + 12, fy + 5.5); c.stroke(); }
        else if (t < .78) { c.fillStyle = '#d7dbe3'; c.beginPath(); c.arc(fx + 8, fy + 8, 8, 0, TAU); c.fill(); c.strokeStyle = '#8f98a8'; c.lineWidth = 1.5; c.stroke(); }
        else { c.fillStyle = '#4e9a5a'; c.fillRect(fx, fy, 22, 12); c.strokeStyle = '#2f6b3a'; c.lineWidth = 1; for (let q = 3; q < 22; q += 5) { c.beginPath(); c.moveTo(fx + q, fy); c.lineTo(fx + q, fy + 12); c.stroke(); } }
      }
      if (d.i0) { c.fillStyle = '#ffb02e'; c.fillRect(x + 6, y + h - 10, w - 12, 5); }
    } else if (d.kind === 'park' || d.kind === 'plaza') {
      c.fillStyle = d.kind === 'plaza' ? '#8d949e' : '#3d6b45'; rr(c, x, y, w, h, 8); c.fill();
      if (d.kind === 'plaza') {
        c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = 1; for (let q = 0; q < w; q += 13) { c.beginPath(); c.moveTo(x + q, y); c.lineTo(x + q, y + h); c.stroke(); } for (let q = 0; q < h; q += 13) { c.beginPath(); c.moveTo(x, y + q); c.lineTo(x + w, y + q); c.stroke(); }
        const fx = x + w / 2, fy = y + h / 2; c.fillStyle = '#b9bfc8'; c.beginPath(); c.arc(fx, fy, 30, 0, TAU); c.fill(); c.fillStyle = '#3f8fd1'; c.beginPath(); c.arc(fx, fy, 25, 0, TAU); c.fill(); c.fillStyle = '#6fb6ee'; c.beginPath(); c.arc(fx, fy, 15, 0, TAU); c.fill(); c.fillStyle = '#d9efff'; c.beginPath(); c.arc(fx, fy, 5, 0, TAU); c.fill();
        for (const [tx, ty] of [[x + 14, y + 14], [x + w - 14, y + 14], [x + 14, y + h - 14], [x + w - 14, y + h - 14]]) tree(c, tx, ty, 10, rr2);
      } else {
        c.strokeStyle = '#b8a77a'; c.lineWidth = 5; c.beginPath(); c.moveTo(x + 4, y + h * .6); c.bezierCurveTo(x + w * .3, y + h * .2, x + w * .6, y + h * .9, x + w - 4, y + h * .4); c.stroke();
        if (d.pond) { c.fillStyle = '#2f7fb8'; c.beginPath(); c.ellipse(x + w * .5, y + h * .55, 28, 18, .3, 0, TAU); c.fill(); c.fillStyle = '#5fb0e6'; c.beginPath(); c.ellipse(x + w * .5 - 4, y + h * .55 - 3, 18, 10, .3, 0, TAU); c.fill(); }
        const n = 5 + ((rr2() * 4) | 0); for (let k = 0; k < n; k++) tree(c, x + 12 + rr2() * (w - 24), y + 12 + rr2() * (h - 24), 8 + rr2() * 6, rr2);
      }
    } else { // bãi đỗ xe
      c.fillStyle = '#3c424d'; rr(c, x, y, w, h, 4); c.fill(); c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 1.2;
      for (let row = 0; row < 2; row++) for (let q = 0; q < 7; q++) {
        const sx = x + 6 + q * 14, sy = row ? y + h - 34 : y + 6; c.strokeRect(sx, sy, 14, 28);
        if (rr2() < .62) { const col = pick(rr2, TYPES.car.cols); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(sx + 3, sy + 4, 11, 24); c.fillStyle = col; rr(c, sx + 2, sy + 3, 10, 22, 3); c.fill(); c.fillStyle = '#16212e'; c.fillRect(sx + 3, sy + (row ? 6 : 15), 8, 5); }
      }
    }
  }

  /* ---------- tạo cảnh ---------- */
  function create(opts) {
    const S = { lights: { A: 'n', B: 'n' }, count: '--', countRed: '--', powered: false, tod: 0, todTarget: 0, density: 1, rain: false, pedsOn: true, speed: 1, blink: 0, time: 0, stats: { A: 0, B: 0 }, wait: { A: 0, B: 0 }, lanes: makeLanes(), peds: [], ped: { A: 'D', B: 'D' }, targets: [], recs: new Map(), rainDrops: [], ripples: [], clouds: [] };
    const r0 = rng(4242);
    for (let i = 0; i < 160; i++) S.rainDrops.push({ x: r0(), y: r0(), s: .9 + r0() * .8, l: 8 + r0() * 10 });
    for (let i = 0; i < 4; i++) S.clouds.push({ x: r0() * 1400 - 200, y: r0() * 700, rx: 160 + r0() * 160, ry: 70 + r0() * 60, v: 6 + r0() * 8 });
    // tên lamp & cây ven đường
    const lamps = [], strees = [];
    for (let k = -8; k <= 8; k++) {
      const a = CX + 90 * k + 45, b = CX + 90 * k; if (Math.abs(a - CX) > 150) lamps.push({ x: a, y: CY - HW - 6, ax: 0, ay: 1 }); if (Math.abs(b - CX) > 150) lamps.push({ x: b, y: CY + HW + 6, ax: 0, ay: -1 });
      const a2 = CY + 90 * k + 45, b2 = CY + 90 * k; if (Math.abs(a2 - CY) > 150) lamps.push({ x: CX - HW - 6, y: a2, ax: 1, ay: 0 }); if (Math.abs(b2 - CY) > 150) lamps.push({ x: CX + HW + 6, y: b2, ax: -1, ay: 0 });
      const t1 = CX + 90 * k + 22; if (Math.abs(t1 - CX) > 130) { strees.push([t1, CY - HW - SWK + 6]); strees.push([t1 + 45, CY + HW + SWK - 6]); }
      const t2 = CY + 90 * k + 22; if (Math.abs(t2 - CY) > 130) { strees.push([CX - HW - SWK + 6, t2]); strees.push([CX + HW + SWK - 6, t2 + 45]); }
    }
    S.lamps = lamps;

    /* ===== logic xe ===== */
    function typePick() {
      const r = Math.random();
      return r < .33 ? 'car' : r < .45 ? 'suv' : r < .52 ? 'taxi' : r < .82 ? 'moto' : r < .88 ? 'bus' : 'truck';
    }
    function makeVeh(L, type) {
      const T = TYPES[type]; const col = pick(Math.random, T.cols);
      const v = { type, len: T.len + (type === 'moto' ? 0 : (Math.random() - .5) * 3), wid: T.wid, col, vmax: T.vmax * (.88 + Math.random() * .24), a: T.a, b: T.b, T: T.T, s0: T.s0, u: 0, v: 0, react: 0, blocked: false, brake: false, counted: false, lat: 0, ph: Math.random() * 6, helm: pick(Math.random, HELMETS), pax: Math.random() < .3, cloth: pick(Math.random, CLOTHES), cloth2: pick(Math.random, CLOTHES) };
      v.roof = shade(col, .2); v.dark = shade(col, -.3);
      if (type === 'moto') v.lat = (Math.random() - .5) * 14;
      return v;
    }
    function trySpawn(L, u0, v0) {
      const type = (L.k === 0 && Math.random() < .5) ? pick(Math.random, ['car', 'suv', 'taxi', 'bus', 'truck', 'car']) : (L.k === 1 && Math.random() < .55 ? 'moto' : typePick());
      const v = makeVeh(L, type); v.u = u0; v.v = Math.min(v.vmax, v0 === undefined ? v.vmax * .85 : v0);
      const last = L.vs[L.vs.length - 1];
      if (last && (last.u - last.len) - v.u < v.len * .0 + 28) return false;
      L.vs.push(v); return true;
    }
    S.prefill = function () {
      for (const L of S.lanes) {
        L.vs = []; let u = L.ext * .55; const dens = [.6, 1, 1.5][S.density];
        while (u > -L.ext * .6) { const type = typePick(); const v = makeVeh(L, (L.k === 1 && Math.random() < .5) ? 'moto' : type); v.u = u; v.v = v.vmax * (.5 + Math.random() * .4); L.vs.push(v); u -= v.len + (60 + Math.random() * 190) / dens; }
      }
    };
    S.clear = function () { S.lanes.forEach(L => (L.vs = [])); S.peds = []; S.stats = { A: 0, B: 0 }; S.prefill(); };

    function occupied(group) { // ô giữa có xe của nhóm đó không
      for (const L of S.lanes) if (L.g === group) for (const c of L.vs) if (c.u > -BOX - 6 && c.u - c.len < BOX + 2) return true;
      return false;
    }
    function stepLanes(h) {
      const rate = [.075, .15, .27][S.density];
      pedSig();
      const occA = occupied('A'), occB = occupied('B');
      for (const L of S.lanes) {
        const light = S.lights[L.g], cross = L.g === 'A' ? occB : occA;
        if (Math.random() < rate * (L.k === 0 ? .85 : 1) * h) trySpawn(L, -L.ext);
        const vs = L.vs;
        for (let i = 0; i < vs.length; i++) {
          const c = vs[i], lead = i ? vs[i - 1] : null;
          const vf = light === 'n' ? .55 : 1;
          let acc = c.a * (1 - Math.pow(c.v / (c.vmax * vf), 4));
          let gap = 1e9, dv = 0;
          if (lead) { gap = (lead.u - lead.len) - c.u; dv = c.v - lead.v; }
          const dist = -STOP - c.u;
          let stop = false;
          if (dist > -3) {
            if (light === 'r') stop = true;
            else if (light === 'y') stop = c.v < 25 || dist > Math.max(c.v * c.v / 80, 14);
            if (!stop && c.u < -STOP + 45 && cross && dist < 160) stop = true;
          }
          if (stop) {
            const g2 = Math.max(dist, .3), d2 = c.v;
            if (g2 < gap) { gap = g2; dv = d2; }
            if (!c.blocked) c.blocked = true;
          } else if (c.blocked) { c.blocked = false; if (c.v < 10) c.react = .25 + Math.random() * .7; }
          const sstar = c.s0 + Math.max(0, c.v * c.T + c.v * dv / (2 * Math.sqrt(c.a * c.b)));
          acc -= c.a * Math.pow(sstar / Math.max(gap, .1), 2);
          acc = Math.max(acc, -130);
          if (c.react > 0) { c.react -= h; if (c.v < 12) { acc = Math.min(acc, 0); c.v = 0; } }
          c.v = Math.max(0, c.v + acc * h); c.u += c.v * h;
          if (lead) { const lim = (lead.u - lead.len) - 2; if (c.u > lim) { c.u = lim; c.v = Math.min(c.v, lead.v); } }
          c.brake = acc < -14 || (c.v < 4 && c.blocked);
          if (!c.counted && c.u > BOX) { c.counted = true; S.stats[L.g]++; }
        }
        while (vs.length && vs[0].u - vs[0].len > L.ext + 40) vs.shift();
      }
    }

    /* ===== người đi bộ ===== */
    function pedSig() {
      const a = S.lights.A, b = S.lights.B;
      S.ped.A = (a === 'r' && b === 'g') ? 'W' : (a === 'r' && b === 'y') ? 'F' : 'D';
      S.ped.B = (b === 'r' && a === 'g') ? 'W' : (b === 'r' && a === 'y') ? 'F' : 'D';
    }
    function stepPeds(h) {
      if (S.pedsOn) for (const cw of CWS) {
        const n = S.peds.filter(p => p.cw === cw && p.st === 'wait').length;
        if (n < 6 && Math.random() < .2 * h) {
          const fwd = Math.random() < .5, s = fwd ? cw.a : cw.b, e = fwd ? cw.b : cw.a, j = () => (Math.random() - .5) * 13;
          S.peds.push({ cw, st: 'wait', x: s[0] + j(), y: s[1] + j(), sx: 0, sy: 0, ex: e[0] + j(), ey: e[1] + j(), t: 0, al: 0, react: Math.random() * 1.2, col: pick(Math.random, CLOTHES), hair: pick(Math.random, ['#222', '#3a2a1a', '#6b4a2b', '#c9a227']), umb: pick(Math.random, ['#e74c3c', '#2f80ed', '#f5b041', '#8e44ad', '#16a085']), ph: Math.random() * 6, leave: 0, ang: 0 });
          const p = S.peds[S.peds.length - 1]; p.sx = p.x; p.sy = p.y;
        }
      }
      for (const p of S.peds) {
        p.al = Math.min(1, p.al + h * 1.6); p.ph += h * 9;
        if (p.st === 'wait') {
          if (S.ped[p.cw.road] === 'W') { p.react -= h; if (p.react <= 0) p.st = 'cross'; }
        } else if (p.st === 'cross') {
          const dx = p.ex - p.sx, dy = p.ey - p.sy, len = Math.hypot(dx, dy), sp = 36 / len;
          p.t = Math.min(1, p.t + sp * h); p.x = p.sx + dx * p.t; p.y = p.sy + dy * p.t; p.ang = Math.atan2(dy, dx);
          if (p.t >= 1) { p.st = 'leave'; }
        } else {
          const o = p.cw.out; p.x += o[0] * 24 * h; p.y += o[1] * 24 * h; p.leave += 24 * h; p.ang = Math.atan2(o[1], o[0]); if (p.leave > 60) p.al -= h * 3.2;
        }
      }
      S.peds = S.peds.filter(p => !(p.st === 'leave' && p.al <= 0));
    }

    S.update = function (dt, run) {
      S.tod += clamp(S.todTarget - S.tod, -dt * .9, dt * .9);
      S.blink += dt;
      for (const d of S.rainDrops) { d.y += d.s * dt * 1.4; if (d.y > 1) { d.y = 0; d.x = Math.random(); } }
      for (const cl of S.clouds) { cl.x += cl.v * dt; if (cl.x > 1300) cl.x = -300; }
      for (let i = S.ripples.length - 1; i >= 0; i--) { S.ripples[i].a += dt * 1.6; if (S.ripples[i].a > 1) S.ripples.splice(i, 1); }
      if (S.rain && S.ripples.length < 30 && Math.random() < .7) S.ripples.push({ x: 100 + Math.random() * 800, y: 280 + Math.random() * 140, a: 0 });
      if (!run) return;
      const sdt = dt * S.speed, n = Math.max(1, Math.ceil(sdt / .05)), h = sdt / n; S.time += sdt;
      for (let i = 0; i < n; i++) { stepLanes(h); stepPeds(h); }
      S.wait.A = S.wait.B = 0;
      for (const L of S.lanes) for (const c of L.vs) if (c.v < 6 && c.u < -STOP + 30 && c.u > -STOP - 330) S.wait[L.g]++;
    };
    S.setLights = (a, b) => { S.lights.A = a; S.lights.B = b; };
    S.setCount = (s, red) => { S.count = s; S.countRed = red === undefined ? s : red; };
    S.setPower = p => { S.powered = p; };
    S.setSpeed = f => { S.speed = f; };
    S.setTod = k => { S.todTarget = k; };
    S.setDensity = k => { S.density = k; };
    S.setRain = b => { S.rain = b; };
    S.setPeds = b => { S.pedsOn = b; if (!b) S.peds = S.peds.filter(p => p.st !== 'wait'); };
    S.setTargets = arr => { S.targets = arr; };

    /* ===== vẽ tĩnh ===== */
    function buildStatic(rec) {
      const cv = rec.stat || (rec.stat = document.createElement('canvas')); cv.width = rec.W; cv.height = rec.H;
      const c = cv.getContext('2d'); c.setTransform(rec.dpr * rec.sc, 0, 0, rec.dpr * rec.sc, rec.dpr * rec.ox, rec.dpr * rec.oy);
      const x0 = -rec.ox / rec.sc - 4, y0 = -rec.oy / rec.sc - 4, x1 = (rec.cw - rec.ox) / rec.sc + 4, y1 = (rec.ch - rec.oy) / rec.sc + 4;
      c.fillStyle = '#59606b'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      // nền lát
      c.strokeStyle = 'rgba(0,0,0,.07)'; c.lineWidth = 1; c.beginPath();
      for (let x = Math.floor(x0 / 16) * 16; x < x1; x += 16) { c.moveTo(x, y0); c.lineTo(x, y1); }
      for (let y = Math.floor(y0 / 16) * 16; y < y1; y += 16) { c.moveTo(x0, y); c.lineTo(x1, y); } c.stroke();
      // lô
      for (const [qx, qy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let i = 0; i < 8; i++) for (let j = 0; j < 7; j++) {
        const d = lot(qx, qy, i, j); if (i === 0 && j === 0 && qx < 0 && qy > 0) d.pond = true;
        if (d.x + d.w < x0 || d.x > x1 || d.y + d.h < y0 || d.y > y1) continue; drawLot(c, d);
      }
      // vỉa hè
      c.fillStyle = '#9aa1ac';
      c.fillRect(x0, CY - HW - SWK, x1 - x0, SWK); c.fillRect(x0, CY + HW, x1 - x0, SWK); c.fillRect(CX - HW - SWK, y0, SWK, y1 - y0); c.fillRect(CX + HW, y0, SWK, y1 - y0);
      c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 1; c.beginPath();
      for (let x = Math.floor(x0 / 12) * 12; x < x1; x += 12) { c.moveTo(x, CY - HW - SWK); c.lineTo(x, CY - HW); c.moveTo(x, CY + HW); c.lineTo(x, CY + HW + SWK); }
      for (let y = Math.floor(y0 / 12) * 12; y < y1; y += 12) { c.moveTo(CX - HW - SWK, y); c.lineTo(CX - HW, y); c.moveTo(CX + HW, y); c.lineTo(CX + HW + SWK, y); } c.stroke();
      // mặt đường
      c.fillStyle = '#2b303b'; c.fillRect(x0, CY - HW, x1 - x0, 2 * HW); c.fillRect(CX - HW, y0, 2 * HW, y1 - y0);
      const rs = rng(99); c.globalAlpha = .06;
      for (let k = 0; k < 420; k++) { const t = rs(), px = x0 + rs() * (x1 - x0), py = y0 + rs() * (y1 - y0), onA = Math.abs(py - CY) < HW, onB = Math.abs(px - CX) < HW; if (!onA && !onB) continue; c.fillStyle = t < .5 ? '#fff' : '#000'; c.fillRect(px, py, 6 + rs() * 22, 3 + rs() * 8); }
      c.globalAlpha = 1;
      // lề đường
      c.fillStyle = '#d3d7de';
      c.fillRect(x0, CY - HW - 2, CX - HW - x0, 2); c.fillRect(CX + HW, CY - HW - 2, x1 - CX - HW, 2); c.fillRect(x0, CY + HW, CX - HW - x0, 2); c.fillRect(CX + HW, CY + HW, x1 - CX - HW, 2);
      c.fillRect(CX - HW - 2, y0, 2, CY - HW - y0); c.fillRect(CX - HW - 2, CY + HW, 2, y1 - CY - HW); c.fillRect(CX + HW, y0, 2, CY - HW - y0); c.fillRect(CX + HW, CY + HW, 2, y1 - CY - HW);
      // vạch giữa đôi vàng
      c.fillStyle = '#e8b923';
      const dy = [[x0, CX - HW - 92], [CX + HW + 92, x1]], dyB = [[y0, CY - HW - 92], [CY + HW + 92, y1]];
      for (const [a, b] of dy) { c.fillRect(a, CY - 3.5, b - a, 2); c.fillRect(a, CY + 1.5, b - a, 2); }
      for (const [a, b] of dyB) { c.fillRect(CX - 3.5, a, 2, b - a); c.fillRect(CX + 1.5, a, 2, b - a); }
      // vạch phân làn nét đứt
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2; c.setLineDash([18, 14]);
      for (const sgn of [-1, 1]) {
        c.beginPath(); c.moveTo(x0, CY + sgn * 35); c.lineTo(CX - HW - 100, CY + sgn * 35); c.moveTo(CX + HW + 100, CY + sgn * 35); c.lineTo(x1, CY + sgn * 35); c.stroke();
        c.beginPath(); c.moveTo(CX + sgn * 35, y0); c.lineTo(CX + sgn * 35, CY - HW - 100); c.moveTo(CX + sgn * 35, CY + HW + 100); c.lineTo(CX + sgn * 35, y1); c.stroke();
      }
      c.setLineDash([]);
      // ô giao nhau: vạch kẻ ô vuông vàng mờ
      c.strokeStyle = 'rgba(232,185,35,.22)'; c.lineWidth = 1.5; c.strokeRect(CX - HW + 4, CY - HW + 4, 2 * HW - 8, 2 * HW - 8);
      // vạch người đi bộ (vằn)
      c.fillStyle = 'rgba(255,255,255,.88)';
      for (const cw of CWS) {
        if (cw.w < cw.h) for (let y = cw.y + 4; y < cw.y + cw.h - 4; y += 12) c.fillRect(cw.x + 1, y, cw.w - 2, 6.5);
        else for (let x = cw.x + 4; x < cw.x + cw.w - 4; x += 12) c.fillRect(x, cw.y + 1, 6.5, cw.h - 2);
      }
      // mũi tên đi thẳng
      c.fillStyle = 'rgba(255,255,255,.6)';
      for (const L of S.lanes) {
        const [px, py] = lanePos(L, -STOP - 50), a = L.ang; c.save(); c.translate(px, py); c.rotate(a); c.beginPath(); c.moveTo(11, 0); c.lineTo(1, -7); c.lineTo(1, -2.5); c.lineTo(-11, -2.5); c.lineTo(-11, 2.5); c.lineTo(1, 2.5); c.lineTo(1, 7); c.closePath(); c.fill(); c.restore();
      }
      // vạch dừng (trắng, đèn sẽ phủ màu lên)
      c.fillStyle = '#f2f4f7'; for (const s of STOPS) c.fillRect(s[1], s[2], s[3], s[4]);
      // cây ven đường, cột đèn
      for (const [tx, ty] of strees) if (tx > x0 - 20 && tx < x1 + 20 && ty > y0 - 20 && ty < y1 + 20) tree(c, tx, ty, 10, rs);
      for (const l of lamps) if (l.x > x0 - 20 && l.x < x1 + 20 && l.y > y0 - 20 && l.y < y1 + 20) {
        c.fillStyle = '#1b1f27'; c.beginPath(); c.arc(l.x, l.y, 3, 0, TAU); c.fill(); c.strokeStyle = '#1b1f27'; c.lineWidth = 2; c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(l.x + l.ax * 14, l.y + l.ay * 14); c.stroke();
        c.fillStyle = '#e8e2c0'; c.beginPath(); c.arc(l.x + l.ax * 14, l.y + l.ay * 14, 3.2, 0, TAU); c.fill();
      }
      // nhãn hướng
      const label = (t, x, y, a) => { c.save(); c.translate(x, y); c.rotate(a); c.font = '700 11px system-ui,sans-serif'; const w = c.measureText(t).width + 14; c.fillStyle = 'rgba(15,22,40,.82)'; rr(c, -w / 2, -9, w, 18, 9); c.fill(); c.fillStyle = '#cfe0ff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, 0, 0.5); c.restore(); };
      label('HƯỚNG A  ⇄', CX - 330, CY - HW - SWK / 2, 0); label('HƯỚNG A  ⇄', CX + 330, CY + HW + SWK / 2, 0);
      label('HƯỚNG B  ⇅', CX - HW - SWK / 2, CY - 270, -Math.PI / 2); label('HƯỚNG B  ⇅', CX + HW + SWK / 2, CY + 270, -Math.PI / 2);
    }

    /* ===== vẽ động ===== */
    function drawVeh(c, v, L) {
      const [px, py] = lanePos(L, v.u - v.len / 2, v.lat), ang = L.ang, Ln = v.len, W = v.wid;
      c.save(); c.translate(px + 3, py + 4); c.rotate(ang); c.globalAlpha = .3; c.fillStyle = '#000'; rr(c, -Ln / 2, -W / 2, Ln, W, W * .3); c.fill(); c.restore();
      c.save(); c.translate(px, py); c.rotate(ang);
      const tl = v.brake ? '#ff4036' : '#8e1e19';
      if (v.type === 'moto') {
        c.fillStyle = '#12161d'; rr(c, -Ln / 2, -1.9, Ln, 3.8, 1.5); c.fill();
        c.fillStyle = v.col; rr(c, -5, -2.6, 11, 5.2, 2); c.fill();
        c.strokeStyle = '#2a2f3a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(Ln * .18, -W / 2 + .5); c.lineTo(Ln * .18, W / 2 - .5); c.stroke();
        if (v.pax) { c.fillStyle = v.cloth2; c.beginPath(); c.ellipse(-6.5, 0, 2.6, 4.4, 0, 0, TAU); c.fill(); c.fillStyle = v.helm === '#ffffff' ? '#ffd23a' : '#fff'; c.beginPath(); c.arc(-6, 0, 2.8, 0, TAU); c.fill(); }
        c.fillStyle = v.cloth; c.beginPath(); c.ellipse(0, 0, 3.1, 5.2, 0, 0, TAU); c.fill();
        c.fillStyle = v.helm; c.beginPath(); c.arc(1.2, 0, 3.3, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(.4, -1.2, 1, 0, TAU); c.fill();
        c.fillStyle = '#fff3c0'; c.fillRect(Ln / 2 - 1.8, -1.2, 2, 2.4); c.fillStyle = tl; c.fillRect(-Ln / 2, -1.2, 1.8, 2.4);
      } else if (v.type === 'bus') {
        c.fillStyle = v.col; rr(c, -Ln / 2, -W / 2, Ln, W, 5); c.fill();
        c.fillStyle = '#f2f4f7'; rr(c, -Ln / 2 + 3, -W / 2 + 3, Ln - 6, W - 6, 3); c.fill();
        c.fillStyle = v.col; c.fillRect(-Ln / 2 + 3, -1.4, Ln - 6, 2.8);
        c.fillStyle = '#7e8896'; for (let k = 0; k < 3; k++) c.fillRect(-Ln / 2 + 14 + k * 26, -W / 2 + 6, 14, W - 12);
        c.fillStyle = '#16212e'; c.fillRect(Ln / 2 - 8, -W / 2 + 3, 5, W - 6); c.fillRect(-Ln / 2 + 2, -W / 2 + 4, 3, W - 8);
        c.fillStyle = '#ffb02e'; c.fillRect(Ln / 2 - 3, -W * .22, 2, W * .44);
        c.fillStyle = '#fff3c0'; c.fillRect(Ln / 2 - 2.5, -W / 2 + 1.5, 2.5, 4); c.fillRect(Ln / 2 - 2.5, W / 2 - 5.5, 2.5, 4);
        c.fillStyle = tl; c.fillRect(-Ln / 2, -W / 2 + 1.5, 2.6, 5); c.fillRect(-Ln / 2, W / 2 - 6.5, 2.6, 5);
      } else if (v.type === 'truck') {
        c.fillStyle = '#cfd5de'; rr(c, -Ln / 2, -W / 2, Ln - 28, W, 2); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 1; for (let x = -Ln / 2 + 8; x < Ln / 2 - 32; x += 9) { c.beginPath(); c.moveTo(x, -W / 2 + 1); c.lineTo(x, W / 2 - 1); c.stroke(); }
        c.fillStyle = v.col; rr(c, Ln / 2 - 27, -W / 2 + .5, 27, W - 1, 4); c.fill(); c.fillStyle = v.roof; rr(c, Ln / 2 - 22, -W / 2 + 4, 13, W - 8, 3); c.fill();
        c.fillStyle = '#16212e'; c.fillRect(Ln / 2 - 9, -W / 2 + 3, 5, W - 6);
        c.fillStyle = '#fff3c0'; c.fillRect(Ln / 2 - 2.5, -W / 2 + 2, 2.5, 4); c.fillRect(Ln / 2 - 2.5, W / 2 - 6, 2.5, 4);
        c.fillStyle = tl; c.fillRect(-Ln / 2, -W / 2 + 2, 2.6, 5); c.fillRect(-Ln / 2, W / 2 - 7, 2.6, 5);
      } else {
        c.fillStyle = v.col; rr(c, -Ln / 2, -W / 2, Ln, W, W * .32); c.fill();
        c.fillStyle = v.roof; rr(c, -Ln * .2, -W * .4, Ln * .44, W * .8, W * .2); c.fill();
        c.fillStyle = '#16212e'; c.beginPath(); c.moveTo(Ln * .24, -W * .38); c.lineTo(Ln * .37, -W * .31); c.lineTo(Ln * .37, W * .31); c.lineTo(Ln * .24, W * .38); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(-Ln * .23, -W * .38); c.lineTo(-Ln * .35, -W * .31); c.lineTo(-Ln * .35, W * .31); c.lineTo(-Ln * .23, W * .38); c.closePath(); c.fill();
        c.fillStyle = v.dark; c.fillRect(Ln * .15, -W / 2 - 1.4, 3.5, 2); c.fillRect(Ln * .15, W / 2 - .6, 3.5, 2);
        if (v.type === 'suv') { c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-Ln * .15, -W * .3); c.lineTo(Ln * .15, -W * .3); c.moveTo(-Ln * .15, W * .3); c.lineTo(Ln * .15, W * .3); c.stroke(); }
        if (v.type === 'taxi') { c.fillStyle = '#fff'; c.fillRect(-3, -W * .22, 8, W * .44); c.fillStyle = '#12301f'; c.fillRect(-1.6, -1.2, 5, 2.4); c.fillStyle = '#fff'; c.fillRect(-Ln * .2, -W * .4, 1.4, W * .8); }
        c.fillStyle = '#fff3c0'; c.fillRect(Ln / 2 - 3.5, -W * .42, 3.5, W * .22); c.fillRect(Ln / 2 - 3.5, W * .2, 3.5, W * .22);
        c.fillStyle = tl; c.fillRect(-Ln / 2, -W * .42, 3, W * .22); c.fillRect(-Ln / 2, W * .2, 3, W * .22);
      }
      c.restore();
    }
    function drawPed(c, p, rain) {
      const bob = Math.sin(p.ph) * (p.st === 'wait' ? 0 : 1.1);
      c.save(); c.globalAlpha = clamp(p.al, 0, 1); c.translate(p.x, p.y); c.rotate(p.ang);
      c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(1.5, 2, 4, 5, 0, 0, TAU); c.fill();
      c.fillStyle = p.col; c.beginPath(); c.ellipse(0, bob * .3, 2.6, 5.2, 0, 0, TAU); c.fill();
      c.fillStyle = '#e3b690'; c.fillRect(-.8, -6 + bob, 1.6, 1.4); c.fillRect(-.8, 4.6 - bob, 1.6, 1.4);
      c.fillStyle = p.hair; c.beginPath(); c.arc(1, 0, 3, 0, TAU); c.fill();
      if (rain) { c.rotate(-p.ang); c.fillStyle = p.umb; c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1; for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(k * 1.57 + .4) * 9, Math.sin(k * 1.57 + .4) * 9); c.stroke(); } c.fillStyle = '#222'; c.beginPath(); c.arc(0, 0, 1.2, 0, TAU); c.fill(); }
      c.restore();
    }
    function lampLit(light, k) { // k: 'r','y','g'
      if (light === 'n') return k === 'y' && (S.blink % 1) < .5;
      return light === k;
    }
    function drawHead(c, h) {
      const light = S.lights[h.g], horiz = h.o === 'h', w = horiz ? 42 : 15, ht = horiz ? 15 : 42;
      c.fillStyle = 'rgba(0,0,0,.35)'; rr(c, h.x - w / 2 + 2, h.y - ht / 2 + 3, w, ht, 5); c.fill();
      c.fillStyle = '#0d1016'; rr(c, h.x - w / 2, h.y - ht / 2, w, ht, 5); c.fill(); c.strokeStyle = '#2f3a4e'; c.lineWidth = 1.2; c.stroke();
      ['r', 'y', 'g'].forEach((k, i) => {
        const ox = horiz ? (i - 1) * 12 : 0, oy = horiz ? 0 : (i - 1) * 12, on = lampLit(light, k);
        c.fillStyle = on ? LCOL[k] : shade(LCOL[k], -.82); c.beginPath(); c.arc(h.x + ox, h.y + oy, 4.6, 0, TAU); c.fill();
        if (on) { c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(h.x + ox - 1.3, h.y + oy - 1.3, 1.4, 0, TAU); c.fill(); }
      });
      // bộ đếm lùi
      const cw = 42, chh = 23; let bx = h.x - cw / 2, by = h.y - chh / 2;
      if (h.cn === 'below') by = h.y + ht / 2 + 4; else if (h.cn === 'above') by = h.y - ht / 2 - chh - 4;
      else if (h.cn === 'left') { bx = h.x - w / 2 - cw - 4; by = h.y - chh / 2; } else { bx = h.x + w / 2 + 4; by = h.y - chh / 2; }
      c.fillStyle = '#07090d'; rr(c, bx, by, cw, chh, 3); c.fill(); c.strokeStyle = '#2f3a4e'; c.lineWidth = 1; c.stroke();
      let txt = light === 'r' ? S.countRed : S.count, col = LCOL[light] || '#ffc926';
      if (light === 'n' || !/^\d+$/.test(txt)) { txt = '--'; if (light === 'n' && (S.blink % 1) >= .5) col = 'rgba(255,201,38,.15)'; }
      if (txt.length === 1) txt = ' ' + txt; txt = txt.slice(-2);
      seg7(c, bx + 6, by + 4, 12, chh - 8, txt[0] === ' ' ? '' : txt[0], col); seg7(c, bx + cw - 18, by + 4, 12, chh - 8, txt[1], col);
    }
    function pedStripColor(road) { const s = S.ped[road]; return s === 'W' ? '#2bff7a' : s === 'F' ? ((S.blink * 2.5) % 1 < .5 ? '#ff3b30' : 'rgba(255,59,48,.1)') : '#ff3b30'; }

    function render() {
      for (const cv of S.targets) {
        if (!cv || !cv.offsetParent) continue;
        let rec = S.recs.get(cv); if (!rec) { rec = {}; S.recs.set(cv, rec); }
        const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = cv.clientWidth, ch = cv.clientHeight; if (cw < 10 || ch < 10) continue;
        if (rec.cw !== cw || rec.ch !== ch || rec.dpr !== dpr) {
          rec.cw = cw; rec.ch = ch; rec.dpr = dpr; rec.W = Math.round(cw * dpr); rec.H = Math.round(ch * dpr); cv.width = rec.W; cv.height = rec.H;
          rec.sc = Math.max(Math.min(cw / 1000, ch / 700), cw / 1280, ch / 960); rec.ox = cw / 2 - CX * rec.sc; rec.oy = ch / 2 - CY * rec.sc;
          rec.ctx = cv.getContext('2d'); buildStatic(rec);
        }
        drawTarget(rec);
      }
    }
    function drawTarget(rec) {
      const c = rec.ctx, dpr = rec.dpr, W = rec.W, H = rec.H, night = clamp((S.tod - .3) / .7, 0, 1);
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.drawImage(rec.stat, 0, 0);
      c.setTransform(dpr * rec.sc, 0, 0, dpr * rec.sc, dpr * rec.ox, dpr * rec.oy);
      const x0 = -rec.ox / rec.sc, y0 = -rec.oy / rec.sc, x1 = (rec.cw - rec.ox) / rec.sc, y1 = (rec.ch - rec.oy) / rec.sc;
      const raining = S.rain;
      // mưa ướt mặt đường
      if (raining) { c.fillStyle = 'rgba(120,160,210,.13)'; c.fillRect(x0, CY - HW, x1 - x0, 2 * HW); c.fillRect(CX - HW, y0, 2 * HW, y1 - y0); }
      // vạch dừng phủ màu theo đèn
      for (const s of STOPS) { const l = S.lights[s[0]]; c.fillStyle = l === 'n' ? ((S.blink % 1) < .5 ? '#ffc926' : '#f2f4f7') : (LCOL[l === 'g' ? 'g' : l === 'y' ? 'y' : 'r']); c.fillRect(s[1], s[2], s[3], s[4]); }
      // dải đèn người đi bộ ở hai đầu vạch
      for (const cw of CWS) {
        c.fillStyle = pedStripColor(cw.road);
        if (cw.w < cw.h) { c.fillRect(cw.x, cw.y - 3, cw.w, 3); c.fillRect(cw.x, cw.y + cw.h, cw.w, 3); } else { c.fillRect(cw.x - 3, cw.y, 3, cw.h); c.fillRect(cw.x + cw.w, cw.y, 3, cw.h); }
      }
      // người đi bộ
      for (const p of S.peds) drawPed(c, p, raining);
      // xe
      for (const L of S.lanes) for (const v of L.vs) { const u = v.u; if (u < -L.ext - 5) continue; drawVeh(c, v, L); }
      // đèn tín hiệu
      for (const h of HEADS) drawHead(c, h);
      // bóng mây
      if (night < .5 && !raining) { c.fillStyle = 'rgba(0,0,0,.07)'; for (const cl of S.clouds) { c.beginPath(); c.ellipse(cl.x, cl.y, cl.rx, cl.ry, 0, 0, TAU); c.fill(); } }
      // gợn nước
      if (raining) { c.lineWidth = 1; for (const r of S.ripples) { c.strokeStyle = `rgba(210,230,255,${(1 - r.a) * .5})`; c.beginPath(); c.ellipse(r.x, r.y, 2 + r.a * 7, 1 + r.a * 3.5, 0, 0, TAU); c.stroke(); } }

      /* ---- ánh sáng ---- */
      c.setTransform(1, 0, 0, 1, 0, 0);
      const td = S.tod, dark = td <= 1 ? lerp(0, .24, td) : lerp(.24, .66, td - 1), rainDark = raining ? .12 : 0;
      const cr = td <= 1 ? lerp(60, 55, td) : lerp(55, 5, td - 1), cg = td <= 1 ? lerp(60, 30, td) : lerp(30, 10, td - 1), cb = td <= 1 ? lerp(60, 70, td) : lerp(70, 38, td - 1);
      if (dark + rainDark > .005) { c.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${clamp(dark + rainDark, 0, .75)})`; c.fillRect(0, 0, W, H); }
      if (td > .15 && td <= 1.6) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,120,40,${.07 * Math.sin(clamp(td, 0, 1.6) / 1.6 * Math.PI)})`; c.fillRect(0, 0, W, H); }
      c.setTransform(dpr * rec.sc, 0, 0, dpr * rec.sc, dpr * rec.ox, dpr * rec.oy);
      c.globalCompositeOperation = 'lighter';
      // đèn đường
      if (night > 0) for (const l of lamps) { const lx = l.x + l.ax * 14, ly = l.y + l.ay * 14; if (lx < x0 - 100 || lx > x1 + 100 || ly < y0 - 100 || ly > y1 + 100) continue; c.globalAlpha = .62 * night; c.drawImage(glow('rgba(255,222,150,1)', 100), lx - 100, ly - 100, 200, 200); }
      // xe
      for (const L of S.lanes) for (const v of L.vs) {
        if (v.u < -L.ext + 10) continue; const [px, py] = lanePos(L, v.u - v.len / 2, v.lat);
        c.save(); c.translate(px, py); c.rotate(L.ang);
        if (night > 0) { c.globalAlpha = .6 * night; const cl = v.type === 'moto' ? 62 : v.type === 'bus' || v.type === 'truck' ? 105 : 92, wd = v.type === 'moto' ? 18 : 28; c.drawImage(cone(cl, wd), v.len / 2 - 2, -wd); }
        const bl = v.brake ? .95 : (night > 0 ? .3 * night : 0); if (bl > 0) { c.globalAlpha = bl; const g = glow('rgba(255,50,40,1)', 14); c.drawImage(g, -v.len / 2 - 12, -v.wid * .31 - 12); c.drawImage(g, -v.len / 2 - 12, v.wid * .31 - 12); }
        c.restore();
      }
      // đèn tín hiệu phát sáng
      for (const h of HEADS) {
        const light = S.lights[h.g], horiz = h.o === 'h';
        ['r', 'y', 'g'].forEach((k, i) => { if (!lampLit(light, k)) return; const ox = horiz ? (i - 1) * 12 : 0, oy = horiz ? 0 : (i - 1) * 12; c.globalAlpha = .45 + .45 * night; const col = k === 'r' ? 'rgba(255,59,48,1)' : k === 'y' ? 'rgba(255,201,38,1)' : 'rgba(43,255,122,1)'; c.drawImage(glow(col, 30), h.x + ox - 30, h.y + oy - 30); });
      }
      // dải vạch dừng phát sáng
      for (const s of STOPS) { const l = S.lights[s[0]]; if (l === 'n' && (S.blink % 1) >= .5) continue; const k = l === 'g' ? 'rgba(43,255,122,1)' : l === 'y' || l === 'n' ? 'rgba(255,201,38,1)' : 'rgba(255,59,48,1)'; c.globalAlpha = .18 + .3 * night; c.drawImage(glow(k, 40), s[1] + s[3] / 2 - 40, s[2] + s[4] / 2 - 40, 80, 80); }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      // vẽ lại thấu kính đèn cho sáng rõ trên nền tối
      for (const h of HEADS) { const light = S.lights[h.g], horiz = h.o === 'h'; ['r', 'y', 'g'].forEach((k, i) => { if (!lampLit(light, k)) return; const ox = horiz ? (i - 1) * 12 : 0, oy = horiz ? 0 : (i - 1) * 12; c.fillStyle = LCOL[k]; c.beginPath(); c.arc(h.x + ox, h.y + oy, 4.6, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(h.x + ox - 1.3, h.y + oy - 1.3, 1.4, 0, TAU); c.fill(); }); }
      // mưa
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (raining) { c.strokeStyle = `rgba(200,220,255,${.28 + .2 * night})`; c.lineWidth = Math.max(1, dpr * .9); c.beginPath(); for (const d of S.rainDrops) { const x = d.x * W, y = d.y * H, l = d.l * dpr; c.moveTo(x, y); c.lineTo(x - l * .25, y + l); } c.stroke(); }
      // viền tối nhẹ
      const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .45, W / 2, H / 2, Math.max(W, H) * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.38)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    }
    S.render = render;
    S.clear();
    return S;
  }
  root.SCENE = { create };
})(window);
