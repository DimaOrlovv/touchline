import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MatchSim } from './src/engine/match.js';
import {
  newLeague, applyResult, effectiveSquad, standings, isUnavailable, teamLine, ratingOf,
  TEAMS_ORDER, HUMAN_KEYS, DIVISIONS, divisionOf, cupGroupTable, cupMatches, cupFindMatch,
  cupDueMatches, cupDueRound, newSeason,
} from './src/engine/season.js';
import { DEFAULT_STYLES, styleOf } from './src/engine/styles.js';
import { Rng } from './src/engine/util.js';

const PORT = Number(process.env.PORT || 8137);
const ROOT = path.resolve('.');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'league.json');
const SQUADS_FILE = path.join(ROOT, 'src', 'data', 'squads.json');
const DB_VERSION = 4;

// Облачное хранилище сезона на бесплатном Upstash Redis (REST).
// Если переменные не заданы — работает локальный файл.
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = process.env.DB_KEY || 'touchline:league';
const remoteEnabled = !!(REDIS_URL && REDIS_TOKEN);

const MATCH_MINUTES = Number(process.env.MATCH_MINUTES || 4);   // реальная длительность матча
const HALFTIME_MS = Number(process.env.HALFTIME_SECONDS || 30) * 1000;
const MS_PER_SIM_MIN = (MATCH_MINUTES * 60000) / 93;
const LOGINS = { arlpsg: 'psg', mirbar: 'barcelona', meirea: 'real_madrid' };

const SQUADS = JSON.parse(fs.readFileSync(SQUADS_FILE, 'utf8'));
const squadsByKey = Object.fromEntries(SQUADS.teams.map((t) => [t.key, t]));

function blankLineups() {
  const out = {};
  for (const t of SQUADS.teams) out[t.key] = { slots: t.starters.map((p) => ({ id: p.id, pos: p.pos })) };
  return out;
}

