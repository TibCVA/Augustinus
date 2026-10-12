/* ==========================================================================
   Datako — Données de démonstration
   --------------------------------------------------------------------------
   C'est LE fichier à modifier pour adapter la maquette : entreprise fictive,
   personnes, agents, travaux du matin, bilan, Studio, textes de la vitrine.
   Toutes ces données sont FICTIVES.

   Rappel du principe : chaque « agent » Datako est une skill créée dans
   Claude, accompagnée d'une fiche (nom, icône, rôles, logiciels, rythme,
   actions soumises à validation). La plateforme affiche tous les agents
   avec le MÊME écran : ce qu'on lui confie → ce qu'il fait → ce qu'il rend.
   ========================================================================== */

var DONNEES = {

  /* ---------- Contexte ---------- */
  entreprise: {
    nom: 'Bastide Équipements',
    activite: 'Distribution d’équipements professionnels',
    ville: 'Lyon',
    effectif: 48,
    initiales: 'BÉ',
    domaine: 'bastide-equipements.fr'
  },

  date: {
    jour: 'Lundi 12 octobre',
    jourSemaine: 1,          // 1 = lundi … 7 = dimanche
    heure: '9 h 05',
    heureDecimale: 9.08,
    mois: 'octobre'
  },

  conseillere: { prenom: 'Camille', nom: 'Roux', initiales: 'CR', role: 'Votre conseillère Datako' },

  /* Les deux personnes que l'on peut « incarner » dans la démo.
     Les droits dépendent du rôle : chacun ne voit que ses agents. */
  personas: {
    chantal: { id: 'chantal', prenom: 'Chantal', nom: 'Morel', initiales: 'CM', role: 'finance',
               fonction: 'Responsable administrative et financière', direction: false },
    marc:    { id: 'marc', prenom: 'Marc', nom: 'Bastide', initiales: 'MB', role: 'direction',
               fonction: 'Dirigeant', direction: true }
  },

  roles: {
    finance:    'Administration et finance',
    direction:  'Direction',
    commercial: 'Commercial',
    client:     'Service client'
  },

  /* ---------- L'équipe d'agents ----------
     rythme.passages : jours (1 = lundi) et heure de chaque passage.
     Un agent « à la demande » n'a pas de passage : on le lance soi-même. */
  agents: [
    {
      id: 'factures', nom: 'Contrôle des factures', icone: 'facture', teinte: 'teal',
      skill: 'controle-factures', version: 'v3', majLe: '3 octobre',
      mission: 'Lit les factures fournisseurs reçues, les compare aux bons de commande et prépare l’export comptable.',
      roles: ['finance', 'direction'],
      logiciels: ['Outlook', 'Pennylane'],
      peutLire: 'la boîte factures@, les bons de commande et les factures déjà saisies',
      attendAccord: ['écrire dans Pennylane', 'envoyer un e-mail à un fournisseur'],
      rythme: { type: 'horaire', libelle: 'Chaque matin à 7 h', passages: [{ jours: [1, 2, 3, 4, 5], heure: 7 }] },
      entree: { type: 'planifie', texte: 'Les factures arrivées dans la boîte factures@ depuis son dernier passage, et les bons de commande ouverts dans Pennylane.' },
      etapes: [
        '12 factures trouvées dans la boîte factures@',
        'Montants, dates et références lus sur chaque facture',
        'Comparaison avec les 31 bons de commande ouverts',
        'Recherche de doublons sur les 12 derniers mois',
        'Fichier de contrôle et export Pennylane préparés'
      ],
      travail: 't-factures',
      semaineDerniere: '5 passages · 61 factures'
    },
    {
      id: 'emails', nom: 'Réponses aux e-mails clients', icone: 'mail', teinte: 'bleu',
      skill: 'reponses-clients', version: 'v5', majLe: '28 septembre',
      mission: 'Prépare une réponse à chaque demande client, dans votre ton, avec les bonnes informations de commande.',
      roles: ['finance', 'client', 'direction'],
      logiciels: ['Outlook', 'Sellsy'],
      peutLire: 'la boîte contact@ et le suivi des commandes',
      attendAccord: ['envoyer un e-mail'],
      rythme: { type: 'horaire', libelle: 'Chaque jour à 7 h 15 et 13 h 30', passages: [{ jours: [1, 2, 3, 4, 5], heure: 7.25 }, { jours: [1, 2, 3, 4, 5], heure: 13.5 }] },
      entree: { type: 'planifie', texte: 'Les e-mails reçus sur contact@ depuis son dernier passage.' },
      etapes: [
        '5 demandes reçues sur contact@ depuis hier 13 h 30',
        'Commandes et livraisons retrouvées dans Sellsy',
        'Réponses rédigées dans le ton de Bastide Équipements',
        'Une demande de devis transmise à Julien Roche'
      ],
      travail: 't-emails',
      semaineDerniere: '10 passages · 38 réponses'
    },
    {
      id: 'relances', nom: 'Relances clients', icone: 'horloge', teinte: 'sable',
      skill: 'relances-clients', version: 'v2', majLe: '15 septembre',
      mission: 'Repère les factures clients en retard et prépare des relances au bon ton, du plus courtois au plus ferme.',
      roles: ['finance', 'direction'],
      logiciels: ['Pennylane', 'Outlook'],
      peutLire: 'les factures clients et leur échéance',
      attendAccord: ['envoyer un e-mail', 'créer un rappel dans l’agenda'],
      rythme: { type: 'horaire', libelle: 'Lundi et jeudi à 7 h 30', passages: [{ jours: [1, 4], heure: 7.5 }] },
      entree: { type: 'planifie', texte: 'Les factures clients échues et non réglées dans Pennylane.' },
      etapes: [
        '4 factures échues et non réglées trouvées dans Pennylane',
        'Historique des relances précédentes vérifié',
        'Ton choisi selon le retard et la relation client',
        '4 relances rédigées, 1 appel conseillé'
      ],
      travail: 't-relances',
      semaineDerniere: '2 passages · 9 relances'
    },
    {
      id: 'synthese', nom: 'Synthèse de la semaine', icone: 'synthese', teinte: 'marine',
      skill: 'synthese-hebdo', version: 'v4', majLe: '22 septembre',
      mission: 'Chaque lundi, l’essentiel de la semaine écoulée en une page : ventes, commandes, points d’attention.',
      roles: ['direction'],
      logiciels: ['Sellsy', 'Pennylane'],
      peutLire: 'les ventes, les commandes et la trésorerie',
      attendAccord: ['envoyer un e-mail'],
      rythme: { type: 'horaire', libelle: 'Chaque lundi à 7 h 45', passages: [{ jours: [1], heure: 7.75 }] },
      entree: { type: 'planifie', texte: 'Les ventes et commandes de la semaine écoulée (Sellsy) et la trésorerie (Pennylane).' },
      etapes: [
        'Ventes et commandes de la semaine 41 extraites de Sellsy',
        'Comparaison avec la semaine 40 et le même mois l’an dernier',
        'Points d’attention repérés : devis sans réponse, retards',
        'Synthèse d’une page mise en forme (PDF)'
      ],
      travail: 't-synthese',
      semaineDerniere: '1 passage'
    },
    {
      id: 'devis', nom: 'Préparation de devis', icone: 'devis', teinte: 'bleu',
      skill: 'devis-bastide', version: 'v6', majLe: '7 octobre',
      mission: 'Prépare un devis à partir de la demande du client, de vos tarifs et de vos devis passés.',
      roles: ['commercial', 'direction'],
      logiciels: ['Sellsy', 'SharePoint'],
      peutLire: 'le catalogue, les tarifs et les devis passés',
      attendAccord: ['envoyer un e-mail', 'enregistrer un devis dans Sellsy'],
      rythme: { type: 'demande', libelle: 'À la demande' },
      entree: {
        type: 'formulaire',
        champs: [
          { id: 'client', type: 'choix', libelle: 'Pour quel client ?', options: ['Hôtel des Alpes', 'Brasserie du Parc', 'Clinique Saint-Roch'] },
          { id: 'besoin', type: 'texte', libelle: 'Que faut-il chiffrer ?', valeur: 'Un lave-vaisselle à capot et un four mixte 10 niveaux pour la cuisine du restaurant, installation comprise.' },
          { id: 'piece', type: 'fichier', libelle: 'Une pièce jointe ? (facultatif)', exemple: 'demande-client.pdf' }
        ],
        bouton: 'Préparer le devis'
      },
      etapes: [
        'Demande du client lue',
        'Références trouvées au catalogue : LV-500, FM-10',
        'Tarifs et remises des 3 derniers devis de ce client appliqués',
        'Devis mis en forme sur votre modèle (Word)'
      ],
      travail: 't-devis',
      semaineDerniere: '6 devis'
    },
    {
      id: 'documents', nom: 'Questions sur vos documents', icone: 'documents', teinte: 'teal',
      skill: 'documents-bastide', version: 'v2', majLe: '1er octobre',
      mission: 'Répond aux questions de l’équipe à partir de vos documents, en citant ses sources. N’invente jamais.',
      roles: ['finance', 'commercial', 'client', 'direction'],
      logiciels: ['SharePoint'],
      peutLire: 'les contrats, fiches produits et procédures sur SharePoint',
      attendAccord: [],
      rythme: { type: 'demande', libelle: 'À la demande' },
      entree: {
        type: 'question',
        libelle: 'Votre question',
        suggestions: [
          'Quelle est la garantie du four FM-10 ?',
          'Quel délai de paiement avons-nous avec Groupe Froid Alpes ?',
          'Comment traiter un retour SAV ?'
        ],
        bouton: 'Chercher la réponse'
      },
      etapes: [
        'Recherche dans 1 240 documents SharePoint',
        '3 passages pertinents retenus',
        'Réponse rédigée avec ses sources'
      ],
      semaineDerniere: '14 questions'
    }
  ],

  /* ---------- Les travaux préparés ce matin ----------
     Chaque travail apparaît sous forme de carte dans « Aujourd'hui ».
     apercu.type : 'liste' | 'email' | 'tableau' | 'document'
     Les actions sont celles qui attendent un accord humain. */
  travaux: [
    {
      id: 't-factures', agent: 'factures', persona: 'chantal', heure: '7 h 02', minutes: 54,
      titre: '12 factures contrôlées,', accent: 'deux points à regarder.',
      resume: '10 factures sont conformes à leur bon de commande. Deux méritent votre œil avant l’export comptable.',
      apercu: {
        type: 'liste',
        lignes: [
          { statut: 'ok', texte: '10 factures conformes', detail: '18 942,60 € TTC au total' },
          { statut: 'alerte', texte: 'Fournitures Rhône : prix au-dessus du bon de commande', detail: '+ 36,00 € TTC sur la facture FR-2291' },
          { statut: 'alerte', texte: 'Groupe Froid Alpes : facture reçue deux fois', detail: 'GFA-4410 · 2 616,00 € TTC, déjà payée le 2 octobre' }
        ]
      },
      detail: 'Sur les **12 factures** arrivées depuis vendredi :\n\n- **10 sont conformes** : quantités, prix et TVA correspondent au bon de commande.\n- **Fournitures Rhône (FR-2291)** facture le carton de gants à 18,00 € HT au lieu de 15,00 € HT prévus au bon de commande CMD-4466 : 36,00 € TTC d’écart sur 10 cartons.\n- **Groupe Froid Alpes (GFA-4410)** a été reçue deux fois : la première a été payée le 2 octobre. La seconde ne doit pas être saisie.',
      fichiers: [{ nom: 'controle-factures-12-octobre.xlsx', type: 'xlsx', taille: '48 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 10 factures conformes vers Pennylane', logiciel: 'Pennylane', fait: '10 factures envoyées vers Pennylane' },
        { id: 'a2', libelle: 'Demander un avoir de 36 € à Fournitures Rhône', logiciel: 'Outlook', fait: 'Demande d’avoir envoyée à Fournitures Rhône' },
        { id: 'a3', libelle: 'Écarter le doublon Groupe Froid Alpes', logiciel: 'Pennylane', fait: 'Doublon écarté : 2 616 € de double paiement évité' }
      ],
      correction: {
        consigne: 'Mets la facture Fournitures Rhône de côté jusqu’à l’avoir',
        apres: {
          resume: '10 factures partent en comptabilité. La facture Fournitures Rhône reste de côté jusqu’à réception de l’avoir.',
          actions: [
            { id: 'a1', libelle: 'Envoyer les 10 factures conformes vers Pennylane', logiciel: 'Pennylane', fait: '10 factures envoyées vers Pennylane' },
            { id: 'a2', libelle: 'Demander un avoir de 36 € à Fournitures Rhône et garder sa facture en attente', logiciel: 'Outlook', fait: 'Avoir demandé, facture Fournitures Rhône mise en attente' },
            { id: 'a3', libelle: 'Écarter le doublon Groupe Froid Alpes', logiciel: 'Pennylane', fait: 'Doublon écarté : 2 616 € de double paiement évité' }
          ]
        }
      }
    },
    {
      id: 't-emails', agent: 'emails', persona: 'chantal', heure: '7 h 15', minutes: 25,
      titre: '5 réponses aux clients,', accent: 'prêtes à partir.',
      resume: 'Chaque réponse s’appuie sur le suivi réel de la commande. Une demande de devis a été transmise à Julien.',
      apercu: {
        type: 'email',
        a: 'Sandrine Vidal · Hôtel des Alpes',
        objet: 'Re : Livraison du lave-vaisselle LV-500',
        corps: 'Bonjour Madame Vidal,\n\nVotre lave-vaisselle LV-500 (commande CMD-4471) a quitté notre entrepôt ce matin. Il vous sera livré jeudi 15 octobre entre 8 h et 12 h ; le transporteur vous appellera la veille.\n\nBien cordialement,\nChantal Morel',
        source: 'Suivi de la commande CMD-4471 dans Sellsy',
        autres: ['Brasserie du Parc · copie de facture', 'Clinique Saint-Roch · délai d’une pièce détachée', 'Boulangerie Fayol · changement d’adresse', 'Lycée Ampère · demande de devis, transmise à Julien']
      },
      detail: '**5 demandes** sont arrivées sur contact@ depuis hier 13 h 30. Pour chacune, Datako a retrouvé la commande ou la facture concernée dans Sellsy, puis rédigé une réponse dans votre ton habituel.\n\nLa demande du **Lycée Ampère** est une demande de devis : elle a été transmise à Julien Roche plutôt que de recevoir une réponse générique.',
      fichiers: [],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 4 réponses depuis Outlook', logiciel: 'Outlook', fait: '4 réponses envoyées depuis Outlook' },
        { id: 'a2', libelle: 'Transmettre la demande du Lycée Ampère à Julien Roche', logiciel: 'Outlook', fait: 'Demande transmise à Julien Roche' }
      ],
      correction: {
        consigne: 'Un ton un peu plus chaleureux',
        apres: {
          apercu: {
            type: 'email',
            a: 'Sandrine Vidal · Hôtel des Alpes',
            objet: 'Re : Livraison du lave-vaisselle LV-500',
            corps: 'Bonjour Madame Vidal,\n\nBonne nouvelle : votre lave-vaisselle LV-500 (commande CMD-4471) est parti de notre entrepôt ce matin ! Il arrivera jeudi 15 octobre entre 8 h et 12 h, et le transporteur vous appellera la veille pour caler le créneau.\n\nN’hésitez pas à m’appeler si besoin. Belle semaine à toute l’équipe de l’hôtel,\nChantal Morel',
            source: 'Suivi de la commande CMD-4471 dans Sellsy',
            autres: ['Brasserie du Parc · copie de facture', 'Clinique Saint-Roch · délai d’une pièce détachée', 'Boulangerie Fayol · changement d’adresse', 'Lycée Ampère · demande de devis, transmise à Julien']
          }
        }
      }
    },
    {
      id: 't-relances', agent: 'relances', persona: 'chantal', heure: '7 h 30', minutes: 30,
      titre: '4 factures clients en retard,', accent: '18 450 € à récupérer.',
      resume: 'Le ton de chaque relance dépend du retard. Pour Traiteur Delorme, un appel est conseillé.',
      apercu: {
        type: 'tableau',
        colonnes: ['Client', 'Montant', 'Retard', 'Ton'],
        lignes: [
          ['Brasserie du Parc', '2 340 €', '18 j', 'Courtois'],
          ['Clinique Saint-Roch', '9 870 €', '32 j', 'Courtois'],
          ['Camping Les Pins', '1 980 €', '47 j', 'Ferme'],
          ['Traiteur Delorme', '4 260 €', '61 j', 'Ferme + appel']
        ]
      },
      detail: '**4 factures** sont échues et non réglées, pour **18 450 €** au total.\n\n- Moins de 45 jours de retard : relance **courtoise**, rappel de la facture en pièce jointe.\n- Plus de 45 jours : relance **ferme**, rappel des pénalités prévues aux conditions générales.\n- **Traiteur Delorme** en est à sa troisième relance : un appel est plus efficace qu’un nouvel e-mail.',
      fichiers: [{ nom: 'relances-12-octobre.pdf', type: 'pdf', taille: '212 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 4 relances depuis Outlook', logiciel: 'Outlook', fait: '4 relances envoyées' },
        { id: 'a2', libelle: 'Ajouter « Appeler Traiteur Delorme » à mon agenda demain 10 h', logiciel: 'Outlook', fait: 'Rappel ajouté à votre agenda' }
      ],
      correction: {
        consigne: 'Reste courtois avec Traiteur Delorme, c’est un bon client',
        apres: {
          resume: 'Le ton de chaque relance dépend du retard. Traiteur Delorme reçoit une relance courtoise, avec un appel conseillé.',
          apercu: {
            type: 'tableau',
            colonnes: ['Client', 'Montant', 'Retard', 'Ton'],
            lignes: [
              ['Brasserie du Parc', '2 340 €', '18 j', 'Courtois'],
              ['Clinique Saint-Roch', '9 870 €', '32 j', 'Courtois'],
              ['Camping Les Pins', '1 980 €', '47 j', 'Ferme'],
              ['Traiteur Delorme', '4 260 €', '61 j', 'Courtois + appel']
            ]
          }
        }
      }
    },
    {
      id: 't-synthese', agent: 'synthese', persona: 'marc', heure: '7 h 45', minutes: 60,
      titre: 'Votre semaine en une page :', accent: 'ventes en hausse de 8 %.',
      resume: 'Bonne semaine commerciale. Trois devis importants attendent une réponse depuis dix jours.',
      apercu: {
        type: 'document',
        entete: 'Synthèse · semaine 41',
        lignes: [
          ['Chiffre d’affaires', '214 300 € HT', '+ 8 %'],
          ['Commandes', '63', 'dont 4 de plus de 10 000 €'],
          ['Devis sans réponse', '52 000 €', '3 devis de plus de 10 jours'],
          ['Factures en retard', '18 450 €', 'relances préparées']
        ]
      },
      detail: '**Semaine 41 (du 5 au 9 octobre)**\n\n- **Ventes** : 214 300 € HT, + 8 % par rapport à la semaine 40, portées par la restauration collective.\n- **Commandes** : 63, dont 4 de plus de 10 000 €.\n- **À surveiller** : 3 devis de plus de 10 000 € sans réponse depuis 10 jours (52 000 € au total) : Hôtel du Lac, Clinique Saint-Roch, Lycée Ampère.\n- **Trésorerie** : 18 450 € de factures en retard ; les relances sont prêtes chez Chantal.',
      fichiers: [{ nom: 'synthese-semaine-41.pdf', type: 'pdf', taille: '386 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer la synthèse aux 3 commerciaux', logiciel: 'Outlook', fait: 'Synthèse envoyée aux 3 commerciaux' }
      ],
      correction: {
        consigne: 'Ajoute le détail des 3 devis sans réponse',
        apres: {
          resume: 'Bonne semaine commerciale. Le détail des trois devis en attente est ajouté en fin de synthèse.',
          apercu: {
            type: 'document',
            entete: 'Synthèse · semaine 41',
            lignes: [
              ['Chiffre d’affaires', '214 300 € HT', '+ 8 %'],
              ['Commandes', '63', 'dont 4 de plus de 10 000 €'],
              ['Hôtel du Lac', '24 500 €', 'devis du 30 septembre'],
              ['Clinique Saint-Roch', '15 300 €', 'devis du 1er octobre'],
              ['Lycée Ampère', '12 200 €', 'devis du 2 octobre']
            ]
          }
        }
      }
    },
    {
      id: 't-devis', agent: 'devis', persona: 'marc', jour: 'hier', heure: '18 h 10', minutes: 35,
      titre: 'Devis Hôtel des Alpes :', accent: '14 820 € HT, à approuver.',
      resume: 'Préparé à la demande de Julien Roche. Au-delà de 10 000 €, votre accord est requis avant l’envoi.',
      demandePar: 'Julien Roche',
      apercu: {
        type: 'document',
        entete: 'Devis D-2026-118 · Hôtel des Alpes',
        lignes: [
          ['Lave-vaisselle à capot LV-500', '1', '7 300 €'],
          ['Four mixte 10 niveaux FM-10', '1', '7 500 €'],
          ['Installation et mise en service', '1', '800 €'],
          ['Remise client fidèle (5 %)', '', '− 780 €'],
          ['Total HT', '', '14 820 €']
        ]
      },
      detail: 'Devis préparé à partir de la demande de Julien Roche et des **3 derniers devis** acceptés par l’Hôtel des Alpes.\n\n- Références retrouvées au catalogue : **LV-500** et **FM-10**.\n- **Remise de 5 %**, identique à celle des derniers devis de ce client.\n- Délai de livraison indiqué : 3 semaines, selon le stock actuel.',
      fichiers: [{ nom: 'devis-D-2026-118.docx', type: 'docx', taille: '94 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer le devis à Sandrine Vidal (Hôtel des Alpes)', logiciel: 'Outlook', fait: 'Devis envoyé à l’Hôtel des Alpes' },
        { id: 'a2', libelle: 'Enregistrer le devis dans Sellsy', logiciel: 'Sellsy', fait: 'Devis enregistré dans Sellsy' }
      ],
      correction: {
        consigne: 'Passe la remise à 3 %',
        apres: {
          accent: '15 132 € HT, à approuver.',
          resume: 'Remise ramenée à 3 % comme demandé. Au-delà de 10 000 €, votre accord est requis avant l’envoi.',
          apercu: {
            type: 'document',
            entete: 'Devis D-2026-118 · Hôtel des Alpes',
            lignes: [
              ['Lave-vaisselle à capot LV-500', '1', '7 300 €'],
              ['Four mixte 10 niveaux FM-10', '1', '7 500 €'],
              ['Installation et mise en service', '1', '800 €'],
              ['Remise client fidèle (3 %)', '', '− 468 €'],
              ['Total HT', '', '15 132 €']
            ]
          }
        }
      }
    }
  ],

  /* Réponses scénarisées de l'agent « Questions sur vos documents » */
  reponsesDocuments: {
    'Quelle est la garantie du four FM-10 ?': {
      texte: 'Le four mixte **FM-10** est garanti **2 ans pièces et main-d’œuvre** [1], à condition que la mise en service ait été faite par un technicien agréé. L’entretien annuel est obligatoire pour conserver la garantie [2].',
      sources: ['Fiche produit FM-10 (2026).pdf', 'Conditions générales de garantie.pdf']
    },
    'Quel délai de paiement avons-nous avec Groupe Froid Alpes ?': {
      texte: 'Le contrat cadre prévoit un paiement **à 45 jours fin de mois** [1]. Un escompte de 1 % s’applique en cas de paiement sous 10 jours, selon l’avenant de janvier 2026 [2].',
      sources: ['Contrat cadre Groupe Froid Alpes.pdf', 'Avenant n° 2 — janvier 2026.pdf']
    },
    'Comment traiter un retour SAV ?': {
      texte: 'La procédure tient en trois temps [1] :\n\n- ouvrir un ticket dans Sellsy avec le numéro de série ;\n- envoyer au client l’étiquette de retour prépayée ;\n- prévenir l’atelier, qui s’engage à diagnostiquer sous 48 h [2].',
      sources: ['Procédure SAV — version 4.docx', 'Engagements de service atelier.pdf']
    }
  },
  reponseInconnue: 'Je n’ai pas trouvé de réponse fiable dans vos documents. Plutôt que d’inventer, je transmets la question à Camille, votre conseillère Datako : si le sujet revient souvent, elle ajoutera les bons documents.',

  /* ---------- Agents proposés par la conseillère ---------- */
  bientot: [
    { id: 'notes-de-frais', nom: 'Notes de frais', icone: 'recu', texte: 'Vérifie chaque justificatif et prépare l’export comptable, chaque vendredi.' },
    { id: 'interventions', nom: 'Planning des interventions', icone: 'calendrier', texte: 'Propose le planning des techniciens selon les urgences et les trajets.' },
    { id: 'appels-offres', nom: 'Veille appels d’offres', icone: 'boussole', texte: 'Repère chaque semaine les marchés publics qui correspondent à votre catalogue.' }
  ],

  /* ---------- Bilan (réservé à la direction) ---------- */
  bilan: {
    depuis: 'juillet',
    heures: 196,
    parMois: [
      { mois: 'Juillet', heures: 41 },
      { mois: 'Août', heures: 33 },
      { mois: 'Septembre', heures: 84 },
      { mois: 'Octobre', heures: 38, enCours: true }
    ],
    journee: 7,
    chiffres: [
      { valeur: '642', libelle: 'factures contrôlées' },
      { valeur: '5 870 €', libelle: 'de doublons évités' },
      { valeur: '318', libelle: 'réponses aux clients' },
      { valeur: '41 200 €', libelle: 'encaissés après relance' },
      { valeur: '24', libelle: 'devis préparés' }
    ],
    qualite: { sansCorrection: 93, minutesValidation: 2 },
    enveloppe: { consomme: 31, projection: 79, alerte: 90, jour: 12, joursMois: 31 },
    parAgent: [
      { agent: 'factures', part: 34 },
      { agent: 'emails', part: 27 },
      { agent: 'devis', part: 18 },
      { agent: 'relances', part: 9 },
      { agent: 'synthese', part: 7 },
      { agent: 'documents', part: 5 }
    ],
    acces: [
      { nom: 'Marc Bastide', initiales: 'MB', email: 'marc.bastide@bastide-equipements.fr', role: 'direction', agents: 'Tous les agents' },
      { nom: 'Chantal Morel', initiales: 'CM', email: 'chantal.morel@bastide-equipements.fr', role: 'finance', agents: 'Factures, e-mails, relances, documents' },
      { nom: 'Julien Roche', initiales: 'JR', email: 'julien.roche@bastide-equipements.fr', role: 'commercial', agents: 'Devis, documents' },
      { nom: 'Sophie Lambert', initiales: 'SL', email: 'sophie.lambert@bastide-equipements.fr', role: 'client', agents: 'E-mails, documents' }
    ],
    logiciels: [
      { nom: 'Outlook', depuis: 'juillet' },
      { nom: 'Pennylane', depuis: 'juillet' },
      { nom: 'Sellsy', depuis: 'août' },
      { nom: 'SharePoint', depuis: 'septembre' }
    ]
  },

  /* ---------- Studio Datako (côté équipe Datako) ---------- */
  studio: {
    exemple: {
      fichier: 'notes-de-frais.zip',
      taille: '184 Ko',
      arborescence: [
        { nom: 'notes-de-frais/', niveau: 0, dossier: true },
        { nom: 'SKILL.md', niveau: 1 },
        { nom: 'politique-depenses.md', niveau: 1 },
        { nom: 'modele-rapport.xlsx', niveau: 1 },
        { nom: 'scripts/', niveau: 1, dossier: true },
        { nom: 'verifier_justificatifs.py', niveau: 2 }
      ],
      nom: 'notes-de-frais',
      description: 'Contrôle les notes de frais déposées par les collaborateurs, vérifie chaque justificatif au regard de la politique de dépenses et prépare l’export comptable.'
    },
    fiche: {
      nom: 'Notes de frais',
      icone: 'recu',
      roles: ['finance', 'direction'],
      logiciels: ['Outlook', 'Pennylane'],
      declencheur: 'vendredi',
      validation: ['ecrire', 'email']
    },
    icones: ['recu', 'facture', 'horloge', 'mail', 'devis', 'calendrier', 'documents', 'synthese'],
    logiciels: ['Outlook', 'Pennylane', 'Sellsy', 'SharePoint', 'Teams'],
    declencheurs: [
      { id: 'demande', libelle: 'À la demande', rythme: 'À la demande' },
      { id: 'matin', libelle: 'Chaque matin à 7 h', rythme: 'Chaque matin à 7 h', passages: [{ jours: [1, 2, 3, 4, 5], heure: 7 }] },
      { id: 'vendredi', libelle: 'Chaque vendredi à 16 h', rythme: 'Chaque vendredi à 16 h', passages: [{ jours: [5], heure: 16 }] },
      { id: 'email', libelle: 'À l’arrivée d’un e-mail', rythme: 'À l’arrivée d’un e-mail' }
    ],
    validations: [
      { id: 'ecrire', libelle: 'Écrire dans la comptabilité' },
      { id: 'email', libelle: 'Envoyer un e-mail' },
      { id: 'agenda', libelle: 'Modifier un agenda' },
      { id: 'supprimer', libelle: 'Supprimer un élément' }
    ],
    apercu: {
      titre: '9 notes de frais contrôlées,',
      accent: 'un justificatif manquant.',
      resume: '8 notes respectent la politique de dépenses. Il manque le ticket d’un repas du 7 octobre.'
    },
    clients: [
      { id: 'bastide', nom: 'Bastide Équipements', ville: 'Lyon', coche: true },
      { id: 'lavigne', nom: 'Transports Lavigne', ville: 'Valence', coche: false },
      { id: 'orsay', nom: 'Cabinet Orsay Conseil', ville: 'Paris', coche: false }
    ]
  },

  /* ---------- Vitrine ---------- */
  vitrine: {
    journee: [
      { heure: '7 h 00', ciel: 'aube', agent: 'Contrôle des factures', titre: 'Datako ouvre *la boîte factures.*',
        texte: '12 factures arrivées depuis vendredi. Chacune est lue, comparée au bon de commande et au tarif négocié.' },
      { heure: '7 h 15', ciel: 'aube', agent: 'Réponses aux e-mails clients', titre: 'Chaque client a *sa réponse.*',
        texte: 'Cinq demandes reçues hier soir. Une réponse est rédigée pour chacune, dans votre ton, avec le vrai suivi de commande.' },
      { heure: '8 h 40', ciel: 'matin', humain: true, qui: 'Chantal valide', titre: 'Chantal arrive. *Six minutes suffisent.*',
        texte: 'Elle relit, corrige une phrase, valide. Les factures partent dans Pennylane, les réponses depuis Outlook. Rien n’est parti sans elle.' },
      { heure: '14 h 00', ciel: 'jour', agent: 'Préparation de devis', titre: 'Un devis *en dix minutes.*',
        texte: 'Julien transmet la demande d’un client. Datako prépare le devis à partir de vos tarifs et de vos devis passés. Julien relit, Marc approuve.' },
      { heure: '18 h 00', ciel: 'soir', humain: true, qui: 'Fin de journée', titre: 'Marc ferme son ordinateur *à l’heure.*',
        texte: 'Lundi matin, la synthèse de la semaine l’attendra. Ce mois-ci, Datako a déjà rendu 38 heures à son équipe.' }
    ],
    simulateur: { personnes: 3, heures: 4, tache: 'factures', part: 0.75 },
    taches: [
      { id: 'factures', libelle: 'les factures fournisseurs' },
      { id: 'emails', libelle: 'les e-mails clients' },
      { id: 'relances', libelle: 'les relances' },
      { id: 'devis', libelle: 'les devis' },
      { id: 'reporting', libelle: 'le reporting' }
    ]
  }
};
