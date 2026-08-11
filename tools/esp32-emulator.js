#!/usr/bin/env node
/*
 * ESP32 emulator.
 *
 * Implements exactly the protocol in `firmware/pestguard_esp32.ino` — same
 * endpoints, same field names, same WebSocket frames — so the app's real
 * transport can be exercised end to end without hardware on the bench.
 *
 * This is a test fixture, not part of the app. Nothing in `src/` imports it and
 * it is never bundled. It exists so that "the LAN transport works" is something
 * that has been demonstrated rather than asserted.
 *
 *   node tools/esp32-emulator.js [httpPort]
 *
 * HTTP listens on httpPort (default 8090), WebSocket on httpPort + 1, matching
 * the firmware's port-80/81 split.
 */

const http = require('http');
const crypto = require('crypto');

const HTTP_PORT = Number(process.argv[2] || 8090);
const WS_PORT = HTTP_PORT + 1;

const BOOT = Date.now();
const DEVICE_ID = 'PG-A4CF12';

let seq = 0;
let armed = true;
let deterring = false;
const ring = [];
const RING_MAX = 200;

const config = {
  sens: 62,
  pattern: 'sweep',
  intensity: 78,
  dur: 12,
  cooldown: 45,
  ultrasonic: true,
  strobe: true,
  buzzer: true,
  quiet: false,
  quietStart: 1320,
  quietEnd: 360,
  quietUltrasonic: true,
  heartbeat: 30,
};

const BANDS = [
  [1500, 5000],
  [5000, 9000],
  [9000, 14000],
  [14000, 19000],
];

const up = () => Date.now() - BOOT;

function battery() {
  // Slow, monotonic discharge so the app's regression has something real to fit.
  const hours = up() / 3_600_000;
  const volts = Math.max(3.2, 4.12 - hours * 0.02);
  const pct = Math.max(0, Math.min(100, ((volts - 3.2) / 0.95) * 100));
  return { volts: Number(volts.toFixed(3)), pct: Math.round(pct) };
}

function statusObject() {
  const b = battery();
  return {
    proto: 1,
    id: DEVICE_ID,
    name: 'North Gate',
    zone: 'North Field',
    fw: 'pestguard-esp32 1.0.0',
    up: up(),
    time: Date.now(),
    status: deterring ? 'deterring' : armed ? 'armed' : 'disarmed',
    rssi: -52 - Math.round(Math.random() * 8),
    ssid: 'FarmHouse-2.4G',
    ip: '192.168.1.42',
    batt: b.pct,
    volts: b.volts,
    events: seq,
    buffered: ring.length,
    // Mirrors the firmware's SENSOR_ENVELOPE build: a sound-sensor module, so
    // the four numbers are envelope features, not frequency bands.
    sampleRate: 2000,
    sensor: 'envelope',
    featureLabels: ['Loudness', 'Attack', 'Rhythm', 'Sustain'],
    bands: [],
    config,
  };
}

/**
 * Envelope features [loudness, attack, rhythm, sustain] with the shape each
 * behaviour actually produces — matching the firmware's envelope classifier.
 */
function bandsFor(cls) {
  const n = (mu, sd) => Math.max(0.02, Math.min(1, mu + (Math.random() - 0.5) * 2 * sd));
  switch (cls) {
    // Chirps: loud, sharp onset, short, not sustained.
    case 'bird':   return [n(0.82, 0.10), n(0.74, 0.10), n(0.30, 0.10), n(0.22, 0.09)];
    // Stridulation: steady and smooth, low attack.
    case 'insect': return [n(0.45, 0.12), n(0.18, 0.08), n(0.35, 0.12), n(0.86, 0.08)];
    // Gnawing: sharp and strongly rhythmic, low sustain.
    case 'rodent': return [n(0.60, 0.12), n(0.80, 0.10), n(0.82, 0.09), n(0.25, 0.10)];
    default:       return [n(0.40, 0.22), n(0.40, 0.22), n(0.40, 0.22), n(0.40, 0.22)];
  }
}

function pushEvent(evt, cls, extra = {}) {
  const b = battery();
  const e = {
    id: ++seq,
    ts: Date.now(),
    up: up(),
    evt,
    cls,
    conf: extra.conf ?? 0,
    b: extra.b ?? [0, 0, 0, 0],
    dwell: extra.dwell ?? 0,
    batt: b.pct,
    volts: b.volts,
    rssi: -52 - Math.round(Math.random() * 8),
    ...(extra.ch ? { ch: extra.ch, dur: extra.dur } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
  ring.push(e);
  while (ring.length > RING_MAX) ring.shift();
  broadcast({ t: 'event', e });
  return e;
}

// ---------------------------------------------------------------------------
// Minimal WebSocket server (RFC 6455 text frames only)
// ---------------------------------------------------------------------------

const clients = new Set();

const wsServer = http.createServer();
wsServer.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  clients.add(socket);
  send(socket, JSON.stringify({ t: 'status', s: statusObject() }));

  socket.on('data', (buf) => {
    const msg = decodeFrame(buf);
    if (!msg) return;
    try {
      const parsed = JSON.parse(msg);
      if (parsed.t === 'ping') send(socket, JSON.stringify({ t: 'pong', id: parsed.id }));
    } catch { /* not JSON */ }
  });
  const drop = () => clients.delete(socket);
  socket.on('close', drop);
  socket.on('error', drop);
});

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  if (!masked) return buf.slice(offset, offset + len).toString('utf8');
  const mask = buf.slice(offset, offset + 4);
  offset += 4;
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) out[i] = buf[offset + i] ^ mask[i % 4];
  return out.toString('utf8');
}

