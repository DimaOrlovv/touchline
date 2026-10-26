import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MatchSim } from './src/engine/match.js';
import { newLeague, applyResult, effectiveSquad, standings, isOut, TEAMS_ORDER } from './src/engine/season.js';
import { DEFAULT_STYLES, styleOf } from './src/engine/styles.js';

const PORT = Number(process.env.PORT || 8137);
const ROOT = path.resolve('.');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'league.json');
const SQUADS_FILE = path.join(ROOT, 'src', 'data', 'squads.json');
const DB_VERSION = 2;

// Облачное хранилище сезона на бесплатном Upstash Redis (REST).
// Если переменные не заданы — работает локальный файл.
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = process.env.DB_KEY || 'touchline:league';
const remoteEnabled = !!(REDIS_URL && REDIS_TOKEN);

const MATCH_MINUTES = Number(process.env.MATCH_MINUTES || 4);   // реальная длительность матча
const HALFTIME_MS = Number(process.env.HALFTIME_SECONDS || 30) * 1000;
const MS_PER_SIM_MIN = (MATCH_MINUTES * 60000) / 93;
const LOGINS = { arlpsg: 'arsenal', mirbar: 'barcelona', meirea: 'real_madrid' };

const SQUADS = JSON.parse(fs.readFileSync(SQUADS_FILE, 'utf8'));
const squadsByKey = Object.fromEntries(SQUADS.teams.map((t) => [t.key, t]));

function blankLineups() {
  const out = {};
  for (const t of SQUADS.teams) out[t.key] = { slots: t.starters.map((p) => ({ id: p.id, pos: p.pos })) };
  return out;
}

function coerceDb(raw) {
  if (raw?.version === DB_VERSION && raw?.league?.rounds?.length) {
    return {
      league: raw.league,
      lineups: raw.lineups || blankLineups(),
      tokens: raw.tokens || {},
      styles: { ...DEFAULT_STYLES, ...(raw.styles || {}) },
    };
  }
  return null;
}

async function remoteGet() {
  if (!remoteEnabled) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(REDIS_KEY)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`redis ${r.status}`);
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch (e) {
    console.error('не удалось прочитать облако:', e.message);
    return null;
  }
}

async function load() {
  const fromCloud = coerceDb(await remoteGet());
  if (fromCloud) {
    console.log('сезон загружен из облака (Upstash)');
    return fromCloud;
  }
  try {
    const fromFile = coerceDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    if (fromFile) {
      console.log('сезон загружен из файла');
      return fromFile;
    }
  } catch (e) { /* первый запуск или старая версия */ }
  return {
    league: newLeague(TEAMS_ORDER, 30, Date.now() % 100000),
    lineups: blankLineups(),
    tokens: {},
    styles: { ...DEFAULT_STYLES },
  };
}

const DB = await load();
let saveTimer = null;
let cloudTimer = null;
let cloudBusy = false;
let cloudDirty = false;

function snapshot() {
  return JSON.stringify({
    version: DB_VERSION, updatedAt: new Date().toISOString(),
    league: DB.league, lineups: DB.lineups, tokens: DB.tokens, styles: DB.styles,
  });
}

function writeLocal() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, snapshot());
}

async function pushCloud() {
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(REDIS_KEY)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'text/plain' },
    body: snapshot(),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
}

