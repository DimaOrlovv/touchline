import { groupOf } from './coach.js';

export const TEAMS_ORDER = ['arsenal', 'barcelona', 'real_madrid'];

const PAIRS = [[0, 1], [1, 2], [0, 2]];

/** Календарь на N туров: в каждом туре одна пара играет, третья отдыхает. */
export function buildSchedule(keys = TEAMS_ORDER, rounds = 30) {
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    const idx = (r - 1) % 3;
    const cycle = Math.floor((r - 1) / 3);
    const [a, b] = PAIRS[idx];
    const swap = (cycle + idx) % 2 === 1;
    const home = keys[swap ? b : a];
    const away = keys[swap ? a : b];
    const bye = keys.find((k) => k !== home && k !== away);
    out.push({ round: r, home, away, bye, played: false, hs: null, as: null, seed: null, summary: null });
  }
  return out;
}

export function newLeague(keys = TEAMS_ORDER, rounds = 30, seed = Date.now() % 100000) {
  return {
    keys, rounds: buildSchedule(keys, rounds), seed,
    players: {}, injuries: {}, feedLog: [],
  };
}

const blank = () => ({
  apps: 0, starts: 0, goals: 0, assists: 0, mins: 0, yellow: 0, red: 0, fouls: 0,
  shots: 0, onTarget: 0, dribbles: 0, tackled: 0, tackles: 0, saves: 0, passes: 0, keyPasses: 0,
  ratingSum: 0, ratingN: 0, injured: 0,
});

export function playerStat(league, id) {
  if (!league.players[id]) league.players[id] = blank();
  return league.players[id];
}

export function ratingOf(p) {
  const base = 5.95 + (p.overall - 78) * 0.05;
  const r = base
    + p.goals * 0.9 + p.assists * 0.5 + p.keyPasses * 0.2 + p.dribbles * 0.12
    + p.tackles * 0.1 + p.saves * 0.22 + p.passes * 0.012 + p.shots * 0.04
    - p.fouls * 0.15 - (p.yellow ? 0.3 : 0) - (p.red ? 1.2 : 0)
    - (p.out && p.mins < 25 ? 0.4 : 0);
  return Math.round(Math.max(4.2, Math.min(9.6, r)) * 10) / 10;
}

export function avgRating(league, id) {
  const s = playerStat(league, id);
  return s.ratingN ? Math.round((s.ratingSum / s.ratingN) * 100) / 100 : null;
}

