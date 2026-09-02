import { expect, test, type Page } from "@playwright/test";
import { installFakeBackend, PRODUCTS, USER } from "./support/fake-backend";

/**
 * Offline 4.14.5 — el recorrido prioritario cabe en la pantalla de un teléfono.
 *
 * La auditoría de continuidad encontró 13 pantallas con tablas que desbordan
 * horizontalmente. Esta fase NO las arregla todas —sería reconstruir la UI—,
 * sino que fija el recorrido que el negocio necesita en Android: entrar,
 * vender e imprimir. Lo que se prueba es el desborde REAL medido en un
 * navegador a 360 px, no la presencia de clases de Tailwind: una utilidad
 * responsive puesta en el lugar equivocado no evita que el usuario tenga que
 * arrastrar la pantalla de lado para llegar al botón de confirmar.
 *
 * 360x780 es el tamaño de un Android de gama media típico, más chico que la
 * mayoría — si entra acá, entra en el resto.
 */

test.use({ viewport: { width: 360, height: 780 } });

/** Mide el desborde horizontal real del documento. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

test("el recorrido de venta en Android no obliga a desplazarse en horizontal", async ({
  page,
  context,
}) => {
  await installFakeBackend(context);

  await test.step("login", async () => {
    await page.goto("/login");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Los <label> están asociados a sus campos: tocar el texto enfoca el
    // input, que en un teléfono es la diferencia entre acertar y no.
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel("Contraseña").fill("una-contraseña");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step("dashboard", async () => {
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  await test.step("POS con carrito y pago cargados", async () => {
    await page.goto("/sales/pos");
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(PRODUCTS[0].name) }).click();
    // Offline 4.15: agregar un producto abre el bottom sheet del carrito
    // automáticamente — comportamiento nuevo y real, no un detalle de test.
    // El resto del recorrido (pago, historial) sigue ocurriendo con el
    // carrito ya cargado, así que ninguna aserción de datos cambia.
    await expect(page.getByRole("dialog", { name: /Carrito/ })).toBeVisible();
    await page.getByRole("button", { name: "+ método" }).click();
    await page.getByLabel("Monto").fill("25.00");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  await test.step("cerrar el bottom sheet del carrito", async () => {
    // Es un modal real (aria-modal): mientras está abierto, tapa a propósito
    // el resto de la pantalla — hay que cerrarlo para seguir navegando,
    // exactamente como haría un cajero real con el dedo.
    await page.getByRole("button", { name: "Cerrar" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  await test.step("historial local desplegado", async () => {
    await page.getByRole("button", { name: /Ventas de este dispositivo/ }).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  await test.step("los controles del POS se pueden tocar con el dedo", async () => {
    // El botón vive dentro del bottom sheet del carrito — se reabre con la
    // barra flotante "Ver carrito" antes de medirlo.
    await page.getByRole("button", { name: /Ver carrito/ }).click();
    await expect(page.getByRole("dialog", { name: /Carrito/ })).toBeVisible();

    // 44 px es el mínimo recomendado para un objetivo táctil; por debajo, un
    // cajero con prisa falla el toque una de cada varias veces.
    const box = await page.getByRole("button", { name: "Confirmar venta" }).boundingBox();
    expect(box, "el botón de confirmar debe ser visible").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.getByRole("button", { name: "Cerrar" }).click();
  });

  await test.step("menú lateral móvil abierto", async () => {
    await page.getByRole("button", { name: "Abrir menú" }).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

});
