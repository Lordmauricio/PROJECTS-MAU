import type { ReactNode } from "react";

export default function PageState({
  kind,
  title,
  children,
  onRetry,
}: {
  kind: "loading" | "error" | "empty";
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={`rounded-2xl border p-5 ${kind === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-zinc-200 bg-white text-zinc-700"}`}
    >
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm">{children}</div>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 min-h-11 rounded-xl border border-current px-4 py-2 text-sm font-medium"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