function coerceDb(raw) {
  if (raw?.version === DB_VERSION && raw?.league?.rounds?.[0]?.matches && raw?.league?.divisions?.length) {
    const league = raw.league;
    if (!league.suspensions) league.suspensions = {};
    if (!league.cup) league.cup = newLeague(DIVISIONS, 18, league.seed, league.season).cup;
    return {
      league,
      lineups: { ...blankLineups(), ...(raw.lineups || {}) },
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

function migrateOld(raw) {
  const tokens = { ...(raw?.tokens || {}) };
  for (const [tok, key] of Object.entries(tokens)) if (key === 'arsenal') tokens[tok] = 'psg';
  const oldStyles = raw?.styles || {};
  if (oldStyles.arsenal && !oldStyles.psg) oldStyles.psg = oldStyles.arsenal;
  const styles = { ...DEFAULT_STYLES };
  for (const k of Object.keys(styles)) if (oldStyles[k]) styles[k] = oldStyles[k];
  const lineups = blankLineups();
  for (const [k, v] of Object.entries(raw?.lineups || {})) {
    const key = k === 'arsenal' ? 'psg' : k;
    if (lineups[key] && v?.slots?.length === 11) lineups[key] = v;
  }
  console.log('старая лига заменена на два дивизиона, входы, составы и стили сохранены');
  return { league: newLeague(DIVISIONS, 18, Date.now() % 100000, 1), lineups, tokens, styles };
}

async function load() {
  const cloudRaw = await remoteGet();
  if (cloudRaw) {
    const ok = coerceDb(cloudRaw);
    if (ok) {
      console.log('сезон загружен из облака (Upstash)');
      return ok;
    }
    return migrateOld(cloudRaw);
  }
  try {
    const fileRaw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const ok = coerceDb(fileRaw);
    if (ok) {
      console.log('сезон загружен из файла');
      return ok;
    }
    return migrateOld(fileRaw);
  } catch (e) { /* первый запуск */ }
  return {
    league: newLeague(DIVISIONS, 18, Date.now() % 100000, 1),
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
function nextRoundIdx() {
  return DB.league.rounds.findIndex((rd) => {
    if (rd.matches.some((m) => !m.played)) return true;
    return cupDueMatches(DB.league.cup, rd.round).some((m) => !m.played);
  });
}

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
  return {
    ...eff,
    starters: eff.starters.filter((p) => !isUnavailable(DB.league, p.id)),
    bench: eff.bench.filter((p) => !isUnavailable(DB.league, p.id) && !p.promoted),
  };
}

const cupMatchLight = (m) => {
  const l = lives.get(`cup:${m.id}`);
  return {
    id: m.id, stage: m.stage, group: m.group || null, round: m.round || null,
    dueRound: cupDueRound(DB.league.cup, m),
    home: m.home, away: m.away, played: m.played, hs: m.hs, as: m.as, pens: m.pens || null,
    live: l ? l.status : null, liveScore: l ? l.score : null,
    summary: m.played ? {
      scorers: m.scorers || [], stats: m.stats || null, cards: m.cards || [], mvp: m.mvp || null,
    } : null,
  };
};

function cupState() {
  const c = DB.league.cup;
  return {
    name: c.name, stage: c.stage, winner: c.winner || null,
    groups: c.groups.map((g) => ({
      key: g.key, teams: g.teams,
      table: cupGroupTable(g, squadsByKey),
      matches: g.matches.map(cupMatchLight),
    })),
    knockout: {
      qf: c.knockout.qf.map(cupMatchLight),
      sf: c.knockout.sf.map(cupMatchLight),
      final: c.knockout.final.map(cupMatchLight),
    },
  };
}

function publicState(teamKey, full = true) {
  const league = DB.league;
  const idx = nextRoundIdx();
  const div = divisionOf(league, teamKey);
  const divisions = league.divisions.map((d) => ({
    key: d.key, name: d.name, teams: d.teams,
    table: standings(league, squadsByKey, d.key),
  }));
  return {
    account: teamKey || null,
    season: league.season || 1,
    divisionKey: div?.key || 'd1',
    divisionName: div?.name || '',
    seasonEnded: idx === -1,
    teams: SQUADS.teams.map((t) => ({
      key: t.key, name: t.name, coach: t.coach, avg: t.avg_starters,
      human: HUMAN_KEYS.includes(t.key), division: divisionOf(league, t.key)?.key || null,
    })),
    divisions,
    table: standings(league, squadsByKey, div?.key || 'd1'),
    rounds: league.rounds.map((rd, rIdx) => ({
      round: rd.round,
      matches: rd.matches.map((m, mIdx) => {
        const l = lives.get(matchKey(rIdx, mIdx));
        return {
          id: m.id, div: m.div, home: m.home, away: m.away, played: m.played, hs: m.hs, as: m.as,
          live: l ? l.status : null,
          liveScore: l ? l.score : null,
          summary: m.played ? {
            scorers: m.scorers || [], stats: m.stats || null, cards: m.cards || [], mvp: m.mvp || null,
          } : null,
        };
      }),
    })),
    roundIdx: idx,
    cup: cupState(),
    styles: { ...DB.styles },
    squad: squadPayload(teamKey),
    ...(full ? {
      lineups: DB.lineups,
      squads: Object.fromEntries(SQUADS_ORDER_KEYS.map((k) => [k, squadPayload(k)])),
    } : {}),
    injuries: league.injuries,
    suspensions: league.suspensions || {},
    playerStats: league.players,
    live: liveViewFor(teamKey),
    serverTime: Date.now(),
  };
}

const SQUADS_ORDER_KEYS = SQUADS.teams.map((t) => t.key);

const CLIENT_FIELDS = [
  'id', 'name', 'pos', 'role', 'captain', 'age', 'nationality', 'overall',
  'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality', 'power_stamina',
  'attacking_finishing', 'mentality_vision', 'skill_long_passing', 'skill_ball_control',
  'power_strength', 'defending_awareness', 'mentality_aggression', 'mentality_composure',
  'goalkeeping_reflexes', 'goalkeeping_diving', 'goalkeeping_positioning',
  'attacking_short_passing', 'power_jumping',
];
const clientPlayer = (p, extra = {}) => {
  const out = {};
  for (const k of CLIENT_FIELDS) if (p[k] !== undefined) out[k] = p[k];
  return { ...out, ...extra };
};

function squadPayload(key) {
  if (!key) return null;
  const s = squadFor(key);
  const eff = effectiveSquad(DB.league, s);
  const flags = (p) => ({ injured: !!DB.league.injuries[p.id], suspended: !!(DB.league.suspensions?.[p.id]) });
  return {
    key, name: s.name, coach: s.coach, formation: s.formation,
    starters: eff.starters.map((p) => clientPlayer(p, flags(p))),
    bench: eff.bench.map((p) => clientPlayer(p, flags(p))),
    raw: { starters: s.starters.map((p) => clientPlayer(p)), bench: s.bench.map((p) => clientPlayer(p)) },
  };
}

const lives = new Map();
const matchKey = (rIdx, mIdx) => `${rIdx}:${mIdx}`;

function liveView(l) {
  if (!l) return null;
  return {
    key: l.key, comp: l.comp || 'league', matchId: l.matchId || null, cupId: l.cupId || null,
    roundIdx: l.roundIdx, matchIdx: l.matchIdx, round: l.round,
    home: l.home, away: l.away,
    status: l.status, ready: l.ready, events: l.events,
    score: l.score, startedAt: l.startedAt, endedAt: l.endedAt,
    breakUntil: l.breakUntil || null,
    half: l.sim?.half || 1,
    styles: l.sim
      ? { [l.home]: l.sim.home.coach.styleId, [l.away]: l.sim.away.coach.styleId }
      : { [l.home]: DB.styles[l.home], [l.away]: DB.styles[l.away] },
  };
}

function liveViewFor(teamKey) {
  if (!teamKey) return null;
  let finished = null;
  for (const l of lives.values()) {
    if (l.home !== teamKey && l.away !== teamKey) continue;
    if (l.status !== 'done') return liveView(l);
    finished = l;
  }
  return finished ? liveView(finished) : null;
}

function broadcastLiveFor(l) {
  if (!l) return;
  for (const res of clients) {
    if (res.__team === l.home || res.__team === l.away) {
      try { res.write(`event: live\ndata: ${JSON.stringify(liveView(l))}\n\n`); } catch (e) { /* ignore */ }
    }
  }
}

function broadcastToMatch(l, type, data) {
  if (!l) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    if (res.__team === l.home || res.__team === l.away) {
      try { res.write(payload); } catch (e) { /* ignore */ }
    }
  }
}

function broadcastAllLive() {
  for (const res of clients) {
    try { res.write(`event: live\ndata: ${JSON.stringify(liveViewFor(res.__team))}\n\n`); } catch (e) { /* ignore */ }
  }
}

const clients = new Set();

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch (e) { /* клиент отвалился */ } }
}

function broadcastState() {
  for (const res of clients) {
    const teamKey = res.__team;
    try { res.write(`event: state\ndata: ${JSON.stringify(publicState(teamKey, false))}\n\n`); } catch (e) { /* ignore */ }
  }
}

// ---- жизненный цикл матчей -------------------------------------------------
const isHuman = (key) => HUMAN_KEYS.includes(key);

function snapSquad(sq) {
  return {
    starters: sq.starters.map((p) => ({ id: p.id, pos: p.pos })),
    bench: sq.bench.map((p) => ({ id: p.id, pos: p.pos })),
  };
}

function rebuildSquad(snap, base) {
  const all = new Map([...base.starters, ...base.bench].map((p) => [p.id, p]));
  const take = (arr) => arr.map((s) => {
    const p = all.get(s.id);
    return p ? { ...p, pos: s.pos, role: s.pos } : null;
  }).filter(Boolean);
  return { ...base, starters: take(snap.starters), bench: take(snap.bench) };
}

function prepareFixture(rIdx, mIdx) {
  const rd = DB.league.rounds[rIdx];
  const m = rd.matches[mIdx];
  const homeSquad = matchSquad(m.home);
  const awaySquad = matchSquad(m.away);
  const styles = { [m.home]: DB.styles[m.home], [m.away]: DB.styles[m.away] };
  const seed = (rd.round * 7919 + mIdx * 104729 + DB.league.seed) % 100000;
  m.seed = seed;
  m.snapshot = { home: snapSquad(homeSquad), away: snapSquad(awaySquad), styles };
  return { rd, m, homeSquad, awaySquad, styles, seed };
}

/** Бот-бот матчи не ждут тренеров: считаем мгновенно, события доступны в повторе. */
function simulateBotMatch(rIdx, mIdx) {
  const { m, homeSquad, awaySquad, styles, seed } = prepareFixture(rIdx, mIdx);
  const sim = new MatchSim({
    homeKey: m.home, awayKey: m.away,
    squads: { [m.home]: homeSquad, [m.away]: awaySquad },
    seed, styles,
  });
  sim.runAll();
  applyResult(DB.league, rIdx, mIdx, sim, squadsByKey);
}

const hashId = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 100000, 7);

