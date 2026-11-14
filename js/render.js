/* render.js — vẽ sơ đồ 2D bằng SVG, tô màu dây theo giá trị logic, xung chạy dọc dây, LED 7 đoạn, đèn giao thông. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const X = 'X';
  const el = (name, attrs, parent, text) => {
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  /* màu theo loại dây: on = màu khi "tích cực"; low = tích cực mức thấp */
  const NET_STYLE = {
    CLK: { on: '#ffb02e' },
    RST_N: { on: '#ff8a3d', low: true }, RST: { on: '#ff8a3d' }, RSY_N: { on: '#ff8a3d', low: true }, RSY: { on: '#ff8a3d' }, MEN: { on: '#ff8a3d' },
    HET_N: { on: '#b57cff', low: true }, Z: { on: '#b57cff' }, BOR: { on: '#4ea1ff' }
  };
  const BUS_PREFIX = /^(TX|TV|NU|NC|CU|CC)\d$/;
  const styleOf = n => NET_STYLE[n] || (BUS_PREFIX.test(n) ? { on: '#4ea1ff' } : { on: '#35e58a' });

  const LAMP = { green: ['#2bff7a', '#0f3a24'], yellow: ['#ffd23a', '#41390f'], red: ['#ff3b3b', '#411616'] };
  const SEG = { // a b c d e f g trên ô 40×70 (gốc tại góc trên trái của chữ số)
    a: '8,4 32,4 28,10 12,10', b: '34,6 34,32 28,28 28,12', c: '34,38 34,64 28,58 28,42', d: '8,66 32,66 28,60 12,60',
    e: '6,38 6,64 12,58 12,42', f: '6,6 6,32 12,28 12,12', g: '8,35 32,35 28,40 12,40' };
  const DIGIT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg']; // BCD 247: 0–9

  function create(svg, ctx) {
    const { circuit, layout, routes } = ctx;
    const comps = layout.comps;
    const R = { svg, vb: { x: 0, y: 0, w: layout.W, h: layout.H }, netEls: {}, compEls: {}, lampEls: {}, hexEls: {}, swEls: {}, probeEls: {}, pulses: [], pulsesOn: true, vals: {} };
    svg.setAttribute('viewBox', `0 0 ${layout.W} ${layout.H}`);

    const defs = el('defs', null, svg);
    const glow = el('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '4' }, glow);

    const gFrames = el('g', { class: 'frames' }, svg), gWires = el('g', { class: 'wires' }, svg), gComps = el('g', { class: 'comps' }, svg), gTitles = el('g', { class: 'titles' }, svg),
      gProbes = el('g', { class: 'probes' }, svg), gPulses = el('g', { class: 'pulses' }, svg);
    R.gPulses = gPulses;

    /* ---------- khung khối ---------- */
    for (const f of layout.frames) {
      const g0 = el('g', { class: 'frame', 'data-frame': f.id }, gFrames);
      el('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 14, class: 'frame-box' }, g0);
      const g = el('g', { class: 'frame-lbl' }, gTitles);
      el('rect', { x: f.x + 8, y: f.y + 6, width: Math.max(f.title.length * 7.6, f.sub.length * 5.6) + 16, height: 38, rx: 6, class: 'frame-pill' }, g);
      el('text', { x: f.x + 16, y: f.y + 22, class: 'frame-title' }, g, f.title);
      el('text', { x: f.x + 16, y: f.y + 37, class: 'frame-sub' }, g, f.sub);
    }

    /* ---------- dây ---------- */
    function netGroup(name) {
      if (R.netEls[name]) return R.netEls[name];
      const st = styleOf(name);
      const g = el('g', { class: 'net', 'data-net': name, 'data-act': '0' }, gWires);
      g.style.setProperty('--on', st.on);
      const o = { g, low: !!st.low, style: st, dots: [] };
      R.netEls[name] = o; return o;
    }
    const pathD = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    const addSeg = (name, pts) => { const o = netGroup(name); const d = pathD(pts);
      el('path', { d, class: 'g' }, o.g); el('path', { d, class: 'w' }, o.g); el('path', { d, class: 'hit' }, o.g); };
    for (const [name, r] of Object.entries(routes)) {
      netGroup(name);
      r.branches.forEach(b => addSeg(name, b));
      r.junctions.forEach(j => { const o = R.netEls[name]; o.dots.push(el('circle', { cx: j[0], cy: j[1], r: 3.2, class: 'dot' }, o.g)); });
    }
    // đường đi đầy đủ nguồn → tải (cho xung chạy)
    R.paths = {};
    for (const [name, r] of Object.entries(routes)) {
      R.paths[name] = Object.entries(r.paths).map(([k, pts]) => { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1] }; });
    }

    /* ---------- hàm vẽ chân ---------- */
    function drawPin(g, p, c) {
      // đoạn chân ex→tx: thuộc dây (đổi màu theo net) hoặc nối hằng
      if (p.net && !p.tie) {
        addSeg(p.net, [[p.ex, p.ey], [p.tx, p.ty]]);
      } else {
        const cls = p.tie ? 'tie tie-' + p.tie : 'open';
        el('line', { x1: p.ex, y1: p.ey, x2: p.tx, y2: p.ty, class: cls }, g);
        if (p.tie) {
          const dir = p.dir === 'in' ? -1 : 1;
          el('rect', { x: p.tx + (dir < 0 ? -9 : 0), y: p.ty - 4, width: 9, height: 8, rx: 2, class: 'tie-box tie-box-' + p.tie }, g);
          el('text', { x: p.tx + (dir < 0 ? -4.5 : 4.5), y: p.ty + 3.2, class: 'tie-txt', 'text-anchor': 'middle' }, g, p.tie === 'ONE' ? '1' : '0');
        } else el('circle', { cx: p.tx, cy: p.ty, r: 2.2, class: 'open-dot' }, g);
      }
      if (p.num !== '' && p.num !== undefined) el('text', { x: p.dir === 'in' ? p.ex - 3 : p.ex + 3, y: p.ty - 3, class: 'pin-num', 'text-anchor': p.dir === 'in' ? 'end' : 'start' }, g, p.num);
    }

    function drawIC(c) {
      const g = el('g', { class: 'comp ic', 'data-id': c.id }, gComps);
      el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, class: 'ic-box' }, g);
      el('text', { x: c.x + 10, y: c.y + 17, class: 'ic-title' }, g, c.title);
      el('text', { x: c.x + c.w - 8, y: c.y + 17, class: 'ic-part', 'text-anchor': 'end' }, g, c.ic);
      const short = { U4: 'MUX hàng đơn vị', U5: 'MUX hàng chục', U2: 'Đếm lùi · đơn vị', U3: 'Đếm lùi · chục', U6: 'Trạng thái Q1Q0', U12: 'Đồng bộ RESET' }[c.id];
      if (short) el('text', { x: c.x + c.w / 2, y: c.y + 31, class: 'ic-sub', 'text-anchor': 'middle' }, g, short);
      if (c.kind === 'IC74') { // vạch chia hai nửa
        const ys = c.pinsOut.filter(p => p.half === 2 && p.dir === 'in').map(p => p.ey), y0 = Math.min(...ys) - 28;
        el('line', { x1: c.x + 6, y1: y0, x2: c.x + c.w - 6, y2: y0, class: 'ic-split' }, g);
      }
      for (const p of c.pinsOut) {
        drawPin(g, p, c);
        el('text', { x: p.dir === 'in' ? c.x + 7 : c.x + c.w - 7, y: p.ey + 3.5, class: 'pin-name', 'text-anchor': p.dir === 'in' ? 'start' : 'end' }, g, p.name);
      }
      R.compEls[c.id] = g; return g;
    }

    /* ---------- cổng logic ---------- */
    function gatePath(type, x, y, w, h) {
      const bub = (type === 'NAND' || type === 'NOR8' || type === 'NOT') ? 8 : 0, bw = w - bub, m = y + h / 2;
      const or = `M${x} ${y} C${x + bw * 0.5} ${y} ${x + bw * 0.85} ${y + h * 0.18} ${x + bw} ${m} C${x + bw * 0.85} ${y + h - h * 0.18} ${x + bw * 0.5} ${y + h} ${x} ${y + h} Q${x + 16} ${m} ${x} ${y}Z`;
      switch (type) {
        case 'OR': case 'NOR8': return or;
        case 'XOR': return or;
        case 'NOT': return `M${x} ${y} L${x + bw} ${m} L${x} ${y + h}Z`;
      }
    }
    function drawGate(c) {
      const g = el('g', { class: 'comp gate', 'data-id': c.id }, gComps);
      const type = c.gate, bub = (type === 'NAND' || type === 'NOR8') ? 8 : 0, bw = c.w - bub, m = c.y + c.h / 2;
      if (type === 'AND' || type === 'NAND') {
        const r = 22; el('path', { d: `M${c.x} ${c.y} H${c.x + bw - r} A${r} ${c.h / 2} 0 0 1 ${c.x + bw - r} ${c.y + c.h} H${c.x}Z`, class: 'gate-body' }, g);
      } else {
        el('path', { d: gatePath(type, c.x, c.y, c.w, c.h), class: 'gate-body' }, g);
        if (type === 'XOR') el('path', { d: `M${c.x - 7} ${c.y} Q${c.x + 9} ${m} ${c.x - 7} ${c.y + c.h}`, class: 'gate-xor' }, g);
      }
      if (bub) el('circle', { cx: c.x + c.w - 4, cy: m, r: 4, class: 'gate-bubble' }, g);
      el('text', { x: c.x + c.w / 2 - 4, y: m + 3.5, class: 'gate-type', 'text-anchor': 'middle' }, g, { NOR8: 'NOR-8', NAND: 'NAND', AND: 'AND', OR: 'OR', XOR: 'XOR' }[type]);
      el('text', { x: c.x + 2, y: c.y - 6, class: 'gate-id' }, g, c.title);
      c.pinsOut.forEach(p => drawPin(g, p, c));
      R.compEls[c.id] = g;
    }
    function drawU9(c) {
      const g = el('g', { class: 'comp ic', 'data-id': c.id }, gComps);
      el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, class: 'ic-box' }, g);
      el('text', { x: c.x + 10, y: c.y + 17, class: 'ic-title' }, g, 'U9');
      el('text', { x: c.x + c.w - 8, y: c.y + 17, class: 'ic-part', 'text-anchor': 'end' }, g, '74LS04');
      const names = ['RST_N → RST', 'RSY_N → RSY', 'Q0 → Q0_N', 'Q1 → Q1_N'];
      for (let i = 0; i < 4; i++) {
        const pi = c.pinsOut.find(p => p.gi === i && p.dir === 'in'), po = c.pinsOut.find(p => p.gi === i && p.dir === 'out'), y = pi.ey;
        addSeg(pi.net, [[c.x, y], [c.x + 34, y]]); addSeg(po.net, [[c.x + 66, y], [c.x + c.w, y]]);
        el('path', { d: `M${c.x + 34} ${y - 14} L${c.x + 62} ${y} L${c.x + 34} ${y + 14}Z`, class: 'gate-body' }, g);
        el('circle', { cx: c.x + 64, cy: y, r: 4, class: 'gate-bubble' }, g);
        el('text', { x: c.x + c.w / 2, y: y + 27, class: 'ic-sub', 'text-anchor': 'middle' }, g, names[i]);
        drawPin(g, pi, c); drawPin(g, po, c);
      }
      el('text', { x: c.x + c.w / 2, y: c.y + c.h - 8, class: 'ic-sub', 'text-anchor': 'middle' }, g, '(2 cổng còn lại: ngõ vào nối 0)');
      R.compEls[c.id] = g;
    }

    /* ---------- LED 7 đoạn ---------- */
    function drawHex(c) {
      const g = el('g', { class: 'comp hex', 'data-id': c.id }, gComps);
      el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 8, class: 'hex-box' }, g);
      el('text', { x: c.x + 10, y: c.y + 15, class: 'ic-title' }, g, c.title);
      el('text', { x: c.x + c.w / 2, y: c.y + c.h - 8, class: 'ic-sub', 'text-anchor': 'middle' }, g, '74LS247 + LED 7 đoạn');
      const dg = el('g', { transform: `translate(${c.x + 38},${c.y + 28})` }, g), segs = {};
      for (const k of Object.keys(SEG)) segs[k] = el('polygon', { points: SEG[k], class: 'seg' }, dg);
      const xt = el('text', { x: 20, y: 52, class: 'hex-x', 'text-anchor': 'middle', visibility: 'hidden' }, dg, 'X');
      c.pinsOut.forEach(p => { drawPin(g, p, c); el('text', { x: c.x + 7, y: p.ey + 3.5, class: 'pin-name' }, g, p.net); });
      R.hexEls[c.id] = { segs, xt, ins: c.ins };
      R.compEls[c.id] = g;
    }
    function setHex(id, nib) {
      const h = R.hexEls[id];
      if (nib === X) { for (const k in h.segs) h.segs[k].setAttribute('class', 'seg segx'); h.xt.setAttribute('visibility', 'visible'); return; }
      h.xt.setAttribute('visibility', 'hidden');
      const on = nib <= 9 ? DIGIT[nib] : '';
      for (const k in h.segs) h.segs[k].setAttribute('class', on.includes(k) ? 'seg on' : 'seg');
    }

    /* ---------- đèn ---------- */
    function drawLamp(c) {
      const g = el('g', { class: 'comp lamp', 'data-id': c.id }, gComps);
      const cx = c.x + 20, cy = c.y + 20, col = LAMP[c.color];
      const halo = el('circle', { cx, cy, r: 24, fill: col[0], opacity: 0, filter: 'url(#glow)' }, g);
      const body = el('circle', { cx, cy, r: 16, class: 'lamp-body', fill: col[1], stroke: col[0] }, g);
      el('text', { x: cx, y: cy + 4, class: 'lamp-txt', 'text-anchor': 'middle' }, g, c.title);
      el('text', { x: c.x + 52, y: cy + 4, class: 'ic-sub' }, g, { LXA: 'Xanh A', LVA: 'Vàng A', LDA: 'Đỏ A', LXB: 'Xanh B', LVB: 'Vàng B', LDB: 'Đỏ B' }[c.id]);
      drawPin(g, c.pinsOut[0], c);
      R.lampEls[c.id] = { halo, body, col };
      R.compEls[c.id] = g;
    }
    function setLamp(id, v) {
      const l = R.lampEls[id]; if (!l) return;
      if (v === X) { l.body.setAttribute('fill', '#3a3f4f'); l.halo.setAttribute('opacity', 0); l.body.classList.add('xblink'); return; }
      l.body.classList.remove('xblink');
      l.body.setAttribute('fill', v ? l.col[0] : l.col[1]); l.halo.setAttribute('opacity', v ? 0.75 : 0);
    }

    /* ---------- nguồn, công tắc ---------- */
    function drawSource(c) {
      const g = el('g', { class: 'comp src', 'data-id': c.id }, gComps);
      el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 6, class: 'ic-box' }, g);
      if (c.kind === 'CLOCK') {
        el('text', { x: c.x + 10, y: c.y + 16, class: 'ic-title' }, g, 'CLOCK');
        el('text', { x: c.x + c.w - 8, y: c.y + 16, class: 'ic-part', 'text-anchor': 'end' }, g, 'NE555');
        el('path', { d: `M${c.x + 14} ${c.y + 34} h10 v-10 h14 v10 h14 v-10 h14 v10 h10`, class: 'clk-icon' }, g);
        R.clkIcon = g.querySelector('.clk-icon');
      } else if (c.kind === 'BTN') {
        el('text', { x: c.x + 10, y: c.y + 16, class: 'ic-title' }, g, 'RESET');
        const knob = el('rect', { x: c.x + 52, y: c.y + 22, width: 38, height: 14, rx: 7, class: 'btn-track' }, g);
        const dot = el('circle', { cx: c.x + 59, cy: c.y + 29, r: 5.5, class: 'btn-knob' }, g);
        R.swEls[c.id] = { knob, dot, x0: c.x + 59, x1: c.x + 83 };
        g.style.cursor = 'pointer'; g.addEventListener('click', ev => { ev.stopPropagation(); ctx.onSwitch && ctx.onSwitch(c.id); });
        R.btnLabel = el('text', { x: c.x + 10, y: c.y + 32, class: 'ic-sub' }, g, 'giữ');
      } else {
        el('text', { x: c.x + 8, y: c.y + 14, class: 'sw-label' }, g, c.title);
        const track = el('rect', { x: c.x + 56, y: c.y + 4, width: 34, height: 12, rx: 6, class: 'sw-track' }, g);
        const knob = el('circle', { cx: c.x + 62, cy: c.y + 10, r: 5, class: 'sw-knob' }, g);
        R.swEls[c.id] = { track, knob, x0: c.x + 62, x1: c.x + 84 };
        g.style.cursor = 'pointer'; g.addEventListener('click', ev => { ev.stopPropagation(); ctx.onSwitch && ctx.onSwitch(c.id); });
      }
      drawPin(g, c.pinsOut[0], c);
      R.compEls[c.id] = g;
    }
    R.setSwitch = (id, v) => {
      const s = R.swEls[id]; if (!s) return;
      if (id === 'SW-RESET') { // v = RST_N: 0 = đang giữ reset
        s.dot.setAttribute('cx', v ? s.x1 : s.x0); s.knob.setAttribute('class', 'btn-track ' + (v ? 'rel' : 'held'));
        if (R.btnLabel) R.btnLabel.textContent = v ? 'đã nhả' : 'đang giữ';
        return;
      }
      s.knob.setAttribute('cx', v ? s.x1 : s.x0); s.track.setAttribute('class', 'sw-track ' + (v ? 'on' : ''));
    };

    for (const id of layout.order) {
      const c = comps[id];
      if (c.kind === 'GATE') drawGate(c);
      else if (c.kind === 'IC04') drawU9(c);
      else if (c.kind === 'HEX') drawHex(c);
      else if (c.kind === 'LAMP') drawLamp(c);
      else if (c.kind === 'CLOCK' || c.kind === 'BTN' || c.kind === 'SW') drawSource(c);
      else drawIC(c);
    }
    // chấm tie legend
    for (const id of layout.order) {
      const g = R.compEls[id]; if (!g) continue;
      g.addEventListener('click', ev => { if (c_isSwitch(id) || R.dragged) return; ev.stopPropagation(); ctx.onSelect && ctx.onSelect(id); });
    }
    function c_isSwitch(id) { const k = comps[id].kind; return k === 'SW' || k === 'BTN'; }

    /* ---------- probe (huy hiệu giá trị trên dây) ---------- */
    const PROBES = ['CLK', 'RST_N', 'RSY', 'MEN', 'HET_N', 'Z', 'BOR', 'Q0', 'Q1'];
    const avoid = [];   // các hình chữ nhật cần tránh: nhãn khung + thân linh kiện
    for (const f of layout.frames) avoid.push([f.x + 4, f.y + 2, Math.max(f.title.length * 7.6, f.sub.length * 5.6) + 24, 46]);
    for (const id of layout.order) { const c = comps[id]; avoid.push([c.x - 24, c.y - 14, c.w + 48, c.h + 28]); }
    const hit = (r, q) => r[0] < q[0] + q[2] && r[0] + r[2] > q[0] && r[1] < q[1] + q[3] && r[1] + r[3] > q[1];
    const placed = [];
    for (const n of PROBES) {
      const r = routes[n]; if (!r) continue;
      const w = n.length * 6.6 + 24, cands = [];
      for (const br of r.branches) for (let i = 1; i < br.length; i++) {
        const a = br[i - 1], d = br[i], len = Math.abs(d[0] - a[0]) + Math.abs(d[1] - a[1]); if (len < 30) continue;
        for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) cands.push({ x: a[0] + (d[0] - a[0]) * f, y: a[1] + (d[1] - a[1]) * f, len, horiz: a[1] === d[1] });
      }
      cands.sort((p, q) => (q.horiz - p.horiz) || (q.len - p.len));
      let best = cands.find(c => { const rc = [c.x - w / 2, c.y - 10, w, 20]; return !avoid.some(q => hit(rc, q)) && !placed.some(q => hit(rc, q)); }) || cands[0];
      if (!best) { const b0 = r.branches[0]; best = { x: b0[0][0] + 10, y: b0[0][1] }; }
      placed.push([best.x - w / 2 - 4, best.y - 12, w + 8, 24]);
      const g = el('g', { class: 'probe', 'data-net': n, transform: `translate(${best.x},${best.y})` }, gProbes);
      el('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 9, class: 'probe-box' }, g);
      const dot = el('circle', { cx: -w / 2 + 10, cy: 0, r: 4, class: 'probe-dot' }, g);
      el('text', { x: -w / 2 + 19, y: 3.6, class: 'probe-txt' }, g, n);
      R.probeEls[n] = { g, dot };
      g.addEventListener('click', ev => { ev.stopPropagation(); ctx.onNet && ctx.onNet(n); });
    }

    /* ---------- cập nhật giá trị ---------- */
    R.setValue = (net, v) => {
      R.vals[net] = v;
      const o = R.netEls[net];
      if (o) { const act = v === X ? 'X' : (o.low ? (v === 0 ? '1' : '0') : String(v)); o.g.setAttribute('data-act', act); }
      const p = R.probeEls[net];
      if (p) { const st = styleOf(net), act = v === X ? 'X' : (st.low ? (v === 0 ? 1 : 0) : v);
        p.dot.setAttribute('fill', act === 'X' ? '#ff4d4d' : (act ? st.on : '#3b4660')); p.g.setAttribute('data-act', act === 'X' ? 'X' : String(act)); p.dot.setAttribute('class', 'probe-dot' + (act === 'X' ? ' xblink' : '')); }
      // lamps
      for (const id in R.lampEls) if (comps[id].ins[0] === net) setLamp(id, v);
      // hex
      if (/^(CU|CC)\d$/.test(net)) { const id = net[1] === 'U' ? 'HEX1' : 'HEX2', pre = net.slice(0, 2); R.hexDirty = R.hexDirty || {}; R.hexDirty[id] = pre; }
    };
    R.flushHex = () => {
      if (!R.hexDirty) return;
      for (const id in R.hexDirty) { const pre = R.hexDirty[id]; let nib = 0, bad = false; for (let i = 0; i < 4; i++) { const v = R.vals[pre + i]; if (v === X || v === undefined) bad = true; else nib += v << i; } setHex(id, bad ? X : nib); }
      R.hexDirty = null;
    };
    R.refreshAll = sim => {
      for (const n in R.netEls) R.setValue(n, sim.get(n));
      for (const id in R.swEls) { if (id === 'SW-RESET') R.setSwitch(id, sim.get('RST_N')); else R.setSwitch(id, sim.sw[id]); }
      R.hexDirty = { HEX1: 'CU', HEX2: 'CC' }; R.flushHex();
    };

    /* ---------- xung chạy dọc dây ---------- */
    const PULSE_MS = 420;
    R.pulse = (net, v, now) => {
      if (!R.pulsesOn) return;
      const paths = R.paths[net]; if (!paths) return;
      if (R.pulses.length > 260) return;
      const st = styleOf(net), act = v === X ? 'X' : (st.low ? (v === 0 ? 1 : 0) : v);
      const color = act === 'X' ? '#ff4d4d' : (act ? st.on : '#8fa0c0');
      for (const p of paths) { if (p.len === 0) continue; const c = el('circle', { r: act ? 3.6 : 3, fill: color, class: 'pulse' }, gPulses); R.pulses.push({ c, p, t0: now, ms: Math.min(PULSE_MS + p.len * 0.9, 1100) }); }
    };
    R.tick = now => {
      R.flushHex();
      for (let i = R.pulses.length - 1; i >= 0; i--) {
        const q = R.pulses[i], f = (now - q.t0) / q.ms;
        if (f >= 1) { q.c.remove(); R.pulses.splice(i, 1); continue; }
        const d = f * q.p.len; let k = 1; while (k < q.p.cum.length - 1 && q.p.cum[k] < d) k++;
        const a = q.p.pts[k - 1], b = q.p.pts[k], seg = q.p.cum[k] - q.p.cum[k - 1] || 1, u = (d - q.p.cum[k - 1]) / seg;
        q.c.setAttribute('cx', a[0] + (b[0] - a[0]) * u); q.c.setAttribute('cy', a[1] + (b[1] - a[1]) * u);
        q.c.setAttribute('opacity', f < 0.85 ? 1 : (1 - f) / 0.15);
      }
    };
    R.clearPulses = () => { R.pulses.forEach(q => q.c.remove()); R.pulses.length = 0; };

    /* ---------- chọn / làm nổi ---------- */
    R.selectComp = id => { svg.querySelectorAll('.comp.sel').forEach(e => e.classList.remove('sel')); if (id && R.compEls[id]) R.compEls[id].classList.add('sel'); };
    R.hoverNet = (name, on) => { const o = R.netEls[name]; if (o) o.g.classList.toggle('hl', on); };
    svg.addEventListener('pointerover', ev => { const g = ev.target.closest && ev.target.closest('.net'); if (g) { R.hoverNet(g.dataset.net, true); ctx.onNetHover && ctx.onNetHover(g.dataset.net, ev); } });
    svg.addEventListener('pointerout', ev => { const g = ev.target.closest && ev.target.closest('.net'); if (g) { R.hoverNet(g.dataset.net, false); ctx.onNetHover && ctx.onNetHover(null, ev); } });
    svg.addEventListener('click', ev => { if (R.dragged) return; const g = ev.target.closest && ev.target.closest('.net'); if (g) ctx.onNet && ctx.onNet(g.dataset.net); });

    /* ---------- zoom / kéo ---------- */
    const setVB = () => svg.setAttribute('viewBox', `${R.vb.x} ${R.vb.y} ${R.vb.w} ${R.vb.h}`);
    R.fit = () => { R.vb = { x: 0, y: 0, w: layout.W, h: layout.H }; setVB(); };
    R.focus = id => { const f = layout.frames.find(f => f.id === id); if (!f) return R.fit();
      const asp = svg.clientWidth / svg.clientHeight, pad = 40; let w = f.w + pad * 2, h = f.h + pad * 2; if (w / h < asp) w = h * asp; else h = w / asp;
      R.vb = { x: f.x + f.w / 2 - w / 2, y: f.y + f.h / 2 - h / 2, w, h }; setVB(); };
    svg.addEventListener('wheel', ev => { ev.preventDefault(); const r = svg.getBoundingClientRect(), k = ev.deltaY < 0 ? 0.85 : 1 / 0.85;
      const px = R.vb.x + (ev.clientX - r.left) / r.width * R.vb.w, py = R.vb.y + (ev.clientY - r.top) / r.height * R.vb.h;
      const nw = Math.min(layout.W * 1.2, Math.max(260, R.vb.w * k)), nh = nw * R.vb.h / R.vb.w;
      R.vb = { x: px - (px - R.vb.x) * nw / R.vb.w, y: py - (py - R.vb.y) * nh / R.vb.h, w: nw, h: nh }; setVB(); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', ev => { if (ev.target.closest('.comp.src') || ev.target.closest('.probe')) return; drag = { x: ev.clientX, y: ev.clientY, vx: R.vb.x, vy: R.vb.y, moved: false, id: ev.pointerId }; });
    svg.addEventListener('pointermove', ev => { if (!drag) return; const r = svg.getBoundingClientRect(); const dx = (ev.clientX - drag.x) / r.width * R.vb.w, dy = (ev.clientY - drag.y) / r.height * R.vb.h;
      if (!drag.moved) { if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 5) return; drag.moved = true; try { svg.setPointerCapture(drag.id); } catch (e) {} }
      R.vb.x = drag.vx - dx; R.vb.y = drag.vy - dy; setVB(); });
    const endDrag = () => { if (drag && drag.moved) { R.dragged = true; setTimeout(() => { R.dragged = false; }, 0); } drag = null; };
    svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('dblclick', () => R.fit());
    return R;
  }

  const API = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RENDER = API;
})(typeof window !== 'undefined' ? window : globalThis);
