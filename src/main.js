/* 坦克大战 — Canvas 2D
 * 场地 1200x800，灰白底 + 黑色粗线段墙壁（横竖垂直）。
 * 玩家：W/S 前进后退，A/D 转向，炮塔面向鼠标，左键开火。
 * 子弹碰墙反弹，每颗子弹最多存在 1.5 分钟。敌人为人机 AI。
 * 敌人会以 90% 概率规避来袭子弹：优先旋转脱离弹道，来不及转向则前进/倒车。
 */

const ARENA_W = 1200;
const ARENA_H = 800;
const WALL_T = 12;          // 墙壁厚度（黑线粗细）
const TANK_R = 20;          // 坦克碰撞半径
const BULLET_R = 4;
const BULLET_SPEED = 470;
const BULLET_LIFE = 90;     // 秒（1.5 分钟）
const HIT_INVULN = 0.8;      // 受击无敌时间（秒）：防止密集命中瞬间连掉血
const PLAYER_FIRE_CD = 0.6; // 玩家最大攻速（秒/发）
const PLAYER_HP = 3;
const ENEMY_HP = 3;
const ENEMY_COUNT = 4;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ui = {
  hpfill: document.getElementById("hpfill"),
  hptext: document.getElementById("hptext"),
  eftext: document.getElementById("eftext"),
  killtext: document.getElementById("killtext"),
  overlay: document.getElementById("overlay"),
  ovtitle: document.getElementById("ovtitle"),
  ovdesc: document.getElementById("ovdesc"),
  restart: document.getElementById("restart"),
  startoverlay: document.getElementById("startoverlay"),
  startbtn: document.getElementById("startbtn"),
};

/* ---------------- 墙壁布局（横竖垂直的线段） ---------------- */
// {x1,y1,x2,y2}，保证 x1==x2 或 y1==y2
const WALL_SEGS = [
  // 纵向墙
  { x1: 200, y1: 80,  x2: 200, y2: 280 },
  { x1: 200, y1: 420, x2: 200, y2: 620 },
  { x1: 420, y1: 120, x2: 420, y2: 420 },
  { x1: 420, y1: 520, x2: 420, y2: 760 },
  { x1: 640, y1: 60,  x2: 640, y2: 300 },
  { x1: 640, y1: 400, x2: 640, y2: 640 },
  { x1: 860, y1: 140, x2: 860, y2: 440 },
  { x1: 860, y1: 540, x2: 860, y2: 740 },
  { x1: 1060, y1: 100, x2: 1060, y2: 360 },
  { x1: 1060, y1: 460, x2: 1060, y2: 700 },
  // 横向墙
  { x1: 280, y1: 180, x2: 540, y2: 180 },
  { x1: 280, y1: 620, x2: 540, y2: 620 },
  { x1: 700, y1: 300, x2: 960, y2: 300 },
  { x1: 700, y1: 520, x2: 960, y2: 520 },
  { x1: 920, y1: 240, x2: 1140, y2: 240 },
  { x1: 80,  y1: 560, x2: 320, y2: 560 },
];

// 线段 -> AABB 矩形（含厚度），碰撞检测用
const WALL_RECTS = WALL_SEGS.map(s => ({
  x1: Math.min(s.x1, s.x2) - WALL_T / 2,
  y1: Math.min(s.y1, s.y2) - WALL_T / 2,
  x2: Math.max(s.x1, s.x2) + WALL_T / 2,
  y2: Math.max(s.y1, s.y2) + WALL_T / 2,
}));

const SPAWN_PLAYER = { x: 90, y: 90 };
const SPAWNS_ENEMY = [
  { x: 1110, y: 710 },
  { x: 1110, y: 90 },
  { x: 90, y: 710 },
  { x: 600, y: 730 },
];

const HUMAN_SPAWNS = [
  { x: 90, y: 90 },
  { x: 1110, y: 90 },
  { x: 90, y: 710 },
  { x: 1110, y: 710 },
];

