import io

# 1) LiveView: догон пропущенных событий по серверному снапшоту
p = 'src/ui/live.js'
s = io.open(p, encoding='utf-8').read()
anchor = "  name(key) { return this.ctx.S.teams.find((t) => t.key === key)?.name || key; }"
add = """  name(key) { return this.ctx.S.teams.find((t) => t.key === key)?.name || key; }

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
  }"""
assert anchor in s
s = s.replace(anchor, add, 1)
io.open(p, 'w', encoding='utf-8').write(s)

# 2) app.js: вызывать догон на state/hello/live
p = 'src/app.js'
s = io.open(p, encoding='utf-8').read()
old = """    state: (S) => { if (S) { applyState(S); refresh(); } },
    hello: (S) => { if (S) { applyState(S); refresh(); } },"""
new = """    state: (S) => { if (S) { applyState(S); if (route === 'live') live?.syncFrom(ctx.S.live); refresh(); } },
    hello: (S) => { if (S) { applyState(S); if (route === 'live') live?.syncFrom(ctx.S.live); refresh(); } },"""
assert old in s
s = s.replace(old, new)

old2 = """      const plays = l && ctx.account && (l.home === ctx.account || l.away === ctx.account);
      if (plays && l.status === 'running' && prev !== 'running' && route !== 'live') openLive();
      refresh();"""
new2 = """      const plays = l && ctx.account && (l.home === ctx.account || l.away === ctx.account);
      if (plays && l.status === 'running' && prev !== 'running' && route !== 'live') openLive();
      if (route === 'live') live?.syncFrom(l);
      refresh();"""
assert old2 in s
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
