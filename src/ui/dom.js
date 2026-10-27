export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const el = (tag, attrs = {}, kids = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
};

export const teamTone = (key) => ({
  psg: 'psg', barcelona: 'fcb', real_madrid: 'rma', arsenal: 'ars',
  manchester_city: 'mci', bayern_munich: 'bay', liverpool: 'liv',
  chelsea: 'che', atletico_madrid: 'atm', inter_milan: 'int',
}[key] || 'psg');

export function bar(value, { max = 100, tone = '' } = {}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="bar ${tone}"><i style="width:${pct.toFixed(1)}%"></i></span>`;
}

export function ratingChip(v, cls = '') {
  if (v == null) return `<span class="ov ${cls}">—</span>`;
  const tone = v >= 88 ? 'hi' : v >= 83 ? 'mid' : v >= 76 ? '' : 'lo';
  return `<span class="ov ${cls} ${tone}">${Math.round(v * 10) / 10}</span>`;
}

export function sheet(title, bodyHtml, footerHtml = '') {
  return `<div class="sheet" data-act="close-sheet">
    <div class="sheet__backdrop"></div>
    <div class="sheet__panel" role="dialog" aria-label="${esc(title)}">
      <header class="sheet__head"><h2>${esc(title)}</h2>
        <button class="icon-btn" data-act="close-sheet" aria-label="Закрыть">${iconClose()}</button></header>
      <div class="sheet__body">${bodyHtml}</div>
      ${footerHtml ? `<footer class="sheet__foot">${footerHtml}</footer>` : ''}
    </div></div>`;
}

const iconClose = () => '<svg width="20" height="20" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/></svg>';

export function toast(msg) {
  let host = document.querySelector('.toast');
  if (!host) { host = el('div', { class: 'toast' }); document.body.appendChild(host); }
  host.textContent = msg;
  host.classList.add('is-on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => host.classList.remove('is-on'), 2600);
}