function simSummary(sim) {
  const total = sim.possession.home + sim.possession.away || 1;
  const stats = {
    home: teamLine(sim.home), away: teamLine(sim.away),
    poss: {
      home: Math.round(sim.possession.home / total * 100),
      away: Math.round(sim.possession.away / total * 100),
    },
  };
  const scorers = sim.events.filter((e) => e.type === 'goal')
    .map((e) => ({ min: e.clock, player: e.scorer, team: e.teamKey, assist: e.assist || null }));
  const cards = [];
  for (const t of [sim.home, sim.away]) {
    for (const p of t.all) {
      if (p.yellow) cards.push({ player: p.name, team: t.key, kind: 'yellow', min: p.cardMin || null });
      if (p.red) cards.push({ player: p.name, team: t.key, kind: 'red', min: p.cardMin || null });
    }
  }
  const best = [...sim.home.all.map((p) => [p, sim.home.key]), ...sim.away.all.map((p) => [p, sim.away.key])]
    .filter(([p]) => p.mins > 20)
    .sort((a, b) => ratingOf(b[0]) - ratingOf(a[0]))[0];
  return { stats, scorers, cards, mvp: best ? { player: best[0].name, team: best[1], rating: ratingOf(best[0]) } : null };
}

function makeSimFor(m) {
  const homeSquad = matchSquad(m.home);
  const awaySquad = matchSquad(m.away);
  const styles = { [m.home]: DB.styles[m.home], [m.away]: DB.styles[m.away] };
  const seed = (hashId(m.id) + DB.league.seed + (DB.league.season || 1) * 104729) % 100000;
  m.seed = seed;
  m.snapshot = { home: snapSquad(homeSquad), away: snapSquad(awaySquad), styles };
  return new MatchSim({
    homeKey: m.home, awayKey: m.away,
    squads: { [m.home]: homeSquad, [m.away]: awaySquad },
    seed, styles,
  });
}

