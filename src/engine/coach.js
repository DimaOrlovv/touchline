import { clamp } from './util.js';

// Все три тренера строят игру на контроле мяча, высоком прессинге и быстрой контратаке.
// Профиль задаёт только пропорции и привычки, а не сам набор принципов.
export const COACHES = {
  arsenal: {
    name: 'Mikel Arteta', team: 'Arsenal',
    press: 0.82, control: 0.78, counter: 0.70, tempo: 0.76, aggression: 0.62, lineHeight: 0.72,
    subWindow: 58, fatigueLimit: 54, secondWind: 6,
    note: 'Прессинг после потери в течение шести секунд, фланги играют широко.',
  },
  barcelona: {
    name: 'Pep Guardiola', team: 'FC Barcelona',
    press: 0.80, control: 0.93, counter: 0.54, tempo: 0.68, aggression: 0.55, lineHeight: 0.80,
    subWindow: 64, fatigueLimit: 51, secondWind: 5,
    note: 'Мяч держим дольше, чем соперник. Перехват в центральной зоне — приоритет.',
  },
  real_madrid: {
    name: 'Hansi Flick', team: 'Real Madrid',
    press: 0.88, control: 0.74, counter: 0.87, tempo: 0.82, aggression: 0.70, lineHeight: 0.76,
    subWindow: 62, fatigueLimit: 57, secondWind: 7,
    note: 'Высокая линия и вертикаль в первую секунду после перехвата.',
  },
};

export const coachOf = (teamKey) => COACHES[teamKey] || COACHES.arsenal;

// Как тренер меняет характер игры по счёту.
export function matchMood(coach, diff, minute) {
  if (diff < 0) {
    const urgency = clamp((minute - 45) / 45, 0, 1) * 0.5 + 0.5;
    return {
      attack: 1 + 0.16 * urgency,
      defense: 1 - 0.10 * urgency,
      press: coach.press * (1 - 0.08 * urgency),
      tempo: coach.tempo + 0.10 * urgency,
      risk: 1 + 0.22 * urgency,
      label: 'отыгрываемся',
    };
  }
  if (diff > 0 && minute > 60) {
    const hold = clamp((minute - 60) / 30, 0, 1);
    return {
      attack: 1 - 0.18 * hold,
      defense: 1 + 0.14 * hold,
      press: coach.press * (1 - 0.25 * hold),
      tempo: coach.tempo - 0.12 * hold,
      risk: 1 - 0.20 * hold,
      label: 'держим счёт',
    };
  }
  return { attack: 1, defense: 1, press: coach.press, tempo: coach.tempo, risk: 1, label: 'по плану' };
}

const ROLE_GROUP = {
  GK: 'gk', CB: 'def', LB: 'def', RB: 'def', CDM: 'mid', CM: 'mid', CAM: 'mid',
  LW: 'att', RW: 'att', ST: 'att',
};

export const groupOf = (pos) => ROLE_GROUP[pos] || 'mid';

const BENCH_PRIORITY = {
  GK: ['GK'],
  CB: ['CB', 'LB', 'RB', 'CDM'],
  LB: ['LB', 'CB', 'LW', 'CAM'],
  RB: ['RB', 'CB', 'RW', 'CDM'],
  CDM: ['CDM', 'CM', 'CAM', 'CB'],
  CM: ['CM', 'CAM', 'CDM', 'RW'],
  CAM: ['CAM', 'CM', 'RW', 'ST'],
  LW: ['LW', 'RW', 'ST', 'CAM'],
  RW: ['RW', 'LW', 'ST', 'CAM'],
  ST: ['ST', 'LW', 'RW', 'CAM'],
};

/**
 * Один шаг тренерской мысли: вернуть максимум одну замену или null.
 * sim должен предоставить: minute, scoreOf(key), players(team), bench(team), eff(p,a), isOnBench,
 * subCount(team), canSub(team), staminaOk(p).
 */
