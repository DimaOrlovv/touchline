import { clamp } from './util.js';

// Тактические стили. mods — поправки к профилю тренера (0..1),
// width/directness — выбор фланговых и вертикальных передач,
// fatigue — множитель расхода сил, level — поправка к силе линий.
export const STYLES = [
  {
    id: 'balanced', name: 'Сбалансированный', tag: 'база',
    desc: 'Структура важнее крайностей: команда меняет темп по счёту и не сжигает силы зря.',
    mods: { press: 0, control: 0, counter: 0, tempo: 0, aggression: 0, lineHeight: 0 },
    width: 0, directness: 0, fatigue: 0.98, level: 0,
  },
  {
    id: 'high_press', name: 'Высокий прессинг', tag: 'прессинг',
    desc: 'Отбор сразу после потери, защитники поднимаются к центру. Много бега и фолов.',
    mods: { press: 0.12, control: 0.02, counter: 0.06, tempo: 0.06, aggression: 0.10, lineHeight: 0.10 },
    width: 0.1, directness: 0.1, fatigue: 1.22, level: 0.02,
  },
  {
    id: 'gegenpress', name: 'Гегенпрессинг', tag: 'прессинг',
    desc: 'Пять секунд на возврат мяча всей командой. Максимальная интенсивность и максимальная усталость.',
    mods: { press: 0.20, control: 0.02, counter: 0.10, tempo: 0.12, aggression: 0.14, lineHeight: 0.14 },
    width: 0.15, directness: 0.25, fatigue: 1.45, level: 0.035,
  },
  {
    id: 'counter', name: 'Контратака', tag: 'переход',
    desc: 'Низкая линия и быстрый вертикальный вылет после перехвата. Меньше владения — больше пространства.',
    mods: { press: -0.14, control: -0.20, counter: 0.26, tempo: 0.10, aggression: -0.04, lineHeight: -0.12 },
    width: 0.2, directness: 0.65, fatigue: 0.92, level: 0.02,
  },
  {
    id: 'offside_trap', name: 'Искусственный офсайд', tag: 'оборона',
    desc: 'Защитная линия живёт на одной высоте и ловит нападающих в ловушку. Риск — забросы за спину.',
    mods: { press: 0.04, control: 0.04, counter: 0.02, tempo: 0, aggression: 0.02, lineHeight: 0.26 },
    width: 0.05, directness: -0.05, fatigue: 1.10, level: 0.03,
  },
  {
    id: 'possession', name: 'Контроль мяча', tag: 'владение',
    desc: 'Долгие розыгрыши и короткие передачи: соперник бегает за мячом, силы экономятся.',
    mods: { press: -0.04, control: 0.16, counter: -0.06, tempo: -0.12, aggression: -0.04, lineHeight: 0.04 },
    width: 0.15, directness: -0.35, fatigue: 0.90, level: 0.03,
  },
  {
    id: 'tiki_taka', name: 'Тики-така', tag: 'владение',
    desc: 'Мяч под контролем на чужой половине, минимум риска. Требует точности и терпения.',
    mods: { press: 0.04, control: 0.24, counter: -0.10, tempo: -0.18, aggression: -0.06, lineHeight: 0.10 },
    width: 0.2, directness: -0.55, fatigue: 0.88, level: 0.045,
  },
  {
    id: 'direct', name: 'Вертикальный футбол', tag: 'переход',
    desc: 'Длинная передача вперёд при первой возможности. Быстро, но с потерями и большим объёмом бега.',
    mods: { press: 0.04, control: -0.14, counter: 0.14, tempo: 0.10, aggression: 0.04, lineHeight: 0.06 },
    width: 0.2, directness: 0.85, fatigue: 1.12, level: 0.02,
  },
  {
    id: 'wing_play', name: 'Игра флангами', tag: 'атака',
    desc: 'Ширина, подачи и смена направления. Крайние защитники успевают и вперёд, и назад.',
    mods: { press: 0.04, control: 0.06, counter: 0.04, tempo: 0.04, aggression: 0, lineHeight: 0.04 },
    width: 0.75, directness: 0.15, fatigue: 1.10, level: 0.025,
  },
  {
    id: 'long_ball', name: 'Длинные передачи', tag: 'переход',
    desc: 'Игра через высокого нападающего и подборы. Просто и жёстко, но владение почти не держится.',
    mods: { press: -0.06, control: -0.18, counter: 0.10, tempo: 0.08, aggression: 0.06, lineHeight: 0.02 },
    width: 0.1, directness: 0.95, fatigue: 1.05, level: 0.015,
  },
  {
    id: 'low_block', name: 'Низкий блок', tag: 'оборона',
    desc: 'Компактно в своей трети, перекрытые коридоры. Отдаёт мяч, но экономит силы.',
    mods: { press: -0.28, control: -0.10, counter: 0.06, tempo: -0.10, aggression: 0.04, lineHeight: -0.30 },
    width: -0.2, directness: 0.3, fatigue: 0.80, level: -0.005,
  },
  {
    id: 'park_bus', name: 'Автобус', tag: 'оборона',
    desc: 'Девять в штрафной, ставка на стандарты и контратаку. Минус к атаке, плюс к свежести.',
    mods: { press: -0.36, control: -0.22, counter: 0.12, tempo: -0.16, aggression: 0.10, lineHeight: -0.42 },
    width: -0.3, directness: 0.45, fatigue: 0.72, level: -0.03,
  },
  {
    id: 'total', name: 'Тотальный футбол', tag: 'атака',
    desc: 'Все атакуют, все защищаются, позиции меняются. Высокий темп на весь матч.',
    mods: { press: 0.12, control: 0.12, counter: 0.10, tempo: 0.10, aggression: 0.04, lineHeight: 0.16 },
    width: 0.35, directness: 0.05, fatigue: 1.28, level: 0.045,
  },
  {
    id: 'all_out', name: 'Атакующий ураган', tag: 'атака',
    desc: 'Все вперёд, максимальный риск. Помогает отыграться, но оставляет пустые зоны сзади.',
    mods: { press: 0.14, control: -0.04, counter: 0.12, tempo: 0.20, aggression: 0.12, lineHeight: 0.22 },
    width: 0.3, directness: 0.35, fatigue: 1.35, level: 0.035,
  },
  {
    id: 'defensive', name: 'На результат', tag: 'оборона',
    desc: 'Сухой прагматичный матч: ниже линия, меньше риска, аккуратные замены.',
    mods: { press: -0.18, control: 0.02, counter: 0.04, tempo: -0.10, aggression: 0.06, lineHeight: -0.18 },
    width: -0.1, directness: 0.15, fatigue: 0.86, level: -0.01,
  },
];

export const DEFAULT_STYLES = {
  psg: 'high_press',
  barcelona: 'possession',
  real_madrid: 'counter',
  arsenal: 'high_press',
  manchester_city: 'possession',
  bayern_munich: 'gegenpress',
  liverpool: 'high_press',
  chelsea: 'possession',
  atletico_madrid: 'low_block',
  inter_milan: 'counter',
  napoli: 'counter',
  juventus: 'balanced',
  borussia_dortmund: 'gegenpress',
  bayer_leverkusen: 'high_press',
  ac_milan: 'counter',
  roma: 'high_press',
  sevilla: 'low_block',
  villarreal: 'possession',
  newcastle: 'high_press',
  aston_villa: 'counter',
};

export const styleOf = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

/** Профиль тренера с поправками выбранного стиля. */
export function applyStyle(coach, styleId) {
  const s = styleOf(styleId);
  const c = { ...coach };
  for (const [k, dv] of Object.entries(s.mods)) c[k] = clamp((coach[k] ?? 0.5) + dv, 0.15, 1);
  c.styleId = s.id;
  c.styleName = s.name;
  c.width = s.width;
  c.directness = s.directness;
  c.fatigueMult = s.fatigue;
  c.levelMod = s.level;
  return c;
}
