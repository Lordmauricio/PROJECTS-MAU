import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingState, ErrorState, EmptyState } from "./States";

describe("LoadingState / ErrorState / EmptyState (Offline 4.15)", () => {
  it("LoadingState se anuncia como role=status", () => {
    render(<LoadingState label="Cargando catálogo…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando catálogo…");
  });

  it("ErrorState se anuncia como role=alert con el mensaje real, no uno genérico", () => {
    render(<ErrorState message="No se pudo cargar el resumen de la empresa" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar el resumen de la empresa",
    );
  });

  it("EmptyState muestra título y, si se pasa, una acción (ej. 'Nuevo producto')", () => {
    render(
      <EmptyState
        icon="box"
        title="Sin productos cacheados todavía"
        description="Conectate una vez para descargar el catálogo."
        action={<button>Reintentar</button>}
      />,
    );
    expect(screen.getByText("Sin productos cacheados todavía")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
