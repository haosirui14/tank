/* 坦克大战联机服务器
 * - 静态文件服务（联机页 / 、单机页 /index.html）
 * - WebSocket 房间：服务器权威模拟，直接复用 src/main.js 的全部游戏逻辑（无头运行）
 * - 30Hz 模拟、15Hz 快照广播，最多 4 名玩家
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 7100;
const ROOT = path.join(__dirname, '..');              // app/ 目录
const TICK_MS = 1000 / 30;
const SNAP_EVERY = 2;                                  // 每 2 个 tick 广播一次快照（15Hz）
const MAX_SEATS = 4;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

/* ---------------- 无头游戏世界（每个房间一份） ---------------- */
const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

function createWorld() {
  const els = {};
  const handlers = {};
  let rafCb = null;
  let worldNow = 0;
  const makeEl = () => ({
    style: {},
    classList: { add() {}, remove() {} },
    textContent: '',
    addEventListener(type, fn) { (this._h ||= {})[type] = fn; },
  });
  const ctxProxy = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  });
  const canvas = Object.assign(makeEl(), { width: 1200, height: 800, getContext: () => ctxProxy });
  const sandbox = {
    console,
    performance: { now: () => worldNow },
    document: { getElementById: (id) => (els[id] ||= (id === 'game' ? canvas : makeEl())) },
    requestAnimationFrame: (cb) => { rafCb = cb; },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (handlers[type] ||= []).push(fn); };
  vm.createContext(sandbox);
  vm.runInContext(gameSrc, sandbox);

  return {
    G: sandbox.window.__game,
    key(k, down) {
      for (const h of handlers[down ? 'keydown' : 'keyup'] || []) {
        h({ key: k, repeat: false, preventDefault() {} });
      }
    },
    step() {
      worldNow += TICK_MS;
      const cb = rafCb; rafCb = null;
      if (cb) cb(worldNow);
    },
  };
}

/* ---------------- 房间管理 ---------------- */
const rooms = new Map();

function broadcastLog(r, txt) {
  const msg = JSON.stringify({ t: 'log', txt });
  for (const ws of r.clients.values()) ws.send(msg);
}

function broadcastSnap(r) {
  const G = r.world.G;
  const snap = {
    t: 'snap',
    over: G.gameOver ? (G.enemies.every(e => e.dead) ? 1 : 2) : 0, // 1=胜利 2=全灭
    kills: G.kills,
    humans: G.humans.map(h => [rd1(h.x), rd1(h.y), rd2(h.bodyAngle), h.hp, h.dead ? 1 : 0]),
    enemies: G.enemies.map(e => [rd1(e.x), rd1(e.y), rd2(e.bodyAngle), e.hp, e.dead ? 1 : 0]),
    bullets: G.bullets.map(b => [rd1(b.x), rd1(b.y)]),
  };
  for (const [seat, ws] of r.clients) ws.send(JSON.stringify({ ...snap, you: seat }));
}

function startRoom(r) {
  if (r.started) return;
  r.started = true;
  // 给已入座的非主机玩家生成坦克
  for (const seat of r.clients.keys()) if (seat > 0) r.world.G.addHumanTank(seat);
  r.world.key('Enter', true); // 触发 startGame
  const msg = JSON.stringify({ t: 'started' });
  for (const ws of r.clients.values()) ws.send(msg);
  broadcastLog(r, '游戏开始！');
}

function resetRoom(r) {
  const G = r.world.G;
  G.reset();
  for (const seat of r.clients.keys()) if (seat > 0) G.addHumanTank(seat);
  for (const st of r.inputs.values()) { st.keys.clear(); st.fire = false; }
  r.lastKeys.clear();
  const msg = JSON.stringify({ t: 'reset' });
  for (const ws of r.clients.values()) ws.send(msg);
}

function tick(r) {
  const G = r.world.G;
  // 应用各座位输入
  for (const [seat, inp] of r.inputs) {
    const keys = new Set([...inp.keys].filter(k => 'wasdj'.includes(k)));
    if (seat === 0) {
      // 主机座位：把输入翻译成合成键盘事件，驱动本地玩家
      for (const k of keys) if (!r.lastKeys.has(k)) r.world.key(k, true);
      for (const k of r.lastKeys) if (!keys.has(k)) r.world.key(k, false);
      r.lastKeys = keys;
      if (inp.fire) { r.world.key('j', true); r.world.key('j', false); inp.fire = false; }
    } else {
      const t = G.humans[seat];
      if (t && t.netInput) {
        t.netInput.keys = keys;
        if (inp.fire) { t.netInput.fire = true; inp.fire = false; }
      }
    }
  }
  r.world.step();
  r.tickN++;
  if (r.tickN % SNAP_EVERY === 0 && r.clients.size) broadcastSnap(r);
}

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = {
      code,
      world: createWorld(),
      clients: new Map(),   // seat -> ws
      inputs: new Map(),    // seat -> {keys:Set, fire:bool}
      lastKeys: new Set(),
      started: false,
      tickN: 0,
      timer: setInterval(() => tick(r), TICK_MS),
    };
    rooms.set(code, r);
  }
  return r;
}

function leaveRoom(r, seat, ws) {
  if (r.clients.get(seat) !== ws) return;
  r.clients.delete(seat);
  r.inputs.delete(seat);
  broadcastLog(r, `玩家 ${seat + 1} 离开（坦克留在场上）`);
  if (r.clients.size === 0) {
    clearInterval(r.timer);
    rooms.delete(r.code);
  }
}

/* ---------------- HTTP 静态服务 + WebSocket ---------------- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/net/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { ws.close(); return; }
  const code = (url.searchParams.get('room') || 'default').slice(0, 24);
  const r = getRoom(code);

  if (r.clients.size >= MAX_SEATS) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }
  const seat = Array.from({ length: MAX_SEATS }, (_, i) => i).find(s => !r.clients.has(s));
  r.clients.set(seat, ws);
  r.inputs.set(seat, { keys: new Set(), fire: false });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.send(JSON.stringify({ t: 'welcome', you: seat, started: r.started }));
  if (r.started) {
    // 中途加入：立即生成坦克
    r.world.G.addHumanTank(seat);
    broadcastLog(r, `玩家 ${seat + 1} 中途加入`);
  }

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'in') {
      const inp = r.inputs.get(seat);
      if (!inp) return;
      inp.keys = new Set(Array.isArray(m.k) ? m.k : []);
      if (m.f) inp.fire = true;
    } else if (m.t === 'start') {
      startRoom(r);
    } else if (m.t === 'reset') {
      if (r.started) resetRoom(r);
    }
  });
  ws.on('close', () => leaveRoom(r, seat, ws));
  ws.on('error', () => leaveRoom(r, seat, ws));
});

// 心跳：清理断开的连接
setInterval(() => {
  for (const r of rooms.values()) {
    for (const [seat, ws] of r.clients) {
      if (!ws.isAlive) { leaveRoom(r, seat, ws); ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 15000);

const rd1 = v => Math.round(v * 10) / 10;
const rd2 = v => Math.round(v * 100) / 100;

server.listen(PORT, () => {
  console.log(`坦克大战联机服务器已启动: http://localhost:${PORT}`);
  console.log(`  联机对战: http://localhost:${PORT}/?room=abc`);
  console.log(`  单机版:   http://localhost:${PORT}/index.html`);
});
