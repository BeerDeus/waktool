#!/usr/bin/env python3
"""Génère data/metiers.js + télécharge les images dans img/.

Usage: python3 scripts/build_data.py <cache_dir>
<cache_dir> doit contenir :
  gd/*.json            gamedata Ankama (https://wakfu.cdn.ankama.com/gamedata/<version>/<type>.json)
  dl/loc.json          tableaux methodwakfu parsés (scripts/parse_methodwakfu.py)
  dl/wikih_<Job>.html  rendu des pages métiers de wakfu.wiki.gg (api.php?action=parse&prop=text)
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = sys.argv[1]
GD = os.path.join(CACHE, 'gd')
IMG = os.path.join(ROOT, 'img')
ANKAMA_ICON = 'https://static.ankama.com/wakfu/portal/game/item/115/{}.png'
METHOD = 'https://methodwakfu.com'
WIKI = 'https://wakfu.wiki.gg'


def load(name):
    with open(os.path.join(GD, name + '.json'), encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- gamedata
items = {}  # id -> dict(name, en, gfx, rarity, type, level)
for src in ('items', 'jobsItems'):
    for it in load(src):
        d = it['definition'].get('item', it['definition'])
        if 'title' not in it:
            continue
        items.setdefault(d['id'], dict(
            id=d['id'],
            name=it['title'].get('fr'),
            en=it['title'].get('en'),
            gfx=d['graphicParameters']['gfxId'],
            rarity=d.get('baseParameters', {}).get('rarity', d.get('rarity')),
            type=d.get('baseParameters', {}).get('itemTypeId', d.get('itemTypeId')),
            level=d['level'],
            raw=it,
        ))
by_name = {}
by_en = {}
for it in items.values():
    by_name.setdefault(it['name'].lower(), it)
    if it['en']:
        by_en.setdefault(it['en'].lower(), it)

recipes = {r['id']: r for r in load('recipes')}
rec_by_item = {}
for r in load('recipeResults'):
    rec_by_item.setdefault(r['productedItemId'], []).append(r['recipeId'])
ingr = {}
for r in load('recipeIngredients'):
    ingr.setdefault(r['recipeId'], []).append(r)
resources = {r['definition']['id']: r for r in load('resources')}
collect = load('collectibleResources')

JOBS = [
    # key, skill id, label, methodwakfu section, wiki page, couleur, icône methodwakfu
    ('paysan', 64, 'Paysan', '5-paysan', 'Farmer', '#e6b84a', 'Paysan'),
    ('forestier', 71, 'Forestier', '1-forestier', 'Lumberjack', '#7fb35a', 'Forestier'),
    ('herboriste', 72, 'Herboriste', '4-herboriste', 'Herbalist', '#c77dd6', 'Herboriste'),
    ('mineur', 73, 'Mineur', '2-mineur', 'Miner', '#9aa7b8', 'Mineur'),
    ('pecheur', 75, 'Pêcheur', '3-p-cheur', 'Fisherman', '#4fa8d8', 'Pecheur'),
    ('trappeur', 74, 'Trappeur', None, 'Trapper', '#d9774a', 'Trappeur'),
]
SKILL_TO_JOB = {j[1]: j[0] for j in JOBS}

# métiers sensibles à la météo (température -> durée des actions, humidité -> plantation)
CLIMATE_SKILLS = {64, 71, 72}

# ressources d'évènement / test à ignorer
IGNORED_RES = {802, 826, 824, 856, 717, 825, 855, 834, 833, 643}

# ---------------------------------------------------------------- images
downloads = []  # (url, local path)


def want(url, rel):
    path = os.path.join(IMG, rel)
    downloads.append((url, path))
    return 'img/' + rel


def item_icon(it):
    return want(ANKAMA_ICON.format(it['gfx']), f"items/{it['gfx']}.png")


def item_ref(it, qty=None):
    o = dict(id=it['id'], name=it['name'], icon=item_icon(it))
    if qty:
        o['qty'] = qty
    return o


SEED_RE = re.compile(r'^(Graine|Bouture|Spores|Pousse|Semence|Mucilage)', re.I)


def recipe_of(item_id, skill=None):
    out = []
    for rid in rec_by_item.get(item_id, []):
        r = recipes.get(rid)
        if not r or (skill and r['categoryId'] != skill):
            continue
        ing = [item_ref(items[i['itemId']], i['quantity'])
               for i in sorted(ingr.get(rid, []), key=lambda x: x['ingredientOrder'])
               if i['itemId'] in items]
        out.append(dict(level=r['level'], job=r['categoryId'], ingredients=ing))
    return out[0] if out else None


# ---------------------------------------------------------------- ressources récolte
with open(os.path.join(CACHE, 'dl', 'loc.json'), encoding='utf-8') as f:
    loc = json.load(f)


def wiki_rows(page):
    with open(os.path.join(CACHE, 'dl', f'wikih_{page}.html'), encoding='utf-8') as f:
        s = f.read()
    rows = []
    for tr in re.findall(r'<tr.*?</tr>', s, re.S):
        cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip()
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S)]
        imgs = re.findall(r'src="([^"]+)"', tr)
        if cells and re.match(r'^\d+$', cells[0]):
            rows.append((cells, imgs))
    return rows


def wiki_full(src):
    m = re.match(r'/images/thumb/([^/]+)/', src)
    return WIKI + '/images/' + (m.group(1) if m else src.split('/images/')[-1].split('?')[0])


# zones (noms EN du wiki) des ressources 150+ non couvertes par methodwakfu
ZONE_FR = ['Cosmo Canyon', "Grambos' Desolation", 'Bwork Swamps', 'Savannah', 'Primal Forest']


def harvest_resources(skill):
    by_res = {}
    for c in collect:
        if c['skillId'] == skill and c['resourceId'] not in IGNORED_RES and c['collectItemId'] in items:
            by_res.setdefault(c['resourceId'], []).append(c)
    out = {}
    for rid, cs in by_res.items():
        if skill == 64 and rid == 843:  # fruit étrange de l'Astracacia (forestier)
            continue
        lvl = min(c['skillLevelRequired'] for c in cs)
        drops = {}
        for c in cs:
            it = items[c['collectItemId']]
            drops[it['id']] = it
        normal, rare, seed = [], [], []
        for it in sorted(drops.values(), key=lambda x: x['name']):
            if SEED_RE.match(it['name']):
                seed.append(item_ref(it))
            elif it['rarity'] and it['rarity'] >= 2:
                rare.append(item_ref(it))
            else:
                normal.append(item_ref(it))
        rd = resources[rid]['definition']
        out.setdefault(lvl, []).append(dict(
            temp=[rd['idealTemperatureRangeMin'], rd['idealTemperatureRangeMax']], rain=rd.get('idealRain'),
            rid=rid, name=resources[rid]['title']['fr'], en=resources[rid]['title']['en'],
            level=lvl, normal=normal, rare=rare, seed=seed))
    return out


def build_harvest(job):
    key, skill, label, msec, wpage, *_ = job
    gd = harvest_resources(skill)
    rows = []
    used = set()
    for r in loc[msec]['rows']:
        lvl = int(r[0]['text'][0])
        name = r[1]['text'][0]
        zones = r[3]['text']
        app = r[2]['img']
        cands = gd.get(lvl, [])
        g = cands[0] if len(cands) == 1 else next(
            (c for c in cands if c['name'].lower()[:4] == name.lower()[:4]), cands[0] if cands else None)
        row = dict(level=lvl, name=name, zones=zones, source='methodwakfu')
        if app:
            ext = os.path.splitext(app)[1] or '.png'
            row['appearance'] = want(METHOD + re.sub(r'^https?:/+[^/]*(?=/wp-content)|^https?:/(?=wp-content)', '/', app) if 'wp-content' in app else app, f"res/{key}-{lvl}{ext}")
        if g:
            used.add(g['rid'])
            row.update(normal=g['normal'], rare=g['rare'], seed=g['seed'])
            if skill in CLIMATE_SKILLS:
                row.update(temp=g['temp'], rain=g['rain'])
        rows.append(row)
    # ressources récentes (gamedata) absentes de methodwakfu
    wiki = {}
    for cells, imgs in wiki_rows(wpage):
        wiki.setdefault(int(cells[0]), (cells, imgs))
    for lvl, cands in gd.items():
        for g in cands:
            if g['rid'] in used or lvl <= 145:
                continue
            w = wiki.get(lvl)
            zones_en = []
            app = None
            if w:
                cells, imgs = w
                zone_cell = next((c for c in cells[2:] if any(z in c for z in ZONE_FR)), '')
                zones_en = [z for z in ZONE_FR if z in zone_cell]
                ores = [i for i in imgs if '64px' in i or '%28' in i]
                if ores:
                    app = want(wiki_full(ores[0]), f"res/{key}-{lvl}.png")
            row = dict(level=lvl, name=g['name'], zones=[] if zones_en else ['Zone non documentée'],
                       zones_en=zones_en, source='wiki', normal=g['normal'], rare=g['rare'], seed=g['seed'])
            if app:
                row['appearance'] = app
            if skill in CLIMATE_SKILLS:
                row.update(temp=g['temp'], rain=g['rain'])
            rows.append(row)
    rows.sort(key=lambda r: r['level'])
    return rows


def build_trapper():
    rows = []
    of_re = re.compile(r"\s(?:de la |de l'|des |du |de |d')(.+)$", re.I)
    for cells, imgs in wiki_rows('Trapper'):
        lvl = int(cells[0])
        # cellules: niveau, famille, [img, nom] x (graine, ressource, restes, autre)
        names = [c for c in cells[2:] if c and c != 'N/A']
        if not names:
            continue
        imgs = [i for i in imgs]
        refs, seen = [], set()
        for idx, n in enumerate(names):
            if n in seen:
                continue
            seen.add(n)
            it = by_en.get(n.lower())
            if it:
                refs.append(item_ref(it))
            else:
                ico = None
                if idx < len(imgs):
                    fname = re.sub(r'[^A-Za-z0-9_.-]', '_', urllib.parse.unquote(wiki_full(imgs[idx]).split('/')[-1]))
                    ico = want(wiki_full(imgs[idx]), f'wiki/{fname}')
                refs.append(dict(name=n, icon=ico, en=True))
        fams = [m.group(1) for r in refs[1:] if not r.get('en') for m in [of_re.search(r['name'])] if m]
        fam = max(set(fams), key=fams.count) if fams else None
        rows.append(dict(level=lvl, name=fam or cells[1], family_en=cells[1],
                         seed=refs[:1], normal=refs[1:], rare=[],
                         zones=[], hint='Récolte sur les monstres de cette famille (vivants ou morts)',
                         source='wiki'))
    return rows


# ---------------------------------------------------------------- outils / familiers / consommables
TOOLS = {
    'paysan': ['Faux', 'Faux Rakor', 'Faux Dell'],
    'forestier': ['Hache en bois', 'Hachette du Forestier', 'Toumouwouk'],
    'herboriste': ['Serpe', 'Serpe Aisk', 'Serpe Hier'],
    'mineur': ['Pioche', 'Pic Mine', 'La Bonne Pioche'],
    'pecheur': ['Canne à Pêche', 'Canne à Pêche en Bois', 'Canne Iboul'],
    'trappeur': ['Coutelas', 'Coutelas Racroft', 'Coutelas des Âges Farouches'],
}
PETS = {'paysan': 'Geist', 'forestier': 'Picar', 'herboriste': 'Sakoch', 'mineur': 'Snouffle',
        'pecheur': 'Kalypsor', 'trappeur': 'Gobgob'}
CONSUMABLES = {'paysan': "P'tit fibre en tube", 'forestier': 'Ecorce à mâcher', 'herboriste': 'Menthole',
               'mineur': 'Gum Gum', 'pecheur': 'Tartare fluvial', 'trappeur': 'Baume de Bave'}
EXTRAS = {
    'mineur': [dict(name='Casque de la Mine', bonus='+25 % quantité récoltée', how='Craft Tailleur')],
}
JOB_LABEL = {j[1]: j[2] for j in JOBS}
JOB_LABEL.update({76: 'Cuisinier', 77: 'Armurier', 78: 'Bijoutier', 79: 'Tailleur', 80: 'Maroquinier',
                  81: 'Ébéniste', 82: "Maître d'armes", 40: 'Boulanger'})


def harvest_bonus(it):
    for e in it['raw']['definition'].get('equipEffects', []):
        d = e['effect']['definition']
        if d['actionId'] == 2001:
            return d['params']
    return None


def tool(name):
    it = by_name[name.lower()]
    p = harvest_bonus(it)
    rec = recipe_of(it['id'])
    if rec:
        rec['job_label'] = JOB_LABEL.get(rec['job'])
    return dict(item_ref(it), level=rec['level'] if rec else None, bonus=int(p[0]) if p else None, recipe=rec)


def pet(name):
    it = by_name[name.lower()]
    p = harvest_bonus(it)
    return dict(item_ref(it), bonus_min=int(p[0] + p[1]), bonus_max=int(p[0] + p[1] * 50),
                how='Brèches', desc=it['raw'].get('description', {}).get('fr', ''))


def consumable(name):
    it = by_name[name.lower()]
    rec = recipe_of(it['id'])
    if rec:
        rec['job_label'] = JOB_LABEL.get(rec['job'])
    return dict(item_ref(it), level=rec['level'] if rec else it['level'], bonus='+15 % quantité récoltée',
                duration='15 min', how='Craft (atelier du métier) ou butin Mimics sucrés', recipe=rec)


def extra(e):
    it = by_name.get(e['name'].lower())
    o = dict(e)
    if it:
        o.update(item_ref(it))
        rec = recipe_of(it['id'])
        if rec:
            rec['job_label'] = JOB_LABEL.get(rec['job'])
            o['recipe'] = rec
            o['level'] = rec['level']
    return o


data = dict(version=None, jobs=[], common=[])
with open(os.path.join(CACHE, 'gd', 'version.txt')) as f:
    data['version'] = f.read().strip()

for job in JOBS:
    key, skill, label, msec, wpage, color, icon = job
    data['jobs'].append(dict(
        key=key, label=label, color=color,
        icon=want(f'{METHOD}/wp-content/uploads/2020/08/Metier_Icone{icon}.png', f'jobs/{key}.png'),
        resources=build_trapper() if key == 'trappeur' else build_harvest(job),
        tools=[tool(n) for n in TOOLS[key]],
        pet=pet(PETS[key]),
        consumable=consumable(CONSUMABLES[key]),
        extras=[extra(e) for e in EXTRAS.get(key, [])],
    ))

sceau = by_name['sceau des compagnons']
nox = by_name['noxine']
data['common'] = [
    dict(item_ref(sceau), kind='Anneau', bonus='+50 % quantité récoltée (tous métiers)',
         how='Exploit de métiers « Multi Max »'),
    dict(item_ref(nox), kind='Familier', bonus='+5 % à +25 % quantité récoltée (tous métiers)', how='Brèches'),
    dict(name='Potion de récolte', kind='Consommable', bonus='+50 % quantité récoltée, 2 h', how='Boutique'),
    dict(name='Source de Wakfu', kind='Buff', bonus='XP plantation +20 % à +40 %, 30 min', how="Montagnes d'Astrub"),
    dict(name='Source de Stasis', kind='Buff', bonus='XP récolte +10 % à +20 %, 30 min', how='Bergerie de Tainela'),
]

os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
with open(os.path.join(ROOT, 'data', 'metiers.js'), 'w', encoding='utf-8') as f:
    f.write('window.WAKFU_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

# ---------------------------------------------------------------- téléchargements
todo = {}
for url, path in downloads:
    todo[path] = url
missing = [(u, p) for p, u in todo.items() if not os.path.exists(p)]


def fetch(job):
    u, p = job
    os.makedirs(os.path.dirname(p), exist_ok=True)
    r = subprocess.run(['curl', '-sSfL', '-m', '30', '-o', p + '.part', u], check=False)
    if r.returncode == 0:
        os.replace(p + '.part', p)
    elif os.path.exists(p + '.part'):
        os.remove(p + '.part')


with ThreadPoolExecutor(1) as ex:
    list(ex.map(fetch, missing))
bad = [p for p in todo if not os.path.exists(p) or os.path.getsize(p) == 0]
print(f"{len(data['jobs'])} métiers, {sum(len(j['resources']) for j in data['jobs'])} ressources, "
      f"{len(todo)} images ({len(missing)} téléchargées, {len(bad)} manquantes)")
for p in bad:
    print('  manquante:', os.path.relpath(p, ROOT), todo[p])
