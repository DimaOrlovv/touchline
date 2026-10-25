// Плоские линейные иконки, нарисованы вручную под сетку 24px. Один stroke-width на весь набор.
const S = 'fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round';

export const ICONS = {
  home: '<path d="M3.5 11 12 4.5 20.5 11"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  squad: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9.5" r="2.2"/><path d="M15 14.6a4.4 4.4 0 0 1 5.6 3.4"/>',
  table: '<path d="M4 20V13"/><path d="M10 20V5"/><path d="M16 20v-9"/><path d="M2.5 22h19"/>',
  calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="1"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4"/><path d="M8 14h3M8 17.5h6"/>',
  settings: '<path d="M4 8h16M4 16h16"/><circle cx="9.5" cy="8" r="2.3"/><circle cx="15" cy="16" r="2.3"/>',
  ball: '<circle cx="12" cy="12" r="8"/><path d="M12 8.4 15 10.6 13.9 14h-3.8L9 10.6z"/>',
  pass: '<path d="M4 12h12"/><path d="M13 8.5 16.5 12 13 15.5"/>',
  through: '<path d="M4 12h9"/><path d="M9.5 12h6"/><path d="M13 8.5 16.5 12 13 15.5"/><circle cx="20" cy="12" r="1.3"/>',
  carry: '<path d="M5 18c3.5-9 7 1 11-6"/><circle cx="18.5" cy="10" r="1.6"/>',
  dribble: '<path d="M4 17c2.5-3 4.5-3 6 0s3.5 3 6 0"/><circle cx="19" cy="9" r="2.4"/>',
  tackle: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  intercept: '<circle cx="12" cy="12" r="8"/><path d="M7.5 16.5 16.5 7.5"/>',
  press: '<path d="M4 15.5 8 11l3.5 3.5L16 8l4 3.5"/><path d="M4 20h16"/>',
  foul: '<circle cx="9" cy="15" r="4"/><path d="M12.2 11.8 19.5 4.5"/><path d="M15.5 4.5h4v4"/>',
  card: '<path d="M9.5 4.5h6.5V19H9.5z"/><path d="M7 7.5h6.5V19"/>',
  sub: '<path d="M7.5 17V7.5M4.5 10.5 7.5 7.5l3 3"/><path d="M16.5 7v9.5M13.5 13.5 16.5 16.5l3-3"/>',
  injury: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 8v8M8 12h8"/>',
  corner: '<path d="M6.5 3.5v17"/><path d="M6.5 5h11l-2.2 4 2.2 4h-11"/>',
  shot: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M12 4 19 6.8v5.4c0 4.6-2.8 6.8-7 8-4.2-1.2-7-3.4-7-8V6.8z"/>',
  post: '<path d="M7 5v14M17 5v14"/><circle cx="12" cy="12" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  whistle: '<path d="M4 11h7l6-3v8l-6-3H4z"/><circle cx="8" cy="15" r="2.5"/>',
  trophy: '<path d="M7 4.5h10v4.2a5 5 0 0 1-10 0z"/><path d="M12 14v3.5M8.5 20h7"/><path d="M17 6h2.5v1.5A2.5 2.5 0 0 1 17 10M7 6H4.5v1.5A2.5 2.5 0 0 0 7 10"/>',
  flag: '<path d="M5.5 3.5v17"/><path d="M5.5 4.5h12l-2.5 4.5L17.5 14h-12"/>',
  chevron: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  play: '<path d="M7.5 5.5v13l11-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  forward: '<path d="M5.5 6.5v11M10 12l7.5-4.5V16z"/>',
  skip: '<path d="M5.5 6.5v11l8-5.5z"/><path d="M16 6v12"/>',
  spark: '<path d="M12 4.5v5M12 14.5v5M4.5 12h5M14.5 12h5"/><path d="M7 7l3 3M17 17l-3-3M17 7l-3 3M7 17l3-3"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5.5M12 8.2v.6"/>',
  shield: '<path d="M12 4 19 6.8v5.4c0 4.6-2.8 6.8-7 8-4.2-1.2-7-3.4-7-8V6.8z"/>',
  run: '<circle cx="14" cy="5.5" r="2"/><path d="M10 21l1.5-5-2.5-2.5 1-4 3.5-1.5 3 2.5 2.5.5"/><path d="M7 10.5 4.5 13"/>',
};

export function icon(name, cls = '', size = 24) {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" style="${S}" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}

export const EVENT_ICON = {
  kickoff: 'whistle', ht: 'clock', ft: 'clock',
  pass: 'pass', through: 'through', carry: 'carry', dribble: 'dribble',
  tackle: 'tackle', intercept: 'intercept', press: 'press', clear: 'tackle',
  shot: 'shot', blocked: 'shield', save: 'save', post: 'post', goal: 'ball',
  foul: 'foul', setpiece: 'flag', corner: 'corner', offside: 'flag', gk: 'save',
  yellow: 'card', red: 'card', injury: 'injury', sub: 'sub', moment: 'spark', style: 'squad',
};
