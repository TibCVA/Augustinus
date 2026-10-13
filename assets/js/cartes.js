/* ==========================================================================
   Datako — Rendu des résultats d'agents (commun à la vitrine et à la plateforme)
   Un agent rend toujours la même chose : un résumé, un aperçu, des fichiers
   et des actions qui attendent un accord. Seul l'aperçu change de forme :
   liste de contrôles, e-mail, tableau ou document.
   ========================================================================== */

var Cartes = (function () {

  function agent(id) {
    for (var i = 0; i < DONNEES.agents.length; i++) if (DONNEES.agents[i].id === id) return DONNEES.agents[i];
    return null;
  }

  function pastille(a, taille) {
    return '<span class="pastille teinte-' + (a.teinte || 'teal') + (taille ? ' pastille--' + taille : '') + '">' + icone(a.icone) + '</span>';
  }

  function apercu(ap, opts) {
    opts = opts || {};
    if (!ap) return '';
    if (ap.type === 'liste') {
      return '<ul class="ap-liste">' + ap.lignes.map(function (l) {
        return '<li class="ap-liste-ligne ap-liste-ligne--' + l.statut + '">' +
          '<span class="ap-statut" aria-hidden="true">' + (l.statut === 'ok' ? icone('check') : '!') + '</span>' +
          '<span class="sr-only">' + (l.statut === 'ok' ? 'Conforme : ' : 'À vérifier : ') + '</span>' +
          '<span class="ap-liste-texte"><strong>' + esc(l.texte) + '</strong>' + (l.detail ? '<span>' + esc(l.detail) + '</span>' : '') + '</span>' +
        '</li>';
      }).join('') + '</ul>';
    }
    if (ap.type === 'email') {
      return '<div class="ap-email">' +
        '<dl class="ap-email-tete"><div><dt>À</dt><dd>' + esc(ap.a) + '</dd></div><div><dt>Objet</dt><dd>' + esc(ap.objet) + '</dd></div></dl>' +
        '<div class="ap-email-corps">' + esc(ap.corps).replace(/\n/g, '<br>') + '</div>' +
        (ap.source ? '<p class="ap-source">' + icone('source', 'ic--14') + 'Source&nbsp;: ' + esc(ap.source) + '</p>' : '') +
        (ap.autres && !opts.compact ? '<p class="ap-email-autres"><strong>Et ' + ap.autres.length + ' autres&nbsp;:</strong> ' + ap.autres.map(esc).join(' · ') + '</p>' : '') +
      '</div>';
    }
    if (ap.type === 'tableau') {
      return '<div class="ap-tableau-cadre"><table class="ap-tableau"><thead><tr>' +
        ap.colonnes.map(function (c, i) { return '<th scope="col"' + (i === 1 || i === 2 ? ' class="ap-num"' : '') + '>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        ap.lignes.map(function (l) {
          return '<tr>' + l.map(function (v, i) {
            if (i === 3) return '<td><span class="puce ' + (/Ferme/.test(v) ? 'puce--sable' : 'puce--bleu') + '">' + esc(v) + '</span></td>';
            return i === 0 ? '<th scope="row">' + esc(v) + '</th>' : '<td class="ap-num">' + esc(v) + '</td>';
          }).join('') + '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }
    if (ap.type === 'document') {
      return '<div class="ap-document">' +
        '<p class="ap-document-tete">' + icone('documents', 'ic--16') + esc(ap.entete) + '</p>' +
        '<table class="ap-document-lignes"><tbody>' + ap.lignes.map(function (l) {
          var total = /^Total/.test(l[0]);
          return '<tr' + (total ? ' class="ap-total"' : '') + '><th scope="row">' + esc(l[0]) + '</th>' +
            '<td class="ap-num">' + esc(l[1]) + '</td><td class="ap-num ap-note">' + esc(l[2]) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '';
  }

  function fichiers(liste) {
    if (!liste || !liste.length) return '';
    return '<div class="ap-fichiers">' + liste.map(function (f) {
      return '<a href="#" class="fichier" data-fichier="' + esc(f.nom) + '">' +
        '<span class="fichier-type fichier-type--' + f.type + '" aria-hidden="true">' + f.type + '</span>' +
        '<span>' + esc(f.nom) + ' <span class="fichier-taille">· ' + esc(f.taille) + '</span></span></a>';
    }).join('') + '</div>';
  }

  // Les fichiers de la démo ne se téléchargent pas : on le dit simplement
  document.addEventListener('click', function (e) {
    var f = e.target.closest('[data-fichier]');
    if (!f) return;
    e.preventDefault();
    notifier('Démonstration : le fichier « ' + f.getAttribute('data-fichier') + ' » n’est pas disponible.', 'telecharger');
  });

  return { agent: agent, pastille: pastille, apercu: apercu, fichiers: fichiers };
})();
