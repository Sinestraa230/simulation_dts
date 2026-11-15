/* pcb.js — dựng bo mạch in 2 lớp từ netlist gốc (js/circuit.js) và xuất js/pcb-data.js cho trang 3D.
 *   1. Gán linh kiện vật lý: IC trong circuit.js giữ nguyên chân; cổng G1–G10 đặt vào IC cổng chuẩn;
 *      HEX → 74LS247 + LED 7 đoạn; CLOCK → NE555; công tắc → DIP switch; đèn → LED 5 mm.
 *   2. Xếp linh kiện trên lưới 0,1" (2,54 mm).
 *   3. Đi dây tự động 2 lớp trên lưới 1,27 mm (PathFinder: định tuyến lại đến khi không còn ô tranh chấp).
 * Chạy: node tools/pcb.js        (ghi js/pcb-data.js và /tmp/pcb.svg để xem nhanh)
 */
'use strict';
const fs = require('fs'), path = require('path');
const CIRCUIT = require('../js/circuit.js');

const U = 2.54, G = 1.27;              // 1 u = 0,1"; ô lưới đi dây = nửa u
const BW = 86, BH = 58;                // kích thước bo (u)  → 218,4 × 147,3 mm

/* ================= 1. NETLIST VẬT LÝ ================= */
const comps = [];                       // { ref, part, value, fp, x, y, pins:{num:net}, role, vn }
const byRef = {};
function add(c) { c.pins = c.pins || {}; comps.push(c); byRef[c.ref] = c; return c; }
const N = n => (n === 'ONE' ? 'VCC' : n === 'ZERO' ? 'GND' : n);
const cc = id => CIRCUIT.COMPONENTS.find(c => c.id === id);

// IC có chân ghi rõ trong circuit.js: chép nguyên số chân → net
function icFromCircuit(id, part, fp, x, y, extra) {
  const c = cc(id), pins = {};
  if (c.pins) for (const p of c.pins) if (p.net !== null) pins[p.num] = N(p.net);
  if (c.gates) for (const g of c.gates) { pins[g.pi] = N(g.ins[0]); pins[g.po] = N(g.out); }
  return add(Object.assign({ ref: id, part, fp, x, y, pins, role: 'ic', vn: c.vn, from: id }, extra || {}));
}
const pwr = (c, vcc, gnd) => { c.pins[vcc] = 'VCC'; c.pins[gnd] = 'GND'; return c; };
const gateIns = id => cc(id).ins.map(N), gateOut = id => N(cc(id).out);

// --- IC giữ nguyên từ circuit.js
pwr(icFromCircuit('U4', '74LS157', 'DIP16', 16, 31), 16, 8);
pwr(icFromCircuit('U5', '74LS157', 'DIP16', 16, 43), 16, 8);
pwr(icFromCircuit('U2', '74LS192', 'DIP16', 29, 31), 16, 8);
pwr(icFromCircuit('U3', '74LS192', 'DIP16', 29, 43), 16, 8);
pwr(icFromCircuit('U6', '74LS74', 'DIP14', 64, 43), 14, 7);
pwr(icFromCircuit('U12', '74LS74', 'DIP14', 53, 43), 14, 7);
const u9 = pwr(icFromCircuit('U9', '74LS04', 'DIP14', 53, 31), 14, 7);
u9.pins[5] = 'GND'; u9.pins[9] = 'GND';               // 2 cổng NOT còn lại: ngõ vào nối 0 (như sơ đồ gốc)

