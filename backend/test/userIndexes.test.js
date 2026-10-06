import test from "node:test";
import assert from "node:assert/strict";
import { removeUniqueUserLoginIndexes } from "../src/migrations/userIndexes.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";

test("a duplicate on a legacy login index reports that migration is required", () => {
  const response = {};
  const res = {
    status(status) { response.status = status; return this; },
    json(body) { response.body = body; return this; },
  };

  errorHandler(Object.assign(new Error("duplicate key"), {
    code: 11000,
    keyPattern: { usernameKey: 1 },
  }), { path: "/api/v1/users", method: "POST" }, res, () => {});

  assert.equal(response.status, 409);
  assert.equal(response.body.errors[0].code, "USER_LOGIN_INDEX_MIGRATION_REQUIRED");
  assert.match(response.body.errors[0].message, /Redémarrez le backend/);
});

test("a duplicate on another unique index is not reported as a concurrent write", () => {
  const response = {};
  const res = {
    status(status) { response.status = status; return this; },
    json(body) { response.body = body; return this; },
  };

  errorHandler(Object.assign(new Error("duplicate key on email_1"), {
    code: 11000,
    keyPattern: { email: 1 },
  }), { path: "/api/v1/users", method: "POST" }, res, () => {});

  assert.equal(response.status, 409);
  assert.equal(response.body.errors[0].code, "DUPLICATE_KEY");
  assert.doesNotMatch(response.body.errors[0].message, /concurrent|réessayez/i);
});

test("removes every unique index containing login, retaining other indexes", async () => {
  const dropped = [];
  const collection = {
    async indexes() {
      return [
        { name: "_id_", key: { _id: 1 }, unique: true },
        { name: "login_1", key: { login: 1 }, unique: true },
        { name: "login_role_unique", key: { login: 1, role: 1 }, unique: true },
        { name: "usernameKey_1", key: { usernameKey: 1 }, unique: true },
        { name: "login_search", key: { login: 1 } },
        { name: "email_unique", key: { email: 1 }, unique: true },
      ];
    },
    async dropIndex(name) { dropped.push(name); },
  };

  const removed = await removeUniqueUserLoginIndexes(collection);

  assert.deepEqual(removed, ["login_1", "login_role_unique", "usernameKey_1"]);
  assert.deepEqual(dropped, removed);
});

test("a missing users collection needs no index migration", async () => {
  const collection = {
    async indexes() { throw Object.assign(new Error("namespace missing"), { code: 26 }); },
    async dropIndex() { assert.fail("no index should be dropped"); },
  };

  assert.deepEqual(await removeUniqueUserLoginIndexes(collection), []);
});

test("index inspection failures other than a missing collection are propagated", async () => {
  const failure = Object.assign(new Error("permission denied"), { code: 13 });
  const collection = { async indexes() { throw failure; } };

  await assert.rejects(removeUniqueUserLoginIndexes(collection), failure);
});
