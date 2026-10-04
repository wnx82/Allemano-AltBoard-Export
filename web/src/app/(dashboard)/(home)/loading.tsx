export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Chargement" className="animate-pulse">
      <div className="h-9 w-72 rounded-lg bg-white/10" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="panel h-24" />
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="panel h-64" />
        ))}
      </div>
    </div>
  );
}
