import type { ComponentProps } from "react";

/** Keeps wide administrative tables scrollable without widening the page. */
export default function ResponsiveTable({
  label,
  ...props
}: ComponentProps<"table"> & { label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="responsive-table min-w-0 max-w-full overflow-x-auto"
    >
      <table {...props} />
    </div>
  );
}
