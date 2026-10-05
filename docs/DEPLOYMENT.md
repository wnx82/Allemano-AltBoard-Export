# Déploiement

Production : **`https://wow.ekreativ.be`**, hôte `contabo`. Première mise en ligne le 2026-10-04.

Une pile Komodo pour Proxmox est prête dans `deploy/proxmox/` et doit remplacer contabo : voir
[Passer sur Proxmox](#passer-sur-proxmox-komodo). Au 2026-10-05 elle n'est ni déployée ni
basculée ; tout ce qui précède cette section décrit contabo.

## Ce qui existe en production

| Élément | Valeur |
|---|---|
| Sources | `/etc/komodo/repos/wow-altboard/` (`web/`, `deploy/`, `REVISION` = commit déployé) |
| Conteneur | `wow-altboard-web`, image `wow-altboard-web:<commit>`, port `127.0.0.1:3016` |
| Configuration | `/etc/komodo/repos/wow-altboard/deploy/.env` (droits `600`) |
| Base | `wow_altboard` sur `pg-shared` (PostgreSQL 17), rôle `wow_altboard`, créés par `pgdb` |
| Secret de la base | `/srv/shared-db/secrets/wow_altboard.env` (droits `600`) |
| Réseau Docker | `shared-db` (externe) : `pgbouncer:6432` pour l'application, `pg-shared:5432` pour les migrations |
| Reverse proxy | `/etc/traefik/dynamic/wow-altboard.yml` (copie de référence : `deploy/traefik/wow-altboard.yml`) |
| DNS | `wow.ekreativ.be` A → adresse de l'hôte, **non proxifié** par Cloudflare, comme les autres sites de l'hôte |
| Certificat | Let's Encrypt, par Traefik (défi DNS) |

Le dépôt n'a pas de dépôt distant : les sources ont été copiées par archive (`git archive`), pas
clonées par Komodo. Pour passer au flux Komodo habituel, pousser le dépôt puis déclarer la pile.

## Conventions de l'hôte suivies

- **Une base, un rôle** par projet, créés par l'outil `pgdb` (`pgdb create <projet>`), qui révoque
  l'accès public à la base et range les identifiants dans `/srv/shared-db/secrets/`. Le rôle
  `wow_altboard` possède sa base et n'a accès à aucune autre.
- **PgBouncer** en mode transaction, authentification par `auth_query` : aucun fichier à modifier
  pour un nouveau rôle. L'application n'utilise ni état de session ni requête préparée nommée ; son
  verrou de synchronisation est un verrou de transaction.
- **Traefik** en fichiers dynamiques surveillés : un fichier par projet, chaîne `default-chain`
  (CrowdSec + en-têtes) et `compress-br`. La compression est donc désactivée dans l'application.
- **Adresse du client** : le domaine n'étant pas proxifié, l'en-tête de confiance est `X-Real-Ip`,
  posé par Traefik. `cf-connecting-ip` serait falsifiable ici.
- La chaîne `default-chain` remplace deux en-têtes de l'application (`X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`). L'interdiction d'encadrement reste assurée
  par `frame-ancestors 'none'` dans la CSP, que Traefik ne touche pas.

## Mettre à jour

Sur le poste de développement :

```bash
git archive --format=tar.gz -o wow-altboard-src.tar.gz HEAD web deploy
scp wow-altboard-src.tar.gz root@<hôte>:/tmp/
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

`deploy/.env` n'est pas dans l'archive : il n'est jamais écrasé. Une migration doit rester
compatible avec la version précédente de l'application le temps du redémarrage (ajouts d'abord,
suppressions dans une version ultérieure).

## Revenir en arrière

Chaque image est étiquetée par son commit. Pour relancer la précédente :

```bash
cd /etc/komodo/repos/wow-altboard/deploy
sed -i 's/^WOW_IMAGE_TAG=.*/WOW_IMAGE_TAG=<commit précédent>/' .env && docker compose up -d
```

Les migrations ne sont pas annulées automatiquement : une migration destructive exige une
sauvegarde préalable de `wow_altboard`.

## Comptes et jetons

```bash
# Compte d'accès au tableau de bord : mot de passe saisi sur le serveur, sans écho
cd /etc/komodo/repos/wow-altboard/deploy
docker compose run --rm -it tools node create-admin.mjs vous@exemple.test
```

Relancer la même commande change le mot de passe. Les jetons d'agent se créent et se révoquent
dans l'interface, page **Machines**.

Les commandes ponctuelles passent par le service `tools`, jamais par `web` : lancée depuis `web`,
une commande hériterait de la sonde de santé et de l'étiquette autoheal, serait jugée en mauvaise
santé (aucun serveur n'écoute) et redémarrée au milieu de la saisie.

## Sauvegarde

`wow_altboard` est une base ordinaire de `pg-shared` : elle est couverte par la sauvegarde globale
de l'instance (`pg_dumpall`). Les données sont reconstructibles par une nouvelle synchronisation,
**sauf l'historique** (`character_snapshots`), qui n'existe nulle part ailleurs.

## Désinstaller

```bash
cd /etc/komodo/repos/wow-altboard/deploy && docker compose down
rm /etc/traefik/dynamic/wow-altboard.yml         # Traefik recharge seul
pgdb drop wow_altboard --yes                     # sauvegarde la base avant de la supprimer
```

Puis supprimer l'enregistrement DNS `wow.ekreativ.be` et le dossier des sources.

## Changer d'adresse

L'application ne contient aucune URL en dur : origine et préfixe viennent de la configuration.

| Adresse | `WOW_APP_ORIGIN` | `WOW_BASE_PATH` | Traefik |
|---|---|---|---|
| `https://wow.ekreativ.be` (actuelle) | `https://wow.ekreativ.be` | vide | `Host(wow.ekreativ.be)` |
| `https://ekreativ.be/wow` | `https://ekreativ.be` | `/wow` | `Host(ekreativ.be) && PathPrefix(/wow)` |

`WOW_BASE_PATH` est fixé à la construction de l'image. Le fonctionnement sous `/wow` a été vérifié
de bout en bout : liens, redirections, ressources, API, export, cookie. Après un changement
d'adresse : reconstruire, redémarrer, puis sur chaque PC
`AltBoardSync.exe config set serverUrl <nouvelle adresse>/api/sync`. Les jetons restent valables ;
les sessions du tableau de bord sont à rouvrir (le cookie est lié à l'hôte).

Sous Git Bash pour Windows, préfixer les commandes par `MSYS_NO_PATHCONV=1` : sans cela `/wow` est
réécrit en chemin Windows et la construction échoue.

## Passer sur Proxmox (Komodo)

Cible : la pile `wow-altboard` de **komodoprox** (`https://komodo.example.com`), sur le
conteneur LXC 102 « docker » (`10.0.0.15`). Komodo clone le dépôt, construit l'image, applique
les migrations et démarre l'application : un déploiement se réduit à un bouton.

| Élément | Valeur |
|---|---|
| Définition | `deploy/proxmox/compose.yaml` ; pile décrite par `deploy/proxmox/komodo.toml` |
| Sources | `/etc/komodo/stacks/wow-altboard/`, clonées par Komodo (branche `feat/v1-pipeline`) |
| Conteneurs | `wow-altboard-web`, `wow-altboard-db` (PostgreSQL 17), `migrate` (s'arrête après les migrations) |
| Base | `wow_altboard` dans la pile, volume `wow-altboard_db-data`, jamais publiée hors de la pile |
| Port | `10.0.0.15:3016`, joignable du réseau local seulement |
| Accès public | tunnel Cloudflare « proxmox » (cloudflared, LXC 101), domaine proxifié |
| Secret | variable Komodo `WOW_ALTBOARD_DB_PASSWORD`, injectée dans `WOW_DB_PASSWORD` |

Différences avec contabo : pas de PgBouncer (connexion directe à la base de la pile), pas de
Traefik (TLS et compression par Cloudflare), et l'en-tête de confiance devient `cf-connecting-ip`.
Le port restant joignable du réseau local, un poste de ce réseau pourrait falsifier cet en-tête et
contourner la limitation de débit ; pas un client d'Internet.

### Créer la pile

1. Dans Komodo, **Settings > Variables** : créer `WOW_ALTBOARD_DB_PASSWORD`, case « secret »
   cochée. Valeur hexadécimale uniquement, elle entre telle quelle dans l'URL de connexion :
   `openssl rand -hex 24`. PostgreSQL ne la lit qu'à la création du volume.
2. Créer la pile `wow-altboard` d'après `deploy/proxmox/komodo.toml` : collé dans un Resource Sync
   défini dans l'interface, ou reporté champ par champ.
3. **Deploy**, puis vérifier depuis le réseau local :
   `curl http://10.0.0.15:3016/api/health` répond `{"status":"ok"}`.

### Copier la base de contabo

La pile démarre avec une base vide. Pour reprendre comptes, jetons et historique, sur contabo :

```bash
docker run --rm --network shared-db --env-file /srv/shared-db/secrets/wow_altboard.env \
  postgres:17-alpine sh -c 'pg_dump "$DATABASE_URL_DIRECT" -Fc --no-owner --no-acl' > /tmp/wow_altboard.dump
```

Transférer le fichier dans le conteneur 102 (`scp` vers l'hôte Proxmox, puis
`pct push 102 /tmp/wow_altboard.dump /tmp/wow_altboard.dump`), et dans le conteneur :

```bash
cd /etc/komodo/stacks/wow-altboard/deploy/proxmox
docker compose stop web
docker exec -i wow-altboard-db pg_restore -U wow_altboard -d wow_altboard \
  --clean --if-exists --no-owner --no-acl --single-transaction < /tmp/wow_altboard.dump
docker compose start web
rm /tmp/wow_altboard.dump
```

La restauration remplace tout le contenu de la base de la pile, en une transaction : en cas
d'erreur, rien n'est modifié. Ne lancer aucune synchronisation entre la copie et la bascule : elle
irait encore sur contabo et serait perdue.

### Basculer

1. Tunnel Cloudflare « proxmox » : ajouter l'entrée `wow.ekreativ.be` vers
   `http://10.0.0.15:3016`, avant la règle finale `http_status:404`.
2. DNS : remplacer l'enregistrement A `wow.ekreativ.be` (adresse de contabo, non proxifié) par un
   CNAME proxifié vers `<identifiant du tunnel>.cfargotunnel.com`.
3. Vérifier `https://wow.ekreativ.be/api/health`, la connexion au tableau de bord, puis
   `AltBoardSync.exe sync` depuis un PC. L'adresse ne change pas : agents et jetons restent
   valables. Si Cloudflare bloque l'agent (réponse 403), exempter `/api/sync` de ses règles
   anti-robots.
4. Arrêter contabo en suivant [Désinstaller](#désinstaller), en gardant sa base quelques jours
   avant `pgdb drop`.

### Exploiter

- **Mettre à jour** : pousser sur la branche, puis **Deploy** sur la pile. L'image est toujours
  reconstruite et `web` redémarré, même sans changement.
- **Revenir en arrière** : fixer le champ **Commit** de la pile sur le commit précédent, puis
  **Deploy**. Les migrations ne sont pas annulées.
- **Compte d'accès** : dans `/etc/komodo/stacks/wow-altboard/deploy/proxmox`,
  `docker compose run --rm -it tools node create-admin.mjs vous@exemple.test`.
- **Sauvegarde** : aucun `pg_dumpall` global ne couvre cette base, contrairement à contabo. Elle
  vit dans le volume du conteneur 102 et suit sa sauvegarde ; pour une copie à part :
  `docker exec wow-altboard-db pg_dump -U wow_altboard -Fc wow_altboard > wow_altboard.dump`.
