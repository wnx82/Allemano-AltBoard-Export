# Journal des modifications

Deux versions, chacune en SemVer : le **site** (`web/package.json`) et l'**agent**
(`agent/Directory.Build.props`, étiquette `agent-vX.Y.Z` pour une release). Le pied de page du
tableau de bord affiche les deux. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## Site 0.2.1 — 2026-10-30

### Corrigé

- Page **Machines** : le bouton **Télécharger l'agent** passe en haut de la page. Il restait sous
  les cartes des machines, invisible sans faire défiler.

## Site 0.2.0 — 2026-10-29

### Ajouté

- Page **Machines** : l'agent se télécharge depuis le site, en archive ZIP de 6,8 Mo avec ses
  instructions (`LISEZMOI.txt`), ou en exécutable seul de 11,8 Mo, avec sa version et son
  empreinte SHA-256. L'image le publie depuis les sources du dépôt ; session requise (`GET /api/agent/zip`,
  `GET /api/agent`).
- Instructions d'installation : les addons AltBoard et Allemano Ledger vont dans
  `_forever_\Interface\AddOns`.

### Production

- Fin de la bêta : base sauvegardée, puis personnages de la bêta réinitialisés (14 supprimés) ;
  les fichiers de la bêta renvoyés ensuite sont ignorés.
- Serveurs surveillés : portail européen `eu.actual.battle.net:1119` à la place de celui de la bêta,
  libellé « EU », historique de la bêta effacé. Aucune adresse de jeu européenne n'est encore
  vérifiée.

## Agent 0.4.1 — 2026-10-29

### Corrigé

- Le dossier par défaut était le client de la bêta (`…\World of Warcraft\_classic_beta_`) : à la
  sortie officielle, l'agent n'aurait pas lu le nouveau client. Le défaut devient la racine
  `World of Warcraft`, qui lit chaque client installé, et une configuration fixée sur
  `_classic_beta_` passe d'elle-même à la racine qui le contient.

## Agent 0.4.0 — 2026-10-07

### Ajouté

- Saisie du jeton dans la fenêtre : plus besoin de ligne de commande pour installer un PC.

## Agent 0.3.0 — 2026-10-06

### Ajouté

- Fenêtre de l'agent et journal des modifications envoyées, personnage par personnage.

## Agent 0.2.0 — 2026-10-06

### Ajouté

- Synchronisation automatique (`watch`) à chaque écriture du jeu, démarrage à l'ouverture de
  session, icône dans la zone de notification.

## Site 0.1.0 — 2026-10-04 au 2026-10-16

Première mise en ligne le 2026-10-04, puis évolutions publiées sans changement de version.

### Ajouté

- `POST /api/sync` authentifié par jeton, validé, transactionnel et idempotent.
- Tableau de bord : personnages regroupés par compte, fiche personnage, comptes, machines et
  jetons, export Excel.
- Temps de jeu par niveau, sessions et courbe d'expérience (addon Allemano Ledger).
- Pages **Métiers**, **Activité** et **Niveaux**.
- État des serveurs WoW Forever EU (page **Serveurs**, miniatures sur l'accueil), contrôlés toutes
  les cinq minutes.
- Page **Paramètres** : serveurs surveillés réglables, réinitialisation des personnages pour la
  sortie officielle.
- Versions du site et de l'agent en pied de page.

### Exploitation

- Pile Komodo sur Proxmox (2026-10-05), déploiement automatique à chaque push sur `main`,
  sauvegarde quotidienne, surveillance par Prometheus, alerte ntfy des déploiements en échec.

### Sécurité

- Session vérifiée par chaque page du tableau de bord, préchargements compris (2026-10-11).

## Agent 0.1.0 — 2026-10-04

### Ajouté

- Commande `sync` : découverte des comptes, lecture stable de `AltBoard.lua` et
  `AllemanoLedger.lua`, parser SavedVariables, envoi au serveur.
