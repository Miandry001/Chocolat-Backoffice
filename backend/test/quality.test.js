import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { hashPassword } from "../src/services/authService.js";
import { authenticatedClient } from "./authHelper.js";

test("quality queue returns submitted treatments with their latest validation and values", async () => {
  const repos = createMemoryRepos();
  const treatment = await repos.treatments.insert({
    sourceRow: 8,
    status: "SUBMITTED",
    currentVersion: 2,
    currentData: [{ k: "NOM", v: "CHOCOLAT" }, { k: "EAN13", v: "1234567890123" }],
    lastUpdatedAt: new Date("2026-10-05T09:00:00Z"),
    lastUpdatedBy: { actorId: "test-agent", actorType: "AGENT" },
  });
  await repos.validations.insert({
    treatmentId: treatment._id,
    version: 2,
    errors: [{ field: "NOM", message: "Vérifier le nom", priority: "HIGH" }],
  });
  await repos.treatments.insert({ sourceRow: 9, status: "DRAFT", currentVersion: 1, currentData: [] });
  const { client } = await authenticatedClient(repos);

  const response = await client.get("/api/v1/quality/treatments").expect(200);
  assert.equal(response.body.data.treatments.length, 1);
  assert.equal(response.body.data.treatments[0].sourceRow, 8);
  assert.equal(response.body.data.treatments[0].currentData.NOM, "CHOCOLAT");
  assert.equal(response.body.data.treatments[0].errors[0].message, "Vérifier le nom");
});

test("quality return stores feedback, changes status, records audit and is exposed to the agent", async () => {
  const repos = createMemoryRepos();
  const { client } = await authenticatedClient(repos);
  await repos.users.create({
    id: "test-agent",
    login: "quality-agent",
    passwordHash: await hashPassword("agent-password-123"),
    firstName: "Jean",
    lastName: "Dupont",
    fullName: "Jean Dupont",
    role: "AGENT",
    active: true,
  });
  await repos.treatments.insert({
    sourceRow: 8,
    status: "SUBMITTED",
    currentVersion: 1,
    currentData: [{ k: "NOM", v: "CHOCOLAT" }],
    lastUpdatedAt: new Date(),
    lastUpdatedBy: { actorId: "test-agent", actorType: "AGENT" },
  });

  const response = await client.post("/api/v1/quality/treatments/8/return").send({ message: "Vérifier le nom." }).expect(200);
  assert.equal(response.body.data.statusAfterReturn, "CORRECTION_REQUIRED");
  const treatment = await repos.treatments.findByRow(8);
  assert.equal(treatment.status, "CORRECTION_REQUIRED");
  assert.equal(treatment.qualityFeedback.message, "Vérifier le nom.");
  assert.deepEqual(repos._db.audits.map(({ action }) => action), ["COMMENT_ADDED", "CORRECTION_REQUESTED"]);

  const reopened = await client.get("/api/v1/data/row/8").expect(200);
  assert.equal(reopened.body.data.treatment.qualityFeedback.message, "Vérifier le nom.");

  const agentClient = await authenticatedClient(repos, { login: "quality-agent", password: "agent-password-123" });
  const agentNotifications = await agentClient.client.get("/api/v1/notifications").expect(200);
  assert.equal(agentNotifications.body.data.notifications.length, 1);
  assert.equal(agentNotifications.body.data.notifications[0].message, "Vérifier le nom.");
  assert.equal(agentNotifications.body.data.notifications[0].link, "/distribution/groupe/1/ligne/7");
  const reviewerNotifications = await client.get("/api/v1/notifications").expect(200);
  assert.deepEqual(reviewerNotifications.body.data.notifications, []);
});

test("quality return validates feedback and refuses treatments outside the QC queue", async () => {
  const repos = createMemoryRepos();
  await repos.treatments.insert({ sourceRow: 8, status: "DRAFT", currentVersion: 1, currentData: [] });
  const { client } = await authenticatedClient(repos);

  await client.post("/api/v1/quality/treatments/8/return").send({ message: " " }).expect(400);
  await client.post("/api/v1/quality/treatments/8/return").send({ message: "Correction demandée." }).expect(409);
  await client.post("/api/v1/quality/treatments/9/return").send({ message: "Correction demandée." }).expect(404);
});

test("quality queue is paginated and rejects an invalid page", async () => {
  const repos = createMemoryRepos();
  for (let index = 0; index < 101; index += 1) {
    await repos.treatments.insert({
      sourceRow: index + 2,
      status: "SUBMITTED",
      currentVersion: 1,
      currentData: [],
      lastUpdatedAt: new Date(index),
    });
  }
  const { client } = await authenticatedClient(repos);

  const firstPage = await client.get("/api/v1/quality/treatments?page=0").expect(200);
  assert.equal(firstPage.body.data.treatments.length, 100);
  assert.equal(firstPage.body.data.hasMore, true);
  const secondPage = await client.get("/api/v1/quality/treatments?page=1").expect(200);
  assert.equal(secondPage.body.data.treatments.length, 1);
  assert.equal(secondPage.body.data.hasMore, false);
  await client.get("/api/v1/quality/treatments?page=-1").expect(400);
});

test("agents can view the quality queue but cannot send correction requests", async () => {
  const repos = createMemoryRepos();
  await repos.users.create({
    id: "quality-agent",
    login: "quality-agent",
    passwordHash: await hashPassword("agent-password-123"),
    firstName: "Agent",
    lastName: "Qualité",
    fullName: "Agent Qualité",
    role: "AGENT",
    active: true,
  });
  const { client } = await authenticatedClient(repos, {
    login: "quality-agent",
    password: "agent-password-123",
  });

  await client.get("/api/v1/quality/treatments").expect(200);
  await client.post("/api/v1/quality/treatments/8/return")
    .send({ message: "Correction demandée." }).expect(403);
});
