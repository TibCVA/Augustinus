/* ==========================================================================
   Datako — Graphiques (SVG dessinés à la main, sans bibliothèque)
   Règles : barres fines (≤ 24 px), extrémité arrondie de 4 px, grille en
   filets discrets, une seule couleur par série, info-bulle au survol et au
   clavier, tableau de données accessible.
   ========================================================================== */

var Format = {
  nombre: function (v, decimales) {
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimales || 0, maximumFractionDigits: decimales || 0 }).format(v);
  },
  euros: function (v, decimales) {
    var d = decimales === undefined ? 2 : decimales;
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  },
  heures: function (h) {
    var totalMin = Math.round(h * 60);
    var hh = Math.floor(totalMin / 60), mm = totalMin % 60;
    if (hh === 0) return mm + ' min';
    return hh + ' h' + (mm ? ' ' + (mm < 10 ? '0' : '') + mm : '');
  }
};

var Graphiques = (function () {
  var NS = 'http://www.w3.org/2000/svg';
  var infobulle = null;

  function el(nom, attrs, parent) {
    var n = document.createElementNS(NS, nom);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function obtenirInfobulle() {
    if (!infobulle) {
      infobulle = document.createElement('div');
      infobulle.className = 'infobulle';
      infobulle.setAttribute('role', 'tooltip');
      document.body.appendChild(infobulle);
    }
    return infobulle;
  }

  function montrerInfobulle(x, y, valeur, libelle) {
    var b = obtenirInfobulle();
    b.textContent = '';
    var s = document.createElement('strong'); s.textContent = valeur;
    var l = document.createElement('span'); l.textContent = libelle;
    b.appendChild(s); b.appendChild(l);
    b.classList.add('visible');
    var r = b.getBoundingClientRect();
    var left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    var top = y - r.height - 12;
    if (top < 8) top = y + 16;
    b.style.left = left + 'px';
    b.style.top = top + 'px';
  }

  function cacherInfobulle() { if (infobulle) infobulle.classList.remove('visible'); }

  /* Graduations « propres » : 0, 500, 1 000, 1 500… */
  function graduations(max, nb) {
    var brut = max / nb;
    var puissance = Math.pow(10, Math.floor(Math.log10(brut)));
    var pas = [1, 2, 2.5, 5, 10].map(function (m) { return m * puissance; }).find(function (p) { return p >= brut; });
    var ticks = [];
    for (var v = 0; v <= max + pas * 0.001; v += pas) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + pas);
    return ticks;
  }

  function compact(v) {
    if (v >= 1000) return Format.nombre(v / 1000, v % 1000 === 0 ? 0 : 1) + ' k';
    return Format.nombre(v);
  }

  /* Histogramme en colonnes (une série) avec repère optionnel */
  function colonnes(conteneur, opts) {
    function dessiner() {
      var largeur = Math.max(280, conteneur.clientWidth);
      var hauteur = opts.hauteur || 240;
      var marge = { haut: 18, droite: opts.seuil ? 12 : 8, bas: 34, gauche: 44 };
      var donnees = opts.donnees;
      var maxVal = Math.max.apply(null, donnees.map(function (d) { return d.valeur; }).concat(opts.seuil ? [opts.seuil.valeur] : []));
      var ticks = graduations(maxVal * 1.08, 4);
      var yMax = ticks[ticks.length - 1];
      var lPlot = largeur - marge.gauche - marge.droite;
      var hPlot = hauteur - marge.haut - marge.bas;
      var bande = lPlot / donnees.length;
      var epaisseur = Math.min(24, bande * 0.62);
      var y = function (v) { return marge.haut + hPlot - (v / yMax) * hPlot; };

      conteneur.textContent = '';
      var svg = el('svg', { viewBox: '0 0 ' + largeur + ' ' + hauteur, width: largeur, height: hauteur, role: 'img', 'aria-label': opts.titre || 'Graphique', class: 'graphe' }, conteneur);

      // Grille et axe des valeurs
      var gGrille = el('g', { class: 'graphe-grille' }, svg);
      ticks.forEach(function (t) {
        el('line', { x1: marge.gauche, x2: largeur - marge.droite, y1: y(t), y2: y(t) }, gGrille);
        var txt = el('text', { x: marge.gauche - 10, y: y(t) + 4, 'text-anchor': 'end', class: 'graphe-axe' }, gGrille);
        txt.textContent = opts.formatAxe ? opts.formatAxe(t) : compact(t);
      });

      // Colonnes
      var gBarres = el('g', {}, svg);
      donnees.forEach(function (d, i) {
        var cx = marge.gauche + bande * i + bande / 2;
        var x0 = cx - epaisseur / 2;
        var yv = y(d.valeur);
        var h = Math.max(0, marge.haut + hPlot - yv);
        var r = Math.min(4, h, epaisseur / 2);
        var groupe = el('g', { class: 'graphe-colonne' + (d.enCours ? ' en-cours' : ''), tabindex: '0', role: 'img',
          'aria-label': d.libelle + ' : ' + (opts.format ? opts.format(d.valeur) : Format.nombre(d.valeur)) }, gBarres);
        // Zone de survol plus large que la barre
        el('rect', { x: marge.gauche + bande * i, y: marge.haut, width: bande, height: hPlot, class: 'graphe-cible' }, groupe);
        if (h > 0) {
          var base = marge.haut + hPlot;
          var dPath = 'M' + x0 + ',' + base +
            'V' + (yv + r) + 'Q' + x0 + ',' + yv + ' ' + (x0 + r) + ',' + yv +
            'H' + (x0 + epaisseur - r) + 'Q' + (x0 + epaisseur) + ',' + yv + ' ' + (x0 + epaisseur) + ',' + (yv + r) +
            'V' + base + 'Z';
          el('path', { d: dPath, class: 'graphe-barre' }, groupe);
        }
        var etiquette = el('text', { x: cx, y: hauteur - 12, 'text-anchor': 'middle', class: 'graphe-axe' + (d.enCours ? ' graphe-axe--fort' : '') }, svg);
        etiquette.textContent = d.jour || d.mois || '';

        function survol(evt) {
          var rect = groupe.getBoundingClientRect();
          var px = evt && evt.clientX ? evt.clientX : rect.left + rect.width / 2;
          var py = svg.getBoundingClientRect().top + (yv / hauteur) * svg.getBoundingClientRect().height;
          montrerInfobulle(px, py, opts.format ? opts.format(d.valeur) : Format.nombre(d.valeur), d.libelle + (d.note ? ' · ' + d.note : ''));
        }
        groupe.addEventListener('pointermove', survol);
        groupe.addEventListener('focus', survol);
        groupe.addEventListener('pointerleave', cacherInfobulle);
        groupe.addEventListener('blur', cacherInfobulle);
      });

      // Repère (ex. rythme cible)
      if (opts.seuil) {
        var ys = y(opts.seuil.valeur);
        el('line', { x1: marge.gauche, x2: largeur - marge.droite, y1: ys, y2: ys, class: 'graphe-seuil' }, svg);
        var fond = el('rect', { class: 'graphe-seuil-fond', rx: 6 }, svg);
        var lbl = el('text', { x: largeur - marge.droite - 8, y: ys - 9, 'text-anchor': 'end', class: 'graphe-seuil-texte' }, svg);
        lbl.textContent = opts.seuil.libelle;
        var bb = lbl.getBBox();
        fond.setAttribute('x', bb.x - 6); fond.setAttribute('y', bb.y - 3);
        fond.setAttribute('width', bb.width + 12); fond.setAttribute('height', bb.height + 6);
      }

      // Ligne de base
      el('line', { x1: marge.gauche, x2: largeur - marge.droite, y1: marge.haut + hPlot, y2: marge.haut + hPlot, class: 'graphe-base' }, svg);
    }

    dessiner();
    if ('ResizeObserver' in window) {
      var derniere = conteneur.clientWidth;
      var ro = new ResizeObserver(function () {
        if (Math.abs(conteneur.clientWidth - derniere) > 4) { derniere = conteneur.clientWidth; dessiner(); }
      });
      ro.observe(conteneur);
    }
  }

  /* Tableau de données (version accessible d'un graphique) */
  function tableau(donnees, colonnesDef) {
    var html = '<table class="tableau-donnees"><thead><tr>';
    colonnesDef.forEach(function (c) { html += '<th scope="col"' + (c.num ? ' class="num"' : '') + '>' + c.titre + '</th>'; });
    html += '</tr></thead><tbody>';
    donnees.forEach(function (d) {
      html += '<tr>';
      colonnesDef.forEach(function (c) { html += '<td' + (c.num ? ' class="num tab-num"' : '') + '>' + c.valeur(d) + '</td>'; });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  /* Compteur animé (chiffres clés) */
  function compter(element, cible, opts) {
    opts = opts || {};
    var duree = opts.duree || 1100;
    var format = opts.format || function (v) { return Format.nombre(v); };
    var reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduit) { element.textContent = format(cible); return; }
    var debut = null;
    function pas(t) {
      if (!debut) debut = t;
      var p = Math.min(1, (t - debut) / duree);
      var e = 1 - Math.pow(1 - p, 3);
      element.textContent = format(cible * e);
      if (p < 1) requestAnimationFrame(pas);
    }
    requestAnimationFrame(pas);
  }

  return { colonnes: colonnes, tableau: tableau, compter: compter, cacherInfobulle: cacherInfobulle };
})();
