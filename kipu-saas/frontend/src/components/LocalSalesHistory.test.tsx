import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LocalSalesHistory from "./LocalSalesHistory";
import { getLocalDb, resetLocalDbCache } from "@/lib/offline/db";
import { resetAutoSyncGuard, triggerSync } from "@/lib/offline/auto-sync";
import { listLocalSalesWithState, type LocalSaleWithState } from "@/lib/offline/sale-sync-state";
import { submitSaleOffline } from "@/lib/offline/pos-submit";
import { uniqueOrgId } from "@/lib/offline/test-support/unique";

/**
 * Offline 4.15 / UI-5 — historial de ventas del dispositivo.
 *
 * La prueba que importa de verdad (y que el pedido de esta fase señala
 * explícitamente) es la última: una venta hecha SIN conexión aparece en el
 * historial con su total y su método de pago reales, y cuando vuelve
 * Internet y sincroniza, su estado cambia solo — sin que la pantalla
 * recalcule nada por su cuenta ni pierda la venta en el camino.
 */

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const noop = () => {};

function renderHistory(sales: LocalSaleWithState[], overrides: Partial<React.ComponentProps<typeof LocalSalesHistory>> = {}) {
  return render(
    <LocalSalesHistory
      sales={sales}
      onRefresh={noop}
      onTicket={noop}
      onRetry={noop}
      {...overrides}
    />,
  );
}

/** Venta local mínima ya en el estado que se quiere dibujar — sin pasar por Dexie, para los casos puramente visuales. */
function fakeSale(overrides: Partial<LocalSaleWithState["sale"]> = {}): LocalSaleWithState["sale"] {
  return {
    id: "local-1",
    organizationId: "org-1",
    serverId: null,
    status: "DRAFT_LOCAL",
    posTerminalId: "pos-1",
    warehouseId: "wh-1",
    customerId: null,
    discount: "0",
    items: [{ productId: "p1", quantity: "2", unitPrice: "15.00", discount: "0" }],
    payments: [{ method: "CASH", amount: "30.00", idempotencyKey: "k1" }],
    createSyncOperationId: "op-1",
    confirmSyncOperationId: null,
    createdAt: "2026-09-04T14:30:00.000Z",
    serverSummary: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetLocalDbCache();
  resetAutoSyncGuard();
  localStorage.clear();
  localStorage.setItem("kipu_token", "access-vigente");
  localStorage.setItem("kipu_refresh_token", "refresh-vigente");
});
afterEach(() => vi.unstubAllGlobals());

