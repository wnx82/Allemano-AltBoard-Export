# Fixtures

Toutes les données sont anonymisées : GUID, noms de personnage et noms de guilde sont remplacés.
Aucun nom de dossier de compte réel n'y figure.

| Fichier | Origine |
|---|---|
| `account-four-characters.lua`, `account-two-characters.lua` | fichiers `AltBoard.lua` réels (addon 0.8.3), format conservé octet pour octet |
| `*-previous.lua` | fichier `.bak` correspondant : sauvegarde précédente du client, clés dans un autre ordre |
| `partial-data.lua`, `special-strings.lua`, `multi-realm.lua`, `unknown-schema.lua`, `no-altboarddb.lua`, `empty.lua` | écrits à la main pour les cas limites |
| `payloads/two-accounts.json` | document produit par l'agent à partir des deux fixtures réelles ; sert de contrat entre l'agent et l'API |

## Régénérer

Fixtures Lua, depuis de vrais fichiers :

```bash
node tools/anonymize-altboard.mjs tests/fixtures <nom>=<chemin vers AltBoard.lua>
```

Document JSON, après toute évolution du format produit par l'agent : placer les deux fixtures réelles
dans une arborescence `WTF/Account/<compte>/SavedVariables/AltBoard.lua` temporaire, puis

```bash
dotnet run --project agent/src/AltBoardSync -- scan --wow-path <dossier temporaire> --out tests/fixtures/payloads/two-accounts.json
```

et remplacer `machine` par une identité fictive.
