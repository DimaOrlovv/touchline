import { groupOf } from './coach.js';
import { Rng } from './util.js';

export const DIVISIONS = [
  {
    key: 'd1', name: 'Высшая лига',
    teams: ['psg', 'barcelona', 'real_madrid', 'arsenal', 'manchester_city',
      'bayern_munich', 'liverpool', 'chelsea', 'atletico_madrid', 'inter_milan'],
  },
  {
    key: 'd2', name: 'Первая лига',
    teams: ['napoli', 'juventus', 'borussia_dortmund', 'bayer_leverkusen', 'ac_milan',
      'roma', 'sevilla', 'villarreal', 'newcastle', 'aston_villa'],
  },
];
export const TEAMS_ORDER = DIVISIONS.flatMap((d) => d.teams);
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

export function buildLeagueRounds(divisions, rounds = 18) {
  const schedules = divisions.map((d) => ({ div: d.key, rounds: buildSchedule(d.teams, rounds) }));
  return Array.from({ length: rounds }, (_, ri) => ({
    round: ri + 1,
    matches: schedules.flatMap((s) => s.rounds[ri].matches.map((m, mi) => ({
      id: `${s.div}-${ri + 1}-${mi + 1}`,
      div: s.div, home: m.home, away: m.away,
      played: false, hs: null, as: null, seed: null, snapshot: null,
    }))),
  }));
}

export function newLeague(divisions = DIVISIONS, rounds = 18, seed = Date.now() % 100000, season = 1) {
  const divs = divisions.map((d) => ({ key: d.key, name: d.name, teams: [...d.teams] }));
  return {
    season, divisions: divs,
    rounds: buildLeagueRounds(divs, rounds), seed,
    players: {}, injuries: {}, suspensions: {}, cup: newCup(divs, seed, season), feedLog: [],
  };
}

export const roundComplete = (rd) => rd.matches.every((m) => m.played);

export function divisionOf(league, key) {
  return league.divisions.find((d) => d.teams.includes(key)) || null;
}

export function divisionName(league, teamKey) {
  return divisionOf(league, teamKey)?.name || '';
}

/* ---------------- Кубок Чемпионов ---------------- */

function groupRobin(teams) {
  const arr = [...teams, null];
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      let a = arr[i], b = arr[n - 1 - i];
      if (a && b) {
        if ((r + i) % 2 === 1) [a, b] = [b, a];
        pairs.push([a, b]);
      }
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

export function newCup(divisions, seed, season = 1) {
  const teams = divisions.flatMap((d) => d.teams);
  const rng = new Rng(seed + season * 7717);
  const shuffled = rng.shuffle(teams);
  const schedule = { groupAt: [3, 6, 9, 12, 15], qfAt: 16, sfAt: 17, finalAt: 18 };
  const groups = [];
  for (let g = 0; g < 4; g++) {
    const gt = shuffled.slice(g * 5, (g + 1) * 5);
    const matches = [];
    groupRobin(gt).forEach((pairs, ri) => {
      pairs.forEach(([home, away], mi) => {
        matches.push({
          id: `cup-g${g + 1}-${ri + 1}-${mi + 1}`,
          stage: 'group', group: String.fromCharCode(65 + g), round: ri + 1,
          dueRound: schedule.groupAt[ri],
          home, away, played: false, hs: null, as: null, pens: null, seed: null, snapshot: null,
        });
      });
    });
    groups.push({ key: String.fromCharCode(65 + g), teams: gt, matches });
  }
  return {
    name: 'Кубок Чемпионов', stage: 'groups', groups,
    knockout: { qf: [], sf: [], final: [] }, winner: null, schedule,
  };
}

export const cupDueRound = (cup, m) => {
  if (m.dueRound) return m.dueRound;
  if (m.stage === 'group') return cup.schedule.groupAt[(m.round || 1) - 1];
  if (m.stage === 'qf') return cup.schedule.qfAt;
  if (m.stage === 'sf') return cup.schedule.sfAt;
  return cup.schedule.finalAt;
};

export const cupDueMatches = (cup, round) =>
  cupMatches(cup).filter((m) => cupDueRound(cup, m) === round);

export function cupGroupTable(group, squads) {
  const rows = group.teams.map((k) => ({
    key: k, name: squads[k]?.name || k, played: 0, w: 0, d: 0, l: 0,
    gf: 0, ga: 0, gd: 0, pts: 0,
  }));
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  for (const m of group.matches) {
    if (!m.played) continue;
    const h = by[m.home], a = by[m.away];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.hs; h.ga += m.as; a.gf += m.as; a.ga += m.hs;
    if (m.hs > m.as) { h.w++; a.l++; h.pts += 3; }
    else if (m.hs < m.as) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  for (const r of rows) r.gd = r.gf - r.ga;
  rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
  return rows;
}

export function cupMatches(cup) {
  return [
    ...cup.groups.flatMap((g) => g.matches),
    ...cup.knockout.qf, ...cup.knockout.sf, ...cup.knockout.final,
  ];
}

export function cupFindMatch(cup, id) {
  return cupMatches(cup).find((m) => m.id === id) || null;
}

/** Новый сезон: 2 вниз / 2 вверх, составы и стили остаются у сервера. */
export function newSeason(league, squads) {
  const d1 = league.divisions.find((d) => d.key === 'd1');
  const d2 = league.divisions.find((d) => d.key === 'd2');
  const t1 = standings(league, squads, 'd1');
  const t2 = standings(league, squads, 'd2');
  const relegated = t1.slice(-2).map((r) => r.key);
  const promoted = t2.slice(0, 2).map((r) => r.key);
  const divs = [
    { key: 'd1', name: d1.name, teams: d1.teams.filter((k) => !relegated.includes(k)).concat(promoted) },
    { key: 'd2', name: d2.name, teams: d2.teams.filter((k) => !promoted.includes(k)).concat(relegated) },
  ];
  const next = newLeague(divs, 18, (league.seed * 37 + Date.now()) % 100000, (league.season || 1) + 1);
  return { league: next, promoted, relegated };
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

export function standings(league, squads, divKey = 'd1') {
  const div = league.divisions?.find((d) => d.key === divKey);
  const rowKeys = div ? div.teams : TEAMS_ORDER;
  const rows = rowKeys.map((k) => ({
    key: k, name: squads[k]?.name || k, coach: squads[k]?.coach || '', played: 0, w: 0, d: 0, l: 0,
    gf: 0, ga: 0, pts: 0, form: [], gd: 0,
  }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  for (const rd of league.rounds) {
    for (const m of rd.matches) {
      if (!m.played || m.div !== divKey) continue;
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

export function teamLine(t) {
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