function applyCupSim(m, sim) {
  const sum = simSummary(sim);
  m.played = true;
  m.hs = sim.home.score;
  m.as = sim.away.score;
  m.stats = sum.stats;
  m.scorers = sum.scorers;
  m.cards = sum.cards;
  m.mvp = sum.mvp;
  m.pens = null;
  if (m.stage !== 'group' && m.hs === m.as) {
    const rng = new Rng(m.seed + 7777);
    let h = 0, a = 0;
    for (let i = 0; i < 5; i++) { if (rng.chance(0.76)) h++; if (rng.chance(0.76)) a++; }
    for (let i = 0; i < 20 && h === a; i++) { if (rng.chance(0.76)) h++; if (rng.chance(0.76)) a++; }
    if (h === a) { if (rng.chance(0.5)) h++; else a++; }
    m.pens = [h, a];
  }
}

function simulateCupBotMatch(m) {
  if (isHuman(m.home) || isHuman(m.away)) return false;
  const sim = makeSimFor(m);
  sim.runAll();
  applyCupSim(m, sim);
  return true;
}

const cupWinner = (m) => {
  if (!m || !m.played) return null;
  if (m.pens) return m.pens[0] > m.pens[1] ? m.home : m.away;
  return m.hs > m.as ? m.home : m.away;
};

