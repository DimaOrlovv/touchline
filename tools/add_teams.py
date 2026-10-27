import csv, json, io, sys, datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

RAW = 'src/data/squads.json'
squads = json.load(open(RAW, encoding='utf-8'))
# старый PSG жил под ключом arsenal — освобождаем ключ для лондонского Арсенала
for t in squads['teams']:
    if t['key'] == 'arsenal':
        t['key'] = 'psg'
used = {p['id'] for t in squads['teams'] for p in t['starters'] + t['bench']}

rows = {r['player_id']: r for r in csv.DictReader(open('data/fc27_players.csv', encoding='utf-8'))}

POS_MAP = {
    'GK': 'GK', 'CB': 'CB', 'LB': 'LB', 'LWB': 'LB', 'RB': 'RB', 'RWB': 'RB',
    'CDM': 'CDM', 'CM': 'CM', 'CAM': 'CAM', 'LW': 'LW', 'LM': 'LW',
    'RW': 'RW', 'RM': 'RW', 'ST': 'ST', 'CF': 'ST',
}

SLOTS = ['GK', 'GK', 'LB', 'LB', 'CB', 'CB', 'CB', 'CB', 'RB', 'RB',
         'CDM', 'CDM', 'CM', 'CM', 'CM', 'CAM', 'CAM', 'LW', 'LW', 'RW', 'RW', 'ST']

FALLBACK = {
    'GK': ['GK'],
    'LB': ['LB', 'RB', 'CB', 'LW', 'CDM'],
    'CB': ['CB', 'LB', 'RB', 'CDM'],
    'RB': ['RB', 'LB', 'CB', 'RW', 'CDM'],
    'CDM': ['CDM', 'CM', 'CAM', 'CB'],
    'CM': ['CM', 'CDM', 'CAM'],
    'CAM': ['CAM', 'CM', 'RW', 'LW', 'ST'],
    'LW': ['LW', 'RW', 'CAM', 'ST', 'CM'],
    'RW': ['RW', 'LW', 'CAM', 'ST', 'CM'],
    'ST': ['ST', 'LW', 'RW', 'CAM'],
}

TEAMS = [
    ('arsenal', 'Arsenal', 'Mikel Arteta', 'Arsenal', '4-3-3', {'tempo': 'high', 'press': 'high', 'transition': 'counter'}),
    ('manchester_city', 'Manchester City', 'Pep Guardiola', 'Manchester City', '4-3-3', {'tempo': 'control', 'press': 'high', 'transition': 'positional'}),
    ('bayern_munich', 'Bayern Munich', 'Vincent Kompany', 'FC Bayern München', '4-2-3-1', {'tempo': 'high', 'press': 'high', 'transition': 'vertical'}),
    ('liverpool', 'Liverpool', 'Arne Slot', 'Liverpool', '4-2-3-1', {'tempo': 'high', 'press': 'high', 'transition': 'counter'}),
    ('chelsea', 'Chelsea', 'Enzo Maresca', 'Chelsea', '4-2-3-1', {'tempo': 'control', 'press': 'mid', 'transition': 'positional'}),
    ('atletico_madrid', 'Atlético Madrid', 'Diego Simeone', 'Atlético de Madrid', '4-4-2', {'tempo': 'low', 'press': 'mid', 'transition': 'counter'}),
    ('inter_milan', 'Inter Milan', 'Simone Inzaghi', 'Lombardia FC', '3-5-2', {'tempo': 'control', 'press': 'mid', 'transition': 'counter'}),
]

def norm_pos(r):
    p = (r.get('position') or '').strip()
    return POS_MAP.get(p, 'CM')

def num(r, key):
    v = (r.get(key) or '').strip()
    if v in ('', '-'):
        return 0
    try:
        return int(float(v))
    except ValueError:
        return 0

def age_of(r):
    b = (r.get('birthdate') or '').strip()
    try:
        d, m, y = [int(x) for x in b.split('-')]
        born = datetime.date(y, m, d)
        ref = datetime.date(2026, 9, 12)
        return ref.year - born.year - ((ref.month, ref.day) < (born.month, born.day))
    except Exception:
        return ''

ATTRS = ['pace','shooting','passing','dribbling','defending','physicality',
         'attacking_crossing','attacking_finishing','attacking_heading_accuracy','attacking_short_passing',
         'attacking_volleys','skill_dribbling','skill_curve','skill_fk_accuracy','skill_long_passing',
         'skill_ball_control','movement_acceleration','movement_sprint_speed','movement_agility',
         'movement_reactions','movement_balance','power_shot_power','power_jumping','power_stamina',
         'power_strength','power_long_shots','mentality_aggression','mentality_interceptions',
         'mentality_positioning','mentality_vision','mentality_penalties','mentality_composure',
         'defending_awareness','defending_standing_tackle','defending_sliding_tackle',
         'goalkeeping_diving','goalkeeping_handling','goalkeeping_kicking','goalkeeping_positioning',
         'goalkeeping_reflexes']

