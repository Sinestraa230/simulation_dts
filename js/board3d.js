/* board3d.js — mô hình 3D của bo mạch in (dữ liệu từ js/pcb-data.js, sinh bởi tools/pcb.js).
 * Vẽ theo yêu cầu (chỉ render khi có thay đổi) để nhẹ máy. LED và LED 7 đoạn sáng theo engine logic của mạch gốc. */
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

const PCB = window.PCB, CIRCUIT = window.CIRCUIT, LE = window.LogicEngine;
const $ = id => document.getElementById(id);
const BW = PCB.board.w, BH = PCB.board.h, T = PCB.board.t;
const X = x => x - BW / 2, Z = y => y - BH / 2;

/* ---------------- renderer / scene ---------------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(35, 1, 1, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
controls.minDistance = 25; controls.maxDistance = 900;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-120, 260, 160); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 110, bottom: -110, near: 50, far: 700 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbfd2ff, 0.45); fill.position.set(160, 120, -140); scene.add(fill);
const under = new THREE.DirectionalLight(0xffffff, 0.7); under.position.set(40, -260, 60); scene.add(under);

let dirty = true; const redraw = () => (dirty = true);
controls.addEventListener('change', redraw);

/* ---------------- vật liệu ---------------- */
const M = {
  edge: new THREE.MeshStandardMaterial({ color: 0xc2b27a, roughness: 0.8 }),
  ic: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.62, metalness: 0.0 }),
  tin: new THREE.MeshStandardMaterial({ color: 0xd2d3cf, roughness: 0.32, metalness: 0.92 }),
  solder: new THREE.MeshStandardMaterial({ color: 0xd9dad6, roughness: 0.22, metalness: 0.95 }),
  resBody: new THREE.MeshStandardMaterial({ color: 0xd8c39b, roughness: 0.55 }),
  band: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  disc: new THREE.MeshStandardMaterial({ color: 0xc4682d, roughness: 0.45 }),
  black: new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.55 }),
  alu: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.28, metalness: 0.85 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc62025, roughness: 0.45 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.5 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x1f5fb0, roughness: 0.5 }),
  grey: new THREE.MeshStandardMaterial({ color: 0xd2d2cf, roughness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 })
};
const LEDCOL = { red: [0xd21f1f, 0xff2a1e], yellow: [0xe8b417, 0xffd000], green: [0x1fa84a, 0x2bff6a] };

/* ---------------- texture mặt bo ---------------- */
const S = 12;                                     // px / mm
const layers = { comp: true, top: true, bot: true, silk: true };
let hiNet = null, selRef = null;
function canvasTex(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return [c, t]; }
const [topC, topT] = canvasTex(Math.round(BW * S), Math.round(BH * S));
const [botC, botT] = canvasTex(Math.round(BW * S), Math.round(BH * S));
const MASK = '#155a2e', CU_MASK = '#3a9c58', CU_HI = '#ffe066', PAD = '#cfd0cb', SILK = '#f3f2ec';

