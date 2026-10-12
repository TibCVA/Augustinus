/* ==========================================================================
   Datako — Jeu d'icônes (traits 24 × 24, style linéaire)
   Utilisation dans le HTML : <i data-icone="accueil"></i>
   Utilisation en JavaScript : icone("accueil", "ic--18")
   ========================================================================== */

var ICONES = {
  accueil: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  facture: '<path d="M5 2.5v19l2.5-1.5 2.5 1.5 2-1.5 2 1.5 2.5-1.5 2.5 1.5v-19L16.5 4 14 2.5 12 4l-2-1.5L7.5 4z"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  devis: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  synthese: '<path d="M4 4h12v16H6a2 2 0 0 1-2-2z"/><path d="M16 8h3a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2h-2"/><path d="M7.5 8h5M7.5 12h5M7.5 16h3"/>',
  documents: '<path d="M8 3h8l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M16 3v4h4"/><path d="M3 7.5V19a3 3 0 0 0 3 3h9"/>',
  conversation: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>',
  grille: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  jauge: '<path d="M4.5 18.5a9 9 0 1 1 15 0"/><path d="m12 13 4-4.5"/><circle cx="12" cy="13" r="1.3"/>',
  tendance: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  reglages: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  utilisateurs: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-3.5-5.8"/>',
  prise: '<path d="M9 2v5M15 2v5"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  debranche: '<path d="m3 3 18 18"/><path d="M9 2v4M15 2v4"/><path d="M18 7v3a6 6 0 0 1-1.4 3.9M14.2 15.5A6 6 0 0 1 6 10V7h3"/><path d="M12 16v6"/>',
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  retour: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  chevronBas: '<path d="m6 9 6 6 6-6"/>',
  chevronDroite: '<path d="m9 6 6 6-6 6"/>',
  chevronGauche: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="M5 12.5 10 17.5 19.5 7"/>',
  checkCercle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  alerte: '<path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  lecture: '<path d="M7 4.5v15l12-7.5z"/>',
  televerser: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  telecharger: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  etincelle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bouclier: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  cadenas: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  oeil: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  source: '<path d="M9 15 15 9"/><path d="M11 6.5 12.5 5a4.2 4.2 0 0 1 6 6L17 12.5M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5"/>',
  validation: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 11-4.7"/><path d="m15.5 18 2 2 4-4.5"/>',
  croix: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cloche: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  envoyer: '<path d="M21 3 10 14"/><path d="M21 3 14.5 21l-4.5-7-7-4.5z"/>',
  calendrier: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  casseTete: '<path d="M10 3.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-2.5a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-2.5a2 2 0 0 0-4 0V20H6a1 1 0 0 1-1-1v-4h2.5a2 2 0 0 0 0-4H5V7a1 1 0 0 1 1-1h4z"/>',
  cible: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  formation: '<path d="M2 9.5 12 5l10 4.5-10 4.5z"/><path d="M6 11.5V16c2 1.8 4 2.5 6 2.5s4-.7 6-2.5v-4.5"/><path d="M22 9.5V14"/>',
  teams: '<path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3.5V15H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M19.5 9h.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v2.5L16 19h-4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sortir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  regenerer: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
  ecarter: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  crayon: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  dossier: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  base: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  panier: '<path d="M3 4h2.5l2.2 11h10.6l2-8H6.6"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  balance: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  rh: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M14.5 9.5h4M14.5 13h4"/>',
  mallette: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12.5h18"/>',
  casque: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="14" width="4" height="6" rx="1.5"/><rect x="17.5" y="14" width="4" height="6" rx="1.5"/><path d="M19.5 20a3 3 0 0 1-3 2.5H13"/>',
  barres: '<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7" rx="1"/><rect x="10.5" y="5" width="3" height="13" rx="1"/><rect x="16" y="8" width="3" height="10" rx="1"/>',
  eclair: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  sablier: '<path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 10 0V3M7 21v-3a5 5 0 0 1 10 0v3"/>',
  boussole: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  lien: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chargement: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  copier: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  recu: '<path d="M6 2.5h12v19l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/>',
  soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  pile: '<rect x="4" y="9" width="16" height="11" rx="2.5"/><path d="M6.5 6h11M9 3h6"/>',
  equipe: '<circle cx="12" cy="7.5" r="3"/><circle cx="5" cy="10" r="2.2"/><circle cx="19" cy="10" r="2.2"/><path d="M6.5 20a5.5 5.5 0 0 1 11 0"/><path d="M1.5 18.5a3.5 3.5 0 0 1 4.5-3.3M22.5 18.5a3.5 3.5 0 0 0-4.5-3.3"/>',
  bilan: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  atelier: '<path d="m14.5 4 5.5 5.5-9.5 9.5H5v-5.5z"/><path d="m12 6.5 5.5 5.5"/><path d="M3 21h18"/>',
  archive: '<rect x="3.5" y="3" width="17" height="18" rx="2"/><path d="M10 3v2h2v2h-2v2h2v2h-2v2"/><rect x="9" y="14" width="4" height="4" rx="1"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
  tampon: '<path d="M9 3h6l-1 7h3a2 2 0 0 1 2 2v2H5v-2a2 2 0 0 1 2-2h3z"/><path d="M5 17h14M7 21h10"/>',
  plusTard: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',
  publier: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>'
};

function icone(nom, classe) {
  var trace = ICONES[nom] || ICONES.info;
  return '<svg class="ic ' + (classe || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + trace + '</svg>';
}

/* Remplace chaque <i data-icone="..."> par le dessin correspondant */
function hydraterIcones(racine) {
  (racine || document).querySelectorAll('i[data-icone]').forEach(function (el) {
    var tmp = document.createElement('span');
    tmp.innerHTML = icone(el.getAttribute('data-icone'), el.className);
    el.replaceWith(tmp.firstChild);
  });
}
