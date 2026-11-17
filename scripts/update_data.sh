#!/usr/bin/env bash
# Mise à jour des données Wakfu du site (gamedata Ankama + MethodWakfu + wakfu.wiki.gg).
#
# Usage : scripts/update_data.sh [--force]
#   Sans --force : ne fait rien si la version Ankama distante == version de data/metiers.js.
#   Avec --force : régénère tout même si la version n'a pas changé.
#
# Si $GITHUB_OUTPUT existe, y écrit `changed=true|false` et `version=<v>`.
# `changed=true` uniquement si data/ ou img/ ont réellement changé (git), auquel cas
# index.html est cache-busté et VERSION de sw.js est incrémentée.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FORCE=0
for a in "$@"; do
  case "$a" in
    --force|-f) FORCE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Argument inconnu : $a" >&2; exit 2 ;;
  esac
done

GD_URL=https://wakfu.cdn.ankama.com/gamedata
GD_FILES=(items jobsItems recipes recipeResults recipeIngredients recipeCategories
          collectibleResources harvestLoots resources resourceTypes itemTypes)
WIKI_PAGES=(Miner Farmer Lumberjack Herbalist Fisherman Trapper)
CURL=(curl -sSfL --retry 5 --retry-delay 5 --retry-all-errors --connect-timeout 20 -m 300)

output() {  # output <clé> <valeur>
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >> "$GITHUB_OUTPUT"; fi
}

# ------------------------------------------------------------------ versions
REMOTE=$("${CURL[@]}" "$GD_URL/config.json" | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])")
[ -n "$REMOTE" ] || { echo "Version distante introuvable" >&2; exit 1; }
LOCAL=$(python3 - "$ROOT/data/metiers.js" <<'PY' || true
import re, sys
try:
    s = open(sys.argv[1], encoding='utf-8').read(4096)
except OSError:
    s = ''
m = re.search(r'"version"\s*:\s*"([^"]+)"', s)
print(m.group(1) if m else '')
PY
)
echo "Version distante : $REMOTE | version du site : ${LOCAL:-aucune}"
output version "$REMOTE"

if [ "$REMOTE" = "$LOCAL" ] && [ "$FORCE" = 0 ]; then
  echo "Données à jour (v$REMOTE)"
  output changed false
  exit 0
fi

# ------------------------------------------------------------------ téléchargements
CACHE=$(mktemp -d)
trap 'rm -rf "$CACHE"' EXIT
mkdir -p "$CACHE/gd" "$CACHE/dl"
echo "$REMOTE" > "$CACHE/gd/version.txt"

echo "== Gamedata Ankama $REMOTE"
for f in "${GD_FILES[@]}"; do
  "${CURL[@]}" -o "$CACHE/gd/$f.json" "$GD_URL/$REMOTE/$f.json"
  python3 -c "import json,sys;d=json.load(open(sys.argv[1]));assert isinstance(d,list) and d, 'vide'" "$CACHE/gd/$f.json" \
    || { echo "gamedata $f.json invalide" >&2; exit 1; }
  echo "  $f.json ($(stat -c %s "$CACHE/gd/$f.json") o)"
done

echo "== MethodWakfu"
"${CURL[@]}" -A 'Mozilla/5.0 (waktool data updater)' -o "$CACHE/dl/loc.html" \
  https://methodwakfu.com/artisanat/localisation-des-ressources/
python3 - "$CACHE/dl/loc.html" "$CACHE/dl/content.html" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
a, b = s.find('id="1-forestier"'), s.find('Vous pourriez aussi aimer')
if a < 0 or b < 0 or b <= a:
    sys.exit('Page MethodWakfu : marqueurs introuvables (structure changée ?)')
open(sys.argv[2], 'w', encoding='utf-8').write(s[max(a - 200, 0):b])
PY
python3 scripts/parse_methodwakfu.py "$CACHE/dl/content.html" "$CACHE/dl/loc.json"