function scheduleCloud(delay = 500) {
  if (!remoteEnabled) return;
  cloudDirty = true;
  if (cloudTimer || cloudBusy) return;
  cloudTimer = setTimeout(async () => {
    cloudTimer = null;
    if (cloudBusy) return;
    cloudDirty = false;
    cloudBusy = true;
    try {
      await pushCloud();
    } catch (e) {
      cloudDirty = true;
      console.error('не удалось сохранить в облако:', e.message);
    } finally {
      cloudBusy = false;
      if (cloudDirty) scheduleCloud(3000);
    }
  }, delay);
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { writeLocal(); } catch (e) { console.error(e.message); } }, 120);
  scheduleCloud();
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(saveTimer);
  clearTimeout(cloudTimer);
  try { writeLocal(); } catch (e) { /* ignore */ }
  if (remoteEnabled) {
    try { await pushCloud(); } catch (e) { console.error('финальное сохранение не удалось:', e.message); }
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ---- живое состояние матча -------------------------------------------------
let live = null;

function nextRoundIdx() { return DB.league.rounds.findIndex((r) => !r.played); }

function squadFor(key) {
  const base = squadsByKey[key];
  const slots = (DB.lineups[key]?.slots || []).filter((s) => findPlayer(key, s.id));
  if (slots.length !== 11 || !slots.some((s) => posOf(s.id, key) === 'GK' && s.pos === 'GK')) {
    return { ...base, starters: base.starters.map((p) => ({ ...p })), bench: base.bench.map((p) => ({ ...p })) };
  }
  const all = [...base.starters, ...base.bench];
  const used = new Set();
  const starters = slots.map((s) => {
    const p = all.find((x) => x.id === s.id);
    used.add(s.id);
    return { ...p, pos: s.pos, role: s.pos, slot: true };
  });
  const bench = all.filter((p) => !used.has(p.id)).map((p) => ({ ...p }));
  return { ...base, starters, bench };
}

function posOf(id, key) { return [...squadsByKey[key].starters, ...squadsByKey[key].bench].find((p) => p.id === id)?.pos; }
function findPlayer(key, id) { return [...squadsByKey[key].starters, ...squadsByKey[key].bench].find((p) => p.id === id); }

// Состав на матч: травмированные выпадают, их места занимают запасные.
function matchSquad(key) {
  const eff = effectiveSquad(DB.league, squadFor(key));
  return { ...eff, bench: eff.bench.filter((p) => !isOut(DB.league, p.id) && !p.promoted) };
}

function publicState(teamKey) {
  const league = DB.league;
  const idx = nextRoundIdx();
  return {
    account: teamKey || null,
    teams: SQUADS.teams.map((t) => ({ key: t.key, name: t.name, coach: t.coach, avg: t.avg_starters })),
    table: standings(league, squadsByKey),
    rounds: league.rounds.map((r) => ({
      round: r.round, home: r.home, away: r.away, played: r.played, hs: r.hs, as: r.as,
      summary: r.played ? { scorers: r.scorers, stats: r.stats, cards: r.cards, mvp: r.mvp } : null,
    })),
    roundIdx: idx,
    lineups: DB.lineups,
    styles: { ...DB.styles },
    squad: squadPayload(teamKey),
    squads: Object.fromEntries(SQUADS_ORDER_KEYS.map((k) => [k, squadPayload(k)])),
    injuries: league.injuries,
    playerStats: league.players,
    live: liveView(),
    serverTime: Date.now(),
  };
}

const SQUADS_ORDER_KEYS = SQUADS.teams.map((t) => t.key);

function squadPayload(key) {
  if (!key) return null;
  const s = squadFor(key);
  const eff = effectiveSquad(DB.league, s);
  return {
    key, name: s.name, coach: s.coach, formation: s.formation,
    starters: eff.starters.map((p) => ({ ...p, injured: !!DB.league.injuries[p.id] })),
    bench: eff.bench.map((p) => ({ ...p, injured: !!DB.league.injuries[p.id] })),
    raw: { starters: s.starters, bench: s.bench },
  };
}

function liveView() {
  if (!live) return null;
  return {
    roundIdx: live.roundIdx, round: live.round, home: live.home, away: live.away,
    status: live.status, ready: live.ready, events: live.events,
    score: live.score, startedAt: live.startedAt, endedAt: live.endedAt,
    breakUntil: live.breakUntil || null,
    half: live.sim?.half || 1,
    styles: live.sim
      ? { [live.home]: live.sim.home.coach.styleId, [live.away]: live.sim.away.coach.styleId }
      : { [live.home]: DB.styles[live.home], [live.away]: DB.styles[live.away] },
  };
}

const clients = new Set();

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch (e) { /* клиент отвалился */ } }
}

function broadcastState() {
  for (const res of clients) {
    const teamKey = res.__team;
    try { res.write(`event: state\ndata: ${JSON.stringify(publicState(teamKey))}\n\n`); } catch (e) { /* ignore */ }
  }
}

