// Icônes de classe et de métier. Elles appartiennent à Blizzard et ne sont pas copiées dans le
// dépôt : elles viennent du CDN officiel de Blizzard (celui que renvoie son API de données), par
// l'optimiseur d'images de Next.js. Le navigateur ne contacte donc que ce site, et la CSP reste
// limitée à 'self'.

export const ICON_HOST = "https://render.worldofwarcraft.com";
const ICON_PATH = "/eu/icons/56/";

const CLASS_ICONS: Record<string, string> = {
  WARRIOR: "classicon_warrior",
  PALADIN: "classicon_paladin",
  HUNTER: "classicon_hunter",
  ROGUE: "classicon_rogue",
  PRIEST: "classicon_priest",
  DEATHKNIGHT: "classicon_deathknight",
  SHAMAN: "classicon_shaman",
  MAGE: "classicon_mage",
  WARLOCK: "classicon_warlock",
  MONK: "classicon_monk",
  DRUID: "classicon_druid",
  DEMONHUNTER: "classicon_demonhunter",
  EVOKER: "classicon_evoker",
};

// Clé : identifiant de ligne de compétence (skillLine), stable et indépendant de la langue,
// contrairement au nom du métier qu'AltBoard enregistre déjà traduit.
const PROFESSION_ICONS: Record<number, string> = {
  129: "spell_holy_sealofsacrifice", // Secourisme
  164: "trade_blacksmithing", // Forge
  165: "trade_leatherworking", // Travail du cuir
  171: "trade_alchemy", // Alchimie
  182: "trade_herbalism", // Herboristerie
  185: "inv_misc_food_15", // Cuisine
  186: "trade_mining", // Minage
  197: "trade_tailoring", // Couture
  202: "trade_engineering", // Ingénierie
  333: "trade_engraving", // Enchantement
  356: "trade_fishing", // Pêche
  393: "inv_misc_pelt_wolf_01", // Dépeçage
  755: "inv_misc_gem_01", // Joaillerie
  773: "inv_inscription_tradeskill01", // Calligraphie
  794: "trade_archaeology", // Archéologie
};

const url = (name: string | undefined) => (name ? `${ICON_HOST}${ICON_PATH}${name}.jpg` : null);

/** Adresse de l'icône de classe, ou null pour un jeton inconnu (l'avatar garde alors les initiales). */
export function classIconUrl(token: string | null): string | null {
  return url(token ? CLASS_ICONS[token] : undefined);
}

/** Adresse de l'icône de métier, ou null pour une ligne de compétence inconnue. */
export function professionIconUrl(skillLine: number | null): string | null {
  return url(skillLine === null ? undefined : PROFESSION_ICONS[skillLine]);
}
