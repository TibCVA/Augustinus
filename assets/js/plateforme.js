/* ==========================================================================
   Datako — Plateforme (prototype cliquable)
   Chaque écran est une fonction « vue… » qui renvoie du HTML.
   Les clics sont gérés par des attributs data-action (voir ACTIONS).
   ========================================================================== */

var Plateforme = (function () {
  const D = DONNEES;
  let zone, fil, personaZone;
  let routeActuelle = { page: 'accueil', sous: null };
  let minuteries = [];
  let minuterieEntree = null;

  /* ---------- État de la démonstration (en mémoire, remis à zéro au rechargement) ---------- */
  const Etat = {
    pause: false,
    factures: { etape: 1, traitement: false, envoi: false, envoye: false, filtre: 'toutes', statuts: {}, corrections: {} },
    emails: { selection: 'e1', statuts: {}, textes: {}, tons: {} },
    devis: { etat: 'saisie', transmis: false },
    synthese: { envoyee: false },
    documents: { messages: [], enCours: false },
    catalogue: { filtre: 'tous', demandes: {} },
    connecteurs: {},
    invites: [],
    seuil: 80,
    plafond: true,
    validations: { envois: true, exports: true },
    premiersPas: { decouvrir: true, factures: false, question: false, inviter: false, teams: true },
    notificationsLues: false
  };
  D.factures.forEach(f => { Etat.factures.statuts[f.id] = f.statut; });

  /* ---------- Outils ---------- */
  const planifier = (fn, ms) => { const t = setTimeout(fn, ms); minuteries.push(t); return t; };
  const annulerMinuteries = () => { minuteries.forEach(clearTimeout); minuteries = []; };
  const agent = id => D.agents.find(a => a.id === id);
  const facture = id => D.factures.find(f => f.id === id);
  const euros = v => Format.euros(v);
  const pluriel = (n, mot, motPluriel) => n + ' ' + (n > 1 ? (motPluriel || mot + 's') : mot);

  function badge(type, nomIcone, texte) {
    return `<span class="badge badge--${type}">${nomIcone ? icone(nomIcone) : ''}${esc(texte)}</span>`;
  }

  function verifierPause() {
    if (!Etat.pause) return false;
    notifier('Les agents sont en pause', 'Reprenez-les depuis le bandeau en haut de page pour lancer une tâche.', 'pause');
    return true;
  }

  function enteteAgent(id, outilsTexte) {
    const a = agent(id);
    return `
      <a class="pf-retour" href="#/app/accueil">${icone('retour', 'ic--16')}Accueil</a>
      <div class="pf-agent-entete">
        <span class="pf-agent-ic">${icone(a.icone, 'ic--28')}</span>
        <div class="pf-agent-titres">
          <h1 class="pf-h1-agent">${esc(a.nom)}</h1>
          <p>${esc(outilsTexte || a.description)}</p>
          <div class="pf-agent-outils">${a.outils.map(o => `<span class="badge">${icone('prise')}${esc(o)}</span>`).join('')}<span class="badge badge--ok">${icone('check')}Connecté</span></div>
        </div>
        <button class="btn btn--contour btn--petit pf-agent-aide" data-action="comment-ca-marche" data-agent="${id}">${icone('info')}Comment ça marche&#8239;?</button>
      </div>`;
  }

  function etapes(liste, active) {
    return `<ol class="pf-etapes" aria-label="Étapes">${liste.map((e, i) => {
      const n = i + 1;
      const etat = n < active ? 'fait' : n === active ? 'actif' : '';
      return `<li class="pf-etape ${etat}" ${n === active ? 'aria-current="step"' : ''}><span class="pf-etape-num">${n < active ? icone('check', 'ic--16') : n}</span><span>${esc(e)}</span></li>`;
    }).join('')}</ol>`;
  }

  function anneau(fait, total) {
    const r = 22, c = 2 * Math.PI * r, p = fait / total;
    return `<svg class="pf-anneau" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="${r}" class="pf-anneau-piste"/>
      <circle cx="28" cy="28" r="${r}" class="pf-anneau-valeur" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 28 28)"/>
      <text x="28" y="32" text-anchor="middle">${fait}/${total}</text></svg>`;
  }

  /* ======================================================================
     ACCUEIL
     ====================================================================== */
  function vueAccueil() {
    const p = D.personas.utilisatrice;
    const nbEmails = D.emails.filter(e => !Etat.emails.statuts[e.id]).length;
    const tuiles = [
      { id: 'factures', icone: 'facture', titre: 'Factures fournisseurs', desc: 'Lire, contrôler et préparer la saisie comptable.', action: Etat.factures.envoye ? 'Voir le bilan' : 'Traiter',
        statut: Etat.factures.envoye ? ['ok', 'check', 'Lot traité'] : ['turquoise', 'etincelle', '12 nouvelles factures'] },
      { id: 'emails', icone: 'mail', titre: 'Réponses aux e-mails clients', desc: 'Une réponse sourcée, prête à valider.', action: 'Répondre',
        statut: nbEmails ? ['turquoise', 'mail', pluriel(nbEmails, 'e-mail') + ' en attente'] : ['ok', 'check', 'Boîte à jour'] },
      { id: 'devis', icone: 'devis', titre: 'Devis & appels d’offres', desc: 'Une proposition à partir de vos devis passés.', action: 'Préparer',
        statut: Etat.devis.transmis ? ['ok', 'check', 'Transmis pour relecture'] : ['info', 'crayon', '1 demande à chiffrer'] },
      { id: 'synthese', icone: 'synthese', titre: 'Synthèse de la semaine', desc: 'L’essentiel de votre activité, en une page.', action: 'Lire',
        statut: Etat.synthese.envoyee ? ['ok', 'check', 'Envoyée à Marc'] : ['info', 'horloge', 'Prête depuis 8 h'] }
    ];
    const pp = [
      { cle: 'decouvrir', texte: 'Découvrir vos agents', lien: '#/app/agents' },
      { cle: 'factures', texte: 'Traiter votre premier lot de factures', lien: '#/app/agents/factures' },
      { cle: 'question', texte: 'Poser une question à vos documents', lien: '#/app/documents' },
      { cle: 'inviter', texte: 'Inviter un collègue', lien: '#/app/reglages/utilisateurs' },
      { cle: 'teams', texte: 'Retrouver Datako dans Teams', lien: '#/app/reglages/teams' }
    ];
    const faits = pp.filter(x => Etat.premiersPas[x.cle]).length;
    const reprendre = [
      { icone: 'devis', titre: 'Demande de devis — Commune de Saint-Aubin', detail: 'Reçue vendredi · à chiffrer avant le 23 octobre', lien: '#/app/agents/devis', fait: Etat.devis.transmis },
      { icone: 'mail', titre: 'Réclamation — Brasserie du Port', detail: 'Réponse proposée · geste commercial à faire valider', lien: '#/app/agents/emails', action: 'e2', fait: !!Etat.emails.statuts.e2 },
      { icone: 'synthese', titre: 'Synthèse de la semaine 41', detail: 'Prête · à transmettre à Marc Bastide', lien: '#/app/agents/synthese', fait: Etat.synthese.envoyee }
    ];

    return `
      <section class="pf-accueil-hero">
        <p class="pf-date">${esc(D.date.jour)}</p>
        <h1 class="titre pf-h1">Bonjour ${esc(p.prenom)}, <em>que faisons-nous aujourd’hui&#8239;?</em></h1>
        <form class="pf-demande" data-form="demande" autocomplete="off">
          <span class="pf-demande-ic">${icone('etincelle')}</span>
          <label class="sr-only" for="pf-demande-champ">Posez une question à vos documents</label>
          <input id="pf-demande-champ" name="question" placeholder="Posez une question sur un contrat, une facture, une procédure…">
          <button class="btn btn--primaire" type="submit">Demander${icone('fleche', 'ic--fleche')}</button>
        </form>
        <div class="pf-suggestions"><span>Par exemple</span>${D.questions.slice(0, 3).map((q, i) => `<button class="pf-suggestion" data-action="poser" data-question="${i}">${esc(q.question)}</button>`).join('')}</div>
      </section>

      <section class="pf-bloc" aria-labelledby="titre-agents">
        <div class="pf-bloc-entete"><h2 id="titre-agents">Vos agents</h2><a class="lien" href="#/app/agents">Tout le catalogue${icone('fleche')}</a></div>
        <div class="pf-tuiles">
          ${tuiles.map(t => `
            <a class="pf-tuile${Etat.pause ? ' est-en-pause' : ''}" href="#/app/agents/${t.id}">
              <span class="pf-tuile-haut"><span class="pf-tuile-ic">${icone(t.icone, 'ic--24')}</span>${Etat.pause ? badge('alerte', 'pause', 'En pause') : badge(t.statut[0], t.statut[1], t.statut[2])}</span>
              <strong class="pf-tuile-titre">${esc(t.titre)}</strong>
              <span class="pf-tuile-desc">${esc(t.desc)}</span>
              <span class="pf-tuile-action">${esc(t.action)}${icone('fleche', 'ic--18')}</span>
            </a>`).join('')}
        </div>
      </section>

      <div class="pf-grille-2">
        <section class="pf-carte" aria-labelledby="titre-reprendre">
          <h2 id="titre-reprendre" class="pf-carte-titre">Reprendre où vous en étiez</h2>
          <ul class="pf-reprendre">
            ${reprendre.map(r => `
              <li class="${r.fait ? 'est-fait' : ''}">
                <span class="pf-reprendre-ic">${icone(r.fait ? 'check' : r.icone, 'ic--18')}</span>
                <div><strong>${esc(r.titre)}</strong><span>${r.fait ? 'Terminé' : esc(r.detail)}</span></div>
                <a class="btn btn--contour btn--petit" href="${r.lien}" ${r.action ? `data-action="ouvrir-email" data-email="${r.action}"` : ''}>${r.fait ? 'Voir' : 'Reprendre'}</a>
              </li>`).join('')}
          </ul>
        </section>

        <section class="pf-carte pf-premiers-pas" aria-labelledby="titre-pp">
          <div class="pf-pp-entete">
            <div><h2 id="titre-pp" class="pf-carte-titre">Premiers pas</h2><p>${faits === pp.length ? 'Bravo, vous maîtrisez l’essentiel.' : pluriel(faits, 'étape franchie', 'étapes franchies') + ' sur ' + pp.length}</p></div>
            ${anneau(faits, pp.length)}
          </div>
          <ol class="pf-pp-liste">
            ${pp.map(x => `<li class="${Etat.premiersPas[x.cle] ? 'est-fait' : ''}"><a href="${x.lien}"><span class="pf-pp-coche">${Etat.premiersPas[x.cle] ? icone('check', 'ic--16') : ''}</span><span>${esc(x.texte)}</span>${icone('chevronDroite', 'ic--16')}</a></li>`).join('')}
          </ol>
        </section>
      </div>

      <section class="pf-carte pf-semaine" aria-labelledby="titre-semaine">
        <div class="pf-semaine-principal">
          <h2 id="titre-semaine" class="pf-libelle">Temps gagné la semaine dernière</h2>
          <p class="pf-semaine-valeur">13 h 05</p>
          <p class="pf-semaine-detail">${esc(D.date.semaineEcoulee)}</p>
        </div>
        <div class="pf-semaine-stats">
          <div><p class="pf-libelle">Tâches réalisées</p><p class="pf-stat">214</p></div>
          <div><p class="pf-libelle">Réponses sourcées</p><p class="pf-stat">100 %</p></div>
        </div>
        <div class="pf-semaine-graphe">
          <p class="pf-libelle">Temps gagné par jour</p>
          <div id="graphe-semaine"></div>
        </div>
      </section>`;
  }

  function apresAccueil() {
    Graphiques.colonnes(document.getElementById('graphe-semaine'), {
      titre: 'Temps gagné par jour, semaine 41',
      hauteur: 170,
      donnees: [
        { jour: 'Lun.', libelle: 'Lundi 5 octobre', valeur: 2.5 },
        { jour: 'Mar.', libelle: 'Mardi 6 octobre', valeur: 2.333 },
        { jour: 'Mer.', libelle: 'Mercredi 7 octobre', valeur: 3.083 },
        { jour: 'Jeu.', libelle: 'Jeudi 8 octobre', valeur: 2.667 },
        { jour: 'Ven.', libelle: 'Vendredi 9 octobre', valeur: 2.5 }
      ],
      format: v => Typo.corriger(Format.heures(v)),
      formatAxe: v => v + ' h'
    });
  }

  /* ======================================================================
     AGENT « FACTURES FOURNISSEURS »
     ====================================================================== */
  function compteFactures() {
    const s = Etat.factures.statuts;
    const ids = Object.keys(s);
    return {
      total: ids.length,
      verifier: ids.filter(i => s[i] === 'verifier').length,
      conformes: ids.filter(i => s[i] === 'conforme' || s[i] === 'validee').length,
      ecartees: ids.filter(i => s[i] === 'ecartee').length
    };
  }

  function montantFacture(f) {
    const c = Etat.factures.corrections[f.id];
    return c ? c : { ht: f.ht, tva: f.tva, ttc: f.ttc };
  }

  function badgeFacture(statut) {
    switch (statut) {
      case 'conforme': return badge('ok', 'check', 'Conforme');
      case 'validee': return badge('ok', 'checkCercle', 'Validée');
      case 'verifier': return badge('alerte', 'alerte', 'À vérifier');
      case 'ecartee': return badge('neutre', 'ecarter', 'Écartée');
      default: return '';
    }
  }

  function vueFactures() {
    const F = Etat.factures;
    let corps = '';
    if (F.envoye) corps = facturesSucces();
    else if (F.etape === 1) corps = F.traitement ? facturesTraitement() : facturesRecuperer();
    else if (F.etape === 2) corps = facturesVerifier();
    else corps = facturesEnvoyer();

    return `
      ${enteteAgent('factures', 'Lit vos factures, contrôle les montants et prépare la saisie dans Pennylane.')}
      ${etapes(['Récupérer', 'Vérifier', 'Envoyer'], F.envoye ? 4 : F.etape)}
      <div class="pf-carte pf-agent-zone" id="zone-factures">${corps}</div>`;
  }

  function facturesRecuperer() {
    return `
      <div class="pf-recuperer">
        <button class="pf-option" data-action="factures-lancer">
          <span class="pf-option-haut"><span class="pf-option-ic">${icone('mail', 'ic--24')}</span>${badge('turquoise', 'etincelle', 'Recommandé')}</span>
          <strong>Utiliser les 12 factures reçues par e-mail</strong>
          <span class="pf-option-detail">Boîte « Factures » · reçues depuis le 1er octobre</span>
          <span class="pf-option-cta">Lancer l’analyse${icone('fleche', 'ic--18')}</span>
        </button>
        <div class="pf-depot" data-action="factures-lancer" data-depot role="button" tabindex="0" aria-label="Déposer des factures : cliquez ou glissez vos fichiers">
          <span class="pf-depot-ic">${icone('televerser', 'ic--28')}</span>
          <strong>Glissez vos factures ici</strong>
          <span>PDF, photos ou scans · ou cliquez pour parcourir</span>
        </div>
      </div>
      <p class="pf-zone-note">${icone('cadenas', 'ic--16')}Les factures restent dans votre environnement. Rien n’est saisi dans Pennylane sans votre validation.</p>`;
  }

  function facturesTraitement() {
    return `
      <div class="pf-traitement" aria-live="polite">
        <div class="pf-traitement-entete">
          <span class="pf-chargement">${icone('chargement', 'ic--24 tourne')}</span>
          <div><strong>Datako lit et contrôle vos factures…</strong><span id="trait-compte">0 sur 12 analysées</span></div>
        </div>
        <div class="jauge-lineaire"><b id="trait-jauge" style="width:0%"></b></div>
        <ul class="pf-traitement-liste">
          ${D.factures.map(f => `
            <li id="trait-${f.id}" class="attente">
              <span class="pf-tl-ic">${icone('horloge', 'ic--16')}</span>
              <span class="pf-tl-nom">${esc(f.fournisseur)}</span>
              <span class="pf-tl-num">${esc(f.numero)}</span>
              <span class="pf-tl-phase">En attente</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  function lancerTraitementFactures() {
    const total = D.factures.length;
    let fini = 0;
    D.factures.forEach((f, i) => {
      const li = () => document.getElementById('trait-' + f.id);
      const depart = 250 + i * 290;
      planifier(() => { const l = li(); if (!l) return; l.className = 'lecture'; l.querySelector('.pf-tl-ic').innerHTML = icone('chargement', 'ic--16 tourne'); l.querySelector('.pf-tl-phase').textContent = 'Lecture…'; }, depart);
      planifier(() => { const l = li(); if (!l) return; l.querySelector('.pf-tl-phase').textContent = 'Contrôle…'; }, depart + 420);
      planifier(() => {
        const l = li(); if (!l) return;
        const ok = f.statut === 'conforme';
        l.className = ok ? 'ok' : 'alerte';
        l.querySelector('.pf-tl-ic').innerHTML = icone(ok ? 'checkCercle' : 'alerte', 'ic--16');
        l.querySelector('.pf-tl-phase').textContent = ok ? 'Conforme' : f.anomalie.type;
        fini++;
        const c = document.getElementById('trait-compte'); if (c) c.textContent = fini + ' sur ' + total + ' analysées';
        const j = document.getElementById('trait-jauge'); if (j) j.style.width = (fini / total * 100) + '%';
        if (fini === total) planifier(() => { Etat.factures.traitement = false; Etat.factures.etape = 2; rendre(); }, 900);
      }, depart + 820);
    });
  }

  function facturesVerifier() {
    const c = compteFactures();
    const filtre = Etat.factures.filtre;
    const liste = D.factures.filter(f => {
      const s = Etat.factures.statuts[f.id];
      if (filtre === 'verifier') return s === 'verifier';
      if (filtre === 'conformes') return s === 'conforme' || s === 'validee';
      return true;
    });
    const totalTtc = D.factures.filter(f => Etat.factures.statuts[f.id] !== 'ecartee').reduce((s, f) => s + montantFacture(f).ttc, 0);

    return `
      <div class="pf-resume">
        <span class="pf-resume-ic ${c.verifier ? 'alerte' : ''}">${icone(c.verifier ? 'alerte' : 'checkCercle', 'ic--24')}</span>
        <div class="pf-resume-texte">
          <strong>12 factures analysées en 38 secondes</strong>
          <p>${c.verifier ? `${pluriel(c.conformes, 'facture conforme', 'factures conformes')} · <b>${pluriel(c.verifier, 'facture à vérifier', 'factures à vérifier')}</b> avant l’envoi` : 'Tout est vérifié : vous pouvez passer à l’envoi.'}</p>
        </div>
        <div class="pf-resume-chiffre"><span>Total TTC retenu</span><strong>${euros(totalTtc)}</strong></div>
      </div>

      <div class="pf-filtres" role="group" aria-label="Filtrer les factures">
        ${[['toutes', 'Toutes', c.total], ['verifier', 'À vérifier', c.verifier], ['conformes', 'Conformes et validées', c.conformes]].map(([v, l, n]) =>
          `<button class="pf-filtre" aria-pressed="${filtre === v}" data-action="factures-filtre" data-filtre="${v}">${l}<span>${n}</span></button>`).join('')}
      </div>

      <div class="pf-table-zone">
        <table class="pf-table">
          <caption class="sr-only">Factures analysées</caption>
          <thead><tr><th scope="col">Fournisseur</th><th scope="col">N° de facture</th><th scope="col">Date</th><th scope="col" class="num">Montant TTC</th><th scope="col" class="pf-col-compte">Imputation proposée</th><th scope="col">Statut</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
          <tbody>
            ${liste.length ? liste.map(f => {
              const s = Etat.factures.statuts[f.id];
              const m = montantFacture(f);
              return `<tr class="${s === 'verifier' ? 'est-alerte' : ''}${s === 'ecartee' ? ' est-ecartee' : ''}">
                <td><button class="pf-table-lien" data-action="facture-detail" data-id="${f.id}">${esc(f.fournisseur)}</button></td>
                <td class="tab-num">${esc(f.numero)}</td>
                <td class="tab-num">${esc(f.date)}</td>
                <td class="num tab-num">${euros(m.ttc)}</td>
                <td class="pf-col-compte">${esc(f.compte)}</td>
                <td>${badgeFacture(s)}</td>
                <td class="num"><button class="btn btn--${s === 'verifier' ? 'sombre' : 'fantome'} btn--petit" data-action="facture-detail" data-id="${f.id}">${s === 'verifier' ? 'Vérifier' : 'Voir'}</button></td>
              </tr>`;
            }).join('') : `<tr><td colspan="7" class="pf-table-vide">${icone('checkCercle')}Aucune facture dans cette catégorie.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="pf-agent-pied">
        <p>${c.verifier ? `${icone('info', 'ic--16')}Les factures à vérifier resteront en attente si vous continuez.` : `${icone('checkCercle', 'ic--16')}Toutes les factures sont prêtes.`}</p>
        <button class="btn btn--primaire" data-action="factures-etape" data-etape="3">Continuer vers l’envoi${icone('fleche', 'ic--fleche')}</button>
      </div>`;
  }

  function ouvrirDetailFacture(id) {
    const f = facture(id);
    const s = Etat.factures.statuts[id];
    const m = montantFacture(f);
    const corrige = !!Etat.factures.corrections[id];
    const lignes = f.lignes.map((l, i) => {
      const pu = (corrige && f.id === 'f1' && i === 1) ? 7.5 : l.pu;
      const surligne = f.id === 'f1' && i === 1 && !corrige ? ' class="surligne"' : '';
      return `<tr${surligne}><td>${esc(l.libelle)}</td><td class="num">${l.qte}</td><td class="num">${euros(pu)}</td><td class="num">${euros(pu * l.qte)}</td></tr>`;
    }).join('');

    let actions = '';
    if (s === 'verifier' && f.id === 'f1') {
      actions = `<button class="btn btn--contour" data-action="facture-decider" data-id="${id}" data-decision="ecartee">${icone('ecarter')}Écarter</button>
        <button class="btn btn--primaire" data-action="facture-decider" data-id="${id}" data-decision="corriger">${icone('check')}Appliquer le prix du bon de commande</button>`;
    } else if (s === 'verifier') {
      actions = `<button class="btn btn--contour" data-action="facture-decider" data-id="${id}" data-decision="validee">Valider quand même</button>
        <button class="btn btn--primaire" data-action="facture-decider" data-id="${id}" data-decision="ecartee">${icone('ecarter')}Écarter le doublon</button>`;
    } else if (s === 'ecartee') {
      actions = `<button class="btn btn--contour" data-action="facture-decider" data-id="${id}" data-decision="retablir">Rétablir la facture</button>`;
    } else {
      actions = `<button class="btn btn--sombre" data-fermer-modale>Fermer</button>`;
    }

    const html = `
      <p class="surtitre">Facture fournisseur</p>
      <h2 id="modale-titre" style="margin-top:10px">${esc(f.fournisseur)} <em>· ${esc(f.numero)}</em></h2>
      <div class="pf-facture">
        <div class="pf-facture-doc" aria-label="Aperçu de la facture">
          <div class="pf-doc-entete"><div><strong>${esc(f.fournisseur)}</strong><span>${esc(f.adresse)}</span></div><span class="pf-doc-type">FACTURE</span></div>
          <div class="pf-doc-meta"><span>N° ${esc(f.numero)}</span><span>Date : ${esc(f.date)}</span><span>Échéance : ${esc(f.echeance)}</span></div>
          <div class="pf-doc-client"><span>Facturé à</span><strong>${esc(D.entreprise.nom)}</strong><span>18 rue des Artisans, 69007 Lyon</span></div>
          <table class="pf-doc-lignes"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">P.U. HT</th><th class="num">Total HT</th></tr></thead><tbody>${lignes}</tbody></table>
          <div class="pf-doc-totaux"><span>Total HT</span><span>${euros(m.ht)}</span><span>TVA 20 %</span><span>${euros(m.tva)}</span><strong>Total TTC</strong><strong>${euros(m.ttc)}</strong></div>
        </div>
        <div class="pf-facture-infos">
          ${f.anomalie && s === 'verifier' ? `<div class="pf-anomalie" role="alert"><strong>${icone('alerte', 'ic--18')}${esc(f.anomalie.type)}</strong><p>${esc(f.anomalie.texte)}</p><span>${esc(f.anomalie.ecart)}</span></div>` : ''}
          ${corrige ? `<div class="pf-anomalie pf-anomalie--ok"><strong>${icone('checkCercle', 'ic--18')}Corrigée selon le bon de commande BC-2291</strong><p>Un e-mail signalant l’écart à Fournitures Rhône est préparé dans vos brouillons.</p></div>` : ''}
          <dl class="pf-champs">
            <div><dt>Montant HT</dt><dd class="tab-num">${euros(m.ht)}</dd></div>
            <div><dt>TVA</dt><dd class="tab-num">${euros(m.tva)}</dd></div>
            <div><dt>Montant TTC</dt><dd class="tab-num"><strong>${euros(m.ttc)}</strong></dd></div>
            <div><dt>Échéance</dt><dd>${esc(f.echeance)}</dd></div>
            <div class="pf-champ-large"><dt>Imputation proposée</dt><dd>${esc(f.compte)} ${badge('turquoise', 'etincelle', 'Proposée par Datako')}</dd></div>
          </dl>
          <p class="pf-source-note">${icone('source', 'ic--16')}Lu dans la facture PDF reçue le ${esc(f.date)} · ${f.id === 'f1' ? 'comparée au bon de commande BC-2291' : f.id === 'f7' ? 'comparée à l’historique Pennylane' : 'contrôlée avec vos bons de commande'}</p>
          <div class="modale-actions">${actions}</div>
        </div>
      </div>`;
    Modale.ouvrir(html, { large: true });
  }

  function facturesEnvoyer() {
    const c = compteFactures();
    const pretes = D.factures.filter(f => ['conforme', 'validee'].includes(Etat.factures.statuts[f.id]));
    const totalTtc = pretes.reduce((s, f) => s + montantFacture(f).ttc, 0);
    return `
      <div class="pf-envoi">
        <h2 class="pf-zone-titre">Prêt à envoyer vers Pennylane</h2>
        <div class="pf-envoi-chiffres">
          <div><span>Factures prêtes</span><strong>${pretes.length}</strong></div>
          <div><span>Total TTC</span><strong>${euros(totalTtc)}</strong></div>
          <div><span>Écartées</span><strong>${c.ecartees}</strong></div>
          <div class="${c.verifier ? 'alerte' : ''}"><span>En attente de vérification</span><strong>${c.verifier}</strong></div>
        </div>
        <fieldset class="pf-options-envoi">
          <legend class="sr-only">Options d’envoi</legend>
          <label class="pf-case"><input type="checkbox" checked><span class="pf-case-boite">${icone('check', 'ic--16')}</span><span>Classer les originaux dans <b>Google Drive › Comptabilité › Octobre 2026</b></span></label>
          <label class="pf-case"><input type="checkbox" checked><span class="pf-case-boite">${icone('check', 'ic--16')}</span><span>M’envoyer un récapitulatif par e-mail</span></label>
        </fieldset>
        <div class="pf-validation-humaine">${icone('validation', 'ic--24')}<p><strong>Rien ne part sans vous.</strong> Les écritures sont créées dans Pennylane uniquement après votre clic sur « Envoyer ».</p></div>
      </div>
      <div class="pf-agent-pied">
        <button class="btn btn--fantome" data-action="factures-etape" data-etape="2">${icone('retour')}Retour à la vérification</button>
        <button class="btn btn--primaire" data-action="factures-envoyer" ${pretes.length ? '' : 'disabled'}>${Etat.factures.envoi ? icone('chargement', 'tourne') + 'Envoi en cours…' : icone('envoyer') + 'Envoyer ' + pluriel(pretes.length, 'facture') + ' vers Pennylane'}</button>
      </div>`;
  }

  function facturesSucces() {
    const pretes = D.factures.filter(f => ['conforme', 'validee'].includes(Etat.factures.statuts[f.id])).length;
    const doublonEvite = Etat.factures.statuts.f7 === 'ecartee';
    const corrige = !!Etat.factures.corrections.f1;
    return `
      <div class="pf-succes">
        <span class="pf-succes-ic">${icone('check', 'ic--28')}</span>
        <h2>${pluriel(pretes, 'facture envoyée', 'factures envoyées')} dans Pennylane</h2>
        <p>Les écritures sont prêtes à être comptabilisées et les originaux sont classés dans Google Drive.</p>
        <div class="pf-succes-chiffres">
          <div><strong>54 min</strong><span>gagnées sur ce lot</span></div>
          <div>${doublonEvite ? '<strong>2 616 €</strong><span>de double paiement évité</span>' : '<strong>12</strong><span>factures contrôlées</span>'}</div>
          <div>${corrige ? '<strong>36 €</strong><span>d’écart récupéré auprès de Fournitures Rhône</span>' : '<strong>2</strong><span>anomalies signalées</span>'}</div>
        </div>
        <div class="pf-succes-actions">
          <a class="btn btn--sombre" href="#/app/accueil">Retour à l’accueil</a>
          <button class="btn btn--contour" data-action="factures-recommencer">${icone('regenerer')}Rejouer la démonstration</button>
        </div>
      </div>`;
  }

  /* ======================================================================
     AGENT « RÉPONSES AUX E-MAILS CLIENTS »
     ====================================================================== */
  function vueEmails() {
    const E = Etat.emails;
    const sel = D.emails.find(e => e.id === E.selection) || D.emails[0];
    const enAttente = D.emails.filter(e => !E.statuts[e.id]).length;
    return `
      ${enteteAgent('emails', 'Propose une réponse sourcée à chaque e-mail de la boîte contact@. Vous relisez, ajustez et envoyez.')}
      <div class="pf-boite">
        <section class="pf-carte pf-boite-liste" aria-label="E-mails reçus">
          <div class="pf-boite-entete"><h2 class="pf-carte-titre">Boîte contact@</h2>${enAttente ? badge('turquoise', '', enAttente + ' en attente') : badge('ok', 'check', 'À jour')}</div>
          <ul>
            ${D.emails.map(e => {
              const st = E.statuts[e.id];
              return `<li><button class="pf-mail-item${e.id === sel.id ? ' actif' : ''}${st ? ' est-traite' : ''}" data-action="ouvrir-email" data-email="${e.id}" aria-current="${e.id === sel.id}">
                <span class="avatar">${esc(e.expediteur.split(' ').map(x => x[0]).join(''))}</span>
                <span class="pf-mail-item-texte">
                  <span class="pf-mail-item-ligne"><strong>${esc(e.societe)}</strong><span class="pf-mail-heure">${esc(e.heure)}</span></span>
                  <span class="pf-mail-sujet">${esc(e.sujet)}</span>
                  <span class="pf-mail-item-ligne">${st === 'repondu' ? badge('ok', 'check', 'Répondu') : st === 'validation' ? badge('info', 'validation', 'En validation') : st === 'ignore' ? badge('neutre', '', 'Ignoré') : badge(e.validation ? 'alerte' : 'turquoise', e.validation ? 'validation' : 'etincelle', e.validation ? 'Validation requise' : 'Réponse prête')}<span class="pf-mail-categorie">${esc(e.categorie)}</span></span>
                </span>
              </button></li>`;
            }).join('')}
          </ul>
        </section>
        <section class="pf-carte pf-mail" id="pf-mail" aria-label="E-mail sélectionné">${detailEmail(sel)}</section>
      </div>`;
  }

  function detailEmail(e) {
    const E = Etat.emails;
    const st = E.statuts[e.id];
    const ton = E.tons[e.id] || 'formel';
    const texte = E.textes[e.id] !== undefined ? E.textes[e.id] : (ton === 'formel' ? e.reponse : e.variante);
    const entete = `
      <div class="pf-mail-entete">
        <div><h2>${esc(e.sujet)}</h2><p>De <strong>${esc(e.expediteur)}</strong> · ${esc(e.societe)} · ${esc(e.heure)}</p></div>
        <span class="badge">${esc(e.categorie)}</span>
      </div>
      <div class="pf-mail-message">${esc(e.message)}</div>`;

    if (st) {
      const libelles = {
        repondu: [icone('checkCercle', 'ic--24'), 'Réponse envoyée', 'Envoyée depuis la boîte contact@ et classée dans l’historique du client.'],
        validation: [icone('validation', 'ic--24'), 'En attente de validation', 'Marc Bastide a reçu la réponse et le geste commercial à valider. Elle partira dès son accord.'],
        ignore: [icone('ecarter', 'ic--24'), 'E-mail ignoré', 'Aucune réponse ne sera envoyée. Vous pouvez revenir sur ce choix.']
      }[st];
      return entete + `
        <div class="pf-mail-etat ${st}">
          ${libelles[0]}<div><strong>${libelles[1]}</strong><p>${libelles[2]}</p></div>
          ${st === 'ignore' ? `<button class="btn btn--contour btn--petit" data-action="email-annuler" data-email="${e.id}">Rétablir</button>` : ''}
        </div>
        ${st !== 'ignore' ? `<div class="pf-mail-envoye"><p class="pf-libelle">Votre réponse</p><div class="pf-mail-message">${esc(texte)}</div></div>` : ''}`;
    }

    return entete + `
      <div class="pf-mail-reponse">
        <div class="pf-mail-reponse-entete">
          ${badge('turquoise', 'etincelle', 'Réponse proposée par Datako')}
          <div class="pf-segment" role="group" aria-label="Ton de la réponse">
            <button aria-pressed="${ton === 'formel'}" data-action="email-ton" data-ton="formel" data-email="${e.id}">Formel</button>
            <button aria-pressed="${ton === 'chaleureux'}" data-action="email-ton" data-ton="chaleureux" data-email="${e.id}">Chaleureux</button>
          </div>
        </div>
        ${e.validation ? `<div class="pf-anomalie">${icone('validation', 'ic--18')}<p>${esc(e.validation)}</p></div>` : ''}
        <label class="sr-only" for="pf-mail-texte">Texte de la réponse</label>
        <textarea class="saisie pf-mail-texte" id="pf-mail-texte" data-email="${e.id}" rows="10">${esc(texte)}</textarea>
        <div class="pf-mail-sources"><span>${icone('source', 'ic--16')}Sources utilisées</span>${e.sources.map(s => `<span class="badge">${esc(s)}</span>`).join('')}</div>
        <div class="pf-mail-actions">
          <button class="btn btn--fantome btn--petit" data-action="email-ignorer" data-email="${e.id}">Ignorer</button>
          <button class="btn btn--contour btn--petit" data-action="email-regenerer" data-email="${e.id}">${icone('regenerer')}Proposer une autre version</button>
          ${e.validation
            ? `<button class="btn btn--sombre" data-action="email-valider" data-email="${e.id}">${icone('validation')}Soumettre à Marc</button>`
            : `<button class="btn btn--primaire" data-action="email-envoyer" data-email="${e.id}">${icone('envoyer')}Envoyer</button>`}
        </div>
      </div>`;
  }

  function emailSuivant(idCourant) {
    const suivant = D.emails.find(e => !Etat.emails.statuts[e.id] && e.id !== idCourant);
    if (suivant) Etat.emails.selection = suivant.id;
  }

  /* ======================================================================
     AGENT « DEVIS & APPELS D'OFFRES »
     ====================================================================== */
  function vueDevis() {
    const V = Etat.devis;
    let corps;
    if (V.etat === 'saisie') corps = devisSaisie();
    else if (V.etat === 'calcul') corps = devisCalcul();
    else corps = devisResultat();
    return `${enteteAgent('devis', 'Prépare une proposition commerciale à partir de vos devis passés, de votre catalogue et des conditions du client.')}${corps}`;
  }

  function devisSaisie() {
    const d = D.devis;
    const client = Etat.devis.client || d.clients[0];
    return `
      <div class="pf-devis-grille">
        <form class="pf-carte pf-devis-form" data-form="devis">
          <h2 class="pf-zone-titre">Nouvelle demande</h2>
          <div class="champ"><label for="dv-client">Client</label><select class="saisie" id="dv-client">${d.clients.map(c => `<option${c === client ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="champ"><label for="dv-besoin">Ce qu’il faut chiffrer</label><textarea class="saisie" id="dv-besoin" rows="4">${esc(Etat.devis.besoin || d.besoin)}</textarea></div>
          <div class="champ"><label for="dv-date">Date de remise souhaitée</label><input class="saisie" id="dv-date" value="Vendredi 23 octobre 2026"></div>
          <fieldset class="champ">
            <legend class="champ-libelle">Datako s’appuiera sur</legend>
            <div class="pf-appuis">
              ${d.appuis.map((a, i) => `<label class="pf-case"><input type="checkbox" ${a.coche ? 'checked' : ''} id="dv-appui-${i}"><span class="pf-case-boite">${icone('check', 'ic--16')}</span><span>${esc(a.libelle)} <em>${esc(a.detail)}</em></span></label>`).join('')}
            </div>
          </fieldset>
          <button class="btn btn--primaire btn--grand" type="submit">${icone('etincelle')}Préparer le devis</button>
        </form>
        <aside class="pf-carte pf-devis-aide">
          <h2 class="pf-zone-titre">Comment l’agent travaille</h2>
          <ol class="pf-methode">
            <li><span>${icone('recherche', 'ic--18')}</span><div><strong>Il retrouve vos devis comparables</strong><p>Mêmes équipements, même type de client, mêmes contraintes.</p></div></li>
            <li><span>${icone('base', 'ic--18')}</span><div><strong>Il chiffre avec vos références</strong><p>Catalogue 2026, remises habituelles, délais fournisseurs.</p></div></li>
            <li><span>${icone('devis', 'ic--18')}</span><div><strong>Il rédige une proposition prête à relire</strong><p>Au format de vos devis, avec les points à vérifier.</p></div></li>
          </ol>
          <p class="pf-devis-note">${icone('validation', 'ic--16')}Vous relisez et ajustez toujours avant l’envoi au client.</p>
        </aside>
      </div>`;
  }

  function devisCalcul() {
    const etapesCalcul = ['Recherche de devis comparables', 'Chiffrage à partir du catalogue 2026', 'Vérification des délais fournisseurs', 'Rédaction de la proposition'];
    return `
      <div class="pf-carte pf-calcul" aria-live="polite">
        <span class="pf-chargement pf-chargement--grand">${icone('chargement', 'ic--28 tourne')}</span>
        <h2>Datako prépare votre devis…</h2>
        <ul class="pf-calcul-etapes">${etapesCalcul.map((e, i) => `<li id="calc-${i}">${icone('horloge', 'ic--16')}<span>${esc(e)}</span><em></em></li>`).join('')}</ul>
      </div>`;
  }

  function lancerCalculDevis() {
    const details = ['3 devis trouvés', '5 lignes chiffrées', '1 délai à confirmer', 'Proposition prête'];
    [0, 1, 2, 3].forEach(i => {
      planifier(() => { const li = document.getElementById('calc-' + i); if (li) { li.className = 'en-cours'; li.querySelector('svg').outerHTML = icone('chargement', 'ic--16 tourne'); } }, 300 + i * 850);
      planifier(() => {
        const li = document.getElementById('calc-' + i); if (!li) return;
        li.className = 'fait'; li.querySelector('svg').outerHTML = icone('checkCercle', 'ic--16');
        li.querySelector('em').textContent = details[i];
        if (i === 3) planifier(() => { Etat.devis.etat = 'pret'; rendre(); }, 700);
      }, 300 + i * 850 + 650);
    });
  }

  function devisResultat() {
    const d = D.devis;
    const totalHt = d.lignes.reduce((s, l) => s + l.qte * l.pu, 0);
    const remise = Math.round(totalHt * d.remise * 100) / 100;
    const net = totalHt - remise;
    const tva = Math.round(net * 0.2 * 100) / 100;
    return `
      <div class="pf-devis-resultat">
        <article class="pf-doc" aria-label="Proposition commerciale">
          <header class="pf-doc-devis-entete">
            <div><span class="pf-doc-marque">${esc(D.entreprise.nom)}</span><span>${esc(D.entreprise.activite)} · ${esc(D.entreprise.ville)}</span></div>
            <div class="pf-doc-ref"><strong>Proposition commerciale</strong><span>${esc(d.reference)} · 12 octobre 2026</span></div>
          </header>
          <div class="pf-doc-bloc"><span>Client</span><strong>${esc(Etat.devis.client || d.clients[0])}</strong></div>
          <div class="pf-doc-bloc"><span>Objet</span><p>${esc(Etat.devis.besoin || d.besoin)}</p></div>
          <table class="pf-doc-lignes">
            <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">P.U. HT</th><th class="num">Total HT</th></tr></thead>
            <tbody>${d.lignes.map(l => `<tr><td>${esc(l.libelle)}</td><td class="num">${l.qte}</td><td class="num">${euros(l.pu)}</td><td class="num">${euros(l.qte * l.pu)}</td></tr>`).join('')}</tbody>
          </table>
          <div class="pf-doc-totaux">
            <span>Total HT</span><span>${euros(totalHt)}</span>
            <span>Remise client (8 %)</span><span>− ${euros(remise)}</span>
            <span>Total HT net</span><span>${euros(net)}</span>
            <span>TVA 20 %</span><span>${euros(tva)}</span>
            <strong>Total TTC</strong><strong>${euros(net + tva)}</strong>
          </div>
          <p class="pf-doc-conditions">Validité de l’offre : 30 jours · Délai de livraison : 6 semaines à compter de la commande · Paiement à 30 jours.</p>
        </article>
        <aside class="pf-devis-cote">
          <section class="pf-carte">
            <h2 class="pf-carte-titre">${icone('alerte', 'ic--18')}Points à vérifier</h2>
            <ul class="pf-liste-alerte">${d.attention.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
          </section>
          <section class="pf-carte">
            <h2 class="pf-carte-titre">${icone('source', 'ic--18')}Sources utilisées</h2>
            <ul class="pf-liste-sources">${d.sources.map(s => `<li>${icone('documents', 'ic--16')}${esc(s)}</li>`).join('')}</ul>
          </section>
          <div class="pf-devis-actions">
            ${Etat.devis.transmis
              ? `<div class="pf-mail-etat repondu">${icone('checkCercle', 'ic--24')}<div><strong>Transmis à Marc Bastide</strong><p>Pour relecture avant l’envoi au client.</p></div></div>`
              : `<button class="btn btn--primaire btn--bloc" data-action="devis-transmettre">${icone('validation')}Envoyer à Marc pour relecture</button>`}
            <button class="btn btn--contour btn--bloc" data-action="devis-telecharger">${icone('telecharger')}Télécharger au format Word</button>
            <button class="btn btn--fantome btn--bloc" data-action="devis-modifier">${icone('crayon')}Modifier la demande</button>
          </div>
        </aside>
      </div>`;
  }

  /* ======================================================================
     AGENT « SYNTHÈSE DE LA SEMAINE »
     ====================================================================== */
  function vueSynthese() {
    const s = D.synthese;
    return `
      ${enteteAgent('synthese', 'Chaque lundi à 8 h, l’essentiel de votre activité en une page, à partir de vos outils.')}
      <div class="pf-synth-barre">
        <p>${icone('horloge', 'ic--16')}Préparée automatiquement ce matin à 8 h 00 · <strong>${esc(D.date.semaineEcoulee)}</strong></p>
        <div class="pf-synth-actions">
          <button class="btn btn--contour btn--petit" data-action="synthese-pdf">${icone('telecharger')}Exporter en PDF</button>
          ${Etat.synthese.envoyee ? badge('ok', 'check', 'Envoyée à Marc') : `<button class="btn btn--primaire btn--petit" data-action="synthese-envoyer">${icone('envoyer')}Envoyer à Marc</button>`}
        </div>
      </div>
      <div class="pf-indicateurs">
        ${s.indicateurs.map(i => `
          <div class="pf-carte pf-indicateur">
            <p class="pf-libelle">${esc(i.libelle)}</p>
            <p class="pf-indicateur-valeur">${esc(i.valeur)}</p>
            <p class="pf-indicateur-evol ${i.sens}">${icone(i.sens === 'hausse' ? 'tendance' : i.sens === 'alerte' ? 'alerte' : 'chevronBas', 'ic--16')}${esc(i.evolution)}</p>
          </div>`).join('')}
      </div>
      <div class="pf-grille-2">
        <section class="pf-carte">
          <h2 class="pf-carte-titre">Ce qu’il faut retenir</h2>
          <ol class="pf-liste-num">${s.retenir.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
        </section>
        <section class="pf-carte">
          <h2 class="pf-carte-titre">Points d’attention</h2>
          <ul class="pf-liste-alerte">${s.attention.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        </section>
      </div>
      <section class="pf-carte">
        <h2 class="pf-carte-titre">Votre semaine</h2>
        <ul class="pf-agenda">${s.agenda.map(a => `<li><span class="pf-agenda-jour">${esc(a.jour)}</span><span>${esc(a.texte)}</span></li>`).join('')}</ul>
      </section>
      <p class="pf-sources-ligne">${icone('source', 'ic--16')}Sources : ${s.sources.map(x => `<span class="badge">${esc(x)}</span>`).join('')}</p>`;
  }

  /* ======================================================================
     INTERROGER MES DOCUMENTS
     ====================================================================== */
  function vueDocuments() {
    const M = Etat.documents.messages;
    return `
      ${M.length ? '<h1 class="sr-only">Interroger mes documents</h1>' : ''}
      <div class="pf-docs">
        <aside class="pf-carte pf-docs-sources" aria-labelledby="titre-sources">
          <h2 id="titre-sources" class="pf-carte-titre">Sources connectées</h2>
          <ul>${D.sourcesDocumentaires.map(s => `<li><span class="pf-docs-ic">${icone(s.icone, 'ic--18')}</span><div><strong>${esc(s.nom)}</strong><span>${esc(s.detail)}</span><span>${esc(s.volume)}</span></div><span class="puce-statut" role="img" aria-label="Connectée"></span></li>`).join('')}</ul>
          <p class="pf-docs-note">${icone('cadenas', 'ic--16')}Datako ne consulte que les sources autorisées pour votre profil.</p>
        </aside>
        <section class="pf-carte pf-chat" aria-label="Conversation">
          <div class="pf-chat-fil" id="pf-chat-fil">
            ${M.length ? M.map(rendreMessage).join('') : accueilChat()}
          </div>
          <form class="pf-chat-saisie" data-form="chat" autocomplete="off">
            <label class="sr-only" for="pf-chat-champ">Votre question</label>
            <textarea id="pf-chat-champ" rows="1" placeholder="Posez votre question…"></textarea>
            <button class="btn btn--primaire pf-chat-envoyer" type="submit" aria-label="Envoyer la question">${icone('envoyer')}</button>
          </form>
          <p class="pf-chat-note">Datako cite toujours ses sources. Faute de source fiable, il vous le dit plutôt que d’inventer.</p>
        </section>
      </div>`;
  }

  function accueilChat() {
    return `
      <div class="pf-chat-accueil">
        <span class="pf-chat-accueil-ic">${icone('etincelle', 'ic--28')}</span>
        <h1 class="titre pf-h1">Interrogez vos documents, <em>en langage courant.</em></h1>
        <p>Contrats, factures, procédures, e-mails : Datako cherche pour vous et vous répond en citant ses sources.</p>
        <div class="pf-chat-suggestions">
          ${D.questions.map((q, i) => `<button class="pf-chat-suggestion" data-action="poser" data-question="${i}">${icone('conversation', 'ic--18')}<span>${esc(q.question)}</span></button>`).join('')}
        </div>
      </div>`;
  }

  function rendreMessage(m, index) {
    if (m.role === 'moi') {
      return `<div class="pf-msg pf-msg--moi"><p>${esc(m.texte)}</p></div>`;
    }
    if (m.role === 'reflexion') {
      return `<div class="pf-msg pf-msg--datako" id="pf-reflexion"><span class="pf-msg-avatar"><span class="logo-picto"></span></span><div class="pf-msg-corps"><div class="pf-reflexion"><span class="pf-points"><i></i><i></i><i></i></span><span id="pf-reflexion-texte">${esc(m.texte)}</span></div></div></div>`;
    }
    const q = m.question;
    const sources = q ? q.sources : [];
    return `
      <div class="pf-msg pf-msg--datako${m.anime ? ' anime' : ''}" data-message="${index}">
        <span class="pf-msg-avatar"><span class="logo-picto"></span></span>
        <div class="pf-msg-corps">
          <div class="pf-msg-texte">${q ? miseEnForme(q.reponse) : miseEnForme(m.texte)}</div>
          ${sources.length ? `<div class="pf-msg-sources">
            ${sources.map((s, i) => `<div class="pf-source" id="src-${index}-${i + 1}"><span class="pf-source-num">${i + 1}</span><div><strong>${esc(s.titre)}</strong><span class="pf-source-chemin">${esc(s.chemin)}</span><p>${esc(s.extrait)}</p></div></div>`).join('')}
          </div>` : ''}
          ${m.suggestions ? `<div class="pf-msg-relances">${D.questions.slice(0, 3).map((x, i) => `<button class="pf-suggestion" data-action="poser" data-question="${i}">${esc(x.question)}</button>`).join('')}</div>` : ''}
          <div class="pf-msg-outils">
            <button class="btn btn--fantome btn--petit" data-action="copier-reponse" data-message="${index}">${icone('copier', 'ic--16')}Copier</button>
            ${q && q.question.indexOf('impayées') > -1 ? `<a class="btn btn--fantome btn--petit" href="#/app/agents" data-action="filtrer-catalogue" data-filtre="finance">${icone('grille', 'ic--16')}Voir l’agent Relances clients</a>` : ''}
          </div>
        </div>
      </div>`;
  }

  function trouverQuestion(texte) {
    const t = texte.toLowerCase();
    return D.questions.find(q => q.question.toLowerCase() === t) ||
      D.questions.find(q => q.motsCles.some(m => t.indexOf(m) > -1)) || null;
  }

  function poserQuestion(texte) {
    texte = (texte || '').trim();
    if (!texte || Etat.documents.enCours) return;
    if (verifierPause()) return;
    const M = Etat.documents.messages;
    M.push({ role: 'moi', texte: texte });
    // Question posée depuis l'accueil : la réponse se construit sur l'écran « documents »
    if (routeActuelle.page !== 'documents') { location.hash = '#/app/documents'; return; }
    const q = trouverQuestion(texte);
    Etat.documents.enCours = true;
    Etat.premiersPas.question = true;
    const reponse = q ? { role: 'datako', question: q } : reponseSansSource();
    // Un message « réflexion » occupe la place de la réponse : si l'on quitte l'écran, la réponse sera là au retour.
    M.push({ role: 'reflexion', texte: 'Recherche dans vos 4 sources…' });
    rendre();
    planifier(() => {
      const t = document.getElementById('pf-reflexion-texte');
      if (t) t.textContent = q ? pluriel(q.sources.length + 1, 'passage pertinent trouvé', 'passages pertinents trouvés') + '…' : 'Aucun passage suffisamment fiable…';
    }, 700);
    planifier(() => finaliserReponse(reponse), 1500);
  }

  function reponseSansSource() {
    return {
      role: 'datako',
      texte: 'Je ne trouve pas d’information fiable sur ce point dans vos documents connectés. Plutôt que de risquer une réponse approximative, je vous propose de reformuler votre question, ou d’essayer l’une de celles-ci.\n\n(Démonstration : les réponses sont scénarisées.)',
      suggestions: true
    };
  }

  function finaliserReponse(reponse) {
    const M = Etat.documents.messages;
    const i = M.findIndex(m => m.role === 'reflexion');
    if (i > -1) M.splice(i, 1, Object.assign({ anime: true }, reponse));
    Etat.documents.enCours = false;
    if (routeActuelle.page !== 'documents') return;
    rendre();
    const fil = document.getElementById('pf-chat-fil');
    const dernier = fil && fil.querySelector('.pf-msg--datako:last-child');
    if (dernier) {
      fil.scrollTop = dernier.offsetTop - 16;
      planifier(() => { M.forEach(m => { m.anime = false; }); }, 50);
    }
    const champ = document.getElementById('pf-chat-champ');
    if (champ) champ.focus({ preventScroll: true });
  }

  /* ======================================================================
     CATALOGUE D'AGENTS
     ====================================================================== */
  function vueCatalogue() {
    Etat.premiersPas.decouvrir = true;
    const f = Etat.catalogue.filtre;
    const correspond = a => f === 'tous' || a.metier === f;
    const actifs = D.agents.filter(a => a.statut === 'actif' && correspond(a));
    const autres = D.agents.filter(a => a.statut !== 'actif' && correspond(a));
    return `
      <div class="pf-page-entete">
        <div>
          <p class="pf-surtitre">Catalogue</p>
          <h1 class="titre pf-h1">Des agents <em>pour chaque métier.</em></h1>
          <p class="pf-page-chapo">Vos agents actifs, et ceux que votre conseillère peut configurer pour vous.</p>
        </div>
        <button class="btn btn--sombre" data-action="agent-sur-mesure">${icone('plus')}Demander un agent sur mesure</button>
      </div>
      <div class="pf-filtres" role="group" aria-label="Filtrer par métier">
        <button class="pf-filtre" aria-pressed="${f === 'tous'}" data-action="filtrer-catalogue" data-filtre="tous">Tous les métiers</button>
        ${D.metiers.map(m => `<button class="pf-filtre" aria-pressed="${f === m.id}" data-action="filtrer-catalogue" data-filtre="${m.id}">${icone(m.icone, 'ic--16')}${esc(m.nom)}</button>`).join('')}
      </div>
      ${actifs.length ? `<section class="pf-bloc"><div class="pf-bloc-entete"><h2>Dans votre espace <span class="pf-compte">${actifs.length}</span></h2></div><div class="pf-catalogue pf-catalogue--actifs">${actifs.map(carteAgent).join('')}</div></section>` : ''}
      ${autres.length ? `<section class="pf-bloc"><div class="pf-bloc-entete"><h2>Disponibles pour vous <span class="pf-compte">${autres.length}</span></h2></div><div class="pf-catalogue">${autres.map(carteAgent).join('')}</div></section>` : ''}`;
  }

  function carteAgent(a) {
    const metier = D.metiers.find(m => m.id === a.metier);
    const demande = Etat.catalogue.demandes[a.id];
    let statut, action;
    if (a.statut === 'actif') {
      statut = badge('ok', 'check', 'Actif');
      action = `<a class="btn btn--sombre btn--petit" href="#/app/agents/${a.id}">Ouvrir${icone('fleche', 'ic--fleche')}</a>`;
    } else if (demande) {
      statut = badge('info', 'sablier', 'Demande envoyée');
      action = `<span class="pf-carte-agent-attente">${icone('horloge', 'ic--16')}Votre conseillère vous recontacte</span>`;
    } else {
      statut = a.statut === 'nouveau' ? badge('turquoise', 'etincelle', 'Nouveau') : badge('neutre', '', 'Disponible');
      action = `<button class="btn btn--contour btn--petit" data-action="agent-activer" data-agent="${a.id}">Demander l’activation</button>`;
    }
    return `
      <article class="pf-carte-agent${a.statut === 'actif' ? ' est-actif' : ''}">
        <div class="pf-carte-agent-haut"><span class="pf-carte-agent-ic">${icone(a.icone, 'ic--24')}</span>${statut}</div>
        <p class="pf-carte-agent-metier">${esc(metier.nom)}</p>
        <h3>${esc(a.nom)}</h3>
        <p class="pf-carte-agent-desc">${esc(a.description)}</p>
        <p class="pf-carte-agent-gain">${icone('horloge', 'ic--16')}<span><s>${esc(a.avant)}</s> → <b>${esc(a.apres)}</b> ${esc(a.unite)}</span></p>
        <div class="pf-carte-agent-pied"><span class="pf-carte-agent-outils">${a.outils.map(esc).join(' · ')}</span>${action}</div>
      </article>`;
  }

  /* ======================================================================
     PILOTAGE (espace dirigeant)
     ====================================================================== */
  function vuePilotage() {
    const P = D.pilotage;
    const part = P.consomme / P.enveloppe;
    const datesSeuil = { 70: 'vers le 23 octobre', 80: 'vers le 27 octobre', 90: 'vers le 30 octobre' };
    return `
      <div class="pf-page-entete">
        <div>
          <p class="pf-surtitre">Espace dirigeant</p>
          <h1 class="titre pf-h1">Pilotage <em>de votre usage.</em></h1>
          <p class="pf-page-chapo">${esc(D.date.mois)} · données mises à jour il y a 2 minutes</p>
        </div>
        <button class="btn btn--contour" data-action="exporter-pilotage">${icone('telecharger')}Exporter</button>
      </div>

      <div class="pf-pilotage-haut">
        <section class="pf-carte pf-enveloppe" aria-labelledby="titre-enveloppe">
          <div class="pf-carte-entete">
            <h2 id="titre-enveloppe" class="pf-carte-titre">Enveloppe du mois</h2>
            ${Etat.pause ? badge('alerte', 'pause', 'Agents en pause') : badge('ok', 'check', 'Dans l’enveloppe')}
          </div>
          <p class="pf-heros"><span id="pf-heros-conso">${Math.round(part * 100)}</span> %<span class="pf-heros-unite">utilisés</span></p>
          <p class="pf-sous">${Format.nombre(P.consomme)} crédits consommés sur ${Format.nombre(P.enveloppe)} · au 12 octobre</p>
          <div class="jauge-lineaire jauge-lineaire--grande" role="img" aria-label="${Math.round(part * 100)} % de l’enveloppe consommés, projection fin de mois ${Math.round(P.projection * 100)} %, alerte à ${Etat.seuil} %">
            <b style="width:${part * 100}%"></b>
            <i class="jauge-seuil" style="left:${Etat.seuil}%"></i>
            <i class="jauge-projection" style="left:${P.projection * 100}%"></i>
          </div>
          <div class="pf-jauge-legende"><span><i class="pastille pastille--conso"></i>Consommé</span><span><i class="pastille pastille--projection"></i>Projection fin de mois</span><span><i class="pastille pastille--seuil"></i>Seuil d’alerte</span></div>
          <dl class="pf-enveloppe-infos">
            <div><dt>Projection fin de mois</dt><dd>${Math.round(P.projection * 100)} %</dd></div>
            <div><dt>Seuil d’alerte (${Etat.seuil} %)</dt><dd>${Etat.seuil < P.projection * 100 ? esc(datesSeuil[Etat.seuil]) : 'Non atteint'}</dd></div>
            <div><dt>Plafond journalier</dt><dd>${Etat.plafond ? Format.nombre(P.plafondJour) + ' crédits' : 'Désactivé'}</dd></div>
          </dl>
          <p class="pf-enveloppe-note">${icone('bouclier', 'ic--16')}Votre conseillère est prévenue automatiquement de tout dépassement prévisible.</p>
        </section>
        <div class="pf-stats">
          <div class="pf-carte pf-stat-carte"><p class="pf-libelle">Tâches réalisées</p><p class="pf-stat">${Format.nombre(P.taches)}</p><p class="pf-stat-evol hausse">${icone('tendance', 'ic--16')}${esc(P.tachesEvolution)}</p></div>
          <div class="pf-carte pf-stat-carte"><p class="pf-libelle">Utilisateurs actifs</p><p class="pf-stat">${P.utilisateursActifs} <span>/ ${D.entreprise.utilisateursLicence}</span></p><p class="pf-stat-evol">${icone('utilisateurs', 'ic--16')}88 % de l’équipe équipée</p></div>
          <div class="pf-carte pf-stat-carte"><p class="pf-libelle">Temps libéré ce mois-ci</p><p class="pf-stat">${esc(P.tempsLibere)}</p><p class="pf-stat-evol">${icone('horloge', 'ic--16')}au 12 octobre</p></div>
        </div>
      </div>

      <section class="pf-carte" aria-labelledby="titre-conso">
        <div class="pf-carte-entete">
          <div><h2 id="titre-conso" class="pf-carte-titre">Consommation quotidienne</h2><p class="pf-carte-sous">En crédits, du 1er au 12 octobre. Le repère indique le rythme qui épuise l’enveloppe en fin de mois.</p></div>
          <button class="btn btn--fantome btn--petit" data-action="basculer-tableau" data-cible="tableau-conso" aria-expanded="false" aria-controls="tableau-conso">${icone('grille', 'ic--16')}Voir les données</button>
        </div>
        <div id="graphe-conso" class="pf-graphe"></div>
        <div id="tableau-conso" class="pf-graphe-tableau" hidden>${Graphiques.tableau(P.quotidien, [
          { titre: 'Jour', valeur: d => esc(d.libelle) },
          { titre: 'Crédits consommés', num: true, valeur: d => Format.nombre(d.valeur) },
          { titre: 'Commentaire', valeur: d => esc(d.note || '') }
        ])}</div>
      </section>

      <section class="pf-carte" aria-labelledby="titre-par-agent">
        <h2 id="titre-par-agent" class="pf-carte-titre">Par agent</h2>
        <div class="pf-table-zone">
          <table class="pf-table pf-table--compacte">
            <thead><tr><th scope="col">Agent</th><th scope="col">Part de l’usage</th><th scope="col" class="num">Tâches</th><th scope="col" class="num">Temps libéré</th><th scope="col" class="num">Tendance</th></tr></thead>
            <tbody>${P.parAgent.map(a => `
              <tr>
                <td><span class="pf-cellule-agent">${icone(a.icone, 'ic--16')}${esc(a.nom)}</span></td>
                <td><span class="pf-barre-part"><b style="width:${a.part / 31 * 100}%"></b></span><span class="pf-part-valeur tab-num">${a.part} %</span></td>
                <td class="num tab-num">${a.taches}</td>
                <td class="num tab-num">${esc(a.temps)}</td>
                <td class="num tab-num">${a.tendance === 'stable' ? 'Stable' : esc(a.tendance)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </section>

      <div class="pf-grille-2">
        <section class="pf-carte" aria-labelledby="titre-par-equipe">
          <h2 id="titre-par-equipe" class="pf-carte-titre">Par équipe</h2>
          <ul class="pf-equipes">${P.parEquipe.map(e => `
            <li><div class="pf-equipe-ligne"><span>${esc(e.nom)}</span><span class="tab-num">${e.part} %</span></div>
            <span class="pf-barre-part pf-barre-part--pleine"><b style="width:${e.part / 39 * 100}%"></b></span>
            <span class="pf-equipe-utilisateurs">${esc(e.utilisateurs)} utilisateurs actifs</span></li>`).join('')}
          </ul>
          <div class="pf-reco">
            <p class="pf-reco-titre">${icone('etincelle', 'ic--16')}Recommandation de votre conseillère</p>
            <p>${esc(P.recommandation)}</p>
            <button class="btn btn--contour btn--petit" data-action="contacter-conseiller">Planifier la session</button>
          </div>
        </section>
        <section class="pf-carte pf-controles" aria-labelledby="titre-controles">
          <h2 id="titre-controles" class="pf-carte-titre">Contrôles</h2>
          <ul class="pf-reglages-liste">
            <li>
              <div><label for="pf-seuil"><strong>Seuil d’alerte</strong></label><p>Vous et votre conseillère êtes prévenus dès qu’il est atteint.</p></div>
              <select class="saisie pf-select-court" id="pf-seuil" data-action-change="changer-seuil">${[70, 80, 90].map(v => `<option value="${v}" ${Etat.seuil === v ? 'selected' : ''}>${v} %</option>`).join('')}</select>
            </li>
            <li>
              <div><strong id="lbl-plafond">Plafond journalier</strong><p>Au-delà de ${Format.nombre(P.plafondJour)} crédits par jour, les agents attendent le lendemain.</p></div>
              <label class="interrupteur"><input type="checkbox" aria-labelledby="lbl-plafond" data-action-change="basculer-plafond" ${Etat.plafond ? 'checked' : ''}><span></span></label>
            </li>
            <li>
              <div><strong id="lbl-envois">Validation avant tout envoi externe</strong><p>E-mails clients, devis, relances.</p></div>
              <label class="interrupteur"><input type="checkbox" aria-labelledby="lbl-envois" data-action-change="basculer-validation" data-cle="envois" ${Etat.validations.envois ? 'checked' : ''}><span></span></label>
            </li>
            <li>
              <div><strong id="lbl-exports">Validation des exports comptables</strong><p>Écritures envoyées vers Pennylane.</p></div>
              <label class="interrupteur"><input type="checkbox" aria-labelledby="lbl-exports" data-action-change="basculer-validation" data-cle="exports" ${Etat.validations.exports ? 'checked' : ''}><span></span></label>
            </li>
          </ul>
          <div class="pf-zone-pause">
            <div><strong>${Etat.pause ? 'Les agents sont en pause' : 'Mettre tous les agents en pause'}</strong><p>${Etat.pause ? 'Aucune tâche n’est exécutée. Reprenez quand vous le souhaitez.' : 'Arrêt immédiat de toutes les tâches, réversible à tout moment.'}</p></div>
            ${Etat.pause
              ? `<button class="btn btn--sombre" data-action="reprendre-agents">${icone('lecture')}Reprendre</button>`
              : `<button class="btn btn--danger-contour" data-action="pause-demander">${icone('pause')}Mettre en pause</button>`}
          </div>
        </section>
      </div>

      <section class="pf-carte" aria-labelledby="titre-alertes">
        <h2 id="titre-alertes" class="pf-carte-titre">Alertes récentes</h2>
        <ul class="pf-alertes pf-alertes--ligne">${P.alertes.map(a => `
          <li class="${a.niveau}"><span class="pf-alerte-ic">${icone(a.niveau === 'alerte' ? 'alerte' : 'info', 'ic--16')}</span><div><span class="pf-alerte-date">${esc(a.date)}</span><p>${esc(a.texte)}</p></div></li>`).join('')}
        </ul>
      </section>`;
  }

  function apresPilotage() {
    const P = D.pilotage;
    Graphiques.colonnes(document.getElementById('graphe-conso'), {
      titre: 'Consommation quotidienne en crédits',
      hauteur: 260,
      donnees: P.quotidien,
      seuil: { valeur: P.rythmeCible, libelle: Typo.corriger('Rythme cible : ' + Format.nombre(P.rythmeCible) + ' / jour ouvré') },
      format: v => Typo.corriger(Format.nombre(v) + ' crédits')
    });
  }

  /* ======================================================================
     IMPACT (espace dirigeant)
     ====================================================================== */
  function vueImpact() {
    const I = D.impact;
    const valeur = I.cumul * I.coutHoraire;
    const parAgent = D.pilotage.parAgent.slice().sort((a, b) => dureeEnMin(b.temps) - dureeEnMin(a.temps));
    const maxMin = dureeEnMin(parAgent[0].temps);
    return `
      <div class="pf-page-entete">
        <div>
          <p class="pf-surtitre">Espace dirigeant</p>
          <h1 class="titre pf-h1">Impact <em>depuis la mise en route.</em></h1>
          <p class="pf-page-chapo">Datako est en service chez ${esc(D.entreprise.nom)} depuis le 14 avril 2026.</p>
        </div>
        <button class="btn btn--contour" data-action="exporter-pilotage">${icone('telecharger')}Exporter le bilan</button>
      </div>

      <div class="pf-impact-haut">
        <section class="pf-carte pf-impact-heros sombre">
          <p class="pf-libelle">Temps libéré depuis la mise en route</p>
          <p class="pf-impact-valeur"><span data-compteur="${I.cumul}">${I.cumul}</span> h</p>
          <p class="pf-impact-sous">soit environ <strong>${I.joursTravail} jours de travail</strong> rendus à vos équipes</p>
          <div class="pf-impact-valorisation">
            <span>Valeur du temps libéré</span><strong>${Format.euros(valeur, 0)}</strong>
            <em>sur la base d’un coût horaire chargé de ${I.coutHoraire} €</em>
          </div>
        </section>
        <div class="pf-stats">
          <div class="pf-carte pf-stat-carte"><p class="pf-libelle">Ce mois-ci</p><p class="pf-stat">20 h</p><p class="pf-stat-evol hausse">${icone('tendance', 'ic--16')}rythme supérieur à septembre</p></div>
          <div class="pf-carte pf-stat-carte"><p class="pf-libelle">Propositions validées sans correction</p><p class="pf-stat">${I.tauxValidation} %</p><p class="pf-stat-evol">${icone('checkCercle', 'ic--16')}sur 1 942 tâches</p></div>
          <div class="pf-carte pf-stat-carte"><p class="pf-libelle">Réponses sourcées</p><p class="pf-stat">100 %</p><p class="pf-stat-evol">${icone('source', 'ic--16')}aucune réponse sans source</p></div>
        </div>
      </div>

      <section class="pf-carte" aria-labelledby="titre-mensuel">
        <div class="pf-carte-entete">
          <div><h2 id="titre-mensuel" class="pf-carte-titre">Temps libéré par mois</h2><p class="pf-carte-sous">En heures. Octobre est en cours (au 12).</p></div>
          <button class="btn btn--fantome btn--petit" data-action="basculer-tableau" data-cible="tableau-mensuel" aria-expanded="false" aria-controls="tableau-mensuel">${icone('grille', 'ic--16')}Voir les données</button>
        </div>
        <div id="graphe-mensuel" class="pf-graphe"></div>
        <div id="tableau-mensuel" class="pf-graphe-tableau" hidden>${Graphiques.tableau(I.mensuel, [
          { titre: 'Mois', valeur: d => esc(d.libelle) },
          { titre: 'Heures libérées', num: true, valeur: d => d.heures + ' h' }
        ])}</div>
      </section>

      <div class="pf-grille-2">
        <section class="pf-carte" aria-labelledby="titre-impact-agent">
          <h2 id="titre-impact-agent" class="pf-carte-titre">Temps libéré par agent, en octobre</h2>
          <ul class="pf-barres-h">${parAgent.map(a => `
            <li><span class="pf-barres-h-nom">${icone(a.icone, 'ic--16')}${esc(a.nom)}</span>
            <span class="pf-barres-h-piste"><b style="width:${dureeEnMin(a.temps) / maxMin * 100}%"></b></span>
            <span class="pf-barres-h-valeur tab-num">${esc(a.temps)}</span></li>`).join('')}
          </ul>
        </section>
        <section class="pf-carte" aria-labelledby="titre-verbatims">
          <h2 id="titre-verbatims" class="pf-carte-titre">Ce que disent vos équipes</h2>
          <div class="pf-verbatims">${I.verbatims.map(v => `
            <blockquote><p>« ${esc(v.texte)} »</p><footer><span class="avatar avatar--turquoise">${esc(v.auteur.split(' ').map(x => x[0]).join(''))}</span><span><strong>${esc(v.auteur)}</strong>${esc(v.role)}</span></footer></blockquote>`).join('')}
          </div>
        </section>
      </div>`;
  }

  function dureeEnMin(t) {
    const m = t.match(/(\d+)\s*h\s*(\d+)?/);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : 0;
  }

  function apresImpact() {
    Graphiques.colonnes(document.getElementById('graphe-mensuel'), {
      titre: 'Temps libéré par mois, en heures',
      hauteur: 250,
      donnees: D.impact.mensuel.map(m => Object.assign({ valeur: m.heures }, m)),
      format: v => v + ' h',
      formatAxe: v => v + ' h'
    });
    const c = document.querySelector('[data-compteur]');
    if (c) Graphiques.compter(c, Number(c.dataset.compteur), { format: v => Format.nombre(Math.round(v)) });
  }

  /* ======================================================================
     RÉGLAGES (espace dirigeant)
     ====================================================================== */
  function vueReglages(onglet) {
    onglet = ['utilisateurs', 'connecteurs', 'teams'].includes(onglet) ? onglet : 'utilisateurs';
    const onglets = [['utilisateurs', 'Utilisateurs', 'utilisateurs'], ['connecteurs', 'Connexions', 'prise'], ['teams', 'Datako dans Teams', 'teams']];
    let corps = '';
    if (onglet === 'utilisateurs') corps = reglagesUtilisateurs();
    if (onglet === 'connecteurs') corps = reglagesConnecteurs();
    if (onglet === 'teams') corps = reglagesTeams();
    return `
      <div class="pf-page-entete">
        <div>
          <p class="pf-surtitre">Espace dirigeant</p>
          <h1 class="titre pf-h1">Réglages <em>de votre espace.</em></h1>
          <p class="pf-page-chapo">Utilisateurs, connexions à vos outils et accès depuis Teams.</p>
        </div>
      </div>
      <nav class="pf-onglets" aria-label="Rubriques des réglages">
        ${onglets.map(([id, nom, ic]) => `<a href="#/app/reglages/${id}" class="pf-onglet" ${onglet === id ? 'aria-current="page"' : ''}>${icone(ic, 'ic--18')}${nom}</a>`).join('')}
      </nav>
      ${corps}`;
  }

  function reglagesUtilisateurs() {
    const liste = Etat.invites.concat(D.utilisateurs);
    return `
      <section class="pf-carte">
        <div class="pf-carte-entete">
          <div><h2 class="pf-carte-titre">Utilisateurs</h2><p class="pf-carte-sous">${D.entreprise.utilisateursLicence + Etat.invites.length} comptes · ${D.pilotage.utilisateursActifs} utilisateurs actifs ce mois-ci</p></div>
          <button class="btn btn--sombre btn--petit" data-action="inviter">${icone('plus')}Inviter un collègue</button>
        </div>
        <div class="pf-table-zone">
          <table class="pf-table">
            <thead><tr><th scope="col">Nom</th><th scope="col">Équipe</th><th scope="col">Rôle</th><th scope="col" class="num">Agents</th><th scope="col">Dernière activité</th></tr></thead>
            <tbody>${liste.map(u => `
              <tr${u.nouveau ? ' class="est-nouveau"' : ''}>
                <td><span class="pf-cellule-personne"><span class="avatar${u.role.indexOf('Admin') === 0 ? ' avatar--sombre' : ''}">${esc(u.initiales)}</span>${esc(u.nom)}</span></td>
                <td>${esc(u.equipe)}</td>
                <td>${u.role.indexOf('Admin') === 0 ? badge('sombre', 'cadenas', u.role) : esc(u.role)}</td>
                <td class="num tab-num">${u.agents}</td>
                <td>${u.nouveau ? badge('info', 'mail', 'Invitation envoyée') : esc(u.activite)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="pf-table-pied">Et ${D.entreprise.utilisateursLicence - D.utilisateurs.length} autres utilisateurs.</p>
      </section>`;
  }

  function reglagesConnecteurs() {
    return `
      <div class="pf-info-bandeau">${icone('bouclier', 'ic--24')}<p><strong>Datako surveille et maintient vos connexions.</strong> Lorsqu’un de vos logiciels évolue, votre conseillère intervient : vous n’avez rien à faire.</p></div>
      <div class="pf-connecteurs">
        ${D.connecteurs.map(c => {
          const demande = Etat.connecteurs[c.nom];
          const etat = c.etat === 'disponible' && demande ? 'demande' : c.etat;
          const badges = { ok: badge('ok', 'check', 'Connecté'), alerte: badge('alerte', 'horloge', 'Renouvellement planifié'), disponible: badge('neutre', '', 'Disponible'), demande: badge('info', 'sablier', 'Connexion demandée') };
          return `
            <article class="pf-carte pf-connecteur ${etat}">
              <div class="pf-connecteur-haut"><span class="pf-connecteur-ic">${icone(c.icone, 'ic--24')}</span>${badges[etat]}</div>
              <h3>${esc(c.nom)}</h3>
              <p class="pf-connecteur-usage">${esc(c.usage)}</p>
              <p class="pf-connecteur-detail">${etat === 'demande' ? 'Votre conseillère vous propose un créneau cette semaine.' : esc(c.detail)}</p>
              ${c.etat === 'disponible' && !demande ? `<button class="btn btn--contour btn--petit" data-action="connecteur-demander" data-nom="${esc(c.nom)}">${icone('prise')}Demander la connexion</button>` : ''}
            </article>`;
        }).join('')}
      </div>`;
  }

  function reglagesTeams() {
    return `
      <div class="pf-teams-grille">
        <section class="pf-carte">
          <div class="pf-carte-entete"><h2 class="pf-carte-titre">Vos agents dans Microsoft Teams</h2>${badge('ok', 'check', 'Installé')}</div>
          <p class="pf-teams-texte">Vos collaborateurs interrogent Datako sans quitter Teams : il suffit de mentionner <strong>@Datako</strong> dans une conversation ou d’écrire à l’application.</p>
          <ul class="pf-teams-faits">
            <li>${icone('utilisateurs', 'ic--18')}<span><strong>24 utilisateurs</strong> ont accès à Datako dans Teams</span></li>
            <li>${icone('cadenas', 'ic--18')}<span>Les mêmes droits que dans l’espace Datako</span></li>
            <li>${icone('conversation', 'ic--18')}<span><strong>38 %</strong> des questions sont posées depuis Teams</span></li>
          </ul>
        </section>
        <section class="pf-teams-apercu" aria-label="Exemple de conversation dans Teams">
          <div class="pf-teams-fenetre">
            <div class="pf-teams-barre">${icone('teams', 'ic--18')}Conversation · Service comptable</div>
            <div class="pf-teams-msg"><span class="avatar">NH</span><div><strong>Nadia Haddad <em>9 h 32</em></strong><p><b>@Datako</b> combien de factures fournisseurs sont à vérifier&#8239;?</p></div></div>
            <div class="pf-teams-msg pf-teams-msg--datako"><span class="avatar avatar--sombre"><span class="logo-picto"></span></span><div><strong>Datako <em>9 h 32</em></strong>
              <div class="pf-teams-carte"><p><b>2 factures</b> sont à vérifier :</p><ul><li>Fournitures Rhône : écart avec le bon de commande (+36 €)</li><li>Groupe Froid Alpes : doublon possible</li></ul><a class="btn btn--sombre btn--petit" href="#/app/agents/factures">Ouvrir dans Datako</a></div>
            </div></div>
          </div>
        </section>
      </div>`;
  }

  /* ======================================================================
     FENÊTRES : « Comment ça marche », activation, sur mesure, conseiller…
     ====================================================================== */
  const AIDES = {
    factures: [['mail', 'Récupérer', 'Datako récupère les factures reçues par e-mail, ou celles que vous déposez.'], ['recherche', 'Vérifier', 'Il lit chaque facture, la compare à vos bons de commande et signale écarts et doublons.'], ['envoyer', 'Envoyer', 'Vous validez : les écritures partent dans Pennylane, les originaux sont classés.']],
    emails: [['mail', 'Lire', 'Chaque nouvel e-mail de la boîte contact@ est lu et classé par sujet.'], ['source', 'Proposer', 'Datako rédige une réponse à partir de vos commandes, de vos CGV et de l’historique client.'], ['validation', 'Valider', 'Vous relisez, ajustez si besoin, puis envoyez. Les gestes commerciaux passent par un responsable.']],
    devis: [['recherche', 'Comparer', 'Datako retrouve vos devis passés les plus proches de la demande.'], ['base', 'Chiffrer', 'Il applique votre catalogue, les remises du client et les délais fournisseurs.'], ['devis', 'Rédiger', 'Vous recevez une proposition au format de vos devis, avec les points à vérifier.']],
    synthese: [['base', 'Collecter', 'Chaque lundi, Datako rassemble les chiffres de Pennylane, de l’ERP et du CRM.'], ['etincelle', 'Synthétiser', 'Il en tire l’essentiel : faits marquants, alertes, agenda de la semaine.'], ['envoyer', 'Partager', 'La synthèse vous attend à 8 h, prête à être transmise.']]
  };

  function ouvrirAide(id) {
    const a = agent(id);
    Modale.ouvrir(`
      <p class="surtitre">Comment ça marche</p>
      <h2 id="modale-titre" style="margin-top:10px">${esc(a.nom)}</h2>
      <ol class="pf-aide-etapes">${AIDES[id].map(([ic, titre, texte], i) => `<li><span class="pf-aide-ic">${icone(ic, 'ic--24')}<b>${i + 1}</b></span><div><strong>${esc(titre)}</strong><p>${esc(texte)}</p></div></li>`).join('')}</ol>
      <p class="pf-aide-gain">${icone('horloge', 'ic--18')}<span>Temps nécessaire : <s>${esc(a.avant)}</s> → <b>${esc(a.apres)}</b> ${esc(a.unite)}</span></p>
      <div class="modale-actions"><button class="btn btn--sombre" data-fermer-modale>J’ai compris</button></div>`);
  }

  function ouvrirActivation(id) {
    const a = agent(id);
    const modale = Modale.ouvrir(`
      <p class="surtitre">Activer un agent</p>
      <h2 id="modale-titre" style="margin-top:10px">${esc(a.nom)}</h2>
      <p class="pf-modale-texte">${esc(a.description)}</p>
      <ol class="pf-activation">
        <li><b>1</b><span>Votre conseillère configure l’agent sur vos outils (${a.outils.map(esc).join(', ')}).</span></li>
        <li><b>2</b><span>Elle vous le présente lors d’une courte prise en main.</span></li>
        <li><b>3</b><span>L’agent apparaît dans l’espace des personnes concernées.</span></li>
      </ol>
      <form data-form-modale>
        <div class="champ"><label for="act-commentaire">Une précision pour votre conseillère&#8239;?</label><textarea class="saisie" id="act-commentaire" rows="3" placeholder="Par exemple : relancer uniquement au-delà de 15 jours de retard."></textarea></div>
        <fieldset class="champ" style="margin-top:16px"><legend class="champ-libelle">Qui pourra l’utiliser&#8239;?</legend>
          <div class="choix-pastilles">${['Administration & finance', 'Commercial', 'Service client', 'Direction'].map((e, i) => `<label class="choix-pastille"><input type="checkbox" ${i === 0 ? 'checked' : ''}><span>${esc(e)}</span></label>`).join('')}</div>
        </fieldset>
        <div class="modale-actions"><button type="button" class="btn btn--contour" data-fermer-modale>Annuler</button><button type="submit" class="btn btn--primaire">${icone('envoyer')}Envoyer la demande</button></div>
        <p class="modale-note">La mise en service fait l’objet d’une proposition de votre conseillère.</p>
      </form>`);
    modale.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      Etat.catalogue.demandes[id] = true;
      Modale.fermer();
      rendre();
      notifier('Demande envoyée à Camille Roux', 'Votre conseillère vous recontacte pour activer « ' + a.nom + ' ».', 'envoyer');
    });
  }

  function ouvrirSurMesure() {
    const modale = Modale.ouvrir(`
      <p class="surtitre">Agent sur mesure</p>
      <h2 id="modale-titre" style="margin-top:10px">Décrivez la tâche <em>à confier.</em></h2>
      <p class="pf-modale-texte">Votre conseillère étudie votre besoin et revient vers vous avec une proposition.</p>
      <form data-form-modale novalidate>
        <div class="champ"><label for="sm-tache">La tâche <span class="requis">*</span></label><textarea class="saisie" id="sm-tache" rows="3" placeholder="Par exemple : préparer chaque mois le tableau de suivi des stocks à partir de l’ERP."></textarea></div>
        <div class="formulaire-ligne" style="margin-top:16px">
          <div class="champ"><label for="sm-frequence">Fréquence</label><select class="saisie" id="sm-frequence"><option>Plusieurs fois par jour</option><option>Chaque semaine</option><option selected>Chaque mois</option><option>Ponctuellement</option></select></div>
          <div class="champ"><label for="sm-outils">Outils concernés</label><input class="saisie" id="sm-outils" placeholder="ERP, Excel…"></div>
        </div>
        <p class="message-erreur" role="alert" hidden>Décrivez la tâche en quelques mots.</p>
        <div class="modale-actions"><button type="button" class="btn btn--contour" data-fermer-modale>Annuler</button><button type="submit" class="btn btn--primaire">${icone('envoyer')}Envoyer</button></div>
      </form>`);
    const form = modale.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const champ = form.querySelector('#sm-tache');
      if (!champ.value.trim()) { champ.classList.add('est-invalide'); champ.setAttribute('aria-invalid', 'true'); form.querySelector('.message-erreur').hidden = false; champ.focus(); return; }
      Modale.fermer();
      notifier('Besoin transmis à votre conseillère', 'Camille Roux vous propose un échange sous 48 heures.', 'envoyer');
    });
  }

  function ouvrirConseiller() {
    const c = D.conseiller;
    const modale = Modale.ouvrir(`
      <div class="pf-conseiller-modale"><span class="avatar avatar--turquoise avatar--grand">${esc(c.initiales)}</span><div><p class="surtitre">${esc(c.role)}</p><h2 id="modale-titre" style="margin:6px 0 0">${esc(c.prenom)} ${esc(c.nom)}</h2></div></div>
      <p class="pf-modale-texte">Une question, un nouveau besoin, une session de prise en main pour une équipe&#8239;? Choisissez un créneau.</p>
      <form data-form-modale>
        <fieldset class="champ"><legend class="champ-libelle">Créneaux disponibles</legend>
          <div class="choix-pastilles">${['Mar. 13 · 10 h', 'Mer. 14 · 14 h', 'Jeu. 15 · 11 h', 'Ven. 16 · 9 h 30'].map((x, i) => `<label class="choix-pastille"><input type="radio" name="creneau" ${i === 1 ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>
        </fieldset>
        <div class="champ" style="margin-top:16px"><label for="cs-message">Votre message</label><textarea class="saisie" id="cs-message" rows="3">Bonjour Camille, pourrions-nous organiser une prise en main de l’agent Réponses clients pour l’équipe du service client&#8239;?</textarea></div>
        <div class="modale-actions"><button type="button" class="btn btn--contour" data-fermer-modale>Annuler</button><button type="submit" class="btn btn--primaire">${icone('calendrier')}Réserver le créneau</button></div>
      </form>`);
    modale.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const creneau = modale.querySelector('input[name="creneau"]:checked').nextElementSibling.textContent;
      Modale.fermer();
      notifier('Rendez-vous réservé', 'Avec Camille Roux, ' + creneau + '. Une invitation arrive dans votre agenda.', 'calendrier');
    });
  }

  function ouvrirInvitation() {
    const modale = Modale.ouvrir(`
      <p class="surtitre">Inviter un collègue</p>
      <h2 id="modale-titre" style="margin-top:10px">Donnez accès <em>à Datako.</em></h2>
      <form data-form-modale novalidate>
        <div class="formulaire-ligne">
          <div class="champ"><label for="inv-nom">Nom <span class="requis">*</span></label><input class="saisie" id="inv-nom" placeholder="Prénom Nom"></div>
          <div class="champ"><label for="inv-equipe">Équipe</label><select class="saisie" id="inv-equipe"><option>Administration & finance</option><option>Commercial</option><option>Service client</option><option>Logistique</option><option>Direction</option></select></div>
        </div>
        <div class="champ" style="margin-top:16px"><label for="inv-email">E-mail professionnel <span class="requis">*</span></label><input class="saisie" id="inv-email" type="email" placeholder="prenom.nom@entreprise.fr"></div>
        <fieldset class="champ" style="margin-top:16px"><legend class="champ-libelle">Agents accessibles</legend>
          <div class="choix-pastilles">${D.agents.filter(a => a.statut === 'actif').map((a, i) => `<label class="choix-pastille"><input type="checkbox" name="agents" ${i < 2 ? 'checked' : ''}><span>${esc(a.nom)}</span></label>`).join('')}</div>
        </fieldset>
        <p class="message-erreur" role="alert" hidden>Indiquez un nom et une adresse e-mail valide.</p>
        <div class="modale-actions"><button type="button" class="btn btn--contour" data-fermer-modale>Annuler</button><button type="submit" class="btn btn--primaire">${icone('envoyer')}Envoyer l’invitation</button></div>
      </form>`);
    const form = modale.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const nom = form.querySelector('#inv-nom'), email = form.querySelector('#inv-email');
      const ok = nom.value.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      [nom, email].forEach(c => c.classList.toggle('est-invalide', !ok && (c === nom ? !nom.value.trim() : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))));
      if (!ok) { form.querySelector('.message-erreur').hidden = false; return; }
      const nbAgents = form.querySelectorAll('input[name="agents"]:checked').length;
      const n = nom.value.trim();
      Etat.invites.unshift({ nom: n, initiales: n.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(), equipe: form.querySelector('#inv-equipe').value, role: 'Utilisateur', agents: nbAgents, activite: '', nouveau: true });
      Etat.premiersPas.inviter = true;
      Modale.fermer();
      rendre();
      notifier('Invitation envoyée', n + ' reçoit un e-mail pour activer son accès.', 'mail');
    });
  }

  function demanderPause() {
    const modale = Modale.ouvrir(`
      <p class="surtitre" style="color:var(--danger-ink)">Arrêt général</p>
      <h2 id="modale-titre" style="margin-top:10px">Mettre tous les agents <em>en pause&#8239;?</em></h2>
      <p class="pf-modale-texte">Les tâches en cours sont interrompues et aucun crédit n’est plus consommé. Vos équipes voient un message les informant de la pause. Vous pouvez reprendre à tout moment.</p>
      <div class="modale-actions"><button class="btn btn--contour" data-fermer-modale>Annuler</button><button class="btn btn--danger" data-confirmer>${icone('pause')}Tout mettre en pause</button></div>`);
    modale.querySelector('[data-confirmer]').addEventListener('click', () => {
      Etat.pause = true;
      Modale.fermer();
      majPause();
      rendre();
      notifier('Tous les agents sont en pause', 'Aucune tâche ne sera exécutée jusqu’à votre reprise.', 'pause');
    });
  }

  function majPause() {
    document.getElementById('pf-bandeau-pause').hidden = !Etat.pause;
  }

  /* ======================================================================
     ACTIONS (clics sur les éléments portant data-action)
     ====================================================================== */
  const ACTIONS = {
    'poser': el => poserQuestion(D.questions[Number(el.dataset.question)].question),
    'comment-ca-marche': el => ouvrirAide(el.dataset.agent),
    'contacter-conseiller': () => ouvrirConseiller(),

    'factures-lancer': () => {
      if (verifierPause()) return;
      Etat.factures.traitement = true;
      rendre();
      lancerTraitementFactures();
    },
    'factures-filtre': el => { Etat.factures.filtre = el.dataset.filtre; rendre(); },
    'facture-detail': el => ouvrirDetailFacture(el.dataset.id),
    'facture-decider': el => {
      const id = el.dataset.id, d = el.dataset.decision, f = facture(id);
      if (d === 'corriger') {
        Etat.factures.corrections[id] = { ht: 1040, tva: 208, ttc: 1248 };
        Etat.factures.statuts[id] = 'validee';
        notifier('Facture corrigée et validée', 'Prix du bon de commande appliqué. Un e-mail signalant l’écart est prêt dans vos brouillons.');
      } else if (d === 'retablir') {
        Etat.factures.statuts[id] = f.statut;
        delete Etat.factures.corrections[id];
        notifier('Facture rétablie', f.fournisseur + ' · ' + f.numero, 'regenerer');
      } else {
        Etat.factures.statuts[id] = d;
        notifier(d === 'ecartee' ? 'Facture écartée' : 'Facture validée', f.fournisseur + ' · ' + f.numero, d === 'ecartee' ? 'ecarter' : 'checkCercle');
      }
      Modale.fermer(true);
      rendre();
      const z = document.getElementById('zone-factures');
      if (z) { z.setAttribute('tabindex', '-1'); z.focus({ preventScroll: true }); }
    },
    'factures-etape': el => { Etat.factures.etape = Number(el.dataset.etape); rendre(); },
    'factures-envoyer': () => {
      if (verifierPause()) return;
      Etat.factures.envoi = true;
      rendre();
      planifier(() => {
        Etat.factures.envoi = false;
        Etat.factures.envoye = true;
        Etat.premiersPas.factures = true;
        rendre();
        notifier('Envoi terminé', 'Les écritures sont disponibles dans Pennylane.');
      }, 1500);
    },
    'factures-recommencer': () => {
      Object.assign(Etat.factures, { etape: 1, traitement: false, envoi: false, envoye: false, filtre: 'toutes', corrections: {} });
      D.factures.forEach(f => { Etat.factures.statuts[f.id] = f.statut; });
      rendre();
    },

    'ouvrir-email': (el, e) => {
      Etat.emails.selection = el.dataset.email;
      if (routeActuelle.page === 'agents' && routeActuelle.sous === 'emails') {
        e.preventDefault();
        rendre();
        const detail = document.getElementById('pf-mail');
        if (detail && window.innerWidth < 1100) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    'email-ton': el => {
      const id = el.dataset.email;
      Etat.emails.tons[id] = el.dataset.ton;
      delete Etat.emails.textes[id];
      rendre();
    },
    'email-regenerer': el => {
      if (verifierPause()) return;
      const id = el.dataset.email;
      const zoneTexte = document.getElementById('pf-mail-texte');
      zoneTexte.classList.add('en-redaction');
      zoneTexte.value = 'Rédaction d’une nouvelle proposition…';
      planifier(() => {
        Etat.emails.tons[id] = (Etat.emails.tons[id] || 'formel') === 'formel' ? 'chaleureux' : 'formel';
        delete Etat.emails.textes[id];
        rendre();
      }, 900);
    },
    'email-envoyer': el => {
      if (verifierPause()) return;
      const id = el.dataset.email;
      Etat.emails.statuts[id] = 'repondu';
      emailSuivant(id);
      rendre();
      notifier('Réponse envoyée', 'Elle est classée dans l’historique du client.', 'envoyer');
    },
    'email-valider': el => {
      const id = el.dataset.email;
      Etat.emails.statuts[id] = 'validation';
      emailSuivant(id);
      rendre();
      notifier('Soumis à Marc Bastide', 'La réponse partira dès qu’il aura validé le geste commercial.', 'validation');
    },
    'email-ignorer': el => {
      const id = el.dataset.email;
      Etat.emails.statuts[id] = 'ignore';
      emailSuivant(id);
      rendre();
    },
    'email-annuler': el => {
      const id = el.dataset.email;
      delete Etat.emails.statuts[id];
      Etat.emails.selection = id;
      rendre();
    },

    'devis-transmettre': () => { Etat.devis.transmis = true; rendre(); notifier('Devis transmis à Marc Bastide', 'Il le relit avant l’envoi au client.', 'validation'); },
    'devis-telecharger': () => notifier('Document prêt', 'DV-2026-118.docx (téléchargement simulé dans cette démonstration).', 'telecharger'),
    'devis-modifier': () => { Etat.devis.etat = 'saisie'; Etat.devis.transmis = false; rendre(); },

    'synthese-envoyer': () => { Etat.synthese.envoyee = true; rendre(); notifier('Synthèse envoyée', 'Marc Bastide la reçoit par e-mail et dans Teams.', 'envoyer'); },
    'synthese-pdf': () => notifier('PDF prêt', 'Synthese-S41.pdf (téléchargement simulé dans cette démonstration).', 'telecharger'),

    'copier-reponse': el => {
      const bloc = document.querySelector('[data-message="' + el.dataset.message + '"] .pf-msg-texte');
      const texte = bloc ? bloc.innerText : '';
      const fini = () => notifier('Réponse copiée', 'Vous pouvez la coller dans un e-mail ou un document.', 'copier');
      if (navigator.clipboard && texte) navigator.clipboard.writeText(texte).then(fini, fini); else fini();
    },

    'filtrer-catalogue': el => { Etat.catalogue.filtre = el.dataset.filtre; if (routeActuelle.page === 'agents' && !routeActuelle.sous) rendre(); },
    'agent-activer': el => ouvrirActivation(el.dataset.agent),
    'agent-sur-mesure': () => ouvrirSurMesure(),

    'basculer-tableau': el => {
      const t = document.getElementById(el.dataset.cible);
      const ouvert = t.hidden;
      t.hidden = !ouvert;
      el.setAttribute('aria-expanded', String(ouvert));
      el.lastChild.textContent = ouvert ? 'Masquer les données' : 'Voir les données';
    },
    'exporter-pilotage': () => notifier('Export prêt', 'Pilotage-octobre-2026.xlsx (téléchargement simulé dans cette démonstration).', 'telecharger'),
    'pause-demander': () => demanderPause(),
    'reprendre-agents': () => {
      Etat.pause = false;
      majPause();
      rendre();
      notifier('Les agents reprennent', 'Les tâches planifiées reprennent normalement.', 'lecture');
    },

    'inviter': () => ouvrirInvitation(),
    'connecteur-demander': el => {
      Etat.connecteurs[el.dataset.nom] = true;
      rendre();
      notifier('Connexion demandée', el.dataset.nom + ' : votre conseillère vous propose un créneau.', 'prise');
    }
  };

  const CHANGEMENTS = {
    'changer-seuil': el => { Etat.seuil = Number(el.value); rendre(); notifier('Seuil d’alerte mis à jour', 'Vous serez prévenu à ' + Etat.seuil + ' % de l’enveloppe.', 'cloche'); },
    'basculer-plafond': el => { Etat.plafond = el.checked; rendre(); notifier(el.checked ? 'Plafond journalier activé' : 'Plafond journalier désactivé', '', 'jauge'); },
    'basculer-validation': el => { Etat.validations[el.dataset.cle] = el.checked; notifier(el.checked ? 'Validation activée' : 'Validation désactivée', el.checked ? 'Ces actions attendront votre accord.' : 'Les agents agiront sans validation préalable.', 'validation'); }
  };

  /* ======================================================================
     ROUTAGE INTERNE ET RENDU
     ====================================================================== */
  const PAGES = {
    accueil: { titre: 'Accueil', vue: vueAccueil, apres: apresAccueil },
    documents: { titre: 'Interroger mes documents', vue: vueDocuments },
    agents: { titre: 'Agents', vue: vueCatalogue },
    pilotage: { titre: 'Pilotage', vue: vuePilotage, apres: apresPilotage, dirigeant: true },
    impact: { titre: 'Impact', vue: vueImpact, apres: apresImpact, dirigeant: true },
    reglages: { titre: 'Réglages', vue: () => vueReglages(routeActuelle.sous), dirigeant: true }
  };
  const VUES_AGENTS = { factures: vueFactures, emails: vueEmails, devis: vueDevis, synthese: vueSynthese };

  function rendre() {
    const r = routeActuelle;
    const p = PAGES[r.page] || PAGES.accueil;
    let html, filTexte, titreDoc;
    if (r.page === 'agents' && VUES_AGENTS[r.sous]) {
      html = VUES_AGENTS[r.sous]();
      filTexte = `<a href="#/app/agents">Agents</a>${icone('chevronDroite', 'ic--16')}<span>${esc(agent(r.sous).nom)}</span>`;
      titreDoc = agent(r.sous).nom;
    } else {
      html = p.vue();
      filTexte = p.dirigeant ? `<span class="pf-fil-groupe">Espace dirigeant</span>${icone('chevronDroite', 'ic--16')}<span>${p.titre}</span>` : `<span>${p.titre}</span>`;
      titreDoc = p.titre;
    }
    Graphiques.cacherInfobulle();
    zone.innerHTML = html;
    fil.innerHTML = filTexte;
    document.title = 'Datako — ' + titreDoc;
    if (!(r.page === 'agents' && VUES_AGENTS[r.sous]) && p.apres) p.apres();
    Typo.appliquer(zone);
    Typo.appliquer(fil);
    majPersona(!!p.dirigeant && r.page !== 'agents');
    majNavigation();
    const fil2 = document.getElementById('pf-chat-fil');
    if (fil2) fil2.scrollTop = fil2.scrollHeight;
    ajusterHauteur(document.getElementById('pf-mail-texte'));
  }

  function ajusterHauteur(zoneTexte) {
    if (!zoneTexte) return;
    zoneTexte.style.height = 'auto';
    zoneTexte.style.height = (zoneTexte.scrollHeight + 4) + 'px';
  }

  function majPersona(dirigeant) {
    const p = dirigeant ? D.personas.dirigeant : D.personas.utilisatrice;
    personaZone.innerHTML = `<span class="avatar ${dirigeant ? 'avatar--sombre' : 'avatar--turquoise'}">${esc(p.initiales)}</span><span class="pf-persona-texte"><strong>${esc(p.prenom)} ${esc(p.nom)}</strong><span>${esc(p.role)}</span></span>`;
    personaZone.title = dirigeant ? 'Espace dirigeant : vue de Marc Bastide' : 'Vue de Chantal Morel';
  }

  function majNavigation() {
    document.querySelectorAll('.pf-nav a[data-nav]').forEach(a => {
      if (a.dataset.nav === routeActuelle.page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function rendreNotifications() {
    const zoneN = document.getElementById('pf-notifs');
    zoneN.innerHTML = `
      <div class="pf-notifs-entete"><strong>Notifications</strong><button class="lien" data-notifs-lues>Tout marquer comme lu</button></div>
      <ul>${D.notifications.map(n => `<li><a href="${n.lien}" class="${Etat.notificationsLues ? '' : 'non-lue'}"><span class="pf-notif-ic">${icone(n.icone, 'ic--18')}</span><span><strong>${esc(n.texte)}</strong><em>${esc(n.quand)}</em></span></a></li>`).join('')}</ul>`;
    Typo.appliquer(zoneN);
  }

  /* ---------- Mise en place (une seule fois) ---------- */
  let initialisee = false;
  function init() {
    if (initialisee) return;
    initialisee = true;
    zone = document.getElementById('pf-contenu');
    fil = document.getElementById('pf-fil');
    personaZone = document.getElementById('pf-persona');

    document.getElementById('pf-monogramme').textContent = D.entreprise.initiales;
    document.getElementById('pf-entreprise-nom').textContent = D.entreprise.nom;
    document.getElementById('pf-entreprise-detail').textContent = D.entreprise.effectif + ' salariés · ' + D.entreprise.ville;
    document.getElementById('pf-nav-compte').textContent = D.agents.filter(a => a.statut === 'actif').length;

    // Clics délégués
    document.getElementById('vue-plateforme').addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (el && ACTIONS[el.dataset.action]) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') e.preventDefault();
        ACTIONS[el.dataset.action](el, e);
      }
    });
    // Les fenêtres modales sont hors de la plateforme : on y relaie les actions
    document.body.addEventListener('click', e => {
      if (e.target.closest('#vue-plateforme')) return;
      const el = e.target.closest('.modale [data-action]');
      if (el && ACTIONS[el.dataset.action]) { e.preventDefault(); ACTIONS[el.dataset.action](el, e); }
    });
    document.getElementById('vue-plateforme').addEventListener('change', e => {
      const el = e.target.closest('[data-action-change]');
      if (el && CHANGEMENTS[el.dataset.actionChange]) CHANGEMENTS[el.dataset.actionChange](el);
    });
    document.getElementById('vue-plateforme').addEventListener('keydown', e => {
      const el = e.target.closest('[role="button"][data-action]');
      if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ACTIONS[el.dataset.action](el, e); }
      if (e.target.id === 'pf-chat-champ' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const t = e.target.value; e.target.value = ''; poserQuestion(t);
      }
    });
    document.getElementById('vue-plateforme').addEventListener('input', e => {
      if (e.target.id === 'pf-mail-texte') { Etat.emails.textes[e.target.dataset.email] = e.target.value; ajusterHauteur(e.target); }
      if (e.target.id === 'pf-chat-champ') { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; }
    });
    document.getElementById('vue-plateforme').addEventListener('submit', e => {
      const f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      if (f.dataset.form === 'demande' || f.dataset.form === 'chat') {
        const champ = f.querySelector('input, textarea');
        const t = champ.value; champ.value = '';
        poserQuestion(t);
      }
      if (f.dataset.form === 'devis') {
        if (verifierPause()) return;
        Etat.devis.client = f.querySelector('#dv-client').value;
        Etat.devis.besoin = f.querySelector('#dv-besoin').value.trim() || D.devis.besoin;
        Etat.devis.etat = 'calcul';
        rendre();
        lancerCalculDevis();
      }
    });
    // Glisser-déposer de factures
    document.getElementById('vue-plateforme').addEventListener('dragover', e => {
      const d = e.target.closest('[data-depot]'); if (d) { e.preventDefault(); d.classList.add('survol'); }
    });
    document.getElementById('vue-plateforme').addEventListener('dragleave', e => {
      const d = e.target.closest('[data-depot]'); if (d) d.classList.remove('survol');
    });
    document.getElementById('vue-plateforme').addEventListener('drop', e => {
      const d = e.target.closest('[data-depot]'); if (d) { e.preventDefault(); ACTIONS['factures-lancer'](); }
    });

    // Renvois [1] vers les sources
    zone.addEventListener('click', e => {
      const sup = e.target.closest('.renvoi');
      if (!sup) return;
      const msg = sup.closest('[data-message]');
      const src = msg && document.getElementById('src-' + msg.dataset.message + '-' + sup.dataset.renvoi);
      if (src) { src.classList.remove('flash'); void src.offsetWidth; src.classList.add('flash'); src.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });

    // Notifications
    const cloche = document.getElementById('pf-cloche');
    const notifs = document.getElementById('pf-notifs');
    rendreNotifications();
    cloche.addEventListener('click', () => {
      const ouvert = notifs.hidden;
      notifs.hidden = !ouvert;
      cloche.setAttribute('aria-expanded', String(ouvert));
    });
    notifs.addEventListener('click', e => {
      if (e.target.closest('[data-notifs-lues]')) {
        Etat.notificationsLues = true;
        document.getElementById('pf-cloche-point').hidden = true;
        cloche.setAttribute('aria-label', 'Notifications');
        rendreNotifications();
      } else if (e.target.closest('a')) { notifs.hidden = true; cloche.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('click', e => {
      if (!notifs.hidden && !e.target.closest('.pf-notifs-zone')) { notifs.hidden = true; cloche.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !notifs.hidden) { notifs.hidden = true; cloche.setAttribute('aria-expanded', 'false'); cloche.focus(); }
    });

    // Menu latéral sur mobile
    const barre = document.getElementById('pf-barre');
    const voile = document.getElementById('pf-voile');
    const ouvrirMenu = document.getElementById('pf-ouvrir-menu');
    const basculerMenu = ouvert => {
      barre.classList.toggle('ouvert', ouvert);
      voile.hidden = !ouvert;
      ouvrirMenu.setAttribute('aria-expanded', String(ouvert));
      if (ouvert) document.getElementById('pf-fermer-menu').focus();
    };
    ouvrirMenu.addEventListener('click', () => basculerMenu(true));
    document.getElementById('pf-fermer-menu').addEventListener('click', () => { basculerMenu(false); ouvrirMenu.focus(); });
    voile.addEventListener('click', () => basculerMenu(false));
    barre.addEventListener('click', e => { if (e.target.closest('a')) basculerMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && barre.classList.contains('ouvert')) { basculerMenu(false); ouvrirMenu.focus(); } });

    // Reprise depuis le bandeau de pause
    document.getElementById('pf-bandeau-pause').addEventListener('click', e => {
      if (e.target.closest('[data-action="reprendre-agents"]')) ACTIONS['reprendre-agents']();
    });
  }

  /* Appelé par le routeur : chemin du type « agents/factures » */
  function afficher(chemin) {
    init();
    annulerMinuteries();
    // Si une tâche tournait, l'agent la termine « en arrière-plan »
    if (Etat.factures.traitement) { Etat.factures.traitement = false; Etat.factures.etape = 2; }
    if (Etat.factures.envoi) { Etat.factures.envoi = false; Etat.factures.envoye = true; Etat.premiersPas.factures = true; }
    if (Etat.devis.etat === 'calcul') Etat.devis.etat = 'pret';
    const r = Etat.documents.messages.findIndex(m => m.role === 'reflexion');
    if (r > -1) {
      const question = Etat.documents.messages[r - 1];
      const q = question ? trouverQuestion(question.texte) : null;
      Etat.documents.messages.splice(r, 1, q ? { role: 'datako', question: q } : reponseSansSource());
      Etat.documents.enCours = false;
    }

    const morceaux = (chemin || '').split('/').filter(Boolean);
    let page = morceaux[0] || 'accueil';
    let sous = morceaux[1] || null;
    if (!PAGES[page]) page = 'accueil';
    if (page === 'agents' && sous && !VUES_AGENTS[sous]) {
      // Agent non encore actif : on ouvre le catalogue sur son métier
      const a = agent(sous);
      if (a) Etat.catalogue.filtre = a.metier;
      sous = null;
    }
    const memePage = routeActuelle.page === page && routeActuelle.sous === sous;
    routeActuelle = { page: page, sous: sous };
    rendre();
    majPause();
    if (!memePage) {
      window.scrollTo(0, 0);
      zone.focus({ preventScroll: true });
      zone.classList.remove('entree');
      void zone.offsetWidth;
      zone.classList.add('entree');
      clearTimeout(minuterieEntree);
      minuterieEntree = setTimeout(() => zone.classList.remove('entree'), 700);
    }
    // Une question posée depuis l'accueil : on lance la réponse à l'arrivée
    const att = Etat.documents.messages;
    if (page === 'documents' && att.length && att[att.length - 1].role === 'moi') {
      const derniere = att[att.length - 1].texte;
      att.pop();
      Etat.documents.enCours = false;
      poserQuestion(derniere);
    }
  }

  function masquer() { annulerMinuteries(); Modale.fermer(true); }

  return { afficher: afficher, masquer: masquer };
})();
