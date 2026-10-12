/* ==========================================================================
   Datako — Assemble la maquette en UN SEUL fichier HTML autonome
   --------------------------------------------------------------------------
   Utilisation (depuis le dossier du projet) :
       node outils/assembler.js
   Résultat : livrable/datako-maquette.html
   Ce fichier unique contient tout (styles, scripts, images) : il s'ouvre
   d'un double-clic, s'envoie par e-mail et fonctionne sans connexion.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');
const enDataUri = f => 'data:image/png;base64,' + fs.readFileSync(path.join(racine, f)).toString('base64');

let html = lire('index.html');

// 1. Feuilles de style intégrées (les images référencées sont converties)
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, fichier) => {
  const dossier = path.dirname(fichier);
  const css = lire(fichier).replace(/url\((?!["']?data:)["']?([^"')]+)["']?\)/g, (m, image) =>
    'url("' + enDataUri(path.join(dossier, image)) + '")');
  return '<style>\n' + css + '\n</style>';
});

// 2. Scripts intégrés
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, fichier) =>
  '<script>\n' + lire(fichier).replace(/<\/script/gi, '<\\/script') + '\n</script>');

// 3. Icône de l'onglet
html = html.replace(/<link rel="icon" type="image\/png" href="([^"]+)">/, (_, fichier) =>
  '<link rel="icon" type="image/png" href="' + enDataUri(fichier) + '">');

const sortie = path.join(racine, 'livrable', 'datako-maquette.html');
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, html);
console.log('Maquette assemblée : ' + path.relative(racine, sortie) + ' (' + Math.round(fs.statSync(sortie).size / 1024) + ' Ko)');