function buildCupQf() {
  const cup = DB.league.cup;
  if (cup.knockout.qf.length) return;
  if (!cup.groups.every((g) => g.matches.every((m) => m.played))) return;
  const [A, B, C, D] = cup.groups.map((g) => cupGroupTable(g, squadsByKey));
  const pairs = [[A[0], B[1]], [C[0], D[1]], [B[0], A[1]], [D[0], C[1]]];
  cup.knockout.qf = pairs.map(([h, a], i) => ({
    id: `cup-qf-${i + 1}`, stage: 'qf', home: h.key, away: a.key,
    dueRound: cup.schedule.qfAt,
    played: false, hs: null, as: null, pens: null, seed: null, snapshot: null,
  }));
  cup.stage = 'qf';
}

function buildCupSf() {
  const cup = DB.league.cup;
  cup.knockout.sf = [[0, 1], [2, 3]].map(([x, y], i) => ({
    id: `cup-sf-${i + 1}`, stage: 'sf',
    home: cupWinner(cup.knockout.qf[x]), away: cupWinner(cup.knockout.qf[y]),
    dueRound: cup.schedule.sfAt,
    played: false, hs: null, as: null, pens: null, seed: null, snapshot: null,
  }));
  cup.stage = 'sf';
}

function buildCupFinal() {
  const cup = DB.league.cup;
  cup.knockout.final = [{
    id: 'cup-final', stage: 'final',
    home: cupWinner(cup.knockout.sf[0]), away: cupWinner(cup.knockout.sf[1]),
    dueRound: cup.schedule.finalAt,
    played: false, hs: null, as: null, pens: null, seed: null, snapshot: null,
  }];
  cup.stage = 'final';
}

function syncCupStage() {
  const cup = DB.league.cup;
  let changed = false;
  if (!cup.knockout.qf.length && cup.groups.every((g) => g.matches.every((m) => m.played))) {
    buildCupQf();
    changed = true;
  }
  if (cup.knockout.qf.length && cup.knockout.qf.every((m) => m.played) && !cup.knockout.sf.length) {
    buildCupSf();
    changed = true;
  }
  if (cup.knockout.sf.length && cup.knockout.sf.every((m) => m.played) && !cup.knockout.final.length) {
    buildCupFinal();
    changed = true;
  }
  if (cup.knockout.final.length && cup.knockout.final[0].played && cup.stage !== 'done') {
    cup.winner = cupWinner(cup.knockout.final[0]);
    cup.stage = 'done';
    changed = true;
  }
  return changed;
}

function roundHasUnplayed(rIdx) {
  const rd = DB.league.rounds[rIdx];
  if (!rd) return false;
  if (rd.matches.some((m) => !m.played)) return true;
  return cupDueMatches(DB.league.cup, rd.round).some((m) => !m.played);
}

function ensureRound() {
  for (let guard = 0; guard < 30; guard++) {
    const rIdx = nextRoundIdx();
    if (rIdx < 0) return false;
    const rd = DB.league.rounds[rIdx];
    let changed = false;
    for (let mIdx = 0; mIdx < rd.matches.length; mIdx++) {
      const m = rd.matches[mIdx];
      if (m.played) continue;
      if (!isHuman(m.home) && !isHuman(m.away) && !lives.has(matchKey(rIdx, mIdx))) {
        simulateBotMatch(rIdx, mIdx);
        changed = true;
      }
    }
    for (const m of cupDueMatches(DB.league.cup, rd.round)) {
      if (m.played || lives.has(`cup:${m.id}`)) continue;
      if (!isHuman(m.home) && !isHuman(m.away)) {
        simulateCupBotMatch(m);
        changed = true;
      }
    }
    if (syncCupStage()) changed = true;
    if (changed) { persist(); broadcastState(); }
    if (!roundHasUnplayed(rIdx)) continue;
    return changed;
  }
  return false;
}

