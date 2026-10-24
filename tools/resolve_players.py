import csv, re, unicodedata, difflib, json, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def norm(s):
    s = unicodedata.normalize('NFKD', (s or '')).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-z ]', ' ', s.lower())
    return re.sub(r'\s+', ' ', s).strip()

rows = list(csv.DictReader(open('data/fc27_players.csv', encoding='utf-8')))
men = [r for r in rows if r['gender'] != "Women's Football" and int(r['overall_rating'] or 0) >= 72]
QUERIES = json.load(open('data/queries.json', encoding='utf-8'))

def search(query):
    parts = [p for p in norm(query).split() if len(p) > 2]
    scored = []
    for r in men:
        hay = ' '.join([norm(r['common_name']), norm(r['first_name']), norm(r['last_name']),
                        norm(r['alternate_positions']), norm(r['position'])])
        toks = set(t for t in hay.split() if t)
        score = 0.0
        for p in parts:
            best = 0.0
            for t in toks:
                if t == p:
                    best = max(best, 3.0)
                elif t.startswith(p) or p.startswith(t):
                    best = max(best, 2.0)
                else:
                    ratio = difflib.SequenceMatcher(None, t, p).ratio()
                    if ratio > 0.78:
                        best = max(best, 1.7 * ratio)
            score += best
        if score >= 1.6:
            scored.append((score, r))
    scored.sort(key=lambda x: (-x[0], -int(x[1]['overall_rating'])))
    return scored[:5]

for label, q in QUERIES.items():
    c = search(q)
    print(f"=== {label}  (query: {q})")
    for s, r in c:
        name = r['common_name'] or (r['first_name'] + ' ' + r['last_name'])
        print(f"    {name:<26} {r['overall_rating']:>3}  {r['position']:<12} {(r['club'] or '')[:28]:<28} id={r['player_id']} s={s:.1f}")
    if not c:
        print("    *** NO MATCH ***")
