/* layout.js — hình học của sơ đồ 2D: vị trí linh kiện, tọa độ từng chân, danh sách dây (net).
 * Dùng chung cho tools/route.js (đi dây tự động) và render.js (vẽ). Toàn bộ tọa độ chia hết cho 10 (lưới đi dây).
 */
(function (root) {
  'use strict';
  const W = 1920, H = 840, PITCH = 20, STUB = 20, OX = 50, OY = 10;

  function build(CIRCUIT) {
    const comps = {}, order = [];
    const place = (c, geo) => { const o = Object.assign({}, c, geo, { pinsOut: [] }); comps[c.id] = o; order.push(c.id); return o; };
    const isConst = n => n === 'ONE' || n === 'ZERO';

    /* ---------- vị trí ---------- */
    const U4Y = 110, U5Y = 400, U2Y = 110, U3Y = 400;
    const rowY = (y0, r) => y0 + 40 + r * PITCH;
    const POS = {
      U4: { x: 330, y: U4Y }, U5: { x: 330, y: U5Y }, U2: { x: 560, y: U2Y }, U3: { x: 560, y: U3Y },
      G9: { x: 800, y: 300 }, G10: { x: 930, y: 360 }, HEX1: { x: 790, y: 110 }, HEX2: { x: 790, y: 470 },
      U12: { x: 1200, y: 110 }, U6: { x: 1200, y: 400 }, U9: { x: 1390, y: 110 }, G4: { x: 1580, y: 120 },
      G1: { x: 1040, y: 620 }, G2: { x: 1040, y: 440 }, G3: { x: 1040, y: 530 },
      G5: { x: 1560, y: 420 }, G6: { x: 1560, y: 480 }, G7: { x: 1560, y: 540 }, G8: { x: 1560, y: 600 },
      LXA: { x: 1700, y: 410 }, LVA: { x: 1700, y: 470 }, LDA: { x: 1700, y: 650 }, LXB: { x: 1700, y: 530 }, LVB: { x: 1700, y: 590 }, LDB: { x: 1700, y: 710 }
    };
    /* công tắc canh thẳng hàng với chân của U4 / U5 để dây chạy thẳng */
    const swRow = { TX0: [U4Y, 2], TX1: [U4Y, 3], TX2: [U4Y, 4], TX3: [U4Y, 5], TV0: [U4Y, 6], TV1: [U4Y, 7], TV2: [U4Y, 8], TV3: [U4Y, 9],
      TX4: [U5Y, 2], TX5: [U5Y, 3], TX6: [U5Y, 4], TX7: [U5Y, 5] };

    const pinsOf = [];  // mọi chân, để dựng net
    const addPin = (comp, p) => { p.comp = comp.id; p.key = comp.id + '#' + comp.pinsOut.length; comp.pinsOut.push(p); pinsOf.push(p); return p; };

    for (const c of CIRCUIT.COMPONENTS) {
      const pos = POS[c.id] || {};
      switch (c.kind) {
        case 'CLOCK': { const o = place(c, { x: 30, y: 80, w: 100, h: 40 }); addPin(o, { name: 'out', net: c.out, dir: 'out', ex: o.x + o.w, ey: o.y + 20, tx: o.x + o.w + STUB, ty: o.y + 20 }); break; }
        case 'BTN': { const o = place(c, { x: 30, y: 130, w: 100, h: 40 }); addPin(o, { name: 'out', net: c.out, dir: 'out', ex: o.x + o.w, ey: o.y + 20, tx: o.x + o.w + STUB, ty: o.y + 20 }); break; }
        case 'SW': { const [y0, r] = swRow[c.id]; const o = place(c, { x: 30, y: rowY(y0, r) - 10, w: 100, h: 20 }); addPin(o, { name: 'out', net: c.out, dir: 'out', ex: o.x + o.w, ey: o.y + 10, tx: o.x + o.w + STUB, ty: o.y + 10 }); break; }
        case 'GATE': {
          const n = c.ins.length, h = n > 2 ? n * PITCH + 20 : 40, w = 60;
          const o = place(c, { x: pos.x, y: pos.y, w, h });
          c.ins.forEach((net, i) => { const y = o.y + (n > 2 ? 10 + i * PITCH : 10 + i * 20); addPin(o, { name: 'in' + i, num: '', net, dir: 'in', ex: o.x, ey: y, tx: o.x - STUB, ty: y }); });
          addPin(o, { name: 'out', num: '', net: c.out, dir: 'out', ex: o.x + w, ey: o.y + h / 2, tx: o.x + w + STUB, ty: o.y + h / 2 });
          break;
        }
        case 'IC04': {
          const o = place(c, { x: pos.x, y: pos.y, w: 110, h: 250 });
          c.gates.forEach((g, i) => { const y = o.y + 40 + i * 50;
            addPin(o, { name: 'in', num: g.pi, net: g.ins[0], dir: 'in', ex: o.x, ey: y, tx: o.x - STUB, ty: y, gi: i });
            addPin(o, { name: 'out', num: g.po, net: g.out, dir: 'out', ex: o.x + o.w, ey: y, tx: o.x + o.w + STUB, ty: y, gi: i }); });
          break;
        }
        case 'HEX': {
          const o = place(c, { x: pos.x, y: pos.y, w: 120, h: 170 });
          // CU3 trên cùng … CU0 dưới cùng (bit thấp nhất cạnh dấu chấm)
          [3, 2, 1, 0].forEach((bit, i) => { const y = o.y + 30 + i * 30; addPin(o, { name: 'b' + bit, num: '', net: c.ins[bit], dir: 'in', ex: o.x, ey: y, tx: o.x - STUB, ty: y, bit }); });
          break;
        }
        case 'LAMP': { const o = place(c, { x: pos.x, y: pos.y, w: 40, h: 40 }); addPin(o, { name: 'in', num: '', net: c.ins[0], dir: 'in', ex: o.x, ey: o.y + 20, tx: o.x - STUB, ty: o.y + 20 }); break; }
        default: { // IC có chân: 74LS157 / 192 / 74
          const rowOf = (p, i) => (p.row !== undefined ? p.row : i) + (p.half === 2 ? 0.5 : 0);
          const hasHalf = c.kind === 'IC74';
          let li = 0, ri = 0; const rows = [];
          for (const p of c.pins) { const idx = p.side === 'L' ? li++ : ri++; rows.push(hasHalf ? (p.side === 'L' ? idx + (idx >= 4 ? 0.5 : 0) : rowOf(p, idx)) : idx); }
          const maxRow = Math.max(...rows);
          const h = 40 + Math.ceil(maxRow * PITCH) + 30 + (c.kind === 'IC157' ? 0 : 0);
          const o = place(c, { x: pos.x, y: pos.y, w: 110, h: Math.max(h, 120) });
          c.pins.forEach((p, i) => { const y = o.y + 40 + Math.round(rows[i] * PITCH); const left = p.side === 'L';
            addPin(o, { name: p.name, num: p.num, net: p.net, dir: left ? 'in' : 'out', side: p.side, half: p.half, ex: left ? o.x : o.x + o.w, ey: y, tx: left ? o.x - STUB : o.x + o.w + STUB, ty: y }); });
        }
      }
    }
    // U4/U5: chân ra QA..QD canh hàng 2..5 cho jog ngắn
    for (const id of ['U4', 'U5']) { const o = comps[id]; o.pinsOut.filter(p => p.dir === 'out').forEach((p, i) => { p.ey = p.ty = rowY(o.y, 2 + i); }); }

    /* ---------- danh sách dây ---------- */
    const nets = {};
    for (const p of pinsOf) {
      p.tie = null; p.open = false;
      if (p.net === null) { p.open = true; continue; }
      if (isConst(p.net)) { p.tie = p.net; continue; }
      const n = nets[p.net] = nets[p.net] || { name: p.net, driver: null, loads: [] };
      if (p.dir === 'out') { if (n.driver) throw new Error('2 nguồn trên dây ' + p.net); n.driver = p; } else n.loads.push(p);
    }
    for (const n of Object.values(nets)) { if (!n.driver) throw new Error('dây không có nguồn: ' + n.name); if (!n.loads.length) throw new Error('dây không có tải: ' + n.name); }

    /* ---------- khung khối ---------- */
    const frames = [
      { id: 'src', x: 10, y: 30, w: 170, h: 620, title: 'Khối nguồn & công tắc', sub: 'CLK, RESET, T_X (2 số), T_V (1 số)' },
      { id: 'mux', x: 290, y: 50, w: 200, h: 620, title: 'Khối chọn thời gian', sub: 'U4, U5: chọn T_X hoặc T_V' },
      { id: 'cnt', x: 520, y: 50, w: 440, h: 600, title: 'Khối đếm lùi & hiển thị', sub: 'U2, U3 (đếm) · G9, G10 (phát HET_N) · HEX' },
      { id: 'rst', x: 1170, y: 50, w: 520, h: 300, title: 'Khối RESET đồng bộ', sub: 'U12 (đồng bộ), U9 (đảo), G4 (khóa bộ chọn)' },
      { id: 'sta', x: 1000, y: 358, w: 500, h: 330, title: 'Khối trạng thái pha', sub: 'U6 giữ Q1Q0 · G1, G2, G3 tính trạng thái kế' },
      { id: 'led', x: 1530, y: 358, w: 260, h: 430, title: 'Khối đèn', sub: 'G5–G8 giải mã Q1Q0 → 6 đèn' }
    ];
    // dịch toàn bộ sơ đồ để chừa lề đi dây
    for (const id of order) { const c = comps[id]; c.x += OX; c.y += OY; for (const p of c.pinsOut) { p.ex += OX; p.tx += OX; p.ey += OY; p.ty += OY; } }
    for (const f of frames) { f.x += OX; f.y += OY; }
    return { W, H, comps, order, nets, frames, STUB };
  }

  const API = { build, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.LAYOUT = API;
})(typeof window !== 'undefined' ? window : globalThis);
