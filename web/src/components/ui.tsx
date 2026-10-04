import { getImageProps } from "next/image";
import { classKey, formatMoney, progressPercent, splitMoney } from "@/lib/wow/format";
import { classIconUrl, professionIconUrl } from "@/lib/wow/icons";

// Briques d'affichage sans état, utilisables côté serveur comme côté client.

/**
 * Icône du jeu, servie par l'optimiseur d'images (même origine). L'attribut style que pose
 * next/image est retiré : la CSP interdit les styles en ligne. Texte alternatif vide : l'icône
 * double toujours un libellé écrit, et une image indisponible ne laisse aucune trace visible.
 */
export function GameIcon({ src, size, className }: { src: string; size: number; className?: string }) {
  const { props } = getImageProps({ src, alt: "", width: size, height: size });
  // eslint-disable-next-line @next/next/no-img-element -- getImageProps fournit déjà src et srcSet optimisés
  return <img {...props} alt="" style={undefined} className={className} />;
}

export function ProfessionIcon({ skillLine, size = 20 }: { skillLine: number | null; size?: number }) {
  const src = professionIconUrl(skillLine);
  return src ? <GameIcon src={src} size={size} className="profession-icon" /> : null;
}

/**
 * Avatar : icône de classe posée sur les initiales du personnage. Classe inconnue ou image
 * indisponible : les initiales restent visibles.
 */
export function ClassAvatar({ name, classToken, size = "md" }: { name: string; classToken: string | null; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]!.toUpperCase())
    .join("");
  const dimensions = { sm: "size-9 text-xs", md: "size-12 text-base", lg: "size-16 text-2xl" }[size];
  const icon = classIconUrl(classToken);
  return (
    <span className={`avatar ${dimensions}`} data-class={classKey(classToken)} aria-hidden="true">
      {initials}
      {icon && <GameIcon src={icon} size={{ sm: 36, md: 48, lg: 64 }[size]} />}
    </span>
  );
}

export function Money({ copper }: { copper: number | null }) {
  if (copper === null) return <span className="text-faint">—</span>;
  const money = splitMoney(copper);
  return (
    <span className="inline-flex items-baseline gap-1.5 tabular-nums" title={formatMoney(copper)}>
      {money.gold > 0 && (
        <span className="coin-gold font-semibold">
          {new Intl.NumberFormat("fr-FR").format(money.gold)}
          <span className="ml-0.5 text-[0.7em] font-medium opacity-80">po</span>
        </span>
      )}
      {(money.gold > 0 || money.silver > 0) && (
        <span className="coin-silver">
          {money.silver}
          <span className="ml-0.5 text-[0.7em] opacity-80">pa</span>
        </span>
      )}
      <span className="coin-copper">
        {money.copper}
        <span className="ml-0.5 text-[0.7em] opacity-80">pc</span>
      </span>
    </span>
  );
}

/** Barre de progression. Rien n'est affiché quand la progression n'est pas calculable. */
export function Meter({ value, max, label, tone }: { value: number | null; max: number | null; label: string; tone?: "gold" }) {
  const percent = progressPercent(value, max);
  if (percent === null) return null;
  return <progress className="meter" value={percent} max={100} aria-label={`${label} : ${percent} %`} data-tone={tone} />;
}

export function FactionBadge({ faction }: { faction: string | null }) {
  if (!faction) return null;
  return (
    <span className="badge" data-faction={faction}>
      {faction}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="panel px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums leading-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="display text-lg font-bold text-gold">{children}</h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <p className="display text-lg font-bold text-gold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm text-muted">{children}</div>}
    </div>
  );
}
