import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "../db";
import { uniqueOrgId } from "../test-support/unique";
import { FakePrinterTransport } from "./fake-printer-transport";
import { PrinterManager, type SavePrinterInput } from "./printer-manager";
import { PrinterError, type DiscoveredPrinter, type PrinterCapability } from "./types";

const FULL_CAPABILITIES: PrinterCapability[] = ["text", "bold", "alignment", "textSize", "cut"];

function fakePrinterInput(overrides: Partial<SavePrinterInput> = {}): SavePrinterInput {
  return {
    name: "Impresora de prueba",
    transportKind: "bluetooth",
    transportConfig: { address: "00:11:22:33:44:55" },
    capabilities: FULL_CAPABILITIES,
    ...overrides,
  };
}

/** `PrinterManager` con una fábrica que siempre devuelve el MISMO `FakePrinterTransport` — permite a los tests inspeccionar los bytes recibidos/simular fallos después de `connect()`. */
function buildManagerWithFakeTransport(organizationId: string) {
  const db = getLocalDb(organizationId);
  const transport = new FakePrinterTransport("bluetooth");
  const manager = new PrinterManager({
    db,
    organizationId,
    transportFactories: { bluetooth: () => transport },
  });
  return { db, manager, transport };
}

describe("PrinterManager — descubrimiento (nunca toca hardware en V1)", () => {
  beforeEach(() => resetLocalDbCache());

  // 1
  it("discover() sin ningún discoverer registrado devuelve [] — nunca lanza, nunca toca hardware", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const found = await manager.discover("bluetooth");
    expect(found).toEqual([]);
  });

  it("discover() con un discoverer FALSO inyectado devuelve lo que ese discoverer produce", async () => {
    const org = uniqueOrgId();
    const fakeFound: DiscoveredPrinter[] = [
      { name: "Impresora Falsa 1", transportKind: "bluetooth", transportConfig: {}, capabilities: ["text"] },
    ];
    const manager = new PrinterManager({
      db: getLocalDb(org),
      organizationId: org,
      discoverers: { bluetooth: async () => fakeFound },
    });
    const found = await manager.discover("bluetooth");
    expect(found).toEqual(fakeFound);
  });
});

describe("PrinterManager — persistencia (guardar/recuperar/predeterminada/olvidar)", () => {
  beforeEach(() => resetLocalDbCache());

  // 2
  it("guardar un dispositivo lo persiste con un id propio", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const saved = await manager.save(fakePrinterInput());
    expect(saved.id).toBeTruthy();
    expect(saved.organizationId).toBe(org);
    expect(saved.isDefault).toBe(false);
  });

  // 3
  it("recuperar un dispositivo guardado por id", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const saved = await manager.save(fakePrinterInput({ name: "Caja 1" }));
    const found = await manager.getDevice(saved.id);
    expect(found.name).toBe("Caja 1");
  });

  it("listKnownDevices() devuelve todos los dispositivos guardados de la organización", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    await manager.save(fakePrinterInput({ name: "Impresora A" }));
    await manager.save(fakePrinterInput({ name: "Impresora B" }));
    const all = await manager.listKnownDevices();
    expect(all.map((d) => d.name).sort()).toEqual(["Impresora A", "Impresora B"]);
  });

  // 12 — dispositivo inexistente
  it("getDevice() con un id inexistente lanza PrinterError('printer-not-found')", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    await expect(manager.getDevice("no-existe")).rejects.toMatchObject({
      code: "printer-not-found",
    });
  });

  // 6, 7 — obtener/cambiar predeterminada
  it("getDefault() sin ninguna predeterminada configurada devuelve null", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    await manager.save(fakePrinterInput());
    expect(await manager.getDefault()).toBeNull();
  });

  it("setDefault() marca la impresora como predeterminada; getDefault() la devuelve", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const saved = await manager.save(fakePrinterInput());
    await manager.setDefault(saved.id);
    const def = await manager.getDefault();
    expect(def?.id).toBe(saved.id);
    expect(def?.isDefault).toBe(true);
  });

  it("cambiar la predeterminada: a lo sumo UNA impresora queda isDefault=true por organización, nunca dos", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const first = await manager.save(fakePrinterInput({ name: "Primera" }));
    const second = await manager.save(fakePrinterInput({ name: "Segunda" }));
    await manager.setDefault(first.id);
    await manager.setDefault(second.id);

    const all = await manager.listKnownDevices();
    const defaults = all.filter((d) => d.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.id);
  });

  it("save() con isDefault:true la deja predeterminada de una", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const saved = await manager.save(fakePrinterInput({ isDefault: true }));
    const def = await manager.getDefault();
    expect(def?.id).toBe(saved.id);
  });

  it("olvidar (forget) una impresora la elimina del registro local", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const saved = await manager.save(fakePrinterInput());
    await manager.forget(saved.id);
    await expect(manager.getDevice(saved.id)).rejects.toMatchObject({ code: "printer-not-found" });
  });
});

