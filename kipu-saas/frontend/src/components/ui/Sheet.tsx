"use client";

import { useEffect, useRef } from "react";
import { IconButton } from "./Button";

/**
 * Offline 4.15 (rediseño Stitch) — panel modal / bottom sheet.
 *
 * Un solo componente para las dos variantes que el diseño de Stitch usa:
 * `variant="sheet"` (el carrito del POS móvil, sube desde abajo — Fase
 * UI-2) y `variant="dialog"` (confirmaciones/formularios de escritorio,
 * centrado). La lógica de apertura/cierre/foco es idéntica en ambos casos;
 * solo cambia dónde se ancla el panel.
 *
 * Accesibilidad: `role="dialog"` + `aria-modal`, cierra con Escape, cierra
 * al tocar el fondo, y devuelve el foco al elemento que abrió el sheet al
 * cerrarse (el patrón habitual de un modal — sin esto, un usuario de
 * teclado queda "perdido" dentro de una página que ya no tiene el panel).
 * NO es una librería de terceros: es el mínimo necesario, a mano, sin
 * agregar una dependencia de UI para esto.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  variant?: "sheet" | "dialog";
  children: React.ReactNode;
  /** Contenido fijo al pie (ej. el total + botón confirmar del carrito), fuera del área con scroll. */
  footer?: React.ReactNode;
}

export function Sheet({ open, onClose, title, variant = "dialog", children, footer }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const panelPosition =
    variant === "sheet"
      ? "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl"
      : "fixed inset-0 m-auto h-fit max-h-[85vh] w-[min(480px,92vw)] rounded-xl";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex w-full flex-col bg-surface shadow-xl outline-none ${panelPosition}`}
      >
        {variant === "sheet" && (
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-full bg-zinc-300" />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <IconButton icon="close" label="Cerrar" onClick={onClose} size="sm" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export default Sheet;
