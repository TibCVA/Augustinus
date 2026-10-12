/* ==========================================================================
   Datako — Routeur : bascule entre la vitrine et la plateforme
   - Adresses « #/app/... »  → plateforme (ex. #/app/equipe, #/app/studio)
   - Toute autre adresse      → vitrine (ex. #journee pour une section)
   - Liens courts à partager  → #demo, #equipe, #bilan, #studio
   ========================================================================== */

(function () {
  var vitrine = document.getElementById('vue-vitrine');
  var plateforme = document.getElementById('vue-plateforme');
  var mode = null;
  var RACCOURCIS = { demo: 'aujourdhui', aujourdhui: 'aujourdhui', equipe: 'equipe', bilan: 'bilan', studio: 'studio' };

  hydraterIcones(document);
  Typo.appliquer(vitrine);

  function router() {
    var h = location.hash || '';
    // Liens courts (#demo, #studio…) : faciles à partager, ils ouvrent la plateforme
    var court = h.replace(/^#/, '');
    if (RACCOURCIS[court] && !document.getElementById(court)) { location.replace('#/app/' + RACCOURCIS[court]); return; }
    if (h.indexOf('#/app') === 0) {
      if (mode !== 'plateforme') {
        mode = 'plateforme';
        Vitrine.masquer();
        vitrine.hidden = true;
        plateforme.hidden = false;
        document.body.classList.add('mode-plateforme');
        window.scrollTo(0, 0);
      }
      Plateforme.afficher(h.replace(/^#\/app\/?/, ''));
      return;
    }

    var venaitDeLaPlateforme = mode === 'plateforme';
    if (mode !== 'vitrine') {
      mode = 'vitrine';
      Plateforme.masquer();
      plateforme.hidden = true;
      vitrine.hidden = false;
      document.body.classList.remove('mode-plateforme');
    }
    document.title = 'Datako';
    Vitrine.afficher();

    var id = h.replace(/^#\/?/, '');
    var cible = id ? document.getElementById(id) : null;
    if (cible) requestAnimationFrame(function () { cible.scrollIntoView({ behavior: venaitDeLaPlateforme ? 'auto' : 'smooth', block: 'start' }); });
    else if (venaitDeLaPlateforme || h === '#/') window.scrollTo(0, 0);
  }

  // Lien d'évitement : vise le contenu de la vue affichée
  document.querySelector('[data-evitement]').addEventListener('click', function (e) {
    e.preventDefault();
    var cible = document.getElementById(mode === 'plateforme' ? 'pf-contenu' : 'contenu');
    cible.focus();
    cible.scrollIntoView({ block: 'start' });
  });

  window.addEventListener('hashchange', router);
  router();
})();