describe("PrinterManager — conectar/desconectar/estado", () => {
  beforeEach(() => resetLocalDbCache());

  // 4
  it("connect() usa la fábrica registrada para el transportKind del dispositivo y actualiza el estado", async () => {
    const org = uniqueOrgId();
    const { manager } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    expect(manager.getStatus(saved.id)).toBe("disconnected");

    await manager.connect(saved.id);
    expect(manager.getStatus(saved.id)).toBe("connected");
  });

  it("connect() sin fábrica registrada para ese transportKind falla con 'connection-failed', sin tocar hardware", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org }); // sin transportFactories
    const saved = await manager.save(fakePrinterInput());
    await expect(manager.connect(saved.id)).rejects.toMatchObject({ code: "connection-failed" });
  });

  // 10 — error de conexión
  it("error de conexión del transporte se propaga como PrinterError('connection-failed')", async () => {
    const org = uniqueOrgId();
    const { manager, transport } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    transport.simulateConnectFailure();

    await expect(manager.connect(saved.id)).rejects.toMatchObject({ code: "connection-failed" });
    expect(manager.getStatus(saved.id)).toBe("disconnected"); // nunca queda registrada como conectada tras un fallo
  });

  it("connect() exitoso actualiza lastConnectedAt en la persistencia", async () => {
    const org = uniqueOrgId();
    const { manager } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    expect(saved.lastConnectedAt).toBeNull();

    await manager.connect(saved.id);
    const reloaded = await manager.getDevice(saved.id);
    expect(reloaded.lastConnectedAt).not.toBeNull();
  });

  // 5
  it("disconnect() deja el estado como disconnected", async () => {
    const org = uniqueOrgId();
    const { manager } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    await manager.connect(saved.id);
    await manager.disconnect(saved.id);
    expect(manager.getStatus(saved.id)).toBe("disconnected");
  });

  it("disconnect() de algo que nunca se conectó no lanza (no-op seguro)", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    const saved = await manager.save(fakePrinterInput());
    await expect(manager.disconnect(saved.id)).resolves.toBeUndefined();
  });
});

