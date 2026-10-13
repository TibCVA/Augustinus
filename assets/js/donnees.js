/* ==========================================================================
   Datako — Données de démonstration
   --------------------------------------------------------------------------
   C'est LE fichier à modifier pour adapter la maquette : entreprise fictive,
   personnes, agents, tâches du jour, bilan.
   Toutes ces données sont FICTIVES.

   Rappel du principe : chaque « agent » Datako est une skill créée dans
   Claude, accompagnée d'une fiche (nom, icône, rôles, logiciels, horaires,
   actions soumises à validation). L'interface affiche tous les agents
   avec le MÊME écran : ce qu'il utilise → ce qu'il fait → ce qu'il produit.

   Journée type de la démonstration : de 9 h 00 à 17 h 30.
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
    mois: 'octobre',
    debutJournee: 9,         // le planning du jour va de 9 h 00…
    finJournee: 17.5         // … à 17 h 30
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

  /* ---------- Les agents ----------
     rythme.passages : jours (1 = lundi) et heure de chaque passage.
     Un agent « à la demande » n'a pas d'horaire : on le lance soi-même. */
  agents: [
    {
      id: 'factures', nom: 'Contrôle des factures', icone: 'facture', teinte: 'teal',
      skill: 'controle-factures', version: 'v3', majLe: '3 octobre',
      mission: 'Contrôle les factures fournisseurs avec les bons de commande et prépare leur saisie en comptabilité.',
      roles: ['finance', 'direction'],
      logiciels: ['Outlook', 'Pennylane'],
      peutLire: 'la boîte factures@, les bons de commande et les factures déjà saisies',
      attendAccord: ['écrire dans Pennylane', 'envoyer un e-mail à un fournisseur'],
      rythme: { type: 'horaire', libelle: 'Chaque jour à 9 h', passages: [{ jours: [1, 2, 3, 4, 5], heure: 9 }] },
      entree: { type: 'planifie', texte: 'Les factures reçues dans la boîte factures@ depuis le dernier passage et les bons de commande en cours dans Pennylane.' },
      etapes: [
        '12 factures trouvées dans la boîte factures@',
        'Lecture des montants, dates et références',
        'Comparaison avec les 31 bons de commande en cours',
        'Recherche de doublons sur les 12 derniers mois',
        'Préparation du fichier de contrôle et de la saisie Pennylane'
      ],
      travail: 't-factures',
      semaineDerniere: '5 passages · 61 factures'
    },
    {
      id: 'emails', nom: 'Réponses aux e-mails clients', icone: 'mail', teinte: 'bleu',
      skill: 'reponses-clients', version: 'v5', majLe: '28 septembre',
      mission: 'Rédige une réponse à chaque demande client à partir du suivi des commandes.',
      roles: ['finance', 'client', 'direction'],
      logiciels: ['Outlook', 'Sellsy'],
      peutLire: 'la boîte contact@ et le suivi des commandes',
      attendAccord: ['envoyer un e-mail'],
      rythme: { type: 'horaire', libelle: 'Chaque jour à 9 h et 14 h', passages: [{ jours: [1, 2, 3, 4, 5], heure: 9 }, { jours: [1, 2, 3, 4, 5], heure: 14 }] },
      entree: { type: 'planifie', texte: 'Les e-mails reçus sur contact@ depuis le dernier passage.' },
      etapes: [
        '5 demandes reçues sur contact@ depuis vendredi 14 h',
        'Recherche des commandes et des livraisons dans Sellsy',
        'Rédaction des réponses',
        'Repérage d’une demande de devis, pour Julien Roche'
      ],
      travail: 't-emails',
      semaineDerniere: '10 passages · 38 réponses'
    },
    {
      id: 'relances', nom: 'Relances clients', icone: 'horloge', teinte: 'sable',
      skill: 'relances-clients', version: 'v2', majLe: '15 septembre',
      mission: 'Repère les factures clients impayées et prépare les relances, avec un ton adapté au retard.',
      roles: ['finance', 'direction'],
      logiciels: ['Pennylane', 'Outlook'],
      peutLire: 'les factures clients et leurs échéances',
      attendAccord: ['envoyer un e-mail', 'ajouter un rendez-vous à l’agenda'],
      rythme: { type: 'horaire', libelle: 'Lundi et jeudi à 9 h', passages: [{ jours: [1, 4], heure: 9 }] },
      entree: { type: 'planifie', texte: 'Les factures clients impayées dans Pennylane.' },
      etapes: [
        '4 factures impayées trouvées dans Pennylane',
        'Vérification des relances déjà envoyées',
        'Choix du ton selon le retard',
        'Rédaction de 4 relances'
      ],
      travail: 't-relances',
      semaineDerniere: '2 passages · 9 relances'
    },
    {
      id: 'synthese', nom: 'Synthèse de la semaine', icone: 'synthese', teinte: 'marine',
      skill: 'synthese-hebdo', version: 'v4', majLe: '22 septembre',
      mission: 'Résume la semaine en une page : ventes, commandes et points à surveiller.',
      roles: ['direction'],
      logiciels: ['Sellsy', 'Pennylane'],
      peutLire: 'les ventes, les commandes et la trésorerie',
      attendAccord: ['envoyer un e-mail'],
      rythme: { type: 'horaire', libelle: 'Chaque vendredi à 17 h 30', passages: [{ jours: [5], heure: 17.5 }] },
      entree: { type: 'planifie', texte: 'Les ventes et les commandes de la semaine (Sellsy) et la trésorerie (Pennylane).' },
      etapes: [
        'Extraction des ventes et des commandes de la semaine 41',
        'Comparaison avec la semaine 40',
        'Repérage des points à surveiller',
        'Mise en forme de la synthèse (PDF)'
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
          { id: 'client', type: 'choix', libelle: 'Client', options: ['Hôtel des Alpes', 'Brasserie du Parc', 'Clinique Saint-Roch'] },
          { id: 'besoin', type: 'texte', libelle: 'Ce qu’il faut chiffrer', valeur: 'Un lave-vaisselle à capot et un four mixte 10 niveaux pour la cuisine du restaurant, installation comprise.' },
          { id: 'piece', type: 'fichier', libelle: 'Pièce jointe (facultatif)', exemple: 'demande-client.pdf' }
        ],
        bouton: 'Préparer le devis'
      },
      etapes: [
        'Lecture de la demande',
        'Recherche des références au catalogue : LV-500, FM-10',
        'Application des tarifs et de la remise habituelle du client',
        'Mise en forme sur votre modèle de devis (Word)'
      ],
      travail: 't-devis',
      semaineDerniere: '6 devis'
    },
    {
      id: 'documents', nom: 'Questions sur vos documents', icone: 'documents', teinte: 'teal',
      skill: 'documents-bastide', version: 'v2', majLe: '1er octobre',
      mission: 'Répond aux questions de l’équipe à partir de vos documents, en citant ses sources. S’il ne trouve pas la réponse, il le dit.',
      roles: ['finance', 'commercial', 'client', 'direction'],
      logiciels: ['SharePoint'],
      peutLire: 'les contrats, les fiches produits et les procédures sur SharePoint',
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
        'Sélection de 3 passages utiles',
        'Rédaction de la réponse avec ses sources'
      ],
      semaineDerniere: '14 questions'
    }
  ],

  /* ---------- Les tâches à valider ----------
     Chaque tâche apparaît sous forme de carte dans « Aujourd'hui ».
     apercu.type : 'liste' | 'email' | 'tableau' | 'document'
     Les actions sont celles qui attendent un accord humain. */
  travaux: [
    {
      id: 't-factures', agent: 'factures', persona: 'chantal', heure: '9 h 01', minutes: 54,
      titre: '12 factures contrôlées,', accent: '2 à vérifier.',
      resume: '10 factures sont conformes au bon de commande. 2 sont à vérifier avant la saisie en comptabilité.',
      apercu: {
        type: 'liste',
        lignes: [
          { statut: 'ok', texte: '10 factures conformes', detail: '18 942,60 € TTC au total' },
          { statut: 'alerte', texte: 'Fournitures Rhône : prix supérieur au bon de commande', detail: 'Écart de 36,00 € TTC sur la facture FR-2291' },
          { statut: 'alerte', texte: 'Groupe Froid Alpes : facture reçue deux fois', detail: 'GFA-4410 · 2 616,00 € TTC, déjà payée le 2 octobre' }
        ]
      },
      detail: 'Sur les **12 factures** reçues depuis vendredi :\n\n- **10 sont conformes** : quantités, prix et TVA correspondent au bon de commande.\n- **Fournitures Rhône (FR-2291)** facture le carton de gants 18,00 € HT au lieu de 15,00 € HT (bon de commande CMD-4466), soit 36,00 € TTC d’écart sur 10 cartons.\n- La facture **Groupe Froid Alpes (GFA-4410)** a été reçue deux fois. Elle a déjà été payée le 2 octobre : le doublon ne doit pas être saisi.',
      fichiers: [{ nom: 'controle-factures-12-octobre.xlsx', type: 'xlsx', taille: '48 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Saisir les 10 factures conformes dans Pennylane', logiciel: 'Pennylane', fait: '10 factures saisies dans Pennylane' },
        { id: 'a2', libelle: 'Demander un avoir de 36 € à Fournitures Rhône', logiciel: 'Outlook', fait: 'Demande d’avoir envoyée à Fournitures Rhône' },
        { id: 'a3', libelle: 'Écarter le doublon Groupe Froid Alpes', logiciel: 'Pennylane', fait: 'Doublon écarté : paiement en double de 2 616 € évité' }
      ],
      correction: {
        consigne: 'Garde la facture Fournitures Rhône en attente jusqu’à réception de l’avoir',
        apres: {
          resume: '10 factures sont prêtes pour la comptabilité. La facture Fournitures Rhône reste en attente jusqu’à réception de l’avoir.',
          actions: [
            { id: 'a1', libelle: 'Saisir les 10 factures conformes dans Pennylane', logiciel: 'Pennylane', fait: '10 factures saisies dans Pennylane' },
            { id: 'a2', libelle: 'Demander un avoir de 36 € à Fournitures Rhône et garder sa facture en attente', logiciel: 'Outlook', fait: 'Avoir demandé, facture Fournitures Rhône mise en attente' },
            { id: 'a3', libelle: 'Écarter le doublon Groupe Froid Alpes', logiciel: 'Pennylane', fait: 'Doublon écarté : paiement en double de 2 616 € évité' }
          ]
        }
      }
    },
    {
      id: 't-emails', agent: 'emails', persona: 'chantal', heure: '9 h 02', minutes: 25,
      titre: '5 e-mails clients traités :', accent: '4 réponses prêtes.',
      resume: 'Chaque réponse s’appuie sur le suivi de la commande dans Sellsy. Le 5e e-mail est une demande de devis, à transmettre à Julien Roche.',
      apercu: {
        type: 'email',
        a: 'Sandrine Vidal · Hôtel des Alpes',
        objet: 'Re : Livraison du lave-vaisselle LV-500',
        corps: 'Bonjour Madame Vidal,\n\nVotre lave-vaisselle LV-500 (commande CMD-4471) a quitté notre entrepôt ce matin. Il vous sera livré jeudi 15 octobre entre 9 h et 12 h. Le transporteur vous appellera la veille.\n\nBien cordialement,\nChantal Morel',
        source: 'Suivi de la commande CMD-4471 dans Sellsy',
        autres: ['Brasserie du Parc · copie de facture', 'Clinique Saint-Roch · délai d’une pièce détachée', 'Boulangerie Fayol · changement d’adresse']
      },
      detail: '**5 e-mails** sont arrivés sur contact@ depuis vendredi 14 h. Pour chacun, Datako a retrouvé la commande ou la facture dans Sellsy et rédigé une réponse.\n\nL’e-mail du **Lycée Ampère** est une demande de devis : il est à transmettre à Julien Roche.',
      fichiers: [],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 4 réponses depuis Outlook', logiciel: 'Outlook', fait: '4 réponses envoyées' },
        { id: 'a2', libelle: 'Transmettre la demande du Lycée Ampère à Julien Roche', logiciel: 'Outlook', fait: 'Demande transmise à Julien Roche' }
      ],
      correction: {
        consigne: 'Prends un ton un peu plus chaleureux',
        apres: {
          apercu: {
            type: 'email',
            a: 'Sandrine Vidal · Hôtel des Alpes',
            objet: 'Re : Livraison du lave-vaisselle LV-500',
            corps: 'Bonjour Madame Vidal,\n\nBonne nouvelle : votre lave-vaisselle LV-500 (commande CMD-4471) a quitté notre entrepôt ce matin. Il vous sera livré jeudi 15 octobre entre 9 h et 12 h. Le transporteur vous appellera la veille pour confirmer l’horaire.\n\nN’hésitez pas à m’appeler en cas de besoin. Bonne semaine à toute l’équipe de l’hôtel,\nChantal Morel',
            source: 'Suivi de la commande CMD-4471 dans Sellsy',
            autres: ['Brasserie du Parc · copie de facture', 'Clinique Saint-Roch · délai d’une pièce détachée', 'Boulangerie Fayol · changement d’adresse']
          }
        }
      }
    },
    {
      id: 't-relances', agent: 'relances', persona: 'chantal', heure: '9 h 03', minutes: 30,
      titre: '4 factures clients impayées,', accent: '18 450 € à encaisser.',
      resume: 'Le ton de chaque relance dépend du retard. Pour Traiteur Delorme, un appel est recommandé.',
      apercu: {
        type: 'tableau',
        colonnes: ['Client', 'Montant', 'Retard', 'Ton'],
        lignes: [
          ['Brasserie du Parc', '2 340 €', '18 j', 'Courtois'],
          ['Clinique Saint-Roch', '9 870 €', '32 j', 'Courtois'],
          ['Camping Les Pins', '1 980 €', '47 j', 'Ferme'],
          ['Traiteur Delorme', '4 260 €', '61 j', 'Ferme, avec appel']
        ]
      },
      detail: '**4 factures** sont impayées, pour **18 450 €** au total.\n\n- Moins de 45 jours de retard : relance **courtoise**, avec la facture en pièce jointe.\n- Plus de 45 jours : relance **ferme**, avec le rappel des pénalités de retard prévues aux conditions générales.\n- **Traiteur Delorme** a déjà reçu deux relances : un appel est recommandé.',
      fichiers: [{ nom: 'relances-12-octobre.pdf', type: 'pdf', taille: '212 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 4 relances depuis Outlook', logiciel: 'Outlook', fait: '4 relances envoyées' },
        { id: 'a2', libelle: 'Ajouter à mon agenda : appeler Traiteur Delorme demain à 10 h', logiciel: 'Outlook', fait: 'Appel ajouté à votre agenda' }
      ],
      correction: {
        consigne: 'Garde un ton courtois avec Traiteur Delorme : c’est un bon client',
        apres: {
          resume: 'Le ton de chaque relance dépend du retard. Traiteur Delorme reçoit une relance courtoise ; un appel reste recommandé.',
          apercu: {
            type: 'tableau',
            colonnes: ['Client', 'Montant', 'Retard', 'Ton'],
            lignes: [
              ['Brasserie du Parc', '2 340 €', '18 j', 'Courtois'],
              ['Clinique Saint-Roch', '9 870 €', '32 j', 'Courtois'],
              ['Camping Les Pins', '1 980 €', '47 j', 'Ferme'],
              ['Traiteur Delorme', '4 260 €', '61 j', 'Courtois, avec appel']
            ]
          }
        }
      }
    },
    {
      id: 't-synthese', agent: 'synthese', persona: 'marc', jour: 'vendredi', heure: '17 h 30', minutes: 60,
      titre: 'Semaine 41 :', accent: 'ventes en hausse de 8 %.',
      resume: 'Les ventes progressent. 3 devis importants sont sans réponse depuis 10 jours.',
      apercu: {
        type: 'document',
        entete: 'Synthèse · semaine 41',
        lignes: [
          ['Chiffre d’affaires', '214 300 € HT', '+ 8 %'],
          ['Commandes', '63', 'dont 4 de plus de 10 000 €'],
          ['Devis sans réponse', '52 000 €', '3 devis, depuis 10 jours'],
          ['Factures impayées', '18 450 €', 'relances lundi']
        ]
      },
      detail: '**Semaine 41 (du 5 au 9 octobre)**\n\n- **Ventes** : 214 300 € HT, en hausse de 8 % par rapport à la semaine 40, grâce à la restauration collective.\n- **Commandes** : 63, dont 4 de plus de 10 000 €.\n- **À surveiller** : 3 devis de plus de 10 000 € sont sans réponse depuis 10 jours (52 000 € au total) : Hôtel du Lac, Clinique Saint-Roch et Collège Jean-Moulin.\n- **Trésorerie** : 18 450 € de factures impayées. Les relances sont prévues lundi.',
      fichiers: [{ nom: 'synthese-semaine-41.pdf', type: 'pdf', taille: '386 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer la synthèse aux 3 commerciaux', logiciel: 'Outlook', fait: 'Synthèse envoyée aux 3 commerciaux' }
      ],
      correction: {
        consigne: 'Ajoute le détail des 3 devis sans réponse',
        apres: {
          resume: 'Les ventes progressent. Le détail des 3 devis sans réponse est ajouté à la synthèse.',
          apercu: {
            type: 'document',
            entete: 'Synthèse · semaine 41',
            lignes: [
              ['Chiffre d’affaires', '214 300 € HT', '+ 8 %'],
              ['Commandes', '63', 'dont 4 de plus de 10 000 €'],
              ['Hôtel du Lac', '24 500 €', 'devis du 30 septembre'],
              ['Clinique Saint-Roch', '15 300 €', 'devis du 1er octobre'],
              ['Collège Jean-Moulin', '12 200 €', 'devis du 2 octobre']
            ]
          }
        }
      }
    },
    {
      id: 't-devis', agent: 'devis', persona: 'marc', jour: 'vendredi', heure: '16 h 40', minutes: 35,
      titre: 'Devis Hôtel des Alpes :', accent: '14 820 € HT, à valider.',
      resume: 'Demandé par Julien Roche. Au-delà de 10 000 €, votre accord est nécessaire avant l’envoi.',
      demandePar: 'Julien Roche',
      apercu: {
        type: 'document',
        entete: 'Devis D-2026-118 · Hôtel des Alpes',
        lignes: [
          ['Lave-vaisselle à capot LV-500', '1', '7 300 €'],
          ['Four mixte 10 niveaux FM-10', '1', '7 500 €'],
          ['Installation et mise en service', '1', '800 €'],
          ['Remise habituelle (5 %)', '', '− 780 €'],
          ['Total HT', '', '14 820 €']
        ]
      },
      detail: 'Devis préparé à partir de la demande de Julien Roche et des **3 derniers devis** acceptés par l’Hôtel des Alpes.\n\n- Références du catalogue : **LV-500** et **FM-10**.\n- **Remise de 5 %**, comme sur les derniers devis de ce client.\n- Délai de livraison : 3 semaines, selon le stock actuel.',
      fichiers: [{ nom: 'devis-D-2026-118.docx', type: 'docx', taille: '94 Ko' }],
      actions: [
        { id: 'a1', libelle: 'Envoyer le devis à Sandrine Vidal (Hôtel des Alpes)', logiciel: 'Outlook', fait: 'Devis envoyé à l’Hôtel des Alpes' },
        { id: 'a2', libelle: 'Enregistrer le devis dans Sellsy', logiciel: 'Sellsy', fait: 'Devis enregistré dans Sellsy' }
      ],
      correction: {
        consigne: 'Passe la remise à 3 %',
        apres: {
          accent: '15 132 € HT, à valider.',
          resume: 'Remise ramenée à 3 %. Au-delà de 10 000 €, votre accord est nécessaire avant l’envoi.',
          apercu: {
            type: 'document',
            entete: 'Devis D-2026-118 · Hôtel des Alpes',
            lignes: [
              ['Lave-vaisselle à capot LV-500', '1', '7 300 €'],
              ['Four mixte 10 niveaux FM-10', '1', '7 500 €'],
              ['Installation et mise en service', '1', '800 €'],
              ['Remise (3 %)', '', '− 468 €'],
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
      sources: ['Contrat cadre Groupe Froid Alpes.pdf', 'Avenant n° 2, janvier 2026.pdf']
    },
    'Comment traiter un retour SAV ?': {
      texte: 'La procédure compte trois étapes [1] :\n\n- ouvrir un ticket dans Sellsy avec le numéro de série ;\n- envoyer au client l’étiquette de retour prépayée ;\n- prévenir l’atelier, qui établit un diagnostic sous 48 h [2].',
      sources: ['Procédure SAV, version 4.docx', 'Engagements de service de l’atelier.pdf']
    }
  },
  reponseInconnue: 'Je n’ai pas trouvé la réponse dans vos documents. La question est transmise à Camille, votre conseillère Datako, qui pourra ajouter les documents manquants.',

  /* ---------- Agents proposés par la conseillère ---------- */
  bientot: [
    { id: 'notes-de-frais', nom: 'Notes de frais', icone: 'recu', texte: 'Vérifie les justificatifs et prépare la saisie comptable, chaque vendredi.' },
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
      { valeur: '5 870 €', libelle: 'de paiements en double évités' },
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
  }
};
