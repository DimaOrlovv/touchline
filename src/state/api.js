const LS_KEY = 'touchline.token';

let token = localStorage.getItem(LS_KEY) || sessionStorage.getItem(LS_KEY) || null;

async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `ошибка ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get token() { return token; },
  get hasToken() { return !!token; },

  async login(login, remember) {
    const d = await req('/login', { method: 'POST', body: { login } });
    token = d.token;
    (remember ? localStorage : sessionStorage).setItem(LS_KEY, token);
    return d;
  },
  async logout() {
    try { await req('/logout', { method: 'POST' }); } catch (e) { /* сервер мог уже забыть токен */ }
    token = null;
    localStorage.removeItem(LS_KEY);
    sessionStorage.removeItem(LS_KEY);
  },
  forget() {
    token = null;
    localStorage.removeItem(LS_KEY);
    sessionStorage.removeItem(LS_KEY);
  },

  state: () => req('/state'),
  ready: (roundIdx) => req('/ready', { method: 'POST', body: { roundIdx } }),
  saveXi: (slots) => req('/xi', { method: 'POST', body: { slots } }),
  reset: () => req('/reset', { method: 'POST' }),

  stream(handlers) {
    if (!token) return null;
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    for (const [type, fn] of Object.entries(handlers)) {
      es.addEventListener(type, (e) => {
        let payload = null;
        try { payload = JSON.parse(e.data); } catch (err) { payload = null; }
        fn(payload);
      });
    }
    es.addEventListener('error', () => handlers.onError?.(null));
    return es;
  },
};

export const settings = {
  get llm() {
    try { return JSON.parse(localStorage.getItem('touchline.llm') || '{}'); } catch (e) { return {}; }
  },
  set llm(v) { localStorage.setItem('touchline.llm', JSON.stringify(v)); },
};