/* ---------------- 工具函数 ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

function circleRect(cx, cy, r, rc) {
  const nx = clamp(cx, rc.x1, rc.x2);
  const ny = clamp(cy, rc.y1, rc.y2);
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  const dist = Math.sqrt(d2);
  if (dist > 1e-6) return { nx: dx / dist, ny: dy / dist, pen: r - dist };
  // 圆心在矩形内：沿最小穿透轴推出
  const pl = cx - rc.x1, pr = rc.x2 - cx, pt = cy - rc.y1, pb = rc.y2 - cy;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) return { nx: -1, ny: 0, pen: r + pl };
  if (m === pr) return { nx: 1, ny: 0, pen: r + pr };
  if (m === pt) return { nx: 0, ny: -1, pen: r + pt };
  return { nx: 0, ny: 1, pen: r + pb };
}

// 圆 vs 墙壁/边界：把圆推出，返回是否碰撞（坦克用）
function resolveCircle(p, r) {
  let hit = false;
  for (const rc of WALL_RECTS) {
    const c = circleRect(p.x, p.y, r, rc);
    if (c) { p.x += c.nx * c.pen; p.y += c.ny * c.pen; hit = true; }
  }
  // 场地边界
  if (p.x < r) { p.x = r; hit = true; }
  if (p.x > ARENA_W - r) { p.x = ARENA_W - r; hit = true; }
  if (p.y < r) { p.y = r; hit = true; }
  if (p.y > ARENA_H - r) { p.y = ARENA_H - r; hit = true; }
  return hit;
}

function pointBlocked(x, y, pad) {
  for (const rc of WALL_RECTS) {
    if (x > rc.x1 - pad && x < rc.x2 + pad && y > rc.y1 - pad && y < rc.y2 + pad) return true;
  }
  return x < pad || x > ARENA_W - pad || y < pad || y > ARENA_H - pad;
}

// 视线检测：沿线段采样，看是否被墙挡住
function hasLOS(x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(d / 10);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2)) return false;
  }
  return true;
}

/* ---------------- 敌人 AI 辅助 ---------------- */
// 沿某方向能走多远（近似碰撞半径的避障探测）
function clearDist(x, y, ang, maxD) {
  for (let d = TANK_R + 4; d < maxD; d += 12) {
    if (pointBlocked(x + Math.cos(ang) * d, y + Math.sin(ang) * d, TANK_R - 3)) return d;
  }
  return maxD;
}

// 找一个空旷的新路点
function pickWaypoint(t) {
  for (let i = 0; i < 24; i++) {
    const nx = rand(60, ARENA_W - 60), ny = rand(60, ARENA_H - 60);
    if (!pointBlocked(nx, ny, TANK_R + 10)) { t.wpX = nx; t.wpY = ny; return; }
  }
  t.wpX = ARENA_W / 2; t.wpY = ARENA_H / 2;
}

// 计算能命中玩家的射击角：优先直射，否则试一次墙面反弹（镜像法）。
// 返回 {angle, kind:"direct"|"bank"}，无解返回 null。
function computeShotAngles(ex, ey, px, py) {
  if (hasLOS(ex, ey, px, py)) {
    return { angle: Math.atan2(py - ey, px - ex), kind: "direct" };
  }
  let best = null;
  for (const s of WALL_SEGS) {
    const vertical = s.x1 === s.x2;
    const m = vertical ? s.x1 : s.y1;              // 镜面线位置
    // 玩家与敌人须在镜面同侧
    if (vertical ? ((ex - m) * (px - m) <= 0) : ((ey - m) * (py - m) <= 0)) continue;
    // 镜像玩家
    const qx = vertical ? 2 * m - px : px;
    const qy = vertical ? py : 2 * m - py;
    const den = vertical ? qx - ex : qy - ey;
    if (Math.abs(den) < 1e-6) continue;
    const tt = ((m - (vertical ? ex : ey)) / den);
    if (tt <= 0.03 || tt >= 0.97) continue;      // 反弹点不能贴近两端
    const bx = ex + (qx - ex) * tt;
    const by = ey + (qy - ey) * tt;
    // 反弹点须落在线段上（留少量容差）
    const lo = (vertical ? Math.min(s.y1, s.y2) : Math.min(s.x1, s.x2)) - 4;
    const hi = (vertical ? Math.max(s.y1, s.y2) : Math.max(s.x1, s.x2)) + 4;
    if ((vertical ? by : bx) < lo || (vertical ? by : bx) > hi) continue;
    // 两段路径都要畅通（两端各退 14px，避开贴墙采样的 padding 误杀）
    const d1 = Math.hypot(bx - ex, by - ey) || 1;
    const d2 = Math.hypot(px - bx, py - by) || 1;
    if (!hasLOS(ex, ey, bx - (bx - ex) / d1 * 14, by - (by - ey) / d1 * 14)) continue;
    if (!hasLOS(bx + (px - bx) / d2 * 14, by + (py - by) / d2 * 14, px, py)) continue;
    const total = Math.hypot(bx - ex, by - ey) + Math.hypot(px - bx, py - by);
    if (total > 1100) continue;
    if (!best || total < best.total) best = { angle: Math.atan2(qy - ey, qx - ex), kind: "bank", total };
  }
  return best;
}

