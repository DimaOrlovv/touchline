import { esc, bar, ratingChip, sheet } from './dom.js';
import { icon } from './icons.js';
import { spinner } from './feedback.js';
import { STYLES, applyStyle, styleOf } from '../engine/styles.js';
import { coachOf } from '../engine/coach.js';

export const LOGOS = {
  arsenal: 'icons/logos/psg.png',
  barcelona: 'icons/logos/barcelona.png',
  real_madrid: 'icons/logos/real_madrid.png',
};

const TONE = { arsenal: 'psg', barcelona: 'fcb', real_madrid: 'rma' };
export const toneOf = (key) => TONE[key] || 'psg';

export function crest(key, name, size = '') {
  const letter = (name || '?').slice(0, 1);
  return `<span class="crest ${size}"><i>${esc(letter)}</i><img src="${LOGOS[key]}" alt="${esc(name || '')}" loading="lazy" onload="this.closest('.crest').classList.add('has-logo')" onerror="this.remove()"></span>`;
}

const POS_ORDER = ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CM', 'CM', 'LW', 'ST', 'RW'];
const nameOf = (ctx, key) => ctx.S.teams.find((t) => t.key === key)?.name || key;

// ---------- стиль игры ----------
export function styleParams(styleId, teamKey) {
  const style = styleOf(styleId);
  const c = applyStyle(coachOf(teamKey), styleId);
  return {
    style, c,
    rows: [
      ['Прессинг', c.press], ['Контроль', c.control], ['Контратака', c.counter],
      ['Темп', c.tempo], ['Агрессия', c.aggression], ['Линия', c.lineHeight],
    ],
  };
}

export function styleBars(rows, cls = 'sbars') {
  return `<div class="${cls}">${rows.map(([label, v]) => {
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    return `<span class="sbar"><em>${esc(label)}</em><i><b style="width:${pct}%"></b></i></span>`;
  }).join('')}</div>`;
}

export function styleSheet(ctx) {
  const teamKey = ctx.account;
  const cur = ctx.S.styles?.[teamKey] || 'balanced';
  const body = `<div class="stylesheet">
    <p class="hint">Стиль задаёт баланс прессинга, владения и темпа. Активные тактики дают силу, но сжигают ноги — выбирайте до матча или в перерыве.</p>
    <div class="stylelist">${STYLES.map((s) => {
      const { rows } = styleParams(s.id, teamKey);
      const lvl = Math.round(s.level * 100);
      return `<button class="styleopt ${s.id === cur ? 'is-on' : ''}" data-act="style" data-id="${s.id}">
        <div class="styleopt__head"><b>${esc(s.name)}</b><span class="styleopt__tag">${esc(s.tag)}</span></div>
        <p>${esc(s.desc)}</p>
        ${styleBars(rows)}
        <div class="styleopt__foot"><span>Усталость ×${s.fatigue.toFixed(2)}</span><span>Уровень ${lvl >= 0 ? '+' : ''}${lvl}%</span></div>
      </button>`;
    }).join('')}</div>
  </div>`;
  return sheet('Стиль игры', body);
}

function styleCard(ctx) {
  const id = ctx.S.styles?.[ctx.account] || 'balanced';
  const { style, rows } = styleParams(id, ctx.account);
  const l = ctx.S.live;
  const locked = l && l.status === 'running' && (l.home === ctx.account || l.away === ctx.account);
  return `<section class="card">
    <header class="card__head"><h2>Стиль игры</h2>
      ${locked ? '<span class="tag">смена — в перерыве</span>'
        : `<button class="link" data-act="styles">Изменить ${icon('chevron', '', 14)}</button>`}</header>
    <div class="stylecur"><b>${esc(style.name)}</b><p>${esc(style.desc)}</p>${styleBars(rows)}</div>
  </section>`;
}

