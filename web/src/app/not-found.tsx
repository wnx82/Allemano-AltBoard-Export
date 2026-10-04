import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="panel max-w-md px-7 py-10 text-center">
        <p className="eyebrow text-gold">Erreur 404</p>
        <h1 className="display mt-2 text-2xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-sm text-muted">Ce personnage ou cette page n&apos;existe pas, ou n&apos;existe plus.</p>
        <Link href="/" className="button mt-6" data-variant="primary">
          Retour aux personnages
        </Link>
      </div>
    </main>
  );
}
