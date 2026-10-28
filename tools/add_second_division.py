import csv, json, io, sys, datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
RAW = 'src/data/squads.json'
squads = json.load(open(RAW, encoding='utf-8'))
used = {p['id'] for t in squads['teams'] for p in t['starters'] + t['bench']}
rows = {r['player_id']: r for r in csv.DictReader(open('data/fc27_players.csv', encoding='utf-8'))}

POS_MAP = {
    'GK': 'GK', 'CB': 'CB', 'LB': 'LB', 'LWB': 'LB', 'RB': 'RB', 'RWB': 'RB',
    'CDM': 'CDM', 'CM': 'CM', 'CAM': 'CAM', 'LW': 'LW', 'LM': 'LW',
    'RW': 'RW', 'RM': 'RW', 'ST': 'ST', 'CF': 'ST',
}
GROUPS = {'GK': 'GK', 'LB': 'DEF', 'CB': 'DEF', 'RB': 'DEF',
          'CDM': 'MID', 'CM': 'MID', 'CAM': 'MID', 'LW': 'ATT', 'RW': 'ATT', 'ST': 'ATT'}
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

def norm_pos(r):
    return POS_MAP.get((r.get('position') or '').strip(), 'CM')

def num(r, key):
    v = (r.get(key) or '').strip()
    if v in ('', '-'):
        return 0
    try:
        return int(float(v))
    except ValueError:
        return 0

def age_of(r):
    try:
        d, m, y = [int(x) for x in r['birthdate'].split('-')]
        born = datetime.date(y, m, d)
        ref = datetime.date(2026, 9, 12)
        return ref.year - born.year - ((ref.month, ref.day) < (born.month, born.day))
    except Exception:
        return ''

def make_player(r, pos):
    name = (r['common_name'] or '').strip() or f"{r['first_name']} {r['last_name']}".strip()
    p = {'id': r['player_id'], 'name': name, 'pos': pos, 'role': pos, 'captain': 0,
         'age': age_of(r), 'nationality': (r.get('nationality') or '').strip(),
         'foot': (r.get('preferred_foot') or '').strip(),
         'skill_moves': num(r, 'skill_moves'), 'weak_foot': num(r, 'weak_foot'),
         'height': (r.get('height_cm') or '').strip(), 'playstyles': (r.get('playstyles') or '').strip(),
         'overall': num(r, 'overall_rating')}
    for a in ATTRS:
        p[a] = num(r, a)
    p['full_name'] = f"{r['first_name']} {r['last_name']}".strip()
    p['source_club'] = r['club']
    return p

def pick_team(club, cap):
    pool = [r for r in rows.values() if r['club'] == club and r['gender'] == "Men's Football" and r['player_id'] not in used]

    def by_group(limit):
        g = {'GK': [], 'DEF': [], 'MID': [], 'ATT': []}
        for r in pool:
            if int(r['overall_rating'] or 0) <= limit:
                g[GROUPS[norm_pos(r)]].append(r)
        for k in g:
            g[k].sort(key=lambda x: -int(x['overall_rating'] or 0))
        return g

    g = by_group(99)
    for limit in (cap, cap + 2, cap + 4, 99):
        g2 = by_group(limit)
        if all(len(g2[k]) >= q for k, q in [('GK', 2), ('DEF', 4), ('MID', 4), ('ATT', 3)]):
            g = g2
            break

    chosen, ids = [], set()
    for grp, quota in [('GK', 2), ('DEF', 8), ('MID', 7), ('ATT', 5)]:
        for r in g[grp][:quota]:
            if r['player_id'] not in ids:
                chosen.append(r)
                ids.add(r['player_id'])
    rest = sorted([r for r in pool if r['player_id'] not in ids], key=lambda x: int(x['overall_rating'] or 0))
    gk_count = sum(1 for r in chosen if norm_pos(r) == 'GK')
    for r in rest:
        if len(chosen) >= 22:
            break
        if norm_pos(r) == 'GK' and gk_count >= 2:
            continue
        chosen.append(r)
        ids.add(r['player_id'])
        if norm_pos(r) == 'GK':
            gk_count += 1
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
    starters += take(['GK'])
    starters += take(['CB'], 2)
    starters += take(['LB'])
    starters += take(['RB'])
    starters += take(['CDM'])
    starters += take(['CM', 'CAM'], 2)
    starters += take(['LW'])
    starters += take(['ST'])
    starters += take(['RW'])
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
    max(starters, key=lambda p: p['overall'])['captain'] = 1
    avg = lambda arr: round(sum(p['overall'] for p in arr) / max(1, len(arr)), 1)
    return {'key': None, 'name': None, 'coach': None, 'formation': None, 'style': None,
            'starters': starters, 'bench': bench, 'avg_starters': avg(starters), 'avg_bench': avg(bench)}

TEAMS = [
    ('napoli', 'Napoli', 'Antonio Conte', 'SSC Napoli', '4-3-3', {'tempo': 'mid', 'press': 'high', 'transition': 'counter'}, 79),
    ('juventus', 'Juventus', 'Igor Tudor', 'Juventus', '3-4-2-1', {'tempo': 'low', 'press': 'mid', 'transition': 'counter'}, 79),
    ('borussia_dortmund', 'Borussia Dortmund', 'Niko Kovač', 'Borussia Dortmund', '4-2-3-1', {'tempo': 'high', 'press': 'high', 'transition': 'vertical'}, 79),
    ('bayer_leverkusen', 'Bayer Leverkusen', 'Kasper Hjulmand', 'Leverkusen', '3-4-2-1', {'tempo': 'high', 'press': 'high', 'transition': 'vertical'}, 79),
    ('ac_milan', 'AC Milan', 'Massimiliano Allegri', 'Milano FC', '4-2-3-1', {'tempo': 'mid', 'press': 'mid', 'transition': 'counter'}, 79),
    ('roma', 'Roma', 'Gian Piero Gasperini', 'AS Roma', '3-4-2-1', {'tempo': 'high', 'press': 'high', 'transition': 'counter'}, 79),
    ('sevilla', 'Sevilla', 'Matías Almeyda', 'Sevilla FC', '4-2-3-1', {'tempo': 'low', 'press': 'mid', 'transition': 'counter'}, 78),
    ('villarreal', 'Villarreal', 'Marcelino', 'Villarreal CF', '4-4-2', {'tempo': 'mid', 'press': 'mid', 'transition': 'positional'}, 78),
    ('newcastle', 'Newcastle United', 'Eddie Howe', 'Newcastle Utd', '4-3-3', {'tempo': 'high', 'press': 'high', 'transition': 'vertical'}, 79),
    ('aston_villa', 'Aston Villa', 'Unai Emery', 'Aston Villa', '4-2-3-1', {'tempo': 'mid', 'press': 'mid', 'transition': 'counter'}, 79),
]

for key, name, coach, club, formation, style, cap in TEAMS:
    t = pick_team(club, cap)
    t.update(key=key, name=name, coach=coach, formation=formation, style=style)
    squads['teams'].append(t)
    print(f"{name:20} {t['avg_starters']}/{t['avg_bench']}  " + ', '.join(f"{p['pos']} {p['name']} {p['overall']}" for p in t['starters']))

json.dump(squads, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('teams', len(squads['teams']), 'players', sum(len(t['starters']) + len(t['bench']) for t in squads['teams']))
