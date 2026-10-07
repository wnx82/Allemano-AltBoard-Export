/** Silhouette commune aux pages du tableau de bord, le temps que leurs données arrivent. */
export default function PageLoading() {
  return (
    <div role="status" aria-label="Chargement" className="animate-pulse">
      <div className="h-3 w-40 rounded bg-white/10" />
      <div className="mt-3 h-9 w-64 rounded-lg bg-white/10" />
      <div className="mt-4 h-4 w-full max-w-2xl rounded bg-white/5" />
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel h-56" />
        <div className="panel h-56" />
      </div>
      <div className="panel mt-4 h-72" />
    </div>
  );
}