// --- IC chứa các cổng rời G1–G10 (chân chuẩn của họ 74xx 4 cổng 2 vào: 1,2→3 · 4,5→6 · 9,10→8 · 12,13→11)
const Q2 = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]];
function quad(ref, part, x, y, gates, vn) {
  const c = add({ ref, part, fp: 'DIP14', x, y, pins: {}, role: 'ic', vn, gates: {} });
  pwr(c, 14, 7);
  Q2.forEach((pp, i) => {
    const g = gates[i];
    if (g) { const ins = gateIns(g); c.pins[pp[0]] = ins[0]; c.pins[pp[1]] = ins[1]; c.pins[pp[2]] = gateOut(g); c.gates[g] = pp; }
    else { c.pins[pp[0]] = 'GND'; c.pins[pp[1]] = 'GND'; }        // cổng thừa: ngõ vào nối 0, ngõ ra để hở
  });
  return c;
}
quad('U7', '74LS86', 53, 54, ['G1'], 'XOR 4 cổng — dùng 1 cổng cho G1: X01 = Q1 ⊕ Q0.');
quad('U13', '74LS32', 64, 31, ['G2', 'G3', 'G4'], 'OR 4 cổng — G2: D0 = Q0_N + RSY · G3: D1 = X01 + RSY · G4: MEN = RST + RSY.');
quad('U8', '74LS08', 64, 54, ['G5', 'G6', 'G7', 'G8'], 'AND 4 cổng — G5 XA · G6 VA · G7 XB · G8 VB (giải mã pha ra đèn).');
quad('U15', '74LS00', 42, 43, ['G10'], 'NAND 4 cổng — dùng 1 cổng cho G10: HET_N = NAND(Z, CLK).');
{ // G9 NOR-8 → CD4078B: A–D = chân 2–5, E–H = chân 9–12, NOR (J) = chân 13, OR (K) = chân 1 để hở, 6 và 8 NC
  const c = add({ ref: 'U14', part: 'CD4078B', fp: 'DIP14', x: 42, y: 31, pins: {}, role: 'ic', vn: 'NOR 8 ngõ vào (G9): Z = 1 khi cả 8 bit đếm bằng 0.', gates: { G9: [2, 3, 4, 5, 9, 10, 11, 12, 13] } });
  pwr(c, 14, 7); const ins = gateIns('G9');[2, 3, 4, 5, 9, 10, 11, 12].forEach((p, i) => (c.pins[p] = ins[i])); c.pins[13] = gateOut('G9');
}
// --- giải mã + LED 7 đoạn (HEX1 = hàng đơn vị, HEX2 = hàng chục)
const SEGPIN247 = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };       // 74LS247
const SEGPIN7 = { e: 1, d: 2, c: 4, b: 6, a: 7, f: 9, g: 10 };              // LED 7 đoạn 0,56" anode chung (CA = 3, 8; DP = 5)
let rn = 3;
function decoder(ref, disp, hexId, x, y, dx, dy, rx) {
  const ins = cc(hexId).ins.map(N);                                         // bit0..bit3
  const c = add({ ref, part: '74LS247', fp: 'DIP16', x, y, pins: { 7: ins[0], 1: ins[1], 2: ins[2], 6: ins[3], 3: 'VCC', 5: 'VCC' }, role: 'ic', from: hexId,
    vn: `Giải mã BCD → 7 đoạn cho ${hexId} (${hexId === 'HEX1' ? 'hàng đơn vị' : 'hàng chục'}). LT, RBI nối 1; BI/RBO để hở.` });
  pwr(c, 16, 8);
  const d = add({ ref: disp, part: 'LED 7 đoạn 0,56" anode chung', fp: 'SEG7', x: dx, y: dy, pins: { 3: 'VCC', 8: 'VCC' }, role: 'disp', from: hexId, vn: `Hiển thị ${hexId === 'HEX1' ? 'hàng đơn vị' : 'hàng chục'} (${hexId}).` });
  // điện trở hạn dòng đứng thẳng ngay trên chân ra a–g của 74LS247 (hàng trên: chân 15 f,14 g,13 a,12 b,11 c,10 d,9 e)
  const order = ['f', 'g', 'a', 'b', 'c', 'd', 'e'];
  order.forEach((s, i) => {
    const n1 = `${ref}_${s}`, n2 = `${disp}_${s}`;
    c.pins[SEGPIN247[s]] = n1; d.pins[SEGPIN7[s]] = n2;
    add({ ref: 'R' + rn++, part: 'Điện trở 330 Ω', value: '330', fp: 'AXIAL_V', x: rx + i, y: y - 5, pins: { 1: n1, 2: n2 }, role: 'res', vn: `Hạn dòng đoạn ${s} của ${disp}.` });
  });
}
decoder('U11', 'DS2', 'HEX2', 42, 23, 44, 12, 43);
decoder('U10', 'DS1', 'HEX1', 53, 23, 55, 12, 54);

// --- nguồn xung CLK: NE555 dao động ~1 Hz
add({ ref: 'U1', part: 'NE555', fp: 'DIP8', x: 10, y: 12, pins: { 1: 'GND', 2: 'T555', 3: 'CLK', 4: 'VCC', 5: 'C555', 6: 'T555', 7: 'D555', 8: 'VCC' }, role: 'ic', from: 'CLOCK',
  vn: 'Tạo xung CLK ~1 Hz (mạch dao động bất ổn): f ≈ 1,44 / ((R1 + 2·R2)·C1) = 1,44 / (137 kΩ · 10 µF) ≈ 1,05 Hz.' });