function drawSide(side) {
  const c = (side === 'top' ? topC : botC).getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = MASK; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  if (side === 'bot') c.setTransform(S, 0, 0, -S, 0, BH * S); else c.setTransform(S, 0, 0, S, 0, 0);
  // vân sợi thủy tinh rất nhẹ
  c.globalAlpha = 0.05; c.strokeStyle = '#000'; c.lineWidth = 0.08;
  for (let x = 0; x < BW; x += 0.9) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, BH); c.stroke(); }
  c.globalAlpha = 1;
  const L = side === 'top' ? 0 : 1, show = side === 'top' ? layers.top : layers.bot;
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (show) for (const t of PCB.traces) if (t.l === L) {
    c.strokeStyle = t.net === hiNet ? CU_HI : CU_MASK; c.lineWidth = t.w + (t.net === hiNet ? 0.15 : 0);
    c.beginPath(); c.moveTo(t.x1, t.y1); c.lineTo(t.x2, t.y2); c.stroke();
  }
  // via (phủ lớp phủ) và pad
  for (const v of PCB.vias) { c.fillStyle = v.net === hiNet ? CU_HI : CU_MASK; c.beginPath(); c.arc(v.x, v.y, v.d / 2, 0, 7); c.fill(); c.fillStyle = '#0b1f12'; c.beginPath(); c.arc(v.x, v.y, v.drill / 2, 0, 7); c.fill(); }
  for (const comp of PCB.comps) for (const p of comp.pins) {
    c.fillStyle = (p.net && p.net === hiNet) ? CU_HI : PAD;
    if (p.sq) c.fillRect(p.x - p.d / 2, p.y - p.d / 2, p.d, p.d); else { c.beginPath(); c.arc(p.x, p.y, p.d / 2, 0, 7); c.fill(); }
    if (!layers.comp || side === 'top') { c.fillStyle = '#121212'; c.beginPath(); c.arc(p.x, p.y, p.drill / 2, 0, 7); c.fill(); }
  }
  for (const h of PCB.holes) { c.fillStyle = PAD; c.beginPath(); c.arc(h.x, h.y, h.d / 2 + 0.9, 0, 7); c.fill(); c.fillStyle = '#0d0d0d'; c.beginPath(); c.arc(h.x, h.y, h.d / 2, 0, 7); c.fill(); }
  if (layers.silk) (side === 'top' ? silkTop : silkBot)(c);
  (side === 'top' ? topT : botT).needsUpdate = true;
}
function text(c, s, x, y, size, align, rot, bold) {
  c.save(); c.translate(x, y); if (rot) c.rotate(rot);
  c.font = `${bold ? 700 : 600} ${size}px "Segoe UI",Arial,sans-serif`; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.fillText(s, 0, 0); c.restore();
}
function bbox(comp) { const xs = comp.pins.map(p => p.x), ys = comp.pins.map(p => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
function silkTop(c) {
  c.strokeStyle = SILK; c.fillStyle = SILK; c.lineWidth = 0.18;
  for (const comp of PCB.comps) {
    const [x0, y0, x1, y1] = bbox(comp), sel = comp.ref === selRef;
    c.strokeStyle = sel ? '#ffd23a' : SILK; c.fillStyle = sel ? '#ffd23a' : SILK; c.lineWidth = sel ? 0.4 : 0.18;
    const R = (a, b, w, h) => c.strokeRect(a, b, w, h);
    switch (comp.fp) {
      case 'DIP8': case 'DIP14': case 'DIP16': {
        R(x0 - 1.6, y0 + 0.9, x1 - x0 + 3.2, y1 - y0 - 1.8);
        c.beginPath(); c.arc(x0 - 1.6, (y0 + y1) / 2, 1, -Math.PI / 2, Math.PI / 2); c.stroke();
        text(c, comp.ref, x0 - 2.3, y1 + 1.9, 1.5, 'left', 0, true); break;
      }
      case 'DIPSW8': case 'DIPSW4': {
        R(x0 - 1.6, y0 - 1.2, x1 - x0 + 3.2, y1 - y0 + 2.4);
        text(c, comp.ref, x0 - 1.6, y0 - 2.4, 1.5, 'left', 0, true); text(c, 'ON ▲', x1 + 0.4, y0 - 2.4, 1.2, 'right', 0, true);
        const n = comp.pins.length / 2; for (let i = 0; i < n; i++) text(c, comp.bits[i], x0 + i * 2.54, y1 + 2.1, 0.95, 'center');
        break;
      }
      case 'AXIAL_V': R(x0 - 1.4, y0 + 1.9, 2.8, y1 - y0 - 3.8); text(c, comp.ref, x0, y0 - 1.6, 1.0, 'center'); break;
      case 'AXIAL_H': R(x0 + 1.9, y0 - 1.4, x1 - x0 - 3.8, 2.8); text(c, comp.ref, (x0 + x1) / 2, y0 - 2.3, 1.2, 'center', 0, true); break;
      case 'CAP_V': R(x0 - 1.5, y0 - 0.9, 3, y1 - y0 + 1.8); text(c, comp.ref, x0 - 1.9, (y0 + y1) / 2, 1.1, 'right'); break;
      case 'CAP': R(x0 - 0.9, y0 - 1.5, x1 - x0 + 1.8, 3); text(c, comp.ref, (x0 + x1) / 2, y0 + 2.6, 1.1, 'center'); break;
      case 'RADIAL': {
        const cx = (x0 + x1) / 2, r = comp.value === '100µ' ? 3.4 : 2.8; c.beginPath(); c.arc(cx, y0, r, 0, 7); c.stroke();
        c.save(); c.beginPath(); c.arc(cx, y0, r, -Math.PI / 2, Math.PI / 2); c.lineTo(cx + 0.5, y0 + r); c.lineTo(cx + 0.5, y0 - r); c.clip(); c.globalAlpha = .5; c.fillRect(cx, y0 - r, r, 2 * r); c.restore();
        text(c, '+', x0 - 1.6, y0 - 1.8, 1.4, 'center', 0, true); text(c, comp.ref, cx, y0 + r + 1.3, 1.2, 'center', 0, true); break;
      }
      case 'LED5': { const cx = (x0 + x1) / 2; c.beginPath(); c.arc(cx, y0, 2.9, 0.35, 2 * Math.PI - 0.35); c.stroke(); c.beginPath(); c.moveTo(cx + 2.9 * Math.cos(0.35), y0 - 2.9 * Math.sin(0.35)); c.lineTo(cx + 2.9 * Math.cos(0.35), y0 + 2.9 * Math.sin(0.35)); c.stroke(); text(c, comp.ref, cx, y0 + 4, 1.2, 'center', 0, true); break; }
      case 'SEG7': R(x0 - 1.2, y0 - 1.9, x1 - x0 + 2.4, y1 - y0 + 3.8); text(c, comp.ref, (x0 + x1) / 2, y1 + 3.0, 1.4, 'center', 0, true); break;
      case 'SIP9': case 'SIP5': R(x0 - 1.2, y0 - 1.25, x1 - x0 + 2.4, 2.5); c.fillRect(x0 - 1.2, y0 - 1.25, 0.6, 2.5); text(c, comp.ref, x1 + 1.8, y0, 1.2, 'left', 0, true); break;
      case 'SIP9_V': R(x0 - 1.25, y0 - 1.2, 2.5, y1 - y0 + 2.4); c.fillRect(x0 - 1.25, y0 - 1.2, 2.5, 0.6); text(c, comp.ref, x0, y0 - 2.2, 1.2, 'center', 0, true); break;
      case 'SLIDE': R(x0 - 1.8, y0 - 1.8, x1 - x0 + 3.6, 3.6); text(c, comp.ref, (x0 + x1) / 2, y0 - 3, 1.3, 'center', 0, true); text(c, 'RESET', x0 - 0.8, y0 + 3.2, 1.05, 'center', 0, true); text(c, 'CHẠY', x1 + 0.8, y0 + 3.2, 1.05, 'center', 0, true); break;
      case 'TERM2': R(x0 - 2.6, y0 - 3.8, x1 - x0 + 5.2, 7.6); text(c, comp.ref, (x0 + x1) / 2, y0 + 5.2, 1.3, 'center', 0, true); text(c, '+5V', x0, y0 - 5, 1.1, 'center', 0, true); text(c, 'GND', x1, y0 - 5, 1.1, 'center', 0, true); break;
    }
  }
  c.strokeStyle = SILK; c.fillStyle = SILK;
  text(c, PCB.board.title, BW / 2 - 52, 5.6, 3.0, 'left', 0, true);
  text(c, 'ĐIỆN TỬ SỐ · ' + PCB.board.rev + ' · 2 lớp · 1,6 mm', BW / 2 - 52, 9.4, 1.7, 'left');
  const A = PCB.comps.find(c => c.ref === 'D1'), B = PCB.comps.find(c => c.ref === 'D4');
  text(c, 'HƯỚNG A', A.pins[0].x + 1.3, A.pins[0].y - 5.6, 1.6, 'center', 0, true); text(c, 'HƯỚNG B', B.pins[0].x + 1.3, B.pins[0].y - 5.6, 1.6, 'center', 0, true);
  const d2 = PCB.comps.find(c => c.ref === 'DS2'), d1 = PCB.comps.find(c => c.ref === 'DS1');
  text(c, 'CHỤC', bbox(d2)[0] + 5, bbox(d2)[1] - 3.4, 1.3, 'center', 0, true); text(c, 'ĐƠN VỊ', bbox(d1)[0] + 5, bbox(d1)[1] - 3.4, 1.3, 'center', 0, true);
  text(c, 'CLOCK ~1 Hz', 26, 18.5, 1.3, 'left', 0, true);
}
function silkBot(c) {
  c.fillStyle = SILK;
  c.save(); c.translate(BW / 2, 7); c.scale(-1, 1);       // đọc đúng chiều khi lật bo
  text(c, 'BÀI 11 · MẶT DƯỚI (BOTTOM)', 0, 0, 2.6, 'center', 0, true); c.restore();
}
function drawBoard() { drawSide('top'); drawSide('bot'); redraw(); }

/* ---------------- bo ---------------- */
const board = new THREE.Group(); scene.add(board);
{
  const core = new THREE.Mesh(new THREE.BoxGeometry(BW, T, BH), M.edge); core.position.y = T / 2; board.add(core);
  const mt = new THREE.MeshStandardMaterial({ map: topT, roughness: 0.42, metalness: 0.05 });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), mt); top.rotation.x = -Math.PI / 2; top.position.y = T + 0.01; top.receiveShadow = true; board.add(top);
  const mb = new THREE.MeshStandardMaterial({ map: botT, roughness: 0.42, metalness: 0.05 });
  const bot = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), mb); bot.rotation.x = Math.PI / 2; bot.position.y = -0.01; board.add(bot);
}

