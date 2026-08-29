import { describe, expect, it } from "vitest";
import { newIdempotencyKey, newLocalId, newSyncOperationId } from "./ids";

describe("ids — tres conceptos distintos", () => {
  it("cada generador produce un identificador no vacío", () => {
    expect(newLocalId().length).toBeGreaterThan(0);
    expect(newIdempotencyKey().length).toBeGreaterThan(0);
    expect(newSyncOperationId().length).toBeGreaterThan(0);
  });

  it("dos llamadas al mismo generador nunca coinciden (no hay reuso accidental)", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
  });

  it("los tres generadores producen valores independientes entre sí en la misma operación", () => {
    const localId = newLocalId();
    const idempotencyKey = newIdempotencyKey();
    const syncOperationId = newSyncOperationId();
    const values = new Set([localId, idempotencyKey, syncOperationId]);
    expect(values.size).toBe(3);
  });
});
