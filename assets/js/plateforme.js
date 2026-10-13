/* ==========================================================================
   Datako — Plateforme client
   --------------------------------------------------------------------------
   Trois espaces seulement, dans un dock en bas de l'écran :
   - Aujourd'hui : la pile des tâches préparées par les agents, à valider ;
   - Équipe      : les agents et leurs horaires de la semaine ;
   - Bilan       : le temps gagné, l'enveloppe d'usage, les accès (direction).
   Chaque agent s'ouvre sur la MÊME fiche : ce qu'il utilise → ce qu'il
   fait → ce qu'il produit. C'est ce qui permet de brancher n'importe quelle
   skill sans écrire d'écran sur mesure.
   ========================================================================== */

var Plateforme = (function () {
  var D = DONNEES;
  var racine = document.getElementById('vue-plateforme');
  var contenu = document.getElementById('pf-contenu');
  var barre = document.getElementById('pf-barre');
  var dock = document.getElementById('dock');
  var bandeau = document.getElementById('pf-pause');

  var MOTS = ['Aucun', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix'];
  var JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  var MOTS_CLES = {
    factures: 'facture fournisseur comptabilite pennylane controle achat',
    emails: 'email e-mail mail reponse client demande',
    relances: 'relance impaye retard paiement encaissement',
    synthese: 'synthese semaine reporting chiffre ventes',
    devis: 'devis chiffrage prix offre proposition',
    documents: 'question document contrat procedure garantie recherche'
  };

  var Etat = {
    actif: false,
    persona: 'chantal',
    vueRendue: null,
    fond: 'aujourdhui',
    ordre: { chantal: ['t-factures', 't-emails', 't-relances'], marc: ['t-synthese', 't-devis'] },
    travaux: {},
    clones: {},
    horloge: 9 * 60 + 5,
    correction: null,
    animCarte: 'arrive',
    focusApres: null,
    pause: false,
    agentsPause: {},
    interesse: {},
    acces: D.bilan.acces.slice(),
    lancements: {},
    lancerAuto: null,
    question: '',
    feuille: null
  };

  /* ======================================================================
     Outils
     ====================================================================== */

  function persona() { return D.personas[Etat.persona]; }
  function tousLesAgents() { return D.agents; }
  function agentParId(id) { return tousLesAgents().filter(function (a) { return a.id === id; })[0] || null; }
  function voitAgent(a, p) { p = p || persona(); return p.direction || a.roles.indexOf(p.role) >= 0; }
  function agentsVisibles() { return tousLesAgents().filter(function (a) { return voitAgent(a); }); }
  function enPause(a) { return Etat.pause || !!Etat.agentsPause[a.id]; }

  function heureTexte(minutes) { var h = Math.floor(minutes / 60), m = minutes % 60; return h + ' h ' + (m < 10 ? '0' : '') + m; }
  function heureDec(h) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh + ' h ' + (mm < 10 ? '0' : '') + mm; }
  function heureCourte(h) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh + ' h' + (mm ? ' ' + (mm < 10 ? '0' : '') + mm : ''); }
  function maintenant() { return Etat.horloge / 60; }
  function tic() { Etat.horloge += 1; return heureTexte(Etat.horloge); }
  function majuscule(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function normaliser(t) { return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /* ---------- Travaux et décisions ---------- */

  function travailBrut(id) { return Etat.clones[id] || D.travaux.filter(function (t) { return t.id === id; })[0]; }

  function etatTravail(id) {
    if (!Etat.travaux[id]) {
      var coches = {};
      travailBrut(id).actions.forEach(function (a) { coches[a.id] = true; });
      Etat.travaux[id] = { statut: 'a-valider', corrige: false, coches: coches, actions: {}, heures: {} };
    }
    return Etat.travaux[id];
  }

  // Le travail tel qu'il est affiché : avec la correction demandée, le cas échéant
  function vueTravail(id) {
    var t = travailBrut(id), et = etatTravail(id);
    if (!et.corrige || !t.correction) return t;
    var r = {}, k;
    for (k in t) r[k] = t[k];
    for (k in t.correction.apres) r[k] = t.correction.apres[k];
    return r;
  }

  function retirerDeLaPile(id) {
    Object.keys(Etat.ordre).forEach(function (p) {
      Etat.ordre[p] = Etat.ordre[p].filter(function (x) { return x !== id; });
    });
  }

  // Valide un travail entier : les actions cochées sont faites, les autres écartées
  function validerTravail(id, heure) {
    var t = vueTravail(id), et = etatTravail(id), faits = [];
    t.actions.forEach(function (a) {
      if (et.actions[a.id]) return;
      if (et.coches[a.id] !== false) { et.actions[a.id] = 'fait'; et.heures[a.id] = heure; faits.push(a.fait); }
      else et.actions[a.id] = 'refuse';
    });
    et.statut = 'valide';
    et.heure = heure;
    retirerDeLaPile(id);
    var message = !faits.length ? 'Tâche classée, aucune action effectuée.'
      : faits[0] + (faits.length > 1 ? ' (et ' + Format.pluriel(faits.length - 1, 'autre action', 'autres actions') + ')' : '');
    setTimeout(function () { notifier(message); }, 250);
  }

  // Décision action par action (depuis la fiche d'agent)
  function deciderAction(tid, acid, decision) {
    var t = vueTravail(tid), et = etatTravail(tid);
    var ac = t.actions.filter(function (a) { return a.id === acid; })[0];
    et.actions[acid] = decision;
    et.heures[acid] = tic();
    if (decision === 'fait') notifier(ac.fait);
    if (t.actions.every(function (a) { return et.actions[a.id]; })) {
      et.statut = 'valide';
      et.heure = et.heures[acid];
      retirerDeLaPile(tid);
    }
  }

  function prochainPassage() {
    var jour = D.date.jourSemaine, maint = maintenant(), mieux = null;
    agentsVisibles().forEach(function (a) {
      if (a.rythme.type !== 'horaire' || enPause(a)) return;
      a.rythme.passages.forEach(function (ps) {
        if (ps.jours.indexOf(jour) >= 0 && ps.heure > maint && (!mieux || ps.heure < mieux.h)) mieux = { h: ps.heure, agent: a };
      });
    });
    return mieux ? { texte: 'à ' + heureDec(mieux.h), agent: mieux.agent.nom } : { texte: 'demain à 9 h', agent: '' };
  }

  /* ======================================================================
     Barre, dock, bandeau de pause
     ====================================================================== */

  function barreClient() {
    var p = persona();
    var item = function (q) {
      return '<button type="button" class="pf-menu-item" role="menuitem" data-action="persona" data-persona="' + q.id + '"' + (q.id === p.id ? ' aria-current="true"' : '') + '>' +
        '<span class="avatar avatar--petit" aria-hidden="true">' + q.initiales + '</span>' +
        '<span class="pf-menu-item-texte">' + esc(q.prenom + ' ' + q.nom) + '<small>' + esc(q.fonction) + '</small></span></button>';
    };
    return '<a class="pf-marque" href="#aujourdhui" aria-label="Datako, Aujourd’hui">' +
        '<span class="logo logo--petit" role="img" aria-label="Datako"></span>' +
        '<span class="pf-entreprise"><span class="pf-monogramme" aria-hidden="true">' + D.entreprise.initiales + '</span><span class="pf-entreprise-nom">' + esc(D.entreprise.nom) + '</span></span>' +
      '</a>' +
      '<div class="pf-barre-droite">' +
        '<div class="pf-persona">' +
          '<button type="button" class="pf-persona-btn" id="pf-persona-btn" data-action="menu-persona" aria-haspopup="true" aria-expanded="false" aria-controls="pf-menu">' +
            '<span class="avatar avatar--petit" aria-hidden="true">' + p.initiales + '</span><span class="pf-persona-nom">' + esc(p.prenom + ' ' + p.nom) + '</span>' +
            '<span class="sr-only">, changer d’utilisateur</span>' + icone('chevronBas') + '</button>' +
          '<div class="pf-menu" id="pf-menu" role="menu" aria-label="Changer d’utilisateur" hidden>' +
            '<p class="pf-menu-titre">Voir la démo en tant que</p>' + item(D.personas.chantal) + item(D.personas.marc) +
            '<p class="pf-menu-note">Démonstration : entreprise, personnes et données fictives.</p>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function dockHtml(vue) {
    var p = persona(), n = Etat.ordre[p.id].length;
    function lien(id, ic, libelle, extra) {
      return '<a class="dock-lien" href="#' + id + '"' + (vue === id ? ' aria-current="page"' : '') + '>' + icone(ic) + '<span>' + libelle + '</span>' + (extra || '') + '</a>';
    }
    return lien('aujourdhui', 'soleil', 'Aujourd’hui', n ? '<span class="dock-compte">' + n + '<span class="sr-only"> à valider</span></span>' : '') +
      lien('equipe', 'equipe', 'Équipe') +
      (p.direction ? lien('bilan', 'bilan', 'Bilan') : '') +
      '<span class="dock-sep" aria-hidden="true"></span>' +
      '<button type="button" class="dock-demander" data-action="demander" aria-keyshortcuts="/">' + icone('plus') + '<span class="dock-demander-texte">Demander</span><kbd class="dock-raccourci" aria-hidden="true">/</kbd></button>';
  }

  function rendreChrome(vue) {
    barre.innerHTML = barreClient();
    dock.innerHTML = dockHtml(vue);
    bandeau.hidden = !Etat.pause;
    bandeau.innerHTML = bandeau.hidden ? '' : icone('pause') + '<span><strong>Les agents sont en pause.</strong> Aucune tâche n’est préparée ni envoyée.</span>' +
      '<button type="button" class="btn btn--sombre btn--petit" data-action="pause">Reprendre</button>';
    [barre, dock, bandeau].forEach(function (el) { Typo.appliquer(el); });
  }

  /* ======================================================================
     AUJOURD'HUI
     ====================================================================== */

  function vueAujourdhui() {
    var p = persona();
    var mes = D.travaux.filter(function (t) { return t.persona === p.id; });
    var reste = Etat.ordre[p.id];
    var total = 0, rendu = 0, faits = 0;
    mes.forEach(function (t) {
      total += t.minutes;
      if (etatTravail(t.id).statut === 'valide') { rendu += t.minutes; faits++; }
    });
    var n = reste.length;
    var accroche = n === 0 ? 'Tout est validé.' : n === 1 ? 'Une tâche à valider.' : MOTS[n] + ' tâches à valider.';
    var sous = n === 0
      ? 'Datako vous a fait gagner ' + Format.duree(rendu) + ' ce matin.'
      : 'Préparées par Datako : environ ' + Format.duree(total - rendu) + ' de travail, à valider en quelques minutes.';

    var gauche =
      '<aside class="auj-gauche">' +
        '<div>' +
          '<p class="auj-date">' + D.date.jour + ' · ' + heureTexte(Etat.horloge) + '</p>' +
          '<h1 class="titre auj-titre">Bonjour ' + esc(p.prenom) + '. <em>' + accroche + '</em></h1>' +
          '<p class="auj-sous">' + sous + '</p>' +
        '</div>' +
        '<div class="auj-progres">' +
          '<div class="auj-barre" aria-hidden="true">' + mes.map(function (t) { return '<span class="' + (etatTravail(t.id).statut === 'valide' ? 'est-fait' : '') + '"></span>'; }).join('') + '</div>' +
          '<p class="auj-progres-texte"><span><strong>' + faits + '</strong> sur ' + mes.length + (faits > 1 ? ' validées' : ' validée') + '</span><span>Temps gagné : <strong>' + Format.duree(rendu) + '</strong></span></p>' +
        '</div>' +
        '<nav aria-label="Tâches du jour"><ul class="auj-sommaire">' + mes.map(function (t) {
          var et = etatTravail(t.id), a = agentParId(t.agent), dessus = reste[0] === t.id;
          return '<li><button type="button" data-action="' + (et.statut === 'valide' ? 'ouvrir-agent' : 'mettre-dessus') + '" data-travail="' + t.id + '" data-agent="' + a.id + '"' + (dessus ? ' aria-current="true"' : '') + '>' +
            Cartes.pastille(a, 'petite') + '<span class="auj-sommaire-nom">' + esc(a.nom) + '</span>' +
            (et.statut === 'valide' ? '<span class="puce puce--teal">' + icone('check') + 'Validée</span>' : '<span class="puce puce--bleu">À valider</span>') +
          '</button></li>';
        }).join('') + '</ul></nav>' +
      '</aside>';

    var droite = n
      ? '<div class="pile-pf" data-reste="' + Math.min(2, n - 1) + '">' + carteTravail(reste[0], mes.length - n + 1, mes.length) + '</div>'
      : blocFini(rendu);

    return '<div class="auj">' + gauche + '<section class="auj-droite" aria-label="Tâches à valider">' + droite + '</section></div>' + filJournee();
  }

  function carteTravail(id, rang, nb) {
    var t = vueTravail(id), et = etatTravail(id), a = agentParId(t.agent);
    var quand = (t.demandePar ? 'Demandé par ' + t.demandePar + ' ' : 'Préparé ') + (t.jour ? t.jour + ' ' : '') + 'à ' + t.heure + ' · ' + Format.duree(t.minutes) + ' de travail';
    var actions = t.actions.map(function (ac) {
      return '<li><label class="case"><input type="checkbox" data-coche="' + ac.id + '"' + (et.coches[ac.id] !== false ? ' checked' : '') + '>' +
        '<span>' + esc(ac.libelle) + '<span class="logiciel">' + esc(ac.logiciel) + '</span></span></label></li>';
    }).join('');
    var bas = Etat.correction === id
      ? '<div class="ct-correction-cadre"><div class="ct-correction">' +
          '<label for="ct-consigne">Que faut-il changer ?</label>' +
          '<textarea id="ct-consigne" class="saisie" placeholder="Écrivez votre consigne"></textarea>' +
          '<p class="message-erreur" role="alert" hidden></p>' +
          (!et.corrige && t.correction ? '<div class="ct-suggestions"><span class="sr-only">Suggestion :</span><button type="button" class="ct-suggestion" data-action="suggestion">' + esc(t.correction.consigne) + '</button></div>' : '') +
          '<div class="ct-correction-boutons">' +
            '<button type="button" class="btn btn--sombre" data-action="renvoyer">' + icone('regenerer') + 'Envoyer la consigne</button>' +
            '<button type="button" class="btn btn--fantome" data-action="annuler-correction">Annuler</button>' +
          '</div>' +
        '</div></div>'
      : '<div class="ct-boutons">' +
          '<button type="button" class="btn btn--valider btn--grand" data-action="valider">' + icone('check') + 'Valider</button>' +
          '<button type="button" class="btn btn--contour btn--grand" data-action="corriger">' + icone('crayon') + 'Corriger</button>' +
          '<div class="ct-boutons-fin">' +
            '<button type="button" class="btn btn--fantome" data-action="detail">Voir le détail</button>' +
            (nb - rang > 0 ? '<button type="button" class="btn btn--fantome" data-action="plus-tard">Plus tard</button>' : '') +
          '</div>' +
        '</div>';

    return '<article class="ct' + (Etat.animCarte ? ' s-' + Etat.animCarte : '') + '" data-travail="' + id + '" aria-labelledby="ct-titre">' +
      '<header class="ct-tete">' + Cartes.pastille(a) +
        '<div class="ct-tete-texte"><span class="ct-agent">' + esc(a.nom) + '</span><span class="ct-quand">' + esc(quand) + '</span></div>' +
        '<span class="ct-rang">' + rang + ' sur ' + nb + '</span>' +
      '</header>' +
      '<h2 class="ct-titre" id="ct-titre">' + esc(t.titre) + ' <em>' + esc(t.accent) + '</em></h2>' +
      '<p class="ct-resume">' + esc(t.resume) + '</p>' +
      (et.corrige ? '<span class="puce puce--bleu ct-corrige">' + icone('crayon') + 'Corrigé : « ' + esc(et.consigne) + ' »</span>' : '') +
      '<div class="ct-apercu">' + Cartes.apercu(t.apercu) + '</div>' +
      Cartes.fichiers(t.fichiers) +
      '<div class="ct-accord"><p class="ct-accord-titre">' + icone('validation') + 'Actions à valider</p><ul>' + actions + '</ul></div>' +
      bas +
    '</article>';
  }

  function blocFini(rendu) {
    var pro = prochainPassage();
    var nbActions = 0;
    D.travaux.forEach(function (t) {
      if (t.persona !== Etat.persona) return;
      var et = etatTravail(t.id);
      Object.keys(et.actions).forEach(function (k) { if (et.actions[k] === 'fait') nbActions++; });
    });
    return '<div class="auj-fini" id="auj-fini" tabindex="-1">' +
      '<div class="tampon" aria-hidden="true">Validé<strong>' + heureTexte(Etat.horloge) + '</strong></div>' +
      '<h2 class="titre">Plus rien <em>à valider.</em></h2>' +
      '<p>' + Format.pluriel(nbActions, 'action effectuée', 'actions effectuées') + ' dans vos logiciels, toutes avec votre accord. Temps gagné : ' + Format.duree(rendu) + '.</p>' +
      '<p class="auj-fini-prochain">' + icone('horloge') + 'Prochain passage ' + pro.texte + (pro.agent ? ' · ' + esc(pro.agent) : '') + '</p>' +
      '<div class="auj-fini-actions">' +
        '<button type="button" class="btn btn--valider" data-action="recap">Voir les actions effectuées</button>' +
        '<button type="button" class="btn btn--verre" data-action="demander">Faire une demande</button>' +
      '</div>' +
    '</div>';
  }

  function filJournee() {
    var jour = D.date.jourSemaine, maint = maintenant(), passages = [];
    agentsVisibles().forEach(function (a) {
      if (a.rythme.type !== 'horaire' || enPause(a)) return;
      a.rythme.passages.forEach(function (ps) { if (ps.jours.indexOf(jour) >= 0) passages.push({ h: ps.heure, agent: a }); });
    });
    passages.sort(function (x, y) { return x.h - y.h; });
    var groupes = [];
    passages.forEach(function (ps) {
      var g = groupes[groupes.length - 1];
      if (g && ps.h - g.fin <= 0.75) { g.items.push(ps); g.fin = ps.h; }
      else groupes.push({ debut: ps.h, fin: ps.h, items: [ps] });
    });
    var DEB = D.date.debutJournee, FIN = D.date.finJournee;
    function pos(h) { return ((h - DEB) / (FIN - DEB) * 100).toFixed(2); }
    var heures = '';
    for (var h = DEB; h <= FIN; h += 1) heures += '<span style="left:' + pos(h) + '%">' + h + ' h</span>';
    if (FIN % 1) heures += '<span style="left:100%">' + heureCourte(FIN) + '</span>';

    var liste = groupes.map(function (g) {
      var fait = g.fin < maint, gauche = +pos(g.debut);
      return '<li class="fil-groupe' + (gauche > 66 ? ' fil-groupe--droite' : '') + '" style="left:' + gauche + '%">' +
        '<div class="fil-points" aria-hidden="true">' + g.items.map(function () { return '<span class="fil-point' + (fait ? ' est-fait' : '') + '">' + (fait ? icone('check') : '') + '</span>'; }).join('') + '</div>' +
        '<div class="fil-texte"><strong>' + (g.debut === g.fin ? heureDec(g.debut) : heureDec(g.debut) + ' – ' + heureDec(g.fin)) +
          '<span class="sr-only">' + (fait ? ' (terminé)' : ' (à venir)') + '</span></strong>' +
          g.items.map(function (it) { return '<span>' + esc(it.agent.nom) + '</span>'; }).join('') + '</div>' +
      '</li>';
    }).join('');

    return '<section class="fil" aria-labelledby="fil-titre">' +
      '<div class="fil-tete"><h2 class="pf-section-titre" id="fil-titre">Planning <em>du jour</em></h2>' +
        '<div class="fil-legende"><span aria-hidden="true"><i class="plein"></i>Fait</span><span aria-hidden="true"><i></i>À venir</span><span>Il est ' + heureTexte(Etat.horloge) + '</span></div></div>' +
      '<div class="fil-piste">' +
        '<div class="fil-heures" aria-hidden="true">' + heures + '</div>' +
        '<div class="fil-ligne" aria-hidden="true"></div><div class="fil-ligne-faite" style="width:' + pos(maint) + '%" aria-hidden="true"></div>' +
        (groupes.length ? '<ul class="fil-groupes">' + liste + '</ul>' : '<p class="fe-vide">Aucun passage prévu aujourd’hui.</p>') +
      '</div>' +
    '</section>';
  }

  /* ======================================================================
     ÉQUIPE
     ====================================================================== */

  function vueEquipe() {
    var p = persona(), visibles = agentsVisibles(), total = tousLesAgents().length;
    var titre = p.direction
      ? 'Les agents <em>de ' + esc(D.entreprise.nom) + '</em>'
      : 'Vos agents <em>et leurs horaires</em>';
    var sous = p.direction
      ? 'Vous voyez les ' + total + ' agents et pouvez mettre chacun en pause à tout moment.'
      : 'Vous voyez les ' + visibles.length + ' agents de votre service. La direction voit tous les agents.';
    var jour = D.date.jourSemaine, maint = maintenant();

    var lignes = visibles.map(function (a) {
      var pause = enPause(a), cellules;
      if (a.rythme.type === 'horaire') {
        cellules = JOURS.map(function (_, i) {
          var d = i + 1;
          var notes = [];
          a.rythme.passages.forEach(function (ps) {
            if (ps.jours.indexOf(d) < 0) return;
            var fait = d === jour && ps.heure < maint;
            notes.push('<span class="pt-note' + (fait ? ' est-fait' : '') + '">' + (fait ? icone('check') : '') + heureCourte(ps.heure) + '</span>');
          });
          return '<td class="' + (d === jour ? 'est-aujourdhui' : '') + '">' + (notes.length ? '<span class="pt-notes">' + notes.join('') + '</span>' : '<span class="sr-only">Aucun passage</span>') + '</td>';
        }).join('');
      } else {
        cellules = '<td colspan="5" class="pt-demande"><span>' + esc(a.rythme.libelle) + (a.semaineDerniere ? ' · ' + esc(a.semaineDerniere) + ' la semaine dernière' : '') + '</span></td>';
      }
      var statut = p.direction
        ? '<td><button type="button" class="interrupteur" role="switch" aria-checked="' + (!Etat.agentsPause[a.id]) + '" data-action="basculer-agent" data-agent="' + a.id + '" aria-label="' + esc(a.nom) + ' actif">' +
            '<span class="interrupteur-piste" aria-hidden="true"></span><span class="interrupteur-texte" aria-hidden="true">' + (Etat.agentsPause[a.id] ? 'En pause' : 'Actif') + '</span></button></td>'
        : '';
      return '<tr' + (pause ? ' class="est-pause"' : '') + '>' +
        '<th scope="row"><button type="button" class="pt-agent" data-action="ouvrir-agent" data-agent="' + a.id + '">' + Cartes.pastille(a) +
          '<span class="pt-agent-texte"><span class="pt-agent-nom"><span>' + esc(a.nom) + '</span></span>' +
          '<span class="pt-agent-rythme">' + esc(a.rythme.libelle) + '</span></span></button></th>' +
        cellules + statut + '</tr>';
    }).join('');

    var idees = D.bientot;

    return '<header class="eq-tete">' +
        '<p class="auj-date">Équipe</p>' +
        '<h1 class="titre pf-titre" style="margin-top:14px">' + titre + '</h1>' +
        '<p class="pf-sous">' + sous + '</p>' +
      '</header>' +
      '<div class="partition-cadre"><table class="partition">' +
        '<caption class="sr-only">Horaires de chaque agent sur la semaine</caption>' +
        '<thead><tr><th scope="col">Agent</th>' + JOURS.map(function (j, i) {
          return '<th scope="col" class="' + (i + 1 === jour ? 'est-aujourdhui' : '') + '">' + j + (i + 1 === jour ? '<small>aujourd’hui</small>' : '') + '</th>';
        }).join('') + (p.direction ? '<th scope="col">Statut</th>' : '') + '</tr></thead>' +
        '<tbody>' + lignes + '</tbody></table></div>' +
      (idees.length ? '<section class="eq-bientot" aria-labelledby="eq-bientot-titre">' +
        '<div class="eq-bientot-tete"><span class="avatar" aria-hidden="true">' + D.conseillere.initiales + '</span>' +
          '<div><h2 class="pf-section-titre" id="eq-bientot-titre">Agents <em>proposés</em></h2>' +
          '<p>' + D.conseillere.prenom + ', votre conseillère Datako, vous propose ces agents à partir de vos tâches récurrentes.</p></div></div>' +
        '<ul class="eq-bientot-liste">' + idees.map(function (b) {
          var dit = Etat.interesse[b.id];
          return '<li class="eq-idee"><span class="pastille teinte-marine" aria-hidden="true">' + icone(b.icone) + '</span>' +
            '<h3>' + esc(b.nom) + '</h3><p>' + esc(b.texte) + '</p>' +
            '<button type="button" class="btn btn--' + (dit ? 'fantome' : 'contour') + ' btn--petit" data-action="interesse" data-idee="' + b.id + '"' + (dit ? ' aria-disabled="true"' : '') + '>' +
              (dit ? icone('check') + 'Demande envoyée' : 'Ça m’intéresse') + '</button></li>';
        }).join('') + '</ul></section>' : '');
  }

  /* ======================================================================
     BILAN (direction)
     ====================================================================== */

  function vueBilan() {
    var p = persona();
    if (!p.direction) {
      return '<div class="reserve"><span class="pastille pastille--grande teinte-marine" aria-hidden="true">' + icone('cadenas') + '</span>' +
        '<h1 class="titre">Réservé à <em>la direction.</em></h1>' +
        '<p class="pf-sous">Le bilan, l’enveloppe d’usage et la gestion des accès sont réservés à la direction.</p>' +
        '<button type="button" class="btn btn--sombre" data-action="persona" data-persona="marc">Voir la démo en tant que Marc</button></div>';
    }
    var B = D.bilan;
    var COULEURS = ['#C9E4F5', '#8FCBEF', '#3F95CF', '#2DD4BF'];
    var points = '', i = 0;
    B.parMois.forEach(function (m, k) {
      for (var j = 0; j < m.heures; j++) { points += '<i style="--i:' + i + ';background:' + COULEURS[k] + '"></i>'; i++; }
    });
    var resumePoints = B.parMois.map(function (m) { return m.mois.toLowerCase() + ' ' + m.heures + ' h'; }).join(', ');
    var E = B.enveloppe;

    return '<section class="bl-hero" aria-labelledby="bl-titre">' +
        '<div>' +
          '<p class="auj-date">Bilan · depuis ' + B.depuis + '</p>' +
          '<h1 class="titre bl-titre" id="bl-titre">Datako a fait gagner <em>' + B.heures + ' heures</em> à votre équipe.</h1>' +
          '<p class="pf-sous">Soit ' + Math.round(B.heures / B.journee) + ' journées de travail de ' + B.journee + ' heures.</p>' +
          '<p class="bl-legende">' + B.parMois.map(function (m, k) {
            return '<span><i style="background:' + COULEURS[k] + '" aria-hidden="true"></i>' + m.mois + ' <small>' + m.heures + ' h' + (m.enCours ? ', en cours' : '') + '</small></span>';
          }).join('') + '</p>' +
        '</div>' +
        '<figure class="bl-points-cadre"><div class="bl-points" role="img" aria-label="' + B.heures + ' points, un par heure gagnée : ' + resumePoints + '">' + points + '</div>' +
          '<figcaption class="bl-points-note">Un point = une heure gagnée</figcaption></figure>' +
      '</section>' +
      '<div class="bl-chiffres">' + B.chiffres.map(function (c) { return '<div><span class="chiffre">' + esc(c.valeur) + '</span><span>' + esc(c.libelle) + '</span></div>'; }).join('') + '</div>' +
      '<p class="bl-qualite"><strong>' + B.qualite.sansCorrection + ' %</strong> des tâches validées sans correction. Temps moyen de validation : <strong>' + B.qualite.minutesValidation + ' minutes</strong>.</p>' +

      '<div class="bl-grille">' +
        '<section class="bl-carte" aria-labelledby="bl-env">' +
          '<div class="bl-carte-tete"><h2 class="pf-section-titre" id="bl-env">Enveloppe d’usage <em>· ' + D.date.mois + '</em></h2>' +
            '<span class="puce puce--teal">' + icone('bouclier') + 'Montant plafonné</span></div>' +
          '<div class="enveloppe" role="img" aria-label="' + E.consomme + ' % consommés au ' + E.jour + ' ' + D.date.mois + ', ' + E.projection + ' % prévus en fin de mois, alerte à ' + E.alerte + ' %">' +
            '<div class="enveloppe-proj" style="left:' + E.consomme + '%;width:' + (E.projection - E.consomme) + '%"></div>' +
            '<div class="enveloppe-conso" style="width:' + E.consomme + '%"></div>' +
            '<div class="enveloppe-repere" style="left:' + E.alerte + '%"><span>Alerte ' + E.alerte + ' %</span></div>' +
            '<span class="enveloppe-etiquette" style="left:' + E.consomme + '%">' + E.consomme + ' % au ' + E.jour + ' ' + D.date.mois + '</span>' +
            '<span class="enveloppe-etiquette enveloppe-etiquette--proj" style="left:' + E.projection + '%">' + E.projection + ' % prévus</span>' +
          '</div>' +
          '<p class="bl-carte-texte">Au rythme actuel, ' + D.date.mois + ' se terminera à ' + E.projection + ' % de l’enveloppe. Si le plafond est atteint, les agents s’arrêtent automatiquement : aucun dépassement n’est possible.</p>' +
          '<button type="button" class="btn btn--' + (Etat.pause ? 'valider' : 'contour') + ' bl-pause" data-action="pause">' + icone(Etat.pause ? 'lecture' : 'pause') + (Etat.pause ? 'Relancer les agents' : 'Mettre tous les agents en pause') + '</button>' +
        '</section>' +
        '<section class="bl-carte" aria-labelledby="bl-usage">' +
          '<div class="bl-carte-tete"><h2 class="pf-section-titre" id="bl-usage">Usage <em>par agent</em></h2></div>' +
          '<ul class="usage">' + B.parAgent.map(function (u) {
            var a = agentParId(u.agent);
            return '<li>' + Cartes.pastille(a, 'petite') + '<span class="usage-barre"><span>' + esc(a.nom) + '</span><i style="width:' + (u.part / B.parAgent[0].part * 100) + '%" aria-hidden="true"></i></span><span class="usage-pct">' + u.part + ' %</span></li>';
          }).join('') + '</ul>' +
        '</section>' +
      '</div>' +

      '<div class="bl-grille">' +
        '<section class="bl-carte" aria-labelledby="bl-acces">' +
          '<div class="bl-carte-tete"><h2 class="pf-section-titre" id="bl-acces">Qui a <em>accès</em></h2>' +
            '<button type="button" class="btn btn--sombre btn--petit" data-action="inviter">' + icone('plus') + 'Inviter</button></div>' +
          '<ul class="acces">' + Etat.acces.map(function (u) {
            return '<li><span class="avatar" aria-hidden="true">' + u.initiales + '</span>' +
              '<span class="acces-qui"><strong>' + esc(u.nom) + '</strong><span>' + esc(u.email) + '</span></span>' +
              '<span class="acces-droits"><span class="puce">' + esc(D.roles[u.role]) + '</span><small>' + esc(u.agents) + '</small></span></li>';
          }).join('') + '</ul>' +
          '<p class="bl-note">Connexion par lien envoyé par e-mail, sans mot de passe. Chacun voit les agents de son rôle.</p>' +
        '</section>' +
        '<section class="bl-carte" aria-labelledby="bl-logiciels">' +
          '<div class="bl-carte-tete"><h2 class="pf-section-titre" id="bl-logiciels">Logiciels <em>connectés</em></h2></div>' +
          '<ul class="logiciels-relies">' + B.logiciels.map(function (l) {
            return '<li>' + esc(l.nom) + '<small>' + icone('check') + 'Connecté depuis ' + l.depuis + '</small></li>';
          }).join('') + '</ul>' +
          '<p class="bl-note">Connexions installées et suivies par Datako. Les identifiants sont stockés de façon sécurisée.</p>' +
        '</section>' +
      '</div>';
  }

  /* ======================================================================
     FICHE D'AGENT (feuille qui monte du bas de l'écran)
     ====================================================================== */

  function travailDeLAgent(a) {
    var lc = Etat.lancements[a.id];
    return (lc && lc.travail) || a.travail || null;
  }

  function contenuFiche(a) {
    var lc = Etat.lancements[a.id];
    var enCours = lc && lc.statut === 'encours';
    var tid = travailDeLAgent(a);
    var pause = enPause(a);
    var aDejaTourne = !!tid || (lc && lc.statut === 'fini');

    /* 1. Ce qu'il utilise, ou votre demande */
    var entree;
    if (a.entree.type === 'planifie') {
      entree = '<p class="fe-texte">' + esc(a.entree.texte) + '</p>' +
        '<div><button type="button" class="btn btn--contour btn--petit" data-action="lancer" data-agent="' + a.id + '"' + (enCours || pause ? ' disabled' : '') + '>' + icone('regenerer') + 'Lancer maintenant</button>' +
        (pause ? ' <span class="puce puce--sable">En pause</span>' : '') + '</div>';
    } else if (a.entree.type === 'formulaire') {
      entree = '<form class="fe-form" data-form="lancer" data-agent="' + a.id + '">' + a.entree.champs.map(function (c) {
        if (c.type === 'choix') return '<div class="champ"><label class="champ-libelle" for="fe-' + c.id + '">' + esc(c.libelle) + '</label><select class="saisie" id="fe-' + c.id + '" name="' + c.id + '">' +
          c.options.map(function (o) { return '<option' + (lc && lc.valeurs && lc.valeurs[c.id] === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
        if (c.type === 'texte') return '<div class="champ"><label class="champ-libelle" for="fe-' + c.id + '">' + esc(c.libelle) + '</label><textarea class="saisie" id="fe-' + c.id + '" name="' + c.id + '">' + esc(lc && lc.valeurs ? lc.valeurs[c.id] : c.valeur) + '</textarea></div>';
        return '<div class="champ"><span class="champ-libelle">' + esc(c.libelle) + '</span><div class="fe-fichier">' +
          (Etat.pieceJointe ? '<span class="fe-fichier-joint">' + icone('documents', 'ic--16') + esc(c.exemple) + '</span>' : '<button type="button" class="btn btn--contour btn--petit" data-action="joindre">' + icone('televerser') + 'Joindre un fichier</button>') +
        '</div></div>';
      }).join('') + '<div><button type="submit" class="btn btn--valider"' + (enCours || pause ? ' disabled' : '') + '>' + icone('etincelle') + esc(a.entree.bouton) + '</button></div></form>';
    } else if (a.entree.type === 'question') {
      entree = '<form class="fe-form" data-form="lancer" data-agent="' + a.id + '">' +
        '<div class="champ"><label class="champ-libelle" for="fe-question">' + esc(a.entree.libelle) + '</label>' +
        '<input class="saisie" id="fe-question" name="question" autocomplete="off" placeholder="Saisissez votre question" value="' + esc(Etat.question) + '"></div>' +
        '<div class="ct-suggestions"><span class="sr-only">Exemples :</span>' + a.entree.suggestions.map(function (s) {
          return '<button type="button" class="ct-suggestion" data-action="suggestion-question">' + esc(s) + '</button>';
        }).join('') + '</div>' +
        '<div><button type="submit" class="btn btn--valider"' + (enCours ? ' disabled' : '') + '>' + icone('recherche') + esc(a.entree.bouton) + '</button></div></form>';
    } else {
      entree = '<p class="fe-texte">' + esc(a.entree.texte || 'À la demande.') + '</p>';
    }

    /* 2. Ce qu'il fait */
    var quand = enCours ? 'en cours' : (lc && lc.statut === 'fini') ? 'à ' + lc.heure : tid ? (travailBrut(tid).jour || 'aujourd’hui') + ' à ' + travailBrut(tid).heure : '';
    var etapes = '<ol class="fe-etapes">' + a.etapes.map(function (e, i) {
      var st = enCours ? (i < lc.etape ? 'fait' : i === lc.etape ? 'encours' : 'attente') : (aDejaTourne ? 'fait' : 'attente');
      return '<li class="est-' + st + '"><span class="fe-etape-icone" aria-hidden="true">' + (st === 'fait' ? icone('check') : st === 'encours' ? icone('chargement') : '') + '</span>' +
        '<span>' + esc(e) + (st === 'encours' ? '<span class="sr-only"> (en cours)</span>' : '') + '</span></li>';
    }).join('') + '</ol>';

    /* 3. Ce qu'il produit */
    var resultat;
    if (enCours) {
      resultat = '<p class="fe-vide"><span class="points" aria-hidden="true"><i></i><i></i><i></i></span> En cours…</p>';
    } else if (a.id === 'documents') {
      if (lc && lc.statut === 'fini') {
        resultat = '<p class="fe-texte"><strong>« ' + esc(lc.valeurs.question) + ' »</strong></p>' +
          (lc.reponse
            ? '<div class="fe-detail">' + miseEnForme(lc.reponse.texte) + '</div><div class="fe-sources">' + lc.reponse.sources.map(function (s, i) {
                return '<span class="fe-source"><b>' + (i + 1) + '</b>' + esc(s) + '</span>';
              }).join('') + '</div>'
            : '<div class="fe-detail"><p>' + esc(D.reponseInconnue) + '</p></div>');
      } else resultat = '<p class="fe-vide">Posez une question : la réponse s’affiche ici, avec ses sources.</p>';
    } else if (tid) {
      var t = vueTravail(tid), et = etatTravail(tid);
      var toutDecide = t.actions.every(function (ac) { return et.actions[ac.id]; });
      resultat = '<div class="fe-detail">' + miseEnForme(t.detail || t.resume) + '</div>' +
        Cartes.apercu(t.apercu) + Cartes.fichiers(t.fichiers) +
        '<div class="fe-actions"><p class="fe-actions-titre">' + icone('validation') + (toutDecide ? 'Vos décisions' : 'Actions à valider') + '</p>' +
        t.actions.map(function (ac) {
          var s = et.actions[ac.id];
          return '<div class="fe-action' + (s === 'fait' ? ' est-fait' : s === 'refuse' ? ' est-refuse' : '') + '">' +
            '<span class="fe-action-texte">' + esc(ac.libelle) + '<small>' + esc(ac.logiciel) + '</small></span>' +
            (s ? '<span class="fe-action-statut">' + (s === 'fait' ? icone('check', 'ic--16') + 'Fait à ' + et.heures[ac.id] : 'Écartée') + '</span>'
               : '<span class="fe-action-boutons"><button type="button" class="btn btn--valider btn--petit" data-action="action-valider" data-travail="' + tid + '" data-ac="' + ac.id + '">Valider</button>' +
                 '<button type="button" class="btn btn--fantome btn--petit" data-action="action-refuser" data-travail="' + tid + '" data-ac="' + ac.id + '">Écarter</button></span>') +
          '</div>';
        }).join('') + '</div>';
    } else {
      resultat = '<p class="fe-vide">Lancez l’agent : son résultat s’affichera ici.</p>';
    }

    return '<div class="feuille-poignee"><button type="button" class="feuille-fermer" data-action="fermer-fiche" aria-label="Fermer la fiche">' + icone('croix') + '</button></div>' +
      '<div class="feuille-corps">' +
        '<header class="fe-tete">' + Cartes.pastille(a, 'grande') +
          '<div><h2 class="titre fe-titre" id="fe-titre">' + esc(a.nom) + '</h2>' +
          '<p class="fe-mission">' + esc(a.mission) + '</p>' +
          '<div class="fe-meta"><span class="puce puce--teal">' + icone('horloge') + esc(a.rythme.libelle) + '</span>' +
            a.logiciels.map(function (l) { return '<span class="logiciel">' + esc(l) + '</span>'; }).join('') +
            (pause ? '<span class="puce puce--sable">' + icone('pause') + 'En pause</span>' : '') + '</div></div>' +
        '</header>' +
        '<ol class="fe-temps">' +
          '<li><div class="fe-temps-contenu"><h3 class="fe-temps-titre">' + (a.entree.type === 'planifie' ? 'Ce qu’il utilise' : 'Votre demande') + '</h3>' + entree + '</div></li>' +
          '<li class="' + (aDejaTourne || enCours ? '' : 'est-attente') + '"><div class="fe-temps-contenu"><h3 class="fe-temps-titre">Ce qu’il fait' + (quand ? '<small>' + esc(quand) + '</small>' : '') + '</h3>' + etapes + '</div></li>' +
          '<li class="' + ((aDejaTourne && !enCours) ? '' : 'est-attente') + '"><div class="fe-temps-contenu" aria-live="polite"><h3 class="fe-temps-titre">Ce qu’il produit</h3>' + resultat + '</div></li>' +
        '</ol>' +
        '<div class="fe-limites">' +
          '<div><h3>' + icone('oeil') + 'Accès en lecture</h3><p>' + esc(majuscule(a.peutLire)) + '.</p></div>' +
          '<div><h3>' + icone('validation') + 'Actions soumises à votre accord</h3><p>' + (a.attendAccord.length ? esc(majuscule(a.attendAccord.join(', '))) + '.' : 'Aucune : cet agent ne fait que lire et répondre.') + '</p></div>' +
        '</div>' +
        '<p class="fe-pied"><span class="avatar avatar--petit" aria-hidden="true">' + D.conseillere.initiales + '</span>Paramétré par ' + D.conseillere.prenom + ', votre conseillère Datako · mis à jour ' + (/^\d|^1er/.test(a.majLe) ? 'le ' : '') + esc(a.majLe) + '</p>' +
      '</div>';
  }

  function clavierFiche(e) {
    var f = document.getElementById('feuille');
    if (!f || Modale.estOuverte()) return;
    if (e.key === 'Escape') { e.preventDefault(); fermerFiche(); return; }
    if (e.key === 'Tab') {
      var liste = focalisables(f);
      if (!liste.length) return;
      if (e.shiftKey && document.activeElement === liste[0]) { e.preventDefault(); liste[liste.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === liste[liste.length - 1]) { e.preventDefault(); liste[0].focus(); }
    }
  }

  function ouvrirFiche(id) {
    var a = agentParId(id);
    if (!a || !voitAgent(a)) { location.replace('#' + Etat.fond); return; }
    fermerFiche(true);
    var fond = document.createElement('div');
    fond.className = 'feuille-fond';
    fond.id = 'feuille-fond';
    fond.setAttribute('data-action', 'fermer-fiche');
    var f = document.createElement('div');
    f.className = 'feuille';
    f.id = 'feuille';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'true');
    f.setAttribute('aria-labelledby', 'fe-titre');
    document.body.appendChild(fond);
    document.body.appendChild(f);
    document.body.style.overflow = 'hidden';
    contenu.setAttribute('aria-hidden', 'true');
    Etat.feuille = { id: id };
    rendreFiche();
    f.querySelector('.feuille-fermer').focus();
    document.addEventListener('keydown', clavierFiche);
    document.title = a.nom + ' — Datako';
    if (Etat.lancerAuto === id) {
      Etat.lancerAuto = null;
      if (a.entree.type === 'planifie') lancer(a, {});
      else if (a.entree.type === 'question' && Etat.question) lancer(a, { question: Etat.question });
      else { var champ = f.querySelector('.fe-form .saisie'); if (champ) champ.focus(); }
    }
  }

  function rendreFiche() {
    var f = document.getElementById('feuille');
    if (!f || !Etat.feuille) return;
    var defil = f.scrollTop, actif = document.activeElement, cle = actif && f.contains(actif) ? (actif.getAttribute('data-action') || actif.id) : null;
    f.innerHTML = contenuFiche(agentParId(Etat.feuille.id));
    Typo.appliquer(f);
    f.scrollTop = defil;
    if (cle) {
      var retour = f.querySelector('[data-action="' + cle + '"]:not([disabled])') || document.getElementById(cle);
      (retour || f.querySelector('.feuille-fermer')).focus({ preventScroll: true });
    }
  }

  function fermerFiche(silencieux) {
    var f = document.getElementById('feuille');
    if (!f) return;
    var id = Etat.feuille && Etat.feuille.id;
    f.remove();
    document.getElementById('feuille-fond').remove();
    document.body.style.overflow = '';
    contenu.removeAttribute('aria-hidden');
    document.removeEventListener('keydown', clavierFiche);
    Etat.feuille = null;
    if (!silencieux) {
      Etat.focusApres = '[data-agent="' + id + '"]';
      location.hash = '#' + Etat.fond;
    }
  }

  // Simule le passage d'un agent : les étapes défilent, puis le résultat arrive
  function lancer(a, valeurs) {
    var lc = Etat.lancements[a.id] = { statut: 'encours', etape: 0, valeurs: valeurs };
    rendreFiche();
    (function pas() {
      setTimeout(function () {
        if (Etat.lancements[a.id] !== lc) return;
        lc.etape++;
        if (lc.etape >= a.etapes.length) terminer(a, lc);
        if (Etat.feuille && Etat.feuille.id === a.id) rendreFiche();
        if (lc.statut === 'encours') pas();
      }, a.id === 'documents' ? 550 : 700);
    })();
  }

  function terminer(a, lc) {
    lc.statut = 'fini';
    lc.heure = tic();
    if (a.id === 'devis') {
      var client = lc.valeurs.client || 'Hôtel des Alpes';
      var n = Object.keys(Etat.clones).length + 1;
      var base = JSON.stringify(D.travaux.filter(function (t) { return t.id === 't-devis'; })[0]);
      if (client !== 'Hôtel des Alpes') base = base.split('Sandrine Vidal (Hôtel des Alpes)').join(client).split('Hôtel des Alpes').join(client);
      var clone = JSON.parse(base);
      clone.id = 't-devis-' + n;
      clone.jour = 'aujourd’hui';
      clone.heure = lc.heure;
      clone.demandePar = persona().prenom + ' ' + persona().nom;
      clone.detail = clone.detail.replace('la demande de Julien Roche', 'votre demande');
      Etat.clones[clone.id] = clone;
      lc.travail = clone.id;
      notifier('Devis prêt pour ' + client + ' : à relire avant l’envoi.', 'devis');
    } else if (a.id === 'documents') {
      lc.reponse = D.reponsesDocuments[lc.valeurs.question] || null;
      if (!lc.reponse) notifier('Question transmise à ' + D.conseillere.prenom + ', votre conseillère Datako.', 'conversation');
    } else if (a.travail) {
      notifier(a.nom + ' : rien de nouveau depuis le dernier passage.', 'info');
    } else {
      notifier(a.nom + ' : passage effectué, rien à traiter pour l’instant.', 'info');
    }
  }

  /* ======================================================================
     « DEMANDER » : la palette
     ====================================================================== */

  function ouvrirPalette() {
    var options = [];
    agentsVisibles().forEach(function (a) {
      if (a.rythme.type === 'demande') {
        options.push({ groupe: 'Faire une demande', agent: a, libelle: a.id === 'devis' ? 'Préparer un devis' : a.id === 'documents' ? 'Poser une question sur vos documents' : a.nom });
      } else {
        options.push({ groupe: 'Lancer un agent maintenant', agent: a, libelle: a.nom, lancer: true });
      }
    });
    var html =
      '<h2 id="modale-titre" class="sr-only">Demander à Datako</h2>' +
      '<div class="palette-saisie">' + icone('etincelle') +
        '<input type="text" id="palette-q" autocomplete="off" placeholder="Que voulez-vous demander à Datako ?" aria-label="Que voulez-vous demander à Datako ?" aria-controls="palette-liste" autofocus></div>' +
      '<div class="palette-liste" id="palette-liste"></div>' +
      '<p class="palette-pied">Raccourci : touche « / ». Les demandes qu’aucun agent ne couvre sont transmises à ' + D.conseillere.prenom + ', votre conseillère.</p>';
    var m = Modale.ouvrir(html, { classe: 'modale--palette' });
    var champ = m.querySelector('#palette-q'), liste = m.querySelector('#palette-liste');
    var courantes = [];

    function maj() {
      var q = champ.value.trim(), nq = normaliser(q);
      courantes = options.filter(function (o) {
        return !nq || normaliser(o.libelle + ' ' + o.agent.nom + ' ' + (MOTS_CLES[o.agent.id] || '') + ' ' + o.agent.mission).indexOf(nq) >= 0;
      });
      var docs = agentParId('documents');
      if (q.length > 12 && /\?$/.test(q) && voitAgent(docs)) courantes.unshift({ groupe: 'Faire une demande', agent: docs, libelle: 'Chercher la réponse dans vos documents', question: q });
      if (q && !courantes.length) courantes.push({ transmettre: q });
      var groupe = null, h = '';
      courantes.forEach(function (o, i) {
        if (o.transmettre) {
          h += '<p class="palette-groupe">Autre demande</p><button type="button" class="palette-option" data-i="' + i + '"><span class="pastille teinte-marine" aria-hidden="true">' + icone('conversation') + '</span>' +
            '<span class="palette-option-texte">Transmettre à ' + D.conseillere.prenom + '<small>« ' + esc(o.transmettre) + ' »</small></span>' + icone('fleche') + '</button>';
          return;
        }
        if (o.groupe !== groupe) { groupe = o.groupe; h += '<p class="palette-groupe">' + esc(groupe) + '</p>'; }
        h += '<button type="button" class="palette-option" data-i="' + i + '">' + Cartes.pastille(o.agent) +
          '<span class="palette-option-texte">' + esc(o.libelle) + '<small>' + esc(o.question ? '« ' + o.question + ' »' : o.lancer ? o.agent.rythme.libelle : o.agent.nom) + '</small></span>' + icone('fleche') + '</button>';
      });
      liste.innerHTML = h;
      Typo.appliquer(liste);
    }

    function choisir(o) {
      Modale.fermer(true);
      if (o.transmettre) { notifier('Demande transmise à ' + D.conseillere.prenom + '. Elle vous répond dans la journée.', 'conversation'); return; }
      if (o.question) Etat.question = o.question;
      if (o.lancer || o.question) Etat.lancerAuto = o.agent.id;
      else if (o.agent.entree.type !== 'planifie') Etat.lancerAuto = o.agent.id;
      location.hash = '#agent-' + o.agent.id;
    }

    champ.addEventListener('input', maj);
    champ.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && courantes.length) { e.preventDefault(); choisir(courantes[0]); }
      if (e.key === 'ArrowDown') { e.preventDefault(); var b = liste.querySelector('.palette-option'); if (b) b.focus(); }
    });
    liste.addEventListener('keydown', function (e) {
      var boutons = Array.prototype.slice.call(liste.querySelectorAll('.palette-option'));
      var i = boutons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < boutons.length - 1) { e.preventDefault(); boutons[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? boutons[i - 1] : champ).focus(); }
    });
    liste.addEventListener('click', function (e) {
      var b = e.target.closest('.palette-option');
      if (b) choisir(courantes[+b.getAttribute('data-i')]);
    });
    maj();
  }

  /* ---------- Autres fenêtres ---------- */

  function ouvrirRecap() {
    var lignes = [];
    D.travaux.forEach(function (t) {
      if (t.persona !== Etat.persona) return;
      var vt = vueTravail(t.id), et = etatTravail(t.id);
      vt.actions.forEach(function (ac) { if (et.actions[ac.id] === 'fait') lignes.push(ac.fait + ' · ' + et.heures[ac.id]); });
    });
    Modale.ouvrir(
      '<p class="surtitre surtitre--point">Aujourd’hui</p>' +
      '<h2 id="modale-titre" class="titre modale-titre-pf">Actions <em>effectuées</em></h2>' +
      (lignes.length ? '<ul class="recap">' + lignes.map(function (l) { return '<li>' + icone('check') + esc(l) + '</li>'; }).join('') + '</ul>' : '<p class="recap-vide">Aucune action effectuée.</p>') +
      '<div class="modale-actions"><button type="button" class="btn btn--sombre" data-fermer-modale>Fermer</button></div>');
  }

  function ouvrirInvitation() {
    Modale.ouvrir(
      '<p class="surtitre surtitre--point">Accès</p>' +
      '<h2 id="modale-titre" class="titre modale-titre-pf">Inviter <em>un collègue</em></h2>' +
      '<p class="chapo" style="font-size:1rem">Il recevra un lien de connexion par e-mail. Aucun mot de passe à retenir.</p>' +
      '<form class="formulaire" data-form="inviter" novalidate>' +
        '<div class="champ"><label class="champ-libelle" for="inv-email">Adresse e-mail</label><input class="saisie" id="inv-email" type="email" autocomplete="off" placeholder="prenom.nom@' + D.entreprise.domaine + '"></div>' +
        '<div class="champ"><label class="champ-libelle" for="inv-role">Rôle</label><select class="saisie" id="inv-role">' +
          Object.keys(D.roles).map(function (r) { return '<option value="' + r + '"' + (r === 'commercial' ? ' selected' : '') + '>' + esc(D.roles[r]) + '</option>'; }).join('') + '</select>' +
          '<p class="champ-aide">Le rôle détermine les agents visibles.</p></div>' +
        '<p class="message-erreur" role="alert" hidden></p>' +
        '<div class="modale-actions"><button type="button" class="btn btn--fantome" data-fermer-modale>Annuler</button><button type="submit" class="btn btn--sombre">Envoyer l’invitation</button></div>' +
      '</form>');
  }

  function agentsDuRole(role) {
    var noms = tousLesAgents().filter(function (a) { return role === 'direction' || a.roles.indexOf(role) >= 0; })
      .map(function (a) { return a.nom.split(' ')[0] === 'Questions' ? 'documents' : a.nom.toLowerCase(); });
    return role === 'direction' ? 'Tous les agents' : majuscule(noms.join(', '));
  }

  /* ======================================================================
     Rendu et navigation
     ====================================================================== */

  var TITRES = { aujourdhui: 'Aujourd’hui', equipe: 'Équipe', bilan: 'Bilan' };

  function rendre(vue, animer) {
    contenu.classList.remove('entree');
    contenu.innerHTML = vue === 'equipe' ? vueEquipe() : vue === 'bilan' ? vueBilan() : vueAujourdhui();
    if (animer) { void contenu.offsetWidth; contenu.classList.add('entree'); }
    Typo.appliquer(contenu);
    Etat.vueRendue = vue;
    Etat.animCarte = null;
    rendreChrome(vue);
    document.title = TITRES[vue] + ' — Datako';
    if (Etat.focusApres) {
      var cible = contenu.querySelector(Etat.focusApres);
      Etat.focusApres = null;
      if (cible) cible.focus({ preventScroll: true });
    }
  }

  // chemin : « aujourdhui », « equipe », « bilan » ou « agent-factures » (fiche d'agent)
  function afficher(chemin) {
    Etat.actif = true;
    var vue = chemin || 'aujourdhui';
    if (vue.indexOf('agent-') === 0) {
      if (!Etat.vueRendue) rendre(Etat.fond, true);
      ouvrirFiche(vue.slice(6));
      return;
    }
    if (!TITRES[vue]) { location.replace('#aujourdhui'); return; }
    var changement = vue !== Etat.vueRendue;
    fermerFiche(true);
    Etat.fond = vue;
    rendre(vue, changement);
    if (changement) {
      window.scrollTo(0, 0);
      if (!Etat.focusApres && document.activeElement && document.activeElement !== document.body && !racine.contains(document.activeElement)) contenu.focus({ preventScroll: true });
    }
  }

  function changerPersona(id) {
    if (Etat.persona === id) return;
    Etat.persona = id;
    Etat.correction = null;
    Etat.animCarte = 'arrive';
    var p = persona();
    notifier('Vue de ' + p.prenom + ' ' + p.nom + ', ' + p.fonction.toLowerCase() + '.', 'utilisateurs');
    if (Etat.vueRendue === 'bilan' && !p.direction) location.hash = '#aujourdhui';
    else rendre(Etat.vueRendue, true);
  }

  function basculerMenu(ouvrir) {
    var bouton = document.getElementById('pf-persona-btn'), menu = document.getElementById('pf-menu');
    if (!bouton) return;
    ouvrir = typeof ouvrir === 'boolean' ? ouvrir : menu.hidden;
    menu.hidden = !ouvrir;
    bouton.setAttribute('aria-expanded', String(ouvrir));
    if (ouvrir) menu.querySelector('.pf-menu-item').focus();
  }

  /* ---------- Clics ---------- */

  document.addEventListener('click', function (e) {
    if (!Etat.actif) return;
    var menu = document.getElementById('pf-menu');
    if (menu && !menu.hidden && !e.target.closest('.pf-persona')) basculerMenu(false);

    var el = e.target.closest('[data-action]');
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    var action = el.getAttribute('data-action');
    var carte = el.closest('[data-travail].ct');
    var idTravail = el.getAttribute('data-travail') || (carte && carte.getAttribute('data-travail'));
    var p = persona();

    switch (action) {
      case 'menu-persona': basculerMenu(); break;
      case 'persona': basculerMenu(false); changerPersona(el.getAttribute('data-persona')); break;
      case 'demander': ouvrirPalette(); break;
      case 'pause':
        Etat.pause = !Etat.pause;
        notifier(Etat.pause ? 'Tous les agents sont en pause.' : 'Les agents reprennent leur travail.', Etat.pause ? 'pause' : 'lecture');
        Etat.focusApres = Etat.vueRendue === 'bilan' ? '.bl-pause' : null;
        rendre(Etat.vueRendue, false);
        break;
      case 'basculer-agent':
        var ida = el.getAttribute('data-agent');
        Etat.agentsPause[ida] = !Etat.agentsPause[ida];
        notifier(agentParId(ida).nom + (Etat.agentsPause[ida] ? ' est en pause.' : ' est réactivé.'), Etat.agentsPause[ida] ? 'pause' : 'lecture');
        Etat.focusApres = '[data-action="basculer-agent"][data-agent="' + ida + '"]';
        rendre('equipe', false);
        break;
      case 'interesse':
        Etat.interesse[el.getAttribute('data-idee')] = true;
        notifier(D.conseillere.prenom + ' vous rappellera cette semaine.', 'conversation');
        Etat.focusApres = '[data-idee="' + el.getAttribute('data-idee') + '"]';
        rendre('equipe', false);
        break;
      case 'inviter': ouvrirInvitation(); break;
      case 'recap': ouvrirRecap(); break;

      /* Pile de travaux */
      case 'mettre-dessus':
        Etat.ordre[p.id] = [idTravail].concat(Etat.ordre[p.id].filter(function (x) { return x !== idTravail; }));
        Etat.animCarte = 'arrive';
        Etat.correction = null;
        Etat.focusApres = '.ct [data-action="valider"]';
        rendre('aujourdhui', false);
        break;
      case 'valider':
        carte.querySelectorAll('button, input').forEach(function (b) { b.disabled = true; });
        var heure = tic();
        var tampon = document.createElement('div');
        tampon.className = 'tampon';
        tampon.setAttribute('aria-hidden', 'true');
        tampon.innerHTML = 'Validé<strong>' + Typo.corriger(heure) + '</strong>';
        carte.appendChild(tampon);
        validerTravail(idTravail, heure);
        setTimeout(function () {
          carte.classList.add('s-envole');
          setTimeout(function () {
            Etat.animCarte = 'arrive';
            Etat.focusApres = Etat.ordre[p.id].length ? '.ct [data-action="valider"]' : '#auj-fini';
            rendre('aujourdhui', false);
          }, 420);
        }, 650);
        break;
      case 'plus-tard':
        carte.classList.add('s-recule');
        setTimeout(function () {
          var o = Etat.ordre[p.id];
          o.push(o.shift());
          Etat.animCarte = 'arrive';
          Etat.focusApres = '.ct [data-action="valider"]';
          rendre('aujourdhui', false);
        }, 360);
        break;
      case 'corriger':
        Etat.correction = idTravail;
        Etat.focusApres = '#ct-consigne';
        rendre('aujourdhui', false);
        break;
      case 'annuler-correction':
        Etat.correction = null;
        Etat.focusApres = '.ct [data-action="corriger"]';
        rendre('aujourdhui', false);
        break;
      case 'suggestion':
        var zone = document.getElementById('ct-consigne');
        zone.value = el.textContent;
        zone.focus();
        break;
      case 'renvoyer':
        var consigne = document.getElementById('ct-consigne').value.trim();
        var erreur = carte.querySelector('.message-erreur');
        if (!consigne) { erreur.textContent = 'Écrivez une consigne ou choisissez la suggestion.'; erreur.hidden = false; document.getElementById('ct-consigne').focus(); break; }
        var voile = document.createElement('div');
        voile.className = 'ct-travaille';
        voile.setAttribute('role', 'status');
        voile.innerHTML = '<span class="points" aria-hidden="true"><i></i><i></i><i></i></span>Correction en cours…';
        carte.appendChild(voile);
        setTimeout(function () {
          var et = etatTravail(idTravail), dejaCorrige = et.corrige;
          et.corrige = true;
          et.consigne = consigne;
          Etat.correction = null;
          Etat.focusApres = '.ct [data-action="valider"]';
          rendre('aujourdhui', false);
          notifier(dejaCorrige ? 'Consigne enregistrée pour les prochains passages.' : 'Correction faite. La consigne sera appliquée aux prochains passages.', 'regenerer');
        }, 1500);
        break;
      case 'detail':
      case 'ouvrir-agent':
        var agent = el.getAttribute('data-agent') || travailBrut(idTravail).agent;
        location.hash = '#agent-' + agent;
        break;

      /* Fiche d'agent */
      case 'fermer-fiche': fermerFiche(); break;
      case 'lancer': lancer(agentParId(el.getAttribute('data-agent')), {}); break;
      case 'joindre':
        Etat.pieceJointe = true;
        rendreFiche();
        notifier('Pièce jointe ajoutée : demande-client.pdf', 'documents');
        break;
      case 'suggestion-question':
        var q = document.getElementById('fe-question');
        q.value = el.textContent;
        Etat.question = el.textContent;
        lancer(agentParId('documents'), { question: el.textContent });
        break;
      case 'action-valider':
      case 'action-refuser':
        deciderAction(idTravail, el.getAttribute('data-ac'), action === 'action-valider' ? 'fait' : 'refuse');
        rendreFiche();
        var suivant = document.querySelector('#feuille [data-action="action-valider"]');
        (suivant || document.querySelector('#feuille .feuille-fermer')).focus({ preventScroll: true });
        break;
    }
  });

  document.addEventListener('change', function (e) {
    var c = e.target.closest('[data-coche]');
    if (!c) return;
    var carte = c.closest('[data-travail]');
    etatTravail(carte.getAttribute('data-travail')).coches[c.getAttribute('data-coche')] = c.checked;
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form]');
    if (!form || !Etat.actif) return;
    e.preventDefault();
    var type = form.getAttribute('data-form');
    if (type === 'lancer') {
      var a = agentParId(form.getAttribute('data-agent')), valeurs = {};
      Array.prototype.forEach.call(form.elements, function (c) { if (c.name) valeurs[c.name] = c.value.trim(); });
      if (a.entree.type === 'question') {
        if (!valeurs.question) { form.querySelector('#fe-question').focus(); return; }
        Etat.question = valeurs.question;
      }
      lancer(a, valeurs);
    }
    if (type === 'inviter') {
      var email = form.querySelector('#inv-email'), role = form.querySelector('#inv-role').value, err = form.querySelector('.message-erreur');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        err.textContent = 'Merci d’indiquer une adresse e-mail valide.'; err.hidden = false;
        email.classList.add('est-invalide'); email.setAttribute('aria-invalid', 'true'); email.focus(); return;
      }
      var adr = email.value.trim(), local = adr.split('@')[0].split(/[._-]/);
      var nom = local.map(majuscule).join(' ');
      Etat.acces.push({ nom: nom, initiales: local.map(function (x) { return x.charAt(0).toUpperCase(); }).join('').slice(0, 2), email: adr, role: role, agents: agentsDuRole(role) + ' · invitation envoyée' });
      Modale.fermer(true);
      notifier('Invitation envoyée à ' + adr + '.', 'envoyer');
      Etat.focusApres = '[data-action="inviter"]';
      rendre('bilan', false);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!Etat.actif || Modale.estOuverte() || Etat.feuille) return;
    if (e.key === 'Escape') { basculerMenu(false); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); ouvrirPalette(); }
  });

  /* ---------- Interface publique ---------- */

  return { afficher: afficher };
})();