def make_player(r, pos):
    name = (r['common_name'] or '').strip() or f"{r['first_name']} {r['last_name']}".strip()
    p = {
        'id': r['player_id'],
        'name': name,
        'pos': pos,
        'role': pos,
        'captain': 0,
        'age': age_of(r),
        'nationality': (r.get('nationality') or '').strip(),
        'foot': (r.get('preferred_foot') or '').strip(),
        'skill_moves': num(r, 'skill_moves'),
        'weak_foot': num(r, 'weak_foot'),
        'height': (r.get('height_cm') or '').strip(),
        'playstyles': (r.get('playstyles') or '').strip(),
        'overall': num(r, 'overall_rating'),
    }
    for a in ATTRS:
        p[a] = num(r, a)
    p['full_name'] = f"{r['first_name']} {r['last_name']}".strip()
    p['source_club'] = r['club']
    return p

GROUPS = {'GK': 'GK', 'LB': 'DEF', 'CB': 'DEF', 'RB': 'DEF',
          'CDM': 'MID', 'CM': 'MID', 'CAM': 'MID', 'LW': 'ATT', 'RW': 'ATT', 'ST': 'ATT'}

def pick_team(club):
    pool = [r for r in rows.values() if r['club'] == club and r['gender'] == "Men's Football" and r['player_id'] not in used]
    by_group = {'GK': [], 'DEF': [], 'MID': [], 'ATT': []}
    for r in pool:
        by_group[GROUPS[norm_pos(r)]].append(r)
    for k in by_group:
        by_group[k].sort(key=lambda x: -int(x['overall_rating'] or 0))

    chosen, ids = [], set()
    for g, quota in [('GK', 2), ('DEF', 8), ('MID', 7), ('ATT', 5)]:
        for r in by_group[g][:quota]:
            if r['player_id'] not in ids:
                chosen.append(r)
                ids.add(r['player_id'])
    # если в клубе не хватило игроков какой-то линии — добираем лучшими из остатка
    gk_count = sum(1 for r in chosen if norm_pos(r) == 'GK')
    rest = sorted([r for r in pool if r['player_id'] not in ids], key=lambda x: -int(x['overall_rating'] or 0))
    for r in rest:
        if len(chosen) >= 22:
            break
        if norm_pos(r) == 'GK' and gk_count >= 2:
            continue
        chosen.append(r)
        ids.add(r['player_id'])
        if norm_pos(r) == 'GK':
            gk_count += 1
    if len(chosen) < 22:
        for r in rest:
            if len(chosen) >= 22:
                break
            if r['player_id'] not in ids:
                chosen.append(r)
                ids.add(r['player_id'])

    players = [make_player(r, norm_pos(r)) for r in chosen]
    taken = set()

    def take(roles, n=1):
        out = []
        for p in sorted(players, key=lambda x: -x['overall']):
            if p['id'] in taken or p['pos'] not in roles:
                continue
            out.append(p)
            taken.add(p['id'])
            if len(out) == n:
                break
        return out

    starters = []
    starters += take(['GK'], 1)
    starters += take(['CB'], 2)
    starters += take(['LB'], 1)
    starters += take(['RB'], 1)
    starters += take(['CDM'], 1)
    starters += take(['CM', 'CAM'], 2)
    starters += take(['LW'], 1)
    starters += take(['ST'], 1)
    starters += take(['RW'], 1)
    for p in sorted(players, key=lambda x: -x['overall']):
        if len(starters) >= 11:
            break
        if p['id'] not in taken:
            starters.append(p)
            taken.add(p['id'])

    order = {'GK': 0, 'LB': 1, 'CB': 2, 'RB': 3, 'CDM': 4, 'CM': 5, 'CAM': 6, 'LW': 7, 'ST': 8, 'RW': 9}
    starters.sort(key=lambda p: (order.get(p['pos'], 9), -p['overall']))
    bench = [p for p in players if p['id'] not in taken]
    bench.sort(key=lambda p: (order.get(p['pos'], 9), -p['overall']))
    cap = max(starters, key=lambda p: p['overall'])
    cap['captain'] = 1
    avg = lambda arr: round(sum(p['overall'] for p in arr) / max(1, len(arr)), 1)
    return {
        'key': None, 'name': None, 'coach': None, 'formation': None, 'style': None,
        'starters': starters, 'bench': bench,
        'avg_starters': avg(starters), 'avg_bench': avg(bench),
    }

for key, name, coach, club, formation, style in TEAMS:
    t = pick_team(club)
    t['key'], t['name'], t['coach'], t['formation'], t['style'] = key, name, coach, formation, style
    squads['teams'].append(t)
    pos_count = {}
    for p in t['starters'] + t['bench']:
        pos_count[p['pos']] = pos_count.get(p['pos'], 0) + 1
    print(f"{name:16} {t['avg_starters']}/{t['avg_bench']}  {pos_count}")

json.dump(squads, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('teams:', len(squads['teams']), '| players:', sum(len(t['starters']) + len(t['bench']) for t in squads['teams']))