// ---- жизненный цикл матча --------------------------------------------------
function markReady(teamKey, roundIdx) {
  const idx = nextRoundIdx();
  if (idx === -1) return { error: 'Сезон завершён' };
  const rd = DB.league.rounds[idx];
  if (roundIdx != null && roundIdx !== idx) return { error: 'Тур уже изменился' };
  if (teamKey !== rd.home && teamKey !== rd.away) return { error: 'Ваша команда не играет этот тур' };

  if (!live || live.roundIdx !== idx || live.status === 'done') {
    live = {
      roundIdx: idx, round: rd.round, home: rd.home, away: rd.away,
      status: 'waiting', ready: { [rd.home]: false, [rd.away]: false },
      events: [], score: [0, 0], sim: null, timer: null, startedAt: null, endedAt: null,
    };
  }
  live.ready[teamKey] = true;
  if (live.ready[rd.home] && live.ready[rd.away] && live.status === 'waiting') startMatch();
  broadcast('live', liveView());
  return { ok: true, live: liveView() };
}

function startMatch() {
  live.status = 'running';
  live.startedAt = Date.now();
  const squads = Object.fromEntries(SQUADS_ORDER_KEYS.map((k) => [k, matchSquad(k)]));
  live.sim = new MatchSim({
    homeKey: live.home, awayKey: live.away, squads,
    seed: (live.round * 7919 + DB.league.seed) % 100000,
    styles: { [live.home]: DB.styles[live.home], [live.away]: DB.styles[live.away] },
  });
  broadcast('live', liveView());
  pump();
}

function pump() {
  if (!live || live.status !== 'running') return;
  let ev;
  try {
    ev = live.sim.tick();
  } catch (err) {
    console.error('симуляция упала', err);
    finishMatch(true);
    return;
  }
  if (!ev) { finishMatch(true); return; }
  const light = {
    id: ev.id, clock: ev.clock, type: ev.type, teamKey: ev.teamKey, text: ev.text,
    score: ev.score, scorer: ev.scorer, assist: ev.assist, player: ev.player,
    in: ev.in, out: ev.out, reason: ev.reason, serious: ev.serious,
    style: ev.style, styleName: ev.styleName,
  };
  live.events.push(light);
  live.score = ev.score;
  broadcast('event', light);
  if (ev.type === 'ht') {
    live.status = 'halftime';
    live.breakUntil = Date.now() + HALFTIME_MS;
    clearTimeout(live.timer);
    live.timer = setTimeout(resumeSecondHalf, HALFTIME_MS);
    broadcast('live', liveView());
    broadcastState();
    return;
  }
  let delay = Math.min(4200, Math.max(90, (ev.dur || 0.3) * MS_PER_SIM_MIN));
  if (ev.type === 'goal') delay += 1400;
  if (ev.type === 'ft' || ev.type === 'red') delay += 900;
  live.timer = setTimeout(pump, delay);
}

function resumeSecondHalf() {
  if (!live || live.status !== 'halftime') return;
  live.status = 'running';
  live.breakUntil = null;
  broadcast('live', liveView());
  pump();
}

function finishMatch(commit) {
  clearTimeout(live.timer);
  const sim = live.sim;
  live.status = 'done';
  live.breakUntil = null;
  live.endedAt = Date.now();
  let summary = null;
  if (commit && sim && !DB.league.rounds[live.roundIdx].played) {
    applyResult(DB.league, live.roundIdx, sim);
    persist();
    const rd = DB.league.rounds[live.roundIdx];
    summary = {
      round: rd.round, home: rd.home, away: rd.away, hs: rd.hs, as: rd.as,
      scorers: rd.scorers, stats: rd.stats, cards: rd.cards, mvp: rd.mvp,
    };
  }
  broadcast('match_end', { live: liveView(), summary, state: DB.league.rounds.map((r) => ({ round: r.round, played: r.played, hs: r.hs, as: r.as })) });
  broadcastState();
  const finished = live;
  setTimeout(() => { if (live === finished && live.status === 'done') { live = null; broadcast('live', null); broadcastState(); } }, 9000);
}

