export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) { this.next = makeRng(seed || 1); }
  f(min = 0, max = 1) { return min + this.next() * (max - min); }
  i(min, max) { return Math.floor(this.f(min, max + 1)); }
  chance(p) { return this.next() < p; }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  weighted(pairs) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = this.next() * total;
    for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Attribute 0..100 -> multiplier around 1.0 with a soft spread.
export const rel = (attr, center = 75, scale = 42) => clamp(0.55 + (attr - center) / scale * 0.45, 0.45, 1.5);

export function fmtClock(simMin) {
  const m = Math.floor(simMin);
  const s = Math.floor((simMin - m) * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const posName = (p) => ({
  GK: 'Вратарь', LB: 'Левый защитник', CB: 'Центральный защитник', RB: 'Правый защитник',
  CDM: 'Опорный полузащитник', CM: 'Полузащитник', CAM: 'Атакующий полузащитник',
  LW: 'Левый вингер', RW: 'Правый вингер', ST: 'Нападающий',
}[p] || p);
