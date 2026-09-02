import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";
import { Select } from "./Select";

describe("Input (Offline 4.15)", () => {
  it("el label queda SIEMPRE asociado al campo — el bug real que encontró Offline 4.14.5 no puede repetirse", () => {
    render(<Input label="Email" />);
    // getByLabelText falla si htmlFor/id no coinciden — es la prueba que
    // habría atrapado el bug de /login antes de que llegara a un E2E real.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("genera un id propio si no se pasa uno (dos inputs sin id no colisionan)", () => {
    render(
      <>
        <Input label="Email" />
        <Input label="Contraseña" />
      </>,
    );
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(email.id).not.toBe("");
    expect(email.id).not.toBe(password.id);
  });

  it("respeta un id explícito (para formularios que ya lo fijan)", () => {
    render(<Input label="NIT" id="org-nit" />);
    expect(screen.getByLabelText("NIT")).toHaveAttribute("id", "org-nit");
  });

  it("hideLabel oculta visualmente pero conserva el nombre accesible", () => {
    render(<Input label="Buscar producto" hideLabel placeholder="Buscar..." />);
    expect(screen.getByLabelText("Buscar producto")).toBeInTheDocument();
  });

  it("un error se anuncia (role=alert) y queda enlazado vía aria-describedby", () => {
    render(<Input label="Email" error="Formato inválido" />);
    const input = screen.getByLabelText("Email");
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Formato inválido");
    expect(input).toHaveAttribute("aria-describedby", error.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("acepta escritura real del usuario", async () => {
    render(<Input label="Email" />);
    await userEvent.type(screen.getByLabelText("Email"), "mau@quirquina.test");
    expect(screen.getByLabelText("Email")).toHaveValue("mau@quirquina.test");
  });
});

describe("Select (Offline 4.15)", () => {
  it("el label queda asociado y las opciones son seleccionables", async () => {
    render(
      <Select label="Método de pago" defaultValue="CASH">
        <option value="CASH">Efectivo</option>
        <option value="CARD">Tarjeta</option>
      </Select>,
    );
    const select = screen.getByLabelText("Método de pago") as HTMLSelectElement;
    await userEvent.selectOptions(select, "CARD");
    expect(select.value).toBe("CARD");
  });
});