/* ---------------- dựng linh kiện ---------------- */
const compsG = new THREE.Group(); scene.add(compsG);
const pickables = [], byRef = {};
const inst = { box: [], wire: [], joint: [], band: [] };     // gom để dựng InstancedMesh
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function addBox(x, y, z, sx, sy, sz) { inst.box.push(new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion(), V3(sx, sy, sz))); }
function addWire(a, b, r) {     // dây chân linh kiện từ a tới b
  const d = b.clone().sub(a), L = d.length(); if (L < 1e-3) return;
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
  inst.wire.push(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(r, L, r)));
}
function joints(comp) { for (const p of comp.pins) inst.joint.push(new THREE.Matrix4().makeTranslation(X(p.x), -0.02, Z(p.y))); }
const P = (comp, n) => comp.pins.find(p => p.n === n);
function mesh(geo, mat, ref, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; m.userData.ref = ref; pickables.push(m); return m; }

function labelTex(w, h, draw) { const [c, t] = canvasTex(w, h); draw(c.getContext('2d'), w, h); t.needsUpdate = true; return t; }
const MARK = { '74LS192': ['SN74LS192N', 'TI'], '74LS157': ['SN74LS157N', 'TI'], '74LS74': ['SN74LS74AN', 'TI'], '74LS04': ['SN74LS04N', 'TI'], '74LS08': ['SN74LS08N', 'TI'], '74LS32': ['SN74LS32N', 'TI'], '74LS86': ['SN74LS86AN', 'TI'], '74LS00': ['SN74LS00N', 'TI'], '74LS247': ['SN74LS247N', 'TI'], 'CD4078B': ['CD4078BE', 'TI'], 'NE555': ['NE555P', 'TI'] };

