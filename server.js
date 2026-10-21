#!/usr/bin/env node
/**
 * 人生卡牌 · 桃花坞同款 —— 联机服务器（零依赖，原生 Node.js WebSocket）
 *
 * 使用方法：
 *   1. 安装 Node.js（https://nodejs.org，LTS 版本即可）
 *   2. 在本文件所在目录运行：node server.js
 *   3. 浏览器打开 http://localhost:8787 （局域网内其他设备访问 http://你的电脑IP:8787）
 *   4. 联机模式下输入昵称 → 创建房间 / 加入房间
 *
 * 说明：
 *   - 服务器同时托管前端页面（index.html），并负责房间管理、洗牌抽牌与状态广播。
 *   - 房间内所有玩家的底牌、放弃的牌、抽到的挫折牌都互相可见（按游戏设定）。
 *   - 端口可用环境变量 PORT 修改。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const MAX_PLAYERS = 12;

/* ------------------------------------------------------------------ */
/* 卡牌数据（与 index.html 中的保持一致）                              */
/* ------------------------------------------------------------------ */

const PHASES = ['0-10岁', '11-20岁', '21-30岁', '31-40岁', '迟暮之年'];

const BASE_CARDS = [
  { id: 'b01', name: '亲情',     icon: '👨‍👩‍👧‍👦', desc: '家人的陪伴与支持' },
  { id: 'b02', name: '信心',     icon: '💪',      desc: '相信自己能行' },
  { id: 'b03', name: '善良',     icon: '🌷',      desc: '温柔对待世界' },
  { id: 'b04', name: '才华',     icon: '🎨',      desc: '天赋与创造力' },
  { id: 'b05', name: '智商',     icon: '🧠',      desc: '聪明与学习力' },
  { id: 'b06', name: '信任',     icon: '🤝',      desc: '被人信任与托付' },
  { id: 'b07', name: '坚强',     icon: '🛡️',      desc: '扛住风雨的韧性' },
  { id: 'b08', name: '颜值',     icon: '✨',      desc: '好看的外表' },
  { id: 'b09', name: '伯乐',     icon: '🧭',      desc: '贵人指路，机遇相助' },
  { id: 'b10', name: '情商',     icon: '😌',      desc: '懂人心，会相处' },
  { id: 'b11', name: '健康',     icon: '🍀',      desc: '无病无痛的好身体' },
  { id: 'b12', name: '爱宠',     icon: '🐱',      desc: '毛孩子的陪伴' },
  { id: 'b13', name: '知心挚友', icon: '🍻',      desc: '无话不谈的朋友' },
  { id: 'b14', name: '相濡以沫的恋人', icon: '💑', desc: '一生相守的爱情' },
  { id: 'b15', name: '原谅的勇气', icon: '🕊️',    desc: '放下伤害，重头来过' },
  { id: 'b16', name: '养家的能力', icon: '💰',    desc: '撑起一个家的担当' },
  { id: 'b17', name: '爱人的能力', icon: '❤️',    desc: '真诚去爱与被爱' },
  { id: 'b18', name: '正义感',   icon: '⚖️',      desc: '是非分明，挺身而出' },
];

