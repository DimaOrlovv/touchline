import { esc } from './dom.js';
import { icon, EVENT_ICON } from './icons.js';
import { crest } from './screens.js';
import { spinner, toast } from './feedback.js';
import { settings } from '../state/api.js';
import { rewriteEvents, FALLBACK_MODEL } from '../engine/llm.js';

const AI_TYPES = ['goal', 'save', 'red', 'sub', 'injury', 'ht', 'ft', 'post'];
const STICK_PX = 130;

const plural = (n) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'новое';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'новых';
  return 'новых';
};

export class LiveView {
  constructor(ctx) {
    this.ctx = ctx;
    this.seen = 0;
    this.stuck = true;
    this.buffered = 0;
    this.clock = '00:00';
    this.aiQueue = [];
    this.aiBusy = false;
    this.aiOff = false;
  }

  mount(host) {
    this.host = host;
    const live = this.ctx.S.live;
    if (!live) { host.innerHTML = `<div class="empty">${icon('clock', '', 22)}<p>Матч ещё не начался.</p></div>`; return; }
    this.aKey = live.home; this.bKey = live.away;
    host.innerHTML = `<div class="live">
      <header class="score">
        <div class="score__side">${crest(live.home, this.name(live.home), 'crest--lg')}<b>${esc(this.name(live.home))}</b></div>
        <div class="score__mid"><span class="score__num" data-el="score">0:0</span>
          <span class="score__clock" data-el="clock">00:00</span><span class="score__state" data-el="state"></span></div>
        <div class="score__side right"><b>${esc(this.name(live.away))}</b>${crest(live.away, this.name(live.away), 'crest--lg')}</div>
      </header>
      <div class="feedwrap">
        <div class="feed" data-el="feed"></div>
        <button class="newpill" data-el="pill" hidden>${icon('chevron', 'down', 14)}<span data-el="pilltext">Вниз</span></button>
      </div>
      <div class="live-wait" data-el="wait" hidden>${spinner(16)}<span data-el="waittext">Ожидание</span></div>
    </div>`;
    this.el = (n) => this.host.querySelector(`[data-el="${n}"]`);
    this.feedEl = this.el('feed');
    this.feedEl.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.el('pill').addEventListener('click', () => { this.stuck = true; this.scrollToEnd(); this.renderPill(); });

    for (const ev of live.events || []) this.addLine(ev, true);
    this.clock = live.events?.length ? live.events[live.events.length - 1].clock : '00:00';
    this.setStatus(live);
    this.scrollToEnd();
    this.unsub = this.ctx.onEvent((ev) => this.addLine(ev));
    this.unsubLive = this.ctx.onLive((l) => this.setStatus(l));
  }

  name(key) { return this.ctx.S.teams.find((t) => t.key === key)?.name || key; }

  /** После переподключения SSE или долгого фона догоняем то, что не прилетело. */
  syncFrom(live) {
    if (!live || !this.feedEl) return;
    const missing = (live.events || []).filter((e) => e.id > this.seen);
    for (const ev of missing) this.addLine(ev, true);
    if (live.events?.length) {
      this.clock = live.events[live.events.length - 1].clock;
      this.el('clock').textContent = this.clock;
    }
    this.setStatus(live);
    if (missing.length && this.stuck) this.scrollToEnd();
  }

  onScroll() {
    const f = this.feedEl;
    this.stuck = f.scrollHeight - f.scrollTop - f.clientHeight < STICK_PX;
    if (this.stuck) { this.buffered = 0; this.renderPill(); }
  }

  scrollToEnd() {
    const f = this.feedEl;
    if (f) f.scrollTop = f.scrollHeight;
  }

  renderPill() {
    const pill = this.el('pill');
    if (!pill) return;
    pill.hidden = this.stuck || !this.buffered;
    this.el('pilltext').textContent = this.buffered ? `${this.buffered} ${plural(this.buffered)}` : 'Вниз';
  }