function buildDIP(comp, kind) {
  const g = new THREE.Group(), n = comp.pins.length, half = n / 2;
  const xs = comp.pins.map(p => p.x), ys = comp.pins.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...ys) + Math.max(...ys)) / 2;
  const sw = kind === 'sw';
  const len = half * 2.54 + (sw ? 0.9 : 0.5), wid = sw ? 9.9 : 6.35, hgt = sw ? 5.2 : 3.3, y0 = T + (sw ? 0.4 : 0.55);
  const body = mesh(new RoundedBoxGeometry(len, hgt, wid, 2, sw ? 0.3 : 0.45), sw ? M.red : M.ic, comp.ref);
  body.position.set(X(cx), y0 + hgt / 2, Z(cz)); g.add(body);
  // mặt trên: chữ in + khấc + chấm chân 1
  const tw = 512, th = Math.round(512 * wid / len);
  const tex = labelTex(tw, th, (c, w, h) => {
    if (sw) {
      c.fillStyle = '#c62025'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.font = `700 ${h * 0.13}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('ON', w * 0.09, h * 0.13);
      for (let i = 0; i < half; i++) { const x = w * (i + 0.5) / half; c.fillStyle = '#5a0c10'; c.fillRect(x - w / half * 0.3, h * 0.26, w / half * 0.6, h * 0.48); c.fillStyle = '#fff'; c.fillText(String(i + 1), x, h * 0.88); }
      return;
    }
    c.fillStyle = '#1b1b1d'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0a0a0b'; c.beginPath(); c.arc(0, h / 2, h * 0.16, -Math.PI / 2, Math.PI / 2); c.fill();
    c.fillStyle = '#0d0d0e'; c.beginPath(); c.arc(w * 0.055, h * 0.78, h * 0.07, 0, 7); c.fill();
    const [mk, mf] = MARK[comp.part] || [comp.part, ''];
    c.fillStyle = '#b9bcc2'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `600 ${Math.min(h * 0.24, w / mk.length * 1.55)}px Arial`; c.fillText(mk, w / 2, h * 0.38);
    c.font = `500 ${h * 0.16}px Arial`; c.fillStyle = '#9a9ea6'; c.fillText(`${mf}  2341  ${comp.ref}`, w / 2, h * 0.68);
  });
  const lid = mesh(new THREE.PlaneGeometry(len - 0.5, wid - 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: sw ? 0.45 : 0.7 }), comp.ref, false);
  lid.rotation.x = -Math.PI / 2; lid.position.set(X(cx), y0 + hgt + 0.012, Z(cz)); g.add(lid);
  if (sw) {   // cần gạt trắng
    comp.levers = [];
    for (let i = 0; i < half; i++) {
      const p = P(comp, i + 1), lv = mesh(new THREE.BoxGeometry(1.3, 1.4, 2.2), M.white, comp.ref); lv.userData.lever = i;
      lv.position.set(X(p.x), y0 + hgt + 0.5, Z(cz) + 1.4); g.add(lv); comp.levers.push(lv);
    }
  }
  for (const p of comp.pins) {
    const side = p.y < cz ? -1 : 1, x = X(p.x), z = Z(p.y);
    addBox(x, T - 0.35, z, 0.5, 2.3, 0.26);                          // phần cắm xuyên lỗ (thò xuống mặt dưới)
    if (sw) { addBox(x, T + 0.4, z, 0.6, 1.0, 0.26); continue; }
    addBox(x, (T + 0.8 + y0 + 1.25) / 2, z, 1.4, y0 + 1.25 - T - 0.8, 0.26);   // vai chân rộng
    const zin = Z(cz) + side * wid / 2, zc = (zin + z) / 2;
    addBox(x, y0 + 1.25, zc, 0.5, 0.26, Math.abs(z - zin) + 0.13);    // đoạn ngang ra khỏi thân
  }
  joints(comp); return g;
}
function buildAxial(comp) {
  const g = new THREE.Group(), a = P(comp, 1), b = P(comp, 2);
  const A = V3(X(a.x), 0, Z(a.y)), B = V3(X(b.x), 0, Z(b.y)), mid = A.clone().add(B).multiplyScalar(0.5), dir = B.clone().sub(A).normalize();
  const yc = T + 1.6, L = 6.3;
  const prof = [[0, -3.2], [0.75, -3.15], [1.12, -2.85], [1.2, -2.3], [1.0, -1.85], [1.0, 1.85], [1.2, 2.3], [1.12, 2.85], [0.75, 3.15], [0, 3.2]].map(([r, y]) => new THREE.Vector2(r, y * L / 6.4));
  const body = mesh(new THREE.LatheGeometry(prof, 28), M.resBody, comp.ref);
  body.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); body.position.set(mid.x, yc, mid.z); g.add(body);
  const COLORS = [0x111111, 0x7a3b12, 0xd8261d, 0xf07d16, 0xf2d21b, 0x2b9b45, 0x2156c9, 0x7a3fb5, 0x8a8a8a, 0xffffff];
  const v = comp.value; const val = v.endsWith('k') ? parseFloat(v) * 1000 : parseFloat(v);
  const digits = String(Math.round(val)).replace(/0+$/, '').padEnd(2, '0').slice(0, 2), mult = String(Math.round(val)).length - 2;
  const bands = [COLORS[+digits[0]], COLORS[+digits[1]], COLORS[mult], 0xc8a24a];
  const off = [-2.0, -1.25, -0.5, 1.75];
  bands.forEach((col, i) => { const p = mid.clone().addScaledVector(dir, off[i]); const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir); inst.band.push([new THREE.Matrix4().compose(V3(p.x, yc, p.z), q, V3(1.04, i === 3 ? 0.42 : 0.42, 1.04)), col]); });
  const e1 = mid.clone().addScaledVector(dir, -L / 2), e2 = mid.clone().addScaledVector(dir, L / 2);
  for (const [P0, E] of [[A, e1], [B, e2]]) { addWire(V3(P0.x, T - 1.2, P0.z), V3(P0.x, yc, P0.z), 0.3); addWire(V3(P0.x, yc, P0.z), V3(E.x, yc, E.z), 0.3); }
  joints(comp); return g;
}
function buildDisc(comp) {
  const g = new THREE.Group(), a = P(comp, 1), b = P(comp, 2);
  const mid = V3(X((a.x + b.x) / 2), 0, Z((a.y + b.y) / 2)), along = V3(b.x - a.x, 0, b.y - a.y).normalize();
  const r = 2.4, yc = T + 2.2 + r;
  const tex = labelTex(128, 128, (c, w, h) => { c.fillStyle = '#c4682d'; c.fillRect(0, 0, w, h); c.fillStyle = '#2b1608'; c.font = '700 40px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(comp.value, w / 2, h / 2); });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
  const disc = mesh(new THREE.CylinderGeometry(r, r, 1.7, 28), [M.disc, face, face], comp.ref);
  // mặt đĩa vuông góc với hướng nối 2 chân
  disc.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(-along.z, 0, along.x)); disc.position.set(mid.x, yc, mid.z); g.add(disc);
  for (const p of [a, b]) { const x = X(p.x), z = Z(p.y), s = V3(mid.x + (x - mid.x) * 0.6, yc - r * 0.75, mid.z + (z - mid.z) * 0.6); addWire(V3(x, T - 1.2, z), V3(x, T + 1.6, z), 0.25); addWire(V3(x, T + 1.6, z), s, 0.25); }
  joints(comp); return g;
}
function buildElectro(comp) {
  const g = new THREE.Group(), a = P(comp, 1), b = P(comp, 2), big = comp.value === '100µ';
  const r = big ? 3.15 : 2.5, h = big ? 11 : 11, cx = X((a.x + b.x) / 2), cz = Z(a.y), y0 = T + 0.6;
  const side = labelTex(512, 256, (c, w, hh) => {
    c.fillStyle = '#1f2330'; c.fillRect(0, 0, w, hh);
    c.fillStyle = '#9aa3b4'; c.fillRect(w * 0.18, 0, w * 0.14, hh);                       // sọc âm, hướng về chân 2
    c.fillStyle = '#1f2330'; c.font = '700 34px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let k = 0; k < 4; k++) c.fillText('—', w * 0.25, hh * (0.2 + k * 0.2));
    c.fillStyle = '#d7dbe4'; c.font = '600 30px Arial'; c.save(); c.translate(w * 0.75, hh * 0.5); c.rotate(-Math.PI / 2); c.fillText(big ? '100µF 16V' : '10µF 25V', 0, 0); c.restore();
  });
  const top = labelTex(128, 128, (c, w, hh) => { c.fillStyle = '#c8ccd2'; c.fillRect(0, 0, w, hh); c.strokeStyle = '#8e939b'; c.lineWidth = 6; c.beginPath(); c.moveTo(w * 0.2, hh / 2); c.lineTo(w * 0.8, hh / 2); c.moveTo(w / 2, hh * 0.2); c.lineTo(w / 2, hh * 0.8); c.stroke(); });
  const can = mesh(new THREE.CylinderGeometry(r, r, h, 36), [new THREE.MeshStandardMaterial({ map: side, roughness: 0.35 }), new THREE.MeshStandardMaterial({ map: top, roughness: 0.3, metalness: 0.7 }), M.dark], comp.ref);
  can.position.set(cx, y0 + h / 2, cz); g.add(can);
  for (const p of [a, b]) addWire(V3(X(p.x), T - 1.2, Z(p.y)), V3(X(p.x), y0, Z(p.y)), 0.25);
  joints(comp); return g;
}
function buildLED(comp) {
  const g = new THREE.Group(), a = P(comp, 1), b = P(comp, 2), cx = X((a.x + b.x) / 2), cz = Z(a.y), y0 = T + 2.2;
  const [base, lit] = LEDCOL[comp.color];
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.25, transparent: true, opacity: 0.9, emissive: lit, emissiveIntensity: 0 });
  const flange = mesh(new THREE.CylinderGeometry(2.9, 2.9, 1, 32), mat, comp.ref); flange.position.set(cx, y0 + 0.5, cz); g.add(flange);
  const body = mesh(new THREE.CylinderGeometry(2.5, 2.5, 5.6, 32), mat, comp.ref); body.position.set(cx, y0 + 1 + 2.8, cz); g.add(body);
  const dome = mesh(new THREE.SphereGeometry(2.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat, comp.ref); dome.position.set(cx, y0 + 6.6, cz); g.add(dome);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: lit, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(16, 16, 1); glow.position.set(cx, y0 + 6, cz); g.add(glow);
  comp.led = { mat, glow };
  for (const p of [a, b]) addWire(V3(X(p.x), T - 1.2, Z(p.y)), V3(X(p.x), y0, Z(p.y)), 0.25);
  joints(comp); return g;
}
let _glow; function glowTex() { if (_glow) return _glow; _glow = labelTex(128, 128, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }); return _glow; }

// LED 7 đoạn: mặt đen, đoạn xám khi tắt, đỏ khi sáng
const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function segPaths(c, w, h) {
  const sk = 0.12, x0 = w * 0.24, x1 = w * 0.72, y0 = h * 0.12, y1 = h * 0.5, y2 = h * 0.86, t = w * 0.085;
  const k = y => (y2 - y) * sk;
  const H = (xa, xb, y) => [[xa + t * 0.6 + k(y), y], [xa + t + k(y - t / 2), y - t / 2], [xb - t + k(y - t / 2), y - t / 2], [xb - t * 0.6 + k(y), y], [xb - t + k(y + t / 2), y + t / 2], [xa + t + k(y + t / 2), y + t / 2]];
  const Vv = (x, ya, yb) => [[x + k(ya + t * 0.6), ya + t * 0.6], [x + t / 2 + k(ya + t), ya + t], [x + t / 2 + k(yb - t), yb - t], [x + k(yb - t * 0.6), yb - t * 0.6], [x - t / 2 + k(yb - t), yb - t], [x - t / 2 + k(ya + t), ya + t]];
  return { a: H(x0, x1, y0), g: H(x0, x1, y1), d: H(x0, x1, y2), f: Vv(x0, y0, y1), b: Vv(x1, y0, y1), e: Vv(x0, y1, y2), c: Vv(x1, y1, y2), dp: [[x1 + w * 0.12 + 0, y2]] };
}
function drawSeg(comp, on) {
  const draw = (c, w, h, glowOnly) => {
    c.fillStyle = glowOnly ? '#000' : '#151517'; c.fillRect(0, 0, w, h);
    const P2 = segPaths(c, w, h);
    for (const s of 'abcdefg') {
      const lit = on.includes(s); if (glowOnly && !lit) continue;
      c.fillStyle = lit ? '#ff2a18' : '#3a3a3c'; c.beginPath(); P2[s].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
    }
    if (!glowOnly) { c.fillStyle = '#3a3a3c'; c.beginPath(); c.arc(P2.dp[0][0], P2.dp[0][1], w * 0.045, 0, 7); c.fill(); }
  };
  const { fc, gc, ft, gt } = comp.seg;
  draw(fc.getContext('2d'), fc.width, fc.height, false); draw(gc.getContext('2d'), gc.width, gc.height, true);
  ft.needsUpdate = gt.needsUpdate = true;
}
function buildSEG7(comp) {
  const g = new THREE.Group(), xs = comp.pins.map(p => p.x), ys = comp.pins.map(p => p.y);
  const cx = X((Math.min(...xs) + Math.max(...xs)) / 2), cz = Z((Math.min(...ys) + Math.max(...ys)) / 2), w = 12.6, l = 19, h = 8, y0 = T + 0.4;
  const body = mesh(new THREE.BoxGeometry(w, h, l), M.grey, comp.ref); body.position.set(cx, y0 + h / 2, cz); g.add(body);
  const [fc, ft] = canvasTex(256, 384), [gc, gt] = canvasTex(256, 384);
  const face = mesh(new THREE.PlaneGeometry(w - 0.4, l - 0.4), new THREE.MeshStandardMaterial({ map: ft, emissiveMap: gt, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 }), comp.ref, false);
  face.rotation.x = -Math.PI / 2; face.position.set(cx, y0 + h + 0.02, cz); g.add(face);
  comp.seg = { fc, gc, ft, gt, mat: face.material, on: '' }; drawSeg(comp, '');
  for (const p of comp.pins) addWire(V3(X(p.x), T - 1.2, Z(p.y)), V3(X(p.x), y0 + 0.5, Z(p.y)), 0.25);
  joints(comp); return g;
}
function buildSIP(comp) {
  const g = new THREE.Group(), xs = comp.pins.map(p => p.x), ys = comp.pins.map(p => p.y), vert = comp.fp === 'SIP9_V';
  const cx = X((Math.min(...xs) + Math.max(...xs)) / 2), cz = Z((Math.min(...ys) + Math.max(...ys)) / 2), n = comp.pins.length, len = n * 2.54, h = 5, th = 2.4, y0 = T + 0.6;
  const tex = labelTex(512, 128, (c, w, hh) => { c.fillStyle = '#1c1c1e'; c.fillRect(0, 0, w, hh); c.fillStyle = '#e6e6e6'; c.beginPath(); c.arc(w * 0.05, hh * 0.5, hh * 0.1, 0, 7); c.fill(); c.font = `700 ${hh * 0.42}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(comp.value, w * 0.5, hh * 0.5); });
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  const geo = new RoundedBoxGeometry(len, h, th, 2, 0.4);
  const body = mesh(geo, M.black, comp.ref); body.position.set(cx, y0 + h / 2, cz); if (vert) body.rotation.y = Math.PI / 2; g.add(body);
  const lab = mesh(new THREE.PlaneGeometry(len - 0.8, h - 0.8), front, comp.ref, false);
  lab.position.set(cx, y0 + h / 2, cz); if (vert) { lab.rotation.y = -Math.PI / 2; lab.position.x -= th / 2 + 0.02; } else lab.position.z += th / 2 + 0.02; g.add(lab);
  for (const p of comp.pins) addWire(V3(X(p.x), T - 1.2, Z(p.y)), V3(X(p.x), y0 + 0.2, Z(p.y)), 0.25);
  joints(comp); return g;
}
function buildSlide(comp) {
  const g = new THREE.Group(), xs = comp.pins.map(p => p.x), cx = X((Math.min(...xs) + Math.max(...xs)) / 2), cz = Z(comp.pins[0].y), y0 = T + 0.3;
  const body = mesh(new THREE.BoxGeometry(8.6, 3.4, 3.6), M.black, comp.ref); body.position.set(cx, y0 + 1.7, cz); g.add(body);
  const shell = mesh(new THREE.BoxGeometry(8.8, 0.3, 3.8), M.alu, comp.ref); shell.position.set(cx, y0 + 3.55, cz); g.add(shell);
  const knob = mesh(new THREE.BoxGeometry(1.6, 3.2, 1.6), M.black, comp.ref); knob.userData.slide = true; knob.position.set(cx, y0 + 5, cz); g.add(knob);
  comp.knob = knob; comp.knobX = cx;
  for (const p of comp.pins) addWire(V3(X(p.x), T - 1.2, Z(p.y)), V3(X(p.x), y0 + 0.4, Z(p.y)), 0.3);
  joints(comp); return g;
}
function buildTerm(comp) {
  const g = new THREE.Group(), xs = comp.pins.map(p => p.x), cx = X((Math.min(...xs) + Math.max(...xs)) / 2), cz = Z(comp.pins[0].y), y0 = T, w = 10.2, h = 10, d = 7.6;
  const body = mesh(new RoundedBoxGeometry(w, h, d, 2, 0.4), M.blue, comp.ref); body.position.set(cx, y0 + h / 2, cz); g.add(body);
  for (const p of comp.pins) {
    const x = X(p.x);
    const sc = mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.6, 24), M.alu, comp.ref); sc.position.set(x, y0 + h + 0.05, cz + 0.6); g.add(sc);
    const slot = mesh(new THREE.BoxGeometry(2.6, 0.3, 0.45), M.dark, comp.ref, false); slot.position.set(x, y0 + h + 0.38, cz + 0.6); g.add(slot);
    const hole = mesh(new THREE.BoxGeometry(3.2, 3.2, 0.3), M.dark, comp.ref, false); hole.position.set(x, y0 + 4, cz - d / 2 - 0.1); g.add(hole);
    addWire(V3(x, T - 1.4, Z(p.y)), V3(x, y0 + 0.5, Z(p.y)), 0.45);
  }
  joints(comp); return g;
}
for (const comp of PCB.comps) {
  byRef[comp.ref] = comp;
  const b = { DIP8: () => buildDIP(comp), DIP14: () => buildDIP(comp), DIP16: () => buildDIP(comp), DIPSW8: () => buildDIP(comp, 'sw'), DIPSW4: () => buildDIP(comp, 'sw'),
    AXIAL_V: () => buildAxial(comp), AXIAL_H: () => buildAxial(comp), CAP_V: () => buildDisc(comp), CAP: () => buildDisc(comp), RADIAL: () => buildElectro(comp), LED5: () => buildLED(comp),
    SEG7: () => buildSEG7(comp), SIP9: () => buildSIP(comp), SIP5: () => buildSIP(comp), SIP9_V: () => buildSIP(comp), SLIDE: () => buildSlide(comp), TERM2: () => buildTerm(comp) }[comp.fp];
  const g = b(); g.userData.ref = comp.ref; compsG.add(g);
}
{ // InstancedMesh: chân IC, dây chân, mối hàn, vòng màu điện trở
  const mk = (geo, mat, list, cast) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((mx, i) => m.setMatrixAt(i, mx)); m.castShadow = cast; m.receiveShadow = true; return m; };
  compsG.add(mk(new THREE.BoxGeometry(1, 1, 1), M.tin, inst.box, true));
  compsG.add(mk(new THREE.CylinderGeometry(1, 1, 1, 8), M.tin, inst.wire, true));
  const jg = new THREE.ConeGeometry(1.0, 1.3, 14); jg.rotateX(Math.PI); jg.translate(0, -0.65, 0);
  compsG.add(mk(jg, M.solder, inst.joint, false));
  const bm = mk(new THREE.CylinderGeometry(1, 1, 1, 24), M.band, inst.band.map(b => b[0]), false);
  inst.band.forEach((b, i) => bm.setColorAt(i, new THREE.Color(b[1]))); compsG.add(bm);
}

