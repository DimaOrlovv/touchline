import { clamp } from './util.js';

// Все три тренера строят игру на контроле мяча, высоком прессинге и быстрой контратаке.
// Профиль задаёт только пропорции и привычки, а не сам набор принципов.
export const COACHES = {
  psg: {
    name: 'Luis Enrique', team: 'PSG',
    press: 0.84, control: 0.86, counter: 0.66, tempo: 0.78, aggression: 0.60, lineHeight: 0.78,
    subWindow: 60, fatigueLimit: 53, secondWind: 6,
    note: 'Владение с агрессивным давлением после потери, крайние защитники играют высоко.',
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
  arsenal: {
    name: 'Mikel Arteta', team: 'Arsenal',
    press: 0.84, control: 0.82, counter: 0.64, tempo: 0.76, aggression: 0.62, lineHeight: 0.74,
    subWindow: 60, fatigueLimit: 54, secondWind: 6,
    note: 'Высокий прессинг, контроль через полуфланги и быстрый выход из-под давления.',
  },
  manchester_city: {
    name: 'Pep Guardiola', team: 'Manchester City',
    press: 0.82, control: 0.94, counter: 0.50, tempo: 0.66, aggression: 0.52, lineHeight: 0.82,
    subWindow: 64, fatigueLimit: 50, secondWind: 5,
    note: 'Максимальный контроль мяча и позиционные атаки, минимум риска.',
  },
  bayern_munich: {
    name: 'Vincent Kompany', team: 'Bayern Munich',
    press: 0.90, control: 0.78, counter: 0.78, tempo: 0.84, aggression: 0.68, lineHeight: 0.80,
    subWindow: 60, fatigueLimit: 55, secondWind: 7,
    note: 'Высокая линия, агрессивный прессинг и вертикальные передачи.',
  },
  liverpool: {
    name: 'Arne Slot', team: 'Liverpool',
    press: 0.87, control: 0.80, counter: 0.72, tempo: 0.82, aggression: 0.64, lineHeight: 0.78,
    subWindow: 60, fatigueLimit: 55, secondWind: 7,
    note: 'Быстрый переход в атаку и давление на чужой половине.',
  },
  chelsea: {
    name: 'Enzo Maresca', team: 'Chelsea',
    press: 0.78, control: 0.88, counter: 0.52, tempo: 0.70, aggression: 0.54, lineHeight: 0.72,
    subWindow: 63, fatigueLimit: 53, secondWind: 6,
    note: 'Владение и терпеливый розыгрыш с выходом через центр.',
  },
  atletico_madrid: {
    name: 'Diego Simeone', team: 'Atlético Madrid',
    press: 0.70, control: 0.58, counter: 0.90, tempo: 0.62, aggression: 0.78, lineHeight: 0.52,
    subWindow: 58, fatigueLimit: 52, secondWind: 5,
    note: 'Низкий компактный блок и мгновенные контратаки.',
  },
  inter_milan: {
    name: 'Simone Inzaghi', team: 'Inter Milan',
    press: 0.76, control: 0.80, counter: 0.82, tempo: 0.74, aggression: 0.62, lineHeight: 0.68,
    subWindow: 62, fatigueLimit: 54, secondWind: 6,
    note: 'Гибкая схема, быстрые вертикали и игра через фланги.',
  },
  napoli: {
    name: 'Antonio Conte', team: 'Napoli',
    press: 0.80, control: 0.72, counter: 0.78, tempo: 0.74, aggression: 0.70, lineHeight: 0.70,
    subWindow: 58, fatigueLimit: 54, secondWind: 6,
    note: 'Плотная оборона и быстрый выход через фланги.',
  },
  juventus: {
    name: 'Igor Tudor', team: 'Juventus',
    press: 0.78, control: 0.70, counter: 0.80, tempo: 0.72, aggression: 0.72, lineHeight: 0.68,
    subWindow: 58, fatigueLimit: 53, secondWind: 5,
    note: 'Оборона в три центральных и вертикальные контратаки.',
  },
  borussia_dortmund: {
    name: 'Niko Kovač', team: 'Borussia Dortmund',
    press: 0.86, control: 0.72, counter: 0.82, tempo: 0.82, aggression: 0.70, lineHeight: 0.78,
    subWindow: 60, fatigueLimit: 55, secondWind: 7,
    note: 'Высокий темп и давление на чужой половине.',
  },
  bayer_leverkusen: {
    name: 'Kasper Hjulmand', team: 'Bayer Leverkusen',
    press: 0.84, control: 0.80, counter: 0.74, tempo: 0.80, aggression: 0.64, lineHeight: 0.76,
    subWindow: 62, fatigueLimit: 54, secondWind: 6,
    note: 'Контроль через тройку защитников и быстрые включения.',
  },
  ac_milan: {
    name: 'Massimiliano Allegri', team: 'AC Milan',
    press: 0.74, control: 0.72, counter: 0.80, tempo: 0.68, aggression: 0.66, lineHeight: 0.64,
    subWindow: 60, fatigueLimit: 52, secondWind: 5,
    note: 'Прагматичный футбол и ставка на моменты.',
  },
  roma: {
    name: 'Gian Piero Gasperini', team: 'Roma',
    press: 0.88, control: 0.76, counter: 0.76, tempo: 0.82, aggression: 0.72, lineHeight: 0.80,
    subWindow: 60, fatigueLimit: 55, secondWind: 7,
    note: 'Агрессивный прессинг и игра в высоком темпе.',
  },
  sevilla: {
    name: 'Matías Almeyda', team: 'Sevilla',
    press: 0.72, control: 0.66, counter: 0.78, tempo: 0.66, aggression: 0.74, lineHeight: 0.60,
    subWindow: 58, fatigueLimit: 52, secondWind: 5,
    note: 'Низкий блок и борьба за второй мяч.',
  },
  villarreal: {
    name: 'Marcelino', team: 'Villarreal',
    press: 0.74, control: 0.80, counter: 0.60, tempo: 0.68, aggression: 0.58, lineHeight: 0.72,
    subWindow: 62, fatigueLimit: 52, secondWind: 5,
    note: 'Контроль мяча и терпеливое позиционное нападение.',
  },
  newcastle: {
    name: 'Eddie Howe', team: 'Newcastle United',
    press: 0.84, control: 0.74, counter: 0.76, tempo: 0.80, aggression: 0.66, lineHeight: 0.74,
    subWindow: 60, fatigueLimit: 55, secondWind: 7,
    note: 'Интенсивный прессинг и быстрые атаки по флангам.',
  },
  aston_villa: {
    name: 'Unai Emery', team: 'Aston Villa',
    press: 0.78, control: 0.78, counter: 0.74, tempo: 0.72, aggression: 0.62, lineHeight: 0.70,
    subWindow: 62, fatigueLimit: 53, secondWind: 6,
    note: 'Структурный контроль и острые переходы.',
  },
};

export const coachOf = (teamKey) => COACHES[teamKey] || COACHES.psg;

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
export function nextSubstitution(sim, teamKey, { halftime = false } = {}) {
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

  if (!halftime) {
    if (minute < 40) return null;
    if (minute < coach.subWindow) return null;
  }

  // 2. Игрок на карточке в обороне при высокой усталости — риск удалением.
  const atRisk = on.find((p) => p.yellow && groupOf(p.pos) === 'def' && p.fatigue > coach.fatigueLimit - 12);
  if (atRisk && sim.scoreDiff(teamKey) >= 0 && minute > coach.subWindow) {
    const inP = pickBench(sim, teamKey, atRisk);
    if (inP) return { out: atRisk, in: inP, reason: 'страх второго горчичника' };
  }

  // 3. Усталость: меняем того, кто просел сильнее всего по реальному уровню.
  const tiredLimit = halftime ? 34 : coach.fatigueLimit;
  const tired = on
    .filter((p) => p.pos !== 'GK' && p.fatigue >= tiredLimit)
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

export function pickBench(sim, teamKey, outPlayer, opts = {}) {
  const order = BENCH_PRIORITY[outPlayer.pos] || [outPlayer.pos];
  const pool = sim.benchFor(teamKey).filter((p) => !p.used && (opts.ignoreFatigue || p.fatigue < 45));
  for (const role of order) {
    const cand = pool.filter((p) => p.pos === role).sort((a, b) => b.overall - a.overall)[0];
    if (cand) return cand;
  }
  // Вратаря меняем только вратарём; если его нет — в рамку встаёт защитник.
  if (outPlayer.pos === 'GK') {
    const def = pool.filter((p) => ['CB', 'LB', 'RB', 'CDM'].includes(p.pos))
      .sort((a, b) => (b.power_strength || 0) - (a.power_strength || 0))[0];
    if (def) return def;
  }
  // Затем — ближайшая линия, и только потом любой свежий игрок.
  const group = groupOf(outPlayer.pos);
  const sameLine = pool.filter((p) => groupOf(p.pos) === group).sort((a, b) => b.overall - a.overall)[0];
  return sameLine || pool.sort((a, b) => b.overall - a.overall)[0] || null;
}
