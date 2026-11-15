/* pcb-verify.js — kiểm chứng bo mạch 3D bám đúng mạch gốc.
 *   1. DRC: khoảng hở giữa dây / pad / via khác net ≥ 0,15 mm.
 *   2. Kết nối: dò lớp đồng (dây + via + pad) thành các nhóm điện; mỗi net đúng một nhóm, không chập.
 *   3. Logic: dựng lại mạch CHỈ từ lớp đồng + chân chuẩn của IC, chạy cùng engine và so từng nhịp với mạch gốc (circuit.js).
 *   4. Mạch phụ: NE555 dao động, công tắc + điện trở kéo, 74LS247 → điện trở → đúng đoạn LED, LED đèn, tụ lọc.
 * Chạy: node test/pcb-verify.js
 */
'use strict';
global.window = global;
const PCB = require('../js/pcb-data.js');
const CIRCUIT = require('../js/circuit.js');
const { Sim } = require('../js/engine.js');

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  ✗ ' + msg); } return c; };
const head = s => console.log('\n' + s);

/* ---------- 1. DRC ---------- */
head('1. DRC (khoảng hở tối thiểu 0,15 mm)');
const CLR = 0.15;
const pads = []; for (const c of PCB.comps) for (const p of c.pins) pads.push(Object.assign({ ref: c.ref }, p));
function segDist(a, b) {   // khoảng cách 2 đoạn thẳng (2D)
  const d = (p, s) => { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy; let t = L ? ((p[0] - s.x1) * dx + (p[1] - s.y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - s.x1 - t * dx, p[1] - s.y1 - t * dy); };
  const inter = (() => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); const A = [a.x1, a.y1], B = [a.x2, a.y2], C = [b.x1, b.y1], D = [b.x2, b.y2]; return o(A, B, C) * o(A, B, D) < 0 && o(C, D, A) * o(C, D, B) < 0; })();
  if (inter) return 0;
  return Math.min(d([a.x1, a.y1], b), d([a.x2, a.y2], b), d([b.x1, b.y1], a), d([b.x2, b.y2], a));
}
const pt = (x, y) => ({ x1: x, y1: y, x2: x, y2: y });
let minGap = Infinity, drcBad = 0;
const T = PCB.traces;
function chk(g, what) { minGap = Math.min(minGap, g); if (g < CLR - 1e-6) { drcBad++; if (drcBad < 8) console.log('  ✗ ' + what + ' hở ' + g.toFixed(3)); } }
for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
  const a = T[i], b = T[j]; if (a.l !== b.l || a.net === b.net) continue;
  if (Math.max(a.x1, a.x2) + 3 < Math.min(b.x1, b.x2) || Math.max(b.x1, b.x2) + 3 < Math.min(a.x1, a.x2) || Math.max(a.y1, a.y2) + 3 < Math.min(b.y1, b.y2) || Math.max(b.y1, b.y2) + 3 < Math.min(a.y1, a.y2)) continue;
  chk(segDist(a, b) - a.w / 2 - b.w / 2, `dây ${a.net}/${b.net}`);
}
for (const t of T) for (const p of pads) if (p.net !== t.net) { const g = segDist(t, pt(p.x, p.y)) - t.w / 2 - p.d / 2; if (g < 3) chk(g, `dây ${t.net} – pad ${p.ref}.${p.n}`); }
for (const v of PCB.vias) {
  for (const t of T) if (t.net !== v.net) { const g = segDist(t, pt(v.x, v.y)) - t.w / 2 - v.d / 2; if (g < 3) chk(g, `via ${v.net} – dây ${t.net}`); }
  for (const p of pads) if (p.net !== v.net) chk(Math.hypot(p.x - v.x, p.y - v.y) - p.d / 2 - v.d / 2, `via ${v.net} – pad ${p.ref}.${p.n}`);
  for (const w of PCB.vias) if (w !== v && w.net !== v.net) chk(Math.hypot(w.x - v.x, w.y - v.y) - w.d / 2 - v.d / 2, 'via – via');
}
for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) { const a = pads[i], b = pads[j]; if (a.net && a.net === b.net) continue; const g = Math.hypot(a.x - b.x, a.y - b.y) - a.d / 2 - b.d / 2; if (g < 3) chk(g, `pad ${a.ref}.${a.n} – ${b.ref}.${b.n}`); }
for (const h of PCB.holes) for (const t of T) chk(segDist(t, pt(h.x, h.y)) - t.w / 2 - h.d / 2, 'dây – lỗ bắt vít');
ok(drcBad === 0, 'DRC có lỗi'); console.log(`  ${drcBad ? '✗' : '✓'} ${T.length} đoạn dây, ${PCB.vias.length} via, ${pads.length} pad · khoảng hở nhỏ nhất ${minGap.toFixed(3)} mm`);

