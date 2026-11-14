/* circuit.js — netlist của mạch ngã tư (Bài 11), khớp 1-1 với hướng dẫn vẽ LogicWorks (bản mới).
 * Đây là NGUỒN DUY NHẤT: engine.js dựng thiết bị từ đây, render.js vẽ sơ đồ từ đây.
 * net = null  → chân để hở.   net = 'ONE' / 'ZERO' → chân nối mức 1 / 0 cố định.
 */
(function (root) {
  'use strict';
  const pin = (name, num, net, side, extra) => Object.assign({ name, num, net, side: side || 'L' }, extra || {});
  const L = (name, num, net, extra) => pin(name, num, net, 'L', extra);
  const R = (name, num, net, extra) => pin(name, num, net, 'R', extra);
  const bus = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + i);

  const COMPONENTS = [
    /* ---------- nguồn / công tắc ---------- */
    { id: 'CLOCK', kind: 'CLOCK', out: 'CLK', title: 'CLOCK', vn: 'Xung nhịp (NE555 trong mạch thật)' },
    { id: 'SW-RESET', kind: 'BTN', out: 'RST_N', title: 'SW-RESET', vn: 'Công tắc RESET: 0 = đang reset' },
    ...bus('TX', 8).map((n, i) => ({ id: n, kind: 'SW', out: n, bit: i, group: 'TX', title: n, vn: i < 4 ? 'T_X hàng đơn vị, bit ' + i : 'T_X hàng chục, bit ' + (i - 4) })),
    ...bus('TV', 4).map((n, i) => ({ id: n, kind: 'SW', out: n, bit: i, group: 'TV', title: n, vn: 'T_V (0–9), bit ' + i })),

    /* ---------- khối chọn thời gian ---------- */
    { id: 'U4', kind: 'IC157', ic: '74LS157', title: 'U4', vn: 'Bộ chọn 2→1 (hàng đơn vị): SEL = 0 chọn T_X, SEL = 1 chọn T_V; EN = 1 ép ngõ ra về 0000.',
      pins: [L('SEL', 1, 'Q0_N'), L('EN', 15, 'MEN'),
        L('A0', 2, 'TX0'), L('B0', 5, 'TX1'), L('C0', 11, 'TX2'), L('D0', 14, 'TX3'),
        L('A1', 3, 'TV0'), L('B1', 6, 'TV1'), L('C1', 10, 'TV2'), L('D1', 13, 'TV3'),
        R('QA', 4, 'NU0'), R('QB', 7, 'NU1'), R('QC', 9, 'NU2'), R('QD', 12, 'NU3')] },
    { id: 'U5', kind: 'IC157', ic: '74LS157', title: 'U5', vn: 'Bộ chọn 2→1 (hàng chục): nhánh T_V hàng chục luôn bằng 0 (T_V chỉ có một chữ số).',
      pins: [L('SEL', 1, 'Q0_N'), L('EN', 15, 'MEN'),
        L('A0', 2, 'TX4'), L('B0', 5, 'TX5'), L('C0', 11, 'TX6'), L('D0', 14, 'TX7'),
        L('A1', 3, 'ZERO'), L('B1', 6, 'ZERO'), L('C1', 10, 'ZERO'), L('D1', 13, 'ZERO'),
        R('QA', 4, 'NC0'), R('QB', 7, 'NC1'), R('QC', 9, 'NC2'), R('QD', 12, 'NC3')] },

    /* ---------- khối đếm lùi ---------- */
    { id: 'U2', kind: 'IC192', ic: '74LS192', title: 'U2', vn: 'Bộ đếm lùi thập phân hàng đơn vị. Đếm lùi theo cạnh lên CDN; LOAD = 0 nạp số; CLR = 1 xóa; BOR mượn sang hàng chục.',
      pins: [L('CDN', 4, 'CLK'), L('CUP', 5, 'ONE'), L('LOAD', 11, 'HET_N'), L('CLR', 14, 'RST'),
        L('A', 15, 'NU0'), L('B', 1, 'NU1'), L('C', 10, 'NU2'), L('D', 9, 'NU3'),
        R('QA', 3, 'CU0'), R('QB', 2, 'CU1'), R('QC', 6, 'CU2'), R('QD', 7, 'CU3'), R('BOR', 13, 'BOR'), R('CAR', 12, null)] },
    { id: 'U3', kind: 'IC192', ic: '74LS192', title: 'U3', vn: 'Bộ đếm lùi thập phân hàng chục. Chỉ đếm khi nhận mượn BOR từ U2.',
      pins: [L('CDN', 4, 'BOR'), L('CUP', 5, 'ONE'), L('LOAD', 11, 'HET_N'), L('CLR', 14, 'RST'),
        L('A', 15, 'NC0'), L('B', 1, 'NC1'), L('C', 10, 'NC2'), L('D', 9, 'NC3'),
        R('QA', 3, 'CC0'), R('QB', 2, 'CC1'), R('QC', 6, 'CC2'), R('QD', 7, 'CC3'), R('BOR', 13, null), R('CAR', 12, null)] },
    { id: 'G9', kind: 'GATE', gate: 'NOR8', title: 'G9', vn: 'NOR-8: Z = 1 khi cả 8 bit đếm bằng 0, tức số đếm = 00.', ins: [...bus('CU', 4), ...bus('CC', 4)], out: 'Z' },
    { id: 'G10', kind: 'GATE', gate: 'NAND', title: 'G10', vn: 'NAND(Z, CLK): HET_N = 0 khi số đếm = 00 và CLK = 1. Mức 0 → nạp số; cạnh lên → chuyển pha.', ins: ['Z', 'CLK'], out: 'HET_N' },
    { id: 'HEX1', kind: 'HEX', title: 'HEX1', sub: '74LS247 + LED 7 đoạn', ins: bus('CU', 4), vn: 'Hiển thị hàng đơn vị. Mạch thật: 74LS247 giải mã BCD → a–g rồi đưa vào LED 7 đoạn (xem thẻ chi tiết).' },
    { id: 'HEX2', kind: 'HEX', title: 'HEX2', sub: '74LS247 + LED 7 đoạn', ins: bus('CC', 4), vn: 'Hiển thị hàng chục. Mạch thật: 74LS247 giải mã BCD → a–g rồi đưa vào LED 7 đoạn.' },

    /* ---------- khối RESET đồng bộ ---------- */
    { id: 'U9', kind: 'IC04', ic: '74LS04', title: 'U9', vn: 'IC 6 cổng NOT, dùng 4 cổng: đảo RST_N, đảo RSY_N, đảo Q0, đảo Q1.',
      gates: [{ ins: ['RST_N'], out: 'RST', pi: 1, po: 2 }, { ins: ['RSY_N'], out: 'RSY', pi: 3, po: 4 },
              { ins: ['Q0'], out: 'Q0_N', pi: 13, po: 12 }, { ins: ['Q1'], out: 'Q1_N', pi: 11, po: 10 }] },
    { id: 'U12', kind: 'IC74', ic: '74LS74', title: 'U12', vn: 'Đồng bộ hóa RESET: lấy mẫu RST_N theo cạnh lên của HET_N, tạo RSY_N. Nhờ vậy U6 chỉ được reset đúng lúc chuyển pha.',
      pins: [L('CLR/', 1, 'ONE', { half: 1 }), L('D', 2, 'RST_N', { half: 1 }), L('CLK', 3, 'HET_N', { half: 1 }), L('PR/', 4, 'ONE', { half: 1 }),
        L('CLR/', 13, 'ONE', { half: 2 }), L('D', 12, 'ZERO', { half: 2 }), L('CLK', 11, 'ZERO', { half: 2 }), L('PR/', 10, 'ONE', { half: 2 }),
        R('Q', 5, 'RSY_N', { half: 1, row: 1 }), R('Q/', 6, null, { half: 1, row: 2 }), R('Q', 9, null, { half: 2, row: 5 }), R('Q/', 8, null, { half: 2, row: 6 })] },
    { id: 'G4', kind: 'GATE', gate: 'OR', title: 'G4', vn: 'OR(RST, RSY) = MEN: khóa hai bộ chọn U4, U5 (ngõ ra 0000) khi đang reset.', ins: ['RST', 'RSY'], out: 'MEN' },

    /* ---------- khối trạng thái pha ---------- */
    { id: 'U6', kind: 'IC74', ic: '74LS74', title: 'U6', vn: 'Hai flip-flop D giữ trạng thái pha Q1Q0, chốt theo cạnh lên của HET_N: 00 → 01 → 10 → 11 → 00.',
      pins: [L('CLR/', 1, 'ONE', { half: 1 }), L('D', 2, 'D0', { half: 1 }), L('CLK', 3, 'HET_N', { half: 1 }), L('PR/', 4, 'ONE', { half: 1 }),
        L('CLR/', 13, 'ONE', { half: 2 }), L('D', 12, 'D1', { half: 2 }), L('CLK', 11, 'HET_N', { half: 2 }), L('PR/', 10, 'ONE', { half: 2 }),
        R('Q', 5, 'Q0', { half: 1, row: 1 }), R('Q/', 6, null, { half: 1, row: 2 }), R('Q', 9, 'Q1', { half: 2, row: 5 }), R('Q/', 8, null, { half: 2, row: 6 })] },
    { id: 'G1', kind: 'GATE', gate: 'XOR', title: 'G1', vn: 'XOR(Q1, Q0) = X01: D1 của bộ đếm 2 bit (mã Gray-like 00→01→10→11).', ins: ['Q1', 'Q0'], out: 'X01' },
    { id: 'G2', kind: 'GATE', gate: 'OR', title: 'G2', vn: 'D0 = Q0_N + RSY: Q0 đổi trạng thái mỗi pha; RSY ép về 1 khi reset.', ins: ['Q0_N', 'RSY'], out: 'D0' },
    { id: 'G3', kind: 'GATE', gate: 'OR', title: 'G3', vn: 'D1 = (Q1 ⊕ Q0) + RSY.', ins: ['X01', 'RSY'], out: 'D1' },

    /* ---------- khối đèn ---------- */
    { id: 'G5', kind: 'GATE', gate: 'AND', title: 'G5', vn: 'XA = Q1_N · Q0_N: đèn Xanh hướng A (pha P0).', ins: ['Q1_N', 'Q0_N'], out: 'XA' },
    { id: 'G6', kind: 'GATE', gate: 'AND', title: 'G6', vn: 'VA = Q1_N · Q0: đèn Vàng hướng A (pha P1).', ins: ['Q1_N', 'Q0'], out: 'VA' },
    { id: 'G7', kind: 'GATE', gate: 'AND', title: 'G7', vn: 'XB = Q1 · Q0_N: đèn Xanh hướng B (pha P2).', ins: ['Q1', 'Q0_N'], out: 'XB' },
    { id: 'G8', kind: 'GATE', gate: 'AND', title: 'G8', vn: 'VB = Q1 · Q0: đèn Vàng hướng B (pha P3).', ins: ['Q1', 'Q0'], out: 'VB' },
    { id: 'LXA', kind: 'LAMP', color: 'green', ins: ['XA'], title: 'XA', vn: 'Đèn Xanh hướng A' },
    { id: 'LVA', kind: 'LAMP', color: 'yellow', ins: ['VA'], title: 'VA', vn: 'Đèn Vàng hướng A' },
    { id: 'LDA', kind: 'LAMP', color: 'red', ins: ['Q1'], title: 'ĐA', vn: 'Đèn Đỏ hướng A = Q1 (không cần cổng)' },
    { id: 'LXB', kind: 'LAMP', color: 'green', ins: ['XB'], title: 'XB', vn: 'Đèn Xanh hướng B' },
    { id: 'LVB', kind: 'LAMP', color: 'yellow', ins: ['VB'], title: 'VB', vn: 'Đèn Vàng hướng B' },
    { id: 'LDB', kind: 'LAMP', color: 'red', ins: ['Q1_N'], title: 'ĐB', vn: 'Đèn Đỏ hướng B = Q1_N (không cần cổng)' }
  ];

  /* Mô tả các net quan trọng (dùng cho probe, chú thích, thẻ chi tiết) */
  const NET_INFO = {
    CLK: 'Xung nhịp', RST_N: 'RESET (0 = đang reset)', RST: 'RESET tích cực mức cao, xóa bộ đếm ngay', RSY_N: 'RESET đã đồng bộ theo HET_N', RSY: 'Đảo của RSY_N',
    MEN: 'Khóa bộ chọn (1 = ra 0000)', HET_N: 'Hết giờ: 0 = nạp số, cạnh lên = chuyển pha', Z: '1 khi số đếm = 00', BOR: 'Mượn từ hàng đơn vị sang hàng chục',
    Q0: 'Trạng thái pha, bit 0', Q1: 'Trạng thái pha, bit 1', Q0_N: 'Đảo của Q0', Q1_N: 'Đảo của Q1', X01: 'Q1 ⊕ Q0', D0: 'Ngõ vào D của flip-flop Q0', D1: 'Ngõ vào D của flip-flop Q1',
    XA: 'Xanh A', VA: 'Vàng A', XB: 'Xanh B', VB: 'Vàng B'
  };

  const API = { COMPONENTS, NET_INFO, bus };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.CIRCUIT = API;
})(typeof window !== 'undefined' ? window : globalThis);
