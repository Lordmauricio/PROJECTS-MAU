/**
 * Offline 4.15 (rediseño Stitch) — insignia de estado.
 *
 * `tone` mapea 1:1 a los estados reales que ya existen en el código
 * (`sale-sync-state.ts#SaleSyncState.kind`, `ConnectionBadge`): esto NO es
 * un componente decorativo genérico, es la representación visual de un
 * estado real del sistema — nunca se usa para inventar un estado que no
 * exista (ver §8 del pedido: "En línea"/"Sin conexión"/"Sincronizando…"/
 * "Pendiente de sincronizar"/"Sincronizada"/"Error de sincronización"/
 * "Conflicto").
 */

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-soft text-green-800",
  warning: "bg-warning-soft text-amber-800",
  danger: "bg-danger-soft text-red-800",
  info: "bg-info-soft text-sky-800",
  neutral: "bg-zinc-100 text-zinc-700",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Punto de color antes del texto — el mismo patrón que ya usa `ConnectionBadge` (símbolo + texto, nunca solo color). */
  dot?: boolean;
}

export function Badge({ tone = "neutral", dot = false, className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
      {...rest}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export default Badge;
