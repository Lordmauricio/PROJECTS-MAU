import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge (Offline 4.15)", () => {
  it("renderiza el texto de estado", () => {
    render(<Badge tone="warning">Pendiente de sincronizar</Badge>);
    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
  });

  it("dot agrega un indicador visual, nunca reemplaza el texto (nunca solo color)", () => {
    const { container } = render(
      <Badge tone="danger" dot>
        Error de sincronización
      </Badge>,
    );
    expect(screen.getByText("Error de sincronización")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
