import { readFileSync } from 'node:fs';
import { MatchSim } from '../src/engine/match.js';

const raw = JSON.parse(readFileSync(new URL('../src/data/squads.json', import.meta.url), 'utf8'));
const squads = Object.fromEntries(raw.teams.map((t) => [t.key, t]));
const keys = Object.keys(squads);

const agg = { goals: [], shots: [], subs: 0, yellow: 0, red: 0, inj: 0, events: [], poss: [], dur: [], saves: [], corners: [], xg: 0 };
let feed = null;

for (let i = 0; i < 60; i++) {
  let h = keys[i % 3], a = keys[(i + 1) % 3];
  if (h === a) a = keys[(i + 2) % 3];
  const sim = new MatchSim({ homeKey: h, awayKey: a, squads, seed: 1000 + i * 37 });
  sim.runAll();
  agg.goals.push(sim.home.score + sim.away.score);
  agg.shots.push(sim.home.shots + sim.away.shots);
  agg.subs += sim.home.subsUsed + sim.away.subsUsed;
  agg.yellow += sim.home.yellows + sim.away.yellows;
  agg.red += sim.home.reds + sim.away.reds;
  agg.saves.push(sim.home.saves + sim.away.saves);
  agg.corners.push(sim.home.corners + sim.away.corners);
  agg.events.push(sim.events.length);
  agg.inj += sim.events.filter((e) => e.type === 'injury' && e.serious).length;
  agg.poss.push((sim.possession.home / (sim.possession.home + sim.possession.away)) * 100);
  agg.dur.push(sim.minute);
  const bad = sim.events.filter((e) => /NaN|undefined/.test(e.text));
  if (bad.length) { console.log('BAD TEXT', bad.slice(0, 3)); break; }
  if (i === 0) feed = sim.events;
}

const mean = (arr) => (arr.reduce((a, b) => a + b, 0) / arr.length);
const dist = (arr) => { const m = new Map(); arr.forEach((v) => m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}×${v}`).join(' '); };

console.log('матчей: 60');
console.log('голов за матч (среднее):', mean(agg.goals).toFixed(2), '| распределение:', dist(agg.goals));
console.log('ударов:', mean(agg.shots).toFixed(1), '| створ/сейвы:', mean(agg.saves).toFixed(1), '| угловые:', mean(agg.corners).toFixed(1));
console.log('событий в трансляции:', mean(agg.events).toFixed(0), '| доиграно до минуты:', mean(agg.dur).toFixed(1));
console.log('замен на матч:', (agg.subs / 60).toFixed(2), '| жёлтые:', (agg.yellow / 60).toFixed(2), '| красные:', (agg.red / 60).toFixed(2), '| серьёзных травм:', (agg.inj / 60).toFixed(2));
console.log('владение хозяев (средн.):', mean(agg.poss).toFixed(1) + '%');
console.log('\n--- первые 34 строки трансляции матча', feed[0].clock);
for (const e of feed.slice(0, 34)) console.log(`${e.clock}  ${e.type.padEnd(9)} ${e.text}`);
console.log('\n--- замены/карточки/травмы этого матча:');
for (const e of feed.filter((x) => ['sub', 'yellow', 'red', 'injury'].includes(x.type))) console.log(`${e.clock}  ${e.type.padEnd(8)} ${e.text}`);
console.log('\n--- голы:', feed.filter((x) => x.type === 'goal').map((x) => `${x.clock} ${x.scorer}`).join(', ') || 'нет');
