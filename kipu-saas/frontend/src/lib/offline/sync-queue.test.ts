import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import {
  claimNext,
  countPending,
  enqueue,
  listByStatus,
  markConflict,
  markFailedTransient,
  markSynced,
  resetBackoff,
  retryManually,
} from "./sync-queue";
import { uniqueOrgId } from "./test-support/unique";

function baseOp(
  organizationId: string,
  overrides: Partial<Parameters<typeof enqueue>[1]> = {},
) {
  return {
    organizationId,
    operation: "sales.create" as const,
    entity: "Sale" as const,
    entityId: "local-sale-1",
    idempotencyKey: "idem-1",
    path: "/sales",
    payload: { foo: "bar" },
    ...overrides,
  };
}

describe("Sync queue — crear y persistir", () => {
  beforeEach(() => resetLocalDbCache());

  it("crear una operación la deja PENDING con contadores en cero", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    expect(item.status).toBe("PENDING");
    expect(item.attempts).toBe(0);
    expect(item.lockedBy).toBeNull();
  });

  it("persiste entre 'reinicios' del cliente (misma base, nueva referencia)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));

    // Simula cerrar la app y volver a abrirla: se pide una instancia nueva
    // del wrapper, pero la base IndexedDB subyacente (fake-indexeddb en el
    // test, IndexedDB real en el navegador) sigue teniendo los datos.
    resetLocalDbCache();
    const reopened = getLocalDb(org);
    const found = await reopened.syncQueue.get(item.id);
    expect(found?.id).toBe(item.id);
    expect(found?.status).toBe("PENDING");
  });

  it("countPending cuenta PENDING + SYNCING + FAILED, nunca SYNCED/CONFLICT", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const a = await enqueue(db, baseOp(org, { idempotencyKey: "a" }));
    await enqueue(db, baseOp(org, { idempotencyKey: "b" }));
    const c = await enqueue(db, baseOp(org, { idempotencyKey: "c" }));

    await markSynced(db, a.id, "server-1");
    await markConflict(db, c.id, "conflicto de prueba");

    expect(await countPending(db)).toBe(1); // solo "b" sigue PENDING
  });
});

describe("Sync queue — transiciones de estado", () => {
  beforeEach(() => resetLocalDbCache());

  it("claimNext marca SYNCING y toma el lock", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await enqueue(db, baseOp(org));
    const claimed = await claimNext(db, "engine-1");
    expect(claimed?.status).toBe("SYNCING");
    expect(claimed?.lockedBy).toBe("engine-1");
  });

  it("markSynced deja SYNCED, limpia el lock y guarda el serverId resultante", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markSynced(db, item.id, "server-abc");
    const found = await db.syncQueue.get(item.id);
    expect(found?.status).toBe("SYNCED");
    expect(found?.resultServerId).toBe("server-abc");
    expect(found?.lockedBy).toBeNull();
  });

  it("markFailedTransient incrementa intentos y programa nextRetryAt con backoff creciente", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markFailedTransient(db, item.id, "timeout de red");

    const first = await db.syncQueue.get(item.id);
    expect(first?.status).toBe("FAILED");
    expect(first?.attempts).toBe(1);
    expect(first?.error).toBe("timeout de red");
    const firstDelay = new Date(first!.nextRetryAt!).getTime() - Date.now();

    // Fuerza que la fila vuelva a ser candidata (nextRetryAt en el pasado)
    // para poder reclamarla y fallar una segunda vez sin esperar de verdad.
    await db.syncQueue.update(item.id, { nextRetryAt: new Date(0).toISOString() });
    await claimNext(db, "engine-1");
    await markFailedTransient(db, item.id, "timeout de red otra vez");
    const second = await db.syncQueue.get(item.id);
    expect(second?.attempts).toBe(2);
    const secondDelay = new Date(second!.nextRetryAt!).getTime() - Date.now();

    expect(secondDelay).toBeGreaterThan(firstDelay); // backoff creciente, no reintentos agresivos a tasa fija
  });

  it("una operación FAILED con nextRetryAt en el futuro NO es elegible todavía", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markFailedTransient(db, item.id, "timeout");

    // markFailedTransient ya deja nextRetryAt en el futuro (backoff) — no
    // debe poder reclamarse de nuevo inmediatamente.
    expect(await claimNext(db, "engine-1")).toBeNull();
  });

  it("markConflict deja CONFLICT y NUNCA queda elegible para reintento automático", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markConflict(db, item.id, "idempotencyKey ya usada con datos distintos");

    const found = await db.syncQueue.get(item.id);
    expect(found?.status).toBe("CONFLICT");
    expect(found?.nextRetryAt).toBeNull();

    // No aparece como candidata para un nuevo claim.
    const next = await claimNext(db, "engine-2");
    expect(next).toBeNull();
  });

  it("resetBackoff deja elegibles de inmediato las FAILED con reintentos disponibles (ej. al reconectar)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markFailedTransient(db, item.id, "sin red");

    // Con el backoff todavía vigente, no es candidata.
    expect(await claimNext(db, "engine-1")).toBeNull();

    await resetBackoff(db);
    const claimed = await claimNext(db, "engine-1");
    expect(claimed?.id).toBe(item.id);
  });

  it("resetBackoff nunca toca CONFLICT (esas nunca son automáticas)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markConflict(db, item.id, "revisar a mano");

    await resetBackoff(db);
    expect(await claimNext(db, "engine-1")).toBeNull();
  });

  it("retryManually recupera una CONFLICT/FAILED para un nuevo intento explícito", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-1");
    await markConflict(db, item.id, "revisar a mano");

    await retryManually(db, item.id);
    const found = await db.syncQueue.get(item.id);
    expect(found?.status).toBe("PENDING");

    const claimed = await claimNext(db, "engine-1");
    expect(claimed?.id).toBe(item.id);
  });

  it("retryManually rechaza una operación que no está FAILED/CONFLICT", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await expect(retryManually(db, item.id)).rejects.toThrow();
  });
});

