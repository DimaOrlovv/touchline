import { readFileSync } from 'node:fs';
import { MatchSim } from '../src/engine/match.js';
import { newLeague, applyResult, standings, effectiveSquad, topScorers, avgRating, isOut } from '../src/engine/season.js';

const raw = JSON.parse(readFileSync(new URL('../src/data/squads.json', import.meta.url), 'utf8'));
const squads = Object.fromEntries(raw.teams.map((t) => [t.key, t]));
const keys = Object.keys(squads);
const league = newLeague(keys, 30, 4242);

for (let i = 0; i < league.rounds.length; i++) {
  const rd = league.rounds[i];
  const sq = Object.fromEntries(keys.map((k) => [k, effectiveSquad(league, squads[k])]));
  for (const [k, s] of Object.entries(sq)) {
    if (s.starters.length !== 11) throw new Error(`${k}: в XI ${s.starters.length} игроков`);
    if (s.starters.filter((p) => isOut(league, p.id)).length) throw new Error(`${k}: травмированный в старте`);
  }
  const sim = new MatchSim({ homeKey: rd.home, awayKey: rd.away, squads: sq, seed: rd.round * 7919 + league.seed });
  sim.runAll();
  applyResult(league, i, sim);
}

const table = standings(league, squads);
console.log('туров сыграно:', league.rounds.filter((r) => r.played).length);
console.table(table.map((r) => ({ клуб: r.name, и: r.played, в: r.w, н: r.d, п: r.l, мячи: `${r.gf}:${r.ga}`, очки: r.pts, форма: r.form.join('') })));
const all = keys.flatMap((k) => [...squads[k].starters, ...squads[k].bench]);
const withRating = all.filter((p) => avgRating(league, p.id));
console.log('игроков с оценкой за сезон:', withRating.length, 'из', all.length);
console.log('лучшие бомбардиры:', topScorers(league, 5, squads).map((s) => `${s.name} ${s.goals}(${s.assists})`).join(', '));
const apps = Object.values(league.players).map((s) => s.apps);
console.log('матчей на игрока: min', Math.min(...apps), 'max', Math.max(...apps), '| средняя оценка лиги:', (withRating.reduce((a, p) => a + avgRating(league, p.id), 0) / withRating.length).toFixed(2));
console.log('травмы в конце сезона:', Object.keys(league.injuries).length);
console.log('голов за сезон:', table.reduce((a, r) => a + r.gf, 0), '| матчей с нулевой победой:', league.rounds.filter((r) => r.hs === r.as).length);
const sample = league.rounds[6];
console.log('пример тура 7:', squads[sample.home].name, sample.hs, ':', sample.as, squads[sample.away].name, '| MVP:', sample.mvp?.player, sample.mvp?.rating, '| карточек:', sample.cards?.length);
