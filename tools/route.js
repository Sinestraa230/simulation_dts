/* route.js — đi dây trực giao tự động (A* trên lưới 10px, nhiều nguồn, phạt bẻ góc / chồng dây / cắt dây).
 * Chạy:  node tools/route.js   → ghi js/routes.js (đã sinh sẵn, runtime không cần chạy lại). */
const fs = require('fs'), path = require('path');
const CIRCUIT = require('../js/circuit.js');
const LAYOUT = require('../js/layout.js');
const G = 10;
const lay = LAYOUT.build(CIRCUIT);
const NX = Math.floor(lay.W / G) + 1, NY = Math.floor(lay.H / G) + 1;
const idx = (cx, cy) => cy * NX + cx;
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];   // 0=phải 1=xuống 2=trái 3=lên

/* ---- chướng ngại ---- */
const blocked = new Uint8Array(NX * NY);
const stubOwner = new Map();   // cell → tên net sở hữu (hoặc '#')
for (const id of lay.order) {
  const c = lay.comps[id];
  for (let cx = Math.ceil(c.x / G); cx <= Math.floor((c.x + c.w) / G); cx++)
    for (let cy = Math.ceil(c.y / G); cy <= Math.floor((c.y + c.h) / G); cy++) blocked[idx(cx, cy)] = 1;
  for (const p of c.pinsOut) {
    const x0 = Math.min(p.ex, p.tx), x1 = Math.max(p.ex, p.tx), cy = p.ty / G;
    for (let cx = x0 / G; cx <= x1 / G; cx++) { blocked[idx(cx, cy)] = 0; stubOwner.set(idx(cx, cy), p.net && p.net !== 'ONE' && p.net !== 'ZERO' ? p.net : '#'); }
  }
}
// ô nằm sát mép trên/dưới/trái/phải của hộp: không chặn (dây được đi sát) nhưng stub của chân khác thì chặn qua stubOwner
const hUse = new Int16Array(NX * NY), vUse = new Int16Array(NX * NY);

class Heap { constructor() { this.a = []; } push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] > a[i][0]) { [a[p], a[i]] = [a[i], a[p]]; i = p; } else break; } }
  pop() { const a = this.a, t = a[0], l = a.pop(); if (a.length) { a[0] = l; let i = 0; for (;;) { let c = 2 * i + 1, r = c + 1, m = i; if (c < a.length && a[c][0] < a[m][0]) m = c; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return t; }
  get size() { return this.a.length; } }

function routeNet(net, netId, params) {
  const drv = net.driver, tree = new Map();  // cell → {prev cell (hướng về nguồn)}
  const startCell = idx(drv.tx / G, drv.ty / G);
  tree.set(startCell, -1);
  const legs = [], paths = {};
  // đi từ cổng ra: ô đầu tiên bắt buộc đi sang phải
  const loads = net.loads.slice().sort((a, b) => (Math.abs(a.tx - drv.tx) + Math.abs(a.ty - drv.ty)) - (Math.abs(b.tx - drv.tx) + Math.abs(b.ty - drv.ty)));
  for (const L of loads) {
    const goal = idx(L.tx / G, L.ty / G), gx = L.tx / G, gy = L.ty / G;
    const S = NX * NY * 4, dist = new Float32Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1);
    const H = new Heap();
    for (const [cell] of tree) {
      for (let d = 0; d < 4; d++) {
        if (cell === startCell && d !== 0) continue;
        const s = cell * 4 + d; dist[s] = 0; H.push(Math.abs(cell % NX - gx) + Math.abs(Math.floor(cell / NX) - gy), s);
      }
    }
    let end = -1;
    while (H.size) {
      const [, s] = H.pop(); const cell = s >> 2, d = s & 3, cx = cell % NX, cy = (cell / NX) | 0;
      if (cell === goal && d === 0) { end = s; break; }
      const base = dist[s];
      for (let nd = 0; nd < 4; nd++) {
        if (((nd + 2) & 3) === d) continue;     // không quay đầu
        const nx = cx + DX[nd], ny = cy + DY[nd]; if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        const nc = idx(nx, ny);
        if (blocked[nc]) continue;
        const so = stubOwner.get(nc); if (so !== undefined && so !== net.name) continue;
        if (nc === goal && nd !== 0) continue;
        let cost = 1 + (nd !== d ? params.bend : 0);
        const horiz = nd === 0 || nd === 2;
        const same = tree.has(nc);
        if (same) cost = 0.2 + (nd !== d ? 1 : 0);
        else {
          if (horiz) { if (hUse[nc] && hUse[nc] !== netId) cost += params.overlap; if (vUse[nc] && vUse[nc] !== netId) cost += params.cross; }
          else { if (vUse[nc] && vUse[nc] !== netId) cost += params.overlap; if (hUse[nc] && hUse[nc] !== netId) cost += params.cross; }
          // phạt đi song song sát dây khác (khó nhìn)
          const sx = horiz ? 0 : 1, sy = horiz ? 1 : 0;
          for (const sg of [-1, 1]) { const ax = nx + sx * sg, ay = ny + sy * sg; if (ax >= 0 && ay >= 0 && ax < NX && ay < NY) { const ac = idx(ax, ay), u = horiz ? hUse[ac] : vUse[ac]; if (u && u !== netId) cost += params.near; } }
        }
        const ns = nc * 4 + nd, nd2 = base + cost;
        if (nd2 < dist[ns]) { dist[ns] = nd2; prev[ns] = s; H.push(nd2 + Math.abs(nx - gx) + Math.abs(ny - gy), ns); }
      }
    }
    if (end < 0) throw new Error(`không đi được dây ${net.name} → ${L.key}`);
    // truy vết
    const cells = []; let s = end;
    for (;;) { const cell = s >> 2; cells.push(cell); if (prev[s] < 0) break; s = prev[s]; }
    cells.reverse();
    // cells[0] thuộc cây; thêm phần mới vào cây
    for (let i = 1; i < cells.length; i++) { if (!tree.has(cells[i])) tree.set(cells[i], cells[i - 1]); }
    legs.push(cells);
    // đường đầy đủ nguồn → tải qua con trỏ prev của cây
    const full = []; let c = goal; while (c !== -1) { full.push(c); c = tree.get(c); } full.reverse();
    paths[L.key] = full;
  }
  return { tree, legs, paths };
}

