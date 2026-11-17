#!/usr/bin/env python3
"""Versionne les fichiers locaux pour contourner le cache (navigateur + CDN Hostinger).

- index.html : ajoute ?v=<hash du contenu> aux scripts/styles locaux (assets/…, data/…).
- modules ES (assets/js/*.js) : ils s'importent entre eux (avec des cycles), on leur donne donc
  une version commune = hash de l'ensemble des modules ; chaque `from './x.js'` devient
  `from './x.js?v=<version>'` et index.html charge assets/js/main.js?v=<version>.
À lancer avant chaque commit qui modifie assets/ ou data/.
"""
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'assets', 'js')
IMPORT = re.compile(r"""(from\s+['"]\./[\w-]+\.js)(?:\?v=[0-9a-f]+)?(['"])""")

# 1) version commune des modules (contenu sans les ?v= existants)
mods = sorted(f for f in os.listdir(JS) if f.endswith('.js')) if os.path.isdir(JS) else []
h = hashlib.sha1()
for f in mods:
    with open(os.path.join(JS, f), encoding='utf-8') as fh:
        h.update(f.encode() + IMPORT.sub(r'\1\2', fh.read()).encode())
mv = h.hexdigest()[:8]
for f in mods:
    p = os.path.join(JS, f)
    with open(p, encoding='utf-8') as fh:
        s = fh.read()
    s2 = IMPORT.sub(lambda m: f'{m.group(1)}?v={mv}{m.group(2)}', s)
    if s2 != s:
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(s2)

# 2) index.html
p = os.path.join(ROOT, 'index.html')
with open(p, encoding='utf-8') as fh:
    s = fh.read()


def bump(m):
    attr, path = m.group(1), m.group(2)
    if path.startswith('assets/js/'):
        return f'{attr}="{path}?v={mv}"'
    f = os.path.join(ROOT, path)
    if not os.path.isfile(f):
        return m.group(0)
    with open(f, 'rb') as fh:
        v = hashlib.sha1(fh.read()).hexdigest()[:8]
    return f'{attr}="{path}?v={v}"'


s2 = re.sub(r'(src|href)="((?:assets|data)/[^"?]+)(?:\?v=[0-9a-f]+)?"', bump, s)
if s2 != s:
    with open(p, 'w', encoding='utf-8') as fh:
        fh.write(s2)
print('modules :', mv)
print('\n'.join(re.findall(r'(?:src|href)="((?:assets|data)/[^"]+)"', s2)))
