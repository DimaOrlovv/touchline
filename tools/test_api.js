const BASE = process.env.BASE || 'http://127.0.0.1:8137';
const j = async (path, opts = {}, token) => {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (label, cond, extra = '') => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);

const a = await j('/api/login', { method: 'POST', body: { login: 'ArlPsg' } });
const b = await j('/api/login', { method: 'POST', body: { login: 'MirBar' } });
const c = await j('/api/login', { method: 'POST', body: { login: 'MeiRea' } });
ok('вход трёх тренеров', a.status === 200 && b.status === 200 && c.status === 200, `${a.data?.team}/${b.data?.team}/${c.data?.team}`);
ok('неверный логин отклонён', (await j('/api/login', { method: 'POST', body: { login: 'zzz' } })).status === 401);
ok('без токена доступ закрыт', (await j('/api/state')).status === 401);

const s1 = await j('/api/state', {}, a.data.token);
const st = s1.data;
ok('state: 30 туров', st?.rounds?.length === 30);
ok('state: 3 команды в таблице', st?.table?.length === 3);
ok('state: составы всех клубов', Object.keys(st?.squads || {}).length === 3 && st.squads.barcelona.raw.starters.length === 11);
ok('state: живой матч пока нет', st?.live === null);

// наблюдатель не может запустить чужой матч
const wrong = await j('/api/ready', { method: 'POST', body: { roundIdx: st.roundIdx } }, c.data.token);
ok('сторонний клуб не запускает тур', wrong.status === 400, wrong.data?.error);

const r1 = await j('/api/ready', { method: 'POST', body: { roundIdx: st.roundIdx } }, a.data.token);
ok('первый готов → ожидание', r1.data?.live?.status === 'waiting', JSON.stringify(r1.data?.live?.ready));
const r2 = await j('/api/ready', { method: 'POST', body: { roundIdx: st.roundIdx } }, b.data.token);
ok('оба готовы → матч идёт', r2.data?.live?.status === 'running');

// SSE: третий клиент подключается и ловит события
let got = 0, firstEvent = null;
const ac = new AbortController();
const stream = (async () => {
  const res = await fetch(`${BASE}/api/stream?token=${c.data.token}`, { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const part of buf.split('\n\n')) {
      if (!part.startsWith('event: event')) continue;
      const payload = part.slice(part.indexOf('data: ') + 6);
      try { const ev = JSON.parse(payload); got++; if (!firstEvent) firstEvent = `${ev.clock} ${ev.type}: ${ev.text}`; } catch (e) { /* ping */ }
    }
    buf = buf.slice(-200);
  }
})().catch(() => {});

await sleep(9000);
ac.abort();
await stream;
ok('SSE до наблюдателя дошли события', got > 3, `${got} шт за 9с`);
console.log('     пример:', firstEvent);

const mid = await j('/api/state', {}, a.data.token);
ok('матч продвигается по часам', parseFloat(mid.data.live.events.at(-1).clock) > 0.5, mid.data.live.events.at(-1).clock);
ok('сервер копит ленту', mid.data.live.events.length > 5, `${mid.data.live.events.length} событий`);

// смена состава: поменяем местного форварда с запасным
const myClub = mid.data.squads.arsenal;
const slots = mid.data.lineups.arsenal.slots.map((s) => ({ ...s }));
const benchPlayer = myClub.raw.bench.find((p) => p.pos === 'ST');
const target = slots.find((s) => s.pos === 'ST');
if (benchPlayer && target) {
  target.id = benchPlayer.id;
  const saved = await j('/api/xi', { method: 'POST', body: { slots } }, a.data.token);
  ok('сохранение XI', saved.status === 200, JSON.stringify(saved.data));
  const after = await j('/api/state', {}, a.data.token);
  ok('XI вернулся с сервера', after.data.lineups.arsenal.slots.find((s) => s.pos === 'ST')?.id === benchPlayer.id);
} else ok('сохранение XI', false, 'не найден нападающий для теста');

const bad = await j('/api/xi', { method: 'POST', body: { slots: slots.slice(0, 5) } }, a.data.token);
ok('кривой XI отклонён', bad.status === 400, bad.data?.error);

// ждём конца матча (симуляция идёт ~6 минут)
console.log('ждём финальный свисток…');
let done = null;
for (let i = 0; i < 80; i++) {
  await sleep(5000);
  const s = await j('/api/state', {}, a.data.token);
  if (s.data.rounds[st.roundIdx].played) { done = s.data; break; }
}
if (done) {
  const rd = done.rounds[st.roundIdx];
  ok('матч записан в тур', rd.played, `${rd.hs}:${rd.as}`);
  ok('статистика сохранена', !!rd.summary?.stats?.home?.shots, `удары ${rd.summary.stats.home.shots}:${rd.summary.stats.away.shots}`);
  ok('голы с минутами', Array.isArray(rd.summary.scorers), rd.summary.scorers.map((g) => `${g.min} ${g.player}`).join(', ') || 'без голов');
  ok('MVP посчитан', !!rd.summary.mvp, `${rd.summary.mvp?.player} ${rd.summary.mvp?.rating}`);
  ok('таблица обновилась', done.table.some((r) => r.played === 1));
  ok('статистика игроков есть', Object.keys(done.playerStats).length > 15, `${Object.keys(done.playerStats).length} игроков`);
} else {
  ok('матч доиграл за отведённое время', false);
}
