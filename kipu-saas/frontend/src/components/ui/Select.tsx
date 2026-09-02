import { forwardRef, useId } from "react";

/** Offline 4.15 (rediseño Stitch) — `<select>` nativo con label asociado, mismo criterio que `Input`. Nativo a propósito: mantiene el picker del sistema operativo (importante en Android, donde un `<select>` propio suele degradar la experiencia táctil en vez de mejorarla). */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hideLabel?: boolean;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hideLabel = false, error, id, className = "", children, ...rest }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const errorId = error ? `${selectId}-error` : undefined;

    return (
      <div className="w-full">
        <label htmlFor={selectId} className={hideLabel ? "sr-only" : "mb-1 block text-sm font-medium text-text"}>
          {label}
        </label>
        <select
          ref={ref}
          id={selectId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={errorId}
          className={`h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft ${error ? "border-danger" : ""} ${className}`}
          {...rest}
        >
          {children}
        </select>
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = "Select";

export default Select;