add({ ref: 'R1', part: 'Điện trở 1 kΩ', value: '1k', fp: 'AXIAL_V', x: 15, y: 12, pins: { 1: 'D555', 2: 'VCC' }, role: 'res', vn: 'R_A của NE555.' });
add({ ref: 'R2', part: 'Điện trở 68 kΩ', value: '68k', fp: 'AXIAL_V', x: 17, y: 12, pins: { 1: 'T555', 2: 'D555' }, role: 'res', vn: 'R_B của NE555.' });
add({ ref: 'C1', part: 'Tụ hóa 10 µF', value: '10µ', fp: 'RADIAL', x: 13, y: 16, pins: { 1: 'T555', 2: 'GND' }, role: 'ecap', vn: 'Tụ định thời của NE555.' });
add({ ref: 'C2', part: 'Tụ gốm 10 nF', value: '103', fp: 'CAP', x: 10, y: 16, pins: { 1: 'C555', 2: 'GND' }, role: 'cap', vn: 'Lọc chân CONT (5) của NE555.' });

// --- công tắc T_X, T_V (bật = 1) + điện trở kéo xuống
add({ ref: 'SW1', part: 'DIP switch 8 vị trí', fp: 'DIPSW8', x: 3, y: 30, pins: {}, role: 'dipsw', from: 'TX', vn: 'Đặt T_X: vị trí 1–4 = TX0–TX3 (hàng đơn vị), 5–8 = TX4–TX7 (hàng chục). Gạt lên = 1.' });
add({ ref: 'RN1', part: 'Điện trở mạng 8 × 470 Ω', value: 'A471J', fp: 'SIP9', x: 2, y: 33, pins: { 1: 'GND' }, role: 'rnet', vn: 'Kéo TX0–TX7 xuống 0 khi công tắc tắt.' });
for (let i = 0; i < 8; i++) { byRef.SW1.pins[i + 1] = 'TX' + i; byRef.SW1.pins[16 - i] = 'VCC'; byRef.RN1.pins[i + 2] = 'TX' + i; }
add({ ref: 'SW2', part: 'DIP switch 4 vị trí', fp: 'DIPSW4', x: 3, y: 42, pins: {}, role: 'dipsw', from: 'TV', vn: 'Đặt T_V: vị trí 1–4 = TV0–TV3. Gạt lên = 1.' });
add({ ref: 'RN2', part: 'Điện trở mạng 4 × 470 Ω', value: 'A471J', fp: 'SIP5', x: 2, y: 45, pins: { 1: 'GND' }, role: 'rnet', vn: 'Kéo TV0–TV3 xuống 0 khi công tắc tắt.' });
for (let i = 0; i < 4; i++) { byRef.SW2.pins[i + 1] = 'TV' + i; byRef.SW2.pins[8 - i] = 'VCC'; byRef.RN2.pins[i + 2] = 'TV' + i; }
add({ ref: 'SW3', part: 'Công tắc gạt 3 chân (SPDT)', fp: 'SLIDE', x: 3, y: 21, pins: { 1: 'GND', 2: 'RST_N', 3: 'VCC' }, role: 'slide', from: 'SW-RESET', vn: 'SW-RESET: gạt về RESET → RST_N = 0 (giữ reset); gạt về CHẠY → RST_N = 1.' });

// --- điện trở kéo lên cho 8 ngõ vào CMOS của CD4078B (ngõ ra TTL mức 1 chỉ ~3,4 V)
add({ ref: 'RN3', part: 'Điện trở mạng 8 × 4,7 kΩ', value: 'A472J', fp: 'SIP9_V', x: 38, y: 32, pins: { 1: 'VCC' }, role: 'rnet',
  vn: 'Kéo lên CU0–CU3, CC0–CC3: ngõ ra 74LS192 ở mức 1 chỉ khoảng 3,4 V, thấp hơn ngưỡng 3,5 V của CD4078B; kéo lên đưa mức 1 gần 5 V. Không đổi chức năng logic.' });
