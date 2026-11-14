/* tests.js — 5 kịch bản kiểm thử của báo cáo: (1) kịch bản chạy sống cho giao diện, (2) tự kiểm bằng mô phỏng chạy nhanh. */
(function (root) {
  'use strict';
  const NEXT = { '11': '00', '00': '01', '01': '10', '10': '11' };
  const PN = { '00': 'P0', '01': 'P1', '10': 'P2', '11': 'P3' };
  const EXPECT = {
    '11': { XA: 0, VA: 0, DA: 1, XB: 0, VB: 1, DB: 0 }, '00': { XA: 1, VA: 0, DA: 0, XB: 0, VB: 0, DB: 1 },
    '01': { XA: 0, VA: 1, DA: 0, XB: 0, VB: 0, DB: 1 }, '10': { XA: 0, VA: 0, DA: 1, XB: 1, VB: 0, DB: 0 } };

  const TESTS = {
    1: { title: 'Test 1 – Khởi động và giữ RESET', TX: 5, TV: 2,
      goal: 'Bật nguồn với RESET đang giữ, chờ ít nhất 3 nhịp CLK. Mạch phải thoát khỏi X và vào trạng thái RESET.' },
    2: { title: 'Test 2 – Chạy một vòng đầy đủ (T_X = 05, T_V = 2)', TX: 5, TV: 2,
      goal: 'Nhả RESET, quan sát P0 → P1 → P2 → P3 → P0; một vòng dài 2 × (5 + 2) = 14 nhịp.' },
    3: { title: 'Test 3 – Thời gian có hàng chục (T_X = 25, T_V = 3)', TX: 25, TV: 3,
      goal: 'P0 phải đếm 25 → 24 → … → 20 → 19 → … → 01 (không nhảy từ 25 xuống 15).' },
    4: { title: 'Test 4 – Giá trị biên (T_X = 10, T_V = 1)', TX: 10, TV: 1,
      goal: 'P0 đếm 10 → 01; P1, P3 chỉ dài 1 nhịp mà vẫn đổi đèn đúng thứ tự.' },
    5: { title: 'Test 5 – Bấm RESET giữa chừng (T_X = 10, T_V = 3)', TX: 10, TV: 3,
      goal: 'Đang ở P2 (B xanh), giữ RESET ≥ 3 nhịp rồi nhả. Mạch phải về trạng thái RESET rồi bắt đầu lại từ P0.' }
  };

  /* ---------- tự kiểm: chạy mô phỏng nhanh ---------- */
  function observe(sim, tend, opts) {
    const P = sim.period, trans = [], samples = []; let last = sim.state(), sawX = false, lampBad = 0;
    const nextSample = { t: Math.ceil(sim.t / P) * P + 120 };
    const probe = s => {
      const st = s.state(); if (st.includes('X') || s.hex() === 'X') sawX = true;
      if (st !== last) { trans.push([s.t, st]); last = st; }
    };
    // lấy mẫu mỗi nhịp tại t = k·P + 120 (CLK đã ổn định)
    while (nextSample.t <= tend) {
      sim.advanceTo(nextSample.t, probe);
      const L = sim.lights(), st = sim.state();
      const a = L.XA + L.VA + L.DA, b = L.XB + L.VB + L.DB, twoGreen = L.XA === 1 && L.XB === 1;
      if (!st.includes('X') && (a !== 1 || b !== 1 || twoGreen)) lampBad++;
      samples.push({ t: nextSample.t, state: st, hex: sim.hex(), lights: L });
      nextSample.t += P;
    }
    sim.advanceTo(tend, probe);
    // lọc nhiễu: pha < P/4 là xung ngắn giữa hai flip-flop
    const clean = []; trans.forEach((tr, i) => { const tn = i + 1 < trans.length ? trans[i + 1][0] : tend; if (tn - tr[0] < P / 4) return; if (clean.length && clean[clean.length - 1][1] === tr[1]) return; clean.push(tr); });
    return { trans: clean, samples, sawX, lampBad };
  }
  function fresh(TX, TV) { const s = new LogicEngine.Sim(CIRCUIT); s.setSwitchValue('TX', TX); s.setSwitchValue('TV', TV); s.startClock(); return s; }
  const hexNum = h => (h === 'X' ? NaN : parseInt(h, 10));
  const seqOk = (trans, from = '11') => { let cur = from; return trans.every(t => (cur = NEXT[cur]) === t[1]); };

  function selfCheck(id) {
    const T = TESTS[id], P = 200, checks = []; const add = (ok, text) => checks.push({ ok: !!ok, text });
    const s = fresh(T.TX, T.TV);
    s.advanceTo(3 * P + 5);
    const L0 = s.lights();
    if (id === 1) {
      let toggles = 0; const base = s.t; let lastH = s.get('HET_N');
      s.advanceTo(base + 6 * P, ss => { const h = ss.get('HET_N'); if (h !== lastH) { toggles++; lastH = h; } });
      add(s.hex() === '00', 'HEX = 00 khi giữ RESET');
      add(s.state() === '11', 'Q1Q0 = 11 (hàng RESET của bảng pha)');
      const L = s.lights(); add(Object.keys(EXPECT['11']).every(k => L[k] === EXPECT['11'][k]), 'Đèn: ĐA = 1, VB = 1, các đèn còn lại = 0');
      add(s.get('RSY') === 1, 'RSY = 1 (U12 đã đồng bộ RESET)');
      add(toggles >= 8, 'HET_N nhảy 0/1 theo CLK (' + toggles + ' lần đổi trong 6 nhịp)');
      const anyX = Object.keys(s.net).filter(n => s.net[n] === 'X' && !n.includes('.'));
      add(anyX.length === 0, 'Không tín hiệu nào còn là X' + (anyX.length ? ' (' + anyX.join(', ') + ')' : ''));
      return { title: T.title, checks };
    }
    // các test còn lại: nhả RESET (đúng lúc bất kỳ)
    s.advanceTo(4 * P + 37);
    if (id === 5) {
      s.setReset(false);
      const o1 = observe(s, s.t + 40 * P, null);
      // giữ tại P2 (10) nếu thấy
      // chạy đến P2 rồi bấm reset
      const s2 = fresh(T.TX, T.TV); s2.advanceTo(4 * P + 37); s2.setReset(false);
      let guard = 0; while (s2.state() !== '10' && guard++ < 400) s2.advanceTo(s2.t + P / 2);
      add(s2.state() === '10', 'Mạch đang ở P2 (B xanh) trước khi bấm RESET');
      s2.advanceTo(s2.t + 3 * P + 17); s2.setReset(true);
      s2.advanceTo(s2.t + 4 * P);
      add(s2.state() === '11' && s2.hex() === '00', 'Đang giữ RESET: Q1Q0 = 11, HEX = 00');
      const Lr = s2.lights(); add(Object.keys(EXPECT['11']).every(k => Lr[k] === EXPECT['11'][k]), 'Đèn về đúng hàng RESET của bảng');
      s2.setReset(false); const trel = s2.t;
      const o2 = observe(s2, trel + (2 * (T.TX + T.TV) + 4) * P, null);
      add(!o2.sawX, 'Sau khi nhả: không có X');
      add(o2.trans.length >= 4 && o2.trans[0][1] === '00', 'Sau khi nhả mạch bắt đầu lại từ P0 (A xanh)');
      add(seqOk(o2.trans), 'Thứ tự pha đúng: ' + o2.trans.slice(0, 5).map(t => PN[t[1]]).join(' → '));
      const p0 = o2.samples.filter(x => x.state === '00' && x.t > trel).slice(0, 2).map(x => x.hex);
      add(p0.length && parseInt(p0[0], 10) >= T.TX - 1, 'P0 bắt đầu đếm từ số T_X (' + p0.join(', ') + ' …)');
      return { title: T.title, checks };
    }
    s.setReset(false); const trel = s.t, cycles = 3;
    const o = observe(s, trel + (cycles * 2 * (T.TX + T.TV) + 4) * P, null);
    add(!o.sawX, 'Không có X sau khi nhả RESET');
    add(seqOk(o.trans), 'Thứ tự pha: ' + o.trans.slice(0, 5).map(t => PN[t[1]]).join(' → ') + ' …');
    // thời lượng mỗi pha (bỏ pha đầu tiên vì bắt đầu bất đồng bộ)
    const dur = { '00': T.TX, '01': T.TV, '10': T.TX, '11': T.TV }; let durOk = true, detail = [];
    for (let i = 1; i + 1 < o.trans.length; i++) { const L = (o.trans[i + 1][0] - o.trans[i][0]) / P; if (Math.abs(L - dur[o.trans[i][1]]) > 0.05) durOk = false; if (i <= 4) detail.push(PN[o.trans[i][1]] + ' = ' + L.toFixed(0) + ' nhịp'); }
    add(durOk, 'Độ dài các pha: ' + detail.join(', '));
    const idx0 = o.trans.findIndex((t, i) => i > 0 && t[1] === '00'); const idx1 = o.trans.findIndex((t, i) => i > idx0 && t[1] === '00');
    if (idx0 >= 0 && idx1 > idx0) { const cyc = (o.trans[idx1][0] - o.trans[idx0][0]) / P; add(Math.abs(cyc - 2 * (T.TX + T.TV)) < 0.05, 'Một vòng = ' + cyc.toFixed(0) + ' nhịp (lý thuyết 2 × (' + T.TX + ' + ' + T.TV + ') = ' + 2 * (T.TX + T.TV) + ')'); }
    add(o.lampBad === 0, 'Mỗi hướng luôn đúng 1 đèn sáng, không bao giờ hai đèn xanh cùng sáng');
    // bảng đèn theo pha
    let tableOk = true; for (const smp of o.samples) { if (smp.state.includes('X')) continue; const E = EXPECT[smp.state]; if (!Object.keys(E).every(k => smp.lights[k] === E[k])) tableOk = false; }
    add(tableOk, 'Đèn khớp bảng mong đợi ở mọi pha');
    if (id === 2) {
      const p0 = o.samples.filter(x => x.state === '00' && x.t > trel + 2 * P).slice(0, 5).map(x => x.hex);
      add(p0[0] === '05' || p0[0] === '04', 'P0 hiện ' + p0.join(' → ') + ' …');
    }
    if (id === 3 || id === 4) {
      // P0 trong vòng thứ 2: dãy HEX phải là T_X, T_X−1, …, 01 liên tục
      const tStart = o.trans.filter((t, i) => i > 0 && t[1] === '00')[0];
      if (tStart) { const next = o.trans.find(t => t[0] > tStart[0]); const run = o.samples.filter(x => x.t > tStart[0] && x.t < next[0]).map(x => hexNum(x.hex));
        let cont = run.length === T.TX; for (let i = 1; i < run.length; i++) if (run[i] !== run[i - 1] - 1) cont = false;
        add(cont && run[0] === T.TX && run[run.length - 1] === 1, 'P0 đếm ' + (run.length ? run[0] + ' → ' + run[1] + ' → … → ' + run[run.length - 1] : '(không lấy được mẫu)') + ', liên tục từng bước 1' + (id === 3 ? ', không nhảy 25 → 15' : '')); }
      const p1 = o.trans.filter((t, i) => i > 0 && t[1] === '01')[0]; if (p1) { const nx = o.trans.find(t => t[0] > p1[0]); add(Math.abs((nx[0] - p1[0]) / P - T.TV) < 0.05, 'P1 dài ' + T.TV + ' nhịp'); }
    }
    return { title: T.title, checks };
  }

  /* ---------- kịch bản chạy sống: danh sách bước, app.js chạy ---------- */
  function script(id) {
    const T = TESTS[id], steps = [];
    steps.push({ say: T.goal });
    steps.push({ act: a => { a.powerCycle(T.TX, T.TV); } });
    steps.push({ wait: 4, say: 'Đang giữ RESET: quan sát các X biến mất, HEX = 00, Q1Q0 = 11.' });
    if (id === 1) { steps.push({ wait: 3, say: 'Mạch ổn định ở trạng thái RESET. Có thể bấm "Nhả" bằng nút RESET để chạy tiếp.' }); return steps; }
    steps.push({ act: a => a.setReset(false), say: 'Nhả RESET: U12 sẽ chờ cạnh HET_N tiếp theo rồi mới nhả U6 → mạch vào P0.' });
    if (id === 5) {
      steps.push({ until: a => a.sim.state() === '10', say: 'Chờ mạch vào P2 (B xanh)…' });
      steps.push({ wait: 3, say: 'Đang ở P2. 3 nhịp nữa sẽ bấm RESET.' });
      steps.push({ act: a => a.setReset(true), say: 'Bấm RESET giữa chừng: RST = 1 xóa bộ đếm ngay, RSY ép U6 về 11.' });
      steps.push({ wait: 4, say: 'Giữ RESET 4 nhịp: về đúng hàng RESET của bảng.' });
      steps.push({ act: a => a.setReset(false), say: 'Nhả RESET: mạch bắt đầu lại từ P0 với số T_X.' });
      steps.push({ wait: 2 * (T.TX + T.TV) + 2, say: 'Chạy tiếp một vòng đầy đủ.' });
      return steps;
    }
    steps.push({ wait: 2 * (T.TX + T.TV) + 3, say: 'Chạy một vòng: P0 → P1 → P2 → P3.' });
    return steps;
  }

  const API = { TESTS, selfCheck, script, EXPECT, PN };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.TESTS_API = API;
})(typeof window !== 'undefined' ? window : globalThis);
