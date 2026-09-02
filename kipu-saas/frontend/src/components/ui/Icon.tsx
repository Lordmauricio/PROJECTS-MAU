/**
 * Offline 4.15 (rediseño Stitch) — capa de íconos SVG propios.
 *
 * Reemplaza la fuente "Material Symbols Outlined" que trae el export de
 * Stitch: esa fuente exigiría una dependencia nueva (Google Fonts o
 * self-hosted) sin necesidad real — decisión explícita del usuario. Cada
 * ícono acá es un `<path>` propio, mismo estilo (trazo 1.75, esquinas
 * redondeadas) para que la variedad no se note pantalla a pantalla.
 *
 * Uso: `<Icon name="cart" />`. Decorativo por defecto (`aria-hidden`); si el
 * ícono ES el control (un botón sin texto), pasar `label` para que quede
 * accesible — ver el propio componente `IconButton` más abajo, que ya lo
 * exige.
 */

export type IconName =
  | "search"
  | "cart"
  | "menu"
  | "close"
  | "plus"
  | "minus"
  | "check"
  | "chevron-down"
  | "chevron-up"
  | "chevron-left"
  | "chevron-right"
  | "user"
  | "eye"
  | "eye-off"
  | "wifi-off"
  | "sync"
  | "alert-triangle"
  | "trash"
  | "edit"
  | "home"
  | "box"
  | "users"
  | "settings"
  | "download"
  | "share"
  | "printer"
  | "arrow-left"
  | "credit-card"
  | "banknote"
  | "bank"
  | "qr-code"
  | "receipt"
  | "building";

const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2.5 3h2l2.3 11.4a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  check: <path d="M5 13l4 4 10-10" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-up": <path d="M6 15l6-6 6 6" />,
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.7A10.4 10.4 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a15.6 15.6 0 0 1-3.4 4.1M6.6 6.6C4 8.3 2 12 2 12s3.8 6.5 10 6.5c1.4 0 2.7-.3 3.8-.8" />
      <path d="M9.6 9.6a2.7 2.7 0 0 0 3.8 3.8" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M5 8.8A14.5 14.5 0 0 1 9.2 6.4M12 16.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z" fill="currentColor" stroke="none" />
      <path d="M8.2 12a9.7 9.7 0 0 1 4-1.7M15.8 12.3A9.7 9.7 0 0 1 19 14M2.5 5.5A17.6 17.6 0 0 1 12 2.5c3.7 0 7 1.1 9.5 3" />
    </>
  ),
  sync: (
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 16" />
      <path d="M4 20v-4h4" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17.2" r="0.15" fill="currentColor" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.8c0-.4.4-.8.9-.8h4.2c.5 0 .9.4.9.8V7" />
      <path d="M6.5 7 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4.2L19 9.2a2.2 2.2 0 0 0 0-3.1l-1.1-1.1a2.2 2.2 0 0 0-3.1 0L4 15.8V20Z" />
      <path d="M13.5 6.5l3 3" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5a.5.5 0 0 0 .5.5H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a.5.5 0 0 0 .5-.5V10" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5V16.5L12 21l-8.5-4.5Z" />
      <path d="M3.7 7.7 12 12l8.3-4.3" />
      <path d="M12 12v9" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M2.7 19.5a6.3 6.3 0 0 1 12.6 0" />
      <path d="M15.5 5.4a3 3 0 0 1 0 5.8" />
      <path d="M17.3 13.6a6.3 6.3 0 0 1 4 5.9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M4.8 6l1.9 1.9M17.3 16.1l1.9 1.9M2.8 12h2.6M18.6 12h2.6M4.8 18l1.9-1.9M17.3 7.9l1.9-1.9" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="M7.5 10l4.5 4.5 4.5-4.5" />
      <path d="M4.5 18.5h15" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.3" />
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="18.5" r="2.3" />
      <path d="M8.1 10.7l7.8-4.2M8.1 13.3l7.8 4.2" />
    </>
  ),
  printer: (
    <>
      <path d="M6.5 8.5V4h11v4.5" />
      <path d="M4.5 16h-1a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 3.5 8h17A1.5 1.5 0 0 1 22 9.5v5a1.5 1.5 0 0 1-1.5 1.5h-1" />
      <path d="M6.5 13.5h11V21h-11Z" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </>
  ),
  "credit-card": (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="1.8" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h4" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M5.5 9v0M18.5 15v0" />
    </>
  ),
  bank: (
    <>
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M4.5 10.5V19M9.5 10.5V19M14.5 10.5V19M19.5 10.5V19" />
      <path d="M3 19h18" />
    </>
  ),
  "qr-code": (
    <>
      <rect x="3" y="3" width="6.5" height="6.5" rx="0.8" />
      <rect x="14.5" y="3" width="6.5" height="6.5" rx="0.8" />
      <rect x="3" y="14.5" width="6.5" height="6.5" rx="0.8" />
      <path d="M14.5 15h3v3h-3zM19.5 15h1.5M14.5 20.5h1.5M19.5 20.5h1.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-2.5-1.6L13 21l-1.5-1.6L10 21l-1.5-1.6L6 21Z" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  building: (
    <>
      <rect x="4.5" y="3" width="9" height="18" rx="0.8" />
      <path d="M13.5 8.5h6a.8.8 0 0 1 .8.8V21h-6.8" />
      <path d="M7.5 6.5h0M10 6.5h0M7.5 10h0M10 10h0M7.5 13.5h0M10 13.5h0M7.5 17h0M10 17h0M16.5 12h0M16.5 15.5h0" />
    </>
  ),
};

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: IconName;
  /** Tamaño en px (ancho = alto, el ícono es siempre cuadrado). */
  size?: number;
  /** Texto accesible. Pasarlo SOLO cuando el ícono es el control completo (sin texto visible al lado) — ver `IconButton`. */
  label?: string;
}

export function Icon({ name, size = 20, label, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export default Icon;
