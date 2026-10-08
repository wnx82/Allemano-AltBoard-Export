# État des serveurs WoW Forever EU

Page **Serveurs** du tableau de bord (`/servers`) : le serveur web sonde lui-même les serveurs de
connexion et de jeu, enregistre chaque contrôle et affiche statut, latence, disponibilité et
changements d'état.

**État au 2026-10-08 : aucune adresse n'est configurée.** Aucune source vérifiable ne publie les
adresses des serveurs européens de production (le jeu sort le 4 novembre 2026, seule la bêta
existe). Le module est livré complet, avec une configuration vide et un statut « Inconnu » : rien
n'est sondé tant que les adresses ne sont pas renseignées.

## Provenance des données

Sources étudiées le 2026-10-08, dans l'ordre de préférence :

| Source | Constat | Retenue |
|---|---|---|
| API Battle.net (Game Data API, état des royaumes) | Documentée pour World of Warcraft et ses versions Classic. Ni la référence des API de données de jeu ni le guide des espaces de noms ne mentionnent WoW Forever | non |
| Page officielle « Realm Status » Europe | WoW Forever n'a pas de royaumes mais des ensembles de règles ; d'après The Forever Era, le menu de versions de la page ne proposait pas WoW Forever le 2026-09-30 | non |
| `foreverdb.net/status` | Sonde en TCP, chaque minute, le serveur de connexion de la **bêta** (`test.actual.battle.net:1119`) et les serveurs de jeu de la bêta (port 3724). Aucune API documentée ; son `robots.txt` interdit `/api/` | lien de référence |
| `theforeverera.com/fr/status/` | Ne sonde pas les serveurs : relève les avis officiels de Blizzard. Le fichier `status-now.json` qu'utilise la page n'est ni documenté ni offert à la réutilisation | lien de référence |
| Sonde TCP depuis ce serveur | Méthode de ForeverDB, sans dépendre d'un tiers | **oui** |

Conséquences :

- Les statuts affichés viennent **uniquement** des sondes de ce serveur. Aucun site tiers n'est
  interrogé, aucune page n'est analysée.
- Les **maintenances annoncées ne sont pas relevées** : aucune source officielle documentée ne les
  publie pour WoW Forever. La page renvoie au calendrier des maintenances de Blizzard et aux deux
  sites ci-dessus.
- Les adresses de la bêta ne sont pas configurées par défaut : rien n'établit que la production
  européenne utilisera les mêmes.

## Configuration

Variables d'environnement du serveur web. Elles ne viennent jamais d'un formulaire ni d'une
requête : seul l'exploitant choisit ce qui est sondé.

| Variable | Défaut | Rôle |
|---|---|---|
| `WOW_STATUS_AUTH_TARGETS` | vide | Serveur de connexion : `hôte:port`, séparées par des virgules |
| `WOW_STATUS_GAME_TARGETS` | vide | Serveurs de jeu européens : même forme |
| `WOW_STATUS_INTERVAL_SECONDS` | `60` | Secondes entre deux contrôles (30 à 3600) |
| `WOW_STATUS_TIMEOUT_MS` | `3000` | Délai sans réponse (500 à 10000) |
| `WOW_STATUS_DEGRADED_MS` | `400` | Latence à partir de laquelle un service qui répond est dit dégradé (50 à 10000) |

- Huit adresses au plus par service ; une IPv6 s'écrit `[2001:db8::1]:3724`.
- Une adresse mal formée ou une durée hors bornes n'arrête rien : elle est écartée et la page
  l'affiche en avertissement, sans répéter la valeur.
- Une variable est lue au démarrage : après une modification, recréer le conteneur `web`
  (**Deploy** dans Komodo).

En production, les saisir dans l'environnement de la pile Komodo (`deploy/proxmox/.env.example`).

Pour trouver les adresses le moment venu : celles que le client du jeu contacte, relevées dans son
journal `Logs\Connection.log` ou publiées par Blizzard. Ne renseigner qu'une adresse vérifiée.

## Statuts

Chaque service est évalué sur l'ensemble de ses adresses, sondées en parallèle.