['CU0', 'CU1', 'CU2', 'CU3', 'CC0', 'CC1', 'CC2', 'CC3'].forEach((n, i) => (byRef.RN3.pins[i + 2] = n));

// --- 6 đèn giao thông
const LAMPS = [['LDA', 'D1', 'red', 72, 6], ['LVA', 'D2', 'yellow', 72, 10], ['LXA', 'D3', 'green', 72, 14],
               ['LDB', 'D4', 'red', 81, 6], ['LVB', 'D5', 'yellow', 81, 10], ['LXB', 'D6', 'green', 81, 14]];
let rl = 17;
for (const [lid, dref, col, x, y] of LAMPS) {
  const net = N(cc(lid).ins[0]), an = dref + '_A', vn = cc(lid).vn;
  add({ ref: 'R' + rl, part: 'Điện trở 1 kΩ', value: '1k', fp: 'AXIAL_H', x: x - 6, y, pins: { 1: net, 2: an }, role: 'res', vn: 'Hạn dòng ' + vn.toLowerCase() + '.' });
  add({ ref: dref, part: `LED 5 mm ${col === 'red' ? 'đỏ' : col === 'yellow' ? 'vàng' : 'xanh lá'}`, fp: 'LED5', x: x - 1, y, color: col, pins: { 1: an, 2: 'GND' }, role: 'led', from: lid, vn });
  rl++;
}

// --- nguồn 5 V + tụ lọc
add({ ref: 'J1', part: 'Domino 2 chân 5,08 mm', fp: 'TERM2', x: 3, y: 7, pins: { 1: 'VCC', 2: 'GND' }, role: 'term', vn: 'Cấp nguồn 5 V một chiều: chân 1 = +5 V, chân 2 = GND.' });
add({ ref: 'C18', part: 'Tụ hóa 100 µF', value: '100µ', fp: 'RADIAL', x: 8, y: 7, pins: { 1: 'VCC', 2: 'GND' }, role: 'ecap', vn: 'Tụ lọc nguồn chung.' });
// tụ 100 nF sát chân VCC mỗi IC
let cn = 3;
for (const c of comps.filter(c => c.role === 'ic')) {
  const n2 = c.fp === 'DIP8' ? 4 : c.fp === 'DIP14' ? 7 : 8;
  add({ ref: 'C' + cn++, part: 'Tụ gốm 100 nF', value: '104', fp: 'CAP_V', x: c.x - 2, y: c.y - 3, pins: { 1: 'VCC', 2: 'GND' }, role: 'cap', vn: `Tụ lọc nguồn cho ${c.ref}.` });
}

/* ================= 2. FOOTPRINT ================= */
function fpPins(fp) {      // [num, dx, dy] theo u; dy âm = lên trên
  const dip = n => Array.from({ length: n }, (_, i) => { const k = i + 1; return k <= n / 2 ? [k, k - 1, 0] : [k, n - k, -3]; });
  switch (fp) {
    case 'DIP8': return dip(8); case 'DIP14': return dip(14); case 'DIP16': return dip(16);
    case 'DIPSW8': return dip(16); case 'DIPSW4': return dip(8);
    case 'SIP9': return Array.from({ length: 9 }, (_, i) => [i + 1, i, 0]);
    case 'SIP9_V': return Array.from({ length: 9 }, (_, i) => [i + 1, 0, i]);
    case 'SIP5': return Array.from({ length: 5 }, (_, i) => [i + 1, i, 0]);
    case 'AXIAL_V': return [[1, 0, 0], [2, 0, -4]];
    case 'AXIAL_H': return [[1, 0, 0], [2, 4, 0]];
    case 'RADIAL': return [[1, 0, 0], [2, 1, 0]];
    case 'CAP': return [[1, 0, 0], [2, 1, 0]];
    case 'CAP_V': return [[1, 0, 0], [2, 0, 1]];
    case 'LED5': return [[1, 0, 0], [2, 1, 0]];
    case 'SLIDE': return [[1, 0, 0], [2, 1, 0], [3, 2, 0]];
    case 'TERM2': return [[1, 0, 0], [2, 2, 0]];
    case 'SEG7': return [[1, 0, 0], [2, 1, 0], [3, 2, 0], [4, 3, 0], [5, 4, 0], [6, 4, -6], [7, 3, -6], [8, 2, -6], [9, 1, -6], [10, 0, -6]];
  }
  throw new Error('fp ' + fp);
}
const padSize = fp => (fp === 'TERM2' ? [2.4, 1.3] : fp === 'SEG7' ? [1.6, 0.9] : fp === 'SLIDE' ? [1.6, 0.9] : [1.6, 0.8]);
const pads = [];
for (const c of comps) {
  c.pinList = fpPins(c.fp).map(([num, dx, dy]) => {
    const [d, drill] = padSize(c.fp);
    const p = { ref: c.ref, num, gx: (c.x + dx) * 2, gy: (c.y + dy) * 2, net: c.pins[num] || null, d, drill, sq: num === 1 && c.role !== 'res' };
    pads.push(p); return p;
  });
}
// thêm các chân để hở vào netlist kiểm tra
const holes = [[2.5, 2.5], [BW - 2.5, 2.5], [2.5, BH - 2.5], [BW - 2.5, BH - 2.5]].map(([x, y]) => ({ gx: x * 2, gy: y * 2, d: 3.2 }));