// ---------- вход ----------
export function renderLogin(ctx) {
  return {
    bare: true,
    html: `<div class="login">
      <header class="login__head"><h1>Touchline Liga</h1><p>Три клуба. Тридцать туров. Матч запускают оба тренера.</p></header>
      <form class="login__form" data-act="submit-login" autocomplete="off">
        <div class="field">
          <label for="lg">Логин тренера</label>
          <input id="lg" name="login" type="text" autocapitalize="none" spellcheck="false" placeholder="ArlPsg" required>
        </div>
        <label class="switch switch--plain"><span>Запомнить меня</span><input type="checkbox" name="remember" ${ctx.remember ? 'checked' : ''}><i></i></label>
        <button class="btn btn--primary block" type="submit">${ctx.busy ? `${spinner(18)} Проверяю` : 'Войти'}</button>
        ${ctx.error ? `<p class="form-error">${esc(ctx.error)}</p>` : ''}
      </form>
      <div class="login__hint">
        <span>PSG — Luis Enrique</span><span>FC Barcelona — Pep Guardiola</span><span>Real Madrid — Hansi Flick</span>
      </div>
    </div>`,
  };
}

// ---------- главная ----------
export function renderHome(ctx) {
  const { S, account } = ctx;
  const rd = S.rounds[S.roundIdx];
  const team = S.teams.find((t) => t.key === account);
  const live = S.live;
  const mine = S.table.find((r) => r.key === account);
  const inMatch = rd && (rd.home === account || rd.away === account);
  const running = live && (live.status === 'running' || live.status === 'halftime');
  const iAmReady = live && inMatch && live.ready?.[account];

  let actions;
  if (!rd) actions = `<div class="actions"><button class="btn btn--primary" data-act="reset">Новый сезон</button></div>`;
  else if (running) actions = `<div class="actions"><button class="btn btn--primary" data-act="watch">${icon('play', '', 18)} Идёт матч — смотреть</button></div>`;
  else if (inMatch) actions = `<div class="actions"><button class="btn btn--primary" data-act="ready" ${iAmReady ? 'disabled' : ''}>${iAmReady ? `${spinner(18)} Ожидание соперника` : 'Играть'}</button></div>`;
  else actions = `<div class="actions"><button class="btn" data-act="watch" ${live ? '' : 'disabled'}>${live ? 'Смотреть матч' : 'Ждём старта'}</button></div>`;

  const last = [...S.rounds].reverse().find((r) => r.played);

  return {
    title: team?.name || 'Матч',
    html: `<div class="stack">
      <section class="card hero ${TONE[account]}-edge">
        <header class="card__head"><h2>Тур ${rd ? rd.round : S.rounds.length}</h2><span class="tag">${esc(team?.coach || '')}</span></header>
        ${rd ? `<button class="fx" data-act="match" data-idx="${S.roundIdx}">
          <span class="fx__side">${crest(rd.home, nameOf(ctx, rd.home))}<b>${esc(nameOf(ctx, rd.home))}</b></span>
          <span class="fx__score">${rd.played ? `${rd.hs}:${rd.as}` : running ? '<span class="live-dot"></span>' : '–:–'}</span>
          <span class="fx__side right"><b>${esc(nameOf(ctx, rd.away))}</b>${crest(rd.away, nameOf(ctx, rd.away))}</span>
        </button>` : '<p class="pad muted">Все туры сыграны.</p>'}
        ${actions}
      </section>

      ${styleCard(ctx)}

      <section class="card">
        <header class="card__head"><h2>Таблица</h2><button class="link" data-act="go" data-route="table">Открыть ${icon('chevron', '', 14)}</button></header>
        <table class="mini">
          <thead><tr><th>#</th><th>Клуб</th><th>И</th><th>М</th><th>О</th></tr></thead>
          <tbody>${S.table.map((r, i) => `<tr class="${r.key === account ? 'is-me' : ''}" data-act="club" data-key="${r.key}">
            <td>${i + 1}</td>
            <td class="club">${crest(r.key, r.name, 'crest--sm')}<span>${esc(r.name)}</span></td>
            <td>${r.played}</td><td>${r.gf}:${r.ga}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody>
        </table>
      </section>

      ${last ? `<section class="card">
        <header class="card__head"><h2>Последний матч</h2>
          <button class="link" data-act="match" data-idx="${S.rounds.indexOf(last)}">Статистика ${icon('chevron', '', 14)}</button></header>
        <div class="lastline">${crest(last.home, nameOf(ctx, last.home))}<b>${last.hs} : ${last.as}</b>${crest(last.away, nameOf(ctx, last.away))}</div>
        ${(last.summary?.scorers || []).length ? `<div class="scorers">${last.summary.scorers.slice(0, 4).map((s) => `<span>${esc(s.min)} ${esc(s.player)}</span>`).join('')}</div>` : ''}
      </section>` : ''}

      ${mine ? `<section class="card">
        <div class="rowline"><span>Последние 5</span><span class="forms">${mine.form.map((f) => `<i class="form form--${f}">${f}</i>`).join('') || '<em class="muted">—</em>'}</span></div>
        <div class="rowline"><span>Разница мячей</span><span>${mine.gd > 0 ? '+' : ''}${mine.gd}</span></div>
      </section>` : ''}
    </div>`,
  };
}

// ---------- состав ----------
export function renderSquad(ctx) {
  const { S, account } = ctx;
  const viewKey = ctx.clubKey || account;
  const club = S.squads[viewKey];
  if (!club) return { title: 'Состав', html: '<div class="stack"><p class="muted pad">Нет данных.</p></div>' };
  const isMine = viewKey === account;
  const slots = (isMine && ctx.draftSlots) || S.lineups[viewKey]?.slots
    || club.raw.starters.map((p, i) => ({ id: p.id, pos: POS_ORDER[i] || p.pos }));
  const all = [...club.raw.starters, ...club.raw.bench];
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const starters = slots.map((s) => ({ ...byId[s.id], pos: s.pos })).filter((p) => p.id);
  const bench = all.filter((p) => !slots.some((s) => s.id === p.id));

  const row = (p, kind) => {
    const st = S.playerStats[p.id] || {};
    const line = st.apps ? `${st.goals} гол · ${st.assists} пас · ${(st.ratingSum / (st.ratingN || 1)).toFixed(2)}` : '';
    return `<div class="prow ${isMine ? 'is-editable' : ''}" data-prow="${p.id}" data-kind="${kind}">
      ${isMine ? '<span class="grip" aria-hidden="true"></span>' : ''}
      <span class="prow__pos">${esc(p.pos)}</span>
      <span class="prow__name">${esc(p.name)}${p.captain ? '<i class="cap">к</i>' : ''}${S.injuries[p.id] ? '<i class="badge badge--out">травма</i>' : ''}${line ? `<em>${esc(line)}</em>` : ''}</span>
      <span class="prow__nums">${ratingChip(p.overall)}</span>
    </div>`;
  };

  return {
    title: 'Состав',
    html: `<div class="stack">
      <div class="clubchips">${S.teams.map((t) => `<button class="clubchip ${t.key === viewKey ? 'is-on' : ''}" data-act="club" data-key="${t.key}">
        ${crest(t.key, t.name, 'crest--sm')}<span>${esc(t.name.replace('FC ', ''))}</span>${t.key === account ? '<i class="me">мой</i>' : ''}</button>`).join('')}</div>

      <section class="card">
        <header class="card__head"><h2>Стартовый XI · ${esc(club.formation)}</h2><span class="tag">${esc(club.coach)}</span></header>
        <div class="plist" data-zone="start">${starters.map((p) => row(p, 'start')).join('')}</div>
      </section>

      <section class="card">
        <header class="card__head"><h2>Запас</h2><span class="tag">5 замен в матче</span></header>
        <div class="plist" data-zone="bench">${bench.map((p) => row(p, 'bench')).join('')}</div>
      </section>

      ${isMine
        ? `<div class="xibar ${ctx.dirty ? 'is-on' : ''}"><span>${ctx.dirty ? 'Состав изменён — не сохранён' : 'Состав сохранён'}</span>
            <button class="btn btn--primary" data-act="save-xi" ${ctx.dirty ? '' : 'disabled'}>${ctx.busy ? spinner(18) : 'Сохранить'}</button></div>
          <p class="hint hint--row">${icon('squad', '', 14)} Тап по игроку — карточка. Тяни за точки слева, чтобы менять местами.</p>`
        : `<p class="hint">Состав показывает ${esc(club.coach)}. Замены в матче делает только тренер.</p>`}
    </div>`,
  };
}

// ---------- таблица ----------
export function renderTable(ctx) {
  const { S } = ctx;
  const allOf = (k) => [...S.squads[k].raw.starters, ...S.squads[k].raw.bench];
  const find = (id) => {
    for (const k of Object.keys(S.squads)) { const p = allOf(k).find((x) => x.id === id); if (p) return { p, team: k }; }
    return null;
  };
  const scorers = Object.entries(S.playerStats).filter(([, v]) => v.goals > 0)
    .sort((a, b) => b[1].goals - a[1].goals || b[1].assists - a[1].assists).slice(0, 8);
  const disc = S.teams.map((t) => {
    let y = 0, r = 0;
    for (const p of allOf(t.key)) { const st = S.playerStats[p.id] || {}; y += st.yellow || 0; r += st.red || 0; }
    return { ...t, y, r };
  }).sort((a, b) => b.y - a.y);

  return {
    title: 'Таблица',
    html: `<div class="stack">
      <section class="card">
        <header class="card__head"><h2>Положение</h2><span class="tag">${S.rounds.filter((r) => r.played).length}/${S.rounds.length} туров</span></header>
        <table class="standings">
          <thead><tr><th>#</th><th>Клуб</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>М</th><th>О</th></tr></thead>
          <tbody>${S.table.map((r, i) => `<tr class="${r.key === ctx.account ? 'is-me' : ''} zone-${i}" data-act="club" data-key="${r.key}">
            <td class="rank"><i class="zonebar zonebar--${i}"></i>${i + 1}</td>
            <td class="club">${crest(r.key, r.name, 'crest--sm')}<span>${esc(r.name)}<em>${esc(r.coach)}</em></span></td>
            <td>${r.played}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
            <td class="gm">${r.gf}:${r.ga}<em>${r.gd > 0 ? '+' : ''}${r.gd}</em></td><td><b>${r.pts}</b></td>
          </tr>`).join('')}</tbody>
        </table>
      </section>

      <section class="card">
        <header class="card__head"><h2>Бомбардиры</h2></header>
        ${scorers.length ? `<div class="plist">${scorers.map(([id, v]) => {
          const f = find(id); if (!f) return '';
          return `<button class="prow" data-act="player" data-id="${id}">
            <span class="prow__pos">${v.goals}<small>+</small>${v.assists}</span>
            <span class="prow__name">${esc(f.p.name)}${crest(f.team, '', 'crest--xs')}</span>
            <span class="prow__nums">${ratingChip(f.p.overall)}</span></button>`;
        }).join('')}</div>` : '<p class="muted pad">Голов пока не было.</p>'}
      </section>

      <section class="card">
        <header class="card__head"><h2>Дисциплина</h2></header>
        <div class="disc">${disc.map((d) => `<button class="disc__row" data-act="club" data-key="${d.key}">
          <span>${crest(d.key, d.name, 'crest--sm')}${esc(d.name)}</span>
          <span class="cards"><em class="y"></em>${d.y}<em class="r"></em>${d.r}</span></button>`).join('')}</div>
      </section>
    </div>`,
  };
}

// ---------- календарь ----------
export function renderCalendar(ctx) {
  const { S } = ctx;
  const groups = [];
  for (let i = 0; i < S.rounds.length; i += 5) groups.push(S.rounds.slice(i, i + 5));
  return {
    title: 'Календарь',
    html: `<div class="stack">
      ${groups.map((grp, gi) => `<section class="card">
        <header class="card__head"><h2>${gi * 5 + 1}–${gi * 5 + grp.length}</h2></header>
        <div class="rounds">${grp.map((rd) => `<button class="round ${rd.played ? 'is-done' : ''}" data-act="match" data-idx="${S.rounds.indexOf(rd)}">
          <span class="round__n">${rd.round}</span>
          <span class="round__teams">
            <span class="round__side ${rd.home === ctx.account ? 'is-me' : ''}">${crest(rd.home, nameOf(ctx, rd.home), 'crest--sm')}${esc(nameOf(ctx, rd.home))}</span>
            <span class="round__sc">${rd.played ? `${rd.hs}:${rd.as}` : '·'}</span>
            <span class="round__side right ${rd.away === ctx.account ? 'is-me' : ''}">${esc(nameOf(ctx, rd.away))}${crest(rd.away, nameOf(ctx, rd.away), 'crest--sm')}</span>
          </span>
          <span class="round__act">${rd.played ? icon('chevron', '', 16) : ''}</span>
        </button>`).join('')}</div>
      </section>`).join('')}
    </div>`,
  };
}

// ---------- статистика матча ----------
export function matchSheet(ctx, idx) {
  const { S } = ctx;
  const rd = S.rounds[idx];
  if (!rd) return '';
  const hn = nameOf(ctx, rd.home), an = nameOf(ctx, rd.away);
  if (!rd.played) {
    return sheet(`Тур ${rd.round}`, `<div class="upcoming">
      <div class="up__teams">${crest(rd.home, hn, 'crest--lg')}<b>${esc(hn)}</b><span>—</span><b>${esc(an)}</b>${crest(rd.away, an, 'crest--lg')}</div>
      <p class="muted">Матч ещё не сыгран.</p></div>`);
  }
  const sum = rd.summary || {};
  const st = sum.stats || {};
  const h = st.home || {}, a = st.away || {};
  const poss = st.poss || { home: 50, away: 50 };
  const rows = [
    ['Владение', `${poss.home}%`, `${poss.away}%`, poss.home],
    ['Удары', h.shots, a.shots, h.shots],
    ['В створ', h.sot, a.sot, h.sot],
    ['Сейвы', h.saves, a.saves, h.saves],
    ['Угловые', h.corners, a.corners, h.corners],
    ['Фолы', h.fouls, a.fouls, h.fouls],
    ['Офсайды', h.offsides, a.offsides, h.offsides],
    ['Замены', h.subs, a.subs, h.subs],
  ];
  return sheet(`Тур ${rd.round}`, `<div class="msheet">
    <div class="ms__score">
      <span>${crest(rd.home, hn, 'crest--lg')}<b>${esc(hn)}</b></span>
      <em>${rd.hs} : ${rd.as}</em>
      <span>${crest(rd.away, an, 'crest--lg')}<b>${esc(an)}</b></span>
    </div>
    ${sum.mvp ? `<div class="ms__mvp">${icon('trophy', '', 16)} Лучший игрок: <b>${esc(sum.mvp.player)}</b> · ${sum.mvp.rating}</div>` : ''}
    <h3>Голы</h3>
    ${(sum.scorers || []).length ? `<div class="ms__goals">${sum.scorers.map((g) => `<div class="ms__goal">
        <span>${esc(g.min)}</span><b>${esc(g.player)}</b>${g.assist ? `<em>пас: ${esc(g.assist)}</em>` : ''}${crest(g.team, '', 'crest--xs')}</div>`).join('')}</div>`
      : '<p class="muted">Голов не было.</p>'}
    <h3>Статистика</h3>
    <div class="ms__stats">${rows.map(([label, hv, av, w]) => `<div class="msrow">
        <b>${hv ?? 0}</b><div class="msrow__bar"><i style="width:${Math.round((Number(w) || 0) / Math.max(1, (Number(hv) || 0) + (Number(av) || 0)) * 100)}%"></i></div>
        <span>${esc(label)}</span><div class="msrow__bar rev"><i style="width:${Math.round(((Number(av) || 0)) / Math.max(1, (Number(hv) || 0) + (Number(av) || 0)) * 100)}%"></i></div><b>${av ?? 0}</b>
      </div>`).join('')}</div>
    ${(sum.cards || []).length ? `<h3>Карточки</h3><div class="ms__cards">${sum.cards.map((c) => `<span class="ms__card ${c.kind}"><i></i>${esc(c.player)}${c.min ? ` <em>${esc(c.min)}</em>` : ''}</span>`).join('')}</div>` : ''}
  </div>`);
}

// ---------- карточка игрока ----------
const GK_ROWS = [
  ['overall', 'Общий'], ['goalkeeping_reflexes', 'Реакция'], ['goalkeeping_diving', 'Вытяжка'],
  ['goalkeeping_positioning', 'Позиционирование'], ['pace', 'Скорость'],
  ['attacking_short_passing', 'Игра ногами'], ['power_jumping', 'Игра на выходе'], ['physicality', 'Физика'],
];
const ATTR_ROWS = [
  ['overall', 'Общий'], ['pace', 'Скорость'], ['shooting', 'Удары'], ['passing', 'Пас'],
  ['dribbling', 'Ведение'], ['defending', 'Отбор'], ['physicality', 'Физика'], ['power_stamina', 'Выносливость'],
];
const DETAIL_ROWS = [
  ['attacking_finishing', 'Завершение'], ['mentality_vision', 'Видение'], ['skill_long_passing', 'Длинный пас'],
  ['skill_ball_control', 'Контроль мяча'], ['power_strength', 'Сила'], ['defending_awareness', 'Позиционная игра'],
  ['mentality_aggression', 'Агрессия'], ['mentality_composure', 'Хладнокровие'],
];

export function playerSheet(ctx, id) {
  const { S } = ctx;
  let player = null, ownerKey = null;
  for (const k of Object.keys(S.squads)) {
    const p = [...S.squads[k].raw.starters, ...S.squads[k].raw.bench].find((x) => x.id === id);
    if (p) { player = p; ownerKey = k; break; }
  }
  if (!player) return '';
  const st = S.playerStats[id] || {};
  const club = S.teams.find((t) => t.key === ownerKey);
  const rows = [...(player.pos === 'GK' ? GK_ROWS : ATTR_ROWS), ...DETAIL_ROWS].map(([k, label]) => [label, player[k]]);
  return sheet(player.name, `<div class="pd">
    <div class="pd__top"><span class="pd__ov">${player.overall}</span>
      <div><b>${esc(player.name)}</b>
        <span>${esc(player.pos)} · ${esc(player.nationality)}${player.age ? ` · ${player.age} лет` : ''}</span>
        <span class="pd__club">${crest(ownerKey, club?.name, 'crest--xs')} ${esc(club?.name || '')} · ${esc(club?.coach || '')}</span></div></div>
    ${S.injuries[id] ? `<p class="danger">${icon('injury', '', 16)} Травма: ещё ${S.injuries[id]} тур(ов).</p>` : ''}
    <div class="grid2">${rows.map(([label, v]) => `<div class="attr"><span>${esc(label)}</span>${bar(v, { max: 100 })}<b>${v ?? 0}</b></div>`).join('')}</div>
    <h3>Сезон</h3>
    <div class="season-grid">${[['Матчи', st.apps || 0], ['Голы', st.goals || 0], ['Пасы', st.assists || 0],
      ['Минуты', st.mins || 0], ['Оценка', st.ratingN ? (st.ratingSum / st.ratingN).toFixed(2) : '—'],
      ['Ж/К', `${st.yellow || 0}/${st.red || 0}`], ['Обводки', st.dribbles || 0], ['Отборы', st.tackles || 0],
      ['Сейвы', st.saves || 0], ['Фолы', st.fouls || 0]].map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('')}</div>
  </div>`);
}
