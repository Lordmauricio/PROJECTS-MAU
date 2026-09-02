import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, IconButton } from "./Button";

describe("Button (Offline 4.15)", () => {
  it("es un <button type=button> por defecto — nunca envía un form sin querer", () => {
    render(<Button>Confirmar</Button>);
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveAttribute("type", "button");
  });

  it("respeta type=submit cuando se pasa explícitamente", () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveAttribute("type", "submit");
  });

  it("dispara onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("loading deshabilita el botón y marca aria-busy, sin desmontar el texto", () => {
    render(<Button loading>Confirmar venta</Button>);
    const button = screen.getByRole("button", { name: "Confirmar venta" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("un botón deshabilitado no dispara onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        No disponible
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "No disponible" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("con icon muestra el ícono decorativo junto al texto, sin duplicar el nombre accesible", () => {
    render(
      <Button icon="cart" iconPosition="start">
        Ver carrito
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Ver carrito" });
    expect(button.querySelector("svg")).toBeInTheDocument();
  });
});

describe("IconButton (Offline 4.15)", () => {
  it("exige label y lo expone como nombre accesible", () => {
    render(<IconButton icon="close" label="Cerrar carrito" />);
    expect(screen.getByRole("button", { name: "Cerrar carrito" })).toBeInTheDocument();
  });

  it("dispara onClick igual que un botón normal", async () => {
    const onClick = vi.fn();
    render(<IconButton icon="trash" label="Eliminar" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
