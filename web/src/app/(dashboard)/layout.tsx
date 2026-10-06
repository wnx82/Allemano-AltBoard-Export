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
        <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="display text-xl font-bold text-gold">
            AltBoard
          </Link>
          <nav aria-label="Navigation principale" className="flex flex-wrap items-center gap-1">
            <NavLink href="/">Personnages</NavLink>
            <NavLink href="/professions">Métiers</NavLink>
            <NavLink href="/activity">Activité</NavLink>
            <NavLink href="/accounts">Comptes</NavLink>
            <NavLink href="/machines">Machines</NavLink>
          </nav>
          <form action={logoutAction} className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-faint sm:inline">{session.email}</span>
            <button className="button" type="submit">
              Se déconnecter
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
