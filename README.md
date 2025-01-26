# Augustinus Bader – The Cream (Scraper - 30 ml / 50 ml)

Ce projet **scrape 15 sites** deux fois par jour (08h & 20h) pour voir si 
**Augustinus Bader – The Cream** (30 ml ou 50 ml) est vendu **avec au moins 20% de réduction** 
par rapport aux prix de référence (170 € / 265 €).

## Comment ça marche ?

1. Le fichier `scraper.py` envoie des requêtes HTTP aux 15 sites.
2. Chaque page est analysée (via `BeautifulSoup`) pour trouver le prix. 
3. Si le prix correspond à 30 ml ou 50 ml et qu'il est 20% moins cher ou plus, 
   l'offre est notée.
4. Tous les résultats sont compilés dans `index.html`.
5. Ce fichier est automatiquement publié sur **GitHub Pages** (branche `gh-pages`).

## Structure du dépôt

- **scraper.py** : Code Python effectuant le scraping et générant `index.html`.
- **requirements.txt** : Liste des dépendances (requests, beautifulsoup4).
- **.github/workflows/scraper.yml** : Script GitHub Actions programmant l'exécution 
  biquotidienne et le déploiement sur GitHub Pages.
- **README.md** : Document d'explication (vous lisez ce fichier).

## Mise en place

1. **Créer** un **nouveau dépôt** public sur GitHub (ex: `augustinus-bader-scraper`).
2. **Ajouter** ces fichiers (via "Add file" > "Create new file" ou en poussant via Git) :
   - `scraper.py`
   - `requirements.txt`
   - `README.md`
   - `.github/workflows/scraper.yml`
3. Allez dans l’onglet **Actions** de votre dépôt GitHub :
   - Activez les workflows si GitHub vous le propose.
4. Une fois la première exécution réussie, une branche **`gh-pages`** sera créée.
5. Allez dans **Settings > Pages** et sélectionnez la branche `gh-pages` 
   comme source de GitHub Pages.
6. **Consultez** l’URL fournie, du type `https://votre-utilisateur.github.io/augustinus-bader-scraper/`.
7. Vous verrez un beau **index.html** listant (ou pas) les offres trouvées.

## Fréquence d’exécution

- Par défaut, le **scraper** tourne **2 fois par jour** (08h00, 20h00, heure UTC).
- Pour personnaliser, éditez les lignes `cron: "0 8 * * *"` et `cron: "0 20 * * *"` 
  dans `.github/workflows/scraper.yml`.

## Limitations

- Si la structure HTML d'un site change, le scraping peut cesser de fonctionner.
- Nous n’avons pas vérifié que chaque site expédie en France ni la fiabilité du marchand. 
  Veillez à vérifier manuellement si besoin.
- Aucune garantie que le prix soit bien celui affiché au moment de passer commande.

Bon usage !
