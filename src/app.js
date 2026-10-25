import { api, settings } from './state/api.js';
import { renderLogin, renderHome, renderSquad, renderTable, renderCalendar, playerSheet, matchSheet, styleSheet, crest } from './ui/screens.js';
import { LiveView } from './ui/live.js';
import { icon } from './ui/icons.js';
import { esc, sheet } from './ui/dom.js';
import { toast, confirmDialog, spinner, skeletonList, skeletonCard } from './ui/feedback.js';

const TABS = [
  ['home', 'Матч', 'home'],
  ['squad', 'Состав', 'squad'],
  ['table', 'Таблица', 'table'],
  ['calendar', 'Календарь', 'calendar'],
];
const ROUTE_MIN = 130;

const app = document.getElementById('app');
const ctx = {
  S: null, account: null, clubKey: null, draftSlots: null, dirty: false, busy: false,
  remember: !!localStorage.getItem('touchline.token'),
  listeners: { event: new Set(), live: new Set() },
  onEvent(fn) { this.listeners.event.add(fn); return () => this.listeners.event.delete(fn); },
  onLive(fn) { this.listeners.live.add(fn); return () => this.listeners.live.delete(fn); },
};

let route = 'home';
let live = null;
let es = null;

// ---------- загрузка и подписка ----------
async function boot() {
  if (!api.hasToken) return showLogin();
  try {
    const S = await api.state();
    applyState(S);
    connect();
    mountCurrent();
  } catch (err) {
    if (err.status === 401) api.forget();
    showLogin(err.status === 401 ? '' : String(err.message || err));
  }
}

function connect() {
  es?.close();
  es = api.stream({
    state: (S) => { if (S) { applyState(S); if (route === 'live') live?.syncFrom(ctx.S.live); refresh(); } },
    hello: (S) => { if (S) { applyState(S); if (route === 'live') live?.syncFrom(ctx.S.live); refresh(); } },
    event: (ev) => { for (const fn of ctx.listeners.event) fn(ev); },
    live: (l) => {
      const prev = ctx.S?.live?.status;
      if (ctx.S) ctx.S.live = l;
      for (const fn of ctx.listeners.live) fn(l);
      if (!l && route === 'live') setTimeout(() => go('home'), 1200);
      const plays = l && ctx.account && (l.home === ctx.account || l.away === ctx.account);
      const inProgress = ['running', 'halftime'].includes(l?.status);
      if (plays && inProgress && !['running', 'halftime'].includes(prev) && route !== 'live') openLive();
      if (route === 'live') live?.syncFrom(l);
      refresh();
    },
    match_end: (msg) => {
      for (const fn of ctx.listeners.live) fn(null);
      if (msg?.summary) toast(`${nameOf(msg.summary.home)} ${msg.summary.hs}:${msg.summary.as} ${nameOf(msg.summary.away)}`);
    },
    onError: () => { /* EventSource сам переподключается */ },
  });
}

function applyState(S) {
  ctx.S = S;
  ctx.account = S.account;
  if (!ctx.clubKey || !S.squads[ctx.clubKey]) ctx.clubKey = S.account;
  // черновик держим до сохранения: серверные обновления не должны его затирать
  if (!ctx.draftSlots) ctx.draftSlots = S.lineups[S.account]?.slots?.map((s) => ({ ...s })) || null;
}

