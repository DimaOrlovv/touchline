import { esc } from './dom.js';

let toastTimer = null;

export function toast(message, tone = '') {
  let host = document.querySelector('.toast');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast';
    host.setAttribute('role', 'status');
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.className = `toast is-on ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('is-on'), 2800);
}

/** Свой диалог вместо window.confirm. */
export function confirmDialog({ title, text = '', ok = 'Подтвердить', cancel = 'Отмена', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="modal"><div class="modal__backdrop"></div>
      <div class="modal__panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ''}
        <div class="modal__row">
          <button class="btn btn--ghost" data-x="no">${esc(cancel)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-x="yes">${esc(ok)}</button>
        </div>
      </div></div>`;
    document.body.appendChild(wrap);
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-x="yes"]')) return close(true);
      if (e.target.closest('[data-x="no"]') || e.target.closest('.modal__backdrop')) return close(false);
    });
    requestAnimationFrame(() => wrap.querySelector('.modal__panel').classList.add('is-in'));
  });
}

export const spinner = (size = 16) =>
  `<svg class="spin" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2.5"/>
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;

export function skeletonList(rows = 5) {
  return `<div class="sk-stack">${Array.from({ length: rows }, (_, i) => `<div class="sk sk--row" style="animation-delay:${i * 70}ms"></div>`).join('')}</div>`;
}

export function skeletonCard(title = '') {
  return `<section class="card"><header class="card__head"><h2>${esc(title)}</h2></header>
    <div class="sk-pad"><div class="sk sk--lg"></div><div class="sk"></div><div class="sk sk--sm"></div></div></section>`;
}
