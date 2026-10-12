/* ==========================================================================
   Datako — Routeur : bascule entre la vitrine et la plateforme
   - Adresses « #/app/... »  → plateforme (ex. #/app/pilotage)
   - Toute autre adresse      → vitrine (ex. #methode pour une section)
   ========================================================================== */

(function () {
  var vitrine = document.getElementById('vue-vitrine');
  var plateforme = document.getElementById('vue-plateforme');
  var mode = null;

  hydraterIcones(document);
  Typo.appliquer(vitrine);
  Typo.appliquer(plateforme);

  function router() {
    var h = location.hash || '';
    if (h.indexOf('#/app') === 0) {
      if (mode !== 'plateforme') {
        mode = 'plateforme';
        Vitrine.masquer();
        vitrine.hidden = true;
        plateforme.hidden = false;
        document.body.classList.add('mode-plateforme');
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
      document.title = 'Datako — L’IA, enfin simple';
    }
    Vitrine.afficher();

    var id = h.replace(/^#\/?/, '');
    var cible = id ? document.getElementById(id) : null;
    if (cible) {
      requestAnimationFrame(function () { cible.scrollIntoView({ block: 'start' }); });
    } else if (venaitDeLaPlateforme || h === '#/') {
      window.scrollTo(0, 0);
    }
  }

  // Lien d'évitement : vise le contenu de la vue affichée sans changer d'adresse
  document.querySelector('[data-evitement]').addEventListener('click', function (e) {
    e.preventDefault();
    var cible = document.getElementById(mode === 'plateforme' ? 'pf-contenu' : 'contenu');
    cible.focus();
    cible.scrollIntoView({ block: 'start' });
  });

  window.addEventListener('hashchange', router);
  router();
})();
