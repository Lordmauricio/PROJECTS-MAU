import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

/**
 * Offline 4.14.1 — tests del Web App Manifest.
 *
 * No se prueba "que el objeto tenga campos": se prueban los requisitos REALES
 * que Chrome Android exige para ofrecer la instalación, y la coherencia entre
 * lo que el manifest promete y lo que existe de verdad en `public/`. Un
 * manifest que apunta a un icono inexistente pasa cualquier test de forma y
 * falla en el teléfono — por eso acá se lee el PNG del disco.
 */

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

/** Lee ancho/alto reales de la cabecera IHDR de un PNG, sin dependencias. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // firma PNG
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("Web App Manifest (Offline 4.14.1)", () => {
  const m = manifest();

  it("declara los campos que exige el criterio de instalabilidad", () => {
    expect(m.name).toBe("KIPU SAAS");
    expect(m.short_name).toBe("KIPU");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBeTruthy();
    expect(m.background_color).toBeTruthy();
    expect(m.icons?.length).toBeGreaterThan(0);
  });

  it("short_name entra en el lanzador de Android (<= 12 caracteres)", () => {
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("usa la identidad visual YA existente de KIPU, no un branding nuevo", () => {
    // zinc-900: el `bg-zinc-900` del sidebar y de la barra superior móvil de
    // AppShell. zinc-50: el `bg-zinc-50` que layout.tsx aplica al <body>.
    expect(m.theme_color).toBe("#18181b");
    expect(m.background_color).toBe("#fafafa");
  });

  it("el scope cubre toda la app, para que el POS abra dentro de la ventana instalada", () => {
    expect(m.scope).toBe("/");
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
  });

  it("incluye los tamaños 192 y 512 que Chrome Android exige para instalar", () => {
    const anyIcons = m.icons!.filter((i) => i.purpose === "any");
    const sizes = anyIcons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("incluye un icono maskable, para que Android no recorte el wordmark", () => {
    const maskable = m.icons!.filter((i) => i.purpose === "maskable");
    expect(maskable.length).toBeGreaterThan(0);
    expect(maskable.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("cada icono declarado EXISTE en public/ y mide exactamente lo que promete", () => {
    for (const icon of m.icons!) {
      const file = path.join(PUBLIC_DIR, icon.src!.replace(/^\//, ""));
      expect(existsSync(file), `falta el icono ${icon.src}`).toBe(true);

      const [w, h] = icon.sizes!.split("x").map(Number);
      const real = pngSize(file);
      expect(real.width, `${icon.src} ancho`).toBe(w);
      expect(real.height, `${icon.src} alto`).toBe(h);
    }
  });

  it("no filtra ningún dato de negocio ni secreto en un archivo público", () => {
    const serialized = JSON.stringify(m).toLowerCase();
    for (const forbidden of ["token", "password", "secret", "authorization", "nit", "organizationid"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