/* ---------------- 音效（WebAudio 简易合成） ---------------- */
let audioCtx = null;
function beep(freq, dur, type = "square", vol = 0.05) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (_) { /* 无音频环境则静默 */ }
}

/* ---------------- 游戏状态 ---------------- */
let player, humanTanks, enemies, bullets, particles, kills, gameOver, shakeT, started;
let bulletId = 0;       // 子弹自增 id（规避掷骰按子弹记录）

function makeTank(x, y, isPlayer) {
  return {
    x, y,
    vx: 0, vy: 0,
    bodyAngle: isPlayer ? 0 : Math.atan2(SPAWN_PLAYER.y - y, SPAWN_PLAYER.x - x),
    turretAngle: 0,
    hp: isPlayer ? PLAYER_HP : ENEMY_HP,
    maxHp: isPlayer ? PLAYER_HP : ENEMY_HP,
    fireTimer: 0,
    muzzle: 0,          // 炮口闪光计时
    isPlayer,
    // AI 字段
    wpX: x, wpY: y,
    wpT: 0,
    stuckT: 0,
    reverseT: 0,
    dodgeT: 0,          // 规避动作剩余时间
    dodgeAng: null,     // 旋转规避目标朝向（null = 直接前进/倒车）
    dodgeDrive: 1,      // 前后移动方向（1 前进 / -1 倒车）
    dodgeRollFor: -1,   // 已掷过骰的子弹 id
    dodgeWill: false,   // 对该子弹是否决定规避（90%）
    evadeCheckT: 0,     // 威胁扫描计时
    senseT: 0,          // 感知计时（射击角度评估）
    lastShot: null,     // 最近一次算出的可命中射击角 {angle, kind}
    aimAngle: null,     // 锁定的瞄准角（含误差）
    memoryT: 0,         // 记得玩家位置的时间
    invulnT: 0,         // 受击无敌剩余时间
    dead: false,
  };
}

function startGame() {
  if (started) return;
  started = true;
  keys.clear();
  pendingFire = false;
  ui.startoverlay.style.display = "none";
}

function reset() {
  player = makeTank(HUMAN_SPAWNS[0].x, HUMAN_SPAWNS[0].y, true);
  humanTanks = [player];
  enemies = SPAWNS_ENEMY.slice(0, ENEMY_COUNT).map(s => makeTank(s.x, s.y, false));
  bullets = [];
  particles = [];
  kills = 0;
  gameOver = false;
  shakeT = 0;
  pendingFire = false;
  ui.overlay.classList.remove("show");
  syncHud();
}

/* ---------------- 开火 ---------------- */
function fire(tank) {
  const a = tank.turretAngle;
  const mx = tank.x + Math.cos(a) * 34;
  const my = tank.y + Math.sin(a) * 34;
  bullets.push({
    id: ++bulletId,
    x: mx, y: my,
    vx: Math.cos(a) * BULLET_SPEED,
    vy: Math.sin(a) * BULLET_SPEED,
    life: BULLET_LIFE,
    owner: tank,
  });
  tank.muzzle = 0.07;
  // 后坐力
  tank.vx -= Math.cos(a) * 26;
  tank.vy -= Math.sin(a) * 26;
  beep(tank.isPlayer ? 320 : 210, 0.08, "square", 0.045);
}

function spawnSparks(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(60, 240);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), maxLife: 0.5, color, size: rand(1.5, 3.5) });
  }
}

