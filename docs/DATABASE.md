# Base de données

> Source unique du schéma : `web/src/db/schema.ts` (Drizzle). Migrations générées dans
> `web/drizzle/`. Structure des données d'origine : [ALTBOARD-DATA-MODEL](ALTBOARD-DATA-MODEL.md).

## État

| Environnement | État |
|---|---|
| PostgreSQL 17 local (Docker, `127.0.0.1:54329`) | ✅ migration appliquée et vérifiée dans l'instance |
| Production (`pg-shared`, hôte contabo) | ⬜ rien créé — inventaire refusé par le garde-fou de la session, création en attente d'accord |

## Isolation

- Base dédiée **`wow_altboard`** ; aucune table dans une base ou un schéma existant.
- Deux rôles : `wow_altboard_owner` (migrations) et `wow_altboard_app` (lecture et écriture des
  données, rien d'autre).
- Garde-fou applicatif (`web/src/db/env.ts`) : toute connexion vers une base dont le nom ne commence
  pas par `wow_altboard` est refusée avant même d'ouvrir une socket ; les tests n'acceptent que
  `wow_altboard*_test`.
- Variables `WOW_DATABASE_URL`, `WOW_DATABASE_URL_DIRECT`, `WOW_TEST_DATABASE_URL` : jamais de nom
  générique, qui pourrait exister dans l'environnement pour un autre projet.

## Tables (19)

Conventions : clés `bigint` générées, dates en `timestamptz`, argent en pièces de cuivre.

### Référentiel

| Table | Clé d'unicité | Contenu |
|---|---|---|
| `machines` | `machine_uuid` | Un PC : UUID généré par l'agent, nom d'hôte (informatif), nom d'affichage, version de l'agent |
| `agent_tokens` | `token_hash` | Jeton d'agent (SHA-256 seulement), libellé, machine liée, révocation |
| `wow_accounts` | `account_key` | Un compte : empreinte du nom de dossier, libellé masqué, nom d'affichage |
| `machine_accounts` | `(machine_id, account_id)` | Quel PC a vu quel compte : client, version d'addon, empreinte et date du fichier |
| `realms` | `name` | Royaume (nom normalisé). Pas de région : absente d'AltBoard |
| `items` | `item_key` | Référentiel d'objets partagé (`AltBoardDB.items`) |

### Personnages

| Table | Clé | Contenu |
|---|---|---|
| `characters` | `guid` | Identité, niveau, expérience, or, niveau d'objet, guilde, zone, emplacements de sacs et de banque, horodatages de l'addon, hash du contenu |
| `character_machines` | `(character_id, machine_id)` | Quel PC a vu quel personnage |
| `character_stats` | `character_id` | 27 statistiques typées |
| `character_professions` | `(character_id, skill_line)` | Métier, niveau, maximum, principal, ordre |
| `character_equipment` | `(character_id, slot)` | Objet par emplacement (1 à 19), qualité, niveau, ID d'enchantement |
| `character_reputations` | `(character_id, faction_id)` | Palier et valeurs |
| `character_currencies` | `(character_id, name)` | Quantité (la clé est le nom : l'addon ne fournit pas d'identifiant) |
| `character_items` | `(character_id, location, item_key)` | Contenu des sacs (`bags`) et de la banque (`bank`) |

Colonnes volontairement absentes, faute de donnée dans AltBoard : genre, région, quêtes, recettes.

### Historique et journal

| Table | Contenu |
|---|---|
| `character_snapshots` | Un état daté par progression : niveau, expérience, or, niveau d'objet + détail en `jsonb`. Unicité `(character_id, captured_at)` |
| `sync_runs` | Une ligne par synchronisation : machine, statut, compteurs, durée, versions |
| `sync_errors` | Erreurs et avertissements de l'agent rattachés à une synchronisation |

### Accès au tableau de bord

| Table | Contenu |
|---|---|
| `admin_users` | Adresse, hash scrypt du mot de passe |
| `sessions` | Empreinte de l'identifiant de session, expiration |

## Contraintes

19 clés primaires, 19 clés étrangères, 8 contraintes d'unicité, 5 contraintes de validation
(`slot` entre 1 et 19, `location` ∈ `bags`/`bank`, quantités et or positifs, statut de synchronisation).

Suppression d'un personnage : ses tables filles et ses snapshots suivent (`ON DELETE CASCADE`).
Un compte, un royaume ou une machine référencé ne peut pas être supprimé.

## Règles d'écriture

Une synchronisation = **une transaction**, sérialisée par un verrou consultatif de transaction.
En cas d'erreur, tout est annulé, puis l'échec est journalisé à part (`sync_runs` en `failed`).

| Situation | Effet |
|---|---|
| GUID inconnu | Personnage créé, premier snapshot |
| `lastSeen` reçu **plus ancien** que celui stocké | Rien n'est modifié (`characters_stale`) : un PC en retard n'écrase pas un état plus récent |
| Contenu identique (hash canonique) | Rien n'est modifié (`characters_unchanged`) |
| Contenu différent | Personnage mis à jour ; tables filles remplacées |
| Bloc daté (`bank`, `bags`, `stats`) absent ou plus ancien que celui stocké | Bloc conservé : un PC qui n'a jamais ouvert la banque n'efface pas celle relevée ailleurs |
| Personnage absent du fichier | Jamais supprimé : l'absence ne prouve pas la suppression en jeu |
| Même compte depuis deux PC | Un seul `wow_accounts`, deux `machine_accounts` |

Tous les hash sont calculés sur un JSON **canonique** (clés triées) : le client WoW réécrit ses
tables dans un ordre différent à chaque sauvegarde.

## Snapshots

Un snapshot est créé quand le **hash de progression** diffère de celui du dernier snapshot du
personnage. Entrent dans ce hash : niveau, expérience, or, niveau d'objet, guilde, métiers (niveau,
maximum), équipement (objet, enchantement), réputations (palier, valeur), monnaies.

