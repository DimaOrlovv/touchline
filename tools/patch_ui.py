import io, re

APP = 'src/app.js'
CSS = 'src/styles.css'

NEW_WIRE = '''function wireLineup(view) {
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

  const setOver = (node) => {
    view.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
    if (node && drag && node.dataset.prow !== drag.id) node.classList.add('is-over');
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
      setOver(document.elementFromPoint(drag.x, drag.y)?.closest('[data-prow]'));
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
      setOver(document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-prow]'));
      e.preventDefault();
    }, { passive: false });

    row.addEventListener('pointerup', (e) => {
      if (!drag || drag.row !== row) return;
      const wasDrag = drag.moved;
      const target = wasDrag ? document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-prow]')?.dataset.prow : null;
      const id = row.dataset.prow;
      stop();
      if (wasDrag) { if (target && target !== id) swap(id, target); return; }
      openSheet(playerSheet(ctx, id));
    });

    row.addEventListener('pointercancel', stop);
  });
}

'''

app = io.open(APP, encoding='utf-8').read()
start = app.index('function wireLineup(view) {')
end = app.index('function wireView(view) {')
app = app[:start] + NEW_WIRE + app[end:]

old_live = """    live: (l) => {
      if (ctx.S) ctx.S.live = l;
      for (const fn of ctx.listeners.live) fn(l);
      if (!l && route === 'live') setTimeout(() => go('home'), 1200);
      refresh();
    },"""
new_live = """    live: (l) => {
      const prev = ctx.S?.live?.status;
      if (ctx.S) ctx.S.live = l;
      for (const fn of ctx.listeners.live) fn(l);
      if (!l && route === 'live') setTimeout(() => go('home'), 1200);
      const plays = l && ctx.account && (l.home === ctx.account || l.away === ctx.account);
      if (plays && l.status === 'running' && prev !== 'running' && route !== 'live') openLive();
      refresh();
    },"""
assert old_live in app
app = app.replace(old_live, new_live)
io.open(APP, 'w', encoding='utf-8').write(app)

css = io.open(CSS, encoding='utf-8').read()
pairs = [
  (".grip { width: 14px; height: 22px; background-image: radial-gradient(currentColor 1.2px, transparent 1.3px); background-size: 7px 7px; background-position: 0 3px; background-repeat: no-repeat; color: var(--ink-3); }",
   ".grip { width: 22px; height: 30px; margin: -10px 0; background-image: radial-gradient(currentColor 1.3px, transparent 1.4px); background-size: 7px 7px; background-position: 6px 5px; background-repeat: no-repeat; color: var(--ink-3); touch-action: none; cursor: grab; }"),
  (".prow--ghost { position: fixed; z-index: 70; width: 88vw; max-width: 340px; background: var(--bg); border: 1px solid var(--accent); pointer-events: none; opacity: .96; }",
   ".prow--ghost { position: fixed; z-index: 70; background: var(--bg); border: 1px solid var(--accent); pointer-events: none; opacity: .97; }"),
  ("  display: grid; grid-template-columns: 14px 38px 1fr auto;",
   "  display: grid; grid-template-columns: 22px 38px 1fr auto;"),
]
for a, b in pairs:
    assert a in css, a[:60]
    css = css.replace(a, b, 1)
io.open(CSS, 'w', encoding='utf-8').write(css)
print('патч применён')
