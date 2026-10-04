# Modèle de données Allemano Ledger — temps de jeu et sessions

> AltBoard ne relève ni temps de jeu ni sessions. Le temps passé sur chaque niveau et l'expérience
> gagnée par session viennent d'un second addon du même auteur, **Allemano Ledger** (ancien Session
> Tracker), quand il est installé. Source facultative : sans elle, tout le reste fonctionne à
> l'identique.

## 1. Source analysée

| | |
|---|---|
| Addon | Allemano Ledger 0.7.1 (`Interface\AddOns\AllemanoLedger`), fichiers `Levels.lua`, `Core.lua`, `Session.lua` |
| Fichier lu | `WTF\Account\<COMPTE>\SavedVariables\AllemanoLedger.lua` |
| Variable | `AllemanoLedgerDB` (le fichier contient aussi `SessionTrackerDB`, ancien nom, ignoré) |
| Fichier réel observé | 2026-10-04 : 1 compte, 1 personnage, 1 niveau terminé (745 lignes). Structure conforme au code de l'addon |

Constats sur le fichier réel : les clés de `levelLog` sont numériques (`[26] = {`) — le lecteur
accepte aussi une chaîne ; `wall` est absent du premier niveau suivi ; la zone est écrite telle que
le client l'affiche (`Bois de la Pénombre (Duskwood)`). Lu par l'agent, accepté par le schéma du
serveur, enregistré et affiché en local sans écart avec le fichier.

Sessions : la session ouverte (`current`) du fichier réel est lue et affichée sans écart. Aucune
session close n'existait encore : la forme de `history` vient du code de l'addon, pas d'un fichier.

Le source de l'addon est sous droits réservés : il n'est ni copié ni versionné ici. La fixture
`tests/fixtures/ledger-two-characters.lua` est écrite à la main.

## 2. Structure lue

`AllemanoLedgerDB.chars[guid]`, avec les mêmes GUID qu'AltBoard (`Player-<royaume>-<id>`).

```lua
["chars"] = {
  ["Player-9999-00000002"] = {
    ["played"]     = { ["total"] = 36000, ["at"] = 1791118570 },
    ["levelStart"] = { ["level"] = 12, ["playedTotal"] = 33300, ["wallStart"] = 1791100000 },
    ["levelLog"]   = {
      [11] = { ["played"] = 4810, ["wall"] = 17700, ["reached"] = 1791100000, ["zone"] = "Teldrassil" },
    },
  },
}
```

| Champ | Sens | Unité |
|---|---|---|
| `played.total` | dernier `/played` total connu | secondes |
| `played.at` | instant de cette mesure | secondes Unix |
| `levelStart.level` | niveau en cours | |
| `levelStart.playedTotal` | `/played` total au début du niveau en cours | secondes |
| `levelStart.wallStart` | instant du début du niveau en cours | secondes Unix |
| `levelLog[n].played` | temps de jeu passé du niveau `n` au niveau `n + 1` | secondes |
| `levelLog[n].wall` | temps réel écoulé sur ce même niveau | secondes |
| `levelLog[n].reached` | instant du passage au niveau `n + 1` | secondes Unix |
| `levelLog[n].zone` | zone du passage de niveau, dans la langue du client | |

### Sessions

```lua
["current"] = {                       -- session ouverte
  ["start"] = 1791129268, ["lastSeen"] = 1791135864,
  ["active"] = 0, ["stintStart"] = 1791129268,   -- ["paused"] = true pendant une pause
  ["startLevel"] = 26, ["level"] = 27, ["xpGained"] = 28471,
  ["zone"] = "Cité de Stormwind", ["autoTag"] = "Leveling",   -- ["tag"] si le joueur en a choisi une
},
["history"] = {                       -- sessions closes, la plus récente d'abord
  { ["start"] = 1791090000, ["stop"] = 1791097200, ["duration"] = 6900,
    ["xpGained"] = 8200, ["levels"] = 1, ["zone"] = "Loch Modan", ["tag"] = "Leveling" }, -- [1]
},
```

