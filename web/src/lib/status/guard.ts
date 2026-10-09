import { lookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Une adresse saisie dans la page Paramètres ne doit viser qu'Internet. Sans cette règle, la
// sonde dirait à qui tient une session quels ports sont ouverts sur le réseau interne du serveur
// (voir docs/SECURITY.md). Les adresses de l'environnement, choisies par l'exploitant, n'y sont
// pas soumises.

const reserved = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // « ce réseau »
  ["10.0.0.0", 8], // privé
  ["100.64.0.0", 10], // partagé par l'opérateur (CGNAT)
  ["127.0.0.0", 8], // boucle locale
  ["169.254.0.0", 16], // lien local
  ["172.16.0.0", 12], // privé
  ["192.168.0.0", 16], // privé
  ["224.0.0.0", 4], // multidiffusion
  ["240.0.0.0", 4], // réservé, diffusion
] as const) {
  reserved.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127], // non spécifiée et boucle locale
  ["64:ff9b::", 96], // traduction vers IPv4 (NAT64)
  ["fc00::", 7], // locale unique
  ["fe80::", 10], // lien local
  ["ff00::", 8], // multidiffusion
] as const) {
  reserved.addSubnet(network, prefix, "ipv6");
}

/** Code d'erreur d'une adresse refusée, tel qu'enregistré avec le contrôle. */
export const BLOCKED_CODE = "EBLOCKED";

export function blockedAddressError(): NodeJS.ErrnoException {
  return Object.assign(new Error("address is not public"), { code: BLOCKED_CODE });
}

/** Vrai si l'adresse IP est publique : ni locale, ni privée, ni réservée. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  try {
    // Une IPv4 écrite en IPv6 (::ffff:10.0.0.1) est comparée aux règles IPv4.
    return !reserved.check(address, family === 6 ? "ipv6" : "ipv4");
  } catch {
    return false;
  }
}

/**
 * Résolution de nom qui refuse toute adresse non publique. Un nom public peut désigner le réseau
 * interne : la règle porte sur l'adresse réellement jointe, pas sur ce qui a été saisi.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, address, family);
      return;
    }
    const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
    // Plusieurs adresses : Node les essaie toutes, une seule adresse interne suffit à refuser.
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      callback(blockedAddressError(), address, family);
      return;
    }
    callback(null, address, family);
  });
};