function explode(x, y) {
  spawnSparks(x, y, "#f59e0b", 18);
  spawnSparks(x, y, "#ef4444", 14);
  spawnSparks(x, y, "#3f3f46", 10);
  beep(70, 0.4, "sawtooth", 0.08);
}

/* ---------------- 联机人类玩家（由服务器驱动） ---------------- */
// 行为与 updatePlayer 一致，但输入来自网络：t.netInput = {keys: Set, fire: bool}
function updateNetHuman(t, dt) {
  const inp = t.netInput;
  const turn = 5.0 * dt;
  if (inp.keys.has("a")) t.bodyAngle -= turn;
  if (inp.keys.has("d")) t.bodyAngle += turn;
  const fx = Math.cos(t.bodyAngle), fy = Math.sin(t.bodyAngle);
  let drive = 0;
  if (inp.keys.has("w")) drive = 190;
  else if (inp.keys.has("s")) drive = -150;
  t.vx = fx * drive; t.vy = fy * drive;
  t.x += t.vx * dt; t.y += t.vy * dt;
  resolveCircle(t, TANK_R);
  t.turretAngle = t.bodyAngle;
  t.fireTimer -= dt;
  t.muzzle = Math.max(0, t.muzzle - dt);
  t.invulnT = Math.max(0, t.invulnT - dt);
  if ((inp.fire || inp.keys.has("j")) && t.fireTimer <= 0) { fire(t); t.fireTimer = PLAYER_FIRE_CD; }
  inp.fire = false; // 开火是边沿触发，消费一次即清除
}

// 增加一个人类玩家坦克（联机座位），返回坦克对象
function addHumanTank(seat) {
  const s = HUMAN_SPAWNS[seat % HUMAN_SPAWNS.length];
  const t = makeTank(s.x, s.y, true);
  t.netInput = { keys: new Set(), fire: false };
  humanTanks.push(t);
  return t;
}

/* ---------------- 更新：玩家 ---------------- */
function updatePlayer(dt) {
  const t = player;
  const turn = 5.0 * dt;
  if (keys.has("a")) t.bodyAngle -= turn;
  if (keys.has("d")) t.bodyAngle += turn;

  // 直接驱动：松开按键立即停住，无滑行
  const fx = Math.cos(t.bodyAngle), fy = Math.sin(t.bodyAngle);
  let drive = 0;
  if (keys.has("w")) drive = 190;
  else if (keys.has("s")) drive = -150;
  t.vx = fx * drive;
  t.vy = fy * drive;

  t.x += t.vx * dt;
  t.y += t.vy * dt;
  resolveCircle(t, TANK_R);

  // 炮塔固定面向车身当前方向
  t.turretAngle = t.bodyAngle;

  t.fireTimer -= dt;
  t.muzzle = Math.max(0, t.muzzle - dt);
  t.invulnT = Math.max(0, t.invulnT - dt);
  // 点按（边沿触发）与按住连发都支持
  const wantFire = keys.has("j") || pendingFire;
  pendingFire = false;
  if (wantFire && t.fireTimer <= 0) { fire(t); t.fireTimer = PLAYER_FIRE_CD; }
}

/* ---------------- 敌人规避 AI ---------------- */
// 寻找即将命中该坦克的子弹：返回 {b, tc}，tc 为按当前弹道最接近坦克的秒数
function incomingThreat(t) {
  let best = null;
  for (const b of bullets) {
    const vv = b.vx * b.vx + b.vy * b.vy;
    if (vv < 1) continue;
    const tc = ((t.x - b.x) * b.vx + (t.y - b.y) * b.vy) / vv;
    if (tc < 0.03 || tc > 0.9 || tc > b.life) continue;
    const cx = b.x + b.vx * tc, cy = b.y + b.vy * tc;
    if (Math.hypot(t.x - cx, t.y - cy) < TANK_R + BULLET_R + 8 && (!best || tc < best.tc)) {
      best = { b, tc };
    }
  }
  return best;
}

