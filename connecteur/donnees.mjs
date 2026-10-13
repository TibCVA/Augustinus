/* ==========================================================================
   Datako — Données de démonstration du connecteur (MVP)
   Les mêmes personnages et tâches que la maquette, en version compacte.
   En production, ces données viendraient de la base Datako, alimentée par
   les agents (tâches planifiées) et filtrées selon l'utilisateur connecté.
   ========================================================================== */

export const ENTREPRISE = { nom: 'Bastide Équipements', initiales: 'BÉ' };

export const UTILISATEUR = { prenom: 'Chantal', nom: 'Morel', role: 'finance' };

export const AGENTS = [
  { id: 'factures', nom: 'Contrôle des factures', rythme: 'Chaque jour à 9 h', roles: ['finance', 'direction'],
    mission: 'Contrôle les factures fournisseurs avec les bons de commande et prépare leur saisie en comptabilité.' },
  { id: 'emails', nom: 'Réponses aux e-mails clients', rythme: 'Chaque jour à 9 h et 14 h', roles: ['finance', 'client', 'direction'],
    mission: 'Rédige une réponse à chaque demande client à partir du suivi des commandes.' },
  { id: 'relances', nom: 'Relances clients', rythme: 'Lundi et jeudi à 9 h', roles: ['finance', 'direction'],
    mission: 'Repère les factures clients impayées et prépare les relances.' },
  { id: 'documents', nom: 'Questions sur vos documents', rythme: 'À la demande', roles: ['finance', 'commercial', 'client', 'direction'],
    mission: 'Répond aux questions de l’équipe à partir de vos documents, en citant ses sources.' }
];

export function tachesInitiales() {
  return [
    {
      id: 't-factures', agent: 'factures', heure: '9 h 01', statut: 'a-valider',
      titre: '12 factures contrôlées, 2 à vérifier',
      resume: '10 factures sont conformes au bon de commande. 2 sont à vérifier avant la saisie en comptabilité.',
      points: [
        { statut: 'ok', texte: '10 factures conformes · 18 942,60 € TTC' },
        { statut: 'alerte', texte: 'Fournitures Rhône : prix supérieur au bon de commande (écart de 36 € TTC)' },
        { statut: 'alerte', texte: 'Groupe Froid Alpes : facture reçue deux fois, déjà payée le 2 octobre' }
      ],
      actions: [
        { id: 'a1', libelle: 'Saisir les 10 factures conformes dans Pennylane', logiciel: 'Pennylane' },
        { id: 'a2', libelle: 'Demander un avoir de 36 € à Fournitures Rhône', logiciel: 'Outlook' },
        { id: 'a3', libelle: 'Écarter le doublon Groupe Froid Alpes', logiciel: 'Pennylane' }
      ]
    },
    {
      id: 't-emails', agent: 'emails', heure: '9 h 02', statut: 'a-valider',
      titre: '5 e-mails clients traités : 4 réponses prêtes',
      resume: 'Chaque réponse s’appuie sur le suivi de la commande dans Sellsy. Le 5e e-mail est une demande de devis, à transmettre à Julien Roche.',
      points: [
        { statut: 'ok', texte: 'Hôtel des Alpes · livraison du lave-vaisselle LV-500 jeudi' },
        { statut: 'ok', texte: 'Brasserie du Parc · copie de facture' },
        { statut: 'ok', texte: 'Clinique Saint-Roch · délai d’une pièce détachée' },
        { statut: 'ok', texte: 'Boulangerie Fayol · changement d’adresse' }
      ],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 4 réponses depuis Outlook', logiciel: 'Outlook' },
        { id: 'a2', libelle: 'Transmettre la demande du Lycée Ampère à Julien Roche', logiciel: 'Outlook' }
      ]
    },
    {
      id: 't-relances', agent: 'relances', heure: '9 h 03', statut: 'a-valider',
      titre: '4 factures clients impayées, 18 450 € à encaisser',
      resume: 'Le ton de chaque relance dépend du retard. Pour Traiteur Delorme, un appel est recommandé.',
      points: [
        { statut: 'ok', texte: 'Brasserie du Parc · 2 340 € · 18 jours · courtois' },
        { statut: 'ok', texte: 'Clinique Saint-Roch · 9 870 € · 32 jours · courtois' },
        { statut: 'alerte', texte: 'Camping Les Pins · 1 980 € · 47 jours · ferme' },
        { statut: 'alerte', texte: 'Traiteur Delorme · 4 260 € · 61 jours · ferme, avec appel' }
      ],
      actions: [
        { id: 'a1', libelle: 'Envoyer les 4 relances depuis Outlook', logiciel: 'Outlook' },
        { id: 'a2', libelle: 'Ajouter à mon agenda : appeler Traiteur Delorme demain à 10 h', logiciel: 'Outlook' }
      ]
    }
  ];
}
