// Limitation de débit en mémoire, par fenêtre fixe. Suffisant pour un conteneur unique ;
// l'état est perdu au redémarrage et n'est pas partagé entre instances.

type Bucket = { count: number; resetAt: number };

export type RateLimit = { max: number; windowMs: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Compte une tentative. Renvoie false si la limite est dépassée. */
  consume(key: string, limit: RateLimit): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      this.buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    bucket.count++;
    return bucket.count <= limit.max;
  }

  /** Vrai si la limite est déjà atteinte, sans compter de tentative. */
  isBlocked(key: string, limit: RateLimit): boolean {
    const bucket = this.buckets.get(key);
    return bucket !== undefined && bucket.resetAt > this.now() && bucket.count >= limit.max;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    // Toujours saturé : on repart de zéro plutôt que de laisser la mémoire croître sans borne.
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

/** Identité du client : en-tête posé par le proxy de confiance, sinon une clé commune. */
export function clientKey(headers: Headers, trustedHeader: string | undefined): string {
  if (!trustedHeader) return "shared";
  const value = headers.get(trustedHeader)?.split(",")[0]?.trim();
  return value && value.length <= 64 ? value : "shared";
}
