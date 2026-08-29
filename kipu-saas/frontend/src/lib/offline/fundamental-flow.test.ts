import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { resetAutoSyncGuard, triggerSync } from "./auto-sync";
import { runFullInitialSync } from "./catalog-sync";
import { getSaleSyncState } from "./sale-sync-state";
import { submitSaleOffline } from "./pos-submit";
import { uniqueOrgId } from "./test-support/unique";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * PRUEBA FUNDAMENTAL (Fase Offline 3, pedida explícitamente): demuestra de
 * punta a punta que una venta creada sin conexión, con la aplicación
 * "cerrada y reabierta" en el medio, se sincroniza exactamente UNA vez al
 * volver la conexión — nunca se duplica.
 *
 *   ONLINE → descargar productos → OFFLINE → crear venta → guardar
 *   localmente → cerrar/reiniciar la app (simulado) → la venta sigue
 *   presente → ONLINE → Sync Engine → API → venta creada una sola vez →
 *   operación marcada SYNCED
 */
describe("PRUEBA FUNDAMENTAL — venta offline sobrevive un reinicio y sincroniza una sola vez", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAutoSyncGuard();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("demuestra el flujo completo sin duplicar la venta", async () => {
    const org = uniqueOrgId();

    // 1) ONLINE — descargar productos (full initial sync, reutilizando
    //    GET /products/GET /customers/GET /branches tal cual).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/products")) {
          return Promise.resolve(
            jsonResponse(200, [
              {
                id: "prod-1",
                organizationId: org,
                name: "Coca Cola 2L",
                sku: "COCA",
                barcode: null,
                price: "15.00",
                active: true,
                updatedAt: new Date().toISOString(),
              },
            ]),
          );
        }
        if (url.endsWith("/branches")) {
          return Promise.resolve(
            jsonResponse(200, [
              { id: "branch-1", warehouses: [{ id: "wh-1" }], posTerminals: [{ id: "pos-1" }] },
            ]),
          );
        }
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    const db1 = getLocalDb(org);
    await runFullInitialSync(db1, {
      organizationId: org,
      organizationName: "Mi Negocio",
      userId: "user-1",
      userName: "Dueño",
      roleKey: "OWNER",
    });
    const cachedProduct = await db1.products.get("prod-1");
    expect(cachedProduct?.name).toBe("Coca Cola 2L");

    // 2) OFFLINE — crear una venta. `submitSaleOffline` intenta
    //    sincronizar de inmediato, pero sin red el intento falla y la
    //    venta queda en cola — nunca se pierde, nunca se muestra como error.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));
    const submission = await submitSaleOffline(db1, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      discount: 0,
      items: [{ productId: "prod-1", quantity: 2, unitPrice: 15, discount: 0 }],
      payments: [{ method: "CASH", amount: 30, idempotencyKey: "pago-fundamental-1" }],
    });
    expect(submission.outcome).toBe("offline-pending");
    const localSaleId = submission.localSaleId;

    // 3) Cerrar/reabrir la app (simulado): se descarta toda referencia en
    //    memoria y se pide una instancia NUEVA de la base — la única forma
    //    en que este test podría "ver" datos es si de verdad persistieron
    //    en IndexedDB, no en una variable JS que sobrevivió por casualidad.
    resetLocalDbCache();
    const db2 = getLocalDb(org);

    const stillThere = await db2.sales.get(localSaleId);
    expect(stillThere).toBeDefined();
    expect(stillThere?.status).toBe("DRAFT_LOCAL"); // todavía no confirmada del lado del servidor

    const stateAfterReopen = await getSaleSyncState(db2, localSaleId);
    expect(stateAfterReopen.kind).toBe("offline-pending"); // sigue en cola, no se perdió ni se marcó como error

    // 4) Vuelve la conexión — el Sync Engine procesa la cola contra la API
    //    real (mock). El backend real (Fase Offline 1) es quien garantiza
    //    que `POST /sales` con idempotencyKey nunca duplica — acá se
    //    verifica que el CLIENTE nunca reenvía la creación más de una vez
    //    ni pierde el resultado.
    let salesCreateCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) {
          salesCreateCalls += 1;
          return Promise.resolve(jsonResponse(201, { id: "server-sale-fundamental" }));
        }
        if (url.includes("/sales/server-sale-fundamental/confirm")) {
          return Promise.resolve(
            jsonResponse(201, {
              id: "server-sale-fundamental",
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

    // `force: true` — misma señal que dispara `useAutoSync` ante el evento
    // `online` real del navegador: ignora el backoff que quedó calculado
    // mientras se creía que seguía sin conexión.
    const summary = await triggerSync(db2, org, { force: true });
    expect(summary?.synced).toBe(2); // sales.create + sales.confirm
    expect(salesCreateCalls).toBe(1); // la venta se creó UNA sola vez, nunca duplicada

    // 5) Estado final: SYNCED, con el resumen real del servidor.
    const finalState = await getSaleSyncState(db2, localSaleId);
    expect(finalState).toEqual({
      kind: "synced",
      summary: { status: "PAID", total: "30.00", paidTotal: "30.00", balance: "0.00" },
    });

    const finalSale = await db2.sales.get(localSaleId);
    expect(finalSale?.serverId).toBe("server-sale-fundamental");
    expect(finalSale?.status).toBe("CONFIRM_SYNCED");

    // Un segundo pase de sincronización (ej. el disparo periódico de
    // respaldo) no vuelve a mandar nada — ya no queda nada pendiente.
    const secondPass = await triggerSync(db2, org);
    expect(secondPass?.processed).toBe(0);
    expect(salesCreateCalls).toBe(1); // sigue siendo 1: nunca una segunda venta
  });
});