echo "== Wakfu Wiki"
for p in "${WIKI_PAGES[@]}"; do
  ok=0
  for try in 1 2 3 4 5 6; do
    # curl --retry gère déjà les 429/5xx ; cette boucle couvre aussi les réponses JSON d'erreur.
    if "${CURL[@]}" -o "$CACHE/dl/wiki_$p.json" \
         "https://wakfu.wiki.gg/api.php?action=parse&page=$p&prop=text&format=json" \
       && python3 -c "import json,sys;t=json.load(open(sys.argv[1]))['parse']['text']['*'];assert len(t)>1000;open(sys.argv[2],'w',encoding='utf-8').write(t)" \
            "$CACHE/dl/wiki_$p.json" "$CACHE/dl/wikih_$p.html" 2>/dev/null; then
      ok=1; break
    fi
    echo "  $p : échec (essai $try), nouvelle tentative dans $((try * 15)) s" >&2
    sleep $((try * 15))
  done
  [ "$ok" = 1 ] || { echo "Page wiki $p inaccessible" >&2; exit 1; }
  echo "  $p ($(stat -c %s "$CACHE/dl/wikih_$p.html") o)"
  sleep 2
done

# ------------------------------------------------------------------ génération
echo "== build_data.py"
python3 scripts/build_data.py "$CACHE"
echo "== build_recipes.py"
python3 scripts/build_recipes.py "$CACHE"

echo "== Vérification"
python3 - "$ROOT" "$REMOTE" <<'PY'
import json, os, sys
root, version = sys.argv[1], sys.argv[2]
def fail(msg):
    sys.exit('Données générées incohérentes : ' + msg)
p = os.path.join(root, 'data', 'metiers.js')
if not os.path.isfile(p) or os.path.getsize(p) == 0:
    fail('data/metiers.js absent ou vide')
s = open(p, encoding='utf-8').read().strip()
pre = 'window.WAKFU_DATA = '
if not s.startswith(pre) or not s.endswith(';'):
    fail('data/metiers.js mal formé')
d = json.loads(s[len(pre):-1])
if d.get('version') != version:
    fail(f"version {d.get('version')!r} au lieu de {version!r}")
jobs = d.get('jobs') or []
if len(jobs) < 6:
    fail(f'{len(jobs)} métiers (6 attendus)')
for j in jobs:
    if len(j.get('resources') or []) < 5:
        fail(f"métier {j.get('key')} : {len(j.get('resources') or [])} ressources")
rd = os.path.join(root, 'data', 'recipes')
files = [f for f in os.listdir(rd) if f.endswith('.json')] if os.path.isdir(rd) else []
if len(files) < 14:
    fail(f'{len(files)} fichiers dans data/recipes (14 attendus)')
for f in files:
    r = json.load(open(os.path.join(rd, f), encoding='utf-8'))
    if not r.get('recipes') or not r.get('items'):
        fail(f'data/recipes/{f} vide')
c = os.path.join(root, 'data', 'crafts.js')
if not os.path.isfile(c) or 'WAKFU_RECIPES_V' not in open(c, encoding='utf-8').read():
    fail('data/crafts.js absent ou incomplet')
print(f"OK : {len(jobs)} métiers, {sum(len(j['resources']) for j in jobs)} ressources, "
      f"{len(files)} fichiers de recettes")
PY

# ------------------------------------------------------------------ changements réels ?
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -z "$(git -C "$ROOT" status --porcelain -- data img)" ]; then
    echo "Régénération terminée : aucun changement dans data/ ni img/ (v$REMOTE)"
    output changed false
    exit 0
  fi
fi

echo "== cachebust.py"
python3 scripts/cachebust.py

python3 - "$ROOT/sw.js" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
m = re.search(r"const VERSION = 'v(\d+)';", s)
if not m:
    sys.exit("sw.js : ligne const VERSION = 'vN'; introuvable")
n = int(m.group(1)) + 1
open(p, 'w', encoding='utf-8').write(s[:m.start()] + f"const VERSION = 'v{n}';" + s[m.end():])
print(f'sw.js : VERSION v{n - 1} -> v{n}')
PY

echo "Données mises à jour (v$REMOTE)"
output changed true