/* ---------------- camera ---------------- */
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); redraw();
}
addEventListener('resize', resize);
const camAnim = { t: 1 };
function setCam(kind) {
  document.querySelectorAll('#camSeg button').forEach(b => b.classList.toggle('on', b.dataset.cam === kind));
  const fitD = Math.max(BW / camera.aspect, BH) * (camera.aspect < 1 ? 1.5 : 1.25) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 2 + 20;
  const P0 = { iso: [-0.34, 0.78, 0.53], top: [0, 1, 0.012], bottom: [0, -1, -0.012], front: [0, 0.32, 1] }[kind];
  const d = kind === 'iso' ? fitD * 0.95 : kind === 'front' ? fitD * 1.05 : fitD;
  const to = V3(...P0).normalize().multiplyScalar(d);
  Object.assign(camAnim, { t: 0, t0: 0, fromP: camera.position.clone(), toP: to, fromT: controls.target.clone(), toT: V3(kind === 'iso' && camera.aspect > 1.2 ? -BW * 0.09 : 0, kind === 'front' ? 6 : 0, kind === 'iso' && camera.aspect > 1.2 ? BH * 0.06 : 0), up: kind === 'bottom' ? V3(0, 1, 0) : V3(0, 1, 0) });
  redraw();
}
document.querySelectorAll('#camSeg button').forEach(b => (b.onclick = () => setCam(b.dataset.cam)));