  /** Счёт и часы — только из серверного состояния, чтобы у обоих тренеров они совпадали. */
  setStatus(live) {
    const wait = this.el('wait');
    if (!wait) return;
    const l = live || this.ctx.S.live;
    if (!l) { wait.hidden = true; this.el('state').textContent = ''; return; }
    if (l.score) this.el('score').textContent = `${l.score[0]}:${l.score[1]}`;
    if (l.status === 'running') {
      wait.hidden = true;
      this.el('state').textContent = parseInt(this.clock, 10) > 45 ? 'второй тайм' : 'первый тайм';
      return;
    }
    if (l.status === 'done') {
      wait.hidden = true;
      this.el('state').textContent = 'матч окончен';
      return;
    }
    const missing = [l.home, l.away].filter((k) => !l.ready?.[k]);
    this.el('state').textContent = 'ожидание старта';
    wait.hidden = false;
    this.el('waittext').textContent = missing.length
      ? `Ждём: ${missing.map((k) => this.name(k)).join(', ')}`
      : 'Запускаем матч…';
  }

  addLine(ev, instant = false) {
    if (!this.feedEl) return;
    if (ev.id && ev.id <= this.seen) return;
    this.seen = ev.id || this.seen + 1;
    const side = ev.teamKey ? (ev.teamKey === this.aKey ? 'left' : 'right') : 'neutral';
    const item = document.createElement('div');
    item.className = `ev ev--${ev.type} ev--${side}${instant ? ' is-instant' : ''}`;
    item.dataset.eid = ev.id || '';
    item.innerHTML = `<span class="ev__min">${esc(ev.clock)}</span>
      <span class="ev__ic">${icon(EVENT_ICON[ev.type] || 'spark', '', 18)}</span>
      <p class="ev__txt">${esc(ev.text)}</p>
      ${ev.type === 'goal' && ev.score ? `<span class="ev__sc">${ev.score.join(':')}</span>` : ''}`;
    this.feedEl.appendChild(item);
    this.clock = ev.clock;
    this.el('clock').textContent = ev.clock;

    if (ev.score) {
      const s = this.el('score');
      const next = `${ev.score[0]}:${ev.score[1]}`;
      if (s.textContent !== next) {
        s.textContent = next;
        if (!instant) { s.classList.add('is-pop'); setTimeout(() => s.classList.remove('is-pop'), 900); }
      }
    }
    if (instant) return;
    if (this.stuck) this.scrollToEnd();
    else { this.buffered += 1; this.renderPill(); }
    this.maybeAi(ev);
  }

  maybeAi(ev) {
    const llm = settings.llm;
    if (!llm.on || !llm.key || this.aiOff || !AI_TYPES.includes(ev.type)) return;
    this.aiQueue.push(ev);
    if (this.aiQueue.length >= (ev.type === 'goal' ? 1 : 5)) this.flushAi();
  }

  async flushAi() {
    if (this.aiBusy || !this.aiQueue.length) return;
    const batch = this.aiQueue.splice(0, this.aiQueue.length);
    this.aiBusy = true;
    const llm = settings.llm;
    try {
      const res = await rewriteEvents({
        apiKey: llm.key, model: llm.model || FALLBACK_MODEL, tone: llm.tone || 'нейтрально', events: batch,
        score: `${this.ctx.S.live?.score?.[0] ?? 0}:${this.ctx.S.live?.score?.[1] ?? 0}`,
        minute: parseInt(this.clock, 10) || 0,
      });
      if (!res) return;
      for (const r of res) {
        const node = this.feedEl?.querySelector(`[data-eid="${r.id}"] .ev__txt`);
        if (node) { node.textContent = r.text; node.closest('.ev').classList.add('is-ai'); }
      }
    } catch (err) {
      this.aiOff = true;
      toast(`ИИ-комментатор отключён: ${String(err.message || err).slice(0, 50)}`);
    } finally {
      this.aiBusy = false;
    }
  }

  destroy() { this.unsub?.(); this.unsubLive?.(); }
}