const cupLiveKey = (id) => `cup:${id}`;

function fixtureForLive(l) {
  if (l.comp === 'cup') return cupFindMatch(DB.league.cup, l.cupId);
  return DB.league.rounds[l.roundIdx]?.matches[l.matchIdx] || null;
}

function markReady(teamKey, roundIdx, matchId) {
  ensureRound();
  const idx = nextRoundIdx();
  if (idx === -1) return { error: 'Сезон завершён' };
  if (roundIdx != null && roundIdx !== idx) return { error: 'Тур уже изменился' };
  const rd = DB.league.rounds[idx];
  let m = null, comp = 'league', mIdx = -1, cupId = null;

  if (matchId && String(matchId).startsWith('cup-')) {
    m = cupFindMatch(DB.league.cup, matchId);
    if (!m || m.played) return { error: 'Матч Кубка недоступен' };
    if (cupDueRound(DB.league.cup, m) !== rd.round) return { error: 'Этот матч Кубка ещё не сейчас' };
    if (m.home !== teamKey && m.away !== teamKey) return { error: 'Ваша команда не играет этот матч' };
    comp = 'cup';
    cupId = m.id;
  } else {
    mIdx = matchId
      ? rd.matches.findIndex((x) => x.id === matchId)
      : rd.matches.findIndex((x) => x.home === teamKey || x.away === teamKey);
    if (mIdx < 0) return { error: 'Ваша команда не играет этот тур' };
    m = rd.matches[mIdx];
    if (m.played) return { error: 'Матч уже сыгран' };
    if (m.home !== teamKey && m.away !== teamKey) return { error: 'Ваша команда не играет этот тур' };
  }

  const key = comp === 'cup' ? cupLiveKey(m.id) : matchKey(idx, mIdx);
  const existing = [...lives.values()]
    .find((l) => l.status !== 'done' && (l.home === teamKey || l.away === teamKey) && l.key !== key);
  if (existing) return { error: 'Сначала завершите текущий матч' };

  let l = lives.get(key);
  if (!l) {
    l = {
      key, comp, cupId, matchId: m.id, roundIdx: idx, matchIdx: mIdx, round: rd.round,
      home: m.home, away: m.away,
      status: 'waiting',
      ready: { [m.home]: !isHuman(m.home), [m.away]: !isHuman(m.away) },
      events: [], score: [0, 0], sim: null, timer: null,
      startedAt: null, endedAt: null, breakUntil: null,
    };
    lives.set(key, l);
  }
  l.ready[teamKey] = true;
  if (l.ready[m.home] && l.ready[m.away] && l.status === 'waiting') startMatch(l);
  else { broadcastLiveFor(l); broadcastState(); }
  return { ok: true, live: liveView(l) };
}

function startMatch(l) {
  const m = fixtureForLive(l);
  if (!m) return;
  l.matchId = m.id;
  l.sim = makeSimFor(m);
  l.status = 'running';
  l.startedAt = Date.now();
  persist();
  broadcastLiveFor(l);
  broadcastState();
  pump(l.key);
}

