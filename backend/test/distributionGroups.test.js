import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { authenticatedClient } from "./authHelper.js";

test("distribution group statuses are persisted and returned in group order", async () => {
  const { client, repos } = await authenticatedClient(createMemoryRepos());

  await client.get("/api/v1/distribution-groups").expect(200).expect(({ body }) => {
    assert.deepEqual(body.data.groups, []);
  });

  await client.put("/api/v1/distribution-groups/51/status").send({ status: "SAISIE TERMINEE" }).expect(200);
  await client.put("/api/v1/distribution-groups/1/status").send({ status: "VALIDEE" }).expect(200);
  await client.put("/api/v1/distribution-groups/101/status").send({ status: "NON ASSIGNE" }).expect(200);

  const response = await client.get("/api/v1/distribution-groups").expect(200);
  assert.deepEqual(response.body.data.groups.map(({ groupStart, status }) => ({ groupStart, status })), [
    { groupStart: 1, status: "VALIDEE" },
    { groupStart: 51, status: "SAISIE TERMINEE" },
    { groupStart: 101, status: "NON ASSIGNE" },
  ]);
  assert.equal((await repos.distributionGroups.list()).length, 3);
});

test("distribution group status endpoint rejects invalid starts and statuses", async () => {
  const { client } = await authenticatedClient(createMemoryRepos());

  await client.put("/api/v1/distribution-groups/2/status").send({ status: "UNKNOWN" }).expect(400);
  await client.put("/api/v1/distribution-groups/1/status").send({ status: "UNKNOWN" }).expect(400);
});

test("legacy VALIDE block status is exposed as VALIDEE", async () => {
  const repos = createMemoryRepos();
  repos._db.distributionGroups.set(1, {
    groupStart: 1,
    status: "VALIDE",
    updatedAt: new Date(),
    updatedBy: "legacy-user",
  });
  const { client } = await authenticatedClient(repos);

  await client.get("/api/v1/distribution-groups").expect(200).expect(({ body }) => {
    assert.equal(body.data.groups[0].status, "VALIDEE");
  });
});
