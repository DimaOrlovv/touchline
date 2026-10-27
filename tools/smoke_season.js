import { readFileSync } from 'node:fs';
import { MatchSim } from '../src/engine/match.js';
import { newLeague, applyResult, standings, effectiveSquad, topScorers, avgRating, isUnavailable } from '../src/engine/season.js';

const raw = JSON.parse(readFileSync(new URL('../src/data/squads.json', import.meta.url), 'utf8'));
const squads = Object.fromEntries(raw.teams.map((t) => [t.key, t]));
const keys = Object.keys(squads);
const league = newLeague(keys, 18, 4242);
const counts = Object.fromEntries(keys.map((k) => [k, 0]));
let maxScore = '';
let goals = 0;

for (let rIdx = 0; rIdx < league.rounds.length; rIdx++) {
  const rd = league.rounds[rIdx];
  for (let mIdx = 0; mIdx < rd.matches.length; mIdx++) {
    const m = rd.matches[mIdx];
    const sq = Object.fromEntries([m.home, m.away].map((k) => [k, effectiveSquad(league, squads[k])]));
    for (const k of [m.home, m.away]) {
      const s = sq[k];
      if (s.starters.filter((p) => isUnavailable(league, p.id)).length) throw new Error(`${k}: недоступный в старте`);
    }
    const sim = new MatchSim({ homeKey: m.home, awayKey: m.away, squads: sq, seed: rd.round * 7919 + mIdx * 104729 + league.seed });
    sim.runAll();
    applyResult(league, rIdx, mIdx, sim, squads);
    counts[m.home]++; counts[m.away]++;
    goals += m.hs + m.as;
    if (m.hs + m.as > 7) maxScore += `${m.home} ${m.hs}:${m.as} ${m.away}; `;
  }
}

const table = standings(league, squads);
console.log('туров:', league.rounds.length, '| матчей:', league.rounds.reduce((a, r) => a + r.matches.length, 0), '| игр у клуба:', JSON.stringify(counts));
console.table(table.map((r) => ({ клуб: r.name, и: r.played, в: r.w, н: r.d, п: r.l, мячи: `${r.gf}:${r.ga}`, очки: r.pts, форма: r.form.join('') })));
console.log('голов всего:', goals, '| в среднем за матч:', (goals / 90).toFixed(2));
console.log('крупные счёта (>7 голов):', maxScore || 'нет');
const all = keys.flatMap((k) => [...squads[k].starters, ...squads[k].bench]);
const withRating = all.filter((p) => avgRating(league, p.id));
console.log('игроков с оценкой:', withRating.length, 'из', all.length, '| средняя оценка:', (withRating.reduce((a, p) => a + avgRating(league, p.id), 0) / withRating.length).toFixed(2));
console.log('лучшие бомбардиры:', topScorers(league, 5, squads).map((s) => `${s.name} ${s.goals}(${s.assists})`).join(', '));
console.log('травмы/дисквалификации в конце:', Object.keys(league.injuries).length, '/', Object.keys(league.suspensions).length);
