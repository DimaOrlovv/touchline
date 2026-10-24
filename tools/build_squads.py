import csv, json, io, sys, datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

rows = {r['player_id']: r for r in csv.DictReader(open('data/fc27_players.csv', encoding='utf-8'))}

# (file label, player_id in EA FC 27 dataset, position from squads.txt, is captain)
TEAMS = {
    'arsenal': {
        'coach': 'Mikel Arteta', 'name': 'Arsenal',
        'starter': [('D. Raya', '220901', 'GK', 0), ('N. Mendes', '252145', 'LB', 0), ('Gabriel', '232580', 'CB', 0),
                    ('Upamecano', '229558', 'CB', 0), ('Timber', '251805', 'RB', 0), ('D. Rice', '234378', 'CDM', 1),
                    ('J. Bellingham', '252371', 'CM', 0), ('Szoboszlai', '236772', 'CM', 0), ('J. Doku', '246420', 'LW', 0),
                    ('E. Haaland', '239085', 'ST', 0), ('M. Olise', '247827', 'RW', 0)],
        'bench': [('G. Donnarumma', '230621', 'GK'), ('Calafiori', '257711', 'LB'), ('Van Dijk', '203376', 'CB'),
                  ('Bastoni', '237383', 'CB'), ('J. Kounde', '241486', 'RB'), ('Caicedo', '256079', 'CDM'),
                  ('E. Fernandez', '247090', 'CM'), ('Odegaard', '222665', 'CM'), ('B. Barcola', '264652', 'LW'),
                  ('H. Kane', '202126', 'ST'), ('Semenyo', '241236', 'RW')],
    },
    'barcelona': {
        'coach': 'Pep Guardiola', 'name': 'FC Barcelona',
        'starter': [('J. Garcia', '259532', 'GK', 0), ('Cucurella', '239231', 'LB', 0), ('Cubarsi', '278046', 'CB', 0),
                    ('W. Saliba', '243715', 'CB', 0), ('Hakimi', '235212', 'RB', 0), ('F. Lopez', '277179', 'CAM', 0),
                    ('Pedri', '251854', 'CM', 0), ('Vitinha', '255253', 'CM', 0), ('Kvaratskhelia', '247635', 'LW', 0),
                    ('Raphinha', '233419', 'ST', 1), ('L. Yamal', '277643', 'RW', 0)],
        'bench': [('S. Lammens', '254803', 'GK'), ('Lisandro', '239301', 'LB'), ('Schlotterbeck', '247819', 'CB'),
                  ('E. Garcia', '245037', 'CB'), ('F. Valverde', '239053', 'RB'), ('N. Paz', '277846', 'CAM'),
                  ('F. Wirtz', '256630', 'CM'), ('J. Neves', '272834', 'CM'), ('M. Cunha', '240243', 'LW'),
                  ('Oyarzabal', '230142', 'ST'), ('L. Diaz', '241084', 'RW')],
    },
    'real_madrid': {
        'coach': 'Hansi Flick', 'name': 'Real Madrid',
        'starter': [('T. Courtois', '192119', 'GK', 0), ('J. Cancelo', '210514', 'LB', 0), ('Pacho', '256196', 'CB', 0),
                    ('Marquinhos', '207865', 'CB', 1), ('X. Espart', '81863', 'RB', 0), ('Rodri', '231866', 'CDM', 0),
                    ('B. Fernandez', '212198', 'CM', 0), ('J. Musiala', '256790', 'CM', 0), ('D. Doue', '271421', 'LW', 0),
                    ('K. Mbappe', '231747', 'ST', 0), ('J. Alvarez', '246191', 'RW', 0)],
        'bench': [('U. Simon', '230869', 'GK'), ('Dimarco', '226268', 'LB'), ('R. Dias', '239818', 'CB'),
                  ('J. Gvardiol', '251517', 'CB'), ('Trent AA', '231281', 'RB'), ('Palmer', '257534', 'CDM'),
                  ('D. Olmo', '244260', 'CM'), ('R. Cherki', '251570', 'CM'), ('A. Gordon', '242964', 'LW'),
                  ('V. Osimhen', '232293', 'ST'), ('N. Williams', '256516', 'RW')],
    },
}

COLS = [('overall_rating', 'overall')] + [(k, k) for k in [
    'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality',
    'attacking_finishing', 'attacking_short_passing', 'skill_long_passing', 'skill_dribbling',
    'skill_ball_control', 'skill_fk_accuracy', 'movement_acceleration', 'movement_agility',
    'movement_reactions', 'movement_balance', 'power_shot_power', 'power_stamina', 'power_strength',
    'power_jumping', 'power_long_shots', 'mentality_aggression', 'mentality_composure',
    'mentality_vision', 'mentality_penalties', 'defending_awareness', 'defending_standing_tackle',
    'defending_sliding_tackle', 'goalkeeping_diving', 'goalkeeping_reflexes', 'goalkeeping_positioning']]

def build(label, pid, pos, captain=0):
    r = rows[pid]
    d = {out_k: (int(float(r[src_k])) if r.get(src_k) not in (None, '') else 0) for src_k, out_k in COLS}
    birth = r.get('birthdate') or ''
    age = 0
    if birth:
        day, mon, year = [int(x) for x in birth.replace('-', '/').split('/')]
        today = datetime.date(2026, 10, 24)
        age = today.year - year - ((today.month, today.day) < (mon, day))
    return {
        'id': pid, 'name': label, 'fc27_name': r['common_name'] or (r['first_name'] + ' ' + r['last_name']),
        'pos': pos, 'role': pos, 'captain': captain, 'age': age,
        'nationality': r['nationality'], 'fc27_club': r['club'], 'foot': r['preferred_foot'],
        'skill_moves': int(r['skill_moves'] or 0), 'weak_foot': int(r['weak_foot'] or 0),
        'height': r['height_cm'], 'playstyles': r['playstyles'],
        **d,
    }

out = {'source': {'dataset': 'EA SPORTS FC 27 (community dataset, snapshot 2026-09-12)',
                  'repo': 'LakshmiKanth11/EA_FC_ANALYSIS'}, 'teams': []}
for key, t in TEAMS.items():
    squad = {
        'key': key, 'name': t['name'], 'coach': t['coach'], 'formation': '4-3-3',
        'style': {'tempo': 'control', 'press': 'high', 'transition': 'counter'},
        'starters': [build(n, pid, pos, cap) for n, pid, pos, cap in t['starter']],
        'bench': [build(n, pid, pos) for n, pid, pos in t['bench']],
    }
    squad['avg_starters'] = round(sum(p['overall'] for p in squad['starters']) / 11, 1)
    squad['avg_bench'] = round(sum(p['overall'] for p in squad['bench']) / len(squad['bench']), 1)
    out['teams'].append(squad)
    print(key, squad['avg_starters'], squad['avg_bench'])

json.dump(out, open('src/data/squads.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('players:', sum(len(s['starters']) + len(s['bench']) for s in out['teams']))
