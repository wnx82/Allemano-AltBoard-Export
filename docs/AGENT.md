# Agent Windows — AltBoardSync

Exécutable unique, autonome (aucun runtime .NET à installer), en lecture seule sur le dossier de
World of Warcraft. Version 1 : **déclenchement manuel uniquement**.

## Construire

```bash
cd agent
dotnet test
dotnet publish src/AltBoardSync -c Release -o ../dist     # dist/AltBoardSync.exe, ~12 Mo, win-x64
```

## Installer sur un PC

1. Copier `AltBoardSync.exe` où l'on veut.
2. Créer un jeton dans le tableau de bord (page **Machines**) : il n'est affiché qu'une fois.
3. Configurer :

```powershell
AltBoardSync.exe config set serverUrl https://wow.ekreativ.be/api/sync
AltBoardSync.exe token set          # saisie masquée
AltBoardSync.exe sync
```

Le jeton se lie à la première machine qui l'utilise ; il est refusé ailleurs. Un jeton par PC.

## Commandes

| Commande | Effet |
|---|---|
| `sync` | lit tous les `AltBoard.lua` (et `AllemanoLedger.lua` voisins) et envoie le document |
| `scan` | lit et affiche, **sans rien envoyer** (équivaut à `sync --dry-run`) |
| `config` | affiche la configuration |
| `config set <wowPath\|serverUrl\|machineName> <valeur>` | modifie la configuration |
| `token set` / `token clear` | enregistre ou supprime le jeton |
| `version` | affiche la version |

Options de `sync` et `scan` : `--dry-run`, `--wow-path <dossier>`, `--server <url>`,
`--out <fichier>` (écrit le document JSON produit).

Codes de sortie : `0` réussite, `1` synchronisation échouée ou partielle, `2` configuration ou usage.

## Exemple

```text
AltBoard Sync 0.1.0

Machine : PC-GAMING

2 comptes détectés
6 personnages détectés

Compte 1 (12…#1) : 4 personnages
Compte 2 (34…#1) : 2 personnages

Envoi vers le serveur...

6 personnages synchronisés.
0 nouveau personnage, 1 mis à jour.
1 nouveau snapshot.
5 personnages inchangés.

Synchronisation terminée.
```

## Fichiers locaux

Dossier `%APPDATA%\AltBoardSync\` (remplaçable par la variable `ALTBOARDSYNC_HOME`) :

| Fichier | Contenu |
|---|---|
| `config.json` | `machineUuid`, `machineName`, `wowPath`, `serverUrl` — aucun secret |
| `token.dat` | jeton chiffré par DPAPI pour l'utilisateur Windows courant |
| `logs\altboardsync.log` | journal ; ni jeton ni nom réel de dossier de compte ; rotation à 1 Mo |

`machineUuid` est généré au premier lancement et identifie l'installation ; le nom d'hôte n'est
qu'informatif (un PC peut être renommé). Un `config.json` illisible arrête l'agent : il ne régénère
jamais l'UUID en silence, ce qui créerait une seconde machine côté serveur.

La variable `ALTBOARDSYNC_TOKEN` prime sur `token.dat` (tests, exécution ponctuelle).

## Découverte

`wowPath` désigne soit un client (`…\World of Warcraft\_classic_beta_`), soit la racine contenant
plusieurs clients (`_retail_`, `_classic_`…). Chaque `WTF\Account\<COMPTE>\SavedVariables\AltBoard.lua`
est un compte. Un compte sans AltBoard, le dossier technique `WTF\Account\SavedVariables` et les
fichiers `.bak` sont ignorés. Zéro compte n'est pas une erreur.

Si le même dossier contient `AllemanoLedger.lua` (addon Allemano Ledger), l'agent y lit le temps
de jeu des personnages connus d'AltBoard : dernier `/played`, début du niveau en cours, niveaux
terminés, et leurs sessions de jeu : dates, durée, expérience gagnée
([LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md)). Fichier facultatif : absent, rien ne change ;
illisible, un avertissement est joint au document et la synchronisation continue.

## Lecture pendant que le jeu écrit

1. relever taille et date du fichier ;
2. attendre 300 ms ; si elles ont changé, recommencer ;
3. ouvrir en lecture seule et en partage total (le jeu peut écrire, renommer, supprimer) ;
4. relever à nouveau taille et date ; si elles ont changé, recommencer ;
5. après 5 tentatives, le compte est signalé illisible — les autres comptes sont traités normalement.

Un fichier tronqué est toujours détecté par le parser (table non fermée). L'agent ne crée, ne
modifie et ne supprime rien dans le dossier du jeu.

## Données non à jour

Le jeu n'écrit `AltBoard.lua` qu'au `/reload`, à la déconnexion ou à la fermeture, et AltBoard ne
relève que le personnage connecté. Avant de synchroniser après une session : `/reload` ou déconnexion.

## Parser

Lit le format SavedVariables sans exécuter de Lua : seuls les littéraux sont acceptés ; un appel de
fonction, une expression ou une variable sont des erreurs. Géré : chaînes à échappements (`\"`,
`\n`, `\ddd`, `\xHH`), chaînes longues, nombres entiers, flottants, hexadécimaux et non finis
(`1.#INF`), `nil` positionnels, clés chaîne et numériques distinctes, commentaires, BOM, UTF-8
invalide. Profondeur limitée à 100 niveaux, fichier limité à 64 Mo.

Détection des structures inconnues : toute clé racine ou tout champ de personnage que l'agent ne
connaît pas produit un avertissement, transmis au serveur et conservé avec la synchronisation.
Une version de schéma AltBoard inconnue est lue au mieux, avec avertissement.

## Automatisation future (conçue, non activée)

La commande `watch` est réservée : elle répond qu'elle n'est pas disponible dans cette version.
Son architecture est prête : tout ce dont elle a besoin est déjà isolé derrière `AgentApp`.

```text
AltBoard.lua modifié (FileSystemWatcher sur chaque SavedVariables)
        ↓
anti-rebond : attendre 5 s sans nouvel événement (le jeu écrit en plusieurs fois)
        ↓
lecture stable (StableFileReader, déjà en place)
        ↓
empreinte SHA-256 du fichier ≠ dernière empreinte envoyée ?   sinon : rien à faire
        ↓
parser → document → POST /api/sync (déjà en place, idempotent)
```

- **Filet de sécurité** : `FileSystemWatcher` peut manquer des événements (tampon saturé, lecteur
  réseau). Une vérification périodique (toutes les 10 minutes) compare l'empreinte de chaque fichier
  à la dernière envoyée.
- **État local** : la dernière empreinte envoyée par fichier, dans `%APPDATA%\AltBoardSync\state.json`.
  Le serveur la connaît déjà (`machine_accounts.last_file_hash`).
- **Nouveaux comptes** : la découverte est rejouée à chaque vérification périodique.
- **Échecs** : nouvelle tentative avec attente croissante ; jamais plus d'un envoi à la fois.
- **Service Windows ou démarrage à l'ouverture de session** : une tâche planifiée « à l'ouverture de
  session » lançant `AltBoardSync.exe watch` suffit et garde l'accès au jeton DPAPI de l'utilisateur ;
  un service Windows tournerait sous un autre compte et ne pourrait pas le déchiffrer.

Rien de tout cela n'est implémenté ni activé : la V1 reste « action humaine → sync ».
