import { expect, test, type Page } from "@playwright/test";

async function openSession(page: Page) {
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.setItem("kipu_token", "visual-test");
    localStorage.setItem("kipu_refresh_token", "visual-refresh");
    localStorage.setItem(
      "kipu_user",
      JSON.stringify({
        id: "visual-user",
        name: "Operador",
        email: "operador@example.test",
      }),
    );
    localStorage.setItem(
      "kipu_organization",
      JSON.stringify({ id: "visual-org", name: "Pollería de prueba" }),
    );
  });
}

const summary = {
  salesToday: { count: 0, total: "0" },
  salesMonth: { count: 0, total: "0" },
  purchasesMonth: { count: 0, total: "0" },
  incomeMonth: "0",
  expensesMonth: "0",
  invoicesIssued: 0,
  customersServed: 0,
  productsActive: 0,
  lowStockProducts: 0,
  pendingReceivables: { count: 0, total: "0" },
  pendingPayables: { count: 0, total: "0" },
  stockValue: "0",
  topProducts: [],
  grossMargin: { available: false, reason: "Sin actividad registrada" },
};

test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:4200/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/notifications/unread-count") data = { count: 0 };
    if (path === "/customers")
      data = [
        {
          id: "customer",
          name: "Restaurante de prueba",
          documentType: "NIT",
          documentNumber: "1234567890",
          phone: "70707070",
          email:
            "contacto-muy-largo-para-comprobar-desplazamiento@example.test",
          active: true,
        },
      ];
    if (path === "/products")
      data = [
        {
          id: "product",
          name: "Combo de pollo con guarnición",
          price: "125.50",
          category: { name: "Combos" },
          sku: "COMBO-POLLO-COCHABAMBA-0001",
        },
      ];
    if (path === "/organizations/me/dashboard") data = summary;
    await route.fulfill({ json: data });
  });
  await openSession(page);
});

for (const [path, title] of [
  ["/customers", "Clientes"],
  ["/inventory/products", "Productos"],
] as const) {
  test(`${title}: formularios y tabla utilizables en móvil`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const table = page.getByRole("region", { name: title, exact: true });
    await expect(table.getByRole("row")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await table.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    await table.focus();
    await expect(table).toBeFocused();
    await table.press("ArrowRight");
    await expect
      .poll(() => table.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    const name = page.getByLabel(
      "Nombre",
      { exact: true },
    );
    await expect(name).toBeVisible();
    expect(
      (await page
        .getByRole("button", {
          name: path === "/customers" ? "Agregar cliente" : "Agregar producto",
        })
        .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path:
        path === "/customers"
          ? "/tmp/kipu-stage2-customers-mobile.png"
          : "/tmp/kipu-stage2-products-mobile.png",
      fullPage: true,
    });
  });
}

test("navegación móvil conserva foco, cierra con Escape y libera el contenido", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers");
  const open = page.getByRole("button", {
    name: "Abrir navegación",
    exact: true,
  });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Navegación principal" });
  await expect(
    dialog.getByRole("link", { name: "Inicio", exact: true }),
  ).toBeFocused();
  expect(await page.locator("main").evaluate((element) => element instanceof HTMLElement && element.inert)).toBe(
    true,
  );
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Cerrar navegación", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("link", { name: "Inicio", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await expect(dialog).toHaveCount(0);
  expect(await page.locator("main").evaluate((element) => element instanceof HTMLElement && element.inert)).toBe(
    false,
  );
  await open.click();
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("main").evaluate((element) => element instanceof HTMLElement && element.inert)).toBe(
    false,
  );
  await expect(
    page.getByRole("link", { name: "Clientes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("el enlace de salto permite llegar al contenido con teclado", async ({
  page,
}) => {
  await page.goto("/customers");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Ir al contenido" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("Inicio recupera errores y muestra estado vacío y accesos operativos", async ({
  page,
}) => {
  let fail = true;
  await page.route(
    "http://localhost:4200/organizations/me/dashboard",
    (route) =>
      route.fulfill({
        status: fail ? 503 : 200,
        json: fail
          ? { message: "Resumen temporalmente no disponible" }
          : summary,
      }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Resumen temporalmente no disponible" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("Todavía no hay ventas este mes")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Abrir caja gastronómica/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/kipu-stage2-dashboard-mobile.png",
    fullPage: true,
  });
});

test("preferencia oscura del dispositivo mantiene el tema claro legible", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/customers");
  await expect(page.getByLabel("Nombre", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("light");
});
