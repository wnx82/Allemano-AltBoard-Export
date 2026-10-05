# Agent Windows — AltBoardSync

Exécutable unique, autonome (aucun runtime .NET à installer), en lecture seule sur le dossier de
World of Warcraft. Il synchronise à la demande (`sync`, ou un double-clic) ou tout seul, à chaque
écriture du jeu (`watch`).

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

Ensuite, au choix :

- `AltBoardSync.exe autostart on` : la synchronisation devient automatique, dès maintenant et à
  chaque ouverture de session (voir [Synchronisation automatique](#synchronisation-automatique)) ;
- un double-clic sur `AltBoardSync.exe` : une synchronisation, puis la fenêtre reste ouverte jusqu'à
  l'appui d'une touche, le temps de lire le résultat.

Le jeu n'écrit `AltBoard.lua` qu'à la déconnexion du personnage ou sur `/reload` : synchroniser
avant ne voit pas les derniers changements.

## Commandes

| Commande | Effet |
|---|---|
| aucune, par double-clic | comme `sync`, puis attend une touche avant de fermer la fenêtre |
| aucune, depuis un terminal | affiche l'aide |
| `sync` | lit tous les `AltBoard.lua` (et `AllemanoLedger.lua` voisins) et envoie le document |
| `watch` | synchronise à chaque écriture du jeu, jusqu'à l'arrêt |
| `autostart` / `autostart on` / `autostart off` | affiche, active ou désactive le lancement de `watch` à l'ouverture de session ; `on` le lance aussi tout de suite, `off` arrête celui qui tourne |
| `scan` | lit et affiche, **sans rien envoyer** (équivaut à `sync --dry-run`) |
| `config` | affiche la configuration |
| `config set <wowPath\|serverUrl\|machineName> <valeur>` | modifie la configuration |
| `token set` / `token clear` | enregistre ou supprime le jeton |
| `version` | affiche la version |

Options de `sync`, `scan` et `watch` : `--wow-path <dossier>`, `--server <url>`. Pour `sync` et
`scan` seulement : `--dry-run`, `--out <fichier>` (écrit le document JSON produit).

Codes de sortie : `0` réussite, `1` synchronisation échouée ou partielle, `2` configuration ou usage.

## Exemple

```text
AltBoard Sync 0.2.0

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
| `state.json` | dernière empreinte envoyée par compte, pour `watch` ; ni contenu ni nom réel de dossier de compte |
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

## Synchronisation automatique

`AltBoardSync.exe watch` synchronise à chaque écriture du jeu : déconnexion d'un personnage,
`/reload`, fermeture. Depuis un terminal, il affiche une ligne par envoi et s'arrête par Ctrl+C.
Lancé sans terminal (ouverture de session, `autostart on`), il tourne sans fenêtre.

```text
AltBoard.lua ou AllemanoLedger.lua modifié (FileSystemWatcher sur WTF\Account)
        ↓
anti-rebond : attendre 5 s sans nouvel événement (le jeu écrit en plusieurs fois)
        ↓
lecture stable (StableFileReader)
        ↓
empreinte SHA-256 des deux fichiers ≠ dernière empreinte envoyée ?   sinon : rien à faire
        ↓
parser → document → POST /api/sync (idempotent)
```

- **Au démarrage** : une vérification immédiate. Ce qui a changé pendant que l'agent ne tournait
  pas part aussitôt ; ce que le serveur a déjà n'est pas renvoyé.
- **Filet de sécurité** : `FileSystemWatcher` peut manquer des événements (tampon saturé). Toutes les
  10 minutes, les fichiers sont relus et comparés, et la découverte rejouée : un compte ou un
  client apparu entre-temps est pris en charge.
- **État local** : la dernière empreinte envoyée par compte, dans `state.json`. Perdu, il ne coûte
  qu'un envoi de plus.
- **Échecs** : nouvel essai après 1 minute, puis une attente doublée à chaque échec, jusqu'à
  30 minutes ; jamais plus d'un envoi à la fois. Un jeton absent ou un dossier du jeu introuvable
  suivent la même règle : la surveillance attend qu'on les corrige, elle ne s'arrête pas.
- **Une seule surveillance** par session Windows : une seconde refuse de démarrer.

### Zone de notification

Pendant `watch`, une icône indique l'état en infobulle et affiche une bulle à chaque
synchronisation et à chaque nouvelle panne. Clic droit : **Synchroniser maintenant**, **Ouvrir le
tableau de bord**, **Ouvrir le journal**, **Quitter**.

Windows range les nouvelles icônes dans le débordement (`^`) : la glisser sur la barre des tâches
la garde visible. Le mode « Ne pas déranger », souvent actif en jeu, retient les bulles : elles
attendent dans le centre de notifications.

### Démarrage à l'ouverture de session

`autostart on` inscrit `watch` dans la clé Run de l'utilisateur
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, valeur `AltBoardSync`) et le lance tout de
suite. La commande passe par `conhost.exe --headless`, pour qu'aucune fenêtre ne s'ouvre. Elle
retient l'emplacement de l'exécutable : après l'avoir déplacé, relancer `autostart on`.
`autostart off` retire l'inscription et arrête la surveillance en cours.

Ce n'est pas un service Windows : il tournerait sous un autre compte et ne pourrait pas déchiffrer
le jeton (DPAPI).

### Ce que l'agent ne fait jamais

Il n'observe que le dossier `WTF\Account`, par les notifications de fichiers de Windows. Il
n'ouvre pas le processus du jeu, ne lit pas sa mémoire, n'y injecte rien, ne simule aucune saisie
et n'écrit rien dans le dossier du jeu.
