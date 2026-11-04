import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestRequest } from "../src/lib/latest-request.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("the latest filter response wins even when the older response arrives last", async () => {
  const runner = createLatestRequest(),
    older = deferred(),
    newer = deferred();
  const values = [],
    errors = [];
  const first = runner.run(
    () => older.promise,
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  const second = runner.run(
    () => newer.promise,
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  newer.resolve("new filter");
  await second;
  older.resolve("old filter");
  await first;
  assert.deepEqual(values, ["new filter"]);
  assert.deepEqual(errors, []);
});

test("a late error from an obsolete request cannot overwrite successful data", async () => {
  const runner = createLatestRequest(),
    older = deferred();
  const errors = [];
  const first = runner.run(
    () => older.promise,
    () => {},
    (error) => errors.push(error),
  );
  await runner.run(
    async () => "current",
    () => {},
    (error) => errors.push(error),
  );
  older.reject(new Error("old network failure"));
  await first;
  assert.deepEqual(errors, []);
});

test("unmount cancels both success and failure callbacks; a remount can fetch again", async () => {
  const runner = createLatestRequest(),
    request = deferred();
  const callbacks = [];
  const pending = runner.run(
    () => request.promise,
    () => callbacks.push("success"),
    () => callbacks.push("error"),
  );
  runner.cancel();
  request.resolve("obsolete");
  await pending;
  assert.deepEqual(callbacks, []);
  await runner.run(
    async () => "fresh",
    (value) => callbacks.push(value),
    () => {},
  );
  assert.deepEqual(callbacks, ["fresh"]);
});

test("synchronous and asynchronous fetch failures reach the error handler", async () => {
  const runner = createLatestRequest(),
    errors = [];
  await runner.run(
    () => {
      throw new Error("sync");
    },
    () => {},
    (error) => errors.push(error.message),
  );
  await runner.run(
    async () => {
      throw new Error("async");
    },
    () => {},
    (error) => errors.push(error.message),
  );
  assert.deepEqual(errors, ["sync", "async"]);
});