function simplify(cells) {   // danh sách ô → đa tuyến chỉ giữ điểm gấp
  const pts = cells.map(c => [(c % NX) * G, ((c / NX) | 0) * G]); const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) { const a = pts[i - 1], b = pts[i], d = pts[i + 1]; if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) !== 0) out.push(b); }
  out.push(pts[pts.length - 1]); return out;
}

function runAll(params) {
  hUse.fill(0); vUse.fill(0);
  const names = Object.keys(lay.nets);
  const span = n => { const net = lay.nets[n]; const xs = [net.driver.tx, ...net.loads.map(l => l.tx)], ys = [net.driver.ty, ...net.loads.map(l => l.ty)]; return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys); };
  names.sort((a, b) => span(a) - span(b));
  const result = {};
  const mark = (name, r, id) => { for (const [cell, prv] of r.tree) { if (prv < 0) continue; const horiz = (prv % NX) !== (cell % NX) ? 1 : 0; if (horiz) { hUse[cell] = id; hUse[prv] = id; } else { vUse[cell] = id; vUse[prv] = id; } } };
  const unmark = (r, id) => { for (const [cell, prv] of r.tree) { if (prv < 0) continue; if (hUse[cell] === id) hUse[cell] = 0; if (vUse[cell] === id) vUse[cell] = 0; if (hUse[prv] === id) hUse[prv] = 0; if (vUse[prv] === id) vUse[prv] = 0; } };
  names.forEach((n, i) => { result[n] = routeNet(lay.nets[n], i + 1, params); mark(n, result[n], i + 1); });
  for (let pass = 0; pass < 3; pass++) names.forEach((n, i) => { unmark(result[n], i + 1); result[n] = routeNet(lay.nets[n], i + 1, params); mark(n, result[n], i + 1); });
  return result;
}

const params = { bend: 4, overlap: 60, cross: 6, near: 3 };
const result = runAll(params);
const out = {}; let totalLen = 0;
for (const [n, r] of Object.entries(result)) {
  const branches = r.legs.map(simplify);
  const paths = {}; for (const [k, cells] of Object.entries(r.paths)) paths[k] = simplify(cells);
  // điểm rẽ nhánh (chấm nối): ô của cây có ≥3 hướng
  const deg = new Map(); for (const [cell, prv] of r.tree) { if (prv < 0) continue; deg.set(cell, (deg.get(cell) || 0) + 1); deg.set(prv, (deg.get(prv) || 0) + 1); }
  const junctions = [...deg].filter(([, d]) => d >= 3).map(([c]) => [(c % NX) * G, ((c / NX) | 0) * G]);
  out[n] = { branches, paths, junctions }; totalLen += r.tree.size - 1;
}
fs.writeFileSync(path.join(__dirname, '../js/routes.js'), '/* SINH TỰ ĐỘNG bởi tools/route.js — không sửa tay */\nwindow.ROUTES = ' + JSON.stringify(out) + ';\n');
console.log('nets:', Object.keys(out).length, ' tổng chiều dài ô:', totalLen);
