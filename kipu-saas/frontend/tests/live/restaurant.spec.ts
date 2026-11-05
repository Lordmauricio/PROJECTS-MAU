import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiURL = "http://127.0.0.1:4300";
async function register(page: Page) {
  const suffix = randomUUID();
  const email = `piloto-${suffix}@example.test`;
  const password = "Piloto-Kipu-2026!";
  await page.goto("/register");
  await page
    .getByLabel("Nombre comercial")
    .fill(`Pollería ${suffix.slice(0, 6)}`);
  await page.getByLabel("Razón social").fill("Piloto local");
  await page.getByLabel("NIT", { exact: true }).fill(suffix);
  await page.getByLabel("Tu nombre").fill("Operador del piloto");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const token = await page.evaluate(() => localStorage.getItem("kipu_token"));
  const call = async <T = Record<string, unknown>>(
    path: string,
    method = "GET",
    data?: unknown,
  ): Promise<T> => {
    const response = await page.request.fetch(`${apiURL}${path}`, {
      method,
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      response.ok(),
      `${method} ${path}: ${response.status()}`,
    ).toBeTruthy();
    return response.json() as Promise<T>;
  };
  const [branch] = await call<
    {
      id: string;
      warehouses: { id: string }[];
      posTerminals: { id: string }[];
    }[]
  >("/branches");
  return { call, branch, email, password };
}

test("registro, login, compra, venta, devolución y cierre con servicios reales", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { call, branch, email, password } = await register(page);
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const product = await call<{ id: string }>("/products", "POST", {
    name: "Cuarto de pollo",
    price: 25,
    cost: 12,
  });
  const supplier = await call<{ id: string }>("/suppliers", "POST", {
    name: "Proveedor del piloto",
  });
  await page.goto("/cash");
  await page.getByPlaceholder("Saldo inicial").fill("100");
  const openedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiURL}/cash-registers` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Abrir caja", exact: true }).click();
  const opened = (await (await openedResponse).json()) as { id: string };
  await expect(page.getByText("Caja abierta correctamente.")).toBeVisible();
  await page.goto("/purchases");
  const form = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Nueva orden de compra" }),
  });
  await expect(
    form
      .locator("select")
      .first()
      .getByRole("option", { name: "Proveedor del piloto" }),
  ).toBeAttached();
  await form.locator("select").first().selectOption(supplier.id);
  await form.getByRole("button", { name: "+ producto" }).click();
  await form.locator("input[type=number]").nth(0).fill("10");
  await form.locator("input[type=number]").nth(1).fill("12");
  const purchaseResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiURL}/purchases` &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Crear orden", exact: true }).click();
  const purchase = (await (await purchaseResponse).json()) as { id: string };
  await page.goto(`/purchases/${purchase.id}`);
  await page
    .getByRole("button", { name: "Confirmar orden", exact: true })
    .click();
  const receive = page.locator("form").filter({
    has: page.getByRole("heading", {
      name: "Registrar recepción",
      exact: true,
    }),
  });
  await receive.locator("input[type=number]").fill("10");
  await receive
    .getByRole("button", { name: "Registrar recepción", exact: true })
    .click();
  await expect(page.getByText("Recibida", { exact: true })).toBeVisible();
  await page.goto("/sales/pos");
  await page.getByRole("button", { name: /Cuarto de pollo/ }).click();
  await page.getByRole("button", { name: "+ método" }).click();
  await page.getByPlaceholder("Monto", { exact: true }).fill("25");
  const saleResponse = page.waitForResponse(
    (response) =>
      /\/sales\/[^/]+\/confirm$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirmar venta", exact: true })
    .click();
  const sale = (await (await saleResponse).json()) as {
    id: string;
    status: string;
  };
  expect(sale.status).toBe("PAID");
  await expect(page.getByText(/Venta confirmada/)).toBeVisible();
  await page.goto(`/sales/${sale.id}`);
  await page.getByRole("button", { name: "Registrar devolución" }).click();
  await expect(page.getByText("Devuelta", { exact: true })).toBeVisible();
  const stock = await call<{ quantity: string }[]>(
    `/inventory?warehouseId=${branch.warehouses[0].id}&productId=${product.id}`,
  );
  expect(Number(stock[0].quantity)).toBe(10);
  await page.goto(`/cash/${opened.id}`);
  await page.getByPlaceholder("Efectivo contado").fill("100");
  const closeResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/cash-registers/${opened.id}/close`),
  );
  await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
  const closed = (await (await closeResponse).json()) as {
    status: string;
    difference: string;
  };
  expect(closed.status).toBe("CLOSED");
  expect(Number(closed.difference)).toBe(0);
  expect(errors).toEqual([]);
});

test("combo táctil, pérdida de respuestas, pago mixto, cocina y despacho reales", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { call, branch } = await register(page);
  const warehouseId = branch.warehouses[0].id;
  const chicken = await call<{ id: string }>("/products", "POST", {
    name: "Pollo entero",
    price: 80,
  });
  const side = await call<{ id: string }>("/products", "POST", {
    name: "Papas",
    price: 5,
  });
  const anchor = await call<{ id: string }>("/products", "POST", {
    name: "Combo pollo",
    price: 25,
  });
  for (const productId of [chicken.id, side.id])
    await call("/inventory/movements", "POST", {
      warehouseId,
      productId,
      type: "IN",
      quantity: 20,
      idempotencyKey: randomUUID(),
    });
  const cash = await call<{ id: string }>("/cash-registers", "POST", {
    posTerminalId: branch.posTerminals[0].id,
    openingAmount: 100,
    idempotencyKey: randomUUID(),
  });
  await page.goto("/restaurant/menu");
  await page.getByLabel("Producto de venta").selectOption(anchor.id);
  await page.getByLabel("Nombre del plato").fill("Combo de cuarto");
  await page.getByLabel("Categoría", { exact: true }).fill("Combos");
  await page.getByLabel("Estación", { exact: true }).fill("Parrilla");
  await page
    .getByLabel("Producto componente 1", { exact: true })
    .selectOption(chicken.id);
  await page.getByLabel("Cantidad componente 1", { exact: true }).fill("0.25");
  await page
    .getByRole("button", { name: "Agregar componente", exact: true })
    .click();
  await page
    .getByLabel("Producto componente 2", { exact: true })
    .selectOption(side.id);
  await page
    .getByRole("button", { name: "Agregar opción", exact: true })
    .click();
  const option = page.getByRole("region", { name: "Opción 1" });
  await option.getByLabel("Nombre de la opción").fill("Papas extra");
  await option.getByLabel("Precio adicional en Bs").fill("3");
  await option.getByRole("button", { name: "Agregar componente" }).click();
  await option.getByLabel("Producto componente 1").selectOption(side.id);
  await page.getByRole("button", { name: "Guardar plato" }).click();
  await expect(
    page.getByText("Plato agregado al menú.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/restaurant/pos");
  await page
    .getByRole("button", { name: "Agregar Combo de cuarto", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Papas extra/).check();
  await dialog.getByRole("button", { name: "Agregar al pedido" }).click();
  await page.getByLabel("Nombre para entregar").fill("Mesa de prueba");
  await page.getByLabel("Observaciones para cocina").fill("Sin ají");
  let lostCreate = false;
  await page.route(`${apiURL}/restaurant/orders`, async (route) => {
    if (route.request().method() === "POST" && !lostCreate) {
      lostCreate = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Guardar pedido", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Recuperar el mismo pedido" }).click();
  await expect(
    page.getByRole("button", { name: "Cobrar y enviar a cocina" }),
  ).toBeVisible();
  await page.getByLabel("Monto de pago 1").fill("10");
  await page.getByRole("button", { name: "Agregar método de pago" }).click();
  await page.getByLabel("Método de pago 2").selectOption("QR");
  await page.getByLabel("Efectivo recibido").fill("20");
  await expect(page.getByText(/QR manual: comprueba/)).toBeVisible();
  const orders = await call<{ id: string; saleId: string }[]>(
    "/restaurant/orders?status=DRAFT",
  );
  expect(orders).toHaveLength(1);
  const order = orders[0];
  let lostCheckout = false;
  await page.route(
    `${apiURL}/restaurant/orders/${order.id}/checkout`,
    async (route) => {
      if (!lostCheckout) {
        lostCheckout = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Cobrar y enviar a cocina" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Cobrar y enviar a cocina" }).click();
  await expect(
    page.getByText("Pedido cobrado y enviado a cocina"),
  ).toBeVisible();
  await expect(page.getByText("Cambio: Bs 10.00")).toBeVisible();
  const saved = await call<{ sale: { payments: unknown[] }; status: string }>(
    `/restaurant/orders/${order.id}`,
  );
  expect(saved.sale.payments).toHaveLength(2);
  expect(saved.status).toBe("QUEUED");
  const stock = await call<{ productId: string; quantity: string }[]>(
    `/inventory?warehouseId=${warehouseId}`,
  );
  expect(Number(stock.find((s) => s.productId === chicken.id)?.quantity)).toBe(
    19.75,
  );
  expect(Number(stock.find((s) => s.productId === side.id)?.quantity)).toBe(18);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/kipu-pos-tablet.png", fullPage: true });
  await page.goto("/restaurant/kitchen");
  const card = page.getByRole("article", {
    name: `Pedido ${order.id.slice(-6)}`,
  });
  await expect(card.getByText("Sin ají")).toBeVisible();
  await card.getByRole("button", { name: "Iniciar preparación" }).click();
  await expect(
    card.getByRole("button", { name: "Marcar listo" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await card.getByRole("button", { name: "Imprimir", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Reimprimir", exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Reimprimir", exact: true }).click();
  await expect(page.locator(".order-ticket")).toContainText(
    "REIMPRESIÓN · Copia 2",
  );
  await page.screenshot({
    path: "/tmp/kipu-kitchen-tablet.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await card.getByRole("button", { name: "Marcar listo" }).click();
  await card.getByRole("button", { name: "Entregar pedido" }).click();
  await expect(card).toHaveCount(0);
  expect(
    (await call<{ status: string }>(`/restaurant/orders/${order.id}`)).status,
  ).toBe("DELIVERED");
  await page.goto(`/cash/${cash.id}`);
  await page.getByPlaceholder("Efectivo contado").fill("110");
  const closeResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/cash-registers/${cash.id}/close`),
  );
  await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
  expect(
    Number(
      ((await (await closeResponse).json()) as { difference: string })
        .difference,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});

