# Modèle de données Allemano Ledger — temps de jeu

> AltBoard ne relève aucun temps de jeu. Le temps passé sur chaque niveau vient d'un second addon du
> même auteur, **Allemano Ledger** (ancien Session Tracker), quand il est installé. Source
> facultative : sans elle, tout le reste fonctionne à l'identique.

## 1. Source analysée

| | |
|---|---|
| Addon | Allemano Ledger 0.7.1 (`Interface\AddOns\AllemanoLedger`), fichiers `Levels.lua`, `Core.lua`, `Session.lua` |
| Fichier lu | `WTF\Account\<COMPTE>\SavedVariables\AllemanoLedger.lua` |
| Variable | `AllemanoLedgerDB` (le fichier contient aussi `SessionTrackerDB`, ancien nom, ignoré) |
| Constat du 2026-10-04 | aucun compte de ce PC n'avait encore ce fichier : la structure ci-dessous vient du code de l'addon, pas d'un fichier réel |

À vérifier sur le premier fichier réel : la forme des clés de `levelLog` (nombre ou chaîne). Le
lecteur accepte les deux.

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

Le reste (`current`, `history`, or par source, réglages, erreurs) n'est ni lu ni transmis.

## 3. Comportement de l'addon ayant un impact

- Le jeu ne donne que deux nombres (`TIME_PLAYED_MSG`) : le `/played` total et le temps passé sur
  le niveau en cours. **Les niveaux gagnés avant l'installation de l'addon ne peuvent pas être
  reconstitués.**
- Un niveau est journalisé au passage de niveau. Plusieurs niveaux gagnés d'un coup : seul le
  dernier a un temps de jeu ; les autres ont `played` absent. Un `played` absent n'est jamais
  remplacé par une estimation, ni par l'agent, ni par le serveur, ni par le graphique.
- `wall` est absent tant que le début du niveau n'a pas été observé (premier niveau suivi).
- Comme pour AltBoard, le fichier n'est écrit qu'au `/reload`, à la déconnexion ou à la fermeture,
  et seul le personnage connecté est relevé.
- Chaque PC ne connaît que les niveaux gagnés chez lui : le fichier n'est pas partagé entre PC.

## 4. Traitement

| Étape | Règle |
|---|---|
| Agent | Fichier facultatif. Illisible ou mal formé : avertissement dans le document, la synchronisation AltBoard continue |
| Agent | Valeur négative, hors bornes ou de mauvais type : écartée. Un total sans date de mesure n'est pas transmis (non comparable entre PC) |
| Agent | Un personnage présent dans Ledger mais absent d'AltBoard n'est pas transmis |
| Serveur | Niveaux terminés : ajoutés, jamais retirés ; une valeur connue n'est jamais remplacée par une absence. Les relevés de deux PC s'additionnent |
| Serveur | Total et niveau en cours : remplacés seulement par une mesure au moins aussi récente (`played.at`) |
| Serveur | Un fichier AltBoard en retard (`lastSeen` plus ancien) apporte quand même ses temps par niveau |
| Page | Niveau en cours affiché seulement s'il est égal au niveau du personnage ; durée = `played.total − levelStart.playedTotal`, donc arrêtée au dernier relevé |

Tables : `character_playtime` et `character_level_times` ([DATABASE](DATABASE.md)). Contrat :
champ `playtime` du personnage ([API](API.md)).
