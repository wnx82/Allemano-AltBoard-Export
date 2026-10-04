import type { NextConfig } from "next";

// Aujourd'hui servie à la racine d'un sous-domaine dédié. WOW_BASE_PATH (ex. "/wow") permet de la
// servir sous un préfixe sans modifier le code : liens, assets et routes d'API suivent.
const basePath = process.env.WOW_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
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
