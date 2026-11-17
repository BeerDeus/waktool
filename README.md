# Waktool

Site statique d'aide aux métiers de récolte Wakfu : ressources par niveau, zones, outils, familiers, consommables.

- `index.html`, `assets/`, `data/metiers.js`, `img/` : le site (aucun build requis).
- `scripts/` : régénération des données.

## Mise à jour automatique

Le workflow GitHub Actions `.github/workflows/update-data.yml` tourne chaque jour (04:17 UTC) :
il lance `scripts/update_data.sh`, qui compare la version du gamedata Ankama
(`https://wakfu.cdn.ankama.com/gamedata/config.json`) à celle de `data/metiers.js`.
Si elle a changé, tout est régénéré (gamedata, MethodWakfu, wiki → `data/`, `img/`), vérifié,
cache-busté (`index.html`) et `VERSION` de `sw.js` est incrémentée ; le workflow commit alors
directement sur `main` (« Données Wakfu vX (mise à jour automatique) ») et Hostinger redéploie.
Si une étape échoue, rien n'est poussé (le run apparaît en rouge dans l'onglet Actions).

Forcer une régénération : onglet **Actions** → « Mise à jour des données Wakfu » → **Run workflow**,
cocher `force` (régénère même sans nouvelle version ; ne commit que si `data/` ou `img/` changent).

## Mettre à jour les données (manuellement)

```bash
scripts/update_data.sh          # ne fait rien si la version Ankama n'a pas changé
scripts/update_data.sh --force  # régénère tout
python3 scripts/cachebust.py    # (déjà fait par update_data.sh quand les données changent)
```

Détail des étapes effectuées par le script (pour référence) :

```bash
CACHE=/tmp/waktool-cache; mkdir -p $CACHE/gd $CACHE/dl
V=$(curl -s https://wakfu.cdn.ankama.com/gamedata/config.json | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])"); echo $V > $CACHE/gd/version.txt
for f in items jobsItems recipes recipeResults recipeIngredients recipeCategories collectibleResources harvestLoots resources resourceTypes itemTypes; do curl -s -o $CACHE/gd/$f.json https://wakfu.cdn.ankama.com/gamedata/$V/$f.json; done
curl -s https://methodwakfu.com/artisanat/localisation-des-ressources/ -o $CACHE/dl/loc.html
python3 -c "import sys;s=open(sys.argv[1]).read();open(sys.argv[2],'w').write(s[s.find('id=\"1-forestier\"')-200:s.find('Vous pourriez aussi aimer')])" $CACHE/dl/loc.html $CACHE/dl/content.html
python3 scripts/parse_methodwakfu.py $CACHE/dl/content.html $CACHE/dl/loc.json
for p in Miner Farmer Lumberjack Herbalist Fisherman Trapper; do curl -s "https://wakfu.wiki.gg/api.php?action=parse&page=$p&prop=text&format=json" | python3 -c "import json,sys;print(json.load(sys.stdin)['parse']['text']['*'])" > $CACHE/dl/wikih_$p.html; done
python3 scripts/build_data.py $CACHE
python3 scripts/build_recipes.py $CACHE
```

Sources : [MethodWakfu](https://methodwakfu.com/artisanat/localisation-des-ressources/), gamedata Ankama, [Wakfu Wiki](https://wakfu.wiki.gg). Images © Ankama.

## Import des niveaux par capture

Fenêtre Métiers en jeu (`J`) → capture → `Ctrl+V` sur le site (ou glisser-déposer / bouton « Importer une capture »).
OCR 100 % local avec Tesseract.js (`vendor/tesseract/`, modèle `fra` compact) : 3 passes avec seuils différents + vote majoritaire ;
les valeurs non unanimes sont signalées « ? » avant enregistrement.

## Cache

Le CDN Hostinger met en cache les assets : avant de committer une modif de `assets/` ou `data/`, lancer
`python3 scripts/cachebust.py` (ajoute `?v=<hash>` dans `index.html`).

## Tests et mise en ligne

- `npm install` puis `npm test` : tests Playwright (calculs d'XP relevés en jeu, lecture de vraies captures du jeu —
  fenêtre Métiers, bulles d'XP, Hôtel des ventes —, rendu des pages sur PC et mobile).
- Workflow **Tests et mise en ligne** : à chaque push sur `main` (et après chaque mise à jour automatique des données),
  les tests tournent ; s'ils passent, `main` est copié sur la branche **`live`**, que Hostinger déploie.
  Un code cassé reste donc sur `main` sans jamais atteindre le site.
- Code du site : modules ES dans `assets/js/` (`util`, `model`, `state`, `main`, `metiers`, `profit`, `zones`,
  `session`, `side`), sans étape de build. Après une modif de `assets/` ou `data/` : `python3 scripts/cachebust.py`.
