# Architecture

## Vue d'ensemble

```text
┌────────────────────────────── PC Windows (1 à n) ──────────────────────────────┐
│  WTF\Account\<COMPTE>\SavedVariables\AltBoard.lua   (lecture seule)             │
│                         │                                                       │
│  AltBoardSync.exe  ─ découverte ─ lecture stable ─ parser ─ normalisation       │
└─────────────────────────┬──────────────────────────────────────────────────────┘
                          │  HTTPS, JSON versionné, jeton d'agent
                          ▼
┌───────────────────────── Application web (Next.js) ────────────────────────────┐
│  POST /api/sync : jeton → limites → schéma strict → transaction d'upsert        │
│  Pages : / · /characters/[id] · /accounts · /machines   (session requise)       │
│  GET /api/export/xlsx · GET /api/health                                         │
└─────────────────────────┬──────────────────────────────────────────────────────┘
                          ▼
                PostgreSQL — base dédiée wow_altboard
```

Trois notions sont strictement séparées, du fichier jusqu'à la base : **machine** (un PC),
**compte** (un dossier `WTF\Account`), **personnage** (un GUID).

## Agent (`agent/`)

| Module | Rôle |
|---|---|
| `Lua/SavedVariablesParser` | Lit les littéraux Lua (nil, booléen, nombre, chaîne, table). N'exécute rien ; profondeur bornée ; erreurs localisées (ligne, colonne) |
| `AltBoard/AltBoardReader` | Convertit `AltBoardDB` vers le modèle de synchronisation. Tolérant : champ absent, mal typé ou inconnu = avertissement |
| `Discovery/AccountScanner` | Trouve chaque `SavedVariables\AltBoard.lua` ; aucun nombre de comptes codé en dur |
| `IO/StableFileReader` | Ne lit que si taille et date sont stables avant et après ; partage total, jamais d'écriture |
| `Sync/PayloadBuilder`, `SyncClient` | Construit le document v1 et l'envoie ; HTTPS obligatoire hors localhost |
| `Config/*` | `machine_uuid` persistant, jeton chiffré par DPAPI |
| `App/AgentApp` | Ligne de commande ; entièrement testable (sorties, HTTP et horloge injectés) |

L'agent n'interprète pas les données : il transmet ce qu'AltBoard a écrit, borné aux mêmes limites
que le schéma du serveur. Toute décision métier (fraîcheur, historique) est prise côté serveur.

## Application web (`web/`)

| Dossier | Rôle |
|---|---|
| `src/db` | Schéma Drizzle (source unique), migrations SQL générées, garde-fou de cible |
| `src/lib/sync` | Schéma Zod du document, traitement transactionnel, gestionnaire HTTP |
| `src/lib/dashboard` | Lectures en nombre fixe de requêtes, historique, export, actions serveur |
| `src/lib/auth` | Mots de passe scrypt, sessions en base, cookie |
| `src/lib/xlsx` | Écriture XLSX sans dépendance |
| `src/app` | Pages et routes ; `src/proxy.ts` pose la CSP et filtre les requêtes sans session |

## Décisions

| Décision | Raison |
|---|---|
| Application **autonome**, sur `wow.ekreativ.be` | Aucun couplage au site commercial `ekreativ.be` (cycle de version, proxy, CSP, 54 tables). Pas de migration ultérieure |
| **Base dédiée** `wow_altboard`, rôle applicatif dédié | Isolation, sauvegarde et restauration indépendantes |
| Variables d'environnement préfixées `WOW_` + refus des bases étrangères | Un `TEST_DATABASE_URL` générique d'un autre projet a fait viser la mauvaise base pendant le développement |
| **Drizzle** plutôt que Prisma | Upserts conditionnels et `ON CONFLICT` écrits tels quels ; migrations SQL lisibles |
| Personnage identifié par **GUID** | Le nom n'est pas unique sur ce client ; le GUID l'est |
| Compte identifié par une **empreinte** du nom de dossier | Stable entre PC, et le nom réel n'est jamais transmis |
| Fraîcheur décidée par `lastSeen`, bloc par bloc | Deux PC peuvent détenir des fichiers d'âges différents |
| Snapshots dédupliqués par hash de **progression** | Une simple connexion ne crée pas d'historique |
| Agent en `.NET 10` autonome | Aucun runtime à installer sur les PC ; seul le SDK 10 est présent sur le poste de développement |
| Authentification du tableau de bord **maison** | Un seul utilisateur ; moins de dépendances qu'une bibliothèque en version bêta |
| Aucune image ni icône du jeu | Pas d'actif Blizzard ; les icônes d'AltBoard sont des identifiants de fichier inutilisables hors du jeu |
| XLSX écrit sans bibliothèque | La seule bibliothèque courante embarque une dépendance signalée ; elle ne sert qu'aux tests, pour relire |

## Ce qui est prévu mais non activé

- Synchronisation automatique (`watch`), service Windows : conçus dans [AGENT](AGENT.md), absents de la V1.
- n8n, notifications, API Battle.net : hors périmètre ; rien dans le pipeline n'en dépend.
- Plusieurs instances web : la limitation de débit est en mémoire (voir [SECURITY](SECURITY.md)).