/* ---------- 2. dò kết nối từ hình học lớp đồng ---------- */
head('2. Kết nối dò từ lớp đồng');
const key = (l, x, y) => `${l}:${Math.round(x * 1000)}:${Math.round(y * 1000)}`;
const par = new Map(); const find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
const node = k => { if (!par.has(k)) par.set(k, k); return k; };
const uni = (a, b) => { a = find(node(a)); b = find(node(b)); if (a !== b) par.set(a, b); };
const STEP = 1.27;
for (const t of T) {            // mọi điểm lưới trên đoạn dây thuộc cùng nhóm
  const n = Math.round(Math.hypot(t.x2 - t.x1, t.y2 - t.y1) / STEP);
  for (let i = 0; i <= n; i++) uni(key(t.l, t.x1, t.y1), key(t.l, t.x1 + (t.x2 - t.x1) * i / n, t.y1 + (t.y2 - t.y1) * i / n));
}
for (const v of PCB.vias) uni(key(0, v.x, v.y), key(1, v.x, v.y));
for (const p of pads) uni(key(0, p.x, p.y), key(1, p.x, p.y));      // lỗ xuyên: nối 2 lớp
const grp = p => find(node(key(0, p.x, p.y)));
const byNet = {}, byGrp = {};
for (const p of pads) { if (p.net) (byNet[p.net] = byNet[p.net] || new Set()).add(grp(p)); (byGrp[grp(p)] = byGrp[grp(p)] || new Set()).add(p.net || '(hở)'); }
let cbad = 0;
for (const n in byNet) if (byNet[n].size !== 1) { cbad++; ok(false, `net ${n} bị đứt thành ${byNet[n].size} nhóm`); }
for (const g in byGrp) { const s = [...byGrp[g]]; if (s.length > 1) { cbad++; ok(false, 'chập: ' + s.join(' + ')); } }
console.log(`  ${cbad ? '✗' : '✓'} ${Object.keys(byNet).length} net, mỗi net liền một khối, không chập`);

