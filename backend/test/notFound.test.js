import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { authenticatedClient } from "./authHelper.js";

test("unknown API routes return only the generic client-facing error", async () => {
  const { client } = await authenticatedClient(createMemoryRepos());
  const response = await client.get("/api/v1/unknown-route").expect(404);

  assert.equal(response.body.errors[0].message, "Une erreur est survenue!");
});
