/* Test local du connecteur : démarre le serveur, puis joue la séquence
   qu'un hôte MCP joue (initialize, tools/list, resources/read, tools/call). */
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 3456;
const URL = `http://127.0.0.1:${PORT}/mcp`;
const serveur = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((ok) => serveur.stdout.on('data', (d) => { if (String(d).includes('prêt')) ok(); }));

let id = 0, echecs = 0;
async function rpc(method, params = {}) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  });
  const texte = await r.text();
  const ligne = texte.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(ligne ? ligne.slice(5) : texte);
}
function verif(cond, libelle) { if (cond) console.log('  ✓', libelle); else { echecs++; console.log('  ✗', libelle); } }

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  verif(init.result?.serverInfo?.name === 'Datako', 'initialize : serveur « Datako »');

  const outils = await rpc('tools/list');
  const noms = outils.result.tools.map((t) => t.name);
  verif(['espace_du_jour', 'valider_tache', 'corriger_tache', 'lancer_agent'].every((n) => noms.includes(n)), 'tools/list : ' + noms.join(', '));
  const espace = outils.result.tools.find((t) => t.name === 'espace_du_jour');
  verif(espace._meta?.ui?.resourceUri === 'ui://datako/espace', 'espace_du_jour pointe vers l’interface ui://datako/espace');
  const valider = outils.result.tools.find((t) => t.name === 'valider_tache');
  verif(JSON.stringify(valider._meta?.ui?.visibility) === '["model","app"]', 'valider_tache appelable depuis l’interface');

  const res = await rpc('resources/read', { uri: 'ui://datako/espace' });
  const c = res.result.contents[0];
  verif(c.mimeType === 'text/html;profile=mcp-app', 'resources/read : type MIME MCP App');
  verif(c.text.includes('app.connect()') && c.text.includes('app-with-deps.js'), 'interface : client App chargé et connecté');
  verif(c._meta?.ui?.csp?.resourceDomains?.includes('https://unpkg.com'), 'interface : domaine du script déclaré (CSP)');

  const e1 = await rpc('tools/call', { name: 'espace_du_jour', arguments: {} });
  verif(e1.result.structuredContent.taches.filter((t) => t.statut === 'a-valider').length === 3, 'espace_du_jour : 3 tâches à valider');
  verif(e1.result.structuredContent.agents.length === 4, 'espace_du_jour : 4 agents pour Chantal');

  const v = await rpc('tools/call', { name: 'valider_tache', arguments: { tache: 't-factures', actions: ['a1', 'a2'] } });
  const tf = v.result.structuredContent.taches.find((t) => t.id === 't-factures');
  verif(tf.statut === 'valide' && tf.actions.find((a) => a.id === 'a3').statut === 'ecarte', 'valider_tache : validée, action a3 écartée');

  const k = await rpc('tools/call', { name: 'corriger_tache', arguments: { tache: 't-relances', consigne: 'Garde un ton courtois avec Traiteur Delorme' } });
  verif(k.result.structuredContent.taches.find((t) => t.id === 't-relances').consigne.includes('courtois'), 'corriger_tache : consigne enregistrée');

  const l = await rpc('tools/call', { name: 'lancer_agent', arguments: { agent: 'factures' } });
  verif(l.result.content[0].text.includes('lancé'), 'lancer_agent : agent lancé');

  const inconnu = await rpc('tools/call', { name: 'valider_tache', arguments: { tache: 'x' } });
  verif(inconnu.result?.isError === true, 'valider_tache : tâche inconnue refusée');

  const taille = JSON.stringify(e1).length;
  verif(taille < 150000, `résultat de espace_du_jour sous la limite de Claude (${taille} caractères)`);
} catch (e) {
  echecs++; console.error('Erreur :', e);
} finally {
  serveur.kill();
}
console.log(echecs ? `${echecs} échec(s)` : 'Tout est bon.');
process.exit(echecs ? 1 : 0);