/* ---------- 3. dựng lại mạch từ lớp đồng, so với mạch gốc ---------- */
head('3. Dựng lại mạch từ lớp đồng và chạy so với mạch gốc');
const C = {}; for (const c of PCB.comps) C[c.ref] = c;
const pin = (ref, n) => C[ref].pins.find(p => p.n === n);
const gname = {};            // nhóm → tên; chỉ đặt tên theo VỊ TRÍ VẬT LÝ (không dùng tên net trong dữ liệu)
const nameG = (ref, n, nm) => { gname[grp(pin(ref, n))] = nm; };
nameG('J1', 1, 'ONE'); nameG('J1', 2, 'ZERO'); nameG('U1', 3, 'CLK'); nameG('SW3', 2, 'RST_N');
for (let k = 1; k <= 8; k++) nameG('SW1', k, 'TX' + (k - 1));
for (let k = 1; k <= 4; k++) nameG('SW2', k, 'TV' + (k - 1));
let gi = 0; const G = (ref, n) => { const g = grp(pin(ref, n)); return gname[g] || (gname[g] = 'g' + gi++); };
const P = (name, num, ref, side, extra) => Object.assign({ name, num, net: G(ref, num), side }, extra || {});
const parts = PCB.comps.filter(c => c.role === 'ic');
const BC = [];
for (let k = 0; k < 8; k++) BC.push({ id: 'TX' + k, kind: 'SW', out: 'TX' + k });
for (let k = 0; k < 4; k++) BC.push({ id: 'TV' + k, kind: 'SW', out: 'TV' + k });
const Q2 = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]];
for (const c of parts) {
  const r = c.ref;
  switch (c.part) {
    case '74LS192': BC.push({ id: r, kind: 'IC192', pins: [P('CDN', 4, r, 'L'), P('CUP', 5, r, 'L'), P('LOAD', 11, r, 'L'), P('CLR', 14, r, 'L'), P('A', 15, r, 'L'), P('B', 1, r, 'L'), P('C', 10, r, 'L'), P('D', 9, r, 'L'),
      P('QA', 3, r, 'R'), P('QB', 2, r, 'R'), P('QC', 6, r, 'R'), P('QD', 7, r, 'R'), P('BOR', 13, r, 'R'), P('CAR', 12, r, 'R')] }); break;
    case '74LS157': BC.push({ id: r, kind: 'IC157', pins: [P('SEL', 1, r, 'L'), P('EN', 15, r, 'L'), P('A0', 2, r, 'L'), P('B0', 5, r, 'L'), P('C0', 11, r, 'L'), P('D0', 14, r, 'L'), P('A1', 3, r, 'L'), P('B1', 6, r, 'L'), P('C1', 10, r, 'L'), P('D1', 13, r, 'L'),
      P('QA', 4, r, 'R'), P('QB', 7, r, 'R'), P('QC', 9, r, 'R'), P('QD', 12, r, 'R')] }); break;
    case '74LS74': BC.push({ id: r, kind: 'IC74', pins: [P('CLR/', 1, r, 'L', { half: 1 }), P('D', 2, r, 'L', { half: 1 }), P('CLK', 3, r, 'L', { half: 1 }), P('PR/', 4, r, 'L', { half: 1 }), P('Q', 5, r, 'R', { half: 1 }),
      P('CLR/', 13, r, 'L', { half: 2 }), P('D', 12, r, 'L', { half: 2 }), P('CLK', 11, r, 'L', { half: 2 }), P('PR/', 10, r, 'L', { half: 2 }), P('Q', 9, r, 'R', { half: 2 })] }); break;
    case '74LS04': BC.push({ id: r, kind: 'IC04', gates: [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]].map(([i, o]) => ({ ins: [G(r, i)], out: G(r, o) })) }); break;
    case '74LS08': case '74LS32': case '74LS86': case '74LS00': {
      const kind = { '74LS08': 'AND', '74LS32': 'OR', '74LS86': 'XOR', '74LS00': 'NAND' }[c.part];
      Q2.forEach(([a, b, o], i) => BC.push({ id: r + '.' + i, kind: 'GATE', gate: kind, ins: [G(r, a), G(r, b)], out: G(r, o) })); break;
    }
    case 'CD4078B': BC.push({ id: r, kind: 'GATE', gate: 'NOR8', ins: [2, 3, 4, 5, 9, 10, 11, 12].map(n => G(r, n)), out: G(r, 13) }); break;
  }
}
const BOARD = { COMPONENTS: BC };
// đọc đèn: LED ← điện trở ← nhóm logic
const lampG = {};
for (const d of PCB.comps.filter(c => c.role === 'led')) {
  const ga = grp(pin(d.ref, 1)), R = PCB.comps.find(c => c.role === 'res' && c.pins.some(p => grp(p) === ga));
  const other = R.pins.find(p => grp(p) !== ga); lampG[d.from] = gname[grp(other)] || G(R.ref, other.n);
}
// đọc số hiển thị: ngõ vào A,B,C,D (7,1,2,6) của 74LS247 cấp cho LED 7 đoạn bên trái (chục) và bên phải (đơn vị)
const disps = PCB.comps.filter(c => c.role === 'disp').sort((a, b) => a.x - b.x);
const decOf = d => { const g = grp(pin(d.ref, 7)); const R = PCB.comps.find(c => c.role === 'res' && c.pins.some(p => grp(p) === g)); const o = R.pins.find(p => grp(p) !== g); return PCB.comps.find(c => c.part === '74LS247' && c.pins.some(p => p.n === 13 && grp(p) === grp(o))); };
const decT = decOf(disps[0]), decU = decOf(disps[1]);
const bcd = (sim, dec) => { const b = [7, 1, 2, 6].map(n => sim.get(G(dec.ref, n))); return b.includes('X') ? 'X' : b.reduce((s, v, i) => s + (v << i), 0); };
const readBoard = s => ({ L: ['LXA', 'LVA', 'LDA', 'LXB', 'LVB', 'LDB'].map(k => s.get(lampG[k])).join(''), H: `${bcd(s, decT)}${bcd(s, decU)}` });
const readOrig = s => { const L = s.lights(); return { L: [L.XA, L.VA, L.DA, L.XB, L.VB, L.DB].join(''), H: (() => { const u = s.nibble('CU'), c = s.nibble('CC'); return `${c}${u}`; })() }; };