/* ================= 3. ĐI DÂY ================= */
const GW = BW * 2 + 1, GH = BH * 2 + 1, NC = GW * GH, NN = NC * 2;
const netNames = [...new Set(pads.filter(p => p.net).map(p => p.net))].sort();
const netId = {}; netNames.forEach((n, i) => (netId[n] = i));
const padNet = new Int32Array(NC).fill(-1);       // -1 trống, -2 chặn, ≥0 net của pad
const block = new Uint8Array(NC), only = new Int32Array(NC).fill(-1);   // only: ô quanh pad lớn, chỉ net của pad được đi
const cid = (x, y) => y * GW + x;
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (x < 3 || y < 3 || x > GW - 4 || y > GH - 4) block[cid(x, y)] = 1;
for (const h of holes) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) block[cid(h.gx + dx, h.gy + dy)] = 1;
for (const p of pads) {
  const c = cid(p.gx, p.gy);
  if (padNet[c] !== -1) throw new Error('trùng pad ' + p.ref + '.' + p.num);
  padNet[c] = p.net ? netId[p.net] : -2;
  if (p.d > 2) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) only[cid(p.gx + dx, p.gy + dy)] = p.net ? netId[p.net] : -2;
}
const nets = netNames.map((name, i) => ({ name, id: i, pads: pads.filter(p => p.net === name), power: name === 'VCC' || name === 'GND', path: [], edges: [] }));

