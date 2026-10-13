# Datako — Maquette de l’interface client

Maquette cliquable de l’interface utilisée par les salariés d’une PME cliente de Datako. Le principe : les agents préparent le travail répétitif, et chacun le valide en quelques clics. La journée type de la démonstration va de 9 h 00 à 17 h 30.

Toutes les entreprises, personnes et données sont **fictives** (PME de démonstration : *Bastide Équipements*). Aucune IA n’est réellement branchée : les réponses sont scénarisées.

---

## 1. Ouvrir la maquette

| Besoin | Comment faire |
|---|---|
| **Montrer la démo ou l’envoyer par e-mail** | Ouvrir `livrable/datako-maquette.html` d’un double-clic. Ce fichier unique contient tout et fonctionne sans connexion. |
| **Travailler sur le projet** | Ouvrir `index.html` d’un double-clic, depuis le dossier du projet. |

> ⚠️ Ce dépôt GitHub est **public** : tout ce qui y est poussé est visible de tous. Passez-le en privé (*Settings → General → Change visibility*) avant d’y ajouter des éléments confidentiels.

---

## 2. Les trois espaces de l’interface

| Espace | Ce qu’on y fait |
|---|---|
| **Aujourd’hui** | Les tâches préparées par les agents. Pour chacune : *Valider*, *Corriger* (on donne une consigne à l’agent), *Voir le détail* ou *Plus tard*. En bas, le planning du jour. |
| **Équipe** | Les agents et leurs horaires de la semaine. La direction peut mettre un agent en pause. La conseillère Datako y propose de nouveaux agents. |
| **Bilan** | Réservé à la direction : activité des agents, forfait du mois (sans dépassement possible), mise en pause des agents, accès par e-mail et par rôle. |

En plus de ces trois espaces :

- **La fiche d’agent** est le même écran pour tous les agents : *ce qu’il utilise → ce qu’il fait → ce qu’il produit*.
- **Le bouton « Demander »** permet de poser une question sur les documents, de demander un devis ou de lancer un agent.

---

## 3. Démonstration conseillée (2 minutes)

1. **Chantal, responsable administrative (60 s)**
   - Sur la carte des factures, cliquez sur *Corriger*, choisissez la suggestion puis *Envoyer la consigne*.
   - Cliquez sur *Valider* et validez la pile jusqu’au bout.
2. **Fiche d’agent (20 s)** : cliquez sur un agent dans la liste de gauche.
3. **Demander (15 s)** : cliquez sur *Demander* puis tapez « Quelle est la garantie du four FM-10 ? ». La réponse cite ses sources.
4. **Marc, dirigeant (30 s)** : avatar en haut à droite, puis *Marc Bastide*. Ouvrez *Bilan*.

Pour rejouer la démonstration, rechargez la page (touche F5).

Adresses directes : `#aujourdhui`, `#equipe`, `#bilan`, `#agent-factures` (aussi `emails`, `relances`, `synthese`, `devis`, `documents`).

---

## 4. Modifier le contenu

| Je veux changer… | Fichier à ouvrir |
|---|---|
| L’entreprise, les personnes, les agents, leurs horaires, les tâches du jour, le bilan | `assets/js/donnees.js` (seul fichier de données, commenté) |
| Les couleurs | `assets/css/base.css`, en tête de fichier |

Après une modification, régénérer le fichier unique :

```bash
node outils/assembler.js
```

## 5. Organisation des fichiers

```
index.html                 Page unique de l’interface client
assets/css/polices.css     Polices intégrées (Inter, Gelasio) — fichier généré
assets/css/base.css        Charte : couleurs, typographies, boutons, tampon, aperçus
assets/css/plateforme.css  Mise en page des écrans
assets/js/donnees.js       Données fictives de la démonstration
assets/js/cartes.js        Rendu commun des résultats d’agents (liste, e-mail, tableau, document)
assets/js/plateforme.js    Écrans et interactions
assets/js/routeur.js       Adresses (#aujourdhui, #equipe, #bilan, #agent-…)
assets/js/commun.js        Fenêtres, notifications, typographie française
assets/js/icones.js        Jeu d’icônes
outils/assembler.js        Fabrique le fichier unique livrable/datako-maquette.html
```

La vitrine commerciale et le Studio Datako des versions précédentes ne font plus partie de cette maquette. Ils restent récupérables dans l’historique Git (commit `ffb5901`).

## 6. Contrôles effectués

- **Parcours automatique** : 50 vérifications réussies, sans erreur dans la console.
- **Affichage** : mobile (390 px), tablette (820 px) et ordinateur (1 440 px), sans débordement.
- **Accessibilité** : audit axe (WCAG 2.1 A et AA) sur 13 écrans et états, sans anomalie.
- **Polices** : Inter et Gelasio, sous licence SIL Open Font License (`assets/css/polices-licences.txt`).
