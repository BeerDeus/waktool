#!/usr/bin/env python3
"""Génère data/recipes/<métier>.json (14 métiers) + data/crafts.js, télécharge les icônes.

Usage: python3 scripts/build_recipes.py <cache_dir>   (même cache que build_data.py : <cache_dir>/gd/*.json)
À lancer après build_data.py (réutilise data/metiers.js pour relier les ingrédients aux ressources récoltables).

Format d'un fichier de recettes :
  { "items": { "<id>": [nom, icône, niveau, rareté, source|null, [métiers qui le fabriquent]|null] },
    "recipes": [[id, niveau, xp, upgrade(0/1), [idRésultat, qté], [[idIngrédient, qté], ...]], ...] }
  source = "<métier>:<niveau>" quand l'objet se récolte (lien vers la ressource).
"""
import json
import os
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(sys.argv[1], 'gd')
IMG = os.path.join(ROOT, 'img', 'items')
ICON = 'https://static.ankama.com/wakfu/portal/game/item/115/{}.png'


def load(n):
    with open(os.path.join(GD, n + '.json'), encoding='utf-8') as f:
        return json.load(f)


items = {}
for src in ('items', 'jobsItems'):
    for it in load(src):
        d = it['definition'].get('item', it['definition'])
        if 'title' in it and d['id'] not in items:
            items[d['id']] = dict(name=it['title'].get('fr'), gfx=d['graphicParameters']['gfxId'], level=d['level'],
                                  rarity=d.get('baseParameters', {}).get('rarity', d.get('rarity')) or 0)

results, ingredients = defaultdict(list), defaultdict(list)
for r in load('recipeResults'):
    results[r['recipeId']].append(r)
for r in load('recipeIngredients'):
    ingredients[r['recipeId']].append(r)

HARVEST = {64: 'paysan', 71: 'forestier', 72: 'herboriste', 73: 'mineur', 74: 'trappeur', 75: 'pecheur'}
CRAFT = {
    40: ('boulanger', 'Boulanger', '#d9a05b', 'Pain de Farle'),
    76: ('cuisinier', 'Cuisinier', '#e0784f', 'Poisson Pané au Four'),
    77: ('armurier', 'Armurier', '#8fa3b8', 'Plaque Grossière'),
    78: ('bijoutier', 'Bijoutier', '#5fb3c9', 'Gemme Grossière'),
    79: ('tailleur', 'Tailleur', '#b07fd0', 'Coiffe du Bouftou'),
    80: ('maroquinier', 'Maroquinier', '#a8794f', 'Cuir Grossier'),
    81: ('ebeniste', 'Ébéniste', '#9a7b4f', 'Planche Grossière'),
    83: ('maitre-armes', "Maître d'armes", '#c9a227', 'Lame Grossière'),
}

# objets récoltables -> "métier:niveau" (depuis data/metiers.js déjà généré)
src = {}
with open(os.path.join(ROOT, 'data', 'metiers.js'), encoding='utf-8') as f:
    s = f.read()
jobs_data = json.loads(s[s.index('{'):s.rindex('}') + 1])
for j in jobs_data['jobs']:
    for r in j['resources']:
        for k in ('normal', 'rare', 'seed'):
            for it in r.get(k) or []:
                if it.get('id'):
                    src.setdefault(it['id'], f"{j['key']}:{r['level']}")

# objet -> métiers qui savent le fabriquer (hors améliorations de rareté)
CAT_KEY = {**HARVEST, **{c: v[0] for c, v in CRAFT.items()}}
producers = defaultdict(set)
for r in load('recipes'):
    if not r['isUpgrade']:
        for x in results[r['id']]:
            producers[x['productedItemId']].add(CAT_KEY[r['categoryId']])

downloads = set()
out_dir = os.path.join(ROOT, 'data', 'recipes')
os.makedirs(out_dir, exist_ok=True)
summary = []
by_cat = defaultdict(list)
for r in load('recipes'):
    by_cat[r['categoryId']].append(r)

for cat, recs in sorted(by_cat.items()):
    key = HARVEST.get(cat) or CRAFT[cat][0]
    used, rows = {}, []
    for r in sorted(recs, key=lambda x: (x['level'], x['id'])):
        res = [x for x in results[r['id']] if x['productedItemId'] in items]
        ing = [x for x in sorted(ingredients[r['id']], key=lambda x: x['ingredientOrder']) if x['itemId'] in items]
        if not res:
            continue
        for iid in [res[0]['productedItemId']] + [x['itemId'] for x in ing]:
            used[iid] = items[iid]
        rows.append([r['id'], r['level'], r['xpRatio'], 1 if r['isUpgrade'] else 0,
                     [res[0]['productedItemId'], res[0]['productedItemQuantity']],
                     [[x['itemId'], x['quantity']] for x in ing]])
    data = {'items': {}, 'recipes': rows}
    for iid, it in used.items():
        downloads.add(it['gfx'])
        data['items'][str(iid)] = [it['name'], f"img/items/{it['gfx']}.png", it['level'], it['rarity'], src.get(iid),
                                   sorted(producers[iid]) or None]
    with open(os.path.join(out_dir, key + '.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    if cat in CRAFT:
        _, label, color, icon_name = CRAFT[cat]
        ic = next((it for it in items.values() if it['name'] == icon_name), None) or used[rows[0][4][0]]
        downloads.add(ic['gfx'])
        summary.append(dict(key=key, label=label, color=color, icon=f"img/items/{ic['gfx']}.png",
                            count=len(rows), max=max(x[1] for x in rows)))
    print(f'{key:13} {len(rows):5} recettes, {len(used):5} objets')

import hashlib
h = hashlib.sha1()
for fn in sorted(os.listdir(out_dir)):
    with open(os.path.join(out_dir, fn), 'rb') as f:
        h.update(f.read())
with open(os.path.join(ROOT, 'data', 'crafts.js'), 'w', encoding='utf-8') as f:
    f.write('window.WAKFU_CRAFTS = ')
    json.dump(summary, f, ensure_ascii=False, separators=(',', ':'))
    f.write(f";\nwindow.WAKFU_RECIPES_V = '{h.hexdigest()[:8]}';\n")

os.makedirs(IMG, exist_ok=True)
missing = [g for g in downloads if not os.path.exists(os.path.join(IMG, f'{g}.png'))]


def fetch(g):
    p = os.path.join(IMG, f'{g}.png')
    r = subprocess.run(['curl', '-sSfL', '-m', '30', '-o', p + '.part', ICON.format(g)], check=False)
    if r.returncode == 0:
        os.replace(p + '.part', p)
    elif os.path.exists(p + '.part'):
        os.remove(p + '.part')


with ThreadPoolExecutor(8) as ex:
    list(ex.map(fetch, missing))
left = [g for g in downloads if not os.path.exists(os.path.join(IMG, f'{g}.png'))]
print(f'{len(downloads)} icônes, {len(missing)} à télécharger, {len(left)} manquantes')