/* ---------------- lớp hiển thị ---------------- */
$('lyComp').onchange = e => { layers.comp = e.target.checked; compsG.visible = layers.comp; drawBoard(); };
$('lyTop').onchange = e => { layers.top = e.target.checked; drawBoard(); };
$('lyBot').onchange = e => { layers.bot = e.target.checked; drawBoard(); };
$('lySilk').onchange = e => { layers.silk = e.target.checked; drawBoard(); };

/* ---------------- net ---------------- */
const NETS = [...new Set(PCB.traces.map(t => t.net))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const netSel = $('netSel'); NETS.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; netSel.appendChild(o); });
const netInfo = n => (CIRCUIT.NET_INFO[n] || (n === 'VCC' ? 'Nguồn +5 V' : n === 'GND' ? 'Mass 0 V' : /^TX\d/.test(n) ? 'Bit T_X' : /^TV\d/.test(n) ? 'Bit T_V' : /^N[UC]\d/.test(n) ? 'Số nạp từ bộ chọn' : /^C[UC]\d/.test(n) ? 'Bit số đang đếm' : /_A$/.test(n) ? 'Anode LED' : /_K$/.test(n) ? 'Cathode LED ← ngõ ra U13' : /^DS\d_/.test(n) ? 'Đoạn LED 7 đoạn' : /^U1[01]_/.test(n) ? 'Ngõ ra 74LS247 → điện trở' : /555$/.test(n) ? 'Mạch dao động NE555' : ''));
function highlight(n) {
  hiNet = n || null; netSel.value = hiNet || ''; drawBoard();
  if (!hiNet) { $('netInfo').textContent = 'Chọn một net hoặc bấm vào một chân trong thẻ linh kiện để tô sáng đường đồng của nó.'; return; }
  const pins = []; for (const c of PCB.comps) for (const p of c.pins) if (p.net === hiNet) pins.push(c.ref + '.' + p.n);
  const segs = PCB.traces.filter(t => t.net === hiNet), len = segs.reduce((s, t) => s + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0), vias = PCB.vias.filter(v => v.net === hiNet).length;
  $('netInfo').innerHTML = `<b>${hiNet}</b> ${netInfo(hiNet) ? '· ' + netInfo(hiNet) : ''}<br>${pins.length} chân · dây đồng ${len.toFixed(0)} mm · ${vias} via<br><span class="mono">${pins.join(' ')}</span>`;
  document.querySelectorAll('#info tr.pin').forEach(r => r.classList.toggle('on', r.dataset.net === hiNet));
}
netSel.onchange = () => highlight(netSel.value);

