/* ==========================================================================
   Datako — Routeur
   Adresses : #claude (par défaut) : la conversation avec la carte Datako
              #aujourdhui, #equipe, #bilan : l'interface Datako en plein écran
              #agent-factures, #agent-devis… : la fiche d'un agent
   ========================================================================== */

(function () {
  hydraterIcones(document);

  function router() {
    // Les anciens liens « #/app/agent/factures » restent valables
    var chemin = (location.hash || '').replace(/^#\/?(app\/?)?/, '').replace(/^agent\//, 'agent-');
    if (!chemin || chemin === 'claude') { Cadre.afficher(); return; }
    Cadre.masquer();
    Plateforme.afficher(chemin);
  }

  // Lien d'évitement : place le clavier directement sur le contenu
  document.querySelector('[data-evitement]').addEventListener('click', function (e) {
    e.preventDefault();
    var cible = document.getElementById(document.body.classList.contains('mode-pleinecran') ? 'pf-contenu' : 'vue-claude');
    cible.focus();
    cible.scrollIntoView({ block: 'start' });
  });

  window.addEventListener('hashchange', router);
  router();
})();