function mountCurrent() {
  const fromHash = (location.hash || '').replace(/^#\//, '').split('/')[0];
  if (['home', 'squad', 'table', 'calendar'].includes(fromHash)) route = fromHash;
  else { route = 'home'; location.hash = '#/home'; }
  shell(skeletonFor(route));
  document.querySelector('.topbar__title').textContent = titleOf();
  setTimeout(refresh, ROUTE_MIN);
}

const nameOf = (key) => ctx.S?.teams.find((t) => t.key === key)?.name || key;

function refresh() {
  if (route === 'live' || route === 'login') return;
  const view = document.getElementById('view');
  if (!view) return;
  const scroll = view.scrollTop;
  view.innerHTML = screenHtml();
  wireView(view);
  view.scrollTop = scroll;
}

// ---------- отрисовка ----------
function shell(inner, { chrome = true, bare = false, full = false } = {}) {
  const club = ctx.S?.squads[ctx.account];
  app.innerHTML = `<div class="app ${bare ? 'is-bare' : ''} ${full ? 'is-full' : ''}">
    ${chrome ? `<header class="topbar">
      <button class="topbar__back" data-act="account" aria-label="Аккаунт">${club ? crest(club.key, club.name, 'crest--sm') : ''}<span>${esc(ctx.S?.teams.find((t) => t.key === ctx.account)?.name || '')}</span></button>
      <span class="topbar__title" data-el="title"></span>
      <span class="topbar__right" data-el="busy"></span></header>` : ''}
    <main id="view" class="view">${inner}</main>
    ${chrome ? `<nav class="tabbar">${TABS.map(([r, label, ic]) => `<button class="tab ${r === route ? 'is-on' : ''}" data-act="go" data-route="${r}">
      ${icon(ic, '', 24)}<span>${label}</span></button>`).join('')}</nav>` : ''}
  </div>`;
}

function screenHtml() {
  if (route === 'home') return renderHome(ctx).html;
  if (route === 'squad') return renderSquad(ctx).html;
  if (route === 'table') return renderTable(ctx).html;
  if (route === 'calendar') return renderCalendar(ctx).html;
  return '';
}

function titleOf() {
  return { home: 'Матч', squad: 'Состав', table: 'Таблица', calendar: 'Календарь' }[route] || '';
}

function go(next) {
  if (next === route) return;
  const dir = TABS.findIndex((t) => t[0] === next) >= TABS.findIndex((t) => t[0] === route) ? 'right' : 'left';
  route = next;
  location.hash = `#/${next}`;
  shell(skeletonFor(next));
  document.querySelector('.topbar__title').textContent = titleOf();
  const view = document.getElementById('view');
  view.classList.add(`enter-${dir}`);
  setTimeout(() => {
    view.innerHTML = screenHtml();
    view.classList.remove(`enter-${dir}`);
    wireView(view);
  }, ROUTE_MIN);
}

function skeletonFor(r) {
  if (r === 'squad') return `<div class="stack">${skeletonCard('Стартовый XI')}${skeletonCard('Запас')}</div>`;
  if (r === 'table') return `<div class="stack">${skeletonCard('Положение')}${skeletonCard('Бомбардиры')}</div>`;
  if (r === 'calendar') return `<div class="stack">${skeletonCard('Туры')}${skeletonCard('Туры')}</div>`;
  return `<div class="stack">${skeletonCard()}${skeletonList(4)}</div>`;
}

function showLogin(error) {
  route = 'login';
  app.innerHTML = `<div class="app is-bare"><main id="view" class="view">${renderLogin({ ...ctx, error }).html}</main></div>`;
  const form = app.querySelector('form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = `${spinner(18)} Проверяю`;
    try {
      const d = await api.login(String(fd.get('login') || ''), !!fd.get('remember'));
      ctx.remember = !!fd.get('remember');
      toast(`Добро пожаловать, ${d.coach}`);
      applyState(await api.state());
      connect();
      route = 'home';
      location.hash = '#/home';
      mountCurrent();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Войти';
      form.parentElement.querySelector('.form-error')?.remove();
      form.insertAdjacentHTML('beforeend', `<p class="form-error">${esc(err.message)}</p>`);
      form.querySelector('input').focus();
    }
  });
}

function openLive() {
  route = 'live';
  location.hash = '#/live';
  shell('<div class="stack">' + skeletonList(6) + '</div>', { chrome: false, full: true });
  app.insertAdjacentHTML('afterbegin', `<header class="topbar topbar--live">
    <button class="topbar__back" data-act="leave-live">${icon('chevron', 'flip', 20)}<span>Назад</span></button>
    <span class="topbar__title">Трансляция</span><span class="topbar__right"></span></header>`);
  const view = document.getElementById('view');
  view.classList.add('view--live');
  live?.destroy();
  live = new LiveView(ctx);
  live.mount(view);
}

