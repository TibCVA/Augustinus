# Datako — Maquette « L’IA travaille, vous validez »

Maquette web cliquable de l’offre Datako pour les PME. Elle illustre le principe retenu : **le client n’utilise pas l’IA, il valide son travail.** Chaque nuit, des agents préparent le travail répétitif ; le matin, chacun le valide en quelques clics, dans une plateforme 100 % Datako.

Sous le capot, chaque **agent** Datako est une **skill créée dans Claude**, accompagnée d’une fiche de six champs. La plateforme affiche tous les agents avec le **même écran** : *ce qu’on lui confie → ce qu’il fait → ce qu’il rend*. Aucun écran n’est développé sur mesure par agent.

Toutes les entreprises, personnes et données sont **fictives**. Aucune IA n’est réellement branchée : les réponses sont scénarisées pour une démonstration fiable.

---

## 1. Ouvrir la maquette

| Besoin | Comment faire |
|---|---|
| **Montrer la démo ou l’envoyer par e-mail** | Ouvrir `livrable/datako-maquette.html` d’un double-clic. Ce fichier unique contient tout, polices comprises, et fonctionne sans connexion. |
| **Travailler sur le projet** | Ouvrir `index.html` d’un double-clic, depuis le dossier du projet. |
| **Mettre en ligne** | Glisser le dossier sur [app.netlify.com/drop](https://app.netlify.com/drop), ou le déployer comme un site statique. |

> ⚠️ Ce dépôt GitHub est **public** : tout ce qui y est poussé est visible de tous. Passez-le en privé (*Settings → General → Change visibility*) avant d’y ajouter des éléments confidentiels.

---

## 2. Démonstration conseillée (3 minutes)

1. **Vitrine (40 s)**
   - L’accroche « L’IA travaille. *Vous validez.* » : validez directement les trois cartes à droite, le compteur affiche le temps rendu.
   - Faites défiler « Une journée avec Datako » : le ciel suit les heures, de l’aube au soir.
   - Dans « Le calcul en une phrase », modifiez les mots soulignés.
2. **Aujourd’hui, en tant que Chantal (60 s)** : cliquez sur *Essayer la démo*.
   - Sur la carte des factures, cliquez sur *Corriger*, choisissez la suggestion puis *Renvoyer à l’agent* : la carte est mise à jour.
   - Cliquez sur *Valider* : le tampon s’appose, la carte suivante arrive.
   - Validez la pile jusqu’au bout : « Rien d’autre pour ce matin ».
3. **La fiche d’agent (30 s)** : cliquez sur un agent dans la liste de gauche. C’est le **même écran pour tous les agents**, ce qui permet de brancher n’importe quelle skill.
4. **Demander (15 s)** : appuyez sur la touche `/` et tapez « Quelle est la garantie du four FM-10 ? ». La réponse cite ses sources.
5. **Marc, le dirigeant (30 s)** : cliquez sur l’avatar en haut à droite, puis choisissez Marc. Ouvrez *Bilan* :
   - 196 heures rendues, un point par heure ;
   - l’enveloppe d’usage plafonnée et le bouton pause ;
   - les accès par e-mail et par rôle.
6. **Le Studio, côté Datako (30 s)** : ouvrez le menu de l’avatar puis *Studio Datako*.
   - Cliquez sur *Utiliser l’exemple*, puis sur *Publier l’agent*.
   - Cliquez sur *Voir chez Bastide Équipements* : le nouvel agent apparaît dans l’équipe, avec l’étiquette « Nouveau ».

Pour rejouer la démonstration, rechargez la page (touche F5) : tout revient à l’état initial.

---

## 3. Modifier le contenu

| Je veux changer… | Fichier à ouvrir |
|---|---|
| Les textes de la vitrine | `index.html`, partie « VITRINE » |
| L’entreprise, les personnes, les agents, les travaux du matin, le bilan, le Studio, la journée type | `assets/js/donnees.js` (seul fichier de données, commenté) |
| Les couleurs | `assets/css/base.css`, en tête de fichier |

Après une modification, régénérer le fichier unique à envoyer :

```bash
node outils/assembler.js
```

---

## 4. Organisation des fichiers

```
index.html                 Page unique : vitrine + plateforme
assets/css/polices.css     Polices intégrées (Inter, Gelasio) — fichier généré
assets/css/base.css        Charte : couleurs, typographies, boutons, tampon, aperçus
assets/css/vitrine.css     Vitrine
assets/css/plateforme.css  Plateforme client (Aujourd’hui, Équipe, Bilan, fiche d’agent)
assets/css/studio.css      Studio Datako (fond sombre)
assets/js/donnees.js       Données fictives de la démonstration
assets/js/cartes.js        Rendu commun des résultats d’agents (liste, e-mail, tableau, document)
assets/js/vitrine.js       Pile de la vitrine, journée type, calcul
assets/js/plateforme.js    Écrans et interactions de la plateforme
assets/js/studio.js        Studio : déposer une skill, remplir la fiche, publier
assets/js/routeur.js       Bascule entre vitrine (#…) et plateforme (#/app/…)
assets/js/commun.js        Fenêtres, notifications, typographie française
assets/js/icones.js        Jeu d’icônes
outils/assembler.js        Fabrique le fichier unique livrable/datako-maquette.html
```

Adresses utiles pendant une démonstration :

- `#/app/aujourdhui` : la pile de travaux à valider
- `#/app/equipe` : l’équipe et son rythme de la semaine
- `#/app/bilan` : le bilan (réservé à la direction)
- `#/app/agent/factures` : une fiche d’agent (aussi `emails`, `relances`, `synthese`, `devis`, `documents`)
- `#/app/studio` : le Studio Datako

---

## 5. Partis pris

- **Pas de page blanche** : l’écran principal n’est pas une conversation mais une pile de travaux prêts, que l’on valide, corrige ou reporte.
- **Une structure non classique** :
  - pas de menu latéral ni de tableau de bord à tuiles ;
  - un dock flottant à trois entrées ;
  - une équipe présentée comme une partition de la semaine ;
  - un bilan qui se lit comme une page de journal.
- **Un seul écran d’agent**, alimenté par la fiche de la skill : c’est ce qui rend la création d’un agent aussi simple que la création d’une skill dans Claude.
- **Rien ne part sans accord** : chaque action dans un logiciel du client attend un clic, à l’image des règles de validation du moteur d’agents d’Anthropic.
- **Chacun voit ce qui le concerne** : connexion par e-mail, agents visibles selon le rôle, bilan réservé à la direction.
- **Aucun prix** : seule l’enveloppe d’usage apparaît, en pourcentage.
- **Charte Datako** : bleu nuit, bleu ciel, turquoise, et titres « en deux temps » avec une partie en italique.

## 6. Contrôles effectués

- **Parcours automatique** : 69 vérifications sur la vitrine, la pile, la correction, la fiche d’agent, la palette, l’équipe, le bilan, la pause, l’invitation, le devis et le Studio. Toutes réussissent, sans erreur dans la console.
- **Affichage** : contrôlé sur mobile (390 px), tablette (820 px) et ordinateur (1 440 px), sans débordement horizontal.
- **Accessibilité** : audit automatique (axe, critères WCAG 2.1 A et AA) sur 18 écrans et états, sans aucune anomalie. Le clavier fonctionne partout (touche `/`, Échap, Tab).
- **Polices** : Inter et Gelasio, sous licence SIL Open Font License. Leurs licences sont dans `assets/css/polices-licences.txt`.