let cmpBad = 0, samples = 0;
const CASES = [[5, 2], [10, 3], [25, 9], [1, 1], [99, 9], [37, 4], [60, 5], [9, 7]];
for (const [TX, TV] of CASES) for (const midReset of [false, true]) {
  const a = new Sim(CIRCUIT), b = new Sim(BOARD);
  for (const s of [a, b]) { s.setSwitchValue('TX', TX); s.setSwitchValue('TV', TV); s.startClock(); }
  const Pd = a.period, tRel = 4 * Pd + 37, tEnd = tRel + (2 * (TX + TV) + 3) * Pd;
  let released = false, pressed = false, t = 0;
  while (t < tEnd + (midReset ? 3 * (TX + TV) * Pd : 0)) {
    t += Pd / 4;
    for (const s of [a, b]) s.advanceTo(t);
    if (!released && t >= tRel) { a.setReset(false); b.setReset(false); released = true; }
    if (midReset && !pressed && t >= tRel + (TX + 1.3) * Pd) { a.setReset(true); b.setReset(true); pressed = true; }
    if (midReset && pressed && a.resetHeld && t >= tRel + (TX + 4.3) * Pd) { a.setReset(false); b.setReset(false); }
    const A = readOrig(a), B = readBoard(b); samples++;
    if (A.L !== B.L || A.H !== B.H) { cmpBad++; if (cmpBad < 6) console.log(`  ✗ TX=${TX} TV=${TV} t=${t}: gốc ${A.L}/${A.H} · bo ${B.L}/${B.H}`); }
  }
}
ok(cmpBad === 0, 'mạch dựng từ lớp đồng khác mạch gốc');
console.log(`  ${cmpBad ? '✗' : '✓'} ${CASES.length * 2} kịch bản (có RESET giữa chừng), ${samples} lần lấy mẫu: 6 đèn và số hiển thị trùng khớp mạch gốc`);