| Champ | Sens |
|---|---|
| `start` | début de la session, en secondes Unix : c'est son identité, inchangée quand la session est close |
| `stop` / `lastSeen` | fin de la session, ou dernière activité d'une session ouverte |
| `duration` | temps connecté en secondes, pauses exclues. Session ouverte : `active` + (`lastSeen` − `stintStart`), ou `active` seul pendant une pause |
| `xpGained` | expérience gagnée pendant la session, passages de niveau compris |
| `levels` | niveaux gagnés (`level` − `startLevel` pour une session ouverte) |
| `zone`, `tag` | zone du dernier gain d'or de la session (à défaut, zone de départ) ; étiquette anglaise fixe (`Leveling`, `Dungeon`, `Farming`…), traduite à l'affichage |

Le reste (or par source, détail des recettes et dépenses, objets, réputation, réglages, erreurs)
n'est ni lu ni transmis.

## 3. Comportement de l'addon ayant un impact

- Le jeu ne donne que deux nombres (`TIME_PLAYED_MSG`) : le `/played` total et le temps passé sur
  le niveau en cours. **Les niveaux gagnés avant l'installation de l'addon ne peuvent pas être
  reconstitués.**
- Un niveau est journalisé au passage de niveau. Plusieurs niveaux gagnés d'un coup : seul le
  dernier a un temps de jeu ; les autres ont `played` absent. Un `played` absent n'est jamais
  remplacé par une estimation, ni par l'agent, ni par le serveur, ni par le graphique.
- `wall` est absent tant que le début du niveau n'a pas été observé (premier niveau suivi).
- `played.at` est l'instant de la dernière réponse du jeu à `/played` (demandée à chaque entrée
  dans le monde hors `/reload`, et à chaque passage de niveau), pas celui de l'écriture du fichier :
  un `/reload` ne la rafraîchit pas. Le temps du niveau en cours affiché s'arrête donc à cet instant.
- Comme pour AltBoard, le fichier n'est écrit qu'au `/reload`, à la déconnexion ou à la fermeture,
  et seul le personnage connecté est relevé.
- Chaque PC ne connaît que les niveaux gagnés et les sessions jouées chez lui : le fichier n'est
  pas partagé entre PC.
- L'addon ne garde que **50 sessions** par personnage et n'archive pas celles de moins de 60
  secondes. La session ouverte ne rejoint `history` qu'à la connexion suivante.
- `history` contient aussi les « runs » d'instance (`kind = "run"`). Un run recoupe la session
  qui le contient : il n'est pas transmis, sinon son expérience serait comptée deux fois.
- Aucune courbe d'expérience à l'intérieur d'une session : la seule série temporelle de l'addon
  concerne l'or.

## 4. Traitement

| Étape | Règle |
|---|---|
| Agent | Fichier facultatif. Illisible ou mal formé : avertissement dans le document, la synchronisation AltBoard continue |
| Agent | Valeur négative, hors bornes ou de mauvais type : écartée. Un total sans date de mesure n'est pas transmis (non comparable entre PC) |
| Agent | Un personnage présent dans Ledger mais absent d'AltBoard n'est pas transmis |
| Serveur | Niveaux terminés : ajoutés, jamais retirés ; une valeur connue n'est jamais remplacée par une absence. Les relevés de deux PC s'additionnent |
| Serveur | Total et niveau en cours : remplacés seulement par une mesure au moins aussi récente (`played.at`) |
| Serveur | Un fichier AltBoard en retard (`lastSeen` plus ancien) apporte quand même ses temps par niveau |
| Agent | Sessions : `history` sans les runs, puis `current`, de la plus ancienne à la plus récente ; une entrée sans début valide est écartée ; au plus 60 |
| Serveur | Sessions : ajoutées, jamais retirées — elles s'accumulent au-delà des 50 de l'addon. Identité : `(personnage, début)` |
| Serveur | Une session close remplace sa version ouverte. Une version ouverte n'en remplace une autre que si elle est au moins aussi récente, et jamais une session close |
| Page | Seule la dernière session peut être affichée « en cours ». Expérience par heure calculée seulement si la durée atteint une minute |
| Page | Niveau en cours affiché seulement s'il est égal au niveau du personnage ; durée = `played.total − levelStart.playedTotal`, donc arrêtée au dernier relevé |

Tables : `character_playtime`, `character_level_times` et `character_sessions`
([DATABASE](DATABASE.md)). Contrat : champs `playtime` et `sessions` du personnage ([API](API.md)).