// 用 1/60s 步长模拟规避是否可行：turnTo 非空 = 先转向该朝向再驶离；否则沿当前朝向 dir(1/-1) 移动
function dodgeWorks(t, threat, turnTo, dir) {
  const b = threat.b;
  const step = 1 / 60, SPD = 100;
  let x = t.x, y = t.y, ang = t.bodyAngle;
  for (let el = 0; el < threat.tc + 0.05; el += step) {
    if (turnTo != null) {
      const dd = wrapAngle(turnTo - ang);
      if (Math.abs(dd) > 0.25) {
        ang += clamp(dd, -3.2 * step, 3.2 * step); // 还在转向，原地不动
      } else {
        ang = turnTo;
        const nx = x + Math.cos(ang) * SPD * step, ny = y + Math.sin(ang) * SPD * step;
        if (pointBlocked(nx, ny, TANK_R - 2)) return false; // 会撞墙
        x = nx; y = ny;
      }
    } else {
      const nx = x + Math.cos(ang) * SPD * dir * step, ny = y + Math.sin(ang) * SPD * dir * step;
      if (pointBlocked(nx, ny, TANK_R - 2)) return false;
      x = nx; y = ny;
    }
    if (Math.hypot(x - (b.x + b.vx * el), y - (b.y + b.vy * el)) < TANK_R + BULLET_R + 5) return false;
  }
  return true;
}

// 决策：对每颗来袭子弹只掷一次骰（90% 规避）；优先旋转规避，行不通再前进/倒车
function tryDodge(t, threat) {
  if (t.dodgeRollFor !== threat.b.id) {
    t.dodgeRollFor = threat.b.id;
    t.dodgeWill = Math.random() < 0.9;
  }
  if (!t.dodgeWill) return;
  const base = Math.atan2(threat.b.vy, threat.b.vx);
  for (const off of [Math.PI / 2, -Math.PI / 2]) {
    if (dodgeWorks(t, threat, base + off, 1)) {
      t.dodgeAng = base + off; t.dodgeDrive = 1; t.dodgeT = threat.tc + 0.2;
      return;
    }
  }
  for (const dir of [1, -1]) {
    if (dodgeWorks(t, threat, null, dir)) {
      t.dodgeAng = null; t.dodgeDrive = dir; t.dodgeT = threat.tc + 0.2;
      return;
    }
  }
}

