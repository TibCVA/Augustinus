/* ==========================================================================
   Datako — Vitrine : en-tête, pile de travaux à valider, journée type
   (le ciel suit la lecture), calcul en une phrase, contact.
   ========================================================================== */

var Vitrine = (function () {
  var entete = document.getElementById('vt-entete');

  /* ---------- En-tête : fond dès que l'on fait défiler ---------- */
  function surDefilement() { entete.classList.toggle('est-defile', window.scrollY > 24); }
  window.addEventListener('scroll', surDefilement, { passive: true });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-contact]')) { e.preventDefault(); ouvrirContact(); }
  });

  /* ---------- 1. La pile de travaux (hero) ---------- */
  var pile = document.getElementById('vt-pile');
  var compteur = document.getElementById('vt-temps');
  var HEURES_VALIDATION = ['8 h 41', '8 h 42', '8 h 44'];
  var file, rendues, validees;

  function travail(id) {
    for (var i = 0; i < DONNEES.travaux.length; i++) if (DONNEES.travaux[i].id === id) return DONNEES.travaux[i];
  }

  function carteHtml(t) {
    var a = Cartes.agent(t.agent);
    return '<div class="vt-carte-tete">' + Cartes.pastille(a, 'petite') +
        '<span class="vt-carte-agent">' + esc(a.nom) + '</span>' +
        '<span class="vt-carte-heure">' + esc(t.heure) + '</span></div>' +
      '<h3 class="vt-carte-titre">' + esc(t.titre) + ' <em>' + esc(t.accent) + '</em></h3>' +
      '<div class="vt-carte-apercu">' + Cartes.apercu(t.apercu, { compact: true }) + '</div>' +
      '<div class="vt-carte-pied">' +
        '<button type="button" class="btn btn--valider btn--petit" data-vt="valider">' + icone('check') + 'Valider</button>' +
        '<button type="button" class="btn btn--fantome btn--petit" data-vt="plus-tard">Plus tard</button>' +
        '<span class="vt-carte-gain">' + Format.duree(t.minutes) + ' de travail</span>' +
      '</div>';
  }

  function demarrerPile() {
    file = ['t-factures', 't-emails', 't-relances'];
    rendues = 0; validees = 0;
    compteur.textContent = '0 min';
    pile.innerHTML = '';
    file.forEach(function (id) {
      var el = document.createElement('article');
      el.className = 'vt-carte';
      el.setAttribute('data-id', id);
      el.innerHTML = carteHtml(travail(id));
      pile.appendChild(el);
    });
    Typo.appliquer(pile);
    ranger();
  }

  // Attribue à chaque carte son rang dans la pile (0 = dessus)
  function ranger() {
    file.forEach(function (id, rang) {
      var el = pile.querySelector('[data-id="' + id + '"]');
      el.setAttribute('data-rang', rang);
      el.style.zIndex = 10 - rang;
      if (rang === 0) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
      else { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
    });
  }

  function animerCompteur(de, a) {
    var debut = null;
    function pas(t) {
      if (!debut) debut = t;
      var p = Math.min(1, (t - debut) / 700);
      compteur.textContent = Typo.corriger(Format.duree(de + (a - de) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(pas);
    }
    requestAnimationFrame(pas);
  }

  pile.addEventListener('click', function (e) {
    var b = e.target.closest('[data-vt]');
    if (!b) return;
    var action = b.getAttribute('data-vt');
    if (action === 'rejouer') { demarrerPile(); pile.querySelector('[data-vt="valider"]').focus(); return; }
    var carte = b.closest('.vt-carte');
    var id = carte.getAttribute('data-id');

    if (action === 'plus-tard') {
      file.push(file.shift());
      ranger();
      pile.querySelector('[data-rang="0"] [data-vt="valider"]').focus();
      return;
    }

    if (action === 'valider') {
      carte.setAttribute('inert', '');
      var tampon = document.createElement('div');
      tampon.className = 'tampon';
      tampon.setAttribute('aria-hidden', 'true');
      tampon.innerHTML = 'Validé<strong>' + HEURES_VALIDATION[validees] + '</strong>';
      Typo.appliquer(tampon);
      carte.appendChild(tampon);
      validees++;
      var avant = rendues;
      rendues += travail(id).minutes;
      animerCompteur(avant, rendues);
      setTimeout(function () {
        carte.classList.add('s-envole');
        file.shift();
        if (file.length) ranger();
        setTimeout(function () {
          carte.remove();
          if (!file.length) finDePile();
          else pile.querySelector('[data-rang="0"] [data-vt="valider"]').focus();
        }, 450);
      }, 700);
    }
  });

  function finDePile() {
    var el = document.createElement('article');
    el.className = 'vt-carte vt-carte--fin';
    el.setAttribute('data-rang', '0');
    el.innerHTML =
      '<h3 class="vt-carte-titre">Tout est validé. <em>' + Format.duree(rendues) + ' rendue.</em></h3>' +
      '<p>Avant 9 h, Chantal a bouclé ce qui lui prenait sa matinée. Les factures sont dans Pennylane, les réponses sont parties.</p>' +
      '<a href="#/app/aujourdhui" class="btn btn--valider">Voir la démo complète ' + icone('fleche') + '</a>' +
      '<button type="button" class="vt-carte-rejouer" data-vt="rejouer">Recommencer</button>';
    Typo.appliquer(el);
    pile.appendChild(el);
    el.querySelector('a').focus({ preventScroll: true });
  }

  /* ---------- 2. Une journée : le ciel suit la lecture ---------- */
  var etapes = document.getElementById('vt-etapes');
  var ciel = document.getElementById('vt-ciel');
  var cielHeure = document.getElementById('vt-ciel-heure');
  var cielQui = document.getElementById('vt-ciel-qui');

  etapes.innerHTML = DONNEES.vitrine.journee.map(function (e, i) {
    var titre = esc(e.titre).replace(/\*(.+?)\*/g, '<em>$1</em>');
    var qui = e.humain
      ? '<span class="puce puce--sable vt-etape-qui">' + icone(e.qui === 'Fin de journée' ? 'horloge' : 'validation') + esc(e.qui) + '</span>'
      : '<span class="puce puce--teal vt-etape-qui">' + icone('etincelle') + 'Datako · ' + esc(e.agent) + '</span>';
    return '<li class="vt-etape' + (e.humain ? ' vt-etape--humain' : '') + (i === 0 ? ' est-active' : '') + '" data-index="' + i + '">' +
      '<div class="vt-etape-meta"><span class="vt-etape-heure">' + esc(e.heure) + '</span>' + qui + '</div>' +
      '<h3>' + titre + '</h3><p>' + esc(e.texte) + '</p></li>';
  }).join('');

  function activerEtape(i) {
    var e = DONNEES.vitrine.journee[i];
    etapes.querySelectorAll('.vt-etape').forEach(function (li, j) { li.classList.toggle('est-active', j === i); });
    ciel.setAttribute('data-ciel', e.ciel);
    cielHeure.textContent = Typo.corriger(e.heure);
    cielQui.textContent = e.humain ? e.qui : 'Datako travaille';
  }

  if ('IntersectionObserver' in window) {
    var observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (en) {
        if (en.isIntersecting) activerEtape(+en.target.getAttribute('data-index'));
      });
    }, { rootMargin: '-48% 0px -48% 0px' });
    etapes.querySelectorAll('.vt-etape').forEach(function (li) { observateur.observe(li); });
  }

  /* ---------- 3. Le calcul en une phrase ---------- */
  var selPersonnes = document.getElementById('vt-personnes');
  var selHeures = document.getElementById('vt-heures');
  var selTache = document.getElementById('vt-tache');
  var S = DONNEES.vitrine.simulateur;

  function options(sel, liste, choisi) {
    sel.innerHTML = liste.map(function (o) {
      return '<option value="' + o.v + '"' + (String(o.v) === String(choisi) ? ' selected' : '') + '>' + esc(Typo.corriger(o.t)) + '</option>';
    }).join('');
  }
  options(selPersonnes, Array.from({ length: 15 }, function (_, i) { return { v: i + 1, t: String(i + 1) }; }), S.personnes);
  options(selHeures, Array.from({ length: 16 }, function (_, i) { return { v: i + 1, t: (i + 1) + ' h' }; }), S.heures);
  options(selTache, DONNEES.vitrine.taches.map(function (t) { return { v: t.id, t: t.libelle }; }), S.tache);

  function calculer() {
    var p = +selPersonnes.value, h = +selHeures.value;
    document.getElementById('vt-personnes-libelle').textContent = p > 1 ? 'personnes passent' : 'personne passe';
    var gain = Math.round(p * h * S.part * 2) / 2;
    var texteGain = gain < 1 ? Math.round(gain * 60) + ' minutes'
      : (String(gain).replace('.', ',') + (gain >= 2 ? ' heures' : ' heure'));
    var j = gain / 7, texteJours;
    if (j < 0.35) texteJours = 'quelques heures de travail';
    else if (j < 0.75) texteJours = 'une demi-journée de travail';
    else if (j < 1.15) texteJours = 'environ une journée de travail';
    else {
      var n = Math.floor(j * 2) / 2;
      texteJours = 'plus ' + (n === 1 ? 'd’une journée' : n === 1.5 ? 'd’une journée et demie' : 'de ' + String(n).replace('.', ',') + ' journées') + ' de travail';
    }
    document.getElementById('vt-gain').textContent = Typo.corriger(texteGain);
    document.getElementById('vt-jours').textContent = texteJours;
  }
  [selPersonnes, selHeures, selTache].forEach(function (s) { s.addEventListener('change', calculer); });
  calculer();

  demarrerPile();

  return {
    afficher: function () { surDefilement(); },
    masquer: function () {}
  };
})();
