import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "user-test",
  name: "Cajero de prueba",
  email: "cajero@example.test",
};
const organization = { id: "org-test", name: "Pollería de prueba" };

async function signInLocally(page: Page) {
  await page.goto("/login");
  await page.evaluate(
    ({ user, organization }) => {
      localStorage.setItem("kipu_token", "test-access");
      localStorage.setItem("kipu_refresh_token", "test-refresh");
      localStorage.setItem("kipu_user", JSON.stringify(user));
      localStorage.setItem("kipu_organization", JSON.stringify(organization));
    },
    { user, organization },
  );
}

// These fixtures test frontend behavior; they do not validate backend/RLS.
test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:4200/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/notifications/unread-count") data = { count: 0 };
    if (path.startsWith("/reports/"))
      data = { rows: [], totalRows: 0, summary: {} };
    if (path === "/notifications")
      data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: data });
  });
});

test("corrupted browser session returns to login without a rendering error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInLocally(page);
  await page.evaluate(() => localStorage.setItem("kipu_user", "{invalid"));
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("form")).toBeVisible();
  expect(errors).toEqual([]);
});

test("customer creation refreshes the list after an initial API failure", async ({
  page,
}) => {
  let created = false;
  await page.route("http://localhost:4200/customers", async (route) => {
    if (route.request().method() === "POST") {
      created = true;
      await route.fulfill({ json: { id: "customer-test" } });
    } else if (!created) {
      await route.fulfill({
        status: 503,
        json: { message: "Servicio temporalmente no disponible" },
      });
    } else {
      await route.fulfill({
        json: [
          {
            id: "customer-test",
            name: "Cliente piloto",
            documentNumber: "123",
          },
        ],
      });
    }
  });
  await signInLocally(page);
  await page.goto("/customers");
  await expect(
    page.getByText("Servicio temporalmente no disponible"),
  ).toBeVisible();
  await page.getByPlaceholder("Nombre", { exact: true }).fill("Cliente piloto");
  await page.getByRole("button", { name: "Agregar cliente" }).click();
  await expect(
    page.getByRole("cell", { name: "Cliente piloto" }),
  ).toBeVisible();
  await expect(
    page.getByText("Servicio temporalmente no disponible"),
  ).toHaveCount(0);
});

for (const [path, title] of [
  ["/cash", "Caja y Bancos"],
  ["/inventory/movements", "Inventario"],
  ["/notifications", "Notificaciones"],
] as const) {
  test(`loads ${path} without render failures`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signInLocally(page);
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: false }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("switching reports clears filters before fetching the new report", async ({
  page,
}) => {
  const requests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/reports/"))
      requests.push(new URL(request.url()));
  });
  await signInLocally(page);
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Reportes", exact: true }),
  ).toBeVisible();
  await page.locator('input[type="date"]').first().fill("2026-11-01");
  await page
    .getByRole("button", { name: "Reporte de compras", exact: true })
    .click();
  await expect(page.locator('input[type="date"]').first()).toHaveValue("");
  await expect
    .poll(() => requests.some((url) => url.pathname === "/reports/purchases"))
    .toBe(true);
  const purchaseRequest = requests.find(
    (url) => url.pathname === "/reports/purchases",
  )!;
  expect(purchaseRequest.searchParams.has("dateFrom")).toBe(false);
});

test("logging out in one tab updates another tab", async ({
  page,
  context,
}) => {
  await signInLocally(page);
  await page.goto("/customers");
  const second = await context.newPage();
  await second.route("http://localhost:4200/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await second.goto("/customers");
  await expect(
    second.getByRole("heading", { name: "Clientes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(second).toHaveURL(/\/login$/);
  await expect(page).toHaveURL(/\/login$/);
});

test("a slow sales filter cannot replace the latest result", async ({
  page,
}) => {
  let releaseOld: () => void = () => {};
  let oldRequestStarted: () => void = () => {};
  const oldRequest = new Promise<void>((resolve) => {
    oldRequestStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  await page.route("http://localhost:4200/sales**", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    if (status === "DRAFT") {
      oldRequestStarted();
      await release;
    }
    await route.fulfill({
      json: status
        ? [
            {
              id: status,
              status,
              total: "20.00",
              createdAt: "2026-11-04T12:00:00Z",
              customer: {
                id: status,
                name:
                  status === "PAID" ? "Resultado actual" : "Resultado antiguo",
              },
            },
          ]
        : [],
    });
  });
  await signInLocally(page);
  await page.goto("/sales");
  await page.getByRole("combobox").selectOption("DRAFT");
  await oldRequest;
  await page.getByRole("combobox").selectOption("PAID");
  await expect(
    page.getByRole("cell", { name: "Resultado actual" }),
  ).toBeVisible();
  const olderResponse = page.waitForResponse((response) =>
    response.url().includes("status=DRAFT"),
  );
  releaseOld();
  await olderResponse;
  await expect(
    page.getByRole("cell", { name: "Resultado antiguo" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Resultado actual" }),
  ).toBeVisible();
});