export function nextSubstitution(sim, teamKey) {
  const coach = coachOf(teamKey);
    if (sim.subCount(teamKey) >= 5) return null;

  const on = sim.players(teamKey);
  const minute = sim.minute;
  const diff = sim.scoreDiff(teamKey);

  // 1. Вынужденная: травма или удаление.
  const broken = on.find((p) => p.out);
  if (broken) {
    const inP = pickBench(sim, teamKey, broken, { ignoreFatigue: true });
    if (inP) return { out: broken, in: inP, forced: true, reason: broken.injuryLabel || 'вынужденная замена' };
  }

  if (minute < 40) return null;
  if (minute < coach.subWindow) return null;

  // 2. Игрок на карточке в обороне при высокой усталости — риск удалением.
  const atRisk = on.find((p) => p.yellow && groupOf(p.pos) === 'def' && p.fatigue > coach.fatigueLimit - 12);
  if (atRisk && sim.scoreDiff(teamKey) >= 0 && minute > coach.subWindow) {
    const inP = pickBench(sim, teamKey, atRisk);
    if (inP) return { out: atRisk, in: inP, reason: 'страх второго горчичника' };
  }

  // 3. Усталость: меняем того, кто просел сильнее всего по реальному уровню.
  const tired = on
    .filter((p) => p.pos !== 'GK' && p.fatigue >= coach.fatigueLimit)
    .sort((a, b) => b.fatigue - a.fatigue);
  for (const p of tired) {
    const inP = pickBench(sim, teamKey, p);
    if (inP && effOf(sim, inP) >= effOf(sim, p) - 2) {
      return { out: p, in: inP, reason: `освежить бровку: ${Math.round(p.fatigue)}% усталости` };
    }
  }

  // 4. Ситуация по счёту.
  if (diff < 0 && minute > 55) {
    const weakestAtt = on.filter((p) => groupOf(p.pos) === 'att')
      .sort((a, b) => effOf(sim, a) - effOf(sim, b))[0];
    const target = weakestAtt && effOf(sim, weakestAtt) < 78 ? weakestAtt
      : on.filter((p) => p.pos === 'CDM' || p.pos === 'CM').sort((a, b) => a.goals + a.assists - (b.goals + b.assists))[0];
    const inP = sim.benchFor(teamKey).filter((p) => !p.used && (p.pos === 'ST' || p.pos === 'LW' || p.pos === 'RW' || p.pos === 'CAM'))
      .sort((a, b) => b.overall - a.overall)[0];
    if (target && inP && groupOf(target.pos) !== 'att') {
      return { out: target, in: inP, reason: 'третий нападающий вместо опорника' };
    }
    if (target && inP) return { out: target, in: inP, reason: 'усиление атаки' };
  }

  if (diff > 0 && minute > 74) {
    const inP = sim.benchFor(teamKey).filter((p) => !p.used && (p.pos === 'CB' || p.pos === 'CDM'))
      .sort((a, b) => b.defending - a.defending)[0];
    const out = on.filter((p) => p.pos !== 'GK' && groupOf(p.pos) === 'att')
      .sort((a, b) => a.fatigue - b.fatigue).pop() || on.find((p) => p.pos === 'RW' || p.pos === 'LW');
    if (inP && out) return { out, in: inP, reason: 'свежая глубина в обороне' };
  }

  return null;
}

function effOf(sim, p) { return sim.eff(p, 'overall'); }

function pickBench(sim, teamKey, outPlayer, opts = {}) {
  const order = BENCH_PRIORITY[outPlayer.pos] || [outPlayer.pos];
  const pool = sim.benchFor(teamKey).filter((p) => !p.used && (opts.ignoreFatigue || p.fatigue < 45));
  for (const role of order) {
    const cand = pool.filter((p) => p.pos === role).sort((a, b) => b.overall - a.overall)[0];
    if (cand) return cand;
  }
  return pool.sort((a, b) => b.overall - a.overall)[0] || null;
}