| Statut | Critère | Constat enregistré |
|---|---|---|
| En ligne | toutes les adresses acceptent la connexion, la plus rapide sous `WOW_STATUS_DEGRADED_MS` | `ok` |
| Dégradé | toutes répondent, mais la plus rapide atteint le seuil de latence | `slow` |
| Dégradé | une partie seulement des adresses répond | `partial` |
| Hors ligne | aucune ne répond et au moins une a **refusé** la connexion : panne confirmée par le serveur visé | `refused` |
| Hors ligne | aucune ne répond, silence jusqu'au délai : panne probable, non confirmée | `timeout` |
| Inconnu | aucune n'a été jointe : nom introuvable (`dns`), réseau de ce serveur (`network`), autre erreur (`error`) | `dns`, `network`, `error` |
| Inconnu | aucune adresse configurée, aucun contrôle encore fait, ou dernier contrôle périmé | aucune ligne |

Le seuil de 400 ms : une poignée de main TCP vers un centre de données européen prend quelques
dizaines de millisecondes ; un paquet d'ouverture perdu et réémis en ajoute environ mille. Au-delà
du seuil, le service répond mais le réseau ou le serveur peine.

La latence est celle de la poignée de main TCP de l'adresse la plus rapide. La résolution du nom
n'y entre pas.

## Rythme

| Règle | Détail |
|---|---|
| Intervalle | un tour par `WOW_STATUS_INTERVAL_SECONDS`, cadencé depuis le début du tour précédent |
| Un seul tour à la fois | une demande manuelle pendant un tour attend son résultat au lieu d'en lancer un second |
| Bouton **Actualiser** | contrôle immédiat de tous les services ; deux demandes à moins de 10 s ne valent qu'un contrôle |
| Backoff | après 3 échecs consécutifs (hors ligne ou inconnu), le service n'est plus contrôlé qu'après 2, puis 4, puis 5 minutes ; un succès rétablit le rythme |
| Péremption | un dernier contrôle plus vieux que 6 minutes (backoff maximal + un intervalle) ne vaut plus état présent : « Inconnu », dernière réponse rappelée |
| Arrêt | le minuteur est annulé, les connexions en cours fermées ; des sondes interrompues ne sont pas enregistrées |

L'affichage de la page ne déclenche aucune sonde : elle lit la base. Le navigateur relit la page à
chaque intervalle tant que l'onglet est visible, et n'ouvre lui-même aucune connexion vers les
serveurs de jeu.

## Stockage et historique

Table `server_status_checks` (voir [DATABASE](DATABASE.md)) : une ligne par service et par contrôle,
avec date, service, statut, constat, latence, adresses jointes sur adresses sondées, source (`tcp`)
et code d'erreur. Seul le **code** est gardé (`ECONNREFUSED`) : un message d'erreur contient
l'adresse visée. Conservation : 8 jours, purge une fois par heure.

| Affichage | Calcul |
|---|---|
| Disponibilité 24 heures | part du temps mesuré où le service répondait (en ligne ou dégradé). Affichée à partir de 30 minutes mesurées |
| Disponibilité 7 jours | idem, affichée à partir de 24 heures mesurées |
| Frise des 24 dernières heures | une case par heure, au pire statut constaté dans l'heure ; grise sans mesure |
| Changements d'état | 30 derniers changements de statut des 7 derniers jours |

Chaque contrôle vaut jusqu'au suivant, 6 minutes au plus. Le calcul pondère par la durée, pas par
le nombre de contrôles : pendant une panne ils s'espacent, et les compter sous-estimerait la panne.
Le temps « Inconnu » n'entre ni dans la disponibilité ni dans la panne. Sans échantillon suffisant,
aucun pourcentage n'est affiché.

## Code

