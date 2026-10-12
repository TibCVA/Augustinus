/* ==========================================================================
   Datako — Outils communs : sécurité du texte, typographie française,
   fenêtres modales accessibles, notifications.
   ========================================================================== */

/* Échappe un texte avant de l'insérer dans du HTML */
function esc(texte) {
  return String(texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Mise en forme légère : **gras**, paragraphes, listes « - », renvois [1] */
function miseEnForme(texte) {
  var blocs = esc(texte).split(/\n\n+/);
  return blocs.map(function (bloc) {
    var lignes = bloc.split('\n');
    if (lignes.every(function (l) { return /^- /.test(l); })) {
      return '<ul>' + lignes.map(function (l) { return '<li>' + enrichir(l.slice(2)) + '</li>'; }).join('') + '</ul>';
    }
    return '<p>' + lignes.map(enrichir).join('<br>') + '</p>';
  }).join('');
  function enrichir(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(\d)\]/g, '<sup class="renvoi" data-renvoi="$1">$1</sup>');
  }
}

/* Typographie française : espaces insécables avant ; : ! ? % € et entre milliers */
var Typo = (function () {
  var FINE = ' ', INSEC = ' ';
  function corriger(t) {
    return t
      .replace(/ ([;!?])/g, FINE + '$1')
      .replace(/ :/g, INSEC + ':')
      .replace(/« /g, '«' + INSEC).replace(/ »/g, INSEC + '»')
      .replace(/(\d) (?=\d{3}(?!\d))/g, '$1' + FINE)
      .replace(/(\d) %/g, '$1' + FINE + '%')
      .replace(/(\d) €/g, '$1' + INSEC + '€')
      .replace(/(\d) (h|min|j|s)\b/g, '$1' + INSEC + '$2')
      .replace(/([A-Z0-9])-(?=\d)/g, '$1\u2011');  // références insécables : GFA-4410, CMD-4471
  }
  function appliquer(racine) {
    var marcheur = document.createTreeWalker(racine || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode && n.parentNode.nodeName;
        return (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = marcheur.nextNode())) {
      var corrige = corriger(n.nodeValue);
      if (corrige !== n.nodeValue) n.nodeValue = corrige;
    }
  }
  return { corriger: corriger, appliquer: appliquer };
})();