function send(socket, str) {
  try { socket.write(encodeFrame(str)); } catch { clients.delete(socket); }
}

function broadcast(obj) {
  const str = JSON.stringify(obj);
  for (const s of clients) send(s, str);
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (code, body) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') { json(204, {}); return; }

  if (url.pathname === '/api/status') return json(200, statusObject());

  if (url.pathname === '/api/events') {
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Number(url.searchParams.get('limit') || RING_MAX);
    const events = ring.filter((e) => e.id > since).slice(0, limit);
    return json(200, { events, count: events.length, seq });
  }

  if (url.pathname === '/api/config' && req.method === 'GET') return json(200, config);

  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        Object.assign(config, JSON.parse(body));
        pushEvent('config_ack', 'unknown');
        json(200, { ok: true, config });
      } catch {
        json(400, { ok: false, msg: 'bad json' });
      }
    });
    return;
  }

  if (url.pathname === '/api/cmd' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let cmd = '';
      try { cmd = JSON.parse(body).cmd; } catch { /* ignore */ }
      if (cmd === 'arm') armed = true;
      else if (cmd === 'disarm') { armed = false; deterring = false; }
      else if (cmd === 'test-deterrent') {
        deterring = true;
        pushEvent('deter', 'unknown', {
          conf: 1, ch: ['ultrasonic', 'strobe', 'buzzer'], dur: 4000,
          note: 'Manual test burst',
        });
        setTimeout(() => {
          deterring = false;
          broadcast({ t: 'status', s: statusObject() });
        }, 4000);
      }
      broadcast({ t: 'status', s: statusObject() });
      json(200, { ok: true, cmd });
    });
    return;
  }

  json(404, { ok: false, msg: 'no such endpoint' });
});

// ---------------------------------------------------------------------------
// Simulated acoustic activity
// ---------------------------------------------------------------------------

const CLASSES = ['bird', 'insect', 'rodent', 'unknown'];

function tick() {
  if (!armed) return;
  if (Math.random() > 0.55) return;
  const cls = CLASSES[Math.floor(Math.random() * CLASSES.length)];
  const conf = cls === 'unknown' ? 0.3 + Math.random() * 0.15 : 0.55 + Math.random() * 0.4;
  const fires = config.pattern !== 'silent' && cls !== 'unknown' && conf > 0.45;

  if (fires) {
    deterring = true;
    const ch = [];
    if (config.ultrasonic) ch.push('ultrasonic');
    if (config.strobe) ch.push('strobe');
    if (config.buzzer) ch.push('buzzer');
    pushEvent('deter', cls, {
      conf, b: bandsFor(cls), dwell: 300 + Math.floor(Math.random() * 2500),
      ch, dur: config.dur * 1000,
    });
    setTimeout(() => {
      deterring = false;
      broadcast({ t: 'status', s: statusObject() });
    }, 3000);
  } else {
    pushEvent('detect', cls, {
      conf, b: bandsFor(cls), dwell: 200 + Math.floor(Math.random() * 1500),
    });
  }
}

// Seed a few hours of history so charts have something to draw immediately.
(function seedHistory() {
  const now = Date.now();
  for (let i = 40; i > 0; i--) {
    const cls = CLASSES[Math.floor(Math.random() * CLASSES.length)];
    const e = {
      id: ++seq,
      ts: now - i * 6 * 60_000,
      up: Math.max(0, up() - i * 6 * 60_000),
      evt: Math.random() > 0.4 ? 'deter' : 'detect',
      cls,
      conf: cls === 'unknown' ? 0.35 : 0.6 + Math.random() * 0.35,
      b: bandsFor(cls),
      dwell: 200 + Math.floor(Math.random() * 2000),
      batt: battery().pct,
      volts: battery().volts,
      rssi: -55,
    };
    if (e.evt === 'deter') { e.ch = ['ultrasonic', 'strobe']; e.dur = 12000; }
    ring.push(e);
  }
})();

server.listen(HTTP_PORT, () => {
  wsServer.listen(WS_PORT, () => {
    console.log(`ESP32 emulator ${DEVICE_ID}`);
    console.log(`  REST      http://localhost:${HTTP_PORT}/api/status`);
    console.log(`  WebSocket ws://localhost:${WS_PORT}/`);
    console.log(`  Pair in the app with: localhost:${HTTP_PORT}`);
  });
  setInterval(tick, 4000);
  setInterval(() => {
    pushEvent('heartbeat', 'unknown');
    broadcast({ t: 'status', s: statusObject() });
  }, config.heartbeat * 1000);
});
