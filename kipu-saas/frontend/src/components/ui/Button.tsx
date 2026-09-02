import { forwardRef } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Offline 4.15 (rediseño Stitch) — botón base reutilizable.
 *
 * Envuelve un `<button>` nativo (nunca reemplaza el elemento real: sigue
 * siendo enfocable por teclado, activable con Enter/Espacio, y anunciado
 * como botón por un lector de pantalla sin ningún atributo extra). Los
 * `variant`/`size` son la única superficie nueva — las páginas que ya
 * existen no tienen que migrar a esto para seguir funcionando; se adopta
 * pantalla por pantalla en las fases UI-2 en adelante.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover disabled:bg-zinc-300",
  secondary: "bg-white text-text border border-border hover:bg-page disabled:text-zinc-400",
  ghost: "bg-transparent text-text hover:bg-page disabled:text-zinc-400",
  danger: "bg-danger text-white hover:brightness-95 disabled:bg-zinc-300",
};

// `lg` (48px) es el tamaño por defecto en el POS táctil: 44px es el mínimo
// recomendado de objetivo táctil (ya verificado en Offline 4.14.5), 48px
// deja margen para un cajero apurado. `sm`/`md` son para paneles de
// escritorio densos (tablas, formularios) donde 48px sería excesivo.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: "start" | "end";
  /** Estado de carga: deshabilita el botón y cambia el texto sin desmontar el ícono. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      iconPosition = "start",
      loading = false,
      disabled,
      className = "",
      children,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...rest}
      >
        {icon && iconPosition === "start" && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
        {children}
        {icon && iconPosition === "end" && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      </button>
    );
  },
);
Button.displayName = "Button";

/** Botón compuesto SOLO por un ícono — exige `label` para no quedar mudo ante un lector de pantalla. */
export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, size = "md", variant = "ghost", className = "", type = "button", ...rest }, ref) => {
    const dim = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-12 w-12" : "h-11 w-11";
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-lg transition-colors ${VARIANT_CLASSES[variant]} ${dim} ${className}`}
        {...rest}
      >
        <Icon name={icon} size={size === "sm" ? 18 : 20} />
      </button>
    );
  },
);
IconButton.displayName = "IconButton";

export default Button;