N'y entrent pas : zone, expérience reposée, statistiques, horodatages, contenu des sacs. Une
connexion sans progression met donc le personnage à jour sans créer d'historique.

La comparaison se fait avec le **dernier** snapshot seulement : un retour à un état antérieur
(100 po → 200 po → 100 po) est bien historisé. L'unicité `(character_id, captured_at)` rend le
rejeu d'une synchronisation sans effet.

## Index

Seuls existent les index des contraintes, plus `characters(account_id)`, `characters(realm_id)`,
`sync_runs(machine_id, started_at)` et `sessions(expires_at)`. Les pages lisent leurs données en
un nombre fixe de requêtes (3 pour la liste, vérifié par test avec 1, 5 et 50 personnages) ; aucun
autre index ne se justifie à ce volume. À réévaluer avec `EXPLAIN` si l'historique grossit.

## Migrations

```bash
cd web
npm run db:generate          # après modification de src/db/schema.ts
npm run db:migrate           # applique sur WOW_DATABASE_URL_DIRECT, sinon WOW_DATABASE_URL
npm run db:migrate:test      # applique sur la base de test
```

En production, depuis l'image : `docker compose run --rm web node migrate.mjs`.
Les migrations passent en connexion directe, jamais par PgBouncer. Le suivi est tenu dans
`drizzle.__drizzle_migrations`.

## Checkpoint B

Vérifié dans l'instance locale (pas seulement dans les fichiers SQL) :

| Contrôle | Résultat |
|---|---|
| Tables présentes | 19 / 19, dans `wow_altboard` et `wow_altboard_test` |
| Contraintes (`pg_constraint`) | 19 PK, 19 FK, 8 UNIQUE, 5 CHECK |
| Suivi des migrations | 1 migration enregistrée |
| Unicité, clés étrangères, validations, cascade, rollback | exercés par les tests d'intégration |
| Migration depuis l'image Docker | 19 tables créées dans une base vierge |

À refaire à l'identique en production après création de la base (voir [DEPLOYMENT](DEPLOYMENT.md)),
en y ajoutant : le rôle applicatif ne peut ni lire ni écrire hors du projet, et les bases
préexistantes sont inchangées.
