/* ==========================================================================
   Datako — Cadre « dans Claude »
   Dessine la conversation dans laquelle apparaît la carte Datako, et le
   bandeau de la vue plein écran. Le contenu de la carte vient des mêmes
   données que l'interface (DONNEES) : c'est ce que renverrait le
   connecteur Datako à Claude.
   ========================================================================== */

var Cadre = (function () {
  var D = DONNEES;
  var vueClaude = document.getElementById('vue-claude');
  var vuePlateforme = document.getElementById('vue-plateforme');
  var bandeau = document.getElementById('pf-cadre');

  function personaActuelle() { return Plateforme.persona ? Plateforme.persona() : D.personas.chantal; }

  function carteDatako() {
    var p = personaActuelle();
    var taches = D.travaux.filter(function (t) { return t.persona === p.id; }).length;
    var agents = D.agents.filter(function (a) { return p.direction || a.roles.indexOf(p.role) >= 0; });
    return '<div class="carte-dk" role="group" aria-label="Datako">' +
      '<div class="carte-dk-tete"><span class="logo" role="img" aria-label="Datako"></span><span>' + esc(D.entreprise.nom) + '</span>' +
        '<a class="carte-dk-agrandir" href="#aujourdhui">' + icone('agrandir', 'ic--16') + 'Plein écran</a></div>' +
      '<div class="carte-dk-corps">' +
        '<p class="carte-dk-titre">Bonjour ' + esc(p.prenom) + '. <em>' + (taches ? taches + ' tâches à valider.' : 'Tout est validé.') + '</em></p>' +
        '<div class="carte-dk-cta"><a href="#aujourdhui" class="btn btn--valider">' + icone('check') + 'Voir les tâches</a><span>Préparées ce matin par vos agents.</span></div>' +
        '<div class="carte-dk-grille">' + agents.map(function (a) {
          return '<a class="carte-dk-agent" href="#agent-' + a.id + '">' + Cartes.pastille(a, 'petite') + '<strong>' + esc(a.nom) + '</strong><small>' + esc(a.rythme.libelle) + '</small></a>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="carte-dk-pied">' + icone('bouclier', 'ic--14') + 'Les actions dans vos logiciels attendent toujours votre accord.</div>' +
    '</div>';
  }

  function rendre() {
    var p = personaActuelle();
    vueClaude.innerHTML =
      '<aside class="cadre-lateral" aria-label="Panneau latéral">' +
        '<div class="cadre-marque"><i aria-hidden="true"></i>Claude</div>' +
        '<button type="button" class="cadre-nouveau">' + icone('plus', 'ic--16') + 'Nouvelle conversation</button>' +
        '<p class="cadre-section">Récents</p>' +
        '<ul class="cadre-liste"><li class="est-actif">Point du matin</li><li>Devis Hôtel des Alpes</li><li>Relances de la semaine</li><li>Garantie du four FM-10</li></ul>' +
        '<p class="cadre-section">Connecteurs</p>' +
        '<div class="cadre-connecteur"><span class="logo" role="img" aria-label="Datako"></span><span><i aria-hidden="true"></i>Connecté</span></div>' +
        '<div class="cadre-lateral-pied"><span class="avatar avatar--petit" aria-hidden="true">' + p.initiales + '</span><span>' + esc(p.prenom + ' ' + p.nom) + '<small>' + esc(D.entreprise.nom) + '</small></span></div>' +
      '</aside>' +
      '<section class="cadre-conv" aria-label="Conversation">' +
        '<div class="cadre-conv-tete"><span>Point du matin</span><span>' + D.date.jour + '</span></div>' +
        '<div class="cadre-fil">' +
          '<div class="cadre-msg cadre-msg--moi"><p>Ouvre Datako</p></div>' +
          '<div class="cadre-msg cadre-msg--ia"><i aria-hidden="true"></i><div>' +
            '<span class="cadre-outil">' + icone('prise') + 'Datako · <b>espace_du_jour</b></span>' +
            carteDatako() +
            '<p>Vous avez ' + D.travaux.filter(function (t) { return t.persona === p.id; }).length + ' tâches à valider. Dites-moi si vous voulez que je lance un agent ou que je pose une question à vos documents.</p>' +
          '</div></div>' +
        '</div>' +
        '<div class="cadre-saisie"><div>Écrire à Claude…' + icone('envoyer') + '</div><p>Démonstration : la conversation est illustrative. Cliquez sur la carte Datako.</p></div>' +
      '</section>';
    Typo.appliquer(vueClaude);
  }

  function afficher() {
    if (Plateforme.masquer) Plateforme.masquer();
    rendre();
    vuePlateforme.hidden = true;
    vueClaude.hidden = false;
    document.body.classList.remove('mode-pleinecran');
    document.title = 'Datako';
    window.scrollTo(0, 0);
  }

  function masquer() {
    vueClaude.hidden = true;
    vuePlateforme.hidden = false;
    document.body.classList.add('mode-pleinecran');
    bandeau.innerHTML = '<span><i aria-hidden="true"></i><span class="pf-cadre-texte">Claude · <b>Datako</b> en plein écran</span></span>' +
      '<a class="pf-cadre-reduire" href="#claude">' + icone('reduire') + 'Retour à la conversation</a>';
  }

  return { afficher: afficher, masquer: masquer };
})();