// ---------- шторки ----------
function openSheet(html) {
  document.querySelectorAll('.sheet').forEach((n) => n.remove());
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const node = wrap.firstElementChild;
  document.body.appendChild(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-open')));
  node.querySelector('[data-act="close-sheet"]')?.addEventListener('click', closeSheet);
  node.querySelector('.sheet__backdrop')?.addEventListener('click', closeSheet);
}
function closeSheet() {
  const s = document.querySelector('.sheet');
  if (!s) return;
  s.classList.remove('is-open');
  setTimeout(() => s.remove(), 240);
}

function accountSheet() {
  const club = ctx.S?.squads[ctx.account];
  const llm = settings.llm;
  const body = `<div class="acctsheet">
    <div class="acctsheet__club">${crest(ctx.account, club?.name, 'crest--lg')}
      <div><b>${esc(club?.name || '')}</b><span>${esc(club?.coach || '')}</span></div></div>
    <div class="rowline"><span>Туров сыграно</span><span>${ctx.S.rounds.filter((r) => r.played).length}/${ctx.S.rounds.length}</span></div>
    <h3>Комментатор</h3>
    <label class="switch"><span>OpenRouter вместо локальных фраз</span><input type="checkbox" id="llmon" ${llm.on ? 'checked' : ''}><i></i></label>
    <div class="field"><label for="llk">API-ключ</label><input id="llk" type="password" spellcheck="false" placeholder="sk-or-…" value="${esc(llm.key || '')}"></div>
    <div class="field"><label for="llm2">Модель</label><input id="llm2" type="text" placeholder="meta-llama/llama-3.3-70b-instruct:free" value="${esc(llm.model || '')}"></div>
    <div class="actions">
      <button class="btn" data-act="llm-models">Бесплатные модели</button>
      <button class="btn" data-act="llm-test">Проверить</button>
    </div>
    <h3>Сезон</h3>
    <div class="actions">
      <button class="btn btn--danger" data-act="reset">Сбросить сезон</button>
      <button class="btn btn--ghost" data-act="logout">Выйти</button>
    </div>
  </div>`;
  openSheet(sheet('Аккаунт', body));
  const save = () => settings.llm = {
    on: document.getElementById('llmon')?.checked,
    key: document.getElementById('llk')?.value.trim(),
    model: document.getElementById('llm2')?.value.trim(),
  };
  ['llmon', 'llk', 'llm2'].forEach((id) => document.getElementById(id)?.addEventListener('change', save));
}

// ---------- перетаскивание состава ----------
function wireLineup(view) {
  if (route !== 'squad' || ctx.clubKey !== ctx.account) return;
  const scroller = view;
  let drag = null;
  let raf = null;

  const playerById = (id) => {
    const club = ctx.S.squads[ctx.account];
    return [...club.raw.starters, ...club.raw.bench].find((p) => p.id === id);
  };

  const gkRule = (player, pos) => {
    if (pos === 'GK' && player.pos !== 'GK') { toast('В ворота поставь вратаря'); return false; }
    if (player.pos === 'GK' && pos !== 'GK') { toast('Вратарь играет только на позиции GK'); return false; }
    return true;
  };

  const swap = (fromId, toId) => {
    const list = ctx.draftSlots;
    const fi = list.findIndex((x) => x.id === fromId);
    const ti = list.findIndex((x) => x.id === toId);
    const fp = playerById(fromId);
    const tp = playerById(toId);
    if (!fp || !tp) return;
    if (fi >= 0 && ti >= 0) {
      if (!gkRule(tp, list[fi].pos) || !gkRule(fp, list[ti].pos)) return;
      const tmp = list[fi].id;
      list[fi].id = list[ti].id;
      list[ti].id = tmp;
    } else if (fi >= 0) {
      if (!gkRule(tp, list[fi].pos)) return;
      list[fi] = { id: toId, pos: list[fi].pos };
    } else if (ti >= 0) {
      if (!gkRule(fp, list[ti].pos)) return;
      list[ti] = { id: fromId, pos: list[ti].pos };
    } else return;
    ctx.dirty = true;
    refresh();
  };

  const rowUnder = (x, y) => document.elementFromPoint(x, y)?.closest('[data-prow]') || nearestRow(x, y);

  const nearestRow = (x, y) => {
    const rows = [...view.querySelectorAll('[data-prow]')].filter((n) => n !== drag?.row);
    if (!rows.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const n of rows) {
      const r = n.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return n;
      const d = Math.abs(r.top + r.height / 2 - y);
      if (d < bestDist) { bestDist = d; best = n; }
    }
    return bestDist < 90 ? best : null;
  };

  const setOver = (node) => {
    view.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
    if (!drag) return;
    const hit = node && node.dataset.prow !== drag.id ? node : null;
    if (hit) { hit.classList.add('is-over'); drag.overId = hit.dataset.prow; }
  };

  const placeGhost = () => {
    const shift = scroller.scrollTop - drag.scroll0;
    drag.ghost.style.transform = `translate(${drag.dx}px, ${drag.dy - shift}px)`;
  };

  // тянем к верхнему/нижнему краю — список сам едет навстречу
  const autoScroll = () => {
    if (!drag || !drag.moved) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 78;
    let dy = 0;
    if (drag.y < rect.top + edge) dy = -Math.min(18, (rect.top + edge - drag.y) / 2.5);
    else if (drag.y > rect.bottom - edge) dy = Math.min(18, (drag.y - (rect.bottom - edge)) / 2.5);
    if (dy) {
      scroller.scrollTop += dy;
      placeGhost();
      setOver(rowUnder(drag.x, drag.y));
    }
    raf = requestAnimationFrame(autoScroll);
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (!drag) return;
    drag.ghost?.remove();
    drag.row?.classList.remove('is-dragging');
    view.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
    drag = null;
  };

  view.querySelectorAll('[data-prow]').forEach((row) => {
    row.addEventListener('pointerdown', (e) => {
      const fromGrip = !!e.target.closest('.grip');
      if (e.button || (e.pointerType !== 'mouse' && !fromGrip)) return;
      const rect = row.getBoundingClientRect();
      drag = {
        id: row.dataset.prow, row, x: e.clientX, y: e.clientY,
        startX: e.clientX, startY: e.clientY, dx: 0, dy: 0,
        left: rect.left, top: rect.top, moved: false, ghost: null, scroll0: scroller.scrollTop,
      };
      row.setPointerCapture?.(e.pointerId);
    });

    row.addEventListener('pointermove', (e) => {
      if (!drag || drag.row !== row) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.ghost = row.cloneNode(true);
        drag.ghost.classList.add('prow--ghost');
        drag.ghost.style.left = `${drag.left}px`;
        drag.ghost.style.top = `${drag.top}px`;
        drag.ghost.style.width = `${row.offsetWidth}px`;
        document.body.appendChild(drag.ghost);
        row.classList.add('is-dragging');
        raf = requestAnimationFrame(autoScroll);
      }
      drag.dx = e.clientX - drag.left;
      drag.dy = e.clientY - drag.top;
      placeGhost();
      setOver(rowUnder(e.clientX, e.clientY));
      e.preventDefault();
    }, { passive: false });

    row.addEventListener('pointerup', (e) => {
      if (!drag || drag.row !== row) return;
      const wasDrag = drag.moved;
      const target = wasDrag ? (drag.overId || rowUnder(e.clientX, e.clientY)?.dataset.prow) || null : null;
      const id = row.dataset.prow;
      stop();
      if (wasDrag) {
        if (target && target !== id) swap(id, target);
        else toast('Отпусти игрока на другом — так они поменяются местами');
        return;
      }
      openSheet(playerSheet(ctx, id));
    });

    row.addEventListener('pointercancel', stop);
  });
}