describe("Sync queue — orden por dependencias", () => {
  beforeEach(() => resetLocalDbCache());

  it("una operación con dependsOn no elegible hasta que la dependencia esté SYNCED", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const create = await enqueue(db, baseOp(org, { operation: "sales.create", idempotencyKey: "create-1" }));
    const confirm = await enqueue(
      db,
      baseOp(org, {
        operation: "sales.confirm",
        idempotencyKey: "confirm-1",
        dependsOn: [create.id],
      }),
    );

    // claimNext debe devolver "create" primero, nunca "confirm" todavía.
    const firstClaim = await claimNext(db, "engine-1");
    expect(firstClaim?.id).toBe(create.id);

    // Mientras "create" sigue SYNCING (no SYNCED), "confirm" no es elegible.
    const shouldBeNull = await claimNext(db, "engine-1");
    expect(shouldBeNull).toBeNull();

    await markSynced(db, create.id, "server-1");

    const secondClaim = await claimNext(db, "engine-1");
    expect(secondClaim?.id).toBe(confirm.id);
  });

  it("nunca procesa en paralelo dos operaciones con dependencia entre sí", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const create = await enqueue(db, baseOp(org, { operation: "sales.create", idempotencyKey: "create-2" }));
    await enqueue(
      db,
      baseOp(org, {
        operation: "sales.confirm",
        idempotencyKey: "confirm-2",
        dependsOn: [create.id],
      }),
    );

    // Dos "engines" reclamando a la vez: solo debe salir "create" (la
    // dependencia de "confirm" no está satisfecha), nunca ambas.
    const [a, b] = await Promise.all([claimNext(db, "engine-1"), claimNext(db, "engine-2")]);
    const claimedIds = [a?.id, b?.id].filter(Boolean);
    expect(claimedIds).toEqual([create.id]);
  });
});

describe("Sync queue — protección contra dos Sync Engines procesando lo mismo", () => {
  beforeEach(() => resetLocalDbCache());

  it("dos claimNext concurrentes sobre la MISMA cola nunca reclaman la misma fila", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await enqueue(db, baseOp(org, { idempotencyKey: "solo-una" }));

    const [a, b] = await Promise.all([claimNext(db, "engine-1"), claimNext(db, "engine-2")]);
    // Solo una de las dos "gana" la única fila disponible; la otra ve null.
    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
  });

  it("un lock abandonado (app cerrada a mitad de proceso) se puede reclamar de nuevo pasado el umbral", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const item = await enqueue(db, baseOp(org));
    await claimNext(db, "engine-muerto");

    // El lock sigue "fresco": nadie más puede reclamar todavía.
    expect(await claimNext(db, "engine-vivo")).toBeNull();

    // Simula que el lock quedó abandonado hace rato (el proceso que lo
    // tomó murió sin liberar nada) escribiendo directamente un `lockedAt`
    // viejo — evita mezclar temporizadores falsos con IndexedDB real, que
    // internamente depende de sus propios timers/microtasks.
    await db.syncQueue.update(item.id, {
      lockedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    const reclaimed = await claimNext(db, "engine-vivo");
    expect(reclaimed?.id).toBe(item.id);
    expect(reclaimed?.lockedBy).toBe("engine-vivo");
  });
});

describe("Sync queue — aislamiento entre organizaciones", () => {
  beforeEach(() => resetLocalDbCache());

  it("la cola de una organización nunca es visible desde otra", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const dbA = getLocalDb(orgA);
    const dbB = getLocalDb(orgB);
    await enqueue(dbA, baseOp(orgA, { idempotencyKey: "solo-a" }));

    const pendingInB = await listByStatus(dbB, "PENDING");
    expect(pendingInB).toHaveLength(0);

    const pendingInA = await listByStatus(dbA, "PENDING");
    expect(pendingInA).toHaveLength(1);
  });
});
