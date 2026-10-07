import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import { logoutAction } from "@/lib/auth/actions";
import { requireSession } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // Vérification réelle de la session, en base : le proxy ne fait qu'un premier tri.
  const session = await requireSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/75 backdrop-blur-xl">
        {/* Une seule ligne, de hauteur fixe : le sommaire des longues pages se cale dessous. */}
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-x-2 px-4 sm:gap-x-4 sm:px-6">
          <Link href="/" className="display flex-none text-xl font-bold text-gold">
            AltBoard
          </Link>
          {/* Trop étroite pour tous ses liens, la navigation défile de côté au lieu de s'empiler. */}
          <nav aria-label="Navigation principale" className="scroll-row min-w-0 flex-1 items-center">
            <NavLink href="/">Personnages</NavLink>
            <NavLink href="/professions">Métiers</NavLink>
            <NavLink href="/levels">Niveaux</NavLink>
            <NavLink href="/activity">Activité</NavLink>
            <NavLink href="/accounts">Comptes</NavLink>
            <NavLink href="/machines">Machines</NavLink>
          </nav>
          <form action={logoutAction} className="flex flex-none items-center gap-3">
            <span className="hidden text-xs text-faint lg:inline">{session.email}</span>
            <button className="button" type="submit" aria-label="Se déconnecter" title="Se déconnecter">
              <span className="hidden md:inline">Se déconnecter</span>
              <svg
                className="md:hidden"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 text-xs text-faint sm:px-6">
        Données issues de l&apos;addon AltBoard, telles qu&apos;écrites par le jeu à la dernière déconnexion ou au dernier /reload. Ce
        n&apos;est pas du temps réel. World of Warcraft et ses icônes sont la propriété de Blizzard Entertainment.
      </footer>
    </div>
  );
}
