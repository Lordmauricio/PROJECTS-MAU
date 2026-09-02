/** Offline 4.15 (rediseño Stitch) — contenedor de tarjeta, el bloque visual que se repite en dashboard/POS/listados. */
export function Card({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-border px-4 py-3 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`p-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export default Card;
