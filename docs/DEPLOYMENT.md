# Déploiement

Production : **`https://wow.ekreativ.be`**, pile Komodo `wow-altboard` sur Proxmox. Première mise en
ligne le 2026-10-04 sur l'hôte `contabo`, déplacée sur Proxmox le 2026-10-05. L'ancien hôte a été
désinstallé le même jour : voir [Ancien hôte : contabo](#ancien-hôte--contabo).

## Ce qui existe en production

| Élément | Valeur |
|---|---|
| Pile | `wow-altboard` dans **komodoprox** (`https://komodo.example.com`), serveur `komodoprox` : le conteneur LXC 102 « docker », `10.0.0.15` |
| Définition | `deploy/proxmox/compose.yaml` ; pile décrite par `deploy/proxmox/komodo.toml` |
| Sources | `/etc/komodo/stacks/wow-altboard/`, clonées par Komodo (branche `feat/v1-pipeline`) |
| Conteneurs | `wow-altboard-web`, `wow-altboard-db` (PostgreSQL 17), `migrate` (s'arrête après les migrations) |
| Base | `wow_altboard` dans la pile, volume `wow-altboard_db-data`, jamais publiée hors de la pile |
| Configuration | environnement de la pile, écrit par Komodo dans `deploy/proxmox/.env` (droits `600`) |
| Secret | variable Komodo `WOW_ALTBOARD_DB_PASSWORD`, injectée dans `WOW_DB_PASSWORD` |
| Port | `10.0.0.15:3016`, joignable du réseau local seulement |
| Accès public | tunnel Cloudflare « proxmox » (cloudflared, LXC 101) ; DNS `wow.ekreativ.be` en CNAME proxifié vers le tunnel |
| Cloudflare Access | `/api/sync` ouvert par l'application « wow-sync-bypass » ; tout le reste derrière « HomeTunnelGuard » |

## Conventions suivies

- **Komodo fait tout** : il clone le dépôt, écrit le `.env`, puis lance `docker compose up -d`. Le
  fichier compose reconstruit l'image (`pull_policy: build`) et applique les migrations par un
  service dédié, dont dépend le démarrage de `web`. Aucune option de construction sur la pile.
- **Base dans la pile** : pas de PgBouncer, l'application se connecte directement. L'instance est
  initialisée avec la locale ICU `fr`, pour que les listes triées en SQL suivent l'ordre
  alphabétique (sur contabo, `C.UTF-8` triait par octets).
- **Cloudflare** termine TLS et compresse : la compression reste désactivée dans l'application.
  Les en-têtes de sécurité de l'application arrivent tels quels au navigateur.
- **Cloudflare Access** : le tableau de bord exige une adresse autorisée par « HomeTunnelGuard »,
  puis son propre mot de passe. `/api/sync` y échappe, l'agent ne sachant pas s'y authentifier :
  seul son jeton le protège.
- **Adresse du client** : l'en-tête de confiance est `cf-connecting-ip`, posé par Cloudflare. Le
  port restant joignable du réseau local, un poste de ce réseau pourrait le falsifier et contourner
  la limitation de débit ; pas un client d'Internet.
- **autoheal** redémarre tout conteneur en mauvaise santé sur cet hôte, sans étiquette : les
  services `migrate` et `tools` désactivent leur sonde.

## Mettre à jour

Pousser sur la branche, puis **Deploy** sur la pile dans Komodo. L'image est reconstruite à chaque
déploiement, ce qui recrée `web` ; les migrations s'appliquent avant son démarrage.

Une migration doit rester compatible avec la version précédente de l'application le temps du
redémarrage (ajouts d'abord, suppressions dans une version ultérieure).

## Revenir en arrière

Fixer le champ **Commit** de la pile sur le commit précédent, puis **Deploy**. Les migrations ne
sont pas annulées automatiquement : une migration destructive exige une sauvegarde préalable.

## Comptes et jetons

```bash
# Compte d'accès au tableau de bord : mot de passe saisi sur le serveur, sans écho
cd /etc/komodo/stacks/wow-altboard/deploy/proxmox
docker compose run --rm -it tools node create-admin.mjs vous@exemple.test
```

Relancer la même commande change le mot de passe. Les jetons d'agent se créent et se révoquent
dans l'interface, page **Machines**.

Les commandes ponctuelles passent par le service `tools`, jamais par `web` : lancée depuis `web`,
une commande hériterait de la sonde de santé, serait jugée en mauvaise santé (aucun serveur
n'écoute) et redémarrée par autoheal au milieu de la saisie.

## Sauvegarde

La base vit dans le volume `wow-altboard_db-data` du conteneur LXC 102 et suit sa sauvegarde :
Proxmox Backup Server (`pbs-hdd`), lundi et jeudi, deux dernières conservées (constaté le
2026-10-05). Aucun `pg_dumpall` global ne la couvre, contrairement à contabo. Pour une copie à
part :

```bash
docker exec wow-altboard-db pg_dump -U wow_altboard -Fc --no-owner --no-acl wow_altboard > wow_altboard.dump
```

Les données sont reconstructibles par une nouvelle synchronisation, **sauf l'historique**
(`character_snapshots`), qui n'existe nulle part ailleurs.

Restaurer un dump remplace tout le contenu de la base, en une transaction : en cas d'erreur, rien
n'est modifié.

```bash
cd /etc/komodo/stacks/wow-altboard/deploy/proxmox
docker compose stop web
docker exec -i wow-altboard-db pg_restore -U wow_altboard -d wow_altboard \
  --clean --if-exists --no-owner --no-acl --single-transaction < wow_altboard.dump
docker compose start web
```

## Recréer la pile

1. Dans Komodo, **Settings > Variables** : créer `WOW_ALTBOARD_DB_PASSWORD`, case « secret »
   cochée. Valeur hexadécimale uniquement, elle entre telle quelle dans l'URL de connexion :
   `openssl rand -hex 24`. PostgreSQL ne la lit qu'à la création du volume.
2. Créer la pile `wow-altboard` d'après `deploy/proxmox/komodo.toml`, puis **Deploy**. Depuis le
   réseau local, `curl http://10.0.0.15:3016/api/health` répond `{"status":"ok"}`.
3. Tunnel Cloudflare « proxmox » : entrée `wow.ekreativ.be` vers `http://10.0.0.15:3016`, avant
   la règle finale `http_status:404`.
4. DNS : `wow.ekreativ.be` en CNAME proxifié vers `<identifiant du tunnel>.cfargotunnel.com`.
5. Cloudflare Access : application « wow-sync-bypass » sur `wow.ekreativ.be/api/sync`, politique
   de contournement pour tous. Sans elle, l'agent reçoit une redirection vers la page de connexion
   d'Access au lieu d'atteindre l'API.
6. Restaurer une sauvegarde (voir [Sauvegarde](#sauvegarde)), ou créer un compte d'accès et des
   jetons sur une base vide.

## Changer d'adresse

L'application ne contient aucune URL en dur : origine et préfixe viennent de la configuration.

| Adresse | `WOW_APP_ORIGIN` | `WOW_BASE_PATH` | Routage |
|---|---|---|---|
| `https://wow.ekreativ.be` (actuelle) | `https://wow.ekreativ.be` | vide | hôte `wow.ekreativ.be` |
| `https://ekreativ.be/wow` | `https://ekreativ.be` | `/wow` | hôte `ekreativ.be`, chemin `/wow` |

Le routage se règle dans l'entrée du tunnel et dans le domaine de l'application Access.
`WOW_BASE_PATH` est fixé à la construction de l'image. Le fonctionnement sous `/wow` a été vérifié
de bout en bout sur contabo, derrière Traefik : liens, redirections, ressources, API, export,
cookie. Après un changement d'adresse : redéployer, puis sur chaque PC
`AltBoardSync.exe config set serverUrl <nouvelle adresse>/api/sync`. Les jetons restent valables ;
les sessions du tableau de bord sont à rouvrir (le cookie est lié à l'hôte).

Sous Git Bash pour Windows, préfixer les commandes par `MSYS_NO_PATHCONV=1` : sans cela `/wow` est
réécrit en chemin Windows et la construction échoue.

## Ancien hôte : contabo

Désinstallé le 2026-10-05, après copie de la base vers Proxmox (22 tables, 893 lignes, comptes
identiques des deux côtés) : conteneur, image, sources, configuration Traefik, base et rôle y sont
supprimés. `pgdb` a gardé un dernier dump,
`/srv/backups/dumps/pgdb-drop-wow_altboard-2026-10-05-234106.dump`, et archivé le secret de la base.

`deploy/docker-compose.yml`, `deploy/.env.example` et `deploy/traefik/` décrivent ce déploiement.
Ils restent comme référence pour un hôte du même type : PostgreSQL mutualisé derrière PgBouncer,
Traefik en frontal. La suite le décrit tel qu'il fonctionnait.

| Élément | Valeur |
|---|---|
| Sources | `/etc/komodo/repos/wow-altboard/` (`web/`, `deploy/`, `REVISION` = commit déployé) |
| Conteneur | `wow-altboard-web`, image `wow-altboard-web:<commit>`, port `127.0.0.1:3016` |
| Configuration | `/etc/komodo/repos/wow-altboard/deploy/.env` (droits `600`) |
| Base | `wow_altboard` sur `pg-shared` (PostgreSQL 17), rôle `wow_altboard`, créés par `pgdb` |
| Secret de la base | `/srv/shared-db/secrets/wow_altboard.env` (droits `600`) |
| Réseau Docker | `shared-db` (externe) : `pgbouncer:6432` pour l'application, `pg-shared:5432` pour les migrations |
| Reverse proxy | `/etc/traefik/dynamic/wow-altboard.yml` (copie de référence : `deploy/traefik/wow-altboard.yml`) |
| DNS | `wow.ekreativ.be` A → adresse de l'hôte, **non proxifié** par Cloudflare |

### Conventions de l'hôte

- **Une base, un rôle** par projet, créés par l'outil `pgdb` (`pgdb create <projet>`), qui révoque
  l'accès public à la base et range les identifiants dans `/srv/shared-db/secrets/`. Le rôle
  `wow_altboard` possède sa base et n'a accès à aucune autre.
- **PgBouncer** en mode transaction, authentification par `auth_query` : aucun fichier à modifier
  pour un nouveau rôle. L'application n'utilise ni état de session ni requête préparée nommée ; son
  verrou de synchronisation est un verrou de transaction.
- **Traefik** en fichiers dynamiques surveillés : un fichier par projet, chaîne `default-chain`
  (CrowdSec + en-têtes) et `compress-br`.
- **Adresse du client** : le domaine n'étant pas proxifié, l'en-tête de confiance est `X-Real-Ip`,
  posé par Traefik. `cf-connecting-ip` serait falsifiable sur cet hôte.
- La chaîne `default-chain` remplace deux en-têtes de l'application (`X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`). L'interdiction d'encadrement reste assurée
  par `frame-ancestors 'none'` dans la CSP, que Traefik ne touche pas.

### Mettre à jour

Les sources ne sont pas clonées sur cet hôte : elles y sont copiées par archive.

```bash
git archive --format=tar.gz -o wow-altboard-src.tar.gz HEAD web deploy
scp wow-altboard-src.tar.gz root@<contabo>:/tmp/
```

Sur l'hôte :

```bash
cd /etc/komodo/repos/wow-altboard
tar -xzf /tmp/wow-altboard-src.tar.gz && rm /tmp/wow-altboard-src.tar.gz
echo <commit> > REVISION
cd deploy
sed -i 's/^WOW_IMAGE_TAG=.*/WOW_IMAGE_TAG=<commit>/' .env
docker compose build
docker compose run --rm tools node migrate.mjs     # sans effet s'il n'y a pas de nouvelle migration
docker compose up -d
docker compose ps                                # healthy attendu
```

`deploy/.env` n'est pas dans l'archive : il n'est jamais écrasé. Chaque image est étiquetée par son
commit ; pour relancer la précédente :
`sed -i 's/^WOW_IMAGE_TAG=.*/WOW_IMAGE_TAG=<commit précédent>/' .env && docker compose up -d`.

### Désinstaller

Les commandes exécutées le 2026-10-05, puis suppression de l'image et du dossier des sources :

```bash
cd /etc/komodo/repos/wow-altboard/deploy && docker compose down
rm /etc/traefik/dynamic/wow-altboard.yml         # Traefik recharge seul
pgdb drop wow_altboard --yes                     # sauvegarde la base avant de la supprimer
```
