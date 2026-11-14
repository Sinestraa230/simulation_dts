/* engine.js — bộ mô phỏng logic hướng sự kiện, 3 trị (0 / 1 / X), port từ bộ mô phỏng Python đã kiểm chứng.
 * Mô hình độ trễ lan truyền, X lan truyền "bi quan" như LogicWorks (xung đột LOAD/CLR của 74LS192 → X, đua cạnh 74LS74 → X).
 * Đơn vị thời gian: 1 chu kỳ CLK = 200 đơn vị (≈ 1 đơn vị = 5 ns nếu CLK = 1 MHz; trong demo chỉ để tỉ lệ).
 */
(function (root) {
  'use strict';
  const X = 'X';
  const NOT = a => (a === X ? X : 1 - a);
  const AND = (a, b) => (a === 0 || b === 0 ? 0 : (a === X || b === X ? X : 1));
  const OR = (a, b) => (a === 1 || b === 1 ? 1 : (a === X || b === X ? X : 0));
  const XOR = (a, b) => (a === X || b === X ? X : a ^ b);
  const NAND = (a, b) => NOT(AND(a, b));
  const NOR8 = (...a) => (a.includes(1) ? 0 : (a.includes(X) ? X : 1));
  const GATE_FN = { NOT, AND, OR, XOR, NAND, NOR8 };

  /* độ trễ mặc định (đơn vị mô phỏng) — tỉ lệ gần với 74LS: cổng ≈ 10 ns, flip-flop ≈ 20 ns, bộ đếm ≈ 30 ns */
  const DELAYS = { NOT: 2, AND: 3, OR: 3, NAND: 3, XOR: 4, NOR8: 4, DFF: 5, M157: 5, C192: 7 };

  /* ---- hàng đợi ưu tiên (t, seq) ---- */
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    peek() { return this.a[0]; }
    less(i, j) { const x = this.a[i], y = this.a[j]; return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
    push(it) {
      const a = this.a; a.push(it); let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (this.less(i, p)) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          let l = 2 * i + 1, r = l + 1, m = i;
          if (l < a.length && this.less(l, m)) m = l;
          if (r < a.length && this.less(r, m)) m = r;
          if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
  }

  class Sim {
    /* opts: { delay(kind) → số, period, pessimistic } */
    constructor(circuit, opts) {
      opts = opts || {};
      this.circuit = circuit;
      this.delay = opts.delay || (k => DELAYS[k]);
      this.period = opts.period || 200;
      this.pessimistic = opts.pessimistic !== false;
      this.t = 0; this.seq = 0; this.q = new Heap();
      this.net = Object.create(null); this.fan = Object.create(null);
      this.devs = []; this.listeners = []; this.conflicts = 0;
      this.edgeIdx = 0;               // chỉ số cạnh CLK kế tiếp: thời điểm = edgeIdx * period/2
      this.clockOn = false;
      this.sw = Object.create(null);  // trạng thái công tắc
      this.build();
    }
    /* ---- lưới dây ---- */
    get(n) { const v = this.net[n]; return v === undefined ? X : v; }
    setnet(n, v) {
      const old = this.get(n);
      if (old === v && n in this.net) return;
      this.net[n] = v;
      if (this.quiet) return;
      for (const l of this.listeners) l(this.t, n, old, v);
      const f = this.fan[n]; if (f) for (const d of f) d.on_change(n, old, v);
    }
    sched(delay, n, v) { this.q.push([this.t + delay, this.seq++, n, v]); }
    add(dev, ins) { this.devs.push(dev); for (const n of ins) (this.fan[n] = this.fan[n] || []).push(dev); }
    onChange(fn) { this.listeners.push(fn); }

    /* ---- dựng thiết bị từ netlist ---- */
    build() {
      const S = this;
      const nm = (c, p) => (p.net === null ? `${c.id}.${p.name}.${p.num}` : p.net); // chân hở: tên ẩn
      class Gate {
        constructor(kind, ins, out) { this.f = GATE_FN[kind]; this.ins = ins; this.out = out; this.dl = S.delay(kind); S.add(this, ins); }
        eval() { S.sched(this.dl, this.out, this.f(...this.ins.map(i => S.get(i)))); }
        on_change() { this.eval(); } init() { this.eval(); }
      }
      class DFF {
        constructor(D, CLK, PR, CLR, Q) { this.D = D; this.CLK = CLK; this.PR = PR; this.CLR = CLR; this.Q = Q; this.dl = S.delay('DFF'); this.state = X; S.add(this, [CLK, PR, CLR]); }
        on_change(n, old, nw) {
          const pr = S.get(this.PR), clr = S.get(this.CLR);
          if (pr === 0 || clr === 0 || pr === X || clr === X) {
            if (pr === 0 && clr === 1) this.state = 1;
            else if (clr === 0 && pr === 1) this.state = 0;
            else this.state = X;
          } else if (n === this.CLK) {
            const dv = S.get(this.D);
            if (old === 0 && nw === 1) this.state = dv;
            else if ((old === X && nw === 1) || (old === 0 && nw === X)) { if (dv !== this.state) this.state = X; }
          }
          S.sched(this.dl, this.Q, this.state);
        }
        init() {}
      }
      class C192 {
        constructor(CDN, CUP, LOAD, CLR, Din, Qout, BOR) {
          Object.assign(this, { CDN, CUP, LOAD, CLR, Din, Qout, BOR }); this.dl = S.delay('C192'); this.val = X;
          S.add(this, [CDN, CUP, LOAD, CLR, ...Din]);
        }
        data() { const b = this.Din.map(n => S.get(n)); return b.includes(X) ? X : b.reduce((s, v, i) => s + (v << i), 0); }
        on_change(n, old, nw) {
          const clr = S.get(this.CLR), ld = S.get(this.LOAD);
          if (clr === 1) {
            this.val = 0;
            if (S.pessimistic && ld !== 1 && this.data() !== 0) { this.val = X; S.conflicts++; }
          } else if (clr === X) this.val = X;
          else if (ld === 0) this.val = this.data();
          else if (ld === X) { if (this.val !== this.data()) this.val = X; }
          else if (n === this.CDN && S.get(this.CUP) === 1) {
            if (old === 0 && nw === 1) this.val = this.val === X ? X : (this.val + 9) % 10;
            else if (old === X || nw === X) this.val = X;
          }
          this.out();
        }
        out() {
          const v = this.val;
          this.Qout.forEach((qn, i) => S.sched(this.dl, qn, v === X ? X : (v >> i) & 1));
          const cdn = S.get(this.CDN); let b;
          if (v === X || cdn === X) { b = (v !== X && v !== 0) ? 1 : X; if (cdn === 1) b = 1; }
          else b = (cdn === 0 && v === 0) ? 0 : 1;
          S.sched(this.dl, this.BOR, b);
        }
        init() { this.out(); }
      }
      class M157 {
        constructor(SEL, EN, in0, in1, outs) { Object.assign(this, { SEL, EN, in0, in1, outs }); this.dl = S.delay('M157'); S.add(this, [SEL, EN, ...in0, ...in1]); }
        on_change() { this.init(); }
        init() {
          const sel = S.get(this.SEL), en = S.get(this.EN);
          this.outs.forEach((o, i) => {
            const va = S.get(this.in0[i]), vb = S.get(this.in1[i]); let v;
            if (en === 1) v = 0; else if (en === X) v = X;
            else if (sel === 0) v = va; else if (sel === 1) v = vb; else v = va === vb ? va : X;
            S.sched(this.dl, o, v);
          });
        }
      }

      const byId = {}; for (const c of this.circuit.COMPONENTS) byId[c.id] = c;
      for (const c of this.circuit.COMPONENTS) {
        const P = c.pins;
        const get = (side, name, num) => P.find(p => p.side === side && p.name === name && (num === undefined || p.num === num));
        switch (c.kind) {
          case 'GATE': new Gate(c.gate, c.ins, c.out); break;
          case 'IC04': c.gates.forEach(g => new Gate('NOT', g.ins, g.out)); break;
          case 'IC74': {
            const w = (h) => { const pk = (nme) => P.find(p => p.half === h && p.name === nme && p.side === 'L');
              const q = P.find(p => p.half === h && p.name === 'Q' && p.side === 'R');
              new DFF(nm(c, pk('D')), nm(c, pk('CLK')), nm(c, pk('PR/')), nm(c, pk('CLR/')), nm(c, q)); };
            w(1); w(2); break;
          }
          case 'IC192': {
            const L = n => nm(c, P.find(p => p.side === 'L' && p.name === n));
            const Rn = n => nm(c, P.find(p => p.side === 'R' && p.name === n));
            new C192(L('CDN'), L('CUP'), L('LOAD'), L('CLR'), ['A', 'B', 'C', 'D'].map(L), ['QA', 'QB', 'QC', 'QD'].map(Rn), Rn('BOR'));
            break;
          }
          case 'IC157': {
            const L = n => nm(c, P.find(p => p.side === 'L' && p.name === n));
            const Rn = n => nm(c, P.find(p => p.side === 'R' && p.name === n));
            new M157(L('SEL'), L('EN'), ['A0', 'B0', 'C0', 'D0'].map(L), ['A1', 'B1', 'C1', 'D1'].map(L), ['QA', 'QB', 'QC', 'QD'].map(Rn));
            break;
          }
        }
      }
      // hằng + nguồn
      this.quiet = true;
      this.net.ONE = 1; this.net.ZERO = 0; this.net.CLK = 0; this.net.RST_N = 0;
      for (const c of this.circuit.COMPONENTS) if (c.kind === 'SW') { this.sw[c.id] = 0; this.net[c.id] = 0; }
      this.setSwitchValue('TX', 5); this.setSwitchValue('TV', 2);
      this.quiet = false;
      this.resetHeld = true;
      for (const d of this.devs) d.init();
    }

    /* ---- công tắc ---- */
    setSwitch(name, v) { this.sw[name] = v; this.setnet(name, v); }
    /* group 'TX' (2 chữ số BCD) hoặc 'TV' (1 chữ số) */
    setSwitchValue(group, value) {
      if (group === 'TX') { const tens = Math.floor(value / 10), units = value % 10;
        for (let i = 0; i < 4; i++) { this.setSwitch('TX' + i, (units >> i) & 1); this.setSwitch('TX' + (i + 4), (tens >> i) & 1); } }
      else for (let i = 0; i < 4; i++) this.setSwitch('TV' + i, (value >> i) & 1);
    }
    getSwitchValue(group) {
      if (group === 'TX') { let u = 0, t = 0; for (let i = 0; i < 4; i++) { u += this.sw['TX' + i] << i; t += this.sw['TX' + (i + 4)] << i; } return t * 10 + u; }
      let v = 0; for (let i = 0; i < 4; i++) v += this.sw['TV' + i] << i; return v;
    }
    setReset(held) { this.resetHeld = held; this.setnet('RST_N', held ? 0 : 1); }

    /* ---- đồng hồ & chạy ---- */
    get half() { return this.period / 2; }
    nextClockTime() { return this.clockOn ? this.edgeIdx * this.half : Infinity; }
    nextEventTime() { const h = this.q.peek(); return Math.min(h ? h[0] : Infinity, this.nextClockTime()); }
    startClock() { if (!this.clockOn) { this.clockOn = true; this.edgeIdx = Math.floor(this.t / this.half) + 1; } }
    stopClock() { this.clockOn = false; }
    /* xử lý mọi sự kiện có thời điểm ≤ T */
    advanceTo(T, probe) {
      for (;;) {
        const h = this.q.peek(), tq = h ? h[0] : Infinity, tc = this.nextClockTime();
        if (Math.min(tq, tc) > T) break;
        if (tq <= tc) { const [t, , n, v] = this.q.pop(); this.t = t; this.setnet(n, v); }
        else { this.t = tc; this.setnet('CLK', this.edgeIdx % 2 === 0 ? 1 : 0); this.edgeIdx++; }
        if (probe) probe(this);
      }
      if (T > this.t) this.t = T;
    }
    /* xử lý nhóm sự kiện kế tiếp (cùng thời điểm) — dùng cho chế độ "từng sự kiện" */
    stepOne() {
      const nt = this.nextEventTime(); if (nt === Infinity) return null;
      this.advanceTo(nt); return nt;
    }

    /* ---- đọc nhanh ---- */
    bits(prefix, n) { const b = []; for (let i = 0; i < n; i++) b.push(this.get(prefix + i)); return b; }
    nibble(prefix) { const b = this.bits(prefix, 4); return b.includes(X) ? X : b.reduce((s, v, i) => s + (v << i), 0); }
    hex() { const u = this.nibble('CU'), c = this.nibble('CC'); return (u === X || c === X) ? 'X' : `${c}${u}`; }
    state() { return `${this.get('Q1')}${this.get('Q0')}`; }
    lights() {
      return { XA: this.get('XA'), VA: this.get('VA'), DA: this.get('Q1'), XB: this.get('XB'), VB: this.get('VB'), DB: this.get('Q1_N') };
    }
  }

  const API = { Sim, X, DELAYS, GATE_FN };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.LogicEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
