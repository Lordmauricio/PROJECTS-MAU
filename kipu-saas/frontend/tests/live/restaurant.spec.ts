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
  await page.getByLabel("Nombre del plato").fill("Combo de pollo");
  await page.getByLabel("Presentación (opcional)").fill("Cuarto");
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
    .getByRole("button", {
      name: "Agregar Combo de pollo · Cuarto",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Papas extra/).check();
  await dialog.getByRole("button", { name: "Agregar al pedido" }).click();
  await page.getByLabel("Nombre para entregar").fill("Mesa de prueba");
  await page.getByLabel("Observaciones para cocina").fill("Sin ají");
  await page
    .getByRole("button", { name: "Revisar disponibilidad y total" })
    .click();
  await expect(
    page.getByText("Total revisado: Bs 28.00", { exact: true }),
  ).toBeVisible();
  expect(await call<unknown[]>("/restaurant/orders?status=DRAFT")).toHaveLength(
    0,
  );
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
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
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
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
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

test("revisión previa bloquea faltantes y admite una sustitución disponible", async ({
  page,
}) => {
  const { call, branch } = await register(page);
  const empty = await call<{ id: string }>("/products", "POST", {
    name: "Papas sin existencias",
    price: 5,
  });
  const rice = await call<{ id: string }>("/products", "POST", {
    name: "Arroz disponible",
    price: 5,
  });
  const warehouseId = branch.warehouses[0].id;
  await call("/inventory/movements", "POST", {
    productId: rice.id,
    warehouseId,
    type: "IN",
    quantity: 2,
    idempotencyKey: randomUUID(),
  });
  await call("/restaurant/menu", "POST", {
    productId: empty.id,
    name: "Guarnición",
    presentation: "Porción",
    category: "Guarniciones",
    station: "Cocina",
    price: 5,
    active: true,
    components: [{ productId: empty.id, quantity: 1 }],
    options: [
      {
        id: "rice",
        name: "Cambiar por arroz",
        replacesProductId: empty.id,
        price: 0,
        components: [{ productId: rice.id, quantity: 1 }],
      },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/restaurant/pos");
  const add = page.getByRole("button", {
    name: "Agregar Guarnición · Porción",
    exact: true,
  });
  await expect(add).toBeEnabled();
  await add.click();
  await page
    .getByRole("button", { name: "Agregar al pedido", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar pedido", exact: true })
    .click();
  await expect(
    page.getByText("Faltan componentes para completar el pedido.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "No alcanza el stock",
  );
  expect(await call<unknown[]>("/restaurant/orders?status=DRAFT")).toHaveLength(
    0,
  );
  await page
    .getByRole("button", { name: "Restar Guarnición · Porción", exact: true })
    .click();
  await add.click();
  await page
    .getByRole("dialog")
    .getByLabel(/Cambiar por arroz/)
    .check();
  await page
    .getByRole("button", { name: "Agregar al pedido", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revisar disponibilidad y total" })
    .click();
  await expect(
    page.getByText("Hay disponibilidad para este pedido.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Guardar pedido", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cobrar y enviar a cocina", exact: true }),
  ).toBeVisible();
  const orders = await call<
    {
      snapshot: {
        presentation: string;
        components: { productId: string; referenceUnitPrice: string }[];
      }[];
    }[]
  >("/restaurant/orders?status=DRAFT");
  expect(orders).toHaveLength(1);
  expect(orders[0].snapshot[0].presentation).toBe("Porción");
  expect(orders[0].snapshot[0].components[0]).toMatchObject({
    productId: rice.id,
    referenceUnitPrice: "5.00",
  });
  const stocks = await call<{ productId: string; quantity: string }[]>(
    `/inventory?warehouseId=${warehouseId}`,
  );
  expect(
    Number(stocks.find((row) => row.productId === rice.id)?.quantity),
  ).toBe(2);
  await page
    .getByRole("button", { name: "Cancelar pedido sin cobrar", exact: true })
    .click();
  await expect(
    page.getByText("Elige un plato para comenzar.", { exact: true }),
  ).toBeVisible();
});

test("el encargado cambia el menú y precio de temporada sin alterar pedidos anteriores", async ({
  page,
}) => {
  const { call, branch } = await register(page);
  const product = await call<{ id: string }>("/products", "POST", {
    name: "Pollo de prueba",
    price: 25,
  });
  await call("/inventory/movements", "POST", {
    productId: product.id,
    warehouseId: branch.warehouses[0].id,
    type: "IN",
    quantity: 10,
    idempotencyKey: randomUUID(),
  });
  await call("/cash-registers", "POST", {
    posTerminalId: branch.posTerminals[0].id,
    openingAmount: 100,
    idempotencyKey: randomUUID(),
  });
  const entry = await call<{ id: string }>("/restaurant/menu", "POST", {
    productId: product.id,
    name: "Plato original",
    presentation: "Cuarto",
    category: "Platos",
    station: "Cocina",
    price: 25,
    active: true,
    components: [{ productId: product.id, quantity: 1 }],
    options: [],
  });
  const request = {
    posTerminalId: branch.posTerminals[0].id,
    warehouseId: branch.warehouses[0].id,
    service: "TAKEAWAY",
    items: [{ menuEntryId: entry.id, quantity: 1, optionIds: [] }],
  };
  const oldOrder = await call<{ id: string; sale: { total: string } }>(
    "/restaurant/orders",
    "POST",
    { ...request, requestKey: randomUUID() },
  );
  expect(Number(oldOrder.sale.total)).toBe(25);
  await page.goto("/restaurant/menu");
  await page
    .getByRole("button", {
      name: "Editar Plato original · Cuarto",
      exact: true,
    })
    .click();
  await page.getByLabel("Nombre del plato").fill("Plato de temporada");
  await page.getByLabel("Presentación (opcional)").fill("Medio");
  await page.getByLabel("Precio en Bs", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Guardar plato", exact: true })
    .click();
  await expect(
    page.getByText(
      "Plato actualizado. Los pedidos existentes conservan su composición y precio.",
      { exact: true },
    ),
  ).toBeVisible();
  const fresh = await call<{
    snapshot: { name: string }[];
    sale: { total: string };
  }>("/restaurant/orders", "POST", { ...request, requestKey: randomUUID() });
  expect(Number(fresh.sale.total)).toBe(30);
  expect(fresh.snapshot[0].name).toBe("Plato de temporada · Medio");
  await page
    .getByRole("button", {
      name: "Editar Plato de temporada · Medio",
      exact: true,
    })
    .click();
  await page.getByLabel("Visible en caja", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Guardar plato", exact: true })
    .click();
  await expect(
    page.getByText(
      "Plato actualizado. Los pedidos existentes conservan su composición y precio.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("/restaurant/pos");
  await expect(
    page.getByText("El menú aún está vacío", { exact: true }),
  ).toBeVisible();
  const paid = await call<{
    snapshot: { name: string }[];
    sale: { total: string; status: string };
  }>(`/restaurant/orders/${oldOrder.id}/checkout`, "POST", {
    payments: [{ method: "CASH", amount: 25, idempotencyKey: randomUUID() }],
  });
  expect(paid.sale.status).toBe("PAID");
  expect(Number(paid.sale.total)).toBe(25);
  expect(paid.snapshot[0].name).toBe("Plato original · Cuarto");
});

test("tanda real alimenta porciones y cada estación prepara su comanda antes de entregar", async ({
  page,
}) => {
  const { call, branch } = await register(page);
  const warehouseId = branch.warehouses[0].id;
  const raw = await call<{ id: string }>("/products", "POST", {
    name: "Pollo crudo",
    price: 60,
  });
  const cooked = await call<{ id: string }>("/products", "POST", {
    name: "Pollo preparado",
    price: 80,
  });
  const drink = await call<{ id: string }>("/products", "POST", {
    name: "Refresco de cocina",
    price: 5,
  });
  for (const productId of [raw.id, drink.id])
    await call("/inventory/movements", "POST", {
      warehouseId,
      productId,
      type: "IN",
      quantity: 10,
      idempotencyKey: randomUUID(),
    });
  const menu = await call<{ id: string }>("/restaurant/menu", "POST", {
    productId: cooked.id,
    name: "Pollo preparado",
    presentation: "Cuarto",
    category: "Pollos",
    station: "Parrilla",
    price: 25,
    active: true,
    components: [{ productId: cooked.id, quantity: 0.25 }],
    options: [],
  });
  await call("/restaurant/menu", "POST", {
    productId: drink.id,
    name: "Refresco de cocina",
    category: "Bebidas",
    station: "Bebidas",
    price: 5,
    active: true,
    components: [{ productId: drink.id, quantity: 1 }],
    options: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/restaurant/production");
  await page
    .getByLabel("Nombre de la tanda", { exact: true })
    .fill("Horneada del turno");
  await page
    .getByRole("combobox", { name: "Producto crudo", exact: true })
    .selectOption(raw.id);
  await page
    .getByRole("combobox", { name: "Producto preparado", exact: true })
    .selectOption(cooked.id);
  await page.getByLabel("Cantidad cruda a consumir").fill("4");
  await page.getByLabel("Producción prevista", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "Planificar tanda", exact: true })
    .click();
  const batch = page.getByRole("article", {
    name: "Tanda Horneada del turno",
    exact: true,
  });
  await batch
    .getByRole("button", { name: "Iniciar tanda", exact: true })
    .click();
  await batch
    .getByLabel("Cantidad preparada real", { exact: true })
    .fill("3.5");
  await batch
    .getByRole("button", { name: "Registrar producción", exact: true })
    .click();
  await expect(
    batch.getByText("Producción registrada: 3.5 × Pollo preparado", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/kipu-stage4-production-mobile.png",
    fullPage: true,
  });
  const available = await call<{ id: string; available: number }[]>(
    `/restaurant/menu?warehouseId=${warehouseId}`,
  );
  expect(available.find((entry) => entry.id === menu.id)?.available).toBe(14);
  const cash = await call<{ id: string }>("/cash-registers", "POST", {
    posTerminalId: branch.posTerminals[0].id,
    openingAmount: 100,
    idempotencyKey: randomUUID(),
  });
  await page.goto("/restaurant/pos");
  await page
    .getByRole("button", {
      name: "Agregar Pollo preparado · Cuarto",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Agregar Refresco de cocina", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar pedido", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cobrar y enviar a cocina", exact: true })
    .click();
  await expect(
    page.getByText("Pedido cobrado y enviado a cocina", { exact: true }),
  ).toBeVisible();
  const [order] =
    await call<{ id: string; status: string }[]>("/restaurant/orders");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/restaurant/kitchen");
  const card = page.getByRole("article", {
    name: `Pedido ${order.id.slice(-6)}`,
  });
  await card
    .getByRole("button", { name: "Iniciar Parrilla", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Listo Parrilla", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Entregar pedido", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Filtrar por estación", { exact: true })
    .selectOption("Bebidas");
  await expect(
    page
      .getByRole("region", { name: "En espera", exact: true })
      .getByRole("article", { name: `Pedido ${order.id.slice(-6)}` }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Iniciar preparación", exact: true })
    .click();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await card.getByRole("button", { name: "Imprimir", exact: true }).click();
  await expect(page.locator(".order-ticket")).toContainText(
    "Estación: Bebidas",
  );
  await expect(page.locator(".order-ticket")).toContainText(
    "Refresco de cocina",
  );
  await expect(page.locator(".order-ticket")).not.toContainText(
    "Pollo preparado",
  );
  await card.getByRole("button", { name: "Marcar listo", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Entregar pedido", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/kipu-stage4-kitchen-tablet.png",
    fullPage: true,
  });
  await card
    .getByRole("button", { name: "Entregar pedido", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  const stocks = await call<{ productId: string; quantity: string }[]>(
    `/inventory?warehouseId=${warehouseId}`,
  );
  expect(Number(stocks.find((s) => s.productId === raw.id)?.quantity)).toBe(6);
  expect(Number(stocks.find((s) => s.productId === cooked.id)?.quantity)).toBe(
    3.25,
  );
  await page.goto(`/cash/${cash.id}`);
  await page.getByPlaceholder("Efectivo contado").fill("130");
  const close = page.waitForResponse((response) =>
    response.url().endsWith(`/cash-registers/${cash.id}/close`),
  );
  await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
  expect(
    Number(((await (await close).json()) as { difference: string }).difference),
  ).toBe(0);
});

test("salón: adicionales, división, traslado, unión, cobro mixto y propina con arqueo real", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { call, branch } = await register(page);
  const warehouseId = branch.warehouses[0].id;
  const product = await call<{ id: string }>("/products", "POST", {
    name: "Plato de salón",
    price: 25,
    cost: 10,
  });
  await call("/inventory/movements", "POST", {
    warehouseId,
    productId: product.id,
    type: "IN",
    quantity: 10,
    reason: "Piloto salón",
    idempotencyKey: randomUUID(),
  });
  await call("/restaurant/menu", "POST", {
    productId: product.id,
    name: "Plato de salón",
    category: "Platos",
    station: "Cocina",
    price: 25,
    active: true,
    components: [{ productId: product.id, quantity: 1 }],
    options: [],
  });
  const cash = await call<{ id: string }>("/cash-registers", "POST", {
    posTerminalId: branch.posTerminals[0].id,
    openingAmount: 100,
    idempotencyKey: randomUUID(),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/restaurant/dining");
  await page.getByText("Configurar mesas (encargado)", { exact: true }).click();
  for (const name of ["Mesa 1", "Mesa 2"]) {
    await page.getByLabel("Nombre de mesa", { exact: true }).fill(name);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/restaurant/dining/tables") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Guardar mesa", exact: true })
      .click();
    expect((await response).ok()).toBeTruthy();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  const tables = await call<{ id: string; name: string }[]>(
    "/restaurant/dining/tables",
  );
  const t1 = tables.find((t) => t.name === "Mesa 1")!,
    t2 = tables.find((t) => t.name === "Mesa 2")!;
  await page
    .getByRole("combobox", { name: "Mesa", exact: true })
    .selectOption(t1.id);
  const openedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/restaurant/dining/accounts") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Abrir cuenta de mesa", exact: true })
    .click();
  const account = (await (await openedResponse).json()) as { id: string };
  await expect(
    page.getByRole("heading", {
      name: "Mesa 1 · Cuenta principal",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Plato", exact: true })
    .selectOption({ label: "Plato de salón · Bs 25.00" });
  for (let i = 1; i <= 2; i++) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/accounts/${account.id}/orders`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Guardar comanda", exact: true })
      .click();
    expect((await response).ok()).toBeTruthy();
    await expect(
      page.getByRole("article", { name: `Comanda ${i}`, exact: true }),
    ).toBeVisible();
    const card = page.getByRole("article", {
      name: `Comanda ${i}`,
      exact: true,
    });
    await card
      .getByRole("button", { name: "Enviar a cocina", exact: true })
      .click();
    await expect(card.getByText(/En espera/)).toBeVisible();
  }
  let accounts = await call<
    {
      id: string;
      version: number;
      orders: { id: string; saleId: string; sale: { status: string } }[];
    }[]
  >("/restaurant/dining/accounts");
  expect(accounts[0].orders.every((o) => o.sale.status === "CONFIRMED")).toBe(
    true,
  );
  await page
    .getByRole("article", { name: "Comanda 2", exact: true })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("button", { name: "Dividir cuenta", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Mesa 1 · Cuenta separada",
      exact: true,
    }),
  ).toBeVisible();
  const selected = await page
    .getByRole("combobox", { name: "Cuenta seleccionada", exact: true })
    .inputValue();
  await page
    .getByRole("combobox", { name: "Trasladar a mesa", exact: true })
    .selectOption(t2.id);
  await page
    .getByRole("button", { name: "Trasladar cuenta", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Mesa 2 · Cuenta separada",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Cuenta seleccionada", exact: true })
    .selectOption(account.id);
  await page
    .getByRole("combobox", { name: "Unir otra cuenta a esta", exact: true })
    .selectOption(selected);
  await page.getByRole("button", { name: "Unir cuentas", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Comanda 2", exact: true }),
  ).toBeVisible();
  // Kitchen really receives unpaid table orders and allows service before collection.
  await page.goto("/restaurant/kitchen");
  const cards = page
    .getByRole("article")
    .filter({ hasText: "Mesa 1 · Cuenta principal" });
  await expect(cards).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const cardLabel = await cards.first().getAttribute("aria-label");
    const card = page.getByRole("article", {name: cardLabel!, exact: true});
    await expect(card.getByText(/Cuenta abierta/)).toBeVisible();
    await card
      .getByRole("button", { name: "Iniciar preparación", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Marcar listo", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Entregar pedido", exact: true })
      .click();
    await expect(cards).toHaveCount(1 - i);
  }
  await page.goto("/restaurant/dining");
  await page
    .getByRole("combobox", { name: "Cuenta seleccionada", exact: true })
    .selectOption(account.id);
  accounts = await call("/restaurant/dining/accounts");
  const orders = accounts.find((a) => a.id === account.id)!.orders;
  for (const [i, o] of orders.entries()) {
    await page
      .getByRole("combobox", { name: "Comanda a cobrar", exact: true })
      .selectOption(o.id);
    if (i === 0) {
      await page.getByLabel("Importe del pago", { exact: true }).fill("10");
      await page
        .getByRole("combobox", { name: "Método de pago", exact: true })
        .selectOption("QR");
      await page
        .getByRole("button", { name: "Registrar pago", exact: true })
        .click();
      await expect(
        page.getByText("Saldo pendiente: Bs 40.00", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Importe del pago", { exact: true }).fill("15");
    }
    await page
      .getByRole("combobox", { name: "Método de pago", exact: true })
      .selectOption("CASH");
    await page
      .getByRole("button", { name: "Registrar pago", exact: true })
      .click();
    await expect(
      page.getByText(`Saldo pendiente: Bs ${i === 0 ? "25.00" : "0.00"}`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.getByLabel("Propina voluntaria (Bs)", { exact: true }).fill("5");
  await page.screenshot({
    path: "/tmp/kipu-stage5-dining-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const closeResponse = page.waitForResponse((r) =>
    r.url().endsWith(`/accounts/${account.id}/close`),
  );
  await page
    .getByRole("button", { name: "Cerrar cuenta", exact: true })
    .click();
  expect((await closeResponse).ok()).toBeTruthy();
  await expect(
    page.getByRole("heading", {
      name: "Mesa 1 · Cuenta principal",
      exact: true,
    }),
  ).toHaveCount(0);
  const stocks = await call<{ productId: string; quantity: string }[]>(
    `/inventory?warehouseId=${warehouseId}`,
  );
  expect(Number(stocks.find((s) => s.productId === product.id)!.quantity)).toBe(
    8,
  );
  await page.goto(`/cash/${cash.id}`);
  await page.getByPlaceholder("Efectivo contado").fill("145");
  const cashResponse = page.waitForResponse((r) =>
    r.url().endsWith(`/cash-registers/${cash.id}/close`),
  );
  await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
  expect(
    Number(
      ((await (await cashResponse).json()) as { difference: string })
        .difference,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});