describe("PrinterManager — imprimir (printTicket / testPrint)", () => {
  beforeEach(() => resetLocalDbCache());

  // 8
  it("printTicket() codifica el ticket y lo manda al transporte conectado — bytes reales verificables", async () => {
    const org = uniqueOrgId();
    const { manager, transport } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    await manager.connect(saved.id);

    await manager.printTicket({
      documentLabel: "RECIBO DE VENTA",
      documentType: "DOCUMENTO COMERCIAL NO FISCAL",
      business: { name: "Mi Negocio", legalName: null, nit: null, address: null, phone: null },
      branch: null,
      posTerminal: null,
      operation: { fullNumber: null, localId: "local-1", issuedAt: new Date().toISOString(), cashierName: null },
      customer: null,
      items: [{ productName: "Producto X", sku: null, quantity: "1", unitPrice: "10.00", discount: "0.00", subtotal: "10.00" }],
      totals: { subtotal: "10.00", discount: "0.00", total: "10.00" },
      payments: { methods: [], paidTotal: "0.00", balance: "10.00" },
      observations: null,
      syncStatus: "synced",
    }, saved.id);

    const received = transport.getLastReceivedBytes();
    expect(received).toBeDefined();
    expect(received![0]).toBe(0x1b); // ESC @ al principio — pasó de verdad por el encoder real
  });

  it("printTicket() sin deviceId usa la impresora PREDETERMINADA", async () => {
    const org = uniqueOrgId();
    const { manager, transport } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput({ isDefault: true }));
    await manager.connect(saved.id);

    await manager.printTicket({
      documentLabel: "R", documentType: "D",
      business: { name: "Negocio", legalName: null, nit: null, address: null, phone: null },
      branch: null, posTerminal: null,
      operation: { fullNumber: null, localId: "l1", issuedAt: new Date().toISOString(), cashierName: null },
      customer: null,
      items: [{ productName: "P", sku: null, quantity: "1", unitPrice: "1.00", discount: "0.00", subtotal: "1.00" }],
      totals: { subtotal: "1.00", discount: "0.00", total: "1.00" },
      payments: { methods: [], paidTotal: "0.00", balance: "1.00" },
      observations: null, syncStatus: "synced",
    });

    expect(transport.getReceivedBytes()).toHaveLength(1);
  });

  it("printTicket() sin deviceId y sin predeterminada configurada falla con 'printer-not-found'", async () => {
    const org = uniqueOrgId();
    const manager = new PrinterManager({ db: getLocalDb(org), organizationId: org });
    await expect(
      manager.printTicket({
        documentLabel: "R", documentType: "D",
        business: { name: "N", legalName: null, nit: null, address: null, phone: null },
        branch: null, posTerminal: null,
        operation: { fullNumber: null, localId: "l1", issuedAt: new Date().toISOString(), cashierName: null },
        customer: null,
        items: [{ productName: "P", sku: null, quantity: "1", unitPrice: "1.00", discount: "0.00", subtotal: "1.00" }],
        totals: { subtotal: "1.00", discount: "0.00", total: "1.00" },
        payments: { methods: [], paidTotal: "0.00", balance: "1.00" },
        observations: null, syncStatus: "synced",
      }),
    ).rejects.toMatchObject({ code: "printer-not-found" });
  });

  it("printTicket() sobre una impresora NO conectada falla con 'not-connected', sin intentar reconectar sola", async () => {
    const org = uniqueOrgId();
    const { manager } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    // Nunca se llama a connect().
    await expect(
      manager.printTicket({
        documentLabel: "R", documentType: "D",
        business: { name: "N", legalName: null, nit: null, address: null, phone: null },
        branch: null, posTerminal: null,
        operation: { fullNumber: null, localId: "l1", issuedAt: new Date().toISOString(), cashierName: null },
        customer: null,
        items: [{ productName: "P", sku: null, quantity: "1", unitPrice: "1.00", discount: "0.00", subtotal: "1.00" }],
        totals: { subtotal: "1.00", discount: "0.00", total: "1.00" },
        payments: { methods: [], paidTotal: "0.00", balance: "1.00" },
        observations: null, syncStatus: "synced",
      }, saved.id),
    ).rejects.toMatchObject({ code: "not-connected" });
  });

  // 11 — error de escritura
  it("error de escritura del transporte se propaga tal cual, SIN reintentar sola (idempotencia de impresión)", async () => {
    const org = uniqueOrgId();
    const { manager, transport } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    await manager.connect(saved.id);
    transport.simulateWriteFailure();

    await expect(
      manager.printTicket({
        documentLabel: "R", documentType: "D",
        business: { name: "N", legalName: null, nit: null, address: null, phone: null },
        branch: null, posTerminal: null,
        operation: { fullNumber: null, localId: "l1", issuedAt: new Date().toISOString(), cashierName: null },
        customer: null,
        items: [{ productName: "P", sku: null, quantity: "1", unitPrice: "1.00", discount: "0.00", subtotal: "1.00" }],
        totals: { subtotal: "1.00", discount: "0.00", total: "1.00" },
        payments: { methods: [], paidTotal: "0.00", balance: "1.00" },
        observations: null, syncStatus: "synced",
      }, saved.id),
    ).rejects.toMatchObject({ code: "write-failed" });

    // Nunca hubo un segundo intento automático — un solo write() total.
    expect(transport.getReceivedBytes()).toHaveLength(0);
  });

  // 13 — capacidades no soportadas
  it("printTicket() sobre una impresora sin la capability 'text' falla con 'unsupported-capability'", async () => {
    const org = uniqueOrgId();
    const { manager } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput({ capabilities: [] }));
    await manager.connect(saved.id);

    await expect(
      manager.printTicket({
        documentLabel: "R", documentType: "D",
        business: { name: "N", legalName: null, nit: null, address: null, phone: null },
        branch: null, posTerminal: null,
        operation: { fullNumber: null, localId: "l1", issuedAt: new Date().toISOString(), cashierName: null },
        customer: null,
        items: [{ productName: "P", sku: null, quantity: "1", unitPrice: "1.00", discount: "0.00", subtotal: "1.00" }],
        totals: { subtotal: "1.00", discount: "0.00", total: "1.00" },
        payments: { methods: [], paidTotal: "0.00", balance: "1.00" },
        observations: null, syncStatus: "synced",
      }, saved.id),
    ).rejects.toMatchObject({ code: "unsupported-capability" });
  });

  // 9 — testPrint
  it("testPrint() imprime un ticket de prueba real (mismo pipeline) con el mensaje esperado", async () => {
    const org = uniqueOrgId();
    const { manager, transport } = buildManagerWithFakeTransport(org);
    const saved = await manager.save(fakePrinterInput());
    await manager.connect(saved.id);

    await manager.testPrint(saved.id);

    const bytes = transport.getLastReceivedBytes()!;
    const text = new TextDecoder("ascii", { fatal: false })
      .decode(bytes)
      .replace(/[\x00-\x09\x0b-\x1f]/g, ""); // deja el contenido legible, ignora bytes de control que no son salto de línea
    expect(text).toContain("KIPU");
    expect(text).toContain("PRUEBA DE IMPRESION"); // "IMPRESIÓN" transliterado por AsciiFallbackEncoding (sin tilde)
    expect(text).toContain("Impresora conectada correctamente");
  });
});

