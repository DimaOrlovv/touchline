import io

p = 'src/app.js'
s = io.open(p, encoding='utf-8').read()

old = """function shell(inner, { bare = false, full = false } = {}) {
  const club = ctx.S?.squads[ctx.account];
  app.innerHTML = `<div class="app ${bare ? 'is-bare' : ''} ${full ? 'is-full' : ''}">
    ${bare ? '' : `<header class="topbar">"""
new = """function shell(inner, { chrome = true, bare = false, full = false } = {}) {
  const club = ctx.S?.squads[ctx.account];
  app.innerHTML = `<div class="app ${bare ? 'is-bare' : ''} ${full ? 'is-full' : ''}">
    ${chrome ? `<header class="topbar">"""
assert old in s
s = s.replace(old, new)

old2 = """    <main id="view" class="view">${inner}</main>
    ${bare ? '' : `<nav class="tabbar">"""
new2 = """    <main id="view" class="view">${inner}</main>
    ${chrome ? `<nav class="tabbar">"""
assert old2 in s
s = s.replace(old2, new2)

s = s.replace("""  shell('<div class="stack">' + skeletonList(6) + '</div>', { bare: true, full: true });""",
              """  shell('<div class="stack">' + skeletonList(6) + '</div>', { chrome: false, full: true });""")

old3 = """  'leave-live': () => { live?.destroy(); live = null; go('home'); shell(skeletonFor('home')); document.querySelector('.topbar__title').textContent = titleOf(); setTimeout(refresh, 60); },"""
new3 = """  'leave-live': () => { live?.destroy(); live = null; route = 'live'; go('home'); },"""
assert old3 in s
s = s.replace(old3, new3)

io.open(p, 'w', encoding='utf-8').write(s)
print('app patched')