/* ---------------- thẻ linh kiện ---------------- */
const PINNAMES = {
  '74LS192': ['B', 'QB', 'QA', 'DOWN (CDN)', 'UP (CUP)', 'QC', 'QD', 'GND', 'D', 'C', 'LOAD', 'CO', 'BO', 'CLR', 'A', 'VCC'],
  '74LS157': ['SEL', '1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3B', '3A', '4Y', '4B', '4A', 'G (EN)', 'VCC'],
  '74LS74': ['1CLR/', '1D', '1CLK', '1PR/', '1Q', '1Q/', 'GND', '2Q/', '2Q', '2PR/', '2CLK', '2D', '2CLR/', 'VCC'],
  '74LS04': ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'],
  quad: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
  'CD4078B': ['K (OR)', 'A', 'B', 'C', 'D', 'NC', 'VSS', 'NC', 'E', 'F', 'G', 'H', 'J (NOR)', 'VDD'],
  '74LS247': ['B', 'C', 'LT', 'BI/RBO', 'RBI', 'D', 'A', 'GND', 'e', 'd', 'c', 'b', 'a', 'g', 'f', 'VCC'],
  'NE555': ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'],
  SEG7: ['e', 'd', 'CA', 'c', 'DP', 'b', 'a', 'CA', 'f', 'g']
};
const pinName = (c, n) => { const k = ['74LS08', '74LS32', '74LS86', '74LS00'].includes(c.part) ? 'quad' : c.fp === 'SEG7' ? 'SEG7' : c.part; const a = PINNAMES[k]; return a ? a[n - 1] : (c.role === 'dipsw' ? (n <= c.pins.length / 2 ? 'vị trí ' + n : 'chung') : c.role === 'rnet' ? (n === 1 ? 'chung' : 'R' + (n - 1)) : c.role === 'led' ? (n === 1 ? 'anode' : 'cathode') : c.role === 'ecap' ? (n === 1 ? '+' : '−') : c.role === 'slide' ? ['GND (RESET)', 'RST_N', 'không nối'][n - 1] : c.role === 'term' ? ['+5V', 'GND'][n - 1] : ''); };
// mức logic của một net trên bo: net của mạch gốc lấy từ engine; cathode LED = ngõ ra cổng đảo U13; net tương tự (NE555, đoạn LED, anode) để trống
const CATHODE = {}; for (const c of PCB.comps) if (c.role === 'led') CATHODE[c.pins.find(p => p.n === 2).net] = c.from;
function lv(n) {
  if (!SIM.on || !n) return '';
  let v;
  if (n === 'VCC') v = 1; else if (n === 'GND') v = 0;
  else if (CATHODE[n]) { const L = SIM.sim.lights(), x = L[CATHODE[n].slice(1)]; v = x === 'X' ? 'X' : 1 - x; }
  else if (n in SIM.sim.net) v = SIM.sim.get(n); else return '<span class="lv" title="tín hiệu tương tự">~</span>';
  return `<span class="lv lv${v}">${v}</span>`;
}
function openInfo(ref) {
  const c = byRef[ref]; selRef = ref; drawBoard(); $('bom').hidden = true;
  const gates = c.gates ? Object.entries(c.gates).map(([g, pp]) => { const cg = CIRCUIT.COMPONENTS.find(k => k.id === g); return `<b>${g}</b> (chân ${pp.join(', ')}): ${cg.ins.join(', ')} → ${cg.out}`; }).join('<br>') : '';
  const known = c.from && CIRCUIT.COMPONENTS.find(k => k.id === c.from);
  $('infoBody').innerHTML = `<h4>${c.ref} · ${c.part}</h4><div class="sub">${c.vn || ''}</div>
    ${known ? `<p>Ứng với <b>${c.from}</b> trên sơ đồ 2D.</p>` : ''}${gates ? `<p>${gates}</p>` : ''}
    <table><tr><th>Chân</th><th>Tên</th><th>Net</th><th></th></tr>${c.pins.map(p => `<tr class="pin${p.net && p.net === hiNet ? ' on' : ''}" data-net="${p.net || ''}"><td>${p.n}</td><td>${pinName(c, p.n)}</td><td class="mono">${p.net || '<i>hở</i>'}</td><td class="lvc" data-n="${p.net || ''}">${lv(p.net)}</td></tr>`).join('')}</table>
    <p class="note">Bấm một dòng để tô sáng đường đồng của net đó.</p>`;
  $('info').hidden = false;
  document.querySelectorAll('#info tr.pin').forEach(r => (r.onclick = () => r.dataset.net && highlight(r.dataset.net === hiNet ? null : r.dataset.net)));
}
$('infoClose').onclick = () => { $('info').hidden = true; selRef = null; drawBoard(); };
setInterval(() => { if (!$('info').hidden) document.querySelectorAll('#info .lvc').forEach(td => (td.innerHTML = lv(td.dataset.n))); }, 250);

/* ---------------- danh sách linh kiện ---------------- */
$('btnBom').onclick = () => {
  const groups = {}; for (const c of PCB.comps) { const k = c.part; (groups[k] = groups[k] || []).push(c.ref); }
  const ord = r => ['U', 'DS', 'D', 'RN', 'R', 'C', 'SW', 'J'].findIndex(p => r.startsWith(p)) * 1000 + parseInt(r.replace(/\D/g, '') || 0);
  const rows = Object.entries(groups).sort((a, b) => Math.min(...a[1].map(ord)) - Math.min(...b[1].map(ord)));
  $('bomBody').innerHTML = `<h4>Danh sách linh kiện</h4><div class="sub" style="color:var(--dim);font-size:12px">${PCB.comps.length} linh kiện · ${PCB.comps.filter(c => c.role === 'ic').length} IC</div>
    <table><tr><th>SL</th><th>Linh kiện</th><th>Ký hiệu</th></tr>${rows.map(([k, r]) => `<tr><td>${r.length}</td><td>${k}</td><td class="mono">${r.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(', ')}</td></tr>`).join('')}</table>`;
  $('bom').hidden = false; $('info').hidden = true;
};
$('bomClose').onclick = () => ($('bom').hidden = true);
$('btnHelp3').onclick = () => ($('helpModal').hidden = false); $('helpClose').onclick = () => ($('helpModal').hidden = true);
$('helpModal').onclick = e => { if (e.target === $('helpModal')) $('helpModal').hidden = true; };