test("administración móvil con datos reales y navegación accesible", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { call } = await register(page);
  await call("/products", "POST", {
    name: "Combo de pollo para revisión móvil",
    price: 35,
  });
  await call("/customers", "POST", {
    name: "Cliente de revisión móvil",
    documentNumber: "987654321",
    email: "cliente-revision-movil@example.test",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ["/dashboard", "Inicio"],
    ["/customers", "Clientes"],
    ["/inventory/products", "Productos"],
    ["/cash", "Caja y Bancos"],
    ["/purchases", "Compras"],
    ["/reports", "Reportes"],
    ["/settings", "Configuración"],
    ["/users", "Usuarios y Permisos"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    // Wait for real API reads and their resulting layout, including long row data.
    if (path === "/customers")
      await expect(
        page.getByRole("cell", { name: "Cliente de revisión móvil" }),
      ).toBeVisible();
    if (path === "/inventory/products")
      await expect(
        page.getByRole("cell", { name: "Combo de pollo para revisión móvil" }),
      ).toBeVisible();
    if (path === "/dashboard")
      await expect(
        page.getByText("Todavía no hay ventas este mes"),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      path,
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Abrir navegación", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Navegación principal" });
  await expect(
    dialog.getByRole("link", { name: "Inicio", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Abrir navegación", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
