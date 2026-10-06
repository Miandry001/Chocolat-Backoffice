import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { authenticatedClient } from "./authHelper.js";

test("dashboard summary counts submitted production and recorded returns only", async () => {
  const repos = createMemoryRepos();
  repos._db.treatments.push(
    { status: "DRAFT" },
    { status: "SUBMITTED" },
    { status: "APPROVED" },
    { status: "REJECTED" },
  );
  repos._db.audits.push(
    { action: "CORRECTION_REQUESTED", timestamp: new Date() },
    { action: "SUBMITTED", timestamp: new Date() },
  );

  const { client } = await authenticatedClient(repos);
  const response = await client.get("/api/v1/stats/summary").expect(200);

  assert.deepEqual(response.body.data, {
    validatedLines: 2,
    returnsReceived: 1,
    connectedHours: 0,
    yesterdayProduction: 0,
  });

  test("agent statistics apply inclusive date filters using Nairobi calendar dates", async () => {
    const repos = createMemoryRepos();
    repos._db.audits.push(
      { action: "SUBMITTED", actor: { actorType: "AGENT", actorId: "agent-1" }, timestamp: new Date("2026-10-04T21:30:00.000Z") },
      { action: "SUBMITTED", actor: { actorType: "AGENT", actorId: "agent-1" }, timestamp: new Date("2026-10-05T21:30:00.000Z") },
    );
    const { client } = await authenticatedClient(repos);

    const response = await client.get("/api/v1/stats/agents?from=2026-10-05&to=2026-10-05").expect(200);
    assert.equal(response.body.data.agents.length, 1);
    assert.deepEqual(response.body.data.agents[0].daily.map(({ date, validatedLines }) => ({ date, validatedLines })), [
      { date: "2026-10-05", validatedLines: 1 },
    ]);
  });
});
