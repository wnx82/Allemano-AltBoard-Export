// Séparé de session.ts pour rester importable depuis proxy.ts sans charger la base de données.

const secure = () => (process.env.WOW_APP_ORIGIN ?? "").startsWith("https://");

/** En HTTPS, le préfixe __Host- interdit tout Domain et impose Secure + Path=/. */
export const sessionCookieName = () => (secure() ? "__Host-wab_session" : "wab_session");

export const SESSION_DAYS = 30;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
