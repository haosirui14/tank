# 坦克大战 · 联机部署说明

## 一、本地运行（先验证能用）

```bash
cd app
npm install
npm start
```

启动后：

- **联机对战**：`http://localhost:7100/?room=abc`（room 相同即同一战局）
- **单机版**：`http://localhost:7100/index.html`

**局域网联机**：让同学浏览器打开 `http://<你的局域网IP>:7100/?room=abc`
（你的局域网 IP 用 `ipconfig` 查，一般是 `192.168.x.x`）。电脑需要在同一 WiFi 下，
且防火墙允许 7100 端口入站（第一次启动时 Windows 会弹窗，点允许）。

## 二、部署到免费托管平台（跨地点联机）

项目根目录就是 `app/`，自带 `Dockerfile` 和 `package.json`，
任何支持 Node.js / Docker 的平台都能跑。通用步骤：

1. 把 `app/` 文件夹上传到 GitHub 仓库（仓库根目录 = app 目录内容）
2. 在托管平台「从 Git 仓库导入/部署」
3. 平台自动识别 Node.js：`npm install` 后运行 `npm start`
4. 部署完成后会得到一个 `https://xxx.xxx` 地址，打开即是联机页

### 平台提示（免费政策以各平台官网当前为准）

- **Railway**（railway.app）：用 GitHub 账号登录 → New Project → Deploy from GitHub repo。
  新账号有试用额度，小项目够用。部署后在 Settings → Networking 里确认生成了公网域名。
- **Render**（render.com）：New → Web Service → 连接 GitHub 仓库。
  有免费档，但免费实例一段时间没人访问会休眠，首次打开要等约 1 分钟唤醒。
- **Fly.io**、**Vercel**（需配 ws 长连接设置）等也可，思路相同。

### 部署后怎么用

- 打开平台给你的地址 → 看到联机页 → 点「开始游戏」
- 把地址（带 `?room=abc`）发给同学即可加入同一战局
- 不同 room 是互不相干的战场，例如 `?room=class1`、`?room=class2`

## 三、架构简介（方便你魔改）

- `src/main.js` —— 唯一的游戏逻辑来源：移动、碰撞、AI（含规避）、无敌时间、胜负。
  单机页直接跑它；服务器在无头 VM 里跑同一份文件，保证两边规则完全一致。
- `net/server.js` —— HTTP 静态服务 + WebSocket 房间；30Hz 权威模拟，15Hz 广播快照；
  最多 4 名玩家，任意玩家可按开始/重开。
- `net/client.js` —— 纯渲染 + 输入上报，本地不做游戏逻辑（防作弊）。

改游戏规则只需改 `src/main.js`，单机和联机同时生效。
