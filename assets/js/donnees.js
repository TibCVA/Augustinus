/* ==========================================================================
   Datako — Données de démonstration
   --------------------------------------------------------------------------
   C'est LE fichier à modifier pour adapter la maquette : nom de l'entreprise
   fictive, personnes, agents, factures, e-mails, chiffres de pilotage…
   Toutes ces données sont FICTIVES.
   ========================================================================== */

var DONNEES = {

  /* ---------- Contexte de la démonstration ---------- */
  entreprise: {
    nom: 'Bastide Équipements',
    activite: 'Distribution d’équipements professionnels',
    effectif: 48,
    ville: 'Lyon',
    initiales: 'BÉ',
    miseEnRoute: 'avril 2026',
    utilisateursLicence: 24
  },

  date: {
    jour: 'Lundi 12 octobre',
    mois: 'Octobre 2026',
    semaineEcoulee: 'Semaine 41 · du 5 au 9 octobre'
  },

  personas: {
    utilisatrice: { prenom: 'Chantal', nom: 'Morel', role: 'Responsable administrative', initiales: 'CM' },
    dirigeant: { prenom: 'Marc', nom: 'Bastide', role: 'Dirigeant', initiales: 'MB' }
  },

  conseiller: { prenom: 'Camille', nom: 'Roux', role: 'Votre conseillère Datako', initiales: 'CR' },

  /* ---------- Catalogue d'agents ---------- */
  metiers: [
    { id: 'finance', nom: 'Comptabilité & finance', icone: 'facture' },
    { id: 'commercial', nom: 'Commercial', icone: 'mallette' },
    { id: 'client', nom: 'Service client', icone: 'casque' },
    { id: 'direction', nom: 'Direction', icone: 'barres' },
    { id: 'rh', nom: 'Ressources humaines', icone: 'rh' },
    { id: 'achats', nom: 'Achats & juridique', icone: 'balance' }
  ],

  agents: [
    { id: 'factures', nom: 'Factures fournisseurs', metier: 'finance', icone: 'facture', statut: 'actif',
      description: 'Lit vos factures, contrôle les montants et prépare la saisie comptable.',
      avant: '5 min', apres: '30 s', unite: 'par facture', outils: ['Pennylane', 'Outlook'] },
    { id: 'relances', nom: 'Relances clients', metier: 'finance', icone: 'horloge', statut: 'disponible',
      description: 'Repère les retards de paiement et prépare des relances au bon ton.',
      avant: '1 h', apres: '10 min', unite: 'par semaine', outils: ['Pennylane', 'Outlook'] },
    { id: 'notes-frais', nom: 'Contrôle des notes de frais', metier: 'finance', icone: 'documents', statut: 'disponible',
      description: 'Vérifie chaque justificatif au regard de votre politique interne.',
      avant: '4 min', apres: '20 s', unite: 'par note', outils: ['SharePoint'] },

    { id: 'devis', nom: 'Devis & appels d’offres', metier: 'commercial', icone: 'devis', statut: 'actif',
      description: 'Prépare une proposition à partir de vos devis passés et de votre catalogue.',
      avant: '3 h', apres: '45 min', unite: 'par devis', outils: ['ERP', 'Google Drive'] },
    { id: 'rendez-vous', nom: 'Préparation de rendez-vous', metier: 'commercial', icone: 'calendrier', statut: 'disponible',
      description: 'Une fiche claire sur le client avant chaque rendez-vous : historique, encours, sujets ouverts.',
      avant: '30 min', apres: '2 min', unite: 'par rendez-vous', outils: ['CRM', 'Outlook'] },

    { id: 'emails', nom: 'Réponses aux e-mails clients', metier: 'client', icone: 'mail', statut: 'actif',
      description: 'Propose une réponse sourcée à chaque e-mail ; vous validez avant l’envoi.',
      avant: '6 min', apres: '1 min', unite: 'par e-mail', outils: ['Outlook', 'ERP'] },
    { id: 'sav', nom: 'Base de réponses SAV', metier: 'client', icone: 'casque', statut: 'disponible',
      description: 'Retrouve en un instant la bonne procédure technique pour chaque équipement.',
      avant: '15 min', apres: '1 min', unite: 'par recherche', outils: ['SharePoint'] },

    { id: 'synthese', nom: 'Synthèse de la semaine', metier: 'direction', icone: 'synthese', statut: 'actif',
      description: 'Chaque lundi à 8 h, l’essentiel de votre activité en une page.',
      avant: '2 h', apres: '0 min', unite: 'par semaine', outils: ['Pennylane', 'ERP', 'Outlook'] },
    { id: 'veille', nom: 'Veille marché & concurrents', metier: 'direction', icone: 'boussole', statut: 'disponible',
      description: 'Résume chaque semaine ce qui bouge sur votre marché et chez vos concurrents.',
      avant: '2 h', apres: '10 min', unite: 'par semaine', outils: ['Sources web'] },

    { id: 'questions-rh', nom: 'Questions RH des salariés', metier: 'rh', icone: 'rh', statut: 'disponible',
      description: 'Répond aux questions courantes : congés, mutuelle, frais, règlement intérieur.',
      avant: '10 min', apres: '0 min', unite: 'par question', outils: ['SharePoint', 'Teams'] },
    { id: 'integration', nom: 'Accueil des nouveaux arrivants', metier: 'rh', icone: 'formation', statut: 'disponible',
      description: 'Prépare le parcours d’intégration et répond aux questions des premiers jours.',
      avant: '1 j', apres: '2 h', unite: 'par arrivée', outils: ['SharePoint', 'Teams'] },

    { id: 'contrats', nom: 'Analyse de contrats', metier: 'achats', icone: 'balance', statut: 'disponible',
      description: 'Repère les clauses sensibles, les échéances et les préavis à ne pas manquer.',
      avant: '1 h', apres: '10 min', unite: 'par contrat', outils: ['Google Drive'] },
    { id: 'comparatif', nom: 'Comparatif fournisseurs', metier: 'achats', icone: 'panier', statut: 'nouveau',
      description: 'Compare plusieurs offres fournisseurs selon vos propres critères.',
      avant: '2 h', apres: '15 min', unite: 'par consultation', outils: ['Google Drive', 'Pennylane'] }
  ],

  /* ---------- Agent « Factures fournisseurs » ---------- */
  factures: [
    { id: 'f1', fournisseur: 'Fournitures Rhône', numero: 'FR-2026-1187', date: '01/10/2026', echeance: '15/11/2026',
      ht: 1070.00, tva: 214.00, ttc: 1284.00, compte: '607000 · Achats de marchandises', statut: 'verifier',
      anomalie: { type: 'Écart avec le bon de commande', texte: 'Le montant facturé (1 284,00 € TTC) diffère du bon de commande BC-2291 (1 248,00 € TTC). Les couvercles sont facturés 8,25 € l’unité au lieu de 7,50 € convenus.', ecart: 'Écart : +36,00 € TTC' },
      adresse: '14 rue de la Villette, 69003 Lyon',
      lignes: [
        { libelle: 'Bacs gastronormes GN 1/1 inox', qte: 40, pu: 18.50 },
        { libelle: 'Couvercles GN 1/1 inox', qte: 40, pu: 8.25 }
      ] },
    { id: 'f2', fournisseur: 'Transports Vial', numero: 'TV-55821', date: '01/10/2026', echeance: '31/10/2026',
      ht: 640.00, tva: 128.00, ttc: 768.00, compte: '624100 · Transports sur achats', statut: 'conforme',
      adresse: '2 allée des Transporteurs, 69800 Saint-Priest',
      lignes: [{ libelle: 'Affrètement Lyon – Grenoble (2 palettes)', qte: 1, pu: 640.00 }] },
    { id: 'f3', fournisseur: 'Atelier Inox Dauphiné', numero: 'AID-0942', date: '02/10/2026', echeance: '30/11/2026',
      ht: 3450.00, tva: 690.00, ttc: 4140.00, compte: '607000 · Achats de marchandises', statut: 'conforme',
      adresse: '8 rue des Forges, 38000 Grenoble',
      lignes: [{ libelle: 'Tables de travail inox 1 600 mm', qte: 6, pu: 575.00 }] },
    { id: 'f4', fournisseur: 'Électricité Pro Services', numero: 'EPS-7730', date: '02/10/2026', echeance: '01/11/2026',
      ht: 285.50, tva: 57.10, ttc: 342.60, compte: '615200 · Entretien des locaux', statut: 'conforme',
      adresse: '31 avenue Jean-Jaurès, 69007 Lyon',
      lignes: [{ libelle: 'Intervention tableau électrique entrepôt', qte: 1, pu: 285.50 }] },
    { id: 'f5', fournisseur: 'Bureau & Co', numero: 'BC-118274', date: '05/10/2026', echeance: '04/11/2026',
      ht: 162.40, tva: 32.48, ttc: 194.88, compte: '606400 · Fournitures administratives', statut: 'conforme',
      adresse: '5 place Bellecour, 69002 Lyon',
      lignes: [{ libelle: 'Fournitures de bureau (lot mensuel)', qte: 1, pu: 162.40 }] },
    { id: 'f6', fournisseur: 'Ascomat Maintenance', numero: 'ASM-2026-311', date: '05/10/2026', echeance: '04/11/2026',
      ht: 890.00, tva: 178.00, ttc: 1068.00, compte: '615600 · Maintenance', statut: 'conforme',
      adresse: '12 chemin du Moulin, 69140 Rillieux-la-Pape',
      lignes: [{ libelle: 'Contrat de maintenance — 4e trimestre 2026', qte: 1, pu: 890.00 }] },
    { id: 'f7', fournisseur: 'Groupe Froid Alpes', numero: 'GFA-4410', date: '06/10/2026', echeance: '05/12/2026',
      ht: 2180.00, tva: 436.00, ttc: 2616.00, compte: '607000 · Achats de marchandises', statut: 'verifier',
      anomalie: { type: 'Doublon possible', texte: 'Une facture portant le même numéro (GFA-4410) et le même montant a déjà été reçue le 28 septembre et saisie dans Pennylane.', ecart: 'Risque : double paiement de 2 616,00 €' },
      adresse: '40 route de Chambéry, 73000 Chambéry',
      lignes: [{ libelle: 'Groupes frigorifiques 1,5 kW', qte: 2, pu: 1090.00 }] },
    { id: 'f8', fournisseur: 'Énergie Locale', numero: 'EL-0099812', date: '06/10/2026', echeance: '20/10/2026',
      ht: 1412.30, tva: 282.46, ttc: 1694.76, compte: '606100 · Énergie', statut: 'conforme',
      adresse: '1 quai Perrache, 69002 Lyon',
      lignes: [{ libelle: 'Électricité — septembre 2026', qte: 1, pu: 1412.30 }] },
    { id: 'f9', fournisseur: 'Pneus & Services Lyonnais', numero: 'PSL-3321', date: '07/10/2026', echeance: '06/11/2026',
      ht: 420.00, tva: 84.00, ttc: 504.00, compte: '615500 · Entretien des véhicules', statut: 'conforme',
      adresse: '77 boulevard Laurent-Bonnevay, 69100 Villeurbanne',
      lignes: [{ libelle: 'Pneumatiques utilitaire (×4) et montage', qte: 1, pu: 420.00 }] },
    { id: 'f10', fournisseur: 'Imprimerie Jacquard', numero: 'IJ-2026-077', date: '07/10/2026', echeance: '06/11/2026',
      ht: 735.00, tva: 147.00, ttc: 882.00, compte: '623600 · Catalogues et imprimés', statut: 'conforme',
      adresse: '9 rue Mercière, 69002 Lyon',
      lignes: [{ libelle: 'Catalogue produits 2027 (500 ex.)', qte: 1, pu: 735.00 }] },
    { id: 'f11', fournisseur: 'Télécom Pro Rhône-Alpes', numero: 'TPR-88120', date: '08/10/2026', echeance: '07/11/2026',
      ht: 249.90, tva: 49.98, ttc: 299.88, compte: '626000 · Télécommunications', statut: 'conforme',
      adresse: '3 rue de la Part-Dieu, 69003 Lyon',
      lignes: [{ libelle: 'Forfaits mobiles et fibre — octobre', qte: 1, pu: 249.90 }] },
    { id: 'f12', fournisseur: 'Cuisines Techniques Lebrun', numero: 'CTL-1290', date: '09/10/2026', echeance: '08/12/2026',
      ht: 5260.00, tva: 1052.00, ttc: 6312.00, compte: '607000 · Achats de marchandises', statut: 'conforme',
      adresse: '22 avenue de l’Industrie, 01000 Bourg-en-Bresse',
      lignes: [{ libelle: 'Hottes d’extraction 2 400 mm', qte: 4, pu: 1315.00 }] }
  ],

  /* ---------- Agent « Réponses aux e-mails clients » ---------- */
  emails: [
    { id: 'e1', expediteur: 'Isabelle Faure', societe: 'Hôtel Les Cèdres', heure: '9 h 12', sujet: 'Livraison de la commande CMD-4471',
      categorie: 'Suivi de commande',
      message: 'Bonjour,\n\nPouvez-vous me confirmer la date de livraison de notre commande CMD-4471 (lave-vaisselle à capot) ? Nous avons un service important samedi et je voudrais être certaine d’être équipée.\n\nMerci d’avance,\nIsabelle Faure\nDirectrice',
      reponse: 'Bonjour Madame Faure,\n\nVotre commande CMD-4471 a quitté notre entrepôt ce matin. La livraison est programmée jeudi 15 octobre entre 8 h et 12 h, et notre technicien procédera à la mise en service l’après-midi même.\n\nVous serez donc équipée pour votre service de samedi.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      variante: 'Bonjour Madame Faure,\n\nBonne nouvelle : votre lave-vaisselle (commande CMD-4471) est en route. Il vous sera livré jeudi 15 octobre dans la matinée, et mis en service le jour même par notre technicien.\n\nTout sera prêt bien avant votre service de samedi.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      sources: ['ERP · Commande CMD-4471', 'Transporteur · Suivi d’expédition', 'Planning techniciens · Semaine 42'] },
    { id: 'e2', expediteur: 'Paul Arnaud', societe: 'Brasserie du Port', heure: '8 h 47', sujet: 'Four en panne — réclamation',
      categorie: 'Réclamation', validation: 'Geste commercial proposé (avoir de 150 €) : validation d’un responsable requise avant envoi.',
      message: 'Bonjour,\n\nNotre four mixte acheté en mars est en panne depuis hier soir. C’est la deuxième fois en six mois et nous avons dû adapter notre carte ce week-end.\n\nNous attendons une intervention rapide et un geste de votre part.\n\nPaul Arnaud\nGérant',
      reponse: 'Bonjour Monsieur Arnaud,\n\nNous sommes désolés pour ce désagrément, d’autant plus en plein week-end. Votre four étant sous garantie, l’intervention est entièrement prise en charge : notre technicien passera mercredi 14 octobre dans la matinée.\n\nCompte tenu de cette seconde panne, nous vous proposons un avoir de 150 € sur votre prochaine commande.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      variante: 'Bonjour Monsieur Arnaud,\n\nToutes nos excuses pour cette nouvelle panne. Nous avons réservé un créneau d’intervention mercredi 14 octobre au matin ; la réparation est couverte par la garantie de deux ans.\n\nPour tenir compte de la gêne occasionnée, un avoir de 150 € vous sera accordé sur votre prochaine commande.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      sources: ['Conditions générales 2026 · Article 9 (garantie)', 'Planning SAV · Mercredi 14 octobre', 'Historique client · 2 interventions'] },
    { id: 'e3', expediteur: 'Hélène Marchand', societe: 'Collège Jean-Moulin', heure: 'Hier', sujet: 'Demande de devis — chambre froide',
      categorie: 'Demande de devis',
      message: 'Bonjour,\n\nNous souhaitons remplacer la chambre froide positive de notre restaurant scolaire avant les vacances d’hiver. Pourriez-vous nous adresser un devis ?\n\nCordialement,\nHélène Marchand\nIntendante',
      reponse: 'Bonjour Madame Marchand,\n\nMerci pour votre demande. Afin de vous adresser un devis précis, pourriez-vous nous indiquer :\n— les dimensions intérieures souhaitées ;\n— les contraintes d’accès (étage, largeur des portes) ;\n— la date d’installation idéale.\n\nNous pouvons également organiser une visite technique gratuite la semaine prochaine.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      variante: 'Bonjour Madame Marchand,\n\nNous serions ravis de vous accompagner sur ce projet. Pour chiffrer au plus juste, le plus simple est d’organiser une visite technique gratuite : seriez-vous disponible mardi 20 ou jeudi 22 octobre ?\n\nÀ défaut, merci de nous transmettre les dimensions souhaitées et les contraintes d’accès.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      sources: ['Catalogue 2026 · Chambres froides', 'Procédure commerciale · Visite technique'] },
    { id: 'e4', expediteur: 'Lucas Bernard', societe: 'Restaurant L’Ardoise', heure: 'Hier', sujet: 'Erreur sur la facture FA-2026-0841 ?',
      categorie: 'Facturation',
      message: 'Bonjour,\n\nLa facture FA-2026-0841 mentionne deux paniers de lavage, alors que nous n’en avons reçu qu’un seul. Pouvez-vous vérifier ?\n\nMerci,\nLucas Bernard',
      reponse: 'Bonjour Monsieur Bernard,\n\nVous avez raison : le bon de livraison BL-7720 mentionne bien un seul panier de lavage. Un avoir de 42,00 € TTC vous sera adressé sous 48 heures.\n\nToutes nos excuses pour cette erreur.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      variante: 'Bonjour Monsieur Bernard,\n\nMerci de nous l’avoir signalé. Après vérification du bon de livraison BL-7720, un seul panier vous a effectivement été livré. Nous émettons un avoir de 42,00 € TTC, que vous recevrez sous 48 heures.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      sources: ['Pennylane · Facture FA-2026-0841', 'ERP · Bon de livraison BL-7720'] },
    { id: 'e5', expediteur: 'Martine Roche', societe: 'Camping Les Pins', heure: 'Ven.', sujet: 'Joint de porte pour réfrigérateur',
      categorie: 'Pièce détachée',
      message: 'Bonjour,\n\nAuriez-vous en stock le joint de porte pour notre réfrigérateur modèle RF-450 ? Il est abîmé et ne ferme plus correctement.\n\nMartine Roche',
      reponse: 'Bonjour Madame Roche,\n\nLe joint de porte compatible avec votre réfrigérateur RF-450 (référence JP-450) est disponible en stock. Nous pouvons l’expédier sous 48 heures ; il se pose sans outil en quelques minutes.\n\nSouhaitez-vous que nous lancions l’expédition ?\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      variante: 'Bonjour Madame Roche,\n\nBonne nouvelle : le joint JP-450, compatible avec votre RF-450, est en stock. Il peut vous être expédié dès aujourd’hui et se remplace facilement, sans outil.\n\nNous attendons simplement votre accord pour l’envoyer.\n\nBien cordialement,\nSophie Laurent\nService client — Bastide Équipements',
      sources: ['Catalogue pièces détachées · JP-450', 'ERP · Stock entrepôt'] }
  ],

  /* ---------- Agent « Devis & appels d'offres » ---------- */
  devis: {
    clients: ['Commune de Saint-Aubin — Restaurant scolaire', 'Hôtel Les Cèdres', 'Collège Jean-Moulin', 'Brasserie du Port'],
    besoin: 'Remplacement de deux fours mixtes 10 niveaux et d’un lave-vaisselle à capot, avec installation, mise en service et contrat d’entretien de 3 ans.',
    appuis: [
      { libelle: 'Devis similaires', detail: '3 trouvés', coche: true },
      { libelle: 'Catalogue tarifaire 2026', detail: '1 240 références', coche: true },
      { libelle: 'Conditions générales de vente', detail: 'version 2026', coche: true },
      { libelle: 'Remise habituelle du client', detail: '8 %', coche: true }
    ],
    reference: 'DV-2026-118',
    lignes: [
      { libelle: 'Four mixte 10 niveaux GN 1/1, électrique', qte: 2, pu: 9850.00 },
      { libelle: 'Lave-vaisselle à capot avec adoucisseur intégré', qte: 1, pu: 4290.00 },
      { libelle: 'Installation et raccordements (forfait)', qte: 1, pu: 1650.00 },
      { libelle: 'Mise en service et formation du personnel', qte: 1, pu: 480.00 },
      { libelle: 'Contrat d’entretien 3 ans (2 visites par an)', qte: 1, pu: 2160.00 }
    ],
    remise: 0.08,
    attention: [
      'Délai fournisseur des fours : 6 semaines (Atelier Inox Dauphiné, 2 octobre). À confirmer avant envoi.',
      'Client public : vérifier si un mémoire technique est attendu (non précisé dans la demande).',
      'Remise de 8 % appliquée, conforme aux trois derniers devis pour ce client.'
    ],
    sources: ['Devis DV-2025-087 · Commune de Saint-Aubin', 'Devis DV-2026-042 · Collège Jean-Moulin', 'Catalogue tarifaire 2026', 'Conditions générales de vente 2026']
  },

  /* ---------- Agent « Synthèse de la semaine » ---------- */
  synthese: {
    indicateurs: [
      { libelle: 'Chiffre d’affaires facturé', valeur: '186 400 €', evolution: '+12 % vs S40', sens: 'hausse' },
      { libelle: 'Commandes reçues', valeur: '37', evolution: '+5 vs S40', sens: 'hausse' },
      { libelle: 'Encaissements', valeur: '142 900 €', evolution: '−3 % vs S40', sens: 'baisse' },
      { libelle: 'Retards de paiement > 30 j', valeur: '18 650 €', evolution: '3 clients', sens: 'alerte' }
    ],
    retenir: [
      'Bonne semaine commerciale : deux commandes significatives (Hôtel Les Cèdres, groupe scolaire Lumière) portent le chiffre d’affaires facturé à 186 400 €.',
      'La réclamation de la Brasserie du Port (four en panne) est prise en charge : intervention sous garantie mercredi 14 octobre.',
      'La marge brute se maintient à 31,2 %, malgré la hausse de 4 % des prix de l’inox chez Atelier Inox Dauphiné.'
    ],
    attention: [
      'Trois clients dépassent 30 jours de retard de paiement (18 650 € au total).',
      'Stock bas sur les paniers de lavage 50 × 50 : 12 unités, soit environ deux semaines de ventes.',
      'Contrat de maintenance Ascomat : préavis de résiliation à notifier avant le 31 décembre si vous souhaitez renégocier.'
    ],
    agenda: [
      { jour: 'Mar. 13', texte: 'Rendez-vous banque — renouvellement de la ligne de crédit, 10 h' },
      { jour: 'Mer. 14', texte: 'Intervention SAV à la Brasserie du Port' },
      { jour: 'Jeu. 15', texte: 'Livraison et mise en service à l’Hôtel Les Cèdres' },
      { jour: 'Ven. 16', texte: 'Comité de direction, 9 h' }
    ],
    sources: ['Pennylane', 'ERP · Gestion commerciale', 'Outlook · Agenda de Marc Bastide', 'CRM']
  },

  /* ---------- « Interroger vos documents » (réponses scénarisées) ---------- */
  sourcesDocumentaires: [
    { nom: 'Google Drive', detail: 'Contrats et devis', volume: '1 284 documents', icone: 'dossier' },
    { nom: 'SharePoint', detail: 'Procédures et RH', volume: '312 documents', icone: 'documents' },
    { nom: 'Pennylane', detail: 'Factures et règlements', volume: '2 140 pièces', icone: 'facture' },
    { nom: 'Outlook', detail: 'Boîte contact@', volume: '9 860 e-mails', icone: 'mail' }
  ],

  questions: [
    { question: 'Quel est le délai de paiement de Fournitures Rhône ?',
      motsCles: ['fournitures rhône', 'fournitures rhone', 'délai de paiement', 'delai de paiement', 'payer fournitures'],
      reponse: 'Le contrat-cadre signé avec Fournitures Rhône prévoit un **paiement à 45 jours fin de mois** [1]. Un **escompte de 2 %** s’applique pour tout règlement sous 10 jours [1].\n\nSur les six derniers mois, vos règlements sont intervenus en moyenne à **41 jours** : vous êtes dans les délais [2].',
      sources: [
        { titre: 'Contrat-cadre Fournitures Rhône 2025.pdf', chemin: 'Google Drive › Contrats › Fournisseurs', extrait: '« Article 7 — Les factures sont payables à quarante-cinq (45) jours fin de mois. Un escompte de 2 % est accordé pour tout paiement intervenant sous dix (10) jours. »' },
        { titre: 'Historique des règlements', chemin: 'Pennylane › Fournisseurs › Fournitures Rhône', extrait: '6 factures réglées depuis avril · délai moyen constaté : 41 jours.' }
      ] },
    { question: 'Résume le contrat de maintenance Ascomat',
      motsCles: ['ascomat', 'contrat de maintenance', 'maintenance'],
      reponse: 'Voici l’essentiel du contrat de maintenance Ascomat [1] :\n\n- **Objet** : maintenance préventive et curative des chambres froides et des quais de l’entrepôt.\n- **Durée** : trois ans, du 1er avril 2024 au 31 mars 2027, avec reconduction tacite.\n- **Intervention** : sous 48 heures ouvrées.\n- **Coût** : 1 068 € TTC par trimestre [2].\n\n**Point d’attention** : le préavis de résiliation est de trois mois. Pour renégocier, il faut le notifier **avant le 31 décembre 2026** [1].',
      sources: [
        { titre: 'Contrat de maintenance Ascomat 2024.pdf', chemin: 'Google Drive › Contrats › Prestataires', extrait: '« Article 11 — Le contrat peut être résilié par lettre recommandée moyennant un préavis de trois (3) mois avant son échéance. »' },
        { titre: 'Facture ASM-2026-311', chemin: 'Pennylane › Fournisseurs › Ascomat Maintenance', extrait: 'Contrat de maintenance — 4e trimestre 2026 · 1 068,00 € TTC.' }
      ] },
    { question: 'Quelles factures clients sont impayées depuis plus de 30 jours ?',
      motsCles: ['impayé', 'impayée', 'impayées', 'impayés', 'retard de paiement', 'relance', '30 jours'],
      reponse: 'Trois clients dépassent 30 jours de retard, pour un total de **18 650 € TTC** [1] :\n\n- **Le Gourmet Lyonnais** : 8 940 €, 47 jours de retard.\n- **Hôtel du Parc** : 6 320 €, 38 jours de retard.\n- **Traiteur Saveurs & Co** : 3 390 €, 33 jours de retard.\n\nL’agent **Relances clients** peut préparer les relances correspondantes ; il est disponible dans le catalogue.',
      sources: [
        { titre: 'Balance âgée clients', chemin: 'Pennylane › Clients › Balance âgée', extrait: 'Échu > 30 jours : 3 clients · 18 650,00 € TTC au 12/10/2026.' }
      ] },
    { question: 'Quelle est la procédure en cas de retour produit ?',
      motsCles: ['retour', 'procédure', 'procedure', 'rma'],
      reponse: 'La procédure qualité PQ-07 prévoit quatre étapes [1] :\n\n- **1. Enregistrer** la demande dans l’ERP sous 24 heures, avec le numéro de commande.\n- **2. Qualifier** le motif (casse, erreur, non-conformité) et joindre des photos.\n- **3. Organiser** l’enlèvement via le transporteur habituel ; il est gratuit si l’erreur nous incombe.\n- **4. Émettre** un avoir ou un remplacement sous 5 jours ouvrés après réception.\n\nLes retours ne sont acceptés que dans un délai de 30 jours après livraison [2].',
      sources: [
        { titre: 'PQ-07 — Retours clients.docx', chemin: 'SharePoint › Qualité › Procédures', extrait: '« Toute demande de retour est enregistrée dans l’ERP sous 24 heures et qualifiée selon son motif… »' },
        { titre: 'Conditions générales de vente 2026.pdf', chemin: 'Google Drive › Commercial', extrait: '« Article 8 — Les retours sont acceptés dans un délai de trente (30) jours à compter de la livraison. »' }
      ] },
    { question: 'Comment sont remboursés les frais de déplacement ?',
      motsCles: ['frais', 'déplacement', 'deplacement', 'note de frais', 'remboursement', 'kilométrique', 'repas', 'hôtel'],
      reponse: 'Selon la politique interne 2026 [1] :\n\n- **Repas** : remboursés jusqu’à 21 € (hors invitation client).\n- **Voiture personnelle** : indemnités kilométriques selon le barème fiscal en vigueur.\n- **Hôtel** : plafond de 120 € la nuit, 150 € à Paris.\n- **Délai** : justificatifs à déposer sous 30 jours.',
      sources: [
        { titre: 'Politique frais de déplacement 2026.pdf', chemin: 'SharePoint › Ressources humaines', extrait: '« Les frais de repas sont remboursés sur justificatif dans la limite de 21 € par repas… »' }
      ] }
  ],

  /* ---------- Pilotage de l'usage (espace dirigeant) ---------- */
  pilotage: {
    enveloppe: 30000,               // crédits par mois
    consomme: 9270,                 // crédits consommés au 12 octobre
    projection: 0.91,               // projection fin de mois (part de l'enveloppe)
    seuilAlerte: 0.80,
    dateSeuil: 'vers le 27 octobre',
    plafondJour: 2000,
    rythmeCible: 1364,              // enveloppe / 22 jours ouvrés
    taches: 329,
    tachesEvolution: '+15 % vs septembre à date',
    utilisateursActifs: 21,
    tempsLibere: '20 h 27',
    quotidien: [
      { jour: '1', libelle: 'Jeudi 1er octobre', valeur: 1180 },
      { jour: '2', libelle: 'Vendredi 2 octobre', valeur: 1090 },
      { jour: '3', libelle: 'Samedi 3 octobre', valeur: 60 },
      { jour: '4', libelle: 'Dimanche 4 octobre', valeur: 0 },
      { jour: '5', libelle: 'Lundi 5 octobre', valeur: 1310 },
      { jour: '6', libelle: 'Mardi 6 octobre', valeur: 1240 },
      { jour: '7', libelle: 'Mercredi 7 octobre', valeur: 1420, note: 'Pic sur l’agent Devis' },
      { jour: '8', libelle: 'Jeudi 8 octobre', valeur: 1260 },
      { jour: '9', libelle: 'Vendredi 9 octobre', valeur: 1150 },
      { jour: '10', libelle: 'Samedi 10 octobre', valeur: 40 },
      { jour: '11', libelle: 'Dimanche 11 octobre', valeur: 0 },
      { jour: '12', libelle: 'Lundi 12 octobre (en cours)', valeur: 520, enCours: true }
    ],
    parAgent: [
      { id: 'documents', nom: 'Interroger vos documents', icone: 'conversation', part: 31, taches: 141, unite: 'questions', temps: '2 h 21', tendance: '+8 %' },
      { id: 'emails', nom: 'Réponses aux e-mails clients', icone: 'mail', part: 26, taches: 84, unite: 'e-mails', temps: '4 h 12', tendance: '+3 %' },
      { id: 'factures', nom: 'Factures fournisseurs', icone: 'facture', part: 18, taches: 96, unite: 'factures', temps: '6 h 24', tendance: '+11 %' },
      { id: 'devis', nom: 'Devis & appels d’offres', icone: 'devis', part: 17, taches: 6, unite: 'devis', temps: '4 h 30', tendance: '+40 %' },
      { id: 'synthese', nom: 'Synthèse de la semaine', icone: 'synthese', part: 8, taches: 2, unite: 'synthèses', temps: '3 h 00', tendance: 'stable' }
    ],
    parEquipe: [
      { nom: 'Administration & finance', part: 39, utilisateurs: '6 / 6' },
      { nom: 'Commercial', part: 27, utilisateurs: '7 / 8' },
      { nom: 'Service client', part: 22, utilisateurs: '4 / 6' },
      { nom: 'Direction', part: 8, utilisateurs: '2 / 2' },
      { nom: 'Logistique', part: 4, utilisateurs: '2 / 2' }
    ],
    recommandation: 'Au service client, seules 2 personnes sur 6 utilisent l’agent Réponses aux e-mails clients. Une prise en main de 30 minutes avec votre conseillère permettrait d’en étendre l’usage à toute l’équipe.',
    alertes: [
      { date: '9 oct.', niveau: 'info', texte: 'Rythme de consommation conforme : projection à 91 % de l’enveloppe.' },
      { date: '7 oct.', niveau: 'alerte', texte: 'Pic d’usage sur l’agent Devis (× 2,3 la moyenne), lié à la préparation de deux appels d’offres.' },
      { date: '1er oct.', niveau: 'info', texte: 'Nouvelle enveloppe mensuelle ouverte : 30 000 crédits.' }
    ]
  },

  /* ---------- Impact (espace dirigeant) ---------- */
  impact: {
    cumul: 196,
    joursTravail: 28,
    tauxValidation: 94,
    coutHoraire: 40,
    mensuel: [
      { mois: 'Avr.', libelle: 'Avril (mise en route le 14)', heures: 11 },
      { mois: 'Mai', libelle: 'Mai', heures: 27 },
      { mois: 'Juin', libelle: 'Juin', heures: 34 },
      { mois: 'Juil.', libelle: 'Juillet', heures: 31 },
      { mois: 'Août', libelle: 'Août', heures: 21 },
      { mois: 'Sept.', libelle: 'Septembre', heures: 52 },
      { mois: 'Oct.', libelle: 'Octobre (au 12)', heures: 20, enCours: true }
    ],
    verbatims: [
      { texte: 'Je traite les factures du mois en une matinée, au lieu de deux jours. Et je ne découvre plus les doublons après coup.', auteur: 'Chantal Morel', role: 'Responsable administrative' },
      { texte: 'Le lundi matin, j’ai ma synthèse avant même d’ouvrir mes e-mails. Je sais où concentrer mon attention.', auteur: 'Marc Bastide', role: 'Dirigeant' },
      { texte: 'Pour un appel d’offres, je repars de nos meilleurs devis en quelques minutes. Je passe mon temps sur le client, plus sur la mise en forme.', auteur: 'Karim Benali', role: 'Commercial' }
    ]
  },

  /* ---------- Réglages ---------- */
  utilisateurs: [
    { nom: 'Marc Bastide', initiales: 'MB', equipe: 'Direction', role: 'Administrateur', agents: 5, activite: 'Aujourd’hui' },
    { nom: 'Chantal Morel', initiales: 'CM', equipe: 'Administration & finance', role: 'Administratrice', agents: 5, activite: 'Il y a 5 min' },
    { nom: 'Nadia Haddad', initiales: 'NH', equipe: 'Administration & finance', role: 'Utilisatrice', agents: 2, activite: 'Aujourd’hui' },
    { nom: 'Karim Benali', initiales: 'KB', equipe: 'Commercial', role: 'Utilisateur', agents: 2, activite: 'Hier' },
    { nom: 'Thomas Girard', initiales: 'TG', equipe: 'Commercial', role: 'Utilisateur', agents: 2, activite: 'Aujourd’hui' },
    { nom: 'Sophie Laurent', initiales: 'SL', equipe: 'Service client', role: 'Utilisatrice', agents: 2, activite: 'Aujourd’hui' },
    { nom: 'Julien Petit', initiales: 'JP', equipe: 'Service client', role: 'Utilisateur', agents: 2, activite: 'Il y a 3 jours' },
    { nom: 'Élodie Fabre', initiales: 'ÉF', equipe: 'Logistique', role: 'Utilisatrice', agents: 1, activite: 'Il y a 2 jours' }
  ],

  connecteurs: [
    { nom: 'Pennylane', usage: 'Comptabilité', etat: 'ok', detail: 'Synchronisé il y a 4 min · 2 140 pièces', icone: 'facture' },
    { nom: 'Microsoft Outlook', usage: 'Messagerie', etat: 'ok', detail: 'Synchronisé il y a 1 min · 3 boîtes', icone: 'mail' },
    { nom: 'Google Drive', usage: 'Contrats et devis', etat: 'ok', detail: 'Synchronisé il y a 12 min · 1 284 documents', icone: 'dossier' },
    { nom: 'SharePoint', usage: 'Procédures et RH', etat: 'alerte', detail: 'Accès à renouveler dans 5 jours. Votre conseillère s’en charge jeudi : aucune action de votre part.', icone: 'documents' },
    { nom: 'Microsoft Teams', usage: 'Accès aux agents', etat: 'ok', detail: 'Installé pour 24 utilisateurs', icone: 'teams' },
    { nom: 'Gestion commerciale (ERP)', usage: 'Commandes, stocks, clients', etat: 'ok', detail: 'Synchronisé il y a 6 min', icone: 'base' },
    { nom: 'Sage', usage: 'Paie', etat: 'disponible', detail: 'Prêt à connecter', icone: 'rh' },
    { nom: 'HubSpot', usage: 'CRM', etat: 'disponible', detail: 'Prêt à connecter', icone: 'mallette' }
  ],

  notifications: [
    { icone: 'facture', texte: '12 nouvelles factures fournisseurs reçues', quand: 'Il y a 10 min', lien: '#/app/agents/factures' },
    { icone: 'synthese', texte: 'Votre synthèse de la semaine est prête', quand: 'Aujourd’hui, 8 h 00', lien: '#/app/agents/synthese' },
    { icone: 'etincelle', texte: 'Nouveau dans le catalogue : Comparatif fournisseurs', quand: 'Hier', lien: '#/app/agents' }
  ],

  /* ---------- Simulateur de la vitrine ---------- */
  simulateur: {
    taches: [
      { id: 'factures', libelle: 'Traitement des factures fournisseurs', unite: 'factures', volume: 300, volumeMin: 20, volumeMax: 2000, pas: 10, minutes: 5, minutesMax: 30 },
      { id: 'emails', libelle: 'Réponses aux e-mails clients', unite: 'e-mails', volume: 400, volumeMin: 20, volumeMax: 3000, pas: 10, minutes: 6, minutesMax: 30 },
      { id: 'devis', libelle: 'Préparation des devis', unite: 'devis', volume: 20, volumeMin: 1, volumeMax: 150, pas: 1, minutes: 180, minutesMax: 480 },
      { id: 'reporting', libelle: 'Synthèses et reportings', unite: 'documents', volume: 6, volumeMin: 1, volumeMax: 60, pas: 1, minutes: 120, minutesMax: 480 }
    ],
    partAutomatisee: 80,
    coutHoraire: 40,
    heuresParJour: 7,
    moisParAn: 11
  }
};
