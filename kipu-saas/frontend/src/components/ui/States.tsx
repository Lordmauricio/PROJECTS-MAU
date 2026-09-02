import { Icon, type IconName } from "./Icon";

/**
 * Offline 4.15 (rediseño Stitch) — los tres estados que casi toda pantalla
 * de datos necesita (cargando / vacío / error), unificados para que dejen
 * de resolverse página por página con un `<p>` suelto de estilo distinto.
 * Puramente presentacionales: no tocan cuándo se muestran (eso lo sigue
 * decidiendo cada página con su propio `loading`/`error`/`data.length`).
 */

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
      />
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-red-800">
      <Icon name="alert-triangle" size={18} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({
  icon = "box",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-page text-text-muted">
        <Icon name={icon} size={24} />
      </span>
      <p className="text-sm font-medium text-text">{title}</p>
      {description && <p className="max-w-xs text-sm text-text-muted">{description}</p>}
      {action}
    </div>
  );
}
