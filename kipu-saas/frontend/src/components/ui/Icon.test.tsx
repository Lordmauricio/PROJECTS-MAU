import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon (Offline 4.15)", () => {
  it("es decorativo por defecto: aria-hidden, sin rol", () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("con label queda accesible como imagen con nombre", () => {
    render(<Icon name="close" label="Cerrar" />);
    expect(screen.getByRole("img", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("cambia de tamaño real (ancho/alto del svg)", () => {
    const { container } = render(<Icon name="plus" size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });

  it("todos los nombres declarados en IconName renderizan sin lanzar", () => {
    // Si algún nombre no tuviera un path definido, `PATHS[name]` sería
    // `undefined` y el <svg> quedaría vacío en vez de lanzar — por eso se
    // verifica contenido real, no solo ausencia de excepción.
    const allNames = [
      "search", "cart", "menu", "close", "plus", "minus", "check",
      "chevron-down", "chevron-up", "chevron-left", "chevron-right",
      "user", "eye", "eye-off", "wifi-off", "sync", "alert-triangle",
      "trash", "edit", "home", "box", "users", "settings", "download",
      "share", "printer", "arrow-left", "credit-card", "banknote", "bank",
      "qr-code", "receipt", "building",
    ] as const;
    for (const name of allNames) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg")!;
      expect(svg.children.length, `el ícono "${name}" no tiene ningún path`).toBeGreaterThan(0);
      unmount();
    }
  });
});