const SETBACKS = [
  // 阶段 0：0-10岁
  { id: 's01', phase: 0, text: '家庭经济破产',   conflicts: ['b16', 'b02', 'b11'] },
  { id: 's02', phase: 0, text: '父母日常吵架',   conflicts: ['b01', 'b06'] },
  { id: 's03', phase: 0, text: '成绩永远倒数第一', conflicts: ['b05', 'b04', 'b02'] },
  { id: 's04', phase: 0, text: '经常被父母贬低', conflicts: ['b02', 'b01'] },
  { id: 's05', phase: 0, text: '自己养的宠物离世', conflicts: ['b12'] },
  { id: 's06', phase: 0, text: '被同学欺负',     conflicts: ['b02', 'b07'] },
  { id: 's07', phase: 0, text: '身体先天缺陷',   conflicts: ['b11', 'b08'] },
  { id: 's08', phase: 0, text: '被拐卖',         conflicts: ['b01', 'b06'] },
  // 阶段 1：11-20岁
  { id: 's09', phase: 1, text: '被孤立',         conflicts: ['b13', 'b10', 'b06'] },
  { id: 's10', phase: 1, text: '考不上大学',     conflicts: ['b05', 'b04', 'b02'] },
  { id: 's11', phase: 1, text: '家人病重',       conflicts: ['b01', 'b11', 'b16'] },
  { id: 's12', phase: 1, text: '作弊被抓',       conflicts: ['b06', 'b02'] },
  { id: 's13', phase: 1, text: '犯罪坐牢',       conflicts: ['b03', 'b18', 'b06'] },
  { id: 's14', phase: 1, text: '至亲离世',       conflicts: ['b01'] },
  { id: 's15', phase: 1, text: '在校时被造谣',   conflicts: ['b06', 'b13', 'b02'] },
  { id: 's16', phase: 1, text: '被校园霸凌',     conflicts: ['b02', 'b07', 'b03'] },
  // 阶段 2：21-30岁
  { id: 's17', phase: 2, text: '恋人背叛',       conflicts: ['b14', 'b06', 'b17'] },
  { id: 's18', phase: 2, text: '长得丑',         conflicts: ['b08'] },
  { id: 's19', phase: 2, text: '十年无工作',     conflicts: ['b16', 'b04', 'b02'] },
  { id: 's20', phase: 2, text: '母胎solo',       conflicts: ['b17', 'b14', 'b10'] },
  { id: 's21', phase: 2, text: '遭遇车祸',       conflicts: ['b11', 'b07'] },
  { id: 's22', phase: 2, text: '连住五年地下室', conflicts: ['b02', 'b16'] },
  { id: 's23', phase: 2, text: '挣不到钱',       conflicts: ['b16', 'b04'] },
  { id: 's24', phase: 2, text: '嫁妈宝男',       conflicts: ['b17', 'b14', 'b10'] },
  // 阶段 3：31-40岁
  { id: 's25', phase: 3, text: '被网络暴力',     conflicts: ['b02', 'b06', 'b08'] },
  { id: 's26', phase: 3, text: '无家可归',       conflicts: ['b01', 'b16', 'b11'] },
  { id: 's27', phase: 3, text: '疾病缠身',       conflicts: ['b11'] },
  { id: 's28', phase: 3, text: '身无分文',       conflicts: ['b16', 'b02'] },
  { id: 's29', phase: 3, text: '被裁员',         conflicts: ['b16', 'b04', 'b02'] },
  { id: 's30', phase: 3, text: '妻离子散',       conflicts: ['b14', 'b01', 'b17'] },
  { id: 's31', phase: 3, text: '家产被骗',       conflicts: ['b16', 'b06', 'b05'] },
  { id: 's32', phase: 3, text: '职场霸凌',       conflicts: ['b02', 'b07', 'b04'] },
  { id: 's33', phase: 3, text: '自杀未遂',       conflicts: ['b07', 'b02', 'b11'] },
  { id: 's34', phase: 3, text: '遭遇家暴',       conflicts: ['b11', 'b02', 'b07'] },
  // 阶段 4：迟暮之年
  { id: 's35', phase: 4, text: '患阿兹海默',     conflicts: ['b05', 'b04', 'b13'] },
  { id: 's36', phase: 4, text: '子女啃老',       conflicts: ['b16', 'b01'] },
  { id: 's37', phase: 4, text: '孤身一人',       conflicts: ['b14', 'b13', 'b01'] },
  { id: 's38', phase: 4, text: '变植物人',       conflicts: ['b11', 'b05', 'b04'] },
  { id: 's39', phase: 4, text: '医院常驻',       conflicts: ['b11', 'b07'] },
  { id: 's40', phase: 4, text: '子女不管',       conflicts: ['b01', 'b16'] },
  { id: 's41', phase: 4, text: '白发人送黑发人', conflicts: ['b01', 'b11'] },
  { id: 's42', phase: 4, text: '晚年拾荒养活自己', conflicts: ['b16', 'b11', 'b02'] },
];