export function standings(league, squads) {
  const rows = league.keys.map((k) => ({
    key: k, name: squads[k].name, coach: squads[k].coach, played: 0, w: 0, d: 0, l: 0,
    gf: 0, ga: 0, pts: 0, form: [], gd: 0,
  }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  for (const rd of league.rounds) {
    if (!rd.played) continue;
    const h = byKey[rd.home], a = byKey[rd.away];
    h.played++; a.played++;
    h.gf += rd.hs; h.ga += rd.as; a.gf += rd.as; a.ga += rd.hs;
    if (rd.hs > rd.as) { h.w++; a.l++; h.pts += 3; a.pts += 0; h.form.push('W'); a.form.push('L'); }
    else if (rd.hs < rd.as) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W'); }
    else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
  }
  for (const r of rows) { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); }
  rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
  return rows;
}

/** Травмы: пропуск следующих туров. Счётчик уменьшается только у команд, сыгравших тур. */
export function tickInjuries(league, playedIds = null) {
  for (const id of Object.keys(league.injuries)) {
    if (playedIds && !playedIds.has(id)) continue;
    league.injuries[id] -= 1;
    if (league.injuries[id] <= 0) delete league.injuries[id];
  }
}

export function isOut(league, id) { return (league.injuries[id] || 0) > 0; }

/** XI тренера с учётом травм: выпавших заменяет ближайший по роли запасной. */
export function effectiveSquad(league, squad) {
  const injured = (p) => isOut(league, p.id);
  const starters = squad.starters.map((p) => ({ ...p }));
  const bench = squad.bench.map((p) => ({ ...p }));
  for (let i = 0; i < starters.length; i++) {
    if (!injured(starters[i])) continue;
    const role = starters[i].pos;
    const order = [role, ...nearRoles(role)];
    let replacement = null;
    for (const r of order) {
      replacement = bench.find((b) => !b.promoted && b.pos === r && !injured(b));
      if (replacement) break;
    }
    if (!replacement) replacement = bench.find((b) => !b.promoted && !injured(b));
    if (!replacement) continue;
    replacement.promoted = true;
    replacement.pos = role;
    const out = starters[i];
    starters[i] = replacement;
    bench[bench.indexOf(replacement)] = { ...out, promoted: false };
  }
  return { ...squad, starters, bench };
}

function nearRoles(role) {
  const g = groupOf(role);
  return {
    gk: ['LB', 'CB'],
    def: ['LB', 'RB', 'CB', 'CDM'],
    mid: ['CM', 'CAM', 'CDM', 'RW'],
    att: ['LW', 'RW', 'ST', 'CAM'],
  }[g] || [];
}

const SCORER_RE = /ГОЛ!?\s+([A-ZА-ЯЁ][\w'’À-ÿ.\- ]{2,28}?)\s/i;

export function applyResult(league, roundIdx, sim) {
  const rd = league.rounds[roundIdx];
  // сначала списываем прошлые травмы, иначе новая травма «сгорает» в этом же туре
  const playedIds = new Set([...sim.home.all, ...sim.away.all].map((p) => p.id));
  tickInjuries(league, playedIds);
  rd.played = true;
  rd.hs = sim.home.score;
  rd.as = sim.away.score;
  rd.seed = sim.seed;
  rd.stats = {
    home: teamLine(sim.home), away: teamLine(sim.away),
    poss: {
      home: Math.round(sim.possession.home / (sim.possession.home + sim.possession.away) * 100),
      away: Math.round(sim.possession.away / (sim.possession.home + sim.possession.away) * 100),
    },
  };
  rd.scorers = sim.events.filter((e) => e.type === 'goal').map((e) => ({ min: e.clock, player: e.scorer, team: e.teamKey, assist: e.assist || null }));

  const cards = [];
  for (const t of [sim.home, sim.away]) {
    for (const p of t.all) {
      const st = playerStat(league, p.id);
      const played = p.mins > 1 || p.onPitch;
      if (!played) continue;
      st.apps += 1;
      if (!p.cameOn) st.starts += 1;
      st.goals += p.goals; st.assists += p.assists; st.mins += Math.round(p.mins);
      st.shots += p.shots; st.dribbles += p.dribbles; st.tackles += p.tackles;
      st.saves += p.saves; st.passes += p.passes; st.keyPasses += p.keyPasses; st.fouls += p.fouls;
      st.yellow += p.yellow ? 1 : 0; st.red += p.red ? 1 : 0;
      if (p.yellow) cards.push({ player: p.name, team: t.key, kind: 'yellow', min: p.cardMin || null });
      if (p.red) cards.push({ player: p.name, team: t.key, kind: 'red', min: p.cardMin || null });
      const rt = ratingOf(p);
      st.ratingSum += rt; st.ratingN += 1;
      if (p.out && p.injuryLabel) {
        const rounds = p.injuryLabel === 'травма, не может продолжить' ? 1 + Math.floor(Math.random() * 3) : 0;
        if (rounds > 0) { league.injuries[p.id] = rounds; st.injured += 1; }
      }
    }
  }
  rd.cards = cards;
  const best = [...sim.home.all.map((p) => [p, sim.home.key]), ...sim.away.all.map((p) => [p, sim.away.key])]
    .filter(([p]) => p.mins > 20)
    .sort((a, b) => ratingOf(b[0]) - ratingOf(a[0]))[0];
  rd.mvp = best ? { player: best[0].name, team: best[1], rating: ratingOf(best[0]) } : null;
  return rd;
}

function teamLine(t) {
  return {
    shots: t.shots, sot: t.sot, corners: t.corners, fouls: t.fouls,
    offsides: t.offsides, yellow: t.yellows, red: t.reds, saves: t.saves, subs: t.subsUsed, presses: t.presses,
  };
}

export function topScorers(league, limit = 8, squads) {
  const nameOf = {};
  for (const k of Object.keys(squads)) for (const p of [...squads[k].starters, ...squads[k].bench]) nameOf[p.id] = { name: p.name, team: k };
  return Object.entries(league.players)
    .filter(([, s]) => s.goals > 0)
    .sort((a, b) => b[1].goals - a[1].goals || b[1].assists - a[1].assists)
    .slice(0, limit)
    .map(([id, s]) => ({ id, goals: s.goals, assists: s.assists, name: nameOf[id]?.name || id, team: nameOf[id]?.team }));
}
