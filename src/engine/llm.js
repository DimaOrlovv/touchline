const API = 'https://openrouter.ai/api/v1';

export async function listFreeModels(apiKey, { signal } = {}) {
  const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  if (!res.ok) throw new Error(`OpenRouter: ${res.status}`);
  const json = await res.json();
  return (json.data || [])
    .filter((m) => m.id.endsWith(':free'))
    .map((m) => ({ id: m.id, name: m.name || m.id, ctx: m.context_length || 0 }))
    .sort((a, b) => b.ctx - a.ctx);
}

const SYSTEM = [
  'Ты — текстовый комментатор футбольного матча на русском языке.',
  'Правила: одно событие — одна короткая строка (до 22 слов). Без выдуманных игроков, голов и нарушений:',
  'используй только переданные имена и счёт. Не используй эмодзи, обращения к зрителям и метафоры про ИИ.',
  'Стиль: сдержанная пресс-хроника, как в текстовой трансляции BBC Sport.',
  'Верни ровно столько строк, сколько событий, по одной в строке, без нумерации и без кавычек.',
].join(' ');

export async function rewriteEvents({ apiKey, model, tone = 'нейтрально', events, score, minute }, { signal } = {}) {
  if (!apiKey || !model || !events.length) return null;
  const body = {
    model,
    temperature: 0.7,
    max_tokens: Math.min(900, 60 * events.length + 80),
    messages: [
      { role: 'system', content: `${SYSTEM} Тон: ${tone}. Счёт на момент ${minute}: ${score}.` },
      {
        role: 'user',
        content: events.map((e, i) => `${i + 1}. ${e.clock} ${e.type}: ${e.text}`).join('\n'),
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': location.origin,
        'X-Title': 'Touchline Liga',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 180));
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    const lines = raw.split('\n').map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
    if (!lines.length) return null;
    return events.map((e, i) => ({ id: e.id, text: lines[i] || lines[lines.length - 1] || e.text }));
  } finally {
    clearTimeout(timer);
  }
}

export const FALLBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
