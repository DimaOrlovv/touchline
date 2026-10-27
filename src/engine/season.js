import { groupOf } from './coach.js';

export const TEAMS_ORDER = [
  'psg', 'barcelona', 'real_madrid', 'arsenal', 'manchester_city',
  'bayern_munich', 'liverpool', 'chelsea', 'atletico_madrid', 'inter_milan',
];
export const HUMAN_KEYS = ['psg', 'barcelona', 'real_madrid'];

function singleRoundRobin(keys) {
  const n = keys.length;
  const arr = keys.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      let home = arr[i];
      let away = arr[n - 1 - i];
      if ((r + i) % 2 === 1) [home, away] = [away, home];
      pairs.push([home, away]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

/** Двойной круг: 18 туров по 5 матчей, каждый клуб играет 18 раз. */
export function buildSchedule(keys = TEAMS_ORDER, rounds = 18) {
  const single = singleRoundRobin(keys);
  const legs = Math.max(1, Math.ceil(rounds / single.length));
  const out = [];
  for (let leg = 0; leg < legs && out.length < rounds; leg++) {
    for (const pairs of single) {
      if (out.length >= rounds) break;
      const list = pairs.map(([home, away]) => (leg % 2 === 1 ? [away, home] : [home, away]));
      out.push({
        round: out.length + 1,
        matches: list.map(([home, away], mi) => ({
          id: `${out.length + 1}-${mi + 1}`,
          home, away, played: false,
          hs: null, as: null, seed: null, summary: null, snapshot: null,
        })),
      });
    }
  }
  return out;
}

export function newLeague(keys = TEAMS_ORDER, rounds = 18, seed = Date.now() % 100000) {
  return {
    keys, rounds: buildSchedule(keys, rounds), seed,
    players: {}, injuries: {}, suspensions: {}, feedLog: [],
  };
}

export const roundComplete = (rd) => rd.matches.every((m) => m.played);

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
    for (const m of rd.matches) {
      if (!m.played) continue;
      const h = byKey[m.home], a = byKey[m.away];
      h.played++; a.played++;
      h.gf += m.hs; h.ga += m.as; a.gf += m.as; a.ga += m.hs;
      if (m.hs > m.as) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
      else if (m.hs < m.as) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W'); }
      else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
    }
  }
  for (const r of rows) { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); }
  rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
  return rows;
}

/**
 * Счётчики пропусков уменьшаются только у команд, сыгравших тур.
 * Сравниваем по клубу, а не по составу на матч: травмированных в заявке нет.
 */
function tickCounter(counter, playedTeams = null, teamOf = null) {
  for (const id of Object.keys(counter)) {
    if (playedTeams && teamOf) {
      const owner = teamOf.get(id);
      if (owner && !playedTeams.has(owner)) continue;
    }
    counter[id] -= 1;
    if (counter[id] <= 0) delete counter[id];
  }
}

export function tickInjuries(league, playedTeams = null, teamOf = null) {
  tickCounter(league.injuries, playedTeams, teamOf);
}

export function tickSuspensions(league, playedTeams = null, teamOf = null) {
  if (!league.suspensions) league.suspensions = {};
  tickCounter(league.suspensions, playedTeams, teamOf);
}

export function isOut(league, id) { return (league.injuries[id] || 0) > 0; }
export function isSuspended(league, id) { return (league.suspensions?.[id] || 0) > 0; }
export function isUnavailable(league, id) { return isOut(league, id) || isSuspended(league, id); }

export function teamOwnership(squads) {
  const map = new Map();
  if (!squads) return map;
  for (const k of Object.keys(squads)) {
    for (const p of [...squads[k].starters, ...squads[k].bench]) map.set(p.id, k);
  }
  return map;
}

/** XI тренера с учётом травм и дисквалификаций: выпавших заменяет ближайший по роли запасной. */
export function effectiveSquad(league, squad) {
  const injured = (p) => isUnavailable(league, p.id);
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

export function applyResult(league, roundIdx, matchIdx, sim, squads = null) {
  const rd = league.rounds[roundIdx];
  const m = rd.matches[matchIdx];
  // сначала списываем прошлые травмы и дисквалификации по клубам, игравшим тур
  const playedTeams = new Set([sim.home.key, sim.away.key]);
  const teamOf = teamOwnership(squads);
  tickInjuries(league, playedTeams, teamOf);
  tickSuspensions(league, playedTeams, teamOf);
  m.played = true;
  m.hs = sim.home.score;
  m.as = sim.away.score;
  m.seed = sim.seed;
  m.stats = {
    home: teamLine(sim.home), away: teamLine(sim.away),
    poss: {
      home: Math.round(sim.possession.home / (sim.possession.home + sim.possession.away) * 100),
      away: Math.round(sim.possession.away / (sim.possession.home + sim.possession.away) * 100),
    },
  };
  m.scorers = sim.events.filter((e) => e.type === 'goal').map((e) => ({ min: e.clock, player: e.scorer, team: e.teamKey, assist: e.assist || null }));

  const cards = [];
  for (const t of [sim.home, sim.away]) {
    for (const p of t.all) {
      const st = playerStat(league, p.id);
      const played = p.mins > 1 || p.onPitch || p.sentOff;
      if (!played) continue;
      st.apps += 1;
      if (!p.cameOn) st.starts += 1;
      st.goals += p.goals; st.assists += p.assists; st.mins += Math.round(p.mins);
      st.shots += p.shots; st.dribbles += p.dribbles; st.tackles += p.tackles;
      st.saves += p.saves; st.passes += p.passes; st.keyPasses += p.keyPasses; st.fouls += p.fouls;
      st.yellow += p.yellow ? 1 : 0; st.red += p.red ? 1 : 0;
      if (p.yellow) cards.push({ player: p.name, team: t.key, kind: 'yellow', min: p.cardMin || null });
      if (p.red) {
        cards.push({ player: p.name, team: t.key, kind: 'red', min: p.cardMin || null });
        league.suspensions[p.id] = Math.max(league.suspensions[p.id] || 0, 1);
      }
      const rt = ratingOf(p);
      st.ratingSum += rt; st.ratingN += 1;
      if (p.out && p.injuryLabel) {
        const rounds = p.injuryLabel === 'травма, не может продолжить' ? 1 + Math.floor(Math.random() * 3) : 0;
        if (rounds > 0) {
          league.injuries[p.id] = Math.max(league.injuries[p.id] || 0, rounds);
          st.injured += 1;
        }
      }
    }
  }
  m.cards = cards;
  const best = [...sim.home.all.map((p) => [p, sim.home.key]), ...sim.away.all.map((p) => [p, sim.away.key])]
    .filter(([p]) => p.mins > 20)
    .sort((a, b) => ratingOf(b[0]) - ratingOf(a[0]))[0];
  m.mvp = best ? { player: best[0].name, team: best[1], rating: ratingOf(best[0]) } : null;
  return m;
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
