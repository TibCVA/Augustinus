# Connecteur Datako pour Claude — MVP

Un serveur MCP que le client ajoute à Claude comme **connecteur personnalisé**. Quand un utilisateur demande « Ouvre Datako », Claude appelle l’outil `espace_du_jour` et affiche l’**espace Datako dans la conversation** (carte, puis plein écran) : ses tâches à valider, préparées par les agents, et ses agents.

**But de ce MVP** : prouver, dans un vrai compte Claude Team, qu’un connecteur privé affiche son interface. Tout le reste (vraies données, authentification, agents réels) vient après.

## 1. Lancer en local (2 minutes)

```bash
cd connecteur
npm install
npm test        # joue la séquence d’un hôte MCP : 14 vérifications
npm start       # http://127.0.0.1:3000/mcp
```

## 2. Tester dans Claude (30 minutes)

Claude se connecte depuis les serveurs d’Anthropic : le serveur doit être joignable sur internet. Deux options.

**Option A, tunnel temporaire (pour un premier essai)**

```bash
npm start
npx cloudflared tunnel --url http://localhost:3000     # dans un second terminal
```

Copiez l’adresse `https://….trycloudflare.com` et ajoutez `/mcp` à la fin.

**Option B, hébergement (pour montrer à un client)**

Déployez le dossier `connecteur` sur Railway, Render ou Fly (commande de démarrage : `npm start`, Node 20 ou plus). Définissez la variable `URL_PUBLIQUE` avec l’adresse exacte du serveur, par exemple `https://datako-mvp.up.railway.app/mcp` : elle sert à calculer le domaine stable de l’interface attendu par Claude (`ui.domain`).

**Puis, dans Claude**

1. Sur le compte Team, un **Owner** ouvre *Organization settings → Connectors → Add → Custom*, colle l’adresse `…/mcp`, authentification « sans connexion » (le MVP n’a pas d’authentification).
2. Chaque membre active le connecteur Datako dans une conversation.
3. Tapez : **« Ouvre Datako »** ou « Qu’est-ce que j’ai à valider ? ». Claude appelle `espace_du_jour` et demande l’autorisation d’afficher l’interface (*Allow* / *Always allow*).
4. Dans la carte : cliquez *Valider* (l’outil `valider_tache` est appelé depuis l’interface), *Corriger*, *Plein écran*, et un agent (ce qui envoie une demande dans la conversation).

**Critères de réussite**

| Critère | Résultat attendu |
|---|---|
| La carte Datako s’affiche dans la conversation | Oui, sous l’appel d’outil `espace_du_jour` |
| *Plein écran* fonctionne | L’interface occupe l’écran, le champ de saisie reste visible |
| *Valider* met la tâche à jour sans passer par Claude | La carte se rafraîchit, pas de nouveau message |
| Cliquer un agent envoie une demande dans la conversation | Claude appelle `lancer_agent` |
| Le même résultat sur mobile | Carte pleine largeur, boutons de 44 px |

Si l’outil répond mais que rien ne s’affiche : [Troubleshoot MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) (causes fréquentes : `app.connect()` absent, hauteur nulle, `ui.domain` calculé sur une URL différente de celle saisie dans Claude).

## 3. Ce que contient le MVP

```
server.mjs          Le serveur MCP : outils, interface, transport HTTP
app/datako.html     L’interface affichée dans Claude (HTML + JS, sans bundler)
donnees.mjs         Données de démonstration (Bastide Équipements, Chantal)
test/local.mjs      Test automatique de la séquence MCP
```

| Outil | Rôle | Qui l’appelle |
|---|---|---|
| `espace_du_jour` | Renvoie les tâches et les agents, affiche l’interface | Claude |
| `valider_tache` | Valide une tâche, actions cochées effectuées | L’interface (ou Claude) |
| `corriger_tache` | Transmet une consigne à l’agent | L’interface (ou Claude) |
| `lancer_agent` | Lance un agent maintenant (simulé) | Claude, sur demande de l’utilisateur |
| `reinitialiser_demo` | Remet la démo à zéro | Claude |

Règles respectées : transport Streamable HTTP sans session, résultat d’outil sous 150 000 caractères, scripts externes déclarés dans la CSP (`unpkg.com`), couleurs de structure prises dans les variables de style de Claude (clair et sombre), boutons de 44 px.

## 4. Après le MVP

1. **Authentification OAuth** : chaque membre se connecte à Datako avec son e-mail ; le serveur sait qui demande et filtre les tâches par rôle.
2. **Vraies données** : une base Datako alimentée par les agents (tâches planifiées de Cowork, qui déposent leur résultat via un outil `deposer_resultat`).
3. **Script embarqué** : servir le client `App` depuis le serveur plutôt que depuis `unpkg.com`.
4. **Plugin Datako** : regrouper le connecteur et les compétences des agents dans un plugin distribué par l’owner du client (marketplace privée Team).

Références : [Build an MCP server for Claude](https://claude.com/docs/connectors/building) · [Get started with MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started) · [Design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines) · [Authentication](https://claude.com/docs/connectors/building/authentication).
