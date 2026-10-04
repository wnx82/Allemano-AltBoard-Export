# Déploiement

> État : ⬜ **rien n'est déployé en production.** L'image, la composition et les migrations ont été
> validées localement. Chaque étape ci-dessous modifie l'infrastructure réelle et demande un accord
> explicite au moment de l'exécuter.

## Cible

| Élément | Valeur |
|---|---|
| Domaine | `wow.ekreativ.be` |
| Hôte | `contabo` (Traefik v3 en frontal, Cloudflare en amont) |
| Conteneur | `wow-altboard-web`, port publié sur `127.0.0.1:3016` |
| Base | `wow_altboard` sur `pg-shared` (PostgreSQL 17), application par `pgbouncer-shared` |
| Réseau Docker | `shared-db` (externe) |

## À vérifier avant de commencer

Ces points n'ont pas pu être inspectés pendant le développement (lecture de production refusée par
le garde-fou de la session) :

- [ ] inventaire de `pg-shared` : bases, rôles, droit `CREATEDB` du rôle d'administration ;
- [ ] nom d'hôte de PostgreSQL et de PgBouncer sur le réseau `shared-db` (`pg-shared`, `pgbouncer` supposés) ;
- [ ] mode de PgBouncer et façon d'y déclarer une base et un rôle (`userlist.txt` ou `auth_query`) ;
- [ ] port `3016` libre sur l'hôte ;
- [ ] forme des règles Traefik existantes (fichier dynamique ou labels) ;
- [ ] en-tête d'adresse cliente réellement transmis par Cloudflare et Traefik (`cf-connecting-ip` supposé).

## 1. Base de données

Relever l'inventaire **avant** (liste des bases et des rôles), pour le comparer après.

```sql
-- En tant qu'administrateur de pg-shared. Mots de passe générés, conservés dans le coffre.
CREATE ROLE wow_altboard_owner LOGIN PASSWORD '…';
CREATE ROLE wow_altboard_app   LOGIN PASSWORD '…';
CREATE DATABASE wow_altboard OWNER wow_altboard_owner;
REVOKE ALL ON DATABASE wow_altboard FROM PUBLIC;
GRANT CONNECT ON DATABASE wow_altboard TO wow_altboard_app;

-- Puis, connecté à wow_altboard en tant que wow_altboard_owner :
GRANT USAGE ON SCHEMA public TO wow_altboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wow_altboard_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wow_altboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wow_altboard_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wow_altboard_app;
```

Les privilèges par défaut sont posés **avant** les migrations : les tables créées ensuite sont
aussitôt accessibles au rôle applicatif, et à lui seul. Si l'administrateur n'a pas `CREATEDB`,
repli sur un schéma dédié `wow_altboard` dans une base existante : dans ce cas, s'arrêter et
revoir la configuration, le garde-fou applicatif exigeant une base nommée `wow_altboard*`.

Déclarer ensuite la base et le rôle applicatif dans PgBouncer.

## 2. Application

```bash
# Sur l'hôte, dans un dossier dédié contenant le dépôt
cd deploy
cp .env.example .env          # renseigner les deux chaînes de connexion
docker compose build
docker compose run --rm web node migrate.mjs     # connexion directe, rôle propriétaire
docker compose up -d
docker compose ps             # healthy attendu
```

Créer l'accès au tableau de bord et le premier jeton :

```bash
# Depuis le poste de développement, base jointe par le tunnel d'administration
cd web
WOW_DATABASE_URL=… npm run admin:create -- vous@exemple.test
```

Le jeton d'agent se crée ensuite dans l'interface (page Machines).

## 3. Domaine

1. Cloudflare : enregistrement `wow.ekreativ.be` vers l'hôte, proxifié, comme les autres sites.
2. Traefik : routeur `Host(\`wow.ekreativ.be\`)` vers `http://127.0.0.1:3016`, mêmes intergiciels que
   les autres applications (compression). Ne pas ajouter d'en-têtes de sécurité côté Traefik :
   l'application les pose déjà, y compris la CSP à nonce.
3. Vérifier : `https://wow.ekreativ.be/api/health` → `{"status":"ok"}`, `/` → redirection vers `/login`.

## 4. Checkpoint B en production

- [ ] 19 tables dans `wow_altboard` ; 19 PK, 19 FK, 8 UNIQUE, 5 CHECK ;
- [ ] `drizzle.__drizzle_migrations` : une ligne par migration ;
- [ ] `wow_altboard_app` ne peut se connecter à aucune autre base, ni créer de table ;
- [ ] inventaire des bases et rôles préexistants identique à celui relevé avant.

## 5. Recette réelle (critère de réussite de la V1)

1. `AltBoardSync.exe config set serverUrl https://wow.ekreativ.be/api/sync`, `token set`, `sync` ;
2. comparer un personnage : jeu, base, page ;
3. changer une donnée en jeu, `/reload`, relancer `sync` ;
4. constater la mise à jour, un nouveau snapshot, et aucun doublon ;
5. relancer `sync` sans rien changer : tout est « inchangé ».

## Mettre à jour

```bash
git pull
cd deploy
docker compose build
docker compose run --rm web node migrate.mjs     # sans effet s'il n'y a pas de nouvelle migration
docker compose up -d
```

Une migration doit rester compatible avec la version précédente de l'application le temps du
redémarrage (ajouts d'abord, suppressions dans une version ultérieure).

## Revenir en arrière

`WOW_IMAGE_TAG` désigne l'image à lancer : conserver l'étiquette précédente permet de la relancer
(`WOW_IMAGE_TAG=<précédente> docker compose up -d`). Les migrations ne sont pas annulées
automatiquement : une migration destructive exige une sauvegarde préalable de `wow_altboard`.

## Sauvegarde

`wow_altboard` est une base ordinaire de `pg-shared` : l'inclure dans la sauvegarde existante de
l'instance. Les données sont reconstructibles par une nouvelle synchronisation, **sauf l'historique**
(`character_snapshots`), qui n'existe nulle part ailleurs.

## Changer d'adresse

L'application ne contient aucune URL en dur : origine et préfixe viennent de la configuration.

| Adresse | `WOW_APP_ORIGIN` | `WOW_BASE_PATH` | Traefik |
|---|---|---|---|
| `https://wow.ekreativ.be` (cible) | `https://wow.ekreativ.be` | vide | `Host(wow.ekreativ.be)` |
| `https://ekreativ.be/wow` | `https://ekreativ.be` | `/wow` | `Host(ekreativ.be) && PathPrefix(/wow)` |

`WOW_BASE_PATH` est fixé à la construction de l'image (`docker compose build`). Le fonctionnement
sous `/wow` a été vérifié de bout en bout : liens, redirections, ressources, API, export, cookie.
Après un changement d'adresse : reconstruire, redémarrer, puis sur chaque PC
`AltBoardSync.exe config set serverUrl <nouvelle adresse>/api/sync`. Les jetons restent valables ;
les sessions du tableau de bord sont à rouvrir (le cookie est lié à l'hôte).

Sous Git Bash pour Windows, préfixer la commande par `MSYS_NO_PATHCONV=1` : sans cela `/wow` est
réécrit en chemin Windows et la construction échoue.