| Fichier (`web/src`) | Rôle |
|---|---|
| `lib/status/config.ts` | lecture et validation des variables |
| `lib/status/probe.ts` | sonde TCP : connexion, mesure, fermeture, classement des erreurs |
| `lib/status/status.ts` | des résultats de sonde au statut, libellés |
| `lib/status/monitor.ts` | ordonnanceur : tour unique, backoff, demande manuelle, arrêt |
| `lib/status/store.ts` | écritures et lectures en base |
| `lib/status/view.ts` | ce que la page affiche |
| `lib/status/runtime.ts`, `instrumentation.ts` | un moniteur par processus, lancé au démarrage du serveur |
| `lib/status/actions.ts` | action serveur du bouton **Actualiser** |
| `components/server-status.tsx`, `status-refresh.tsx`, `app/(dashboard)/servers/page.tsx` | interface |

L'accueil affiche un résumé des statuts quand au moins une adresse est configurée.

## Limites

- **Un port ouvert n'est pas un jeu qui fonctionne.** La sonde voit qu'un service écoute. File
  d'attente, royaume plein, liste de personnages qui n'arrive pas : rien de cela ne se voit.
- **Un seul point de mesure.** La sonde part de ce serveur. Une panne entre lui et Blizzard donne
  « Hors ligne » ou « Inconnu » alors que le jeu marche ; un problème entre votre connexion et
  Blizzard ne se voit pas.
- **Un délai dépassé n'est pas une preuve.** Un pare-feu qui ignore les paquets donne le même
  silence qu'un serveur arrêté. D'où le constat « panne probable, non confirmée ».
- **Pas de maintenance annoncée**, faute de source officielle documentée.
- **Une instance.** Chaque processus lance son moniteur : plusieurs instances web écriraient
  chacune leurs contrôles. Même limite que la limitation de débit (voir [SECURITY](SECURITY.md)).
- **Mémoire du backoff perdue au redémarrage** : le rythme normal reprend, sans autre effet.

## Diagnostic

| Symptôme | Cause probable | Vérification |
|---|---|---|
| « Inconnu — Aucune adresse configurée » | variables vides ou absentes du conteneur | `docker exec wow-altboard-web printenv WOW_STATUS_AUTH_TARGETS` |
| Avertissement en haut de page | adresse mal formée, durée hors bornes | corriger la variable, recréer le conteneur |
| « Aucun contrôle enregistré pour l'instant » | serveur démarré depuis moins d'un intervalle, ou base injoignable | journal du conteneur, événement `server_status.store_failed` |
| « Dernier contrôle trop ancien » | moniteur arrêté ou base injoignable | idem ; redémarrer `web` |
| « Nom d'hôte introuvable (DNS) » | faute dans le nom, ou DNS du conteneur | `docker exec wow-altboard-web nslookup <hôte>` |
| « Réseau injoignable depuis ce serveur » | pas de route, IPv6 absente, sortie filtrée | sonde manuelle ci-dessous |
| « Hors ligne » alors que le jeu marche | sortie filtrée vers ce port, ou mauvaise adresse | sonde manuelle ci-dessous, comparer avec ForeverDB |

Sonde manuelle depuis le conteneur, avec la même bibliothèque que le module :

```bash
docker exec wow-altboard-web node -e "
const s = require('net').connect({ host: process.argv[1], port: Number(process.argv[2]) });
const t = Date.now();
s.setTimeout(3000, () => { console.log('timeout'); s.destroy(); });
s.on('connect', () => { console.log('connecté en', Date.now() - t, 'ms'); s.destroy(); });
s.on('error', (e) => console.log(e.code));
" <hôte> <port>
```

Derniers contrôles et changements :

```sql
select checked_at, service, status, outcome, latency_ms, targets_up, targets_total, error
from server_status_checks order by checked_at desc limit 20;
```

```bash
docker logs wow-altboard-web 2>&1 | grep server_status   # changements de statut, échecs d'écriture
```

## Tests

`web/src/lib/status/*.test.ts` et `web/src/components/server-status.test.ts` : serveur accessible,
connexion refusée, délai dépassé, erreur DNS, interruption et fermeture des connexions, contrôles
simultanés, demande manuelle, backoff, arrêt et minuteurs, base indisponible, mesures périmées,
absence de configuration, pondération par la durée, rendu de chaque état.
