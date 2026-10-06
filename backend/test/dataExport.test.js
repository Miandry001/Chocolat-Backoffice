import test from "node:test";
import assert from "node:assert/strict";
import { authenticatedClient } from "./authHelper.js";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";

test("data export includes eligible submission states and excludes drafts, returned, and rejected rows", async () => {
  const repos = createMemoryRepos();
  await repos.treatments.insert({
    sourceRow: 4,
    status: "SUBMITTED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "CONFISERIE" }],
    lastUpdatedAt: new Date(),
  });
  await repos.treatments.insert({
    sourceRow: 2,
    status: "IN_QC",
    currentVersion: 2,
    currentData: [{ k: "NOM", v: "EN CONTROLE" }],
    lastUpdatedAt: new Date(),
  });
  await repos.treatments.insert({
    sourceRow: 5,
    status: "APPROVED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "APPROUVE" }],
    lastUpdatedAt: new Date(),
  });
  await repos.treatments.insert({ sourceRow: 6, status: "DRAFT", currentVersion: 1, currentData: [] });
  await repos.treatments.insert({ sourceRow: 3, status: "REJECTED", currentVersion: 1, currentData: [] });
  await repos.treatments.insert({ sourceRow: 7, status: "CORRECTION_REQUIRED", currentVersion: 1, currentData: [] });
  const { client } = await authenticatedClient(repos);

  const response = await client.get("/api/v1/data/export").expect(200);
  assert.deepEqual(response.body.data.treatments.map(({ sourceRow, status }) => ({ sourceRow, status })), [
    { sourceRow: 2, status: "IN_QC" },
    { sourceRow: 4, status: "SUBMITTED" },
    { sourceRow: 5, status: "APPROVED" },
  ]);
  assert.equal(response.body.data.treatments[1].currentData[0].v, "CONFISERIE");
});

test("data export limits rows to the selected date range, role, and agent", async () => {
  const repos = createMemoryRepos();
  const { client } = await authenticatedClient(repos);
  await repos.users.create({ id: "agent-1", firstName: "Jean", lastName: "Dupont", role: "AGENT", active: true });
  await repos.users.create({ id: "agent-2", firstName: "Marie", lastName: "Martin", role: "AGENT", active: true });
  const eligible = await repos.treatments.insert({
    sourceRow: 10,
    status: "SUBMITTED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "JEAN" }],
    lastUpdatedAt: new Date("2026-10-01T02:00:00.000Z"),
  });
  const otherAgent = await repos.treatments.insert({
    sourceRow: 11,
    status: "SUBMITTED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "MARIE" }],
    lastUpdatedAt: new Date("2026-10-01T02:00:00.000Z"),
  });
  const outsidePeriod = await repos.treatments.insert({
    sourceRow: 12,
    status: "APPROVED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "JEAN - ANCIENNE" }],
    lastUpdatedAt: new Date("2026-09-30T02:00:00.000Z"),
  });
  await repos.audits.insertMany([
    { entityType: "TREATMENT", entityId: eligible._id, actor: { actorId: "agent-1", actorType: "AGENT" }, action: "SUBMITTED", timestamp: new Date("2026-10-01T02:00:00.000Z") },
    { entityType: "TREATMENT", entityId: otherAgent._id, actor: { actorId: "agent-2", actorType: "AGENT" }, action: "SUBMITTED", timestamp: new Date("2026-10-01T02:00:00.000Z") },
    { entityType: "TREATMENT", entityId: outsidePeriod._id, actor: { actorId: "agent-1", actorType: "AGENT" }, action: "SUBMITTED", timestamp: new Date("2026-09-30T02:00:00.000Z") },
  ]);

  const response = await client.get("/api/v1/data/export?from=2026-10-01&to=2026-10-01&role=AGENT&agent=jean").expect(200);
  assert.deepEqual(response.body.data.treatments.map(({ sourceRow }) => sourceRow), [10]);
  assert.equal(response.body.data.treatments[0].agentName, "Jean Dupont");
  assert.equal(response.body.data.treatments[0].treatmentDate, "2026-10-01T02:00:00.000Z");
});

test("data export returns no rows if the active filters match no users", async () => {
  const repos = createMemoryRepos();
  await repos.treatments.insert({
    sourceRow: 10,
    status: "SUBMITTED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "JEAN" }],
    lastUpdatedAt: new Date(),
  });
  const { client } = await authenticatedClient(repos);

  const response = await client.get("/api/v1/data/export?role=AGENT&agent=introuvable").expect(200);
  assert.deepEqual(response.body.data.treatments, []);
});
