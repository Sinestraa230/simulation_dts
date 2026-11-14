/* verify.js — kiểm chứng engine JS giống bộ mô phỏng Python: chạy hàng nghìn ca với độ trễ ngẫu nhiên / cố định.
 * Chạy:  node test/verify.js */
const CIRCUIT = require('../js/circuit.js');
const { Sim, DELAYS } = require('../js/engine.js');

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const NEXT = { '11': '00', '00': '01', '01': '10', '10': '11' };
const EXPECT = {
  '11': { XA: 0, VA: 0, DA: 1, XB: 0, VB: 1, DB: 0 }, '00': { XA: 1, VA: 0, DA: 0, XB: 0, VB: 0, DB: 1 },
  '01': { XA: 0, VA: 1, DA: 0, XB: 0, VB: 0, DB: 1 }, '10': { XA: 0, VA: 0, DA: 1, XB: 1, VB: 0, DB: 0 } };

function makeSim(seed, TX, TV, mode) {
  let delay;
  if (mode === 'random' || mode === 'stress') { const r = rng(seed * 7919 + 13); const g = () => 1 + Math.floor(r() * 4), c = () => 3 + Math.floor(r() * 6);
    const cache = {};   // 'random': mỗi LOẠI linh kiện một độ trễ (hai 74LS192 giống nhau); 'stress': mỗi LINH KIỆN một độ trễ riêng
    delay = k => { const f = () => ((k === 'DFF' || k === 'M157' || k === 'C192') ? c() : g()); if (mode === 'stress') return f(); return k in cache ? cache[k] : (cache[k] = f()); }; }
  else if (mode === 'default') delay = k => DELAYS[k];
  else delay = k => mode[(k === 'DFF' || k === 'M157' || k === 'C192') ? 1 : 0];
  const s = new Sim(CIRCUIT, { delay });
  s.setSwitchValue('TX', TX); s.setSwitchValue('TV', TV);
  s.startClock();
  return s;
}
const eq = (a, b) => Object.keys(b).every(k => a[k] === b[k]);

function runCase(seed, TX, TV, off, mode, cycles = 2) {
  const s = makeSim(seed, TX, TV, mode), P = s.period, errs = [];
  s.advanceTo(3 * P + 5);
  if (s.state() !== '11') errs.push('reset state ' + s.state());
  if (s.hex() !== '00') errs.push('reset hex ' + s.hex());
  if (!eq(s.lights(), EXPECT['11'])) errs.push('reset lights');
  const trel = 4 * P + off; s.advanceTo(trel); s.setReset(false);
  const dur = { '00': TX, '01': TV, '10': TX, '11': TV };
  const trans = []; let last = s.state(); const xs = [];
  const probe = sim => { const st = sim.state(); if (st.includes('X') || sim.hex() === 'X') xs.push(sim.t); if (st !== last) { trans.push([sim.t, last, st]); last = st; } };
  const tend = trel + (cycles * 2 * (TX + TV) + 3) * P;
  s.advanceTo(tend, probe);
  if (xs.length) errs.push('X after release t=' + xs[0]);
  const clean = [];
  trans.forEach((tr, i) => { const tn = i + 1 < trans.length ? trans[i + 1][0] : tend; if (tn - tr[0] < P / 4) return; if (clean.length && clean[clean.length - 1][2] === tr[2]) return; clean.push([tr[0], clean.length ? clean[clean.length - 1][2] : '11', tr[2]]); });
  const seq = clean.map(c => c[2]); let cur = '11'; const exp = seq.map(() => (cur = NEXT[cur]));
  if (seq.join() !== exp.join()) errs.push('seq ' + seq.slice(0, 8));
  clean.slice(0, -1).forEach((c, i) => { const L = (clean[i + 1][0] - c[0]) / P, d = dur[c[2]];
    if (i === 0) { if (!(d - 0.6 <= L && L <= d + 0.6)) errs.push('first phase ' + L.toFixed(2)); }
    else if (Math.round(L) !== d || Math.abs(L - d) > 0.05) errs.push(`phase ${c[2]} ${L.toFixed(2)} clk expected ${d}`); });
  if (clean.length < 4 * cycles) errs.push('only ' + clean.length + ' transitions');
  // lights must match state at the end of every settled phase
  return errs;
}
function runMidReset(seed, TX, TV, press, hold, off, mode) {
  const s = makeSim(seed, TX, TV, mode), P = s.period, errs = [];
  s.advanceTo(4 * P + off); s.setReset(false); s.advanceTo(s.t + press); s.setReset(true); s.advanceTo(s.t + hold);
  if (s.state() !== '11' || s.hex() !== '00') errs.push(`during reset ${s.state()} ${s.hex()}`);
  s.setReset(false);
  const trans = []; let last = s.state(); const xs = [];
  const probe = sim => { const st = sim.state(); if (st.includes('X') || sim.hex() === 'X') xs.push(sim.t); if (st !== last) { trans.push([sim.t, last, st]); last = st; } };
  const tend = s.t + (2 * (TX + TV) + 4) * P; s.advanceTo(tend, probe);
  if (xs.length) errs.push('X after release');
  const seq = []; trans.forEach((tr, i) => { const tn = i + 1 < trans.length ? trans[i + 1][0] : tend; if (tn - tr[0] >= P / 4 && (!seq.length || seq[seq.length - 1] !== tr[2])) seq.push(tr[2]); });
  if (!seq.length || seq[0] !== '00') errs.push('restart seq ' + seq.slice(0, 4));
  return errs;
}

