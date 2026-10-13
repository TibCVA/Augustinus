/* ==========================================================================
   Datako — Connecteur Claude (MVP)
   --------------------------------------------------------------------------
   Un serveur MCP (Model Context Protocol) que le client ajoute à Claude comme
   « connecteur personnalisé ». Il expose :
   - espace_du_jour : renvoie les tâches à valider et affiche l'espace Datako
     dans la conversation (MCP App : carte, puis plein écran) ;
   - valider_tache, corriger_tache : les décisions prises depuis l'interface ;
   - lancer_agent : à l'usage de Claude, quand l'utilisateur demande un agent.

   Objectif de ce MVP : vérifier qu'un connecteur privé affiche son interface
   dans un compte Claude Team. Pas d'authentification (à ajouter ensuite).
   ========================================================================== */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { ENTREPRISE, UTILISATEUR, AGENTS, tachesInitiales } from './donnees.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const HOTE = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
// URL publique exacte saisie dans Claude (ex. https://datako-mvp.example.com/mcp).
// Facultative : elle sert à calculer le domaine stable de l'interface (ui.domain).
const URL_PUBLIQUE = process.env.URL_PUBLIQUE ?? '';

const UI = 'ui://datako/espace';
// Domaine stable de l'interface attendu par Claude : 32 premiers caractères du SHA-256 de l'URL publique
const DOMAINE = URL_PUBLIQUE ? createHash('sha256').update(URL_PUBLIQUE).digest('hex').slice(0, 32) + '.claudemcpcontent.com' : '';
const HTML = await fs.readFile(path.join(import.meta.dirname, 'app', 'datako.html'), 'utf-8');

/* ---------- État de démonstration (en mémoire, partagé) ---------- */
let taches = tachesInitiales();
const journal = [];

function heure() {
  return new Date().toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
}

function etat() {
  const agents = AGENTS.filter((a) => a.roles.includes(UTILISATEUR.role));
  return {
    entreprise: ENTREPRISE.nom,
    utilisateur: UTILISATEUR.prenom,
    taches: taches.map((t) => ({ ...t, agentNom: AGENTS.find((a) => a.id === t.agent)?.nom })),
    agents: agents.map(({ id, nom, rythme }) => ({ id, nom, rythme })),
    journal: journal.slice(-10)
  };
}

function resume(e) {
  const n = e.taches.filter((t) => t.statut === 'a-valider').length;
  const lignes = e.taches.map((t) => `- ${t.titre} (${t.agentNom}, ${t.heure}) : ${t.statut === 'valide' ? 'validée' : 'à valider'}`);
  return `Espace Datako de ${e.utilisateur} (${e.entreprise}) : ${n} tâche(s) à valider.\n${lignes.join('\n')}\n` +
    'L’interface Datako est affichée à l’utilisateur ; il valide ou corrige depuis celle-ci. Ne répète pas le détail des tâches.';
}

function resultat(texte) {
  const e = etat();
  return { content: [{ type: 'text', text: texte ?? resume(e) }], structuredContent: e };
}

