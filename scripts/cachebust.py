#!/usr/bin/env python3
"""Ajoute ?v=<hash du contenu> aux scripts/styles locaux référencés dans index.html.
À lancer avant chaque commit qui modifie assets/ ou data/ (évite le cache CDN Hostinger)."""
import hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, 'index.html')
s = open(p, encoding='utf-8').read()

def bump(m):
    attr, path = m.group(1), m.group(2)
    f = os.path.join(ROOT, path)
    if not os.path.isfile(f):
        return m.group(0)
    h = hashlib.sha1(open(f, 'rb').read()).hexdigest()[:8]
    return f'{attr}="{path}?v={h}"'

s2 = re.sub(r'(src|href)="((?:assets|data)/[^"?]+)(?:\?v=[0-9a-f]+)?"', bump, s)
if s2 != s:
    open(p, 'w', encoding='utf-8').write(s2)
print('\n'.join(re.findall(r'(?:src|href)="((?:assets|data)/[^"]+)"', s2)))
