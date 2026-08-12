import AppShell from "@/components/AppShell";

// Placeholder honesto para secciones del sidebar cuyo módulo de negocio
// todavía no se construyó en esta fase (ver docs/PROJECT_PLAN.md). Nunca se
// simulan botones que aparenten funcionar sin hacerlo.
export default function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <AppShell>
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-semibold mb-2">{title}</h1>
        <div className="bg-white border border-zinc-200 rounded-lg p-6 text-sm text-zinc-600">
          <p className="font-medium text-zinc-900 mb-1">Disponible en una fase siguiente</p>
          <p>{description}</p>
        </div>
      </div>
    </AppShell>
  );
}
