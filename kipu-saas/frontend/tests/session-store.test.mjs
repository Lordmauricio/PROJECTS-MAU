import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  clearSession,
  getServerSessionSnapshot,
  getSessionSnapshot,
  parseSession,
  persistSession,
  subscribeToSession,
} from "../src/lib/session-store.ts";

const session = {
  accessToken: "test-access",
  refreshToken: "test-refresh",
  user: { id: "user-1", name: "Cajero", email: "cajero@example.test" },
  organization: { id: "org-1", name: "Pollería de prueba" },
};

beforeEach(() => {
  const values = new Map();
  const target = new EventTarget();
  target.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = target;
});
afterEach(() => {
  delete globalThis.window;
});

test("server snapshot does not access browser storage", () => {
  delete globalThis.window;
  assert.equal(getSessionSnapshot(), null);
  assert.equal(getServerSessionSnapshot(), null);
});

test("empty storage gives an unauthenticated client snapshot", () => {
  assert.notEqual(getSessionSnapshot(), null);
  assert.equal(parseSession(getSessionSnapshot()), null);
});

test("existing session keys restore the complete session with a stable snapshot", () => {
  persistSession(session);
  const snapshot = getSessionSnapshot();
  assert.equal(getSessionSnapshot(), snapshot);
  assert.deepEqual(parseSession(snapshot), session);
});

test("damaged, incomplete and malformed sessions fail closed", () => {
  persistSession(session);
  window.localStorage.setItem("kipu_user", "{broken");
  assert.equal(parseSession(getSessionSnapshot()), null);
  for (const value of [null, [], {}, { ...session.user, id: 10 }]) {
    window.localStorage.setItem("kipu_user", JSON.stringify(value));
    assert.equal(parseSession(getSessionSnapshot()), null);
  }
  persistSession(session);
  window.localStorage.removeItem("kipu_refresh_token");
  assert.equal(parseSession(getSessionSnapshot()), null);
  assert.equal(parseSession("not json"), null);
});

test("denied browser storage does not crash session restoration", () => {
  window.localStorage.getItem = () => {
    throw new Error("Storage denied");
  };
  assert.equal(parseSession(getSessionSnapshot()), null);
});

test("login and logout notify this tab and unsubscribe removes listeners", () => {
  let notifications = 0;
  const unsubscribe = subscribeToSession(() => {
    notifications++;
  });
  persistSession(session);
  assert.equal(notifications, 1);
  clearSession();
  assert.equal(notifications, 2);
  assert.equal(parseSession(getSessionSnapshot()), null);
  unsubscribe();
  persistSession(session);
  assert.equal(notifications, 2);
});

test("cross-tab changes notify only for session keys or a storage clear", () => {
  let notifications = 0;
  const unsubscribe = subscribeToSession(() => {
    notifications++;
  });
  for (const key of ["unrelated", "kipu_token", "kipu_organization", null]) {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: key });
    window.dispatchEvent(event);
  }
  assert.equal(notifications, 3);
  unsubscribe();
});