const CARDS_BY_ID = new Map(BASE_CARDS.map(c => [c.id, c]));
const SETBACKS_BY_ID = new Map(SETBACKS.map(s => [s.id, s]));
const SETBACK_DECK_BY_PHASE = PHASES.map((_, p) => SETBACKS.filter(s => s.phase === p).map(s => s.id));

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* 房间管理                                                            */
/* ------------------------------------------------------------------ */

const rooms = new Map(); // code -> room

function genRoomCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  return code;
}

function newPlayer(name, ws, isHost) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    name, ws, online: true, isHost,
    status: 'lobby',          // lobby | choosing | waiting | deciding | decided | done
    hand: [],                 // 当前保留的底牌
    chosen: [],               // 初始选中的10张
    discarded: [],            // 已放弃的底牌
    setbacks: [],             // 接受的挫折牌 [{phase, setbackId, choice}]
    currentSetback: null,     // 正在面对的挫折牌
    conflictOptions: [],      // 接受时可放弃的冲突牌（在手牌中）
  };
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, isHost: p.isHost, online: p.online,
    status: p.status, hand: p.hand, chosen: p.chosen, discarded: p.discarded,
    setbacks: p.setbacks, currentSetback: p.currentSetback,
    conflictOptions: p.conflictOptions,
  };
}

function roomState(room) {
  return {
    type: 'state',
    mode: 'online',
    roomCode: room.code,
    stage: room.stage,        // lobby | choosing | setback | finished
    currentPhase: room.currentPhase,
    players: room.players.map(publicPlayer),
  };
}

function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players) {
    if (p.ws && p.online) { try { p.ws.sendText(msg); } catch (e) {} }
  }
}

function sendTo(ws, obj) { try { ws.sendText(JSON.stringify(obj)); } catch (e) {} }

/* ------------------------- 游戏流程 ------------------------- */

function resetForGame(room) {
  room.stage = 'choosing';
  room.currentPhase = -1;
  room.decks = SETBACK_DECK_BY_PHASE.map(shuffled);
  room.deckPos = [0, 0, 0, 0, 0];
  for (const p of room.players) {
    p.status = 'choosing';
    p.hand = []; p.chosen = []; p.discarded = []; p.setbacks = [];
    p.currentSetback = null; p.conflictOptions = [];
  }
}

function drawSetback(room, phase) {
  const deck = room.decks[phase];
  let pos = room.deckPos[phase];
  if (pos >= deck.length) {
    deck.length = 0;
    deck.push(...shuffled(SETBACK_DECK_BY_PHASE[phase]));
    pos = 0;
  }
  room.deckPos[phase] = pos + 1;
  return deck[pos];
}

function dealPhase(room) {
  for (const p of room.players) {
    p.currentSetback = drawSetback(room, room.currentPhase);
    const sb = SETBACKS_BY_ID.get(p.currentSetback);
    p.conflictOptions = (sb ? sb.conflicts : []).filter(id => p.hand.includes(id));
    p.status = 'deciding';
  }
}

function afterChoice(room) {
  if (room.stage !== 'choosing') return;
  const allReady = room.players.every(p => p.status !== 'choosing');
  if (allReady) {
    room.stage = 'setback';
    room.currentPhase = 0;
    dealPhase(room);
  }
}

function afterSetback(room) {
  if (room.stage !== 'setback') return;
  const allDecided = room.players.every(p => p.status === 'decided' || p.status === 'done');
  if (!allDecided) return;
  if (room.currentPhase >= 4) {
    room.stage = 'finished';
    for (const p of room.players) p.status = 'done';
  } else {
    room.currentPhase += 1;
    dealPhase(room);
  }
}

/* ------------------------- 消息处理 ------------------------- */

function handleMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') return;
  const room = ws._room;
  const player = ws._player;

  switch (msg.type) {
    case 'create': {
      if (room) { sendTo(ws, { type: 'error', message: '你已在房间中' }); return; }
      if (rooms.size >= 500) { sendTo(ws, { type: 'error', message: '服务器房间已满，请稍后再试' }); return; }
      const code = genRoomCode();
      const p = newPlayer(String(msg.name || '玩家').slice(0, 12), ws, true);
      const r = { code, players: [p], stage: 'lobby', currentPhase: -1, decks: [], deckPos: [] };
      rooms.set(code, r);
      ws._room = r; ws._player = p;
      sendTo(ws, { type: 'created', roomCode: code, playerId: p.id, isHost: true });
      broadcastState(r);
      break;
    }
    case 'join': {
      if (room) { sendTo(ws, { type: 'error', message: '你已在房间中' }); return; }
      const code = String(msg.room || '').trim().toUpperCase();
      const r = rooms.get(code);
      if (!r) { sendTo(ws, { type: 'error', message: '房间不存在，请检查房间号' }); return; }
      if (r.stage !== 'lobby') { sendTo(ws, { type: 'error', message: '游戏已开始，无法加入' }); return; }
      if (r.players.length >= MAX_PLAYERS) { sendTo(ws, { type: 'error', message: '房间已满（最多12人）' }); return; }
      const p = newPlayer(String(msg.name || '玩家').slice(0, 12), ws, false);
      r.players.push(p);
      ws._room = r; ws._player = p;
      sendTo(ws, { type: 'joined', roomCode: code, playerId: p.id, isHost: false });
      broadcastState(r);
      break;
    }
    case 'start': {
      if (!room) return;
      if (!player || !player.isHost) { sendTo(ws, { type: 'error', message: '只有房主可以开始游戏' }); return; }
      if (room.players.length < 2) { sendTo(ws, { type: 'error', message: '至少需要2名玩家' }); return; }
      resetForGame(room);
      broadcastState(room);
      break;
    }
    case 'choose': {
      if (!room || !player) return;
      if (room.stage !== 'choosing' || player.status !== 'choosing') { sendTo(ws, { type: 'error', message: '当前不能选牌' }); return; }
      const ids = Array.isArray(msg.cardIds) ? msg.cardIds : [];
      if (ids.length !== 10) { sendTo(ws, { type: 'error', message: '请正好选择10张底牌' }); return; }
      if (new Set(ids).size !== 10) { sendTo(ws, { type: 'error', message: '底牌不能重复' }); return; }
      if (!ids.every(id => CARDS_BY_ID.has(id))) { sendTo(ws, { type: 'error', message: '包含无效卡牌' }); return; }
      player.chosen = ids.slice();
      player.hand = ids.slice();
      player.status = 'waiting';
      afterChoice(room);
      broadcastState(room);
      break;
    }
    case 'accept': {
      if (!room || !player) return;
      if (room.stage !== 'setback' || player.status !== 'deciding') { sendTo(ws, { type: 'error', message: '当前不能接受挫折' }); return; }
      const sb = SETBACKS_BY_ID.get(player.currentSetback);
      if (!sb) return;
      const discardId = msg.discardId;
      if (!player.hand.includes(discardId)) { sendTo(ws, { type: 'error', message: '要放弃的底牌不在手牌中' }); return; }
      if (player.conflictOptions.length > 0 && !player.conflictOptions.includes(discardId)) {
        sendTo(ws, { type: 'error', message: '请选择与挫折冲突的底牌' }); return;
      }
      player.hand = player.hand.filter(id => id !== discardId);
      player.discarded.push(discardId);
      player.setbacks.push({ phase: room.currentPhase, setbackId: player.currentSetback, choice: 'accept' });
      player.currentSetback = null; player.conflictOptions = [];
      player.status = 'decided';
      afterSetback(room);
      broadcastState(room);
      break;
    }
    case 'refuse': {
      if (!room || !player) return;
      if (room.stage !== 'setback' || player.status !== 'deciding') { sendTo(ws, { type: 'error', message: '当前不能拒绝挫折' }); return; }
      const ids = Array.isArray(msg.discardIds) ? msg.discardIds : [];
      if (ids.length !== 2) { sendTo(ws, { type: 'error', message: '拒绝挫折需要放弃2张底牌' }); return; }
      if (new Set(ids).size !== 2 || !ids.every(id => player.hand.includes(id))) {
        sendTo(ws, { type: 'error', message: '请选择2张不同的手牌放弃' }); return;
      }
      const sb = SETBACKS_BY_ID.get(player.currentSetback);
      player.setbacks.push({ phase: room.currentPhase, setbackId: player.currentSetback, choice: 'refuse' });
      player.hand = player.hand.filter(id => !ids.includes(id));
      player.discarded.push(...ids);
      player.currentSetback = null; player.conflictOptions = [];
      player.status = 'decided';
      afterSetback(room);
      broadcastState(room);
      break;
    }
    case 'restart': {
      if (!room || !player || !player.isHost) { sendTo(ws, { type: 'error', message: '只有房主可以重新开始' }); return; }
      resetForGame(room);
      broadcastState(room);
      break;
    }
    case 'leave': {
      removePlayerFromRoom(room, player);
      break;
    }
    default:
      break;
  }
}

