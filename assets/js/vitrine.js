/* ==========================================================================
   Datako — Interactions de la vitrine
   ========================================================================== */

var Vitrine = (function () {
  var initialisee = false;
  var minuterieHero = null;
  var reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- En-tête : fond au défilement, menu mobile, lien actif ---------- */
  function initEntete() {
    var entete = document.getElementById('vt-entete');
    var nav = document.getElementById('vt-nav');
    var burger = document.getElementById('vt-burger');

    function majFond() { entete.classList.toggle('est-colle', window.scrollY > 40 || nav.classList.contains('ouvert')); }
    window.addEventListener('scroll', majFond, { passive: true });
    majFond();

    function fermerMenu() {
      nav.classList.remove('ouvert');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Ouvrir le menu');
      burger.innerHTML = icone('menu');
      majFond();
    }
    burger.addEventListener('click', function () {
      var ouvert = nav.classList.toggle('ouvert');
      burger.setAttribute('aria-expanded', String(ouvert));
      burger.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
      burger.innerHTML = icone(ouvert ? 'croix' : 'menu');
      majFond();
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) fermerMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('ouvert')) { fermerMenu(); burger.focus(); } });

    // Lien actif selon la section visible
    if ('IntersectionObserver' in window) {
      var liens = {};
      nav.querySelectorAll('a[href^="#"]:not([href^="#/"])').forEach(function (a) { liens[a.getAttribute('href').slice(1)] = a; });
      var obs = new IntersectionObserver(function (entrees) {
        entrees.forEach(function (en) {
          if (en.isIntersecting && liens[en.target.id]) {
            Object.keys(liens).forEach(function (k) { liens[k].classList.remove('actif'); liens[k].removeAttribute('aria-current'); });
            liens[en.target.id].classList.add('actif');
            liens[en.target.id].setAttribute('aria-current', 'true');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(liens).forEach(function (id) { var s = document.getElementById(id); if (s) obs.observe(s); });
    }
  }

  /* ---------- Apparition progressive des blocs ---------- */
  function initRevelation() {
    var blocs = document.querySelectorAll('#vue-vitrine .reveler');
    if (!('IntersectionObserver' in window) || reduit) { blocs.forEach(function (b) { b.classList.add('visible'); }); return; }
    var obs = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); obs.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    blocs.forEach(function (b) { obs.observe(b); });
  }

  /* ---------- Fenêtre produit : l'agent « Factures » au travail ---------- */
  function animerHero() {
    var tuile = document.getElementById('fc-tuile-animee');
    if (!tuile) return;
    if (reduit) { tuile.classList.add('e3'); return; }
    var etats = ['e1', 'e2', 'e3'];
    var i = 0;
    function suivant() {
      if (i < etats.length) {
        tuile.classList.add(etats[i]);
        i++;
        minuterieHero = setTimeout(suivant, i === etats.length ? 3200 : 1300);
      } else {
        tuile.classList.remove('e1', 'e2', 'e3');
        i = 0;
        minuterieHero = setTimeout(suivant, 900);
      }
    }
    clearTimeout(minuterieHero);
    minuterieHero = setTimeout(suivant, 900);
  }

  /* ---------- Méthode en trois étapes ---------- */
  function initEtapes() {
    var onglets = Array.prototype.slice.call(document.querySelectorAll('.vt-etape'));
    var prec = document.getElementById('vt-etape-prec');
    var suiv = document.getElementById('vt-etape-suiv');
    var compteur = document.getElementById('vt-etape-compteur');
    var progression = document.getElementById('vt-etapes-progression');
    var actuelle = 1;

    function aller(n, focus) {
      actuelle = Math.max(1, Math.min(3, n));
      onglets.forEach(function (o, i) {
        var actif = i + 1 === actuelle;
        o.classList.toggle('actif', actif);
        o.classList.toggle('fait', i + 1 < actuelle);
        o.setAttribute('aria-selected', String(actif));
        o.tabIndex = actif ? 0 : -1;
        document.getElementById('etape-' + (i + 1)).hidden = !actif;
      });
      if (focus) onglets[actuelle - 1].focus();
      compteur.textContent = '0' + actuelle + ' / 03';
      progression.style.width = ((actuelle - 1) / 2 * 100) + '%';
      prec.disabled = actuelle === 1;
      suiv.innerHTML = actuelle === 3 ? 'Voir la démo' + icone('fleche', 'ic--fleche') : 'Étape suivante' + icone('fleche', 'ic--fleche');
    }

    onglets.forEach(function (o) {
      o.addEventListener('click', function () { aller(Number(o.dataset.etape)); });
      o.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); aller(actuelle === 3 ? 1 : actuelle + 1, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); aller(actuelle === 1 ? 3 : actuelle - 1, true); }
      });
    });
    prec.addEventListener('click', function () { aller(actuelle - 1); });
    suiv.addEventListener('click', function () {
      if (actuelle === 3) { location.hash = '#/app/accueil'; return; }
      aller(actuelle + 1);
    });
    aller(1);
  }

  /* ---------- Bibliothèque d'agents par métier ---------- */
  function initAgents() {
    var zoneOnglets = document.getElementById('vt-onglets-metiers');
    var zoneAgents = document.getElementById('vt-agents');

    zoneOnglets.innerHTML = DONNEES.metiers.map(function (m, i) {
      return '<button class="vt-onglet" role="tab" id="onglet-' + m.id + '" aria-controls="vt-agents" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" data-metier="' + m.id + '">' +
        icone(m.icone) + esc(m.nom) + '</button>';
    }).join('');

    function afficher(idMetier) {
      var agents = DONNEES.agents.filter(function (a) { return a.metier === idMetier; }).slice(0, 2);
      zoneAgents.setAttribute('aria-labelledby', 'onglet-' + idMetier);
      zoneAgents.innerHTML = agents.map(function (a) {
        return '<article class="vt-agent">' +
          '<div class="vt-agent-haut"><span class="vt-agent-ic">' + icone(a.icone, 'ic--24') + '</span>' +
          (a.statut === 'nouveau' ? '<span class="badge badge--turquoise">' + icone('etincelle') + 'Nouveau</span>' : '') + '</div>' +
          '<h3>' + esc(a.nom) + '</h3>' +
          '<p>' + esc(a.description) + '</p>' +
          '<div class="vt-agent-gain"><span class="sr-only">Temps nécessaire : ' + esc(a.avant) + ' aujourd’hui, ' + esc(a.apres) + ' avec Datako, ' + esc(a.unite) + '.</span>' +
            '<span class="avant" aria-hidden="true">' + esc(a.avant) + '</span>' + icone('fleche', 'ic--16') +
            '<span class="apres" aria-hidden="true">' + esc(a.apres) + '</span><span class="unite" aria-hidden="true">' + esc(a.unite) + '</span></div>' +
          '<div class="vt-agent-outils">' + a.outils.map(function (o) { return '<span class="badge">' + icone('prise') + esc(o) + '</span>'; }).join('') + '</div>' +
        '</article>';
      }).join('') +
      '<article class="vt-agent vt-agent--mesure">' +
        '<span class="vt-agent-ic">' + icone('plus', 'ic--24') + '</span>' +
        '<h3>Un besoin spécifique&#8239;?</h3>' +
        '<p>Nous concevons l’agent sur mesure, à partir de vos processus et de vos outils.</p>' +
        '<button class="lien" data-ouvrir-contact>Décrire mon besoin ' + icone('fleche') + '</button>' +
      '</article>';
      Typo.appliquer(zoneAgents);
    }

    var boutons = Array.prototype.slice.call(zoneOnglets.querySelectorAll('.vt-onglet'));
    function choisir(b, focus) {
      boutons.forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
      if (focus) b.focus();
      afficher(b.dataset.metier);
    }
    boutons.forEach(function (b, i) {
      b.addEventListener('click', function () { choisir(b); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); choisir(boutons[(i + 1) % boutons.length], true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); choisir(boutons[(i - 1 + boutons.length) % boutons.length], true); }
      });
    });
    afficher(DONNEES.metiers[0].id);
  }

  /* ---------- Simulateur de gains ---------- */
  function initSimulateur() {
    var S = DONNEES.simulateur;
    var champTache = document.getElementById('sim-tache');
    var volume = document.getElementById('sim-volume');
    var minutes = document.getElementById('sim-minutes');
    var part = document.getElementById('sim-part');
    var cout = document.getElementById('sim-cout');

    champTache.innerHTML = S.taches.map(function (t) { return '<option value="' + t.id + '">' + esc(t.libelle) + '</option>'; }).join('');
    part.value = S.partAutomatisee;
    cout.value = S.coutHoraire;

    function tacheCourante() { return S.taches.find(function (t) { return t.id === champTache.value; }); }

    function remplissage(input) {
      var p = (input.value - input.min) / (input.max - input.min) * 100;
      input.style.setProperty('--p', p + '%');
    }

    function chargerTache() {
      var t = tacheCourante();
      volume.min = t.volumeMin; volume.max = t.volumeMax; volume.step = t.pas; volume.value = t.volume;
      minutes.min = 1; minutes.max = t.minutesMax; minutes.step = 1; minutes.value = t.minutes;
      calculer();
    }

    function calculer() {
      var t = tacheCourante();
      var v = Number(volume.value), m = Number(minutes.value), p = Number(part.value) / 100, c = Number(cout.value);
      var avant = v * m / 60;
      var liberees = avant * p;
      var apres = avant - liberees;
      var joursAn = liberees * S.moisParAn / S.heuresParJour;
      var valeurAn = liberees * S.moisParAn * c;

      document.getElementById('sim-volume-val').textContent = Typo.corriger(Format.nombre(v) + ' ' + t.unite);
      document.getElementById('sim-minutes-val').textContent = Typo.corriger(Format.heures(m / 60));
      document.getElementById('sim-part-val').textContent = Typo.corriger(Math.round(p * 100) + ' %');
      document.getElementById('sim-cout-val').textContent = Typo.corriger(c + ' € / heure');

      document.getElementById('sim-heures').textContent = Typo.corriger(liberees >= 10 ? Format.nombre(Math.round(liberees)) + ' h' : Format.heures(liberees));
      document.getElementById('sim-avant').textContent = Typo.corriger(Format.heures(avant));
      document.getElementById('sim-apres').textContent = Typo.corriger(Format.heures(apres));
      document.getElementById('sim-barre-avant').style.width = '100%';
      document.getElementById('sim-barre-apres').style.width = Math.max(2, (1 - p) * 100) + '%';
      document.getElementById('sim-jours').textContent = Typo.corriger(Format.nombre(joursAn, joursAn < 10 ? 1 : 0));
      document.getElementById('sim-valeur').textContent = Typo.corriger(Format.euros(Math.round(valeurAn / 10) * 10, 0));

      [volume, minutes, part, cout].forEach(remplissage);
    }

    champTache.addEventListener('change', chargerTache);
    [volume, minutes, part, cout].forEach(function (i) { i.addEventListener('input', calculer); });
    chargerTache();
  }

  function init() {
    if (initialisee) return;
    initialisee = true;
    initEntete();
    initRevelation();
    initEtapes();
    initAgents();
    initSimulateur();
  }

  function afficher() {
    init();
    animerHero();
  }

  function masquer() { clearTimeout(minuterieHero); }

  return { afficher: afficher, masquer: masquer };
})();

/* Boutons « Parler à un expert », où qu'ils soient */
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-ouvrir-contact]');
  if (b) { e.preventDefault(); ouvrirContact(); }
});
