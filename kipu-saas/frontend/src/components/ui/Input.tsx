import { forwardRef, useId } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Offline 4.15 (rediseño Stitch) — campo de texto con label SIEMPRE
 * asociado por `htmlFor`/`id`. Existe porque Offline 4.14.5 encontró un bug
 * real de accesibilidad exactamente por esto (labels sin asociar en
 * `/login`) — este componente hace estructuralmente imposible repetirlo:
 * genera el `id` con `useId()` si no se pasa uno explícito.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Oculta el label visualmente pero lo deja para lectores de pantalla (`sr-only`) — para inputs cuyo propósito ya es obvio por contexto (ej. el buscador del POS). */
  hideLabel?: boolean;
  error?: string;
  icon?: IconName;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hideLabel = false, error, icon, id, className = "", ...rest }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="w-full">
        <label htmlFor={inputId} className={hideLabel ? "sr-only" : "mb-1 block text-sm font-medium text-text"}>
          {label}
        </label>
        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
              <Icon name={icon} size={18} />
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={errorId}
            className={`h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft ${icon ? "pl-10" : ""} ${error ? "border-danger" : ""} ${className}`}
            {...rest}
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export default Input;