/* ---------- Le serveur MCP ---------- */
function construireServeur() {
  const server = new McpServer({ name: 'Datako', version: '0.1.0' });

  registerAppTool(server, 'espace_du_jour', {
    title: 'Espace Datako',
    description: 'Affiche l’espace Datako de l’utilisateur : les tâches préparées par ses agents, à valider, et ses agents. À appeler quand l’utilisateur demande Datako, ses tâches, ou ce qu’il a à valider.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: UI } }
  }, async () => resultat());

  registerAppTool(server, 'valider_tache', {
    title: 'Valider une tâche',
    description: 'Valide une tâche préparée par un agent Datako. Les actions cochées sont effectuées dans les logiciels de l’entreprise, les autres sont écartées.',
    inputSchema: {
      tache: z.string().describe('Identifiant de la tâche, ex. t-factures'),
      actions: z.array(z.string()).optional().describe('Identifiants des actions à effectuer ; par défaut toutes')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: UI, visibility: ['model', 'app'] } }
  }, async ({ tache, actions }) => {
    const t = taches.find((x) => x.id === tache);
    if (!t) return { content: [{ type: 'text', text: `Tâche inconnue : ${tache}` }], isError: true };
    const retenues = actions ?? t.actions.map((a) => a.id);
    t.statut = 'valide';
    t.heureValidation = heure();
    t.actions.forEach((a) => { a.statut = retenues.includes(a.id) ? 'fait' : 'ecarte'; });
    journal.push({ quand: t.heureValidation, texte: `${t.titre} validée (${retenues.length} action(s))` });
    return resultat(`Tâche « ${t.titre} » validée à ${t.heureValidation}. Actions effectuées : ${retenues.length}.`);
  });

  registerAppTool(server, 'corriger_tache', {
    title: 'Corriger une tâche',
    description: 'Transmet une consigne de correction à l’agent Datako qui a préparé la tâche ; il la retravaille et retient la consigne pour les prochaines fois.',
    inputSchema: {
      tache: z.string().describe('Identifiant de la tâche'),
      consigne: z.string().min(2).describe('Ce qu’il faut changer, en langage courant')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: UI, visibility: ['model', 'app'] } }
  }, async ({ tache, consigne }) => {
    const t = taches.find((x) => x.id === tache);
    if (!t) return { content: [{ type: 'text', text: `Tâche inconnue : ${tache}` }], isError: true };
    t.consigne = consigne;
    t.resume = `${t.resume} Correction demandée : « ${consigne} ».`;
    journal.push({ quand: heure(), texte: `Consigne envoyée pour « ${t.titre} »` });
    return resultat(`Consigne transmise à l’agent pour « ${t.titre} » : « ${consigne} ».`);
  });

  server.registerTool('lancer_agent', {
    title: 'Lancer un agent Datako',
    description: 'Lance un agent Datako maintenant (contrôle des factures, réponses aux e-mails, relances, questions sur les documents). Dans ce MVP, l’agent est simulé : le serveur enregistre la demande.',
    inputSchema: { agent: z.enum(AGENTS.map((a) => a.id)).describe('Identifiant de l’agent') },
    annotations: { readOnlyHint: false, openWorldHint: false }
  }, async ({ agent }) => {
    const a = AGENTS.find((x) => x.id === agent);
    journal.push({ quand: heure(), texte: `${a.nom} lancé à la demande` });
    return { content: [{ type: 'text', text: `Agent « ${a.nom} » lancé à ${heure()}. Mission : ${a.mission} Son résultat apparaîtra dans l’espace Datako (appeler espace_du_jour pour l’afficher).` }] };
  });

  server.registerTool('reinitialiser_demo', {
    title: 'Réinitialiser la démonstration',
    description: 'Remet les tâches de démonstration à leur état initial.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async () => { taches = tachesInitiales(); journal.length = 0; return resultat('Démonstration réinitialisée.'); });

  const meta = { csp: { resourceDomains: ['https://unpkg.com'] }, prefersBorder: true };
  if (DOMAINE) meta.domain = DOMAINE;

  registerAppResource(server, 'Espace Datako', UI, { description: 'Interface Datako : tâches à valider et agents' }, async () => ({
    contents: [{ uri: UI, mimeType: RESOURCE_MIME_TYPE, text: HTML, _meta: { ui: meta } }]
  }));

  return server;
}

/* ---------- Transport HTTP (Streamable HTTP, sans session) ---------- */
const app = createMcpExpressApp({ host: HOTE });
app.get('/', (_req, res) => res.json({ service: 'datako-connecteur', version: '0.1.0', mcp: '/mcp' }));
app.post('/mcp', async (req, res) => {
  const server = construireServeur();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
const refuse = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get('/mcp', refuse);
app.delete('/mcp', refuse);

app.listen(PORT, HOTE, (err) => {
  if (err) { console.error(`Impossible d’écouter sur ${PORT} : ${err.message}`); process.exit(1); }
  console.log(`Connecteur Datako prêt : http://${HOTE}:${PORT}/mcp` + (DOMAINE ? ` · domaine de l’interface : ${DOMAINE}` : ''));
});
