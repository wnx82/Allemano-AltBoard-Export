# Roadmap

Statuts : ⬜ À faire · 🟡 En cours · ✅ Validé · 🔴 Bloqué

Une étape n'est ✅ que si elle est implémentée, testée et vérifiée sur un résultat réel.
« Local » désigne le poste de développement : agent réel, fichiers `AltBoard.lua` réels,
PostgreSQL 17 en Docker, application en mode production.

Dernière mise à jour : 2026-10-04.

## Synthèse

| | |
|---|---|
| Chaîne complète en local, sur fichiers réels | ✅ |
| Mise en production (`wow.ekreativ.be`) | ⬜ en attente d'accord : création de base, DNS, Traefik |
| Recette après une vraie modification en jeu | ⬜ à faire par le joueur (`/reload` puis `sync`) |
| Tests automatisés | 111 (agent) + 53 (web), tous verts |

## P0 — Analyse

| Étape | Statut | Preuve |
|---|---|---|
| Dépôt | ✅ | [ARCHITECTURE-CURRENT](ARCHITECTURE-CURRENT.md) |
| Environnement | ✅ | idem |
| `AltBoard.lua` | ✅ | 2 fichiers réels, 6 personnages |
| `AltBoardDB` | ✅ | [ALTBOARD-DATA-MODEL](ALTBOARD-DATA-MODEL.md), source de l'addon lu |
| PostgreSQL | 🔴 | inventaire de production refusé par le garde-fou de la session ; instance locale utilisée à la place |

**Checkpoint A** ✅ — machine, compte, royaume et personnage identifiables sans ambiguïté.

## P1 — Modèle de données

| Étape | Statut |
|---|---|
| Modèle AltBoard réel | ✅ |
| Schéma relationnel | ✅ |
| Stratégie d'identifiants (GUID, empreinte de compte, UUID de machine) | ✅ |
| Snapshots | ✅ |
| Synchronisations | ✅ |

## P2 — PostgreSQL

| Étape | Statut | Note |
|---|---|---|
| Base dédiée | 🟡 | ✅ en local ; ⬜ en production |
| Migrations | ✅ | appliquées en local, y compris depuis l'image Docker |
| Contraintes | ✅ | vérifiées dans l'instance et par tests |
| Index essentiels | ✅ | |
| Validation dans l'instance de production | ⬜ | [DEPLOYMENT § 4](DEPLOYMENT.md) |

**Checkpoint B** 🟡 — ✅ en local (19 tables, 19 PK, 19 FK, 8 UNIQUE, 5 CHECK) ; ⬜ en production.

## P3 — Parser

| Étape | Statut |
|---|---|
| Lecture Lua | ✅ |
| Normalisation | ✅ |
| Fixtures (réelles anonymisées + cas limites) | ✅ |
| Tests | ✅ |

**Checkpoint C** ✅ — fichiers réels comparés à l'objet produit par l'agent, au moyen d'un second
parser indépendant : 6 personnages, 3 144 comparaisons, 0 écart.

## P4 — Agent Windows manuel

| Étape | Statut |
|---|---|
| Détection de WoW | ✅ |
| Détection des comptes | ✅ |
| Parsing | ✅ |
| UUID de machine | ✅ |
| Configuration | ✅ |
| `sync` | ✅ en local ; ⬜ contre le serveur de production |

## P5 — API

| Étape | Statut |
|---|---|
| Point d'entrée | ✅ |
| Authentification | ✅ |
| Validation | ✅ |
| Transactions | ✅ |
| Upsert | ✅ |
| Idempotence | ✅ |

**Checkpoint D** ✅ — même document envoyé dix fois (test) et fichiers réels synchronisés deux fois
de suite : aucun doublon, 6 personnages inchangés.

## P6 — Tableau de bord

| Étape | Statut |
|---|---|
| Accueil | ✅ |
| Statistiques | ✅ |
| Cartes personnages | ✅ |
| Recherche | ✅ |
| Filtres | ✅ |
| Tri | ✅ |
| Vue cartes / tableau mémorisée | ✅ |
| Adaptation aux écrans (390 à 1920 px) | ✅ |

## P7 — Personnage

