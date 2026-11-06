# Modèle de données des recettes (NaowhForever)

Les recettes connues de chaque personnage viennent de l'addon **NaowhForever**, qui les relève
quand le joueur ouvre la fenêtre d'un métier. Ce sont les données de l'API du jeu : aucune recette
n'est inventée ni complétée par une base externe. Constaté sur les fichiers réels du 2026-11-06.

Fichier : `WTF\Account\<COMPTE>\SavedVariables\NaowhForever.lua`, lu en lecture seule.

## `NaowhForeverDB.account.profMakes`

```lua
NaowhForeverDB = {
  ["account"] = {
    ["profMakes"] = {
      ["Player-9999-00000001"] = {          -- GUID du personnage
        [2996] = {                          -- objet produit
          ["recipe"] = 2963,                -- sort de la recette
          ["prof"] = 197,                   -- ligne de compétence (Couture)
          ["made"] = 1,                     -- quantité produite
          ["need"] = { [2589] = 2 },        -- composants : objet = quantité
          ["cooldown"] = false,
        },
      },
    },
  },
}
```

Le reste de `NaowhForeverDB` (réglages de l'interface) n'est pas lu.

## Ce que l'agent transmet

Bloc `recipes` du compte (voir [API](API.md)) : par personnage (GUID), la liste des recettes
`{ spellId, skillLine, outputItemId, outputQuantity, cooldown, reagents[] }`.

- Un GUID mal formé est ignoré.
- Une recette sans sort, sans composant, ou avec une quantité hors bornes est ignorée et comptée
  dans un avertissement.

## Ce que le serveur en fait

- `recipes`, `recipe_reagents` : une recette par sort, ses composants remplacés à chaque import.
- `character_recipes` : l'ensemble des recettes connues d'un personnage, **remplacé** à chaque
  fichier plus récent : une recette oubliée disparaît.
- `character_recipe_sources` : date et empreinte du dernier fichier appliqué ; un fichier plus
  ancien ou identique ne change rien.
- Seuls les personnages déjà connus (par `AltBoard.lua`) reçoivent des recettes.

## Limites

- Un métier jamais ouvert en jeu depuis l'installation de l'addon n'a aucune recette ici.
- Le nom de la recette n'est pas relevé : le tableau de bord affiche le nom de l'objet produit,
  connu seulement si un personnage en a déjà possédé (table `items`), sinon son identifiant.
