/* ==========================================================================
   Datako — Outils communs : sécurité du texte, mise en forme, typographie
   française, fenêtres modales accessibles, notifications.
   ========================================================================== */

/* Échappe un texte avant de l'insérer dans du HTML */
function esc(texte) {
  return String(texte == null ? '' : texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Mise en forme légère d'un texte d'agent : **gras**, paragraphes, listes « - », renvois [1] */
function miseEnForme(texte) {
  return esc(texte).split(/\n\n+/).map(function (bloc) {
    var lignes = bloc.split('\n');
    if (lignes.every(function (l) { return /^- /.test(l); })) {
      return '<ul>' + lignes.map(function (l) { return '<li>' + enrichir(l.slice(2)) + '</li>'; }).join('') + '</ul>';
    }
    return '<p>' + lignes.map(enrichir).join('<br>') + '</p>';
  }).join('');
  function enrichir(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(\d)\]/g, '<sup class="renvoi">$1</sup>');
  }
}

/* Formats : durées et nombres à la française */
var Format = {
  duree: function (minutes) {
    var h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    if (!h) return m + ' min';
    return h + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : '');
  },
  nombre: function (n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  },
  pluriel: function (n, singulier, pluriel) { return n + ' ' + (n > 1 ? (pluriel || singulier + 's') : singulier); }
};

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
      .replace(/(\d) (h|min|j|Ko)\b/g, '$1' + INSEC + '$2')
      .replace(/\b(h) (\d)/g, '$1' + INSEC + '$2')
      .replace(/([+−]) (\d)/g, '$1' + INSEC + '$2')
      .replace(/([A-Z0-9])-(?=\d)/g, '$1‑')
      .replace(/\b([eE])-mail/g, '$1‑mail');   // références insécables : GFA-4410, CMD-4471
  }
  function appliquer(racine) {
    var marcheur = document.createTreeWalker(racine || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode && n.parentNode.nodeName;
        return (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA' || p === 'CODE' || p === 'PRE') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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

/* Éléments focalisables visibles d'un conteneur */
function focalisables(racine) {
  return Array.prototype.slice.call(racine.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(function (e) { return e.offsetParent !== null || e === document.activeElement; });
}

/* Fenêtre modale : piège du focus, Échap pour fermer, retour du focus */
var Modale = (function () {
  var actuelle = null, declencheur = null, surFermeture = null;

  function surClavier(e) {
    if (!actuelle) return;
    if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
    if (e.key === 'Tab') {
      var liste = focalisables(actuelle);
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
    surFermeture = opts.surFermeture || null;
    var fond = document.createElement('div');
    fond.className = 'modale-fond';
    fond.innerHTML =
      '<div class="modale ' + (opts.classe || '') + '" role="dialog" aria-modal="true" aria-labelledby="modale-titre">' +
      (opts.sansFermer ? '' : '<button class="modale-fermer" data-fermer-modale aria-label="Fermer">' + icone('croix') + '</button>') +
      contenuHtml + '</div>';
    document.body.appendChild(fond);
    document.body.style.overflow = 'hidden';
    actuelle = fond;
    Typo.appliquer(fond);
    fond.addEventListener('mousedown', function (e) { if (e.target === fond) fermer(); });
    fond.addEventListener('click', function (e) { if (e.target.closest('[data-fermer-modale]')) fermer(); });
    document.addEventListener('keydown', surClavier);
    var modale = fond.querySelector('.modale');
    var cible = fond.querySelector('[autofocus]') || focalisables(modale).filter(function (e) { return !e.hasAttribute('data-fermer-modale'); })[0];
    if (cible) setTimeout(function () { cible.focus(); }, 30);
    if (opts.apresOuverture) opts.apresOuverture(modale);
    return modale;
  }

  function fermer(sansRetour) {
    if (!actuelle) return;
    actuelle.remove();
    actuelle = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', surClavier);
    var rappel = surFermeture; surFermeture = null;
    if (rappel) rappel();
    if (!sansRetour && declencheur && document.contains(declencheur)) declencheur.focus();
  }

  return { ouvrir: ouvrir, fermer: fermer, estOuverte: function () { return !!actuelle; } };
})();

/* Notification éphémère */
function notifier(texte, nomIcone) {
  var zone = document.getElementById('toasts');
  var t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = icone(nomIcone || 'check') + '<span>' + esc(texte) + '</span>';
  Typo.appliquer(t);
  zone.appendChild(t);
  setTimeout(function () {
    t.classList.add('sortie');
    setTimeout(function () { t.remove(); }, 260);
  }, 3600);
}
