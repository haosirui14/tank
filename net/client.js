/* 坦克大战联机客户端：只负责输入上报和快照渲染（服务器权威，本地不做游戏逻辑） */
(() => {
  const ARENA_W = 1200, ARENA_H = 800, WALL_T = 12, TANK_R = 20, BULLET_R = 4;
  const HUMAN_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];

  // 与服务器 src/main.js 保持一致的墙壁布局
  const WALL_SEGS = [
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
    { x1: 280, y1: 180, x2: 540, y2: 180 },
    { x1: 280, y1: 620, x2: 540, y2: 620 },
    { x1: 700, y1: 300, x2: 960, y2: 300 },
    { x1: 700, y1: 520, x2: 960, y2: 520 },
    { x1: 920, y1: 240, x2: 1140, y2: 240 },
    { x1: 80,  y1: 560, x2: 320, y2: 560 },
  ];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    conn: document.getElementById('conn'),
    hpfill: document.getElementById('hpfill'),
    hptext: document.getElementById('hptext'),
    eftext: document.getElementById('eftext'),
    killtext: document.getElementById('killtext'),
    roominfo: document.getElementById('roominfo'),
    sharelink: document.getElementById('sharelink'),
    startoverlay: document.getElementById('startoverlay'),
    startbtn: document.getElementById('startbtn'),
    overlay: document.getElementById('overlay'),
    ovtitle: document.getElementById('ovtitle'),
    ovdesc: document.getElementById('ovdesc'),
    restart: document.getElementById('restart'),
  };

  const params = new URLSearchParams(location.search);
  const room = params.get('room') || 'default';
  // 服务器地址优先级：?server= 参数 > 页面内置 window.__WS_HOST__ > 当前网站同域
  const serverParam = params.get('server');
  const wsHost = serverParam || window.__WS_HOST__ || location.host;
  ui.roominfo.textContent = '房间 ' + room;
  ui.sharelink.textContent = location.href;

  /* ---------------- 网络 ---------------- */
  let ws = null, you = -1, started = false, over = 0;
  let latest = null; // 最近一份快照

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${wsHost}/ws?room=${encodeURIComponent(room)}`);
    ws.onopen = () => { ui.conn.textContent = '已连接'; };
    ws.onclose = () => {
      ui.conn.textContent = '已断开，5 秒后重连…';
      setTimeout(connect, 5000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        you = m.you;
        started = m.started;
        if (started) ui.startoverlay.style.display = 'none';
      } else if (m.t === 'started') {
        started = true;
        ui.startoverlay.style.display = 'none';
      } else if (m.t === 'reset') {
        over = 0;
        ui.overlay.classList.remove('show');
        // 清掉本地平滑缓存，避免旧位置漂移
        disp.humans = []; disp.enemies = [];
      } else if (m.t === 'snap') {
        latest = m;
        over = m.over;
        syncHud(m);
      } else if (m.t === 'full') {
        ui.conn.textContent = '房间已满（4 人）';
      }
    };
  }
  connect();

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  /* ---------------- 输入 ---------------- */
  const keys = new Set();
  let fireEdge = false;
  function pushInput() { send({ t: 'in', k: [...keys], f: fireEdge }); fireEdge = false; }
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (!started && (k === 'enter' || k === ' ')) { e.preventDefault(); send({ t: 'start' }); return; }
    if (k === 'r' && over) { send({ t: 'reset' }); return; }
    if (!'wasdj'.includes(k)) return;
    e.preventDefault();
    if (!keys.has(k)) {
      keys.add(k);
      if (k === 'j') fireEdge = true;
      pushInput();
    }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (keys.delete(k)) pushInput();
  });
  window.addEventListener('blur', () => { keys.clear(); pushInput(); });
  setInterval(pushInput, 150); // 心跳，防丢包
  ui.startbtn.addEventListener('click', () => send({ t: 'start' }));
  ui.restart.addEventListener('click', () => send({ t: 'reset' }));
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  /* ---------------- HUD ---------------- */
  function syncHud(m) {
    const me = m.humans[m.you];
    const hp = me ? Math.max(0, me[3]) : 3;
    ui.hpfill.style.width = (hp / 3 * 100) + '%';
    ui.hptext.textContent = hp;
    ui.eftext.textContent = m.enemies.filter(e => !e[4]).length;
    ui.killtext.textContent = m.kills;
    if (m.over === 1 && !ui.overlay.classList.contains('show')) {
      ui.ovtitle.textContent = '胜 利';
      ui.ovdesc.textContent = `全队击毁全部 ${m.kills} 辆敌方坦克！按 R 再来一局`;
      ui.overlay.classList.add('show');
    } else if (m.over === 2 && !ui.overlay.classList.contains('show')) {
      ui.ovtitle.textContent = '全 灭';
      ui.ovdesc.textContent = `击毁了 ${m.kills} 辆敌方坦克。按 R 再战`;
      ui.overlay.classList.add('show');
    }
  }

  /* ---------------- 渲染（对快照做指数平滑） ---------------- */
  const disp = { humans: [], enemies: [] };
  function smoothList(list, snapList) {
    while (list.length < snapList.length) list.push(null);
    list.length = snapList.length;
    for (let i = 0; i < snapList.length; i++) {
      const s = snapList[i];
      const d = list[i];
      if (!d) { list[i] = { x: s[0], y: s[1], a: s[2], hp: s[3], dead: !!s[4] }; continue; }
      d.x += (s[0] - d.x) * 0.3;
      d.y += (s[1] - d.y) * 0.3;
      let da = s[2] - d.a;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      d.a += da * 0.3;
      d.hp = s[3]; d.dead = !!s[4];
    }
  }

  function drawTank(t, color, dark, isSelf) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.save();
    ctx.rotate(t.a);
    ctx.fillStyle = dark;
    ctx.fillRect(-17, -17, 34, 9);
    ctx.fillRect(-17, 8, 34, 9);
    ctx.fillStyle = color;
    ctx.fillRect(-16, -12, 33, 24);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(-12, -8, 12, 16);
    ctx.restore();
    ctx.save();
    ctx.rotate(t.a);
    ctx.fillStyle = dark;
    ctx.fillRect(4, -3.5, 28, 7);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
    if (!isSelf) {
      const w = 34, ratio = Math.max(0, t.hp / 3);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(t.x - w / 2, t.y - 32, w, 5);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(t.x - w / 2, t.y - 32, w * ratio, 5);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    ctx.fillStyle = '#e9e9e7';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.strokeStyle = 'rgba(0,0,0,.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < ARENA_W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); }
    for (let y = 40; y < ARENA_H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); }
    ctx.stroke();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = WALL_T;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of WALL_SEGS) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
    ctx.stroke();

    if (latest) {
      smoothList(disp.enemies, latest.enemies);
      smoothList(disp.humans, latest.humans);
      for (let i = 0; i < disp.enemies.length; i++) {
        const t = disp.enemies[i];
        if (!t.dead) drawTank(t, '#ef4444', '#7f1d1d', false);
      }
      for (let i = 0; i < disp.humans.length; i++) {
        const t = disp.humans[i];
        if (!t.dead) drawTank(t, HUMAN_COLORS[i % 4], '#1e293b', i === you);
      }
      ctx.fillStyle = '#18181b';
      for (const b of latest.bullets) {
        ctx.beginPath();
        ctx.arc(b[0], b[1], BULLET_R, 0, Math.PI * 2);
        ctx.fill();
      }
      // 自己脚下的生命圈
      const me = disp.humans[you];
      if (me && !me.dead) {
        const ratio = Math.max(0, me.hp / 3);
        ctx.strokeStyle = `rgba(37,99,235,${0.25 + ratio * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(me.x, me.y, 27, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#6a6a70';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待服务器快照…', ARENA_W / 2, ARENA_H / 2);
    }
    requestAnimationFrame(draw);
  }
  draw();
})();
