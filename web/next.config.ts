import type { NextConfig } from "next";
import { readBuildInfo } from "./src/lib/build-info.ts";

// Aujourd'hui servie à la racine d'un sous-domaine dédié. WOW_BASE_PATH (ex. "/wow") permet de la
// servir sous un préfixe sans modifier le code : liens, assets et routes d'API suivent.
const basePath = process.env.WOW_BASE_PATH || undefined;

// Versions affichées en pied de page. Le dépôt est le dossier parent, sauf dans l'image Docker où
// il est monté à part (WOW_REPO_DIR, voir Dockerfile) : le contexte de construction se limite à web/.
const build = readBuildInfo(process.cwd(), process.env.WOW_REPO_DIR || "..", new Date());

const nextConfig: NextConfig = {
  basePath,
  // Figées dans le code à la construction : l'image en service ne contient pas le dépôt.
  env: {
    WOW_SITE_VERSION: build.siteVersion ?? "",
    WOW_BUILD_COMMIT: build.commit ?? "",
    WOW_BUILD_TIME: build.builtAt,
    WOW_AGENT_VERSION: build.agentVersion ?? "",
  },
  output: "standalone",
  poweredByHeader: false,
  // La compression (brotli) est faite par le reverse proxy.
  compress: false,
  reactStrictMode: true,
  images: {
    // Seules les icônes du CDN officiel de Blizzard passent par l'optimiseur.
    remotePatterns: [new URL("https://render.worldofwarcraft.com/eu/icons/56/**")],
    // Une icône ne change jamais : cache d'un mois.
    minimumCacheTTL: 2_678_400,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Tableau de bord privé : aucune indexation.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