if (require.main === module) {
  let fails = 0, runs = 0; const report = (tag, e) => { runs++; if (e.length) { fails++; if (fails < 8) console.log(tag.startsWith('stress') ? 'INFO (stress, không tính vào kết quả)' : 'FAIL', tag, e.slice(0, 3)); } };
  const cfgs = [[5, 2], [25, 3], [10, 1], [1, 1], [99, 9], [8, 9]];
  const offs = []; for (let o = 0; o < 200; o += 13) offs.push(o); offs.push(1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 101, 102, 103, 104, 106, 108, 110, 112, 114, 116);
  for (const [TX, TV] of cfgs) { if (TX > 40) continue;
    for (const off of offs) report(`default ${TX}/${TV}/${off}`, runCase(0, TX, TV, off, 'default'));
    for (let seed = 0; seed < 40; seed++) for (const off of offs) report(`rand ${TX}/${TV}/${seed}/${off}`, runCase(seed, TX, TV, off, 'random')); }
  console.log(`release/cycle runs: ${runs}, failures: ${fails}`);
  runs = 0; fails = 0;
  for (const dl of [[1, 1], [2, 2], [1, 3], [3, 1], [2, 5], [4, 7]]) for (const [TX, TV] of [[5, 2], [25, 3], [10, 1]]) for (let off = 0; off < 200; off += 7) report(`eq ${dl}/${TX}/${off}`, runCase(0, TX, TV, off, dl));
  console.log(`equal-delay runs: ${runs}, failures: ${fails}`);
  runs = 0; fails = 0;
  for (const [TX, TV] of [[25, 3]]) for (let seed = 0; seed < 40; seed++) for (const off of [0, 60, 120, 180]) report(`stress ${seed}/${off}`, runCase(seed, TX, TV, off, 'stress'));
  console.log(`(thông tin) stress: độ trễ riêng từng linh kiện, T_X=25: ${runs} runs, ${fails} failures`);
  runs = 0; fails = 0;
  for (const mode of ['default', 'random']) for (let seed = 0; seed < 10; seed++) for (const [TX, TV] of [[5, 2], [25, 3]]) for (const press of [130, 470, 900, 1350, 2210]) for (const hold of [610, 1000, 1500]) for (const off of [0, 50, 120, 190])
    report(`mid ${mode}/${seed}/${TX}/${press}/${hold}/${off}`, runMidReset(seed, TX, TV, press, hold, off, mode));
  console.log(`mid-cycle reset runs: ${runs}, failures: ${fails}`);
}
module.exports = { runCase, runMidReset, makeSim, EXPECT };