function pump(key) {
  const l = lives.get(key);
  if (!l || l.status !== 'running') return;
  let ev;
  try {
    ev = l.sim.tick();
  } catch (err) {
    console.error('симуляция упала', err);
    finishMatch(l, true);
    return;
  }
  if (!ev) { finishMatch(l, true); return; }
  const light = {
    id: ev.id, clock: ev.clock, type: ev.type, teamKey: ev.teamKey, text: ev.text,
    score: ev.score, scorer: ev.scorer, assist: ev.assist, player: ev.player,
    in: ev.in, out: ev.out, reason: ev.reason, serious: ev.serious,
    style: ev.style, styleName: ev.styleName,
  };
  l.events.push(light);
  l.score = ev.score;
  broadcastToMatch(l, 'event', light);
  if (ev.type === 'ht') {
    l.status = 'halftime';
    l.breakUntil = Date.now() + HALFTIME_MS;
    clearTimeout(l.timer);
    l.timer = setTimeout(() => resumeSecondHalf(key), HALFTIME_MS);
    broadcastLiveFor(l);
    broadcastState();
    return;
  }
  let delay = Math.min(4200, Math.max(90, (ev.dur || 0.3) * MS_PER_SIM_MIN));
  if (ev.type === 'goal') delay += 1400;
  if (ev.type === 'ft' || ev.type === 'red') delay += 900;
  l.timer = setTimeout(() => pump(key), delay);
}

function resumeSecondHalf(key) {
  const l = lives.get(key);
  if (!l || l.status !== 'halftime') return;
  l.status = 'running';
  l.breakUntil = null;
  broadcastLiveFor(l);
  pump(key);
}

