import { readFileSync } from 'node:fs';
import { MatchSim } from '../src/engine/match.js';
import { newLeague, DIVISIONS, applyResult, standings, effectiveSquad, topScorers, avgRating, isUnavailable } from '../src/engine/season.js';

const raw = JSON.parse(readFileSync(new URL('../src/data/squads.json', import.meta.url), 'utf8'));
const squads = Object.fromEntries(raw.teams.map((t) => [t.key, t]));
const league = newLeague(DIVISIONS, 18, 4242, 1);
let goals = 0, matches = 0;
for (let rIdx = 0; rIdx < league.rounds.length; rIdx++) {
  const rd = league.rounds[rIdx];
  for (let mIdx = 0; mIdx < rd.matches.length; mIdx++) {
    const m = rd.matches[mIdx];
    const sq = Object.fromEntries([m.home, m.away].map((k) => [k, effectiveSquad(league, squads[k])]));
    for (const k of [m.home, m.away]) {
      if (sq[k].starters.filter((p) => isUnavailable(league, p.id)).length) throw new Error(`${k}: недоступный в старте`);
    }
    const sim = new MatchSim({ homeKey: m.home, awayKey: m.away, squads: sq, seed: rd.round * 7919 + mIdx * 104729 + league.seed });
    sim.runAll();
    applyResult(league, rIdx, mIdx, sim, squads);
    goals += m.hs + m.as; matches++;
  }
}
for (const d of league.divisions) {
  console.log(`\n${d.name}`);
  console.table(standings(league, squads, d.key).map((r) => ({ клуб: r.name, и: r.played, в: r.w, н: r.d, п: r.l, мячи: `${r.gf}:${r.ga}`, очки: r.pts })));
}
console.log('матчей:', matches, '| голов:', goals, '| в среднем:', (goals / matches).toFixed(2));
console.log('бомбардиры:', topScorers(league, 5, squads).map((s) => `${s.name} ${s.goals}`).join(', '));