describe("LocalSalesHistory (UI-5)", () => {
  it("muestra fecha/hora, total y método de pago reales de la venta", async () => {
    const user = userEvent.setup();
    const { container } = renderHistory([{ sale: fakeSale(), state: { kind: "offline-pending" } }]);

    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    // La fecha se muestra en el formato del dispositivo (cambia según el
    // idioma del navegador), así que lo que se fija es el dato real que la
    // respalda, no el texto ya localizado.
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-09-04T14:30:00.000Z");
    expect(screen.getByText("· 1 ítem")).toBeInTheDocument(); // una línea de venta, no una unidad
    expect(screen.getByText("Bs. 30.00")).toBeInTheDocument();
    expect(screen.getByText("Efectivo Bs. 30.00")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
  });

  it("una venta a crédito (sin pagos) lo dice, no inventa un método de pago", async () => {
    const user = userEvent.setup();
    renderHistory([{ sale: fakeSale({ payments: [] }), state: { kind: "offline-pending" } }]);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    expect(screen.getByText("Sin pago registrado (venta a crédito)")).toBeInTheDocument();
  });

  it("una venta ya sincronizada muestra el total del SERVIDOR, no el cálculo local", async () => {
    const user = userEvent.setup();
    const summary = { status: "PAID", total: "28.00", paidTotal: "28.00", balance: "0.00" };
    renderHistory([
      {
        sale: fakeSale({ status: "CONFIRM_SYNCED", serverSummary: summary }),
        state: { kind: "synced", summary },
      },
    ]);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    expect(screen.getByText("Bs. 28.00")).toBeInTheDocument();
    expect(screen.queryByText("Bs. 30.00")).not.toBeInTheDocument();
    expect(screen.getByText("Sincronizada")).toBeInTheDocument();
  });

  it("una venta con error se ve sin desplegar el panel, con su mensaje real y su botón de reintento", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    // No hace falta abrir nada: algo que necesita atención humana no puede
    // quedar escondido detrás de un panel plegado.
    renderHistory(
      [{ sale: fakeSale(), state: { kind: "error", message: "Stock insuficiente para Coca Cola 2L" } }],
      { onRetry },
    );

    expect(screen.getByText("Stock insuficiente para Coca Cola 2L")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalledWith("local-1");
  });

  it("una venta sincronizada NO ofrece reintentar (no hay nada que reintentar)", async () => {
    const user = userEvent.setup();
    const summary = { status: "PAID", total: "30.00", paidTotal: "30.00", balance: "0.00" };
    renderHistory([
      { sale: fakeSale({ status: "CONFIRM_SYNCED", serverSummary: summary }), state: { kind: "synced", summary } },
    ]);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    expect(screen.queryByRole("button", { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it("el ticket sigue disponible aunque la venta todavía no haya sincronizado", async () => {
    const user = userEvent.setup();
    const onTicket = vi.fn();
    renderHistory([{ sale: fakeSale(), state: { kind: "offline-pending" } }], { onTicket });

    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));
    await user.click(screen.getByRole("button", { name: /Ver ticket/ }));
    expect(onTicket).toHaveBeenCalledWith("local-1");
  });

  it("'Actualizar estado' vuelve a pedir el estado de sincronización", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderHistory([{ sale: fakeSale(), state: { kind: "offline-pending" } }], { onRefresh });

    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));
    await user.click(screen.getByRole("button", { name: /Actualizar estado/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("sin ventas todavía, lo dice en vez de mostrar una lista vacía", async () => {
    const user = userEvent.setup();
    renderHistory([]);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    expect(
      screen.getByText("Todavía no se registró ninguna venta desde este dispositivo"),
    ).toBeInTheDocument();
  });

  it("NO inventa las funciones de Stitch que KIPU no tiene (exportar, filtros, folio)", async () => {
    const user = userEvent.setup();
    renderHistory([{ sale: fakeSale(), state: { kind: "offline-pending" } }]);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); // ningún filtro
    expect(screen.queryByText(/#\d/)).not.toBeInTheDocument(); // ningún folio inventado
  });

  it("una venta creada SIN conexión aparece en el historial y pasa a 'Sincronizada' cuando vuelve Internet", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);

    // 1) Sin conexión: la venta se guarda local y queda en cola.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));
    const submission = await submitSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      discount: 0,
      items: [{ productId: "prod-1", quantity: 2, unitPrice: 15, discount: 0 }],
      payments: [{ method: "QR", amount: 30, idempotencyKey: "pago-historial-1" }],
    });
    expect(submission.outcome).toBe("offline-pending");

    const pending = await listLocalSalesWithState(db);
    const user = userEvent.setup();
    const { unmount } = renderHistory(pending);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    // Con el total y el método de pago reales de la venta guardada.
    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
    expect(screen.getByText("Bs. 30.00")).toBeInTheDocument();
    expect(screen.getByText("QR Bs. 30.00")).toBeInTheDocument();
    unmount();

    // 2) Vuelve Internet: el Sync Engine real procesa la cola.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-sale-1" }));
        if (url.includes("/sales/server-sale-1/confirm")) {
          return Promise.resolve(
            jsonResponse(201, {
              id: "server-sale-1",
              status: "PAID",
              total: "30.00",
              paidTotal: "30.00",
              balance: "0.00",
            }),
          );
        }
        throw new Error(`URL inesperada: ${url}`);
      }),
    );
    await triggerSync(db, org, { force: true });

    // 3) El historial vuelve a leer la MISMA fuente de verdad y ahora la
    //    misma venta (mismo id local, nunca duplicada) figura sincronizada.
    const afterSync = await listLocalSalesWithState(db);
    expect(afterSync).toHaveLength(1);
    expect(afterSync[0].sale.id).toBe(submission.localSaleId);

    renderHistory(afterSync);
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));

    expect(screen.getByText("Sincronizada")).toBeInTheDocument();
    expect(screen.queryByText("Pendiente de sincronizar")).not.toBeInTheDocument();
    expect(screen.getByText("Bs. 30.00")).toBeInTheDocument();
    // El ticket sigue accesible después de sincronizar.
    expect(screen.getByRole("button", { name: /Ver ticket/ })).toBeInTheDocument();
  });
});