// ---- HTTP ------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 200000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url, 'http://x').searchParams.get('token');
  const team = DB.tokens[token];
  return team ? { token, team } : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (p === '/api/login' && req.method === 'POST') {
      const { login } = await readBody(req);
      const team = LOGINS[String(login || '').trim().toLowerCase()];
      if (!team) return send(res, 401, JSON.stringify({ error: 'Логин не найден' }));
      const token = crypto.randomBytes(16).toString('hex');
      DB.tokens[token] = team;
      persist();
      return send(res, 200, JSON.stringify({ token, team, name: squadsByKey[team].name, coach: squadsByKey[team].coach }));
    }

    if (p === '/api/stream') {
      const a = auth(req);
      if (!a) return send(res, 401, JSON.stringify({ error: 'нет авторизации' }));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.__team = a.team;
      res.write(`event: hello\ndata: ${JSON.stringify(publicState(a.team))}\n\n`);
      res.write(`event: live\ndata: ${JSON.stringify(liveView())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* ignore */ } }, 15000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    // приватные API-маршруты — только с токеном
    if (p.startsWith('/api/')) {
      const a = auth(req);
      if (!a) return send(res, 401, JSON.stringify({ error: 'нужен вход' }));
      return apiOnly(req, res, p, a);
    }
    return serveStatic(req, res, p);
  } catch (err) {
    console.error(err);
    send(res, 500, JSON.stringify({ error: String(err.message || err) }));
  }
});

async function apiOnly(req, res, p, a) {
    const team = a.team;

    if (p === '/api/state') return send(res, 200, JSON.stringify(publicState(team)));

    if (p === '/api/ready' && req.method === 'POST') {
      const { roundIdx } = await readBody(req);
      const r = markReady(team, roundIdx);
      if (r.error) return send(res, 400, JSON.stringify(r));
      broadcastState();
      return send(res, 200, JSON.stringify(r));
    }

    if (p === '/api/xi' && req.method === 'POST') {
      const { slots } = await readBody(req);
      if (!Array.isArray(slots) || slots.length !== 11) return send(res, 400, JSON.stringify({ error: 'Нужно 11 игроков' }));
      const ids = new Set();
      for (const s of slots) {
        if (!findPlayer(team, s.id) || ids.has(s.id)) return send(res, 400, JSON.stringify({ error: 'Дубли в составе' }));
        ids.add(s.id);
      }
      const gkCount = slots.filter((s) => s.pos === 'GK' && findPlayer(team, s.id)?.pos === 'GK').length;
      if (gkCount !== 1) return send(res, 400, JSON.stringify({ error: 'В старте должен быть ровно один вратарь' }));
      DB.lineups[team] = { slots: slots.map((s) => ({ id: s.id, pos: s.pos })) };
      persist();
      broadcastState();
      return send(res, 200, JSON.stringify({ ok: true }));
    }

    if (p === '/api/style' && req.method === 'POST') {
      const { styleId } = await readBody(req);
      if (styleOf(styleId).id !== styleId) return send(res, 400, JSON.stringify({ error: 'Неизвестный стиль' }));
      const active = live && (live.home === team || live.away === team) ? live : null;
      if (active && active.status === 'running') {
        return send(res, 400, JSON.stringify({ error: 'Стиль меняется до матча или в перерыве' }));
      }
      DB.styles[team] = styleId;
      persist();
      if (active?.sim && active.status === 'halftime') active.sim.setStyle(team, styleId);
      broadcast('live', liveView());
      broadcastState();
      return send(res, 200, JSON.stringify({ ok: true, styleId }));
    }

    if (p === '/api/reset' && req.method === 'POST') {
      clearTimeout(live?.timer);
      live = null;
      DB.league = newLeague(TEAMS_ORDER, 30, Date.now() % 100000);
      DB.lineups = blankLineups();
      persist();
      broadcast('live', null);
      broadcastState();
      return send(res, 200, JSON.stringify({ ok: true }));
    }

    if (p === '/api/logout' && req.method === 'POST') {
      delete DB.tokens[a.token];
      persist();
      return send(res, 200, JSON.stringify({ ok: true }));
    }

    return send(res, 404, JSON.stringify({ error: 'нет такого маршрута' }));
}

function serveStatic(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, JSON.stringify({ error: 'method' }));
    let file = decodeURIComponent(p);
    if (file === '/' || file === '') file = '/index.html';
    const full = path.normalize(path.join(ROOT, file));
    if (!full.startsWith(ROOT)) return send(res, 403, 'forbidden');
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      const spa = path.join(ROOT, 'index.html');
      return send(res, 200, fs.readFileSync(spa), { 'Content-Type': MIME['.html'] });
    }
    const ext = path.extname(full).toLowerCase();
    const isAsset = ext === '.png' || ext === '.svg' || ext === '.webmanifest';
    send(res, 200, fs.readFileSync(full), {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-cache',
    });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Touchline Liga: http://localhost:${PORT}`);
  console.log('логины: ArlPsg / MirBar / MeiRea');
});
