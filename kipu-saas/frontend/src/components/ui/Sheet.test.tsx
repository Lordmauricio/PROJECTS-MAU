import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./Sheet";

describe("Sheet (Offline 4.15) — carrito móvil del POS y diálogos de escritorio", () => {
  it("no renderiza nada mientras open=false", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Carrito">
        contenido
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abierto: expone role=dialog con aria-modal y el título como nombre accesible", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Carrito (2)">
        contenido
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Carrito (2)" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("Escape cierra el sheet", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Carrito">
        contenido
      </Sheet>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tocar el fondo cierra el sheet", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open onClose={onClose} title="Carrito">
        contenido
      </Sheet>,
    );
    const backdrop = container.querySelector('[aria-hidden="true"].absolute')!;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el botón Cerrar dispara onClose", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Carrito">
        contenido
      </Sheet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("al abrir mueve el foco DENTRO del panel (no se queda perdido detrás del overlay)", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Carrito">
        contenido
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("al cerrar devuelve el foco al elemento que abrió el sheet", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir carrito</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Carrito">
            contenido
          </Sheet>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir carrito" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("renderiza el footer fuera del área con scroll (para el total+confirmar del carrito)", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Carrito" footer={<button>Confirmar venta</button>}>
        contenido
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Confirmar venta" })).toBeInTheDocument();
  });

  it("variant=sheet ancla el panel abajo (arrastre táctil); variant=dialog lo centra", () => {
    const { container, rerender } = render(
      <Sheet open onClose={vi.fn()} title="Carrito" variant="sheet">
        x
      </Sheet>,
    );
    expect(container.querySelector('[role="dialog"]')?.className).toContain("bottom-0");

    rerender(
      <Sheet open onClose={vi.fn()} title="Confirmar" variant="dialog">
        x
      </Sheet>,
    );
    expect(container.querySelector('[role="dialog"]')?.className).toContain("inset-0");
  });
});