describe("PrinterManager — multi-tenant: aislamiento por organización", () => {
  beforeEach(() => resetLocalDbCache());

  it("la impresora de la organización A nunca aparece en la organización B, ni al revés", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const managerA = new PrinterManager({ db: getLocalDb(orgA), organizationId: orgA });
    const managerB = new PrinterManager({ db: getLocalDb(orgB), organizationId: orgB });

    const printerA = await managerA.save(fakePrinterInput({ name: "Impresora de A" }));
    const printerB = await managerB.save(fakePrinterInput({ name: "Impresora de B" }));

    const devicesA = await managerA.listKnownDevices();
    const devicesB = await managerB.listKnownDevices();
    expect(devicesA.map((d) => d.id)).toEqual([printerA.id]);
    expect(devicesB.map((d) => d.id)).toEqual([printerB.id]);

    // No solo a nivel de filtro de UI — la PERSISTENCIA misma aísla: la
    // base física de A ni siquiera tiene una fila para el id de B.
    expect(await getLocalDb(orgA).printers.get(printerB.id)).toBeUndefined();
    expect(await getLocalDb(orgB).printers.get(printerA.id)).toBeUndefined();
  });

  it("cada organización mantiene su propia impresora predeterminada, sin interferir con la otra", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const managerA = new PrinterManager({ db: getLocalDb(orgA), organizationId: orgA });
    const managerB = new PrinterManager({ db: getLocalDb(orgB), organizationId: orgB });

    const printerA = await managerA.save(fakePrinterInput({ isDefault: true }));
    const printerB = await managerB.save(fakePrinterInput({ isDefault: true }));

    expect((await managerA.getDefault())?.id).toBe(printerA.id);
    expect((await managerB.getDefault())?.id).toBe(printerB.id);
  });

  it("getDevice() no puede leer la impresora de OTRA organización aunque se le pase su id exacto", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const managerA = new PrinterManager({ db: getLocalDb(orgA), organizationId: orgA });
    const managerB = new PrinterManager({ db: getLocalDb(orgB), organizationId: orgB });
    const printerB = await managerB.save(fakePrinterInput({ name: "Solo de B" }));

    await expect(managerA.getDevice(printerB.id)).rejects.toMatchObject({ code: "printer-not-found" });
  });
});

// Sanity: `PrinterError` es una clase real (`instanceof`), no un objeto genérico.
describe("PrinterError", () => {
  it("es instancia de Error y de PrinterError, con code/message/details", () => {
    const err = new PrinterError("not-connected", "mensaje", { extra: true });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PrinterError);
    expect(err.code).toBe("not-connected");
    expect(err.message).toBe("mensaje");
    expect(err.details).toEqual({ extra: true });
  });
});
