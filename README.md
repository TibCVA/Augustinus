# Datako — Maquette de la plateforme

Maquette web cliquable de l’offre Datako pour les entreprises peu outillées en IA. Elle se compose de deux parties :

- **la vitrine de l’offre** : la promesse, la méthode en trois temps, les agents, le simulateur de gains, le contrôle des coûts, le modèle (sans prix) et les questions fréquentes ;
- **la plateforme client** : les écrans qu’utiliseraient les collaborateurs d’une PME fictive, *Bastide Équipements*.

Toutes les entreprises, personnes et données affichées sont **fictives**. Aucune IA n’est réellement branchée : les réponses sont scénarisées pour une démonstration fiable et sans coût.

---

## 1. Ouvrir la maquette

| Besoin | Comment faire |
|---|---|
| **Montrer la démo ou l’envoyer par e-mail** | Ouvrir `livrable/datako-maquette.html` d’un double-clic. Ce fichier unique contient tout et fonctionne sans connexion. |
| **Travailler sur le projet** | Ouvrir `index.html` d’un double-clic, depuis le dossier du projet. |
| **Mettre en ligne** | Glisser le dossier sur [app.netlify.com/drop](https://app.netlify.com/drop), ou le déployer sur Railway comme un site statique. |

> ⚠️ Ce dépôt GitHub est **public** : tout ce qui y est poussé est visible de tous. Passez-le en privé (*Settings → General → Change visibility*) avant d’y ajouter des éléments confidentiels.

---

## 2. Démonstration conseillée (3 minutes)

1. **Vitrine (30 s)** : l’accroche « L’intelligence artificielle, *enfin simple* », puis le simulateur de gains (par exemple 300 factures par mois à 5 minutes chacune, soit environ 20 heures libérées par mois). Cliquer sur **Voir la démo**.
2. **Accueil (20 s)** : de grosses tuiles, aucun jargon. Montrer « Premiers pas » et le temps gagné la semaine dernière.
3. **Factures fournisseurs (60 s)** :
   1. *Lancer l’analyse* : 12 factures lues et contrôlées.
   2. Ouvrir **Fournitures Rhône** (écart de prix) et appliquer le prix du bon de commande.
   3. Ouvrir **Groupe Froid Alpes** et écarter le doublon.
   4. *Envoyer vers Pennylane* : 54 minutes gagnées et 2 616 € de double paiement évité.
4. **Mes documents (30 s)** : cliquer sur une question suggérée. La réponse cite ses sources ; cliquer sur le renvoi ① pour les afficher. Poser ensuite une question hors sujet : Datako refuse d’inventer.
5. **Pilotage (40 s)**, côté dirigeant :
   - l’enveloppe mensuelle, la projection de fin de mois et le seuil d’alerte ;
   - la consommation par agent et par équipe ;
   - la recommandation de la conseillère ;
   - le bouton **Mettre tous les agents en pause**, qui fait apparaître un bandeau sur toute la plateforme.

Pour rejouer la démonstration, recharger la page (touche F5) : tout revient à l’état initial.

---

## 3. Modifier le contenu

| Je veux changer… | Fichier à ouvrir |
|---|---|
| Les textes de la vitrine | `index.html`, partie « VITRINE DE L’OFFRE » |
| L’entreprise fictive, les personnes, les agents, les factures, les e-mails, les chiffres de pilotage, les réponses aux questions | `assets/js/donnees.js` (seul fichier de données, commenté) |
| Les couleurs | `assets/css/base.css`, en tête de fichier |

Après une modification, régénérer le fichier unique à envoyer :

```bash
node outils/assembler.js
```

---

## 4. Organisation des fichiers

```
index.html               Page unique : vitrine + plateforme
assets/css/base.css      Charte Datako : couleurs, typographies, boutons, formulaires
assets/css/vitrine.css   Mise en page de la vitrine
assets/css/plateforme.css  Mise en page de la plateforme
assets/js/donnees.js     Données fictives de la démonstration
assets/js/plateforme.js  Écrans et interactions de la plateforme
assets/js/vitrine.js     Interactions de la vitrine (méthode, agents, simulateur)
assets/js/routeur.js     Bascule entre vitrine (#…) et plateforme (#/app/…)
assets/js/commun.js      Fenêtres, notifications, typographie française
assets/js/graphiques.js  Graphiques (sans bibliothèque externe)
assets/js/icones.js      Jeu d’icônes
outils/assembler.js      Fabrique le fichier unique livrable/datako-maquette.html
```

Chaque écran de la plateforme a sa propre adresse, ce qui permet d’ouvrir directement la bonne page pendant une démonstration :

- `#/app/accueil` : accueil
- `#/app/documents` : questions aux documents
- `#/app/agents` : catalogue des agents
- `#/app/agents/factures`, `#/app/agents/emails`, `#/app/agents/devis`, `#/app/agents/synthese` : les quatre agents
- `#/app/pilotage`, `#/app/impact`, `#/app/reglages` : espace dirigeant

---

## 5. Partis pris

- **Aucun prix** : le modèle est présenté (mise en route, abonnement tout compris, usage plafonnable), sans aucun montant.
- **Pas de jargon** côté utilisateur : on parle de « crédits » et d’« enveloppe », jamais de tokens, de modèles ou de connecteurs MCP.
- **Validation humaine** visible sur chaque action sensible : envoi d’e-mail, export comptable, geste commercial.
- **Charte reprise de datakoanalytics.com** : bleu nuit, turquoise, titres « en deux temps » avec une partie en italique.

## 6. Contrôles effectués

- 47 vérifications automatiques des parcours (vitrine, quatre agents, documents, catalogue, pilotage, mise en pause, réglages), sur `index.html`, sur le fichier unique et via un serveur web : toutes réussies, sans aucune erreur.
- Affichage contrôlé sur mobile (390 px), tablette (820 px) et ordinateur (1 440 px), sans débordement horizontal.
- Audit d’accessibilité automatique (axe, critères WCAG 2 A et AA) sur les 13 écrans : aucune anomalie.