/* ---------------- 更新：敌人 AI ---------------- */
function updateEnemy(e, dt) {
  const t = e;
  // 目标：最近的存活人类玩家
  let foe = player, foeDist = Infinity;
  for (const h of humanTanks) {
    if (h.dead) continue;
    const d = Math.hypot(h.x - t.x, h.y - t.y);
    if (d < foeDist) { foeDist = d; foe = h; }
  }
  const pdx = foe.x - t.x, pdy = foe.y - t.y;
  const pdist = Math.hypot(pdx, pdy);
  t.fireTimer -= dt;

  // --- 规避：定期扫描来袭子弹（命中前 0.9s 内），每颗子弹 90% 概率触发规避 ---
  t.dodgeT = Math.max(0, t.dodgeT - dt);
  t.evadeCheckT = Math.max(0, t.evadeCheckT - dt);
  if (t.evadeCheckT <= 0) {
    t.evadeCheckT = 0.12;
    const threat = incomingThreat(t);
    if (threat) tryDodge(t, threat);
  }

  // --- 感知：每 0.2s 评估一次能命中玩家的射击角（直射或一次墙面反弹） ---
  t.senseT -= dt;
  if (t.senseT <= 0) {
    t.senseT = 0.2;
    if (!foe.dead && pdist < 760) {
      const shot = computeShotAngles(t.x, t.y, foe.x, foe.y);
      if (shot) { t.lastShot = shot; t.memoryT = 3; }
    }
  }
  t.memoryT = Math.max(0, t.memoryT - dt);

  // --- 规避机动：优先于开火与常规移动 ---
  if (t.dodgeT > 0) {
    t.aimAngle = null;
    if (t.dodgeAng != null) {
      // 旋转规避：急转到安全朝向，转好后立即加速驶离弹道
      const dd = wrapAngle(t.dodgeAng - t.bodyAngle);
      t.bodyAngle += clamp(dd, -3.2 * dt, 3.2 * dt);
      if (Math.abs(dd) < 0.3) {
        t.vx += Math.cos(t.bodyAngle) * 320 * dt;
        t.vy += Math.sin(t.bodyAngle) * 320 * dt;
      }
      t.vx *= Math.pow(0.5, dt);
      t.vy *= Math.pow(0.5, dt);
    } else {
      // 来不及转向：沿当前朝向前进/倒车脱离弹道
      const fx = Math.cos(t.bodyAngle), fy = Math.sin(t.bodyAngle);
      t.vx += fx * 320 * t.dodgeDrive * dt;
      t.vy += fy * 320 * t.dodgeDrive * dt;
    }
  } else if (t.lastShot && t.fireTimer <= 0.3 && pdist < 720) {
    // --- 开火：能命中且冷却接近就绪 -> 停下转身，对齐后射击 ---
    if (t.aimAngle == null) t.aimAngle = t.lastShot.angle + rand(-0.035, 0.035);
    const diff = wrapAngle(t.aimAngle - t.bodyAngle);
    t.bodyAngle += clamp(diff, -2.8 * dt, 2.8 * dt);
    // 瞄准时快速刹停，自己也会成为靶子——给玩家喘息窗口
    t.vx *= Math.pow(0.02, dt);
    t.vy *= Math.pow(0.02, dt);
    if (Math.abs(diff) < 0.08) {
      fire(t);
      t.fireTimer = rand(1.3, 2.1);
      t.aimAngle = null;
      t.lastShot = null;
    }
  } else {
    // --- 移动：记得玩家就逼近，否则漫游 ---
    t.aimAngle = null;
    let tx, ty;
    if (t.memoryT > 0) { tx = foe.x; ty = foe.y; t.wpT = 0; }
    else {
      // 路点超时未达（可能隔着迷宫 unreachable）就换一个新路点
      t.wpT += dt;
      if (Math.hypot(t.wpX - t.x, t.wpY - t.y) < 40 || t.wpT > 7) { pickWaypoint(t); t.wpT = 0; }
      tx = t.wpX; ty = t.wpY;
    }
    const base = Math.atan2(ty - t.y, tx - t.x);
    // 胡须避障：候选方向里选最畅通且最接近目标的
    let bestAng = base, bestScore = -Infinity;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
      const d = clearDist(t.x, t.y, base + off, 140);
      const score = d - Math.abs(off) * 30 + rand(0, 6);
      if (score > bestScore) { bestScore = score; bestAng = base + off; }
    }
    const steer = wrapAngle(bestAng - t.bodyAngle);
    t.bodyAngle += clamp(steer, -2.4 * dt, 2.4 * dt);
    const fx = Math.cos(t.bodyAngle), fy = Math.sin(t.bodyAngle);

    // 卡住检测：想动却动不了 -> 倒退并换侧向路点脱困
    const speed = Math.hypot(t.vx, t.vy);
    if (Math.abs(steer) < 1.2 && speed < 16) t.stuckT += dt;
    else t.stuckT = Math.max(0, t.stuckT - dt * 2);
    if (t.stuckT > 0.6) {
      t.reverseT = 0.5;
      t.stuckT = 0;
      t.memoryT = 0;
      const side = Math.random() < 0.5 ? 1 : -1;
      const a = t.bodyAngle + side * Math.PI / 2;
      t.wpX = clamp(t.x + Math.cos(a) * 220, 40, ARENA_W - 40);
      t.wpY = clamp(t.y + Math.sin(a) * 220, 40, ARENA_H - 40);
    }
    t.reverseT = Math.max(0, t.reverseT - dt);
    if (t.reverseT > 0) { t.vx -= fx * 200 * dt; t.vy -= fy * 200 * dt; }
    else if (Math.abs(steer) < 1.2) { t.vx += fx * 280 * dt; t.vy += fy * 280 * dt; }
  }

  // 限速、积分、碰撞
  t.vx *= Math.pow(0.2, dt);
  t.vy *= Math.pow(0.2, dt);
  const sp = Math.hypot(t.vx, t.vy), maxSp = 140;
  if (sp > maxSp) { t.vx *= maxSp / sp; t.vy *= maxSp / sp; }
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  resolveCircle(t, TANK_R);

  // 炮塔固定面向车身当前方向
  t.turretAngle = t.bodyAngle;
  t.muzzle = Math.max(0, t.muzzle - dt);
  t.invulnT = Math.max(0, t.invulnT - dt);
}