/* ---------------- chọn bằng chuột ---------------- */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null;
function hit(ev) { const r = canvas.getBoundingClientRect(); mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); const h = layers.comp ? ray.intersectObjects(pickables, false) : []; return h[0]; }
canvas.addEventListener('pointerdown', e => (down = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const h = hit(e); if (!h) return;
  const o = h.object, c = byRef[o.userData.ref];
  if (o.userData.lever !== undefined) { toggleSw(c, o.userData.lever); return; }
  if (o.userData.slide) { setReset(!SIM.sim.resetHeld); return; }
  openInfo(c.ref);
});
let hovT = 0; const tip = $('tip3');
canvas.addEventListener('pointermove', e => {
  if (e.buttons) { tip.hidden = true; return; } const now = performance.now(); if (now - hovT < 60) return; hovT = now;
  const h = hit(e); if (!h) { tip.hidden = true; canvas.style.cursor = ''; return; }
  const c = byRef[h.object.userData.ref], lev = h.object.userData.lever !== undefined || h.object.userData.slide;
  tip.innerHTML = `<b>${c.ref}</b> · ${c.part}${lev ? '<br>Bấm để gạt' : ''}`; tip.hidden = false; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  canvas.style.cursor = 'pointer';
});
canvas.addEventListener('pointerleave', () => (tip.hidden = true));

/* ---------------- chạy mô phỏng trên bo ---------------- */
const SIM = { on: false, sim: null, speed: 1, last: 0, key: '' };
function newSim() { const s = new LE.Sim(CIRCUIT); s.setSwitchValue('TX', clampIn($('rTX'), 1, 99)); s.setSwitchValue('TV', clampIn($('rTV'), 1, 9)); SIM.sim = s; syncSwitches(); return s; }
function clampIn(el, a, b) { const v = Math.max(a, Math.min(b, +el.value || a)); el.value = v; return v; }
function syncSwitches() {
  const s = SIM.sim;
  for (const ref of ['SW1', 'SW2', 'SW3']) byRef[ref].levers.forEach((lv, i) => { lv.position.z = lv.position.z; lv.userData.base = lv.userData.base ?? lv.position.z; lv.position.z = lv.userData.base + (s.sw[byRef[ref].bits[i]] ? -2.6 : 0); });
  const k = byRef.SW4; k.knob.position.x = k.knobX + (s.resetHeld ? -1.7 : 1.7);
  const b = $('rReset'); b.querySelector('b').textContent = s.resetHeld ? 'RESET' : 'CHẠY'; b.classList.toggle('rel', !s.resetHeld);
  if (document.activeElement !== $('rTX')) $('rTX').value = s.getSwitchValue('TX'); if (document.activeElement !== $('rTV')) $('rTV').value = s.getSwitchValue('TV');
  redraw();
}
function toggleSw(comp, i) { const b = comp.bits[i]; SIM.sim.setSwitch(b, 1 - SIM.sim.sw[b]); syncSwitches(); }
function setReset(h) { SIM.sim.setReset(h); syncSwitches(); }
$('runToggle').onclick = () => { const c = $('runBox').classList.toggle('mini'); $('runToggle').textContent = c ? '▴' : '▾'; };
$('rReset').onclick = () => setReset(!SIM.sim.resetHeld);
$('rTX').onchange = () => { SIM.sim.setSwitchValue('TX', clampIn($('rTX'), 1, 99)); syncSwitches(); };
$('rTV').onchange = () => { SIM.sim.setSwitchValue('TV', clampIn($('rTV'), 1, 9)); syncSwitches(); };
document.querySelectorAll('#rSpeed button').forEach(b => (b.onclick = () => { SIM.speed = +b.dataset.s; document.querySelectorAll('#rSpeed button').forEach(x => x.classList.toggle('on', x === b)); }));
$('rPower').onclick = () => {
  SIM.on = !SIM.on;
  if (SIM.on) { const sw = { ...SIM.sim.sw }; newSim(); for (const k in sw) SIM.sim.setSwitch(k, sw[k]); SIM.sim.setReset(true); SIM.sim.startClock(); syncSwitches(); }   // bật nguồn: SW4 tự về RESET, như mạch thật cần reset khi cấp điện
  $('rPower').textContent = SIM.on ? '⏻ Tắt nguồn' : '▶ Bật nguồn 5 V'; $('rPower').classList.toggle('primary', !SIM.on);
  updateLights(true);
};
const PH = { '00': 'P0 · A:X · B:Đ', '01': 'P1 · A:V · B:Đ', '10': 'P2 · A:Đ · B:X', '11': 'P3 · A:Đ · B:V' };
function updateLights(force) {
  const s = SIM.sim, on = SIM.on, L = s.lights();
  const val = { LXA: L.XA, LVA: L.VA, LDA: L.DA, LXB: L.XB, LVB: L.VB, LDB: L.DB };
  const u = s.nibble('CU'), t = s.nibble('CC');
  const key = on ? JSON.stringify(val) + u + t : 'off'; if (!force && key === SIM.key) return; SIM.key = key;
  for (const c of PCB.comps) if (c.led) { const v = on && val[c.from] === 1; c.led.mat.emissiveIntensity = v ? 0.75 : 0; c.led.mat.opacity = v ? 0.98 : 0.9; c.led.glow.material.opacity = v ? 0.6 : 0; }
  for (const [ref, nib] of [['DS1', u], ['DS2', t]]) { const c = byRef[ref], segs = on && nib !== 'X' && nib <= 9 ? SEGS[nib] : ''; if (segs !== c.seg.on) { c.seg.on = segs; drawSeg(c, segs); } c.seg.mat.emissiveIntensity = segs ? 1.6 : 0; }
  const st = s.state();
  $('rPhase').textContent = !on ? 'Tắt nguồn' : st.includes('X') ? (s.resetHeld ? 'Đang thoát X…' : 'Còn X: gạt SW4 về RESET')  : (s.get('RST_N') === 0 || s.get('RSY') === 1) ? (s.resetHeld ? 'RESET · A:Đ · B:V · gạt SW4 sang CHẠY' : 'RESET · A:Đ · B:V') : PH[st];
  redraw();
}

/* ---------------- vòng lặp ---------------- */
function frame(now) {
  const dt = Math.min(now - (SIM.last || now), 100); SIM.last = now;
  if (SIM.on) { SIM.sim.advanceTo(SIM.sim.t + dt * 0.2 * SIM.speed); updateLights(); }
  if (camAnim.t < 1) {
    camAnim.t = Math.min(1, (now - (camAnim.t0 ||= now)) / 650); const k = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.fromP, camAnim.toP, k); controls.target.lerpVectors(camAnim.fromT, camAnim.toT, k); dirty = true;
  }
  if (controls.update()) dirty = true;
  if (dirty) { dirty = false; renderer.render(scene, camera); }
  requestAnimationFrame(frame);
}
newSim(); drawBoard(); resize();
camera.position.set(-90, 200, 140); controls.target.set(0, 0, 0); setCam('iso'); camAnim.t = 0.999;
camera.position.copy(camAnim.toP); controls.target.copy(camAnim.toT); controls.update();
updateLights(true);
$('loading').remove();
requestAnimationFrame(frame);
window.B3D = { scene, camera, controls, SIM, byRef, setCam, highlight, openInfo, render: () => renderer.render(scene, camera), redraw };