const usage = new Int16Array(NN), hist = new Float32Array(NN);
const VIA = 9;
function moveCost(layer, horiz) { return layer === 0 ? (horiz ? 1 : 2.2) : (horiz ? 2.2 : 1); }
// heap
const gS = new Float64Array(NN), par = new Int32Array(NN), stamp = new Int32Array(NN), closed = new Int32Array(NN); let st = 0;
const hk = new Float64Array(NN * 3), hv = new Int32Array(NN * 3); let hn = 0;
function hpush(k, v) { let i = hn++; hk[i] = k; hv[i] = v; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]];[hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } }
function hpop() { const v = hv[0]; hn--; if (hn > 0) { hk[0] = hk[hn]; hv[0] = hv[hn]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m === i) break;[hk[m], hk[i]] = [hk[i], hk[m]];[hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return v; }

function nodeCost(n, net, pf, base) {
  const own = net.mark[n] ? 1 : 0, occ = usage[n] - own;
  return (base + hist[n]) * (1 + pf * occ);
}
function viaOK(c, nid) {
  const x = c % GW, y = (c / GW) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = padNet[cid(x + dx, y + dy)]; if (q !== -1 && q !== nid) return false; }
  return true;
}
// A*: từ pad nguồn tới bất kỳ nút nào trong cây (tree: Uint8Array đánh dấu)
function astar(net, src, tree, bb, pf) {
  st++; hn = 0;
  const h = (x, y) => Math.max(0, bb[0] - x, x - bb[2]) + Math.max(0, bb[1] - y, y - bb[3]);
  for (const l of [0, 1]) { const n = l * NC + src; gS[n] = 0; stamp[n] = st; par[n] = -1; hpush(h(src % GW, (src / GW) | 0), n); }
  while (hn) {
    const n = hpop(); if (closed[n] === st) continue; closed[n] = st;
    if (tree[n]) return n;
    const l = n >= NC ? 1 : 0, c = n - l * NC, x = c % GW, y = (c / GW) | 0, g0 = gS[n];
    const tryN = (m, cost) => { if (stamp[m] === st && gS[m] <= g0 + cost) return; if (closed[m] === st) return; stamp[m] = st; gS[m] = g0 + cost; par[m] = n; const mc = m - (m >= NC ? NC : 0); hpush(gS[m] + h(mc % GW, (mc / GW) | 0), m); };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x2 = x + dx, y2 = y + dy; if (x2 < 0 || y2 < 0 || x2 >= GW || y2 >= GH) continue;
      const c2 = cid(x2, y2); if (block[c2]) continue; if (only[c2] !== -1 && only[c2] !== net.id) continue; const pn = padNet[c2]; if (pn !== -1 && pn !== net.id) continue;
      tryN(l * NC + c2, nodeCost(l * NC + c2, net, pf, moveCost(l, dx !== 0)));
    }
    // đổi lớp: miễn phí tại pad của chính net, còn lại là via
    const pn = padNet[c];
    if (pn === net.id) tryN((1 - l) * NC + c, 0);
    else if (pn === -1 && only[c] === -1 && viaOK(c, net.id)) tryN((1 - l) * NC + c, nodeCost((1 - l) * NC + c, net, pf, VIA));
  }
  return -1;
}
function ripup(net) { for (const n of net.path) usage[n]--; net.path = []; net.edges = []; }
function routeNet(net, pf) {
  ripup(net);
  net.mark = new Uint8Array(NN); const tree = net.mark;
  const ps = net.pads.slice(); if (ps.length < 2) return true;
  // bắt đầu từ pad gần tâm, lần lượt nối pad gần cây nhất
  const cx = ps.reduce((s, p) => s + p.gx, 0) / ps.length, cy = ps.reduce((s, p) => s + p.gy, 0) / ps.length;
  ps.sort((a, b) => Math.hypot(a.gx - cx, a.gy - cy) - Math.hypot(b.gx - cx, b.gy - cy));
  const first = ps.shift(), bb = [first.gx, first.gy, first.gx, first.gy];
  const addNode = n => { if (!tree[n]) { tree[n] = 1; net.path.push(n); usage[n]++; const c = n % NC; bb[0] = Math.min(bb[0], c % GW); bb[2] = Math.max(bb[2], c % GW); bb[1] = Math.min(bb[1], (c / GW) | 0); bb[3] = Math.max(bb[3], (c / GW) | 0); } };
  addNode(cid(first.gx, first.gy)); addNode(NC + cid(first.gx, first.gy));
  while (ps.length) {
    let bi = 0, bd = Infinity;
    ps.forEach((p, i) => { const d = Math.max(0, bb[0] - p.gx, p.gx - bb[2]) + Math.max(0, bb[1] - p.gy, p.gy - bb[3]); if (d < bd) { bd = d; bi = i; } });
    const p = ps.splice(bi, 1)[0], src = cid(p.gx, p.gy);
    const end = astar(net, src, tree, bb, pf); if (end < 0) return false;
    let n = end, prev = -1; const chain = [];
    while (n !== -1) { chain.push(n); n = par[n]; }
    for (let i = 0; i < chain.length; i++) { const a = chain[i]; if (i + 1 < chain.length) net.edges.push([a, chain[i + 1]]); }
    chain.forEach(addNode); addNode(src); addNode(NC + src);
  }
  return true;
}
// thứ tự: net nguồn trước, rồi net ngắn trước
nets.sort((a, b) => (b.power - a.power) || (span(a) - span(b)));
function span(n) { const xs = n.pads.map(p => p.gx), ys = n.pads.map(p => p.gy); return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys); }
let pf = 0.6, ok = false, it;
const t0 = Date.now();
for (it = 1; it <= 80; it++) {
  for (const net of nets) if (!routeNet(net, pf)) throw new Error('không tìm được đường cho ' + net.name);
  let over = 0; for (let n = 0; n < NN; n++) if (usage[n] > 1) { over++; hist[n] += 0.6; }
  process.stdout.write(`vòng ${it}: ${over} ô tranh chấp\n`);
  if (!over) { ok = true; break; }
  pf *= 1.5;
}
if (!ok) throw new Error('đi dây chưa xong');
console.log(`đi dây xong sau ${it} vòng, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

/* ================= 4. XUẤT ================= */
const mm = g => +(g * G).toFixed(3);
const traces = [], vias = [];
for (const net of nets) {
  const w = net.power ? 0.6 : 0.3;
  // gộp cạnh thẳng hàng thành đoạn dài
  const segs = { 0: [], 1: [] };
  for (const [a, b] of net.edges) {
    const la = a >= NC ? 1 : 0, lb = b >= NC ? 1 : 0, ca = a % NC, cb = b % NC;
    if (ca === cb) { if (padNet[ca] !== net.id) vias.push({ x: mm(ca % GW), y: mm((ca / GW) | 0), net: net.name }); continue; }
    segs[la].push([ca % GW, (ca / GW) | 0, cb % GW, (cb / GW) | 0]);
  }
  for (const l of [0, 1]) {
    const H = new Map(), V = new Map();
    for (const [x1, y1, x2, y2] of segs[l]) {
      if (y1 === y2) { const k = y1; if (!H.has(k)) H.set(k, new Set()); H.get(k).add(Math.min(x1, x2)); }
      else { const k = x1; if (!V.has(k)) V.set(k, new Set()); V.get(k).add(Math.min(y1, y2)); }
    }
    const runs = (set) => { const a = [...set].sort((p, q) => p - q), out = []; let s = a[0], e = a[0]; for (let i = 1; i < a.length; i++) { if (a[i] === e + 1) e = a[i]; else { out.push([s, e + 1]); s = e = a[i]; } } if (a.length) out.push([s, e + 1]); return out; };
    for (const [y, set] of H) for (const [s, e] of runs(set)) traces.push({ l, net: net.name, w, x1: mm(s), y1: mm(y), x2: mm(e), y2: mm(y) });
    for (const [x, set] of V) for (const [s, e] of runs(set)) traces.push({ l, net: net.name, w, x1: mm(x), y1: mm(s), x2: mm(x), y2: mm(e) });
  }
}
const uniqVia = [...new Map(vias.map(v => [v.x + ',' + v.y, v])).values()];
const OUT = {
  board: { w: BW * U, h: BH * U, t: 1.6, title: 'BÀI 11 · ĐÈN GIAO THÔNG NGÃ TƯ', rev: 'Rev 1.0' },
  holes: holes.map(h => ({ x: mm(h.gx), y: mm(h.gy), d: h.d })),
  comps: comps.map(c => ({ ref: c.ref, part: c.part, value: c.value || '', fp: c.fp, x: +(c.x * U).toFixed(3), y: +(c.y * U).toFixed(3), role: c.role, color: c.color, from: c.from || null, gates: c.gates || null, vn: c.vn || '',
    pins: c.pinList.map(p => ({ n: p.num, x: mm(p.gx), y: mm(p.gy), net: p.net, d: p.d, drill: p.drill, sq: p.sq })) })),
  traces, vias: uniqVia.map(v => ({ x: v.x, y: v.y, net: v.net, d: 0.8, drill: 0.4 }))
};
fs.writeFileSync(path.join(__dirname, '../js/pcb-data.js'), '/* sinh tự động bởi tools/pcb.js — không sửa tay */\nwindow.PCB = ' + JSON.stringify(OUT) + ';\nif (typeof module !== "undefined") module.exports = window.PCB;\n');
console.log(`linh kiện ${comps.length}, pad ${pads.length}, net ${nets.length}, đoạn dây ${traces.length}, via ${uniqVia.length}`);

// SVG xem nhanh
let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BW * U} ${BH * U}" width="${BW * U * 7}" height="${BH * U * 7}"><rect width="100%" height="100%" fill="#0d3b1e"/>`;
for (const t of traces.filter(t => t.l === 1)) s += `<line x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}" stroke="#3a7bd5" stroke-width="${t.w}" stroke-linecap="round"/>`;
for (const t of traces.filter(t => t.l === 0)) s += `<line x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}" stroke="#e05040" stroke-width="${t.w}" stroke-linecap="round" opacity=".85"/>`;
for (const p of pads) s += `<circle cx="${mm(p.gx)}" cy="${mm(p.gy)}" r="${p.d / 2}" fill="#ccc"/>`;
for (const v of uniqVia) s += `<circle cx="${v.x}" cy="${v.y}" r=".4" fill="#ffd23a"/>`;
for (const c of comps) s += `<text x="${c.x * U}" y="${c.y * U + 1.6}" font-size="1.4" fill="#fff">${c.ref}</text>`;
s += '</svg>';
fs.writeFileSync('/tmp/pcb.svg', s);