/* ---------- 4. mạch phụ ---------- */
head('4. Mạch phụ trợ');
const same = (r1, n1, r2, n2) => grp(pin(r1, n1)) === grp(pin(r2, n2));
const VCC = grp(pin('J1', 1)), GND = grp(pin('J1', 2));
const isV = (r, n) => grp(pin(r, n)) === VCC, isG = (r, n) => grp(pin(r, n)) === GND;
// IC nguồn
for (const c of parts) { const [v, g] = c.fp === 'DIP8' ? [8, 1] : c.fp === 'DIP14' ? [14, 7] : [16, 8]; ok(isV(c.ref, v) && isG(c.ref, g), `${c.ref} cấp nguồn sai`); }
// tụ lọc: mỗi IC có tụ 100 nF nối VCC–GND
ok(PCB.comps.filter(c => c.value === '104').every(c => isV(c.ref, 1) && isG(c.ref, 2)) && PCB.comps.filter(c => c.value === '104').length === parts.length, 'tụ lọc 100 nF');
// NE555 bất ổn
const res = ref => C[ref];
ok(isV('U1', 4) && same('U1', 2, 'U1', 6) && same('R1', 1, 'U1', 7) && isV('R1', 2) && same('R2', 2, 'U1', 7) && same('R2', 1, 'U1', 6) && same('C1', 1, 'U1', 6) && isG('C1', 2) && same('C2', 1, 'U1', 5) && isG('C2', 2), 'NE555 không đúng mạch dao động');
// công tắc
for (let k = 1; k <= 8; k++) ok(isV('SW1', 17 - k) && same('RN1', k + 1, 'SW1', k), 'SW1 vị trí ' + k);
for (let k = 1; k <= 4; k++) ok(isV('SW2', 9 - k) && same('RN2', k + 1, 'SW2', k), 'SW2 vị trí ' + k);
ok(isG('RN1', 1) && isG('RN2', 1) && isV('RN3', 1), 'chân chung điện trở mạng');
ok(isG('SW3', 1) && isV('SW3', 3), 'SW3 RESET');
// kéo lên đúng 8 ngõ vào CD4078B
ok([2, 3, 4, 5, 6, 7, 8, 9].every(k => [2, 3, 4, 5, 9, 10, 11, 12].some(n => same('RN3', k, 'U14', n))), 'RN3 kéo lên');
// 74LS247 → điện trở → đúng đoạn
const SEG247 = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 }, SEG7 = { a: 7, b: 6, c: 4, d: 2, e: 1, f: 9, g: 10 };
for (const [disp, dec] of [[disps[0], decT], [disps[1], decU]]) {
  ok(isV(disp.ref, 3) && isV(disp.ref, 8) && isV(dec.ref, 3) && isV(dec.ref, 5), disp.ref + ' anode chung / LT / RBI');
  for (const s in SEG247) { const R = PCB.comps.find(c => c.role === 'res' && c.pins.some(p => grp(p) === grp(pin(dec.ref, SEG247[s])))); ok(R && R.pins.some(p => grp(p) === grp(pin(disp.ref, SEG7[s]))), `${dec.ref} đoạn ${s} → ${disp.ref}`); }
}
ok(decT.pins.find(p => p.n === 7) && decT !== decU, 'hai bộ giải mã');
// LED: catốt về GND
for (const d of PCB.comps.filter(c => c.role === 'led')) ok(isG(d.ref, 2), d.ref + ' catốt');
// không IC nào ngoài danh sách
const IC_LIST = ['U1 NE555', 'U2 74LS192', 'U3 74LS192', 'U4 74LS157', 'U5 74LS157', 'U6 74LS74', 'U7 74LS86', 'U8 74LS08', 'U9 74LS04', 'U10 74LS247', 'U11 74LS247', 'U12 74LS74', 'U13 74LS32', 'U14 CD4078B', 'U15 74LS00'];
ok(parts.map(c => c.ref + ' ' + c.part).sort().join() === IC_LIST.sort().join(), 'danh sách IC');
console.log(`  ${fails ? '' : '✓ '}nguồn, tụ lọc, NE555, công tắc + kéo xuống, kéo lên CD4078B, 247 → đoạn LED, LED đèn`);

console.log(fails ? `\n✗ ${fails} lỗi` : '\n✓ Bo mạch khớp mạch gốc.');
process.exit(fails ? 1 : 0);