function wireView(view) {
  wireLineup(view);
}

// ---------- действия ----------
const actions = {
  go: (t) => go(t.dataset.route),
  account: () => accountSheet(),
  watch: () => openLive(),
  'leave-live': () => { live?.destroy(); live = null; route = 'live'; go('home'); },
  async ready(t) {
    try {
      const r = await api.ready(ctx.S.roundIdx);
      if (r.error) return toast(r.error);
      toast('Готов. Ждём второго тренера…');
      applyState(await api.state());
      refresh();
    } catch (err) { toast(err.message); }
  },
  match: (t) => openSheet(matchSheet(ctx, Number(t.dataset.idx))),
  player: (t) => openSheet(playerSheet(ctx, t.dataset.id)),
  styles: () => openSheet(styleSheet(ctx)),
  async style(t) {
    const id = t.dataset.id;
    try {
      await api.setStyle(id);
      if (ctx.S) ctx.S.styles = { ...ctx.S.styles, [ctx.account]: id };
      closeSheet();
      refresh();
      toast(`Стиль: ${t.querySelector('b')?.textContent || id}`);
    } catch (err) { toast(err.message); }
  },
  club: (t) => { ctx.clubKey = t.dataset.key; ctx.draftSlots = ctx.S.lineups[t.dataset.key]?.slots?.map((s) => ({ ...s })) || null; ctx.dirty = false; go('squad'); refresh(); },
  async 'save-xi'() {
    if (!ctx.dirty) return;
    try {
      await api.saveXi(ctx.draftSlots);
      ctx.dirty = false;
      applyState(await api.state());
      refresh();
      toast('Состав сохранён');
    } catch (err) { toast(err.message); }
  },
  async reset() {
    const ok = await confirmDialog({ title: 'Сбросить сезон?', text: 'Турнирная таблица, статистика игроков и составы обнулятся.', ok: 'Сбросить', danger: true });
    if (!ok) return;
    closeSheet();
    await api.reset();
    applyState(await api.state());
    refresh();
    toast('Новый сезон: 30 туров');
  },
  async logout() {
    const ok = await confirmDialog({ title: 'Выйти?', text: 'Данные сезона останутся на сервере.', ok: 'Выйти' });
    if (!ok) return;
    closeSheet();
    await api.logout();
    live?.destroy();
    showLogin();
  },
  async 'llm-models'() {
    const key = document.getElementById('llk')?.value.trim();
    if (!key) return toast('Сначала введите ключ');
    toast('Запрашиваю список…');
    try {
      const { listFreeModels } = await import('./engine/llm.js');
      const models = await listFreeModels(key);
      toast(`Бесплатных моделей: ${models.length}`);
      const input = document.getElementById('llm2');
      if (input && models[0]) { input.value = models[0].id; input.setAttribute('list', 'freemodels'); }
      let dl = document.getElementById('freemodels');
      if (!dl) { dl = document.createElement('datalist'); dl.id = 'freemodels'; document.body.appendChild(dl); }
      dl.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    } catch (e) { toast(`Ошибка: ${e.message}`); }
  },
  async 'llm-test'() {
    const key = document.getElementById('llk')?.value.trim();
    const model = document.getElementById('llm2')?.value.trim();
    if (!key) return toast('Нужен ключ');
    toast('Проверяю связь…');
    try {
      const { rewriteEvents } = await import('./engine/llm.js');
      const r = await rewriteEvents({
        apiKey: key, model: model || 'meta-llama/llama-3.3-70b-instruct:free', tone: 'нейтрально',
        events: [{ id: 1, clock: '57:12', type: 'goal', text: 'ГОЛ! K. Mbappe завершает контратаку после передачи Rodri.' }],
        score: '1:2', minute: 57,
      });
      toast(r ? `Модель: ${r[0].text.slice(0, 70)}` : 'Модель не ответила');
    } catch (e) { toast(`Ошибка: ${String(e.message).slice(0, 70)}`); }
  },
};

document.addEventListener('click', (e) => {
  const row = e.target.closest('.prow[data-prow]');
  if (row && route === 'squad' && ctx.clubKey !== ctx.account) { openSheet(playerSheet(ctx, row.dataset.prow)); return; }
  const t = e.target.closest('[data-act]');
  if (!t || ['INPUT', 'SELECT'].includes(t.tagName)) return;
  const fn = actions[t.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(t, e);
});



window.addEventListener('hashchange', () => {
  const r = (location.hash || '#/home').replace(/^#\//, '').split('/')[0];
  if (r !== route && r !== 'live' && r !== 'login') { route = r; shell(skeletonFor(r)); document.querySelector('.topbar__title').textContent = titleOf(); setTimeout(refresh, 40); }
});

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); toast('Приложение можно установить из меню браузера'); });

boot();