/* ---------------- 更新：子弹 ---------------- */
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }

    // 墙壁反弹（圆 vs AABB，按法线反射）
    let bounced = false;
    for (const rc of WALL_RECTS) {
      const c = circleRect(b.x, b.y, BULLET_R, rc);
      if (!c) continue;
      b.x += c.nx * (c.pen + 0.1);
      b.y += c.ny * (c.pen + 0.1);
      const dot = b.vx * c.nx + b.vy * c.ny;
      b.vx -= 2 * dot * c.nx;
      b.vy -= 2 * dot * c.ny;
      bounced = true;
      break;
    }
    // 场地边界反弹
    if (b.x < BULLET_R) { b.x = BULLET_R; b.vx = Math.abs(b.vx); bounced = true; }
    if (b.x > ARENA_W - BULLET_R) { b.x = ARENA_W - BULLET_R; b.vx = -Math.abs(b.vx); bounced = true; }
    if (b.y < BULLET_R) { b.y = BULLET_R; b.vy = Math.abs(b.vy); bounced = true; }
    if (b.y > ARENA_H - BULLET_R) { b.y = ARENA_H - BULLET_R; b.vy = -Math.abs(b.vy); bounced = true; }
    if (bounced) spawnSparks(b.x, b.y, "#71717a", 3);

    // 命中坦克（包括发射者自己——流弹会反弹回来伤到自己）
    const targets = [...humanTanks, ...enemies];
    let consumed = false;
    for (const tk of targets) {
      if (tk.dead) continue;
      const dx = b.x - tk.x, dy = b.y - tk.y;
      if (dx * dx + dy * dy < (TANK_R + BULLET_R) * (TANK_R + BULLET_R)) {
        if (tk.invulnT > 0) { // 无敌时间内：子弹被吸收但不再掉血
          spawnSparks(b.x, b.y, "#9ca3af", 4);
          consumed = true;
          break;
        }
        tk.hp -= 1;
        tk.invulnT = HIT_INVULN;
        spawnSparks(b.x, b.y, tk.isPlayer ? "#3b82f6" : "#ef4444", 10);
        beep(tk.isPlayer ? 140 : 500, 0.12, "triangle", 0.06);
        if (tk.isPlayer) shakeT = 0.18;
        if (tk.hp <= 0) {
          tk.dead = true;
          explode(tk.x, tk.y);
          if (!tk.isPlayer) kills++;
        }
        consumed = true;
        break;
      }
    }
    if (consumed) bullets.splice(i, 1);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.1, dt);
    p.vy *= Math.pow(0.1, dt);
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/* ---------------- 绘制 ---------------- */
function drawTank(t) {
  const bodyC = t.isPlayer ? "#3b82f6" : "#ef4444";
  const darkC = t.isPlayer ? "#1e3a8a" : "#7f1d1d";

  ctx.save();
  ctx.translate(t.x, t.y);
  // 受击无敌时间：闪烁提示
  if (t.invulnT > 0) ctx.globalAlpha = Math.sin(performance.now() / 50) > 0 ? 1 : 0.35;

  // 车身（沿 bodyAngle）
  ctx.save();
  ctx.rotate(t.bodyAngle);
  ctx.fillStyle = darkC;
  ctx.fillRect(-17, -17, 34, 9);   // 左履带
  ctx.fillRect(-17, 8, 34, 9);     // 右履带
  ctx.fillStyle = bodyC;
  roundRect(-16, -12, 33, 24, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.25)";
  roundRect(-12, -8, 12, 16, 3);
  ctx.fill();
  ctx.restore();

  // 炮塔 + 炮管（沿 turretAngle）
  ctx.save();
  ctx.rotate(t.turretAngle);
  ctx.fillStyle = darkC;
  ctx.fillRect(4, -3.5, 28, 7);
  ctx.fillStyle = bodyC;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = darkC;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 炮口闪光
  if (t.muzzle > 0) {
    const a = t.turretAngle;
    ctx.fillStyle = "rgba(251,191,36,.9)";
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 36, Math.sin(a) * 36, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 敌人血条
  if (!t.isPlayer) {
    const w = 34, ratio = clamp(t.hp / t.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(t.x - w / 2, t.y - 32, w, 5);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(t.x - w / 2, t.y - 32, w * ratio, 5);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  ctx.save();
  if (shakeT > 0) {
    const m = shakeT / 0.18 * 4;
    ctx.translate(rand(-m, m), rand(-m, m));
  }

  // 场地：灰白色 + 细网格
  ctx.fillStyle = "#e9e9e7";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.strokeStyle = "rgba(0,0,0,.045)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < ARENA_W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); }
  for (let y = 40; y < ARENA_H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); }
  ctx.stroke();

  // 墙壁：黑色粗线段
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = WALL_T;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const s of WALL_SEGS) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
  ctx.stroke();

  // 粒子
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // 坦克
  for (const e of enemies) if (!e.dead) drawTank(e);
  if (!player.dead) drawTank(player);

  // 子弹（剩余寿命 <3 秒时闪烁提示）
  for (const b of bullets) {
    ctx.globalAlpha = b.life < 3 ? (Math.sin(performance.now() / 60) > 0 ? 1 : 0.35) : 1;
    ctx.fillStyle = "#18181b";
    ctx.beginPath();
    ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 玩家生命圈
  if (!player.dead) {
    const ratio = clamp(player.hp / PLAYER_HP, 0, 1);
    ctx.strokeStyle = `rgba(37,99,235,${0.25 + ratio * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 27, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/* ---------------- HUD / 胜负 ---------------- */
function syncHud() {
  const hp = Math.max(0, player.hp);
  ui.hpfill.style.width = (hp / PLAYER_HP * 100) + "%";
  ui.hptext.textContent = hp;
  ui.eftext.textContent = enemies.filter(e => !e.dead).length;
  ui.killtext.textContent = kills;
}

function endGame(win) {
  gameOver = true;
  keys.clear();
  ui.ovtitle.textContent = win ? "胜 利" : "阵 亡";
  ui.ovdesc.textContent = win
    ? `你击毁了全部 ${kills} 辆敌方坦克！按 R 再来一局`
    : `你击毁了 ${kills} 辆敌方坦克。按 R 再战`;
  ui.overlay.classList.add("show");
}

/* ---------------- 输入 ---------------- */
const keys = new Set();
let pendingFire = false;
const GAME_KEYS = new Set(["w", "a", "s", "d", "j", "r"]);
window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (!started && (k === "enter" || k === " ")) { e.preventDefault(); startGame(); return; }
  if (GAME_KEYS.has(k)) e.preventDefault();
  keys.add(k);
  if (k === "j" && !e.repeat) pendingFire = true;
  if (k === "r" && started) reset();
});
window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("contextmenu", e => e.preventDefault());
ui.restart.addEventListener("click", reset);
ui.startbtn.addEventListener("click", startGame);

/* ---------------- 主循环 ---------------- */
let lastT = performance.now();
function loop(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  // 开始页：只画静态场景，不推进游戏
  if (!started) {
    draw();
    requestAnimationFrame(loop);
    return;
  }

  if (!gameOver) {
    updatePlayer(dt);
    for (const h of humanTanks) if (h !== player && !h.dead) updateNetHuman(h, dt);
    for (const e of enemies) if (!e.dead) updateEnemy(e, dt);
    updateBullets(dt);
    updateParticles(dt);
    shakeT = Math.max(0, shakeT - dt);
    syncHud();
    if (humanTanks.every(h => h.dead)) endGame(false);
    else if (enemies.every(e => e.dead)) endGame(true);
  } else {
    updateParticles(dt);
  }

  draw();
  requestAnimationFrame(loop);
}

reset();
requestAnimationFrame(loop);

// 仅供自动化测试/调试读取的只读句柄
window.__game = {
  get player() { return player; },
  get humans() { return humanTanks; },
  get kills() { return kills; },
  get enemies() { return enemies; },
  get bullets() { return bullets; },
  get gameOver() { return gameOver; },
  computeShotAngles, hasLOS, pointBlocked,
  incomingThreat, dodgeWorks, tryDodge,
  addHumanTank, startGame, reset,
};
