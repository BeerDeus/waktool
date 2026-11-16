# Waktool

Site statique d'aide aux métiers de récolte Wakfu : ressources par niveau, zones, outils, familiers, consommables.

- `index.html`, `assets/`, `data/metiers.js`, `img/` : le site (aucun build requis).
- `scripts/` : régénération des données.

## Mettre à jour les données

```bash
CACHE=/tmp/waktool-cache; mkdir -p $CACHE/gd $CACHE/dl
V=$(curl -s https://wakfu.cdn.ankama.com/gamedata/config.json | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])"); echo $V > $CACHE/gd/version.txt
for f in items jobsItems recipes recipeResults recipeIngredients collectibleResources resources itemTypes; do curl -s -o $CACHE/gd/$f.json https://wakfu.cdn.ankama.com/gamedata/$V/$f.json; done
curl -s https://methodwakfu.com/artisanat/localisation-des-ressources/ -o $CACHE/dl/loc.html
python3 -c "import sys;s=open(sys.argv[1]).read();open(sys.argv[2],'w').write(s[s.find('id=\"1-forestier\"')-200:s.find('Vous pourriez aussi aimer')])" $CACHE/dl/loc.html $CACHE/dl/content.html
python3 scripts/parse_methodwakfu.py $CACHE/dl/content.html $CACHE/dl/loc.json
for p in Miner Farmer Lumberjack Herbalist Fisherman Trapper; do curl -s "https://wakfu.wiki.gg/api.php?action=parse&page=$p&prop=text&format=json" | python3 -c "import json,sys;print(json.load(sys.stdin)['parse']['text']['*'])" > $CACHE/dl/wikih_$p.html; done
python3 scripts/build_data.py $CACHE
```

Sources : [MethodWakfu](https://methodwakfu.com/artisanat/localisation-des-ressources/), gamedata Ankama, [Wakfu Wiki](https://wakfu.wiki.gg). Images © Ankama.

## Import des niveaux par capture

Fenêtre Métiers en jeu (`J`) → capture → `Ctrl+V` sur le site (ou glisser-déposer / bouton « Importer une capture »).
OCR 100 % local avec Tesseract.js (`vendor/tesseract/`, modèle `fra` compact) : 3 passes avec seuils différents + vote majoritaire ;
les valeurs non unanimes sont signalées « ? » avant enregistrement.

## Cache

Le CDN Hostinger met en cache les assets : avant de committer une modif de `assets/` ou `data/`, lancer
`python3 scripts/cachebust.py` (ajoute `?v=<hash>` dans `index.html`).
