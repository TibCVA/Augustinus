/* ==========================================================================
   Datako — Studio (côté équipe Datako)
   --------------------------------------------------------------------------
   Montre comment une skill créée dans Claude devient un agent Datako :
   1. on dépose la skill (dossier .zip exporté de Claude) ;
   2. on remplit une fiche de six champs (pré-remplie depuis la skill) ;
   3. on publie chez un ou plusieurs clients.
   L'aperçu de droite montre, en direct, ce que verra le client.
   ========================================================================== */

var Studio = (function () {
  var D = DONNEES, S = D.studio;
  var zone = null;

  function etatInitial() {
    return {
      charge: false,
      fichier: null,
      demoFichier: false,
      fiche: JSON.parse(JSON.stringify(S.fiche)),
      clients: S.clients.reduce(function (o, c) { o[c.id] = c.coche; return o; }, {}),
      publie: false,
      erreur: ''
    };
  }
  var E = etatInitial();

  function declencheur() { return S.declencheurs.filter(function (d) { return d.id === E.fiche.declencheur; })[0]; }

  /* ---------- Barre du haut ---------- */
  function barre() {
    return '<a class="pf-marque" href="#/app/studio" aria-label="Studio Datako"><span class="logo logo--clair logo--petit" role="img" aria-label="Datako"></span><span class="st-marque">Studio</span></a>' +
      '<div class="pf-barre-droite"><span class="puce st-puce">Côté équipe Datako</span>' +
      '<a href="#/app/aujourdhui" class="btn btn--verre btn--petit">' + icone('retour') + 'Espace client</a></div>';
  }

  /* ---------- Étape 1 : déposer ---------- */
  function etape1() {
    if (!E.charge) {
      return '<label class="st-depot" for="st-fichier" data-st-depot>' +
          '<input type="file" id="st-fichier" class="sr-only" accept=".zip,.skill">' +
          '<span class="st-depot-icone" aria-hidden="true">' + icone('televerser', 'ic--28') + '</span>' +
          '<strong>Glissez ici la skill exportée de Claude</strong>' +
          '<span>Un dossier compressé (.zip) contenant le fichier SKILL.md · ou cliquez pour le choisir</span>' +
        '</label>' +
        (E.erreur ? '<p class="st-erreur" role="alert">' + esc(E.erreur) + '</p>' : '') +
        '<button type="button" class="btn btn--clair btn--petit" data-studio="exemple">' + icone('archive') + 'Utiliser l’exemple : ' + S.exemple.fichier + '</button>';
    }
    var f = E.fichier || { nom: S.exemple.fichier, taille: S.exemple.taille };
    return '<div class="st-fichier">' +
        '<span class="st-fichier-icone" aria-hidden="true">' + icone('archive', 'ic--24') + '</span>' +
        '<span class="st-fichier-texte"><strong>' + esc(f.nom) + '</strong><span>' + esc(f.taille) + '</span></span>' +
        '<span class="puce puce--teal">' + icone('check') + 'Skill valide</span>' +
        '<button type="button" class="btn btn--verre btn--petit" data-studio="changer">Changer</button>' +
      '</div>' +
      (E.demoFichier ? '<p class="st-note">Démonstration : le contenu affiché est celui de la skill d’exemple.</p>' : '') +
      '<div class="st-skill">' +
        '<ul class="st-arbo" aria-label="Contenu du dossier">' + S.exemple.arborescence.map(function (l) {
          return '<li style="--niveau:' + l.niveau + '">' + icone(l.dossier ? 'dossier' : 'documents', 'ic--14') + esc(l.nom) + '</li>';
        }).join('') + '</ul>' +
        '<div class="st-skillmd"><p class="st-skillmd-titre">Lu dans SKILL.md</p>' +
          '<dl><div><dt>name</dt><dd><code>' + esc(S.exemple.nom) + '</code></dd></div>' +
          '<div><dt>description</dt><dd>' + esc(S.exemple.description) + '</dd></div></dl>' +
        '</div>' +
      '</div>' +
      '<p class="st-note">' + icone('etincelle', 'ic--16') + 'La fiche ci-dessous a été pré-remplie à partir de cette description.</p>';
  }

  /* ---------- Étape 2 : la fiche ---------- */
  function etape2() {
    var F = E.fiche, dis = E.charge ? '' : ' disabled';
    function cases(nom, liste, choisis, type) {
      return '<div class="choix">' + liste.map(function (o) {
        var id = typeof o === 'string' ? o : o.id, lib = typeof o === 'string' ? o : o.libelle;
        var coche = type === 'radio' ? choisis === id : choisis.indexOf(id) >= 0;
        return '<label class="choix-item"><input type="' + (type || 'checkbox') + '" name="' + nom + '" value="' + esc(id) + '"' + (coche ? ' checked' : '') + dis + '><span>' + esc(lib) + '</span></label>';
      }).join('') + '</div>';
    }
    return '<div class="st-champs">' +
      '<div class="champ"><label class="champ-libelle" for="st-nom">Nom affiché aux utilisateurs</label>' +
        '<input class="saisie" id="st-nom" name="nom" value="' + esc(F.nom) + '" maxlength="40"' + dis + '></div>' +
      '<fieldset class="champ"><legend class="champ-libelle">Icône</legend><div class="st-icones">' + S.icones.map(function (ic) {
        return '<label class="st-icone"><input type="radio" name="icone" value="' + ic + '"' + (F.icone === ic ? ' checked' : '') + dis + '><span>' + icone(ic) + '<span class="sr-only">' + ic + '</span></span></label>';
      }).join('') + '</div></fieldset>' +
      '<fieldset class="champ"><legend class="champ-libelle">Qui peut l’utiliser</legend>' +
        cases('roles', Object.keys(D.roles).map(function (r) { return { id: r, libelle: D.roles[r] }; }), F.roles) + '</fieldset>' +
      '<fieldset class="champ"><legend class="champ-libelle">Logiciels qu’il utilise</legend>' + cases('logiciels', S.logiciels, F.logiciels) + '</fieldset>' +
      '<fieldset class="champ"><legend class="champ-libelle">Quand travaille-t-il ?</legend>' + cases('declencheur', S.declencheurs, F.declencheur, 'radio') + '</fieldset>' +
      '<fieldset class="champ"><legend class="champ-libelle">Ce qui attend un accord humain</legend>' + cases('validation', S.validations, F.validation) + '</fieldset>' +
    '</div>';
  }

  /* ---------- Étape 3 : publier ---------- */
  function etape3() {
    if (E.publie) {
      var noms = S.clients.filter(function (c) { return E.clients[c.id]; }).map(function (c) { return c.nom; });
      var d = declencheur();
      return '<div class="st-publie" id="st-publie" tabindex="-1">' +
        '<div class="tampon" aria-hidden="true">Publié<strong>12 oct.</strong></div>' +
        '<h3 class="titre">C’est en ligne. <em>Chez ' + esc(noms.length > 1 ? noms.length + ' clients' : noms[0]) + '.</em></h3>' +
        '<p>L’agent « ' + esc(E.fiche.nom) + ' » apparaît dans l’équipe de chaque client choisi. ' + (d.passages ? 'Premier passage : ' + d.rythme.toLowerCase().replace(/^chaque /, 'ce ') + '.' : 'Il est disponible dès maintenant.') + '</p>' +
        '<div class="st-publie-actions">' +
          (E.clients.bastide ? '<button type="button" class="btn btn--valider" data-studio="voir">Voir chez Bastide Équipements ' + icone('fleche') + '</button>' : '') +
          '<button type="button" class="btn btn--verre" data-studio="nouveau">Publier une autre skill</button>' +
        '</div></div>';
    }
    var dis = E.charge ? '' : ' disabled';
    return '<fieldset class="champ"><legend class="champ-libelle">Chez quels clients ?</legend><ul class="st-clients">' + S.clients.map(function (c) {
        return '<li><label class="case"><input type="checkbox" name="client" value="' + c.id + '"' + (E.clients[c.id] ? ' checked' : '') + dis + '>' +
          '<span><strong>' + esc(c.nom) + '</strong> <small>' + esc(c.ville) + '</small></span></label></li>';
      }).join('') + '</ul></fieldset>' +
      '<p class="st-erreur" role="alert"' + (E.erreurPublication ? '' : ' hidden') + '>' + esc(E.erreurPublication || '') + '</p>' +
      '<button type="button" class="btn btn--valider btn--grand" data-studio="publier"' + dis + '>' + icone('publier') + 'Publier l’agent</button>';
  }

  /* ---------- Aperçu en direct ---------- */
  function apercu() {
    var F = E.fiche, d = declencheur();
    var lecteur = F.roles.indexOf('finance') >= 0 ? 'Chantal' : F.roles.indexOf('direction') >= 0 ? 'Marc' : 'l’équipe';
    var compta = F.logiciels.indexOf('Pennylane') >= 0 ? 'Pennylane' : F.logiciels[0] || 'votre logiciel';
    var ACTIONS = {
      ecrire: { t: 'Envoyer les 8 notes conformes vers ' + compta, l: compta },
      email: { t: 'Demander le justificatif manquant à Julien Roche', l: F.logiciels.indexOf('Outlook') >= 0 ? 'Outlook' : 'E-mail' },
      agenda: { t: 'Ajouter un rappel à l’agenda pour lundi', l: 'Outlook' },
      supprimer: { t: 'Supprimer la note en double', l: compta }
    };
    var a = { icone: F.icone, teinte: 'teal' };
    var quand = d.passages ? d.rythme.toLowerCase().replace(/^chaque /, '') : d.libelle.toLowerCase();
    return '<p class="st-apercu-titre">Ce que verra ' + lecteur + (d.passages ? ', ' + esc(quand) : '') + '</p>' +
      '<article class="st-carte" aria-label="Aperçu de la carte de travail">' +
        '<div class="st-carte-tete">' + Cartes.pastille(a, 'petite') + '<span class="st-carte-agent">' + esc(F.nom || 'Nom de l’agent') + '</span><span class="st-carte-heure">' + (d.passages ? 'Préparé à ' + (d.id === 'vendredi' ? '16 h 02' : '7 h 02') : 'À l’instant') + '</span></div>' +
        '<h3 class="st-carte-titre">' + esc(S.apercu.titre) + ' <em>' + esc(S.apercu.accent) + '</em></h3>' +
        '<p class="st-carte-resume">' + esc(S.apercu.resume) + '</p>' +
        (F.validation.length ? '<div class="ct-accord"><p class="ct-accord-titre">' + icone('validation') + 'En attente de votre accord</p><ul>' + F.validation.map(function (v) {
          return '<li class="st-carte-action"><span class="st-case" aria-hidden="true"></span>' + esc(ACTIONS[v].t) + ' <span class="logiciel">' + esc(ACTIONS[v].l) + '</span></li>';
        }).join('') + '</ul></div>' : '<p class="st-carte-seul">' + icone('alerte', 'ic--16') + 'Aucune validation : l’agent agira seul. À réserver aux tâches sans risque.</p>') +
        '<div class="st-carte-boutons" aria-hidden="true"><span class="btn btn--valider btn--petit">' + icone('check') + 'Valider</span><span class="btn btn--contour btn--petit">Corriger</span></div>' +
      '</article>' +
      '<p class="st-apercu-titre">Dans l’équipe</p>' +
      '<div class="st-ligne">' + Cartes.pastille(a) +
        '<span class="st-ligne-texte"><strong>' + esc(F.nom || 'Nom de l’agent') + '</strong><span>' + esc(d.rythme) + '</span></span>' +
        '<span class="st-ligne-roles">' + F.roles.map(function (r) { return '<span class="puce">' + esc(D.roles[r]) + '</span>'; }).join('') + '</span>' +
      '</div>' +
      '<details class="st-capot"><summary>' + icone('code', 'ic--16') + 'Sous le capot</summary><ol>' +
        '<li>La skill est envoyée telle quelle dans l’espace Claude de chaque client choisi.</li>' +
        '<li>Le Studio crée l’agent : la skill, les logiciels reliés, les actions soumises à accord.</li>' +
        '<li>Le rythme est programmé. Chaque action sensible attend un clic dans « Aujourd’hui ».</li>' +
        '<li>La même skill reste utilisable dans Claude, pour ceux qui y travaillent déjà.</li>' +
      '</ol></details>';
  }

  /* ---------- Vue complète ---------- */
  function vue() {
    function bloc(n, titre, sousTitre, corps, actif, fait) {
      return '<section class="st-bloc' + (actif ? '' : ' est-inactif') + (fait ? ' est-fait' : '') + '" aria-labelledby="st-b' + n + '">' +
        '<h2 class="st-bloc-titre" id="st-b' + n + '"><span class="st-num" aria-hidden="true">' + (fait ? icone('check') : n) + '</span>' + titre + '<small>' + sousTitre + '</small></h2>' +
        corps + '</section>';
    }
    return '<div class="st">' +
      '<header class="st-tete">' +
        '<p class="surtitre surtitre--point">Studio Datako</p>' +
        '<h1 class="titre st-titre">Une skill créée dans Claude devient <em>un agent Datako.</em></h1>' +
        '<p class="chapo st-chapo">Trois gestes, aucune ligne de code. La skill reste celle que vous avez écrite et testée dans Claude ; le Studio y ajoute ce que le client verra.</p>' +
      '</header>' +
      '<div class="st-grille">' +
        '<div class="st-etapes">' +
          bloc(1, 'Déposer la skill', 'exportée de Claude', '<div class="st-bloc-corps" id="st-etape1">' + etape1() + '</div>', true, E.charge) +
          bloc(2, 'Décrire l’agent', 'six champs, pré-remplis', '<form class="st-bloc-corps" id="st-fiche" novalidate>' + etape2() + '</form>', E.charge, E.publie) +
          bloc(3, 'Publier', 'chez un ou plusieurs clients', '<div class="st-bloc-corps" id="st-etape3">' + etape3() + '</div>', E.charge, E.publie) +
        '</div>' +
        '<aside class="st-apercu" id="st-apercu" aria-label="Aperçu en direct">' + apercu() + '</aside>' +
      '</div>' +
    '</div>';
  }

  /* ---------- Interactions ---------- */
  var racine = null;

  function rafraichir(focus) {
    var tmp = document.createElement('div');
    tmp.innerHTML = vue();
    var nouveau = tmp.firstChild;
    racine.replaceWith(nouveau);
    racine = nouveau;
    Typo.appliquer(racine);
    brancher();
    if (focus) { var c = racine.querySelector(focus); if (c) c.focus(); }
  }

  function rafraichirApercu() {
    var a = racine.querySelector('#st-apercu');
    var ouvert = a.querySelector('details') && a.querySelector('details').open;
    a.innerHTML = apercu();
    if (ouvert) a.querySelector('details').open = true;
    Typo.appliquer(a);
  }

  function chargerFichier(fichier) {
    if (fichier && !/\.(zip|skill)$/i.test(fichier.name)) {
      E.erreur = 'Ce fichier n’est pas une skill : déposez le dossier compressé (.zip) exporté de Claude.';
      rafraichir('[data-studio="exemple"]');
      return;
    }
    E.charge = true;
    E.erreur = '';
    E.fichier = fichier ? { nom: fichier.name, taille: Math.max(1, Math.round(fichier.size / 1024)) + ' Ko' } : null;
    E.demoFichier = !!fichier && fichier.name !== S.exemple.fichier;
    rafraichir('#st-nom');
    notifier('Skill lue : la fiche est pré-remplie.', 'etincelle');
  }

  function lireFiche() {
    var form = racine.querySelector('#st-fiche');
    var F = E.fiche;
    F.nom = form.querySelector('#st-nom').value;
    F.icone = (form.querySelector('input[name="icone"]:checked') || {}).value || F.icone;
    F.roles = Array.prototype.map.call(form.querySelectorAll('input[name="roles"]:checked'), function (i) { return i.value; });
    F.logiciels = Array.prototype.map.call(form.querySelectorAll('input[name="logiciels"]:checked'), function (i) { return i.value; });
    F.declencheur = (form.querySelector('input[name="declencheur"]:checked') || {}).value || F.declencheur;
    F.validation = Array.prototype.map.call(form.querySelectorAll('input[name="validation"]:checked'), function (i) { return i.value; });
  }

  function publier() {
    lireFiche();
    racine.querySelectorAll('input[name="client"]').forEach(function (c) { E.clients[c.value] = c.checked; });
    var F = E.fiche;
    var manque = !F.nom.trim() ? 'Donnez un nom à l’agent.' : !F.roles.length ? 'Choisissez au moins un rôle autorisé.' : !S.clients.some(function (c) { return E.clients[c.id]; }) ? 'Choisissez au moins un client.' : '';
    if (manque) {
      E.erreurPublication = manque;
      rafraichir('[data-studio="publier"]');
      return;
    }
    E.erreurPublication = '';
    var d = declencheur();
    var libellesValidation = F.validation.map(function (v) { return S.validations.filter(function (x) { return x.id === v; })[0].libelle.toLowerCase(); });
    if (E.clients.bastide) {
      Plateforme.publier({
        id: S.exemple.nom, nom: F.nom.trim(), icone: F.icone, teinte: 'teal',
        skill: S.exemple.nom, version: 'v1', majLe: 'aujourd’hui',
        mission: S.exemple.description,
        roles: F.roles.slice(), logiciels: F.logiciels.slice(),
        peutLire: 'les notes de frais, les justificatifs et la politique de dépenses',
        attendAccord: libellesValidation,
        rythme: d.passages ? { type: 'horaire', libelle: d.rythme, passages: d.passages } : { type: 'demande', libelle: d.rythme },
        entree: { type: 'planifie', texte: 'Les notes de frais déposées par les collaborateurs depuis son dernier passage, et la politique de dépenses de l’entreprise.' },
        etapes: ['Notes de frais de la semaine récupérées', 'Chaque justificatif comparé à la politique de dépenses', 'Rapport de contrôle et export comptable préparés'],
        nouveau: true
      });
    }
    E.publie = true;
    rafraichir('#st-publie');
  }

  function brancher() {
    var depot = racine.querySelector('[data-st-depot]');
    if (depot) {
      var champ = depot.querySelector('input');
      champ.addEventListener('change', function () { if (champ.files[0]) chargerFichier(champ.files[0]); });
      ['dragenter', 'dragover'].forEach(function (t) { depot.addEventListener(t, function (e) { e.preventDefault(); depot.classList.add('est-survol'); }); });
      ['dragleave', 'drop'].forEach(function (t) { depot.addEventListener(t, function (e) { e.preventDefault(); depot.classList.remove('est-survol'); }); });
      depot.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) chargerFichier(f); });
    }
    var form = racine.querySelector('#st-fiche');
    form.addEventListener('input', function () { lireFiche(); rafraichirApercu(); });
    form.addEventListener('change', function () { lireFiche(); rafraichirApercu(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    racine.addEventListener('click', function (e) {
      var b = e.target.closest('[data-studio]');
      if (!b) return;
      var a = b.getAttribute('data-studio');
      if (a === 'exemple') chargerFichier(null);
      if (a === 'changer') { E.charge = false; E.fichier = null; E.demoFichier = false; rafraichir('[data-studio="exemple"]'); }
      if (a === 'publier') publier();
      if (a === 'nouveau') { E = etatInitial(); rafraichir('[data-studio="exemple"]'); }
      if (a === 'voir') {
        Plateforme.voirEnTantQue(E.fiche.roles.indexOf('finance') >= 0 ? 'chantal' : 'marc');
        Plateforme.focusApres('[data-agent="' + S.exemple.nom + '"]');
        location.hash = '#/app/equipe';
      }
    });
  }

  return {
    barre: barre,
    vue: vue,
    apresRendu: function (contenu) { racine = contenu.querySelector('.st'); brancher(); }
  };
})();
