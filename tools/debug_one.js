import { readFileSync } from 'node:fs';
import { MatchSim } from '../src/engine/match.js';

const raw = JSON.parse(readFileSync(new URL('../src/data/squads.json', import.meta.url), 'utf8'));
const squads = Object.fromEntries(raw.teams.map((t) => [t.key, t]));
const sim = new MatchSim({ homeKey: 'arsenal', awayKey: 'barcelona', squads, seed: 1000 });

let ev;
const marks = [];
while ((ev = sim.tick())) {
  if (ev.type === 'goal') marks.push(`${ev.clock} ГОЛ ${ev.scorer} ${ev.score.join(':')}`);
}
console.log('finished:', sim.finished, 'minute:', sim.minute.toFixed(1), 'extra:', sim.extra, 'subs:', sim.home.subsUsed, sim.away.subsUsed);
console.log(marks.join('\n') || 'без голов');
const fat = (t) => t.xi.map((p) => `${p.pos} ${Math.round(p.fatigue)}`).join('  ');
console.log('усталость Arsenal:', fat(sim.home));
console.log('усталость Barca  :', fat(sim.away));
console.log('bench avail:', sim.benchFor('arsenal').length, sim.benchFor('barcelona').length);
console.log('events:', sim.events.length, 'shots:', sim.home.shots + sim.away.shots, 'fouls:', sim.home.fouls + sim.away.fouls);
const byType = {};
for (const e of sim.events) byType[e.type] = (byType[e.type] || 0) + 1;
console.log(byType);
