/* app.js — ghép engine + sơ đồ + giản đồ + ngã tư + kịch bản test thành một trang. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = 200;                                    // 1 nhịp CLK = 200 đơn vị mô phỏng
  const layout = LAYOUT.build(CIRCUIT);
  const PHASE = { '00': ['P0', 'A:X · B:Đ'], '01': ['P1', 'A:V · B:Đ'], '10': ['P2', 'A:Đ · B:X'], '11': ['P3', 'A:Đ · B:V'] };
  const MODES = { real: { upms: 0.2 }, x4: { upms: 0.8 }, x16: { upms: 3.2 }, slow: {}, step: {} };

  const A = { sim: null, powered: false, running: false, mode: 'real', script: null, lastNow: performance.now(), card: null, caps: [], lastCap: { text: '', t: 0 }, pend: null, lastPhase: null };
  window.APP = A;

  /* ---------- sơ đồ ---------- */
  const R = RENDER.create($('circuit'), {
    circuit: CIRCUIT, layout, routes: window.ROUTES,
    onSwitch: id => toggleSwitch(id),
    onSelect: id => openCard({ type: 'comp', id }),
    onNet: n => openCard({ type: 'net', id: n }),
    onNetHover: (n, ev) => showTip(n, ev)
  });
  A.R = R;
  const TM = TIMING.create($('timing'), P);
  const SC = SCENE.create({});
  const SPEEDF = { real: 1, x4: 2.2, x16: 3.5, slow: 1, step: 0 };

  /* ---------- sim ---------- */
  function newSim(TX, TV) {
    const sim = new LogicEngine.Sim(CIRCUIT);
    if (TX !== undefined) { sim.setSwitchValue('TX', TX); sim.setSwitchValue('TV', TV); }
    else { sim.setSwitchValue('TX', +$('inTX').value || 5); sim.setSwitchValue('TV', +$('inTV').value || 2); }
    sim.onChange((t, net, old, v) => {
      R.setValue(net, v);
      if (R.pulsesOn && A.mode !== 'x16') R.pulse(net, v, performance.now());
      TM.record(sim, t, net);
      captionRules(sim, t, net, old, v);
    });
    A.sim = sim; A.pend = null; A.lastPhase = null;
    R.clearPulses(); R.refreshAll(sim); TM.reset(sim); SC.clear();
    syncInputs(); updateResetBtn();
    return sim;
  }
  function syncInputs() {
    const sim = A.sim; const tx = sim.getSwitchValue('TX'), tv = sim.getSwitchValue('TV');
    if (document.activeElement !== $('inTX')) $('inTX').value = tx; if (document.activeElement !== $('inTV')) $('inTV').value = tv;
  }
  function updateResetBtn() {
    const held = A.sim.resetHeld; const b = $('btnReset'); b.classList.toggle('rel', !held); b.querySelector('b').textContent = held ? 'đang giữ' : 'đã nhả';
    R.setSwitch('SW-RESET', held ? 0 : 1);
  }
  function setReset(held) { A.sim.setReset(held); updateResetBtn(); }
  function toggleSwitch(id) {
    const sim = A.sim;
    if (id === 'SW-RESET') { setReset(!sim.resetHeld); return; }
    const v = 1 - sim.sw[id]; sim.setSwitch(id, v); R.setSwitch(id, v); syncInputs();
  }

  /* ---------- nguồn / chạy ---------- */
  function powerOn() {
    if (A.powered) return; A.powered = true; A.userPaused = false; A.sim.startClock(); setMode(A.mode);
    $('powerOverlay').classList.add('hide'); $('btnPower').textContent = '⏻ Tắt nguồn'; $('btnPower').classList.remove('primary'); $('btnPause').disabled = false;
    addCaption('Bật nguồn: mọi tín hiệu đang là X. RESET đang giữ nên sau 2–3 nhịp CLK, các X sẽ biến mất.', true);
  }
  function powerOff() {
    A.powered = false; A.running = false; A.script = null; newSim();
    $('powerOverlay').classList.remove('hide'); $('btnPower').textContent = '▶ Bật nguồn'; $('btnPower').classList.add('primary'); $('btnPause').disabled = true; $('btnPause').textContent = '⏸ Tạm dừng';
    A.caps = []; renderCaps(); closeTestMark();
  }
  A.powerCycle = (TX, TV) => { A.powered = false; newSim(TX, TV); A.caps = []; renderCaps(); powerOn(); };
  A.setReset = setReset;
  function setPause(p) { A.running = !p && A.powered && A.mode !== 'step'; $('btnPause').textContent = p ? '▶ Tiếp tục' : '⏸ Tạm dừng'; A.userPaused = p; }
  function setMode(m) {
    A.mode = m; document.querySelectorAll('#speedSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('btnStep').hidden = m !== 'step'; $('btnEdge').hidden = m !== 'step';
    A.running = A.powered && m !== 'step' && !A.userPaused; $('btnPause').disabled = !A.powered || m === 'step';
    SC.setSpeed(SPEEDF[m]);
    if (m === 'x16') R.clearPulses();
  }

  /* ---------- vòng lặp ---------- */
  function advance(dt) {
    const sim = A.sim;
    if (A.mode === 'slow') {
      const nt = sim.nextEventTime(); if (nt - sim.t > 12) sim.advanceTo(nt - 12);
      sim.advanceTo(sim.t + dt / 80);
    } else sim.advanceTo(sim.t + dt * MODES[A.mode].upms);
  }
  function frame(now) {
    const dt = Math.min(now - A.lastNow, 100); A.lastNow = now;
    const sim = A.sim;
    if (A.running) advance(dt);
    runScript();
    R.tick(now);
    TM.draw(sim.t); if (((now / 1000) | 0) % 5 === 0) TM.prune(sim.t);
    SC.update(dt / 1000, (A.running || !A.powered) && !(A.mode === 'step' && A.powered)); SC.render();
    updateStatus();
    requestAnimationFrame(frame);
  }
  function updateStatus() {
    const sim = A.sim, st = sim.state(), hx = sim.hex(), L = sim.lights();
    $('stTime').textContent = `t = ${(sim.t / P).toFixed(1)} nhịp`;
    $('stState').textContent = `Q1Q0 = ${st}`; $('stCount').textContent = `HEX = ${hx === 'X' ? 'XX' : hx}`;
    let ph;
    if (!A.powered) ph = 'Chưa cấp nguồn';
    else if (st.includes('X')) ph = 'Đang thoát X…';
    else if (sim.get('RST_N') === 0 || sim.get('RSY') === 1) ph = 'RESET · A:Đ · B:V';
    else ph = `${PHASE[st][0]} · ${PHASE[st][1]}`;
    $('stPhase').textContent = ph; $('phaseTag').textContent = ph;
    const big = $('bigHex'); big.textContent = hx === 'X' ? 'XX' : hx; big.classList.toggle('x', hx === 'X');
    // đèn
    const lamp = (r, v, y, x) => `<span class="lt ${r === 1 ? 'r' : 'n'}">Đ</span><span class="lt ${v === 1 ? 'y' : 'n'}">V</span><span class="lt ${x === 1 ? 'g' : 'n'}">X</span>`;
    $('lampText').innerHTML = `<div>Hướng A ${lamp(L.DA, L.VA, 0, L.XA)}</div><div>Hướng B ${lamp(L.DB, L.VB, 0, L.XB)}</div>`;
    const col = (d, v, x) => (d === 'X' || v === 'X' || x === 'X') ? 'n' : (x === 1 ? 'g' : (v === 1 ? 'y' : (d === 1 ? 'r' : 'n')));
    const lA = col(L.DA, L.VA, L.XA), lB = col(L.DB, L.VB, L.XB);
    SC.setLights(lA, lB); const hn = parseInt(hx, 10), addV = (!st.includes('X') && st[1] === '0') ? A.sim.getSwitchValue('TV') : 0;
    SC.setCount(hx === 'X' ? 'XX' : hx, (hx === 'X' || isNaN(hn)) ? 'XX' : String(hn + addV).padStart(2, '0'));   // đèn đỏ = số đếm + T_V khi đang ở pha xanh SC.setPower(A.powered);
    $('hudHex').textContent = hx === 'X' ? 'XX' : hx; $('hudHex').classList.toggle('x', hx === 'X');
    $('hudLamps').innerHTML = $('lampText').innerHTML; $('hudPhase').textContent = ph;
    $('hudStats').innerHTML = `Đã qua: A <b>${SC.stats.A}</b> · B <b>${SC.stats.B}</b> xe<br>Đang chờ: A <b>${SC.wait.A}</b> · B <b>${SC.wait.B}</b> xe`;
    // chú thích khi pha ổn định
    if (A.powered && !st.includes('X')) {
      if (A.pend !== st) { A.pend = st; A.pendT = sim.t; }
      else if (A.lastPhase !== st && sim.t - A.pendT > 40) {
        if (A.lastPhase !== null) addCaption(`Pha mới: ${PHASE[st][0]} (${PHASE[st][1]}). HEX nạp số ${(st === '00' || st === '10') ? 'T_X' : 'T_V'} rồi đếm lùi.`);
        A.lastPhase = st;
      }
    } else A.pend = null;
  }

  /* ---------- chú thích ---------- */
  function addCaption(text, force) {
    const sim = A.sim; if (!force && A.lastCap.text === text && sim.t - A.lastCap.t < 2 * P) return;
    A.lastCap = { text, t: sim.t }; A.caps.unshift({ text, t: sim.t }); if (A.caps.length > 4) A.caps.pop(); renderCaps();
  }
  function renderCaps() {
    $('captions').innerHTML = A.caps.length ? A.caps.map(c => `<li><span class="t">${(c.t / P).toFixed(1)}</span>${c.text}</li>`).join('') : '<li>Bật nguồn để bắt đầu. Chú thích sẽ hiện ở đây khi mạch hoạt động.</li>';
  }
  function captionRules(sim, t, net, old, v) {
    if (!A.powered || v === 'X' || old === 'X') return;
    const running = sim.get('RSY') === 0 && sim.get('RST_N') === 1;
    if (net === 'HET_N' && running) {
      if (v === 0) addCaption('Số đếm = 00 và CLK = 1 → G10 kéo <b>HET_N</b> xuống 0: U2, U3 nạp số của pha kế (U4, U5 chọn T_X hoặc T_V theo Q0_N).');
      else addCaption('<b>HET_N</b> lên 1: LOAD nhả, cạnh lên này làm U6 chốt sang pha kế tiếp.');
    } else if (net === 'RST_N') {
      if (v === 0) addCaption('RESET được giữ: <b>RST</b> = 1 xóa ngay U2, U3 về 00; MEN = 1 khóa U4, U5 ra 0000.', true);
      else addCaption('RESET nhả: U12 chờ cạnh lên của HET_N rồi mới nhả U6 (đồng bộ) để không có xung đua.', true);
    } else if (net === 'RSY') {
      if (v === 0) addCaption('<b>RSY</b> = 0: U6 được nhả, mạch bắt đầu từ P0 với số T_X.', true);
      else addCaption('U12 lấy mẫu RST_N = 0 theo cạnh HET_N → <b>RSY</b> = 1: ép U6 về 11 (RESET).', true);
    } else if (net === 'BOR' && v === 1 && old === 0 && running && sim.get('HET_N') === 1) {
      addCaption('U2 đếm qua 0 → <b>BOR</b> mượn: U3 (hàng chục) giảm 1.');
    }
  }

  /* ---------- thẻ chi tiết ---------- */
  const vcls = v => (v === 'X' ? 'vX' : (v === 1 ? 'v1' : 'v0'));
  const fv = v => `<span class="${vcls(v)}">${v}</span>`;
  const SEGTAB = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  function netVal(n) { return n === 'ONE' ? 1 : n === 'ZERO' ? 0 : A.sim.get(n); }
  function renderCard() {
    const c = A.card; if (!c) return; const sim = A.sim, body = $('cardBody');
    if (c.type === 'test') return;
    if (c.type === 'net') {
      const n = layout.nets[c.id]; if (!n) return;
      const info = CIRCUIT.NET_INFO[c.id] || (/^TX\d/.test(c.id) ? 'Bit T_X' : /^TV\d/.test(c.id) ? 'Bit T_V' : /^N[UC]\d/.test(c.id) ? 'Số sắp nạp (từ bộ chọn)' : /^C[UC]\d/.test(c.id) ? 'Bit số đang đếm' : '');
      const ldr = layout.comps[n.driver.comp].title + (n.driver.num ? ' chân ' + n.driver.num : '');
      body.innerHTML = `<h4>Dây ${c.id}</h4><div class="sub">${info}</div><p>Giá trị: ${fv(sim.get(c.id))}</p>
        <table><tr><th>Nguồn</th><td>${ldr}</td></tr><tr><th>Tải</th><td>${n.loads.map(l => layout.comps[l.comp].title + (l.num ? '.' + l.name + '(' + l.num + ')' : (l.name.startsWith('in') ? '' : '.' + l.name))).join(', ')}</td></tr></table>`;
      return;
    }
    const comp = layout.comps[c.id]; if (!comp) return;
    let h = `<h4>${comp.title}${comp.ic ? ' · ' + comp.ic : ''}</h4><div class="sub">${comp.vn || ''}</div>`;
    if (comp.kind === 'HEX') {
      const bits = comp.ins.map(n => sim.get(n)), bad = bits.includes('X'), val = bad ? 'X' : bits.reduce((s, b, i) => s + (b << i), 0);
      h += `<p>BCD vào: <span class="mono">${comp.ins.slice().reverse().map(n => n + '=' + sim.get(n)).join(' ')}</span> → số <b>${val}</b></p>`;
      h += `<p>74LS247 giải mã thành các đoạn sáng: <b class="mono">${bad ? '?' : (val <= 9 ? SEGTAB[val].split('').join(' ') : '—')}</b></p>`;
      h += `<table class="seg7"><tr><th>Số</th><th>Đoạn sáng (a–g)</th></tr>${SEGTAB.map((s, i) => `<tr${i === val ? ' style="background:#1b2a50"' : ''}><td>${i}</td><td class="mono">${s.split('').join(' ')}</td></tr>`).join('')}</table>`;
      h += `<p class="sub">Trong mạch thật, 74LS247 có ngõ ra tích cực mức thấp nên dùng với LED 7 đoạn anode chung; chân LT, RBI nối mức 1, BI/RBO để hở.</p>`;
    } else if (comp.kind === 'GATE' || comp.kind === 'IC04') {
      h += '<table><tr><th>Chân</th><th>Dây</th><th>Giá trị</th></tr>' + comp.pinsOut.map(p => `<tr><td>${(comp.kind === 'IC04' ? p.name + '(' + p.num + ')' : p.dir === 'out' ? 'ra' : p.name.replace('in', 'vào '))}</td><td class="mono">${p.net}</td><td>${fv(netVal(p.net))}</td></tr>`).join('') + '</table>';
    } else if (comp.kind === 'LAMP') {
      h += `<p>Ngõ vào <span class="mono">${comp.ins[0]}</span> = ${fv(sim.get(comp.ins[0]))}</p>`;
    } else if (comp.kind === 'CLOCK') {
      h += `<p>Trong mô phỏng: 1 chu kỳ = 200 đơn vị thời gian. Ở chế độ <b>Thực 1 Hz</b>, 1 chu kỳ = 1 giây thật.</p><p>CLK = ${fv(sim.get('CLK'))}</p>`;
    } else if (comp.pinsOut) {
      h += '<table><tr><th>Chân</th><th>Dây</th><th>Giá trị</th></tr>' + comp.pinsOut.map(p => `<tr><td>${p.name}${p.num !== '' ? ' (' + p.num + ')' : ''}</td><td class="mono">${p.net === null ? 'hở' : p.net}</td><td>${p.net === null ? '—' : fv(netVal(p.net))}</td></tr>`).join('') + '</table>';
    }
    body.innerHTML = h;
  }
  function openCard(c) { A.card = c; $('card').hidden = false; renderCard(); if (c.type === 'comp') R.selectComp(c.id); else R.selectComp(null); }
  function closeCard() { A.card = null; $('card').hidden = true; R.selectComp(null); closeTestMark(); }
  function closeTestMark() { document.querySelectorAll('.btn.test').forEach(b => b.classList.remove('run')); }
  setInterval(() => { if (A.card && A.card.type !== 'test') renderCard(); }, 200);

  /* ---------- tooltip dây ---------- */
  const tip = $('tip');
  function showTip(n, ev) {
    if (!n) { tip.hidden = true; return; }
    const info = CIRCUIT.NET_INFO[n] || '';
    tip.innerHTML = `<b>${n}</b> = ${fv(A.sim.get(n))}${info ? '<br>' + info : ''}`; tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 280) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
  }
  $('circuit').addEventListener('pointermove', ev => { if (!tip.hidden) { tip.style.left = Math.min(ev.clientX + 14, innerWidth - 280) + 'px'; tip.style.top = (ev.clientY + 14) + 'px'; tip.innerHTML = tip.innerHTML; } });

  /* ---------- kịch bản test ---------- */
  function runTest(id) {
    if (A.mode === 'step') setMode('real');
    setPause(false);
    closeTestMark(); document.querySelector(`.btn.test[data-test="${id}"]`).classList.add('run');
    const T = TESTS_API.TESTS[id], chk = TESTS_API.selfCheck(id);
    A.script = { id, steps: TESTS_API.script(id), i: 0, started: false, log: [] };
    A.card = { type: 'test', id }; $('card').hidden = false; R.selectComp(null);
    A.testInfo = { T, chk };
    renderTestCard();
  }
  function renderTestCard() {
    const { T, chk } = A.testInfo, sc = A.script;
    $('cardBody').innerHTML = `<h4>${T.title}</h4><div class="sub">${T.goal}</div>
      <p><b>Đang chạy:</b> <span id="testNow">${sc && sc.say ? sc.say : '—'}</span></p>
      <p style="margin-top:12px"><b>Tự kiểm bằng mô phỏng nhanh</b></p>
      <ul class="checks">${chk.checks.map(c => `<li class="${c.ok ? '' : 'bad'}">${c.text}</li>`).join('')}</ul>
      <p class="sub">Kết quả: ${chk.checks.filter(c => c.ok).length}/${chk.checks.length} tiêu chí đạt. Phần dưới là mô phỏng độc lập với cùng engine, chạy ngay không cần chờ.</p>`;
  }
  function runScript() {
    const sc = A.script; if (!sc || !A.running) return; const sim = A.sim;
    const st = sc.steps[sc.i];
    if (!st) { A.script = null; closeTestMark(); return; }
    if (!sc.started) {
      sc.started = true; if (st.say) { sc.say = st.say; const e = $('testNow'); if (e) e.textContent = st.say; }
      if (st.act) st.act(A); if (st.wait) sc.target = A.sim.t + st.wait * P;
      if (!st.wait && !st.until) { sc.i++; sc.started = false; }
      return;
    }
    if (st.wait && sim.t >= sc.target) { sc.i++; sc.started = false; }
    else if (st.until && st.until(A)) { sc.i++; sc.started = false; }
  }

  /* ---------- sự kiện giao diện ---------- */
  $('btnPower').onclick = () => (A.powered ? powerOff() : powerOn());
  $('btnPower2').onclick = powerOn;
  $('btnPause').onclick = () => setPause(!A.userPaused);
  document.querySelectorAll('#speedSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('btnStep').onclick = () => {
    if (!A.powered) powerOn(); A.running = false;
    const sim = A.sim, before = { ...sim.net }, nt = sim.stepOne(); if (nt === null) return;
    const ch = Object.keys(sim.net).filter(k => before[k] !== sim.net[k] && !k.includes('.')).map(k => `${k}: ${before[k]}→${sim.net[k]}`);
    addCaption(`Sự kiện t = ${nt}: ${ch.join(', ') || '(không đổi)'}`, true);
  };
  $('btnEdge').onclick = () => { if (!A.powered) powerOn(); A.running = false; const tc = A.sim.nextClockTime(); A.sim.advanceTo(tc); };
  $('btnReset').onclick = () => setReset(!A.sim.resetHeld);
  const applyParams = () => { let tx = Math.max(1, Math.min(99, +$('inTX').value || 1)), tv = Math.max(1, Math.min(9, +$('inTV').value || 1)); A.sim.setSwitchValue('TX', tx); A.sim.setSwitchValue('TV', tv); for (const id in R.swEls) if (id !== 'SW-RESET') R.setSwitch(id, A.sim.sw[id]); $('inTX').value = tx; $('inTV').value = tv; };
  $('inTX').onchange = applyParams; $('inTV').onchange = applyParams;
  document.querySelectorAll('.btn.test').forEach(b => b.onclick = () => runTest(+b.dataset.test));
  document.querySelectorAll('#winSeg button').forEach(b => b.onclick = () => { document.querySelectorAll('#winSeg button').forEach(x => x.classList.toggle('on', x === b)); TM.setWindow(+b.dataset.win); });
  $('chkPulse').onchange = e => { R.pulsesOn = e.target.checked; if (!R.pulsesOn) R.clearPulses(); };
  document.querySelectorAll('#zoomBar button').forEach(b => b.onclick = () => (b.dataset.focus ? R.focus(b.dataset.focus) : R.fit()));
  $('cardClose').onclick = closeCard;
  $('btnHelp').onclick = () => ($('helpModal').hidden = false); $('helpClose').onclick = () => ($('helpModal').hidden = true);
  $('helpModal').onclick = e => { if (e.target === $('helpModal')) $('helpModal').hidden = true; };
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code === 'Space') { e.preventDefault(); if (!A.powered) powerOn(); else if (A.mode !== 'step') setPause(!A.userPaused); } if (e.key === 'Escape') closeCard(); });

  /* ---------- chế độ xem ---------- */
  function setView(v) {
    A.view = v; $('main').className = 'view-' + v;
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    SC.setTargets(v === 'circuit' ? [$('sceneMini')] : [$('sceneBig')]);
    if (v !== 'city') requestAnimationFrame(() => requestAnimationFrame(() => R.fit()));
    try { history.replaceState(null, '', v === 'circuit' ? location.pathname : '#' + v); } catch (e) { }
  }
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('sceneMini').onclick = () => setView('split');
  document.querySelectorAll('#todSeg button').forEach(b => b.onclick = () => { document.querySelectorAll('#todSeg button').forEach(x => x.classList.toggle('on', x === b)); SC.setTod(+b.dataset.tod); });
  document.querySelectorAll('#denSeg button').forEach(b => b.onclick = () => { document.querySelectorAll('#denSeg button').forEach(x => x.classList.toggle('on', x === b)); SC.setDensity(+b.dataset.den); });
  $('chkRain').onchange = e => SC.setRain(e.target.checked);
  $('chkPeds').onchange = e => SC.setPeds(e.target.checked);
  A.SC = SC; A.setView = setView;

  /* ---------- khởi động ---------- */
  newSim(); renderCaps(); setMode('real');
  setView(['split', 'city'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'circuit');
  requestAnimationFrame(t => { A.lastNow = t; frame(t); });
})();