function finishMatch(l, commit) {
  clearTimeout(l.timer);
  const sim = l.sim;
  l.status = 'done';
  l.breakUntil = null;
  l.endedAt = Date.now();
  let summary = null;
  if (commit && sim) {
    const m = fixtureForLive(l);
    if (m && !m.played) {
      if (l.comp === 'cup') {
        applyCupSim(m, sim);
        syncCupStage();
        persist();
      } else {
        applyResult(DB.league, l.roundIdx, l.matchIdx, sim, squadsByKey);
        persist();
      }
      summary = { round: l.round, home: l.home, away: l.away, hs: m.hs, as: m.as };
    }
  }
  broadcastToMatch(l, 'match_end', { live: liveView(l), summary });
  broadcastState();
  setTimeout(() => {
    const cur = lives.get(l.key);
    if (cur === l && cur.status === 'done') {
      lives.delete(l.key);
      broadcastAllLive();
      broadcastState();
    }
  }, 9000);
  ensureRound();
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
      res.write(`event: live\ndata: ${JSON.stringify(liveViewFor(a.team))}\n\n`);
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
      const { roundIdx, matchId } = await readBody(req);
      const r = markReady(team, roundIdx, matchId);
      if (r.error) return send(res, 400, JSON.stringify(r));
      return send(res, 200, JSON.stringify(r));
    }

    if (p === '/api/replay') {
      const u = new URL(req.url, 'http://x');
      const rIdx = Number(u.searchParams.get('r'));
      const mIdx = Number(u.searchParams.get('m'));
      const rd = DB.league.rounds[rIdx];
      const m = rd?.matches?.[mIdx];
      if (!m) return send(res, 400, JSON.stringify({ error: 'Матч не найден' }));
      const l = lives.get(matchKey(rIdx, mIdx));
      if (l && l.status !== 'done') return send(res, 409, JSON.stringify({ error: 'Матч ещё идёт' }));
      if (!m.played || !m.snapshot || !m.seed) return send(res, 400, JSON.stringify({ error: 'Запись недоступна' }));
      const squads = {
        [m.home]: rebuildSquad(m.snapshot.home, squadsByKey[m.home]),
        [m.away]: rebuildSquad(m.snapshot.away, squadsByKey[m.away]),
      };
      const sim = new MatchSim({
        homeKey: m.home, awayKey: m.away, squads,
        seed: m.seed, styles: m.snapshot.styles || {},
      });
      sim.runAll();
      return send(res, 200, JSON.stringify({
        round: rd.round, home: m.home, away: m.away, hs: m.hs, as: m.as,
        events: sim.events, stats: m.stats, scorers: m.scorers || [], cards: m.cards || [], mvp: m.mvp || null,
      }));
    }

    if (p === '/api/cup/replay') {
      const u = new URL(req.url, 'http://x');
      const m = cupFindMatch(DB.league.cup, u.searchParams.get('id'));
      if (!m || !m.played || !m.snapshot || !m.seed) return send(res, 400, JSON.stringify({ error: 'Запись недоступна' }));
      const squads = {
        [m.home]: rebuildSquad(m.snapshot.home, squadsByKey[m.home]),
        [m.away]: rebuildSquad(m.snapshot.away, squadsByKey[m.away]),
      };
      const sim = new MatchSim({
        homeKey: m.home, awayKey: m.away, squads,
        seed: m.seed, styles: m.snapshot.styles || {},
      });
      sim.runAll();
      const label = m.stage === 'group' ? `Группа ${m.group} · тур ${m.round}`
        : m.stage === 'qf' ? '1/4 финала' : m.stage === 'sf' ? '1/2 финала' : 'Финал';
      return send(res, 200, JSON.stringify({
        title: `Кубок · ${label}`, home: m.home, away: m.away, hs: m.hs, as: m.as, pens: m.pens || null,
        events: sim.events, stats: m.stats, scorers: m.scorers || [], cards: m.cards || [], mvp: m.mvp || null,
      }));
    }

    if (p === '/api/newseason' && req.method === 'POST') {
      if (nextRoundIdx() !== -1) return send(res, 400, JSON.stringify({ error: 'Сначала доиграйте сезон' }));
      const result = newSeason(DB.league, squadsByKey);
      for (const l of lives.values()) clearTimeout(l.timer);
      lives.clear();
      DB.league = result.league;
      persist();
      broadcastAllLive();
      ensureRound();
      broadcastState();
      return send(res, 200, JSON.stringify({
        ok: true, season: DB.league.season,
        promoted: result.promoted, relegated: result.relegated,
        divisionKey: divisionOf(DB.league, team)?.key || null,
      }));
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
      const bad = slots.map((s) => findPlayer(team, s.id)).find((p) => p && isUnavailable(DB.league, p.id));
      if (bad) return send(res, 400, JSON.stringify({ error: `${bad.name} недоступен: травма или дисквалификация` }));
      DB.lineups[team] = { slots: slots.map((s) => ({ id: s.id, pos: s.pos })) };
      persist();
      broadcastState();
      return send(res, 200, JSON.stringify({ ok: true }));
    }

    if (p === '/api/style' && req.method === 'POST') {
      const { styleId } = await readBody(req);
      if (styleOf(styleId).id !== styleId) return send(res, 400, JSON.stringify({ error: 'Неизвестный стиль' }));
      const active = [...lives.values()]
        .find((l) => (l.home === team || l.away === team) && l.status !== 'done') || null;
      if (active && active.status === 'running') {
        return send(res, 400, JSON.stringify({ error: 'Стиль меняется до матча или в перерыве' }));
      }
      DB.styles[team] = styleId;
      if (active?.sim && active.status === 'halftime') {
        active.sim.setStyle(team, styleId);
        const m = fixtureForLive(active);
        if (m?.snapshot?.styles) m.snapshot.styles[team] = styleId;
      }
      persist();
      if (active) broadcastLiveFor(active);
      broadcastState();
      return send(res, 200, JSON.stringify({ ok: true, styleId }));
    }

    if (p === '/api/reset' && req.method === 'POST') {
      for (const l of lives.values()) clearTimeout(l.timer);
      lives.clear();
      DB.league = newLeague(DIVISIONS, 18, Date.now() % 100000, 1);
      DB.lineups = blankLineups();
      persist();
      broadcastAllLive();
      ensureRound();
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

syncCupStage();
ensureRound();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Touchline Liga: http://localhost:${PORT}`);
  console.log('логины: ArlPsg / MirBar / MeiRea');
  console.log('тур:', nextRoundIdx() + 1, '| клубов:', TEAMS_ORDER.length);
});