/* Fenêtre modale : piège du focus, Échap pour fermer, retour du focus */
var Modale = (function () {
  var actuelle = null, declencheur = null;

  function selectionnables(racine) {
    return Array.prototype.slice.call(racine.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(function (e) { return e.offsetParent !== null; });
  }

  function surClavier(e) {
    if (!actuelle) return;
    if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
    if (e.key === 'Tab') {
      var liste = selectionnables(actuelle);
      if (!liste.length) return;
      var premier = liste[0], dernier = liste[liste.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    }
  }

  function ouvrir(contenuHtml, opts) {
    opts = opts || {};
    if (actuelle) fermer(true);
    declencheur = document.activeElement;
    var fond = document.createElement('div');
    fond.className = 'modale-fond';
    fond.innerHTML =
      '<div class="modale' + (opts.large ? ' modale--large' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modale-titre">' +
      '<button class="modale-fermer" data-fermer-modale aria-label="Fermer">' + icone('croix') + '</button>' +
      contenuHtml + '</div>';
    document.body.appendChild(fond);
    document.body.style.overflow = 'hidden';
    actuelle = fond;
    Typo.appliquer(fond);
    fond.addEventListener('click', function (e) {
      if (e.target === fond || e.target.closest('[data-fermer-modale]')) fermer();
    });
    document.addEventListener('keydown', surClavier);
    var cible = fond.querySelector('[autofocus]') || selectionnables(fond)[1] || selectionnables(fond)[0];
    if (cible) setTimeout(function () { cible.focus(); }, 30);
    if (opts.apresOuverture) opts.apresOuverture(fond.querySelector('.modale'));
    return fond.querySelector('.modale');
  }

  function fermer(sansRetour) {
    if (!actuelle) return;
    actuelle.remove();
    actuelle = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', surClavier);
    if (!sansRetour && declencheur && document.contains(declencheur)) declencheur.focus();
  }

  return { ouvrir: ouvrir, fermer: fermer };
})();

/* Notification éphémère en bas d'écran */
function notifier(titre, texte, nomIcone) {
  var zone = document.getElementById('toasts');
  var t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = icone(nomIcone || 'checkCercle') + '<div><strong>' + esc(titre) + '</strong>' + (texte ? esc(texte) : '') + '</div>';
  Typo.appliquer(t);
  zone.appendChild(t);
  setTimeout(function () {
    t.classList.add('sortie');
    setTimeout(function () { t.remove(); }, 260);
  }, 4200);
}

/* Formulaire « Parler à un expert » (vitrine) */
function ouvrirContact() {
  var html =
    '<p class="surtitre">Parler à un expert</p>' +
    '<h2 id="modale-titre" style="margin-top:12px">Parlons de vos <em>besoins.</em></h2>' +
    '<p class="chapo" style="font-size:1rem">Un expert Datako vous recontacte sous un jour ouvré pour organiser un premier échange.</p>' +
    '<form class="formulaire-contact" novalidate>' +
      '<fieldset class="champ"><legend class="champ-libelle">Ce que vous souhaitez simplifier</legend>' +
        '<div class="choix-pastilles">' +
          ['Factures', 'E-mails clients', 'Devis', 'Reporting', 'Autre'].map(function (c, i) {
            return '<label class="choix-pastille"><input type="checkbox" name="besoin" value="' + c + '"' + (i === 0 ? ' checked' : '') + '><span>' + c + '</span></label>';
          }).join('') +
        '</div></fieldset>' +
      '<div class="formulaire-ligne">' +
        '<div class="champ"><label for="ct-nom">Nom <span class="requis">*</span></label><input class="saisie" id="ct-nom" name="nom" autocomplete="name" placeholder="Claire Martin" required></div>' +
        '<div class="champ"><label for="ct-societe">Entreprise</label><input class="saisie" id="ct-societe" name="societe" autocomplete="organization" placeholder="Facultatif"></div>' +
      '</div>' +
      '<div class="champ"><label for="ct-email">E-mail professionnel <span class="requis">*</span></label><input class="saisie" id="ct-email" name="email" type="email" autocomplete="email" placeholder="claire@entreprise.fr" required></div>' +
      '<div class="champ"><label for="ct-message">Votre contexte</label><textarea class="saisie" id="ct-message" name="message" placeholder="Les tâches qui prennent du temps à vos équipes, les outils que vous utilisez…"></textarea></div>' +
      '<p class="message-erreur" role="alert" hidden></p>' +
      '<div class="modale-actions"><button type="button" class="btn btn--contour" data-fermer-modale>Annuler</button><button type="submit" class="btn btn--primaire">Envoyer <span aria-hidden="true">' + icone('fleche', 'ic--fleche') + '</span></button></div>' +
      '<p class="modale-note">Démonstration : ce formulaire n’envoie aucune donnée.</p>' +
    '</form>';
  var modale = Modale.ouvrir(html, { large: false });
  var form = modale.querySelector('form');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var nom = form.querySelector('#ct-nom'), email = form.querySelector('#ct-email');
    var erreur = form.querySelector('.message-erreur');
    var ok = true;
    [nom, email].forEach(function (c) { c.classList.remove('est-invalide'); c.removeAttribute('aria-invalid'); });
    if (!nom.value.trim()) { nom.classList.add('est-invalide'); nom.setAttribute('aria-invalid', 'true'); ok = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.classList.add('est-invalide'); email.setAttribute('aria-invalid', 'true'); ok = false; }
    if (!ok) {
      erreur.textContent = 'Merci de renseigner votre nom et une adresse e-mail valide.';
      erreur.hidden = false;
      (nom.value.trim() ? email : nom).focus();
      return;
    }
    modale.innerHTML =
      '<button class="modale-fermer" data-fermer-modale aria-label="Fermer">' + icone('croix') + '</button>' +
      '<div class="confirmation">' +
        '<span class="confirmation-ic">' + icone('check', 'ic--28') + '</span>' +
        '<h2 id="modale-titre">Merci, <em>' + esc(nom.value.trim().split(' ')[0]) + '.</em></h2>' +
        '<p>Un expert Datako vous recontacte sous un jour ouvré, avec quelques questions sur vos outils et vos processus.</p>' +
        '<div class="modale-actions" style="justify-content:center"><a href="#/app/accueil" class="btn btn--sombre" data-fermer-modale>Découvrir la démo en attendant</a></div>' +
      '</div>';
    Typo.appliquer(modale);
    modale.querySelector('a').focus();
  });
}