function broadcastState(r) { broadcast(r, roomState(r)); }

function removePlayerFromRoom(room, player) {
  if (!room || !player) return;
  const idx = room.players.indexOf(player);
  if (idx >= 0) room.players.splice(idx, 1);
  try { if (player.ws) player.ws.close(); } catch (e) {}
  if (room.players.length === 0) {
    rooms.delete(room.code);
  } else {
    // 房主离开时把房主转让给第一位在线玩家
    if (!room.players.some(p => p.isHost && p.online)) {
      const next = room.players.find(p => p.online) || room.players[0];
      if (next) next.isHost = true;
    }
    broadcastState(room);
  }
}

/* ------------------------------------------------------------------ */
/* WebSocket（原生实现，零依赖）                                       */
/* ------------------------------------------------------------------ */

function encodeTextFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function attachWebSocket(socket) {
  let buffer = Buffer.alloc(0);
  let closed = false;

  const conn = {
    socket,
    sendText(str) {
      if (closed) return;
      try { socket.write(encodeTextFrame(str)); } catch (e) {}
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        // 发送 close 帧（0x88, len 0）
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
      } catch (e) {}
    },
  };

  socket.on('data', chunk => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (!masked) { socket.destroy(); return; } // 客户端帧必须掩码
      if (buffer.length < offset + 4 + len) return;
      const mask = buffer.slice(offset, offset + 4);
      offset += 4;
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = buffer[offset + i] ^ mask[i % 4];
      buffer = buffer.slice(offset + len);

      if (opcode === 0x8) { conn.close(); return; }
      if (opcode === 0x9) { // ping
        try { socket.write(Buffer.concat([Buffer.from([0x8a, 0x00])])); } catch (e) {}
        continue;
      }
      if (opcode === 0xa) continue; // pong
      if (opcode === 0x1 && fin) { // text
        const text = payload.toString('utf8');
        try {
          handleMessage(conn, JSON.parse(text));
        } catch (e) { /* 忽略坏消息 */ }
      }
    }
  });

  socket.on('error', () => {});
  socket.on('close', () => {
    closed = true;
    if (conn._room && conn._player) {
      const room = conn._room;
      const player = conn._player;
      player.online = false;
      if (room.players.every(p => !p.online)) {
        rooms.delete(room.code);
      } else if (!room.players.some(p => p.isHost && p.online)) {
        const next = room.players.find(p => p.online) || room.players[0];
        if (next) next.isHost = true;
      }
      broadcastState(room);
    }
  });

  return conn;
}

/* ------------------------------------------------------------------ */
/* HTTP 服务器：静态文件 + WebSocket 升级                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.md': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const base = path.join(__dirname);
    const filePath = path.normalize(path.join(base, urlPath));
    if (!filePath.startsWith(base)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(400); res.end('Bad Request');
  }
}

const server = http.createServer((req, res) => {
  serveStatic(req, res);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  attachWebSocket(socket);
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  人生卡牌 · 桃花坞同款 联机服务器已启动');
  console.log(`  本机访问:  http://localhost:${PORT}`);
  console.log('  局域网请用: http://<你的电脑IP>:' + PORT);
  console.log('  浏览器打开后选择「联机模式」即可创建/加入房间');
  console.log('  提示：同一 Wi-Fi 下手机访问同一地址即可加入');
  console.log('==============================================');
});
