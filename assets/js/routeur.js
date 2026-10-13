/* ==========================================================================
   Datako — Routeur de l'interface client
   Adresses : #aujourdhui (par défaut), #equipe, #bilan,
              #agent-factures, #agent-devis… (fiche d'un agent)
   ========================================================================== */

(function () {
  hydraterIcones(document);

  function router() {
    // Les anciens liens « #/app/agent/factures » restent valables
    var chemin = (location.hash || '').replace(/^#\/?(app\/?)?/, '').replace(/^agent\//, 'agent-');
    Plateforme.afficher(chemin);
  }

  // Lien d'évitement : place le clavier directement sur le contenu
  document.querySelector('[data-evitement]').addEventListener('click', function (e) {
    e.preventDefault();
    var cible = document.getElementById('pf-contenu');
    cible.focus();
    cible.scrollIntoView({ block: 'start' });
  });

  window.addEventListener('hashchange', router);
  router();
})();