| Étape | Statut | Note |
|---|---|---|
| Vue générale | ✅ | |
| Métiers | ✅ | |
| Équipement | ✅ | enchantement : identifiant seulement (le nom n'existe pas dans AltBoard) |
| Monnaies | ✅ | |
| Réputations | ✅ | |
| Inventaire (sacs, banque, recherche) | ✅ | |
| Historique | ✅ | vérifié sur un personnage de démonstration ; les personnages réels n'ont qu'un relevé |

**Checkpoint E** 🟡 — ✅ en local : `AltBoard.lua` ↔ base (138 comparaisons) ↔ pages (122
comparaisons), 0 écart sur les 6 personnages réels ; ⬜ à rejouer en production.

## P8 — Comptes et machines

| Étape | Statut |
|---|---|
| Comptes (noms d'affichage) | ✅ |
| Machines (noms d'affichage, jetons) | ✅ |
| Dernière synchronisation, journal | ✅ |

## P9 — Excel

| Étape | Statut |
|---|---|
| Génération XLSX | ✅ |
| Multi-feuilles (8) | ✅ |
| Téléchargement | ✅ |

## P10 — Sécurité

| Étape | Statut | Note |
|---|---|---|
| Authentification web | ✅ | |
| Jeton d'agent | ✅ | |
| Validation | ✅ | |
| Limitation de débit | ✅ | en mémoire : valable pour une instance unique |
| Secrets | ✅ | aucun dans le dépôt |
| En-têtes | ✅ | CSP à nonce vérifiée en mode production, sans violation |

## P11 — Recette réelle

| Étape | Statut | Note |
|---|---|---|
| PC réel | ✅ | local |
| Plusieurs comptes | ✅ | 2 |
| Plusieurs personnages | ✅ | 6 |
| Modifications réelles | ⬜ | aucune modification en jeu depuis la première synchronisation |
| Nouvelle synchronisation | ✅ | sans changement : tout « inchangé » |
| Contrôle de la base | ✅ | local |
| Contrôle de l'interface | ✅ | local |
| Le tout via HTTPS, en production | ⬜ | |

Le critère de réussite de la V1 n'est donc **pas encore atteint** : il manque la mise en production
et la recette après une vraie modification en jeu.

## P12 — Préparation de l'automatisation

| Étape | Statut |
|---|---|
| Surveillance conçue | ✅ documentée dans [AGENT](AGENT.md) |
| Anti-rebond conçu | ✅ |
| Empreinte conçue | ✅ (déjà calculée et stockée à chaque synchronisation) |
| Service futur documenté | ✅ |

Rien n'est implémenté ni activé : la commande `watch` répond qu'elle n'est pas disponible.

## P13 — Préparation de `wow.ekreativ.be`

| Étape | Statut | Note |
|---|---|---|
| Configuration du domaine | ⬜ | DNS et Traefik |
| URLs configurables | ✅ | vérifié à la racine et sous `/wow` |
| Authentification compatible | ✅ | cookie lié à l'hôte, aucun domaine en dur |
| Documentation de migration | ✅ | [DEPLOYMENT](DEPLOYMENT.md) |

## Suite

| Version | Contenu |
|---|---|
| V1 | mise en production, recette réelle |
| V2 | `watch`, démarrage à l'ouverture de session, icône de zone de notification |
| V3 | historique détaillé, comparaison des métiers, activité |
| V4 | n8n, notifications, rapports |
| V5 | installation et mise à jour automatiques de l'agent |

## Écarts par rapport au cahier des charges

| Écart | Raison |
|---|---|
| Pages à la racine (`/`, `/characters/[id]`…) et non sous `/wow` | application autonome sur son sous-domaine ; le préfixe `/wow` reste disponible par configuration |
| `.NET 10` au lieu de `.NET 8` | seul SDK installé ; exécutable autonome, donc sans effet sur les PC cibles |
| Une table `character_items` au lieu de `character_inventory` + `character_bank` | même structure, un discriminant |
| Pas de colonnes genre, région ; pas de tables quêtes, recettes | données absentes d'AltBoard |
| Pas d'icônes d'objet | AltBoard ne fournit que des identifiants de fichier du jeu |
