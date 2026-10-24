import io

p = 'src/app.js'
s = io.open(p, encoding='utf-8').read()

old_setover = """  const setOver = (node) => {
    view.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
    if (node && drag && node.dataset.prow !== drag.id) node.classList.add('is-over');
  };"""
new_setover = """  const nearestRow = (x, y) => {
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
  };"""
assert old_setover in s
s = s.replace(old_setover, new_setover)

# в autoScroll и в move ищем ряд через nearestRow, а не только ровно под курсором
s = s.replace("""      scroller.scrollTop += dy;
      placeGhost();
      setOver(document.elementFromPoint(drag.x, drag.y)?.closest('[data-prow]'));""",
"""      scroller.scrollTop += dy;
      placeGhost();
      setOver(rowUnder(drag.x, drag.y));""")
s = s.replace("""      placeGhost();
      setOver(document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-prow]'));
      e.preventDefault();""",
"""      placeGhost();
      setOver(rowUnder(e.clientX, e.clientY));
      e.preventDefault();""")

# хелпер rowUnder: элемент под курсором (призрак не перехватывает) или ближайший по вертикали
s = s.replace("""  const nearestRow = (x, y) => {""",
"""  const rowUnder = (x, y) => document.elementFromPoint(x, y)?.closest('[data-prow]') || nearestRow(x, y);

  const nearestRow = (x, y) => {""")

old_up = """    row.addEventListener('pointerup', (e) => {
      if (!drag || drag.row !== row) return;
      const wasDrag = drag.moved;
      const target = wasDrag ? document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-prow]')?.dataset.prow : null;
      const id = row.dataset.prow;
      stop();
      if (wasDrag) { if (target && target !== id) swap(id, target); return; }
      openSheet(playerSheet(ctx, id));
    });"""
new_up = """    row.addEventListener('pointerup', (e) => {
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
    });"""
assert old_up in s
s = s.replace(old_up, new_up)

# stop() обнуляет drag после чтения overId — убедимся, что stop не вызывается раньше чтения
s = s.replace("""  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (!drag) return;
    drag.ghost?.remove();""",
"""  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (!drag) return;
    drag.ghost?.remove();""")

io.open(p, 'w', encoding='utf-8').write(s)
print('patched app.js')
