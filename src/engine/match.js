import { Rng, clamp, fmtClock } from './util.js';
import { coachOf, matchMood, nextSubstitution, groupOf, pickBench } from './coach.js';
import { applyStyle } from './styles.js';
import { line, CARD_REASONS, RED_REASONS } from './text.js';

const LOAD = { GK: 0.10, CB: 0.46, LB: 0.64, RB: 0.64, CDM: 0.56, CM: 0.60, CAM: 0.56, LW: 0.68, RW: 0.68, ST: 0.52 };
const SIDE = { GK: 'C', LB: 'L', CB: 'C', RB: 'R', CDM: 'C', CM: 'C', CAM: 'C', LW: 'L', RW: 'R', ST: 'C' };
const ZONE_NAME = ['вратарская', 'своя треть', 'центр поля', 'чужая треть', 'штрафная'];

export const REAL_MS_PER_MATCH = 4 * 60 * 1000;

export class MatchSim {
  constructor({ homeKey, awayKey, squads, seed = 7, speed = 1, styles = {} }) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.speed = speed;
    this.home = this.mkTeam(homeKey, squads[homeKey], styles[homeKey]);
    this.away = this.mkTeam(awayKey, squads[awayKey], styles[awayKey]);
    this.minute = 0;
    this.half = 1;
    this.extra1 = 0;
    this.extra2 = 0;
    this.finished = false;
    this.pending = [];
    this.events = [];
    this.stats = { home: blankStats(), away: blankStats() };
    this.possession = { home: 0, away: 0 };
    this.nextSubCheck = 12;
    this.chain = [];
    this.ball = { team: this.home, zone: 1, side: 'C' };
    this.push('kickoff', null, { text: line(this.rng, 'kickoff', this.home.name), dur: 0.4 });
  }

  mkTeam(key, data, styleId) {
    const coach = applyStyle(coachOf(key), styleId);
    const rt = (p, onPitch) => ({
      ...p, onPitch, starts: onPitch, cameOn: false, used: false, fatigue: onPitch ? 0 : 6, out: false, replaced: false, sentOff: false,
      yellow: false, red: false, injuryLabel: null, mins: onPitch ? 0 : 0,
      goals: 0, assists: 0, passes: 0, keyPasses: 0, dribbles: 0, tackles: 0, saves: 0, shots: 0, fouls: 0,
    });
    const xi = data.starters.map((p) => rt(p, true));
    const bench = data.bench.map((p) => rt(p, false));
    return {
      key, name: data.name, coachName: data.coach, coach, data,
      xi, bench, all: [...xi, ...bench],
      score: 0, shots: 0, sot: 0, blocked: 0, corners: 0, offsides: 0, fouls: 0,
      yellows: 0, reds: 0, saves: 0, bigChances: 0, presses: 0, subsUsed: 0,
    };
  }

  // ---- публичный API для тренера и UI -------------------------------------
  teamRef(key) { return this.home.key === key ? this.home : this.away; }
  players(key) { return this.teamRef(key).xi.filter((p) => !p.out && !p.sentOff); }
  benchFor(key) { return this.teamRef(key).bench.filter((p) => !p.used); }
  subCount(key) { return this.teamRef(key).subsUsed; }
  scoreDiff(key) { const t = this.teamRef(key); const o = this.other(t); return t.score - o.score; }
  get minuteFloat() { return this.minute; }
  eff(p, attr) {
    const base = p[attr] ?? p.overall;
    const dec = base >= 45 ? (base - 45) * 0.62 : 0;
    return base - dec * (p.fatigue / 100);
  }
  other(t) { return t === this.home ? this.away : this.home; }
  side(t) { return t === this.home ? 'home' : 'away'; }

  // ---- силы линий ----------------------------------------------------------
  lineAvg(t, group, attrs) {
    const ps = this.players(t.key).filter((p) => groupOf(p.pos) === group);
    const mf = this.manFactor(t) * (1 + (t.coach.levelMod || 0));
    if (!ps.length) return 55 * mf;
    return ps.reduce((s, p) => s + attrs.reduce((a, k) => a + this.eff(p, k), 0) / attrs.length, 0) / ps.length * mf;
  }
  attack(t) { return this.lineAvg(t, 'att', ['attacking_finishing', 'pace', 'skill_dribbling', 'movement_acceleration']) * 0.6 + this.lineAvg(t, 'mid', ['mentality_vision', 'skill_long_passing']) * 0.4; }
  midfield(t) { return this.lineAvg(t, 'mid', ['attacking_short_passing', 'skill_ball_control', 'mentality_vision', 'power_stamina']); }
  defense(t) { return this.lineAvg(t, 'def', ['defending_awareness', 'defending_standing_tackle', 'power_strength', 'pace']) * 0.75 + this.lineAvg(t, 'mid', ['defending_awareness']) * 0.25; }
  keeper(t) { const gk = this.players(t.key).find((p) => p.pos === 'GK') || this.players(t.key)[0] || t.xi[0]; return (this.eff(gk, 'goalkeeping_diving') + this.eff(gk, 'goalkeeping_reflexes') + this.eff(gk, 'goalkeeping_positioning')) / 3; }
  // Каждый удалённый — реальная потеря в силе линий, а не только в составе.
  manFactor(t) {
    const n = this.players(t.key).length;
    return n >= 11 ? 1 : clamp(1 - (11 - n) * 0.085, 0.62, 1);
  }

  possessionShare(t) {
    const o = this.other(t);
    const m = matchMood(t.coach, t.score - o.score, this.minute);
    const raw = this.midfield(t) * (0.6 + 0.7 * t.coach.control * m.attack);
    const rawo = this.midfield(o) * (0.6 + 0.7 * o.coach.control * m.attack);
    return clamp(raw / (raw + rawo), 0.24, 0.76);
  }

  mood(t) { return matchMood(t.coach, t.score - this.other(t).score, this.minute); }

  // ---- часы и таймы --------------------------------------------------------
  checkClockMarks() {
    if (this.half === 1) {
      // добавленное время первой половины решается молча
      if (!this.extra1 && this.minute >= 45) this.extra1 = this.stoppage();
      if (this.minute < 45 + this.extra1) return;
      this.half = 2;
      this.minute = 45;
      this.push('ht', null, {
        text: `Перерыв. ${this.home.name} ${this.home.score} — ${this.away.score} ${this.away.name}.`,
        dur: 0.1, score: [this.home.score, this.away.score],
      });
      this.restHalfTime();
      this.ball = { team: this.away, zone: 1, side: 'C' };
      this.chain = [];
      this.lastPasser = null;
      this.counterBoost = 0;
      this.halftimeSubs();
      return;
    }
    if (this.finished) return;
    if (!this.extra2 && this.minute >= 90) this.extra2 = this.stoppage();
    if (this.minute >= 90 + this.extra2) {
      this.finished = true;
      this.push('ft', null, {
        text: `Финальный свисток. ${this.home.name} ${this.home.score} — ${this.away.score} ${this.away.name}.`,
        dur: 0.1, score: [this.home.score, this.away.score],
      });
    }
  }

  // Добавленное время считается по событиям текущего тайма, а не по всему матчу.
  stoppage() {
    const ht = this.events.findLastIndex((e) => e.type === 'ht');
    const current = this.events.slice(ht + 1);
    const fouls = current.filter((e) => e.type === 'foul').length;
    const subs = current.filter((e) => e.type === 'sub').length;
    const add = 1.2 + this.rng.f(0, 2) + fouls * 0.05 + subs * 0.18;
    return clamp(Math.round(add), 1, this.half === 1 ? 4 : 6);
  }

  restHalfTime() {
    for (const p of [...this.home.xi, ...this.away.xi, ...this.home.bench, ...this.away.bench]) {
      p.fatigue = Math.max(0, p.fatigue - 9);
    }
  }

  // Тренер сам решает, освежить ли кого-то в перерыве.
  halftimeSubs() {
    for (const t of [this.home, this.away]) {
      if (t.subsUsed >= 5) continue;
      const forced = t.xi.find((p) => p.out && !p.replaced);
      const d = forced ? this.forcedSub(t, forced) : nextSubstitution(this, t.key, { halftime: true });
      if (d) this.applySub(t, d);
    }
  }

  setStyle(key, styleId) {
    const t = this.teamRef(key);
    const before = t.coach.styleId;
    t.coach = applyStyle(coachOf(key), styleId);
    if (before !== t.coach.styleId) {
      this.push('style', t, {
        text: `${t.name} меняет план: ${t.coach.styleName.toLowerCase()}.`,
        dur: 0.4, style: t.coach.styleId, styleName: t.coach.styleName,
      });
    }
    return t.coach;
  }

  drain(dt) {
    for (const t of [this.home, this.away]) {
      const m = this.mood(t);
      for (const p of t.xi) {
        if (p.out || p.sentOff) continue;
        const base = LOAD[p.pos] || 0.5;
        const stam = 1.32 - this.eff(p, 'power_stamina') / 155;
        const has = this.ball.team === t && p.onPitch;
        const heat = (has ? 1.06 : 1) * (1 + t.coach.press * 0.16 * m.press / 0.82) * (0.9 + 0.25 * m.tempo) * (t.coach.fatigueMult || 1);
        p.fatigue = clamp(p.fatigue + base * stam * heat * dt * 1.12, 0, 100);
        p.mins += dt;
      }
    }
  }

  // ---- события -------------------------------------------------------------
  push(type, team, extra = {}) {
    const ev = {
      id: this.events.length + 1,
      min: this.minute,
      clock: fmtClock(this.minute),
      type,
      team: team ? this.side(team) : null,
      teamKey: team ? team.key : null,
      zone: this.ball.zone,
      score: [this.home.score, this.away.score],
      dur: 0.4,
      ...extra,
    };
    this.pending.push(ev);
    this.events.push(ev);
    return ev;
  }

  trySub() {
    if (this.minute < this.nextSubCheck) return;
    this.nextSubCheck = this.minute + 4;
    for (const t of [this.home, this.away]) {
      const forced = t.xi.find((p) => p.out && !p.replaced);
      const decision = forced
        ? this.forcedSub(t, forced)
        : (this.minute >= t.coach.subWindow || t.xi.some((p) => p.out && !p.replaced))
          ? nextSubstitution(this, t.key)
          : null;
      if (decision) { this.applySub(t, decision); return; }
    }
  }

  forcedSub(t, p) {
    if (t.subsUsed >= 5) return null;
    const inP = pickBench(this, t.key, p, { ignoreFatigue: true });
    if (!inP) return null;
    const emergencyGK = p.pos === 'GK' && inP.pos !== 'GK';
    return { out: p, in: inP, forced: true, emergencyGK, reason: p.injuryLabel || 'травма' };
  }

  applySub(t, d) {
    d.out.out = true;
    d.out.replaced = true;
    d.in.used = true;
    d.in.onPitch = true;
    d.in.cameOn = true;
    d.in.fatigue = 4;
    // Запасного вратаря нет — в рамку встаёт защитник, иначе движок не увидит вратаря.
    if (d.emergencyGK) d.in.pos = 'GK';
    const idx = t.xi.indexOf(d.out);
    if (idx >= 0) t.xi[idx] = d.in; else t.xi.push(d.in);
    t.subsUsed += 1;
    this.push('sub', t, {
      text: d.emergencyGK
        ? `${d.in.name} встаёт в рамку вместо ${d.out.name}.`
        : line(this.rng, 'sub', d.out.name, d.in.name, d.reason),
      dur: 0.5, out: d.out.name, in: d.in.name, reason: d.reason, forced: !!d.forced, number: t.subsUsed,
    });
  }

  // ---- выбор исполнителей --------------------------------------------------
  actors(t, zone, prefer) {
    const on = this.players(t.key);
    const byZone = {
      0: on.filter((p) => p.pos === 'GK'),
      1: on.filter((p) => ['GK', 'CB', 'LB', 'RB', 'CDM'].includes(p.pos)),
      2: on.filter((p) => ['CDM', 'CM', 'CAM', 'CB', 'LB', 'RB'].includes(p.pos)),
      3: on.filter((p) => ['CM', 'CAM', 'LW', 'RW', 'LB', 'RB', 'ST'].includes(p.pos)),
      4: on.filter((p) => ['ST', 'LW', 'RW', 'CAM', 'CB'].includes(p.pos)),
    }[zone] || on;
    let pool = byZone.length ? byZone : on;
    if (prefer) {
      const wanted = pool.filter((p) => prefer.includes(p.pos));
      if (wanted.length) pool = wanted;
    }
    return pool;
  }

  pickActor(t, zone, prefer, side, exclude) {
    let pool = this.actors(t, zone, prefer).filter((p) => p !== exclude);
    if (side && side !== 'C') {
      const flank = pool.filter((p) => SIDE[p.pos] === side);
      if (flank.length) pool = flank;
    }
    // свежий и более умелый выбирается чаще
    const weights = pool.map((p) => Math.max(0.05, this.eff(p, 'skill_ball_control') / (1 + p.fatigue / 45)));
    let total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng.next() * total;
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  oppDefender(t, zone, side) {
    const o = this.other(t);
    const on = this.players(o.key);
    const pairs = {
      L: ['RB', 'CB', 'R'], R: ['LB', 'CB'], C: ['CB', 'CDM', 'CM'],
    };
    const pref = pairs[side] || pairs.C;
    for (const role of pref) {
      const cand = on.filter((p) => p.pos === role || (role === 'R' && p.pos === 'RW'));
      if (cand.length) return this.rng.pick(cand);
    }
    const def = on.filter((p) => groupOf(p.pos) === 'def');
    return def.length ? this.rng.pick(def) : this.rng.pick(on);
  }

  // ---- один шаг игры -------------------------------------------------------
  tick() {
    if (!this.pending.length && !this.finished) {
      this.checkClockMarks();
      if (!this.pending.length) {
        this.trySub();
        let guard = 0;
        while (!this.pending.length && !this.finished && guard++ < 8) this.playOne();
      }
    }
    if (!this.pending.length) return null;
    const ev = this.pending.shift();
    ev.index = this.consumed = (this.consumed || 0) + 1;
    return ev;
  }

  advance(dt, t) {
    this.minute += dt;
    this.drain(dt);
    this.possession[this.side(t)] += dt;
  }

  playOne() {
    const t = this.ball.team;
    const zone = this.ball.zone;
    const o = this.other(t);
    const m = this.mood(t);
    const pressRisk = clamp(o.coach.press * (zone <= 2 ? 0.42 : 0.16) * (90 - this.lineAvg(t, 'mid', ['skill_ball_control'])) / 90, 0.02, 0.3);

    if (this.rng.chance(pressRisk * m.press / 0.8)) { this.pressTurnover(t, o); return; }

    if (zone <= 1) this.buildUp(t, o, m);
    else if (zone === 2) this.progress(t, o, m);
    else if (zone === 3) this.finalThird(t, o, m);
    else this.boxAction(t, o, m);
  }

  noteChain(p) { this.chain.push(p.name); if (this.chain.length > 4) this.chain.shift(); }

  passTo(t, o, from, toIn, kind) {
    if (!toIn || toIn === from) {
      const alt = this.pickActor(t, clamp(this.ball.zone + 1, 1, 4), null, null, from);
      if (!alt) {
        this.push('carry', t, { text: line(this.rng, 'carry', from.name), dur: 0.4, from: from.name });
        this.noteChain(from);
        this.advance(0.4, t);
        this.ball.zone = clamp(this.ball.zone + 1, 1, 4);
        return;
      }
      toIn = alt;
    }
    const to = toIn;
    const quality = (this.eff(from, 'attacking_short_passing') + this.eff(from, 'mentality_vision')) / 2;
    const fail = clamp(0.22 - (quality - 72) / 175 + o.coach.press * 0.07 + from.fatigue / 430, 0.015, 0.32);
    const dur = kind === 'long' ? 0.5 : kind === 'switch' ? 0.45 : kind === 'through' ? 0.4 : 0.32;
    if (this.rng.chance(fail)) {
      const d = this.oppDefender(t, this.ball.zone, this.ball.side);
      if (this.rng.chance(0.16)) {
        d.fouls += 1; o.fouls += 1;
        this.foulConsequence(o, d, t, from, this.ball.zone, dur);
      } else {
        this.push('intercept', o, {
          text: line(this.rng, 'intercept', d.name, from.name, to.name), dur, to: d.name,
        });
        this.looseBall(o, this.ball.zone >= 2 ? 2 : 3, o.coach.counter > 0.7 ? 'counter' : 'open');
      }
      this.advance(dur, o);
      return;
    }
    this.push('pass', t, {
      text: line(this.rng, kind, from.name, to.name), dur, from: from.name, to: to.name,
    });
    from.passes += 1;
    this.noteChain(from);
    this.noteChain(to);
    this.lastPasser = from;
    this.advance(dur, t);
  }

  looseBall(t, zone, kind) {
    this.ball = { team: t, zone, side: this.rng.pick(['L', 'C', 'R']) };
    this.chain = [];
    if (kind === 'counter') this.counterBoost = 2;
  }

  pressTurnover(t, o) {
    const forcer = this.pickActor(o, clamp(this.ball.zone - 1, 1, 3), ['ST', 'LW', 'RW', 'CM', 'CAM']);
    const victim = this.pickActor(t, this.ball.zone, ['CB', 'CDM', 'CM', 'LB', 'RB', 'GK']);
    const zone = clamp(this.ball.zone - 1, 1, 4);
    o.presses += 1;
    const goalward = this.ball.zone >= 3;
    this.push('press', o, {
      text: line(this.rng, 'press', forcer.name, victim.name), dur: 0.3,
      to: forcer.name, from: victim.name, danger: goalward,
    });
    this.advance(0.3, o);
    this.looseBall(o, goalward ? 4 : 2, goalward ? 'press' : 'counter');
  }

  buildUp(t, o, m) {
    const gk = this.players(t.key).find((p) => p.pos === 'GK');
    const choice = this.rng.weighted([
      ['short', 42 + t.coach.control * 40],
      ['long', 11 + m.attack * 12 + (this.counterBoost ? 16 : 0) + (t.coach.directness || 0) * 24],
      ['carry', 16 + t.coach.tempo * 8],
    ]);
    if (choice === 'short') {
      const from = this.rng.chance(0.55) && gk ? gk : this.pickActor(t, 1, ['CB', 'LB', 'RB', 'CDM']);
      const to = this.pickActor(t, 2, from === gk ? ['CB', 'LB', 'RB', 'CDM'] : ['CDM', 'CM', 'LB', 'RB']);
      this.passTo(t, o, from, to, 'pass');
      this.ball.zone = 2;
    } else if (choice === 'long') {
      const from = this.pickActor(t, 1, ['CB', 'GK', 'CDM']);
      const to = this.pickActor(t, 3, ['ST', 'LW', 'RW']);
      this.passTo(t, o, from, to, 'long');
      this.ball.zone = this.lastPasser === from ? 3 : 2;
    } else {
      const p = this.pickActor(t, 1, ['CB', 'CDM', 'LB', 'RB']);
      const d = this.oppDefender(t, 2, SIDE[p.pos]);
      this.push('carry', t, { text: line(this.rng, 'carry', p.name), dur: 0.45, from: p.name });
      this.noteChain(p);
      this.advance(0.45, t);
      this.ball.zone = 2;
      this.ball.side = SIDE[p.pos] === 'C' ? this.rng.pick(['L', 'C', 'R']) : SIDE[p.pos];
      if (this.rng.chance(0.12)) this.foulConsequence(o, d, t, p, 2, 0.3);
    }
  }

  progress(t, o, m) {
    const choice = this.rng.weighted([
      ['pass', 30 + t.coach.control * 28],
      ['switch', 14 + t.coach.control * 10 + (t.coach.width || 0) * 10],
      ['through', 5 + m.attack * 7 + (this.counterBoost ? 12 : 0) + (t.coach.directness || 0) * 14],
      ['dribble', 12 + (1 - t.coach.control) * 18],
      ['carry', 16],
    ]);
    if (this.counterBoost) { this.counterBoost -= 1; }
    if (choice === 'pass' || choice === 'switch') {
      const from = this.pickActor(t, 2, ['CDM', 'CM', 'CAM', 'LB', 'RB']);
      const to = choice === 'switch'
        ? this.pickActor(t, 3, from && SIDE[from.pos] === 'L' ? ['RW', 'RB'] : ['LW', 'LB'])
        : this.pickActor(t, this.rng.chance(0.4) ? 3 : 2, ['CM', 'CAM', 'LW', 'RW', 'ST']);
      this.passTo(t, o, from, to, choice === 'switch' ? 'switch' : 'pass');
      if (this.ball.team === t) this.ball.zone = choice === 'switch' ? 3 : this.rng.chance(0.45) ? 3 : 2;
    } else if (choice === 'through') {
      const from = this.pickActor(t, 2, ['CM', 'CAM', 'CDM', 'CB']);
      const to = this.pickActor(t, 4, ['ST', 'LW', 'RW']);
      const d = this.oppDefender(t, 3, SIDE[to.pos]);
      const q = (this.eff(from, 'mentality_vision') + this.eff(from, 'skill_long_passing')) / 2;
      const p = clamp(0.20 + (q - 74) / 130 - (this.eff(d, 'defending_awareness') - 74) / 160 - (this.eff(to, 'movement_acceleration') - 75) / 320 + (o.coach.lineHeight - 0.7) * 0.12, 0.05, 0.55);
      if (this.rng.chance(1 - p)) {
        from.keyPasses += 1;
        this.push('through', t, {
          text: line(this.rng, 'long', from.name, to.name), dur: 0.35, from: from.name, to: to.name, key: true,
        });
        this.noteChain(from); this.noteChain(to);
        this.lastPasser = from;
        this.advance(0.35, t);
        this.ball = { team: t, zone: 4, side: SIDE[to.pos] === 'C' ? 'C' : SIDE[to.pos] };
        this.shot(t, to, { from: from, kind: 'through', xgBase: 0.16 });
      } else if (this.rng.chance(clamp(0.18 + o.coach.lineHeight * 0.34, 0.08, 0.6))) {
        this.push('offside', o, { text: line(this.rng, 'offside', to.name), dur: 0.3, player: to.name });
        o.offsides += 1;
        this.advance(0.3, o);
        this.looseBall(o, 1);
      } else {
        this.push('intercept', o, { text: line(this.rng, 'intercept', d.name, from.name, to.name), dur: 0.35, to: d.name });
        this.advance(0.35, o);
        this.looseBall(o, 2, o.coach.counter > 0.7 ? 'counter' : 'open');
      }
    } else {
      const p = this.pickActor(t, 2, ['CM', 'CAM', 'LW', 'RW', 'LB', 'RB']);
      this.duel(t, o, p, 3);
    }
  }

  duel(t, o, p, nextZone) {
    const d = this.oppDefender(t, nextZone, SIDE[p.pos]);
    const a = (this.eff(p, 'skill_dribbling') + this.eff(p, 'movement_agility') + this.eff(p, 'pace')) / 3;
    const b = (this.eff(d, 'defending_standing_tackle') + this.eff(d, 'defending_sliding_tackle') + this.eff(d, 'pace')) / 3;
    const win = clamp(0.5 + (a - b) / 60 - p.fatigue / 400 + d.fatigue / 500, 0.12, 0.86);
    if (this.rng.chance(win)) {
      p.dribbles += 1;
      this.push('dribble', t, { text: line(this.rng, 'dribbleWin', p.name, d.name), dur: 0.4, from: p.name, beat: d.name });
      this.noteChain(p);
      this.lastPasser = this.lastPasser || null;
      this.advance(0.4, t);
      this.ball.zone = nextZone;
      this.ball.side = SIDE[p.pos];
    } else if (this.rng.chance(0.16)) {
      d.fouls += 1; o.fouls += 1;
      this.foulConsequence(o, d, t, p, nextZone, 0.35);
    } else {
      d.tackles += 1;
      this.push('tackle', o, { text: line(this.rng, 'dribbleLose', p.name, d.name), dur: 0.35, from: d.name, beat: p.name });
      this.advance(0.35, o);
      this.looseBall(o, nextZone >= 3 ? 2 : 3, o.coach.counter > 0.7 ? 'counter' : 'open');
    }
  }

  finalThird(t, o, m) {
    const choice = this.rng.weighted([
      ['dribble', 17 + (1 - t.coach.control) * 14],
      ['cross', 14 + t.coach.tempo * 8 + (t.coach.width || 0) * 14],
      ['shot', 4 + m.attack * 6],
      ['pass', 22 + t.coach.control * 20],
      ['through', 4 + m.attack * 5 + (t.coach.directness || 0) * 8],
    ]);
    if (choice === 'dribble') {
      const p = this.pickActor(t, 3, ['LW', 'RW', 'LB', 'RB', 'ST', 'CAM']);
      this.duel(t, o, p, 4);
      return;
    }
    if (choice === 'cross') {
      const p = this.pickActor(t, 3, ['LW', 'RW', 'LB', 'RB']);
      const target = this.pickActor(t, 4, ['ST', 'LW', 'RW', 'CAM', 'CB']);
      if (this.rng.chance(clamp(0.42 + (this.eff(p, 'skill_ball_control') - 74) / 150 - (this.eff(this.oppDefender(t, 4, SIDE[p.pos]), 'defending_awareness') - 74) / 200, 0.2, 0.7))) {
        this.push('cross', t, { text: line(this.rng, 'cross', p.name), dur: 0.35, from: p.name, to: target.name });
        this.noteChain(p); this.noteChain(target);
        this.lastPasser = p;
        this.advance(0.35, t);
        this.ball.zone = 4;
        if (this.rng.chance(0.42)) this.shot(t, target, { kind: 'header', xgBase: 0.045 });
        else if (this.rng.chance(0.4)) {
          o.corners += 1;
          this.push('corner', t, { text: line(this.rng, 'corner'), dur: 0.3, from: p.name });
          this.advance(0.3, t);
          this.setPiece(t, 'corner');
        } else {
          const gk = this.players(o.key).find((x) => x.pos === 'GK');
          this.push('gk', o, { text: line(this.rng, 'gk', gk ? gk.name : 'вратарь'), dur: 0.3 });
          this.advance(0.3, o);
          this.looseBall(o, 1);
        }
      } else {
        o.corners += this.rng.chance(0.55) ? 1 : 0;
        this.push('intercept', o, { text: `${this.oppDefender(t, 4, SIDE[p.pos]).name} выносит подальше после подачи ${p.name}.`, dur: 0.3 });
        this.advance(0.3, o);
        this.looseBall(o, 1);
      }
      return;
    }
    if (choice === 'shot') {
      const p = this.pickActor(t, 3, ['ST', 'CAM', 'CM', 'LW', 'RW', 'CDM']);
      this.shot(t, p, { kind: 'long', xgBase: 0.025 });
      return;
    }
    if (choice === 'through') {
      const from = this.pickActor(t, 3, ['CM', 'CAM', 'CB', 'LB', 'RB']);
      const to = this.pickActor(t, 4, ['ST', 'LW', 'RW']);
      this.duelIntoBox(t, o, from, to);
      return;
    }
    const from = this.pickActor(t, 3, ['CM', 'CAM', 'LW', 'RW', 'LB', 'RB']);
    const to = this.pickActor(t, this.rng.chance(0.4) ? 4 : 3, ['ST', 'CAM', 'RW', 'LW', 'CM']);
    this.passTo(t, o, from, to, this.rng.chance(0.25) ? 'oneTwo' : 'pass');
    if (this.ball.team === t) this.ball.zone = to === from ? 3 : (this.rng.chance(0.5) ? 4 : 3);
  }

  duelIntoBox(t, o, from, to) {
    const d = this.oppDefender(t, 4, SIDE[to.pos]);
    const q = (this.eff(from, 'mentality_vision') + this.eff(from, 'skill_ball_control')) / 2;
    const p = clamp(0.21 + (q - 76) / 150 + (this.eff(to, 'movement_reactions') - 76) / 260 - (this.eff(d, 'defending_awareness') - 76) / 150, 0.05, 0.50);
    if (this.rng.chance(p)) {
      from.keyPasses += 1;
      this.push('through', t, { text: line(this.rng, 'long', from.name, to.name), dur: 0.3, from: from.name, to: to.name, key: true });
      this.noteChain(from); this.noteChain(to);
      this.lastPasser = from;
      this.advance(0.3, t);
      this.ball.zone = 4;
      this.shot(t, to, { kind: 'inside', xgBase: 0.13 });
    } else if (this.rng.chance(0.28)) {
      d.fouls += 1; o.fouls += 1;
      this.foulConsequence(o, d, t, to, 4, 0.3);
    } else {
      this.push('intercept', o, { text: line(this.rng, 'intercept', d.name, from.name, to.name), dur: 0.3, to: d.name });
      d.tackles += 1;
      this.advance(0.3, o);
      this.looseBall(o, 1);
    }
  }

  boxAction(t, o, m) {
    const choice = this.rng.weighted([
      ['shot', 13 + m.attack * 6],
      ['dribble', 12 + (1 - t.coach.control) * 10],
      ['pass', 15 + t.coach.control * 9],
      ['lose', 32],
    ]);
    if (choice === 'shot') {
      const p = this.pickActor(t, 4, ['ST', 'LW', 'RW', 'CAM', 'CM']);
      this.shot(t, p, { kind: 'inside', xgBase: 0.11 });
    } else if (choice === 'dribble') {
      const p = this.pickActor(t, 4, ['LW', 'RW', 'ST', 'CAM']);
      this.duel(t, o, p, 4);
      if (this.ball.team === t && this.rng.chance(0.5)) this.shot(t, p, { kind: 'inside', xgBase: 0.09 });
    } else if (choice === 'pass') {
      const from = this.pickActor(t, 4, ['LW', 'RW', 'ST', 'CM']);
      const to = this.pickActor(t, 4, ['ST', 'CAM', 'CM', 'LW', 'RW']);
      if (to === from) { this.shot(t, from, { kind: 'inside', xgBase: 0.12 }); return; }
      this.passTo(t, o, from, to, 'oneTwo');
      if (this.ball.team === t && this.rng.chance(0.55)) this.shot(t, to, { kind: 'inside', xgBase: 0.10 });
    } else {
      const d = this.oppDefender(t, 4, this.ball.side);
      this.push('clear', o, { text: `${d.name} выбивает мяч из штрафной после попытки ${this.pickActor(t, 4, ['ST', 'LW', 'RW']).name}.`, dur: 0.3, to: d.name });
      d.tackles += 1;
      this.advance(0.3, o);
      this.looseBall(o, 1);
    }
  }

  shot(t, p, { kind = 'inside', xgBase = 0.12, from = null } = {}) {
    const o = this.other(t);
    const gk = this.players(o.key).find((x) => x.pos === 'GK') || this.players(o.key)[0];
    const finish = kind === 'header'
      ? (this.eff(p, 'attacking_heading_accuracy') || this.eff(p, 'power_jumping'))
      : kind === 'long' ? (this.eff(p, 'power_long_shots') + this.eff(p, 'attacking_finishing')) / 2
      : this.eff(p, 'attacking_finishing');
    const power = this.eff(p, 'power_shot_power');
    const pressure = clamp(1.15 - this.manFactor(t) * 0.15, 1, 1.2);
    let xg = clamp(xgBase + (finish - 78) / 300 + (kind === 'long' ? -0.01 : 0.01) + (from ? 0.03 : 0) - p.fatigue / 900, 0.015, 0.45) * this.mood(t).attack * (kind === 'long' ? 0.7 : 1);
    t.shots += 1; p.shots += 1;
    const onTargetP = clamp(0.30 + (finish - 78) / 210 + (this.eff(p, 'mentality_composure') - 70) / 500, 0.13, 0.62) * (kind === 'long' ? 0.66 : 1);
    const big = xg > 0.28;
    if (big) t.bigChances += 1;

    if (!this.rng.chance(onTargetP)) {
      if (this.rng.chance(0.22)) {
        const b = this.oppDefender(t, 4, this.ball.side);
        t.blocked += 1;
        this.push('blocked', o, { text: line(this.rng, 'blocked', p.name, b.name), dur: 0.25, from: p.name });
        this.advance(0.25, t);
        o.corners += 1;
        this.setPiece(t, 'corner');
        return;
      }
      this.push('shot', t, { text: line(this.rng, 'shotOff', p.name), dur: 0.25, from: p.name, xg: +xg.toFixed(2), kind });
      this.advance(0.25, t);
      if (kind !== 'long' && this.rng.chance(0.5)) { this.push('gk', o, { text: line(this.rng, 'gk', gk.name), dur: 0.2 }); }
      this.looseBall(o, 1);
      return;
    }

    t.sot += 1;
    const keeperSkill = (this.eff(gk, 'goalkeeping_diving') + this.eff(gk, 'goalkeeping_reflexes') + this.eff(gk, 'goalkeeping_positioning')) / 3;
    const saveP = clamp(0.78 - xg * 1.15 + (keeperSkill - 78) / 170 - (power - 78) / 320 + gk.fatigue / 700, 0.06, 0.86);
    if (this.rng.chance(saveP)) {
      gk.saves += 1; o.saves += 1;
      if (this.rng.chance(0.14)) {
        this.push('post', t, { text: line(this.rng, 'post', p.name), dur: 0.25, from: p.name, xg: +xg.toFixed(2) });
        this.advance(0.25, t);
        o.corners += 1;
        this.setPiece(o, 'corner');
        return;
      }
      this.push('save', o, { text: line(this.rng, 'save', gk.name, p.name), dur: 0.25, from: p.name, keeper: gk.name, xg: +xg.toFixed(2) });
      this.advance(0.25, o);
      if (this.rng.chance(0.72)) { this.looseBall(o, 1); } else {
        this.looseBall(t, 4, 'rebound');
        this.push('moment', t, { text: `Мяч отбит! ${this.pickActor(t, 4, ['ST', 'CAM', 'CM']).name} на добивании.`, dur: 0.2 });
      }
      return;
    }

    const assist = from && from !== p ? from.name : (this.chain.length > 1 ? this.chain[this.chain.length - 2] : null);
    t.score += 1; p.goals += 1;
    if (assist && assist !== p.name) { const holder = this.findByName(t.key, assist); if (holder) holder.assists += 1; }
    this.push('goal', t, {
      text: line(this.rng, assist && assist !== p.name ? 'goalAssist' : 'goal', p.name, assist && assist !== p.name ? assist : undefined),
      dur: 0.9, scorer: p.name, assist: assist && assist !== p.name ? assist : null, kind, xg: +xg.toFixed(2),
      score: [this.home.score, this.away.score],
    });
    this.advance(0.9, t);
    this.chain = [];
    this.looseBall(this.other(t), 1);
    this.push('moment', this.other(t), { text: `${this.other(t).name} разыгрывают от центра: ${this.home.score}:${this.away.score}.`, dur: 0.2 });
  }

  findByName(teamKey, name) {
    const t = this.teamRef(teamKey);
    return [...t.xi, ...t.bench].find((p) => p.name === name);
  }

  foulConsequence(claimer, d, victimTeam, victim, zone, dur) {
    // claimer = команда, которая сфолила
    const aggr = this.eff(d, 'mentality_aggression');
    const severity = this.rng.f(0.2, 1) * (0.6 + aggr / 120) * (1 + d.fatigue / 180);
    const lastMan = zone <= 2 && groupOf(d.pos) === 'def' && this.rng.chance(0.05);
    const inBox = zone === 4;
    this.push('foul', claimer, { text: line(this.rng, 'foul', victim.name, d.name), dur, by: d.name, on: victim.name, zone });
    this.advance(dur, claimer);
    claimer.fouls += 1;

    if (lastMan && this.rng.chance(0.55)) {
      this.card(d, claimer, this.rng.pick(RED_REASONS), true);
      this.looseBall(victimTeam, clamp(zone + 1, 2, 4));
      this.setPiece(victimTeam, inBox ? 'penalty' : 'freekick');
      return;
    }
    const yellowP = clamp(0.06 + severity * 0.24 + (zone >= 3 ? 0.06 : 0.14) + (aggr - 60) / 280 + ((claimer.coach?.aggression ?? 0.6) - 0.6) * 0.16, 0.02, 0.52);
    if (!d.yellow && this.rng.chance(yellowP)) this.card(d, claimer, this.rng.pick(CARD_REASONS), false);
    if (this.rng.chance(clamp(0.02 + severity * 0.07 + victim.fatigue / 900, 0.01, 0.14))) {
      this.injure(victim, victimTeam, severity);
    }
    this.looseBall(victimTeam, clamp(zone + 1, 2, 4));
    this.setPiece(victimTeam, inBox && this.rng.chance(0.14) ? 'penalty' : 'freekick');
  }

  card(p, team, reason, red) {
    if (red) {
      p.red = true; p.sentOff = true; p.onPitch = false; p.cardMin = fmtClock(this.minute);
      team.reds += 1;
      this.push('red', team, { text: line(this.rng, 'red', p.name, reason), dur: 0.5, player: p.name, reason });
    } else {
      p.yellow = true; p.cardMin = fmtClock(this.minute);
      team.yellows += 1;
      this.push('yellow', team, { text: line(this.rng, 'yellow', p.name, reason), dur: 0.4, player: p.name, reason });
    }
  }

  injure(p, team, severity) {
    const serious = severity > 0.72 || p.fatigue > 72 || this.rng.chance(0.25);
    p.injuryLabel = serious ? 'травма, не может продолжить' : 'ушиб, играет через боль';
    if (serious) {
      p.out = true;
      p.onPitch = false;
      team.data.injured = (team.data.injured || []);
      this.push('injury', team, { text: line(this.rng, 'injury', p.name), dur: 0.6, player: p.name, serious: true });
    } else {
      p.fatigue = clamp(p.fatigue + 14, 0, 100);
      this.push('injury', team, { text: `${p.name} остался на поле после жёсткого приёма — медицинский персонал на бровке.`, dur: 0.4, player: p.name, serious: false });
    }
    this.advance(0.4, team);
  }

  setPiece(t, kind) {
    const o = this.other(t);
    if (kind === 'corner') {
      const taker = this.pickActor(t, 3, ['CAM', 'CM', 'RW', 'LW']);
      const target = this.pickActor(t, 4, ['CB', 'ST', 'CDM', 'CAM']);
      this.push('setpiece', t, { text: line(this.rng, 'freekick', taker.name) + ' Угловой розыгрыш.', dur: 0.35, from: taker.name, kind });
      this.noteChain(taker); this.noteChain(target);
      this.lastPasser = taker;
      this.advance(0.35, t);
      this.ball = { team: t, zone: 4, side: 'C' };
      if (this.rng.chance(0.36)) this.shot(t, target, { kind: 'header', xgBase: 0.045, from: taker });
      else {
        const gk = this.players(o.key).find((x) => x.pos === 'GK');
        this.push('gk', o, { text: `${gk ? gk.name : 'Вратарь'} забирает мяч после подачи с угла.`, dur: 0.3 });
        this.advance(0.3, o);
        this.looseBall(o, 1);
      }
      return;
    }
    if (kind === 'penalty') {
      const shooter = this.pickActor(t, 4, ['ST', 'CAM', 'RW', 'LW', 'CM']);
      const gk = this.players(o.key).find((x) => x.pos === 'GK') || this.players(o.key)[0];
      const pen = this.eff(shooter, 'mentality_penalties');
      const conv = clamp(0.72 + (pen - 75) / 180 - (this.eff(gk, 'goalkeeping_reflexes') - 78) / 260 - shooter.fatigue / 700, 0.35, 0.93);
      this.push('setpiece', t, { text: `Пенальти! ${shooter.name} устанавливает мяч на точку.`, dur: 0.6, kind, player: shooter.name });
      this.advance(0.6, t);
      if (this.rng.chance(conv)) {
        t.score += 1; shooter.goals += 1;
        this.push('goal', t, { text: line(this.rng, 'penGoal', shooter.name), dur: 0.6, scorer: shooter.name, penalty: true, score: [this.home.score, this.away.score] });
        this.advance(0.6, t);
        this.chain = [];
        this.looseBall(o, 1);
      } else if (this.rng.chance(0.5)) {
        gk.saves += 1; o.saves += 1;
        this.push('save', o, { text: line(this.rng, 'penSave', shooter.name, gk.name), dur: 0.5, penalty: true, keeper: gk.name });
        this.advance(0.5, o);
        this.looseBall(o, 2);
      } else {
        this.push('post', t, { text: line(this.rng, 'penPost', shooter.name), dur: 0.5, penalty: true });
        this.advance(0.5, t);
        this.looseBall(o, 1);
      }
      return;
    }
    // штрафной
    const taker = this.pickActor(t, 3, ['CAM', 'CM', 'RW', 'LW', 'CDM']);
    const nearBox = this.ball.zone >= 3;
    if (nearBox && this.rng.chance(0.20)) {
      const direct = clamp(0.10 + (this.eff(taker, 'skill_fk_accuracy') - 70) / 260 + (this.eff(taker, 'power_long_shots') - 70) / 320, 0.03, 0.30);
      this.push('setpiece', t, { text: `Штрафной в 22 метрах. Бьёт ${taker.name}.`, dur: 0.4, kind, player: taker.name });
      this.advance(0.4, t);
      if (this.rng.chance(direct)) {
        t.score += 1; taker.goals += 1;
        this.push('goal', t, { text: `ГОЛ! ${taker.name} кладёт мяч в «девятку» прямо со штрафного.`, dur: 0.8, scorer: taker.name, freekick: true, score: [this.home.score, this.away.score] });
        this.advance(0.8, t);
        this.chain = [];
        this.looseBall(this.other(t), 1);
      } else {
        const gk = this.players(o.key).find((x) => x.pos === 'GK');
        this.push('shot', t, { text: `${taker.name} со стандарта — ${this.rng.chance(0.5) ? 'в стенку' : 'рядом со штангой'}.`, dur: 0.3, from: taker.name, freekick: true });
        this.advance(0.3, t);
        o.corners += 1;
        this.looseBall(o, 1);
        this.push('gk', o, { text: `${gk ? gk.name : 'Вратарь'} забирает мяч после стандарта.`, dur: 0.2 });
      }
      return;
    }
    const target = this.pickActor(t, 4, ['CB', 'ST', 'CDM']);
    this.push('setpiece', t, { text: line(this.rng, 'freekick', taker.name), dur: 0.4, kind, player: taker.name });
    this.noteChain(taker); this.noteChain(target);
    this.lastPasser = taker;
    this.advance(0.4, t);
    this.ball = { team: t, zone: nearBox ? 4 : 3, side: this.ball.side };
    if (nearBox && this.rng.chance(0.4)) this.shot(t, target, { kind: 'header', xgBase: 0.04, from: taker });
  }

  runAll(limitEvents = 2200) {
    let guard = 0;
    while (!this.finished && guard++ < limitEvents) this.tick();
    return this;
  }
}

function blankStats() { return { shots: 0, xg: 0, fouls: 0, corners: 0, offsides: 0, passes: 0, tackles: 0, saves: 0 }; }

export function quickSim(homeKey, awayKey, squads, seed) {
  const sim = new MatchSim({ homeKey, awayKey, squads, seed });
  sim.runAll();
  return sim;
}
