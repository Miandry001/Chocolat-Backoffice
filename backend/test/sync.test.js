import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { syncTreatment } from "../src/services/syncService.js";
import { fromKV } from "../src/utils/kv.js";
import { validValues } from "./fixtures.js";

const full = (over = {}) => validValues(over);
const agent = { actorId: "a1", actorType: "AGENT" };

test("brouillon partiel accepté, erreurs enregistrées, version 1 + audit CREATED", async () => {
  const r = createMemoryRepos();
  const res = await syncTreatment(r, { sourceRow: 2, values: { NOM: "kinder" }, actor: agent });
  assert.equal(res.status, "DRAFT");
  assert.equal(res.version, 1);
  assert.ok(res.errors.length > 0);
  assert.equal(r._db.audits[0].action, "CREATED");
  assert.equal(r._db.versions.length, 1);
  assert.equal(r._db.validations.length, 1);
});

test("soumission incomplète → 422, rien n'est écrit (rollback)", async () => {
  const r = createMemoryRepos();
  await assert.rejects(syncTreatment(r, { sourceRow: 3, values: { NOM: "x" }, submit: true, actor: agent }), { status: 422 });
  assert.equal(r._db.treatments.length, 0);
  assert.equal(r._db.audits.length, 0);
});

test("soumission valide : SUBMITTED, valeurs normalisées, première soumission renseignée", async () => {
  const r = createMemoryRepos();
  const res = await syncTreatment(r, { sourceRow: 2, values: full({ NOM: "Crème" }), submit: true, actor: agent });
  assert.equal(res.status, "SUBMITTED");
  const t = r._db.treatments[0];
  assert.equal(fromKV(t.currentData).NOM, "CREME");
  assert.equal(fromKV(t.firstSubmittedData).NOM, "CREME");
  assert.equal(t.firstSubmittedBy.actorId, "a1");
  const actions = r._db.audits.map((a) => a.action);
  assert.ok(actions.includes("CREATED") && actions.includes("SUBMITTED"));
});

test("idempotence : même clé = même résultat, aucune écriture supplémentaire", async () => {
  const r = createMemoryRepos();
  const args = { sourceRow: 2, values: full(), submit: true, actor: agent, idempotencyKey: "k1" };
  const a = await syncTreatment(r, args);
  const b = await syncTreatment(r, args);
  assert.equal(b.replayed, true);
  assert.equal(b.treatmentId, a.treatmentId);
  assert.equal(r._db.versions.length, 1);
});

test("renvoi identique sans clé : pas de nouvelle version", async () => {
  const r = createMemoryRepos();
  await syncTreatment(r, { sourceRow: 2, values: { NOM: "A" }, actor: agent });
  const again = await syncTreatment(r, { sourceRow: 2, values: { NOM: "A" }, actor: agent });
  assert.equal(again.changed, false);
  assert.equal(r._db.versions.length, 1);
});

test("modification : version 2, FIELD_UPDATED avec ancienne/nouvelle valeur et auteur", async () => {
  const r = createMemoryRepos();
  await syncTreatment(r, { sourceRow: 2, values: { NOM: "A" }, actor: agent });
  await syncTreatment(r, { sourceRow: 2, values: { NOM: "B" }, actor: { actorId: "a2", actorType: "AGENT" } });
  const ev = r._db.audits.find((a) => a.action === "FIELD_UPDATED" && a.oldValue === "A");
  assert.equal(ev.newValue, "B");
  assert.equal(ev.field, "NOM");
  assert.equal(ev.actor.actorId, "a2");
  assert.equal(r._db.treatments[0].currentVersion, 2);
});

test("correction : CORRECTION_REQUIRED + soumission → RESUBMITTED", async () => {
  const r = createMemoryRepos();
  await syncTreatment(r, { sourceRow: 2, values: full(), submit: true, actor: agent });
  r._db.treatments[0].status = "CORRECTION_REQUIRED"; // posé par le futur module CQ
  const res = await syncTreatment(r, { sourceRow: 2, values: { NOM: "Z" }, submit: true, actor: agent });
  assert.equal(res.status, "RESUBMITTED");
});

test("resubmission clears the displayed QC feedback while preserving its audit record", async () => {
  const r = createMemoryRepos();
  await syncTreatment(r, { sourceRow: 2, values: full(), submit: true, actor: agent });
  r._db.treatments[0].status = "CORRECTION_REQUIRED";
  r._db.treatments[0].qualityFeedback = { message: "Corriger le nom" };
  r._db.audits.push({ action: "COMMENT_ADDED", field: "qualityFeedback", newValue: "Corriger le nom" });

  const res = await syncTreatment(r, { sourceRow: 2, values: full(), submit: true, actor: agent });
  assert.equal(res.status, "RESUBMITTED");
  assert.equal(r._db.treatments[0].qualityFeedback, null);
  assert.ok(r._db.audits.some(({ action, newValue }) => action === "COMMENT_ADDED" && newValue === "Corriger le nom"));
});

test("une ligne soumise, en contrôle, approuvée ou rejetée peut être corrigée et renvoyée", async () => {
  for (const status of ["SUBMITTED", "IN_QC", "RESUBMITTED", "APPROVED", "REJECTED"]) {
    const r = createMemoryRepos();
    await syncTreatment(r, { sourceRow: 2, values: full(), submit: true, actor: agent });
    r._db.treatments[0].status = status;

    const res = await syncTreatment(r, {
      sourceRow: 2, values: full({ NOM: `CORRIGE ${status}` }), submit: true, actor: agent,
    });

    assert.equal(res.status, status === "RESUBMITTED" ? "RESUBMITTED" : "SUBMITTED");
    assert.equal(res.version, 2);
    assert.ok(r._db.audits.some((entry) =>
      entry.action === (status === "RESUBMITTED" ? "RESUBMITTED" : "SUBMITTED")));
  }
});

test("un brouillon modifié après validation revient en DRAFT pour repasser en contrôle", async () => {
  const r = createMemoryRepos();
  await syncTreatment(r, { sourceRow: 2, values: full(), submit: true, actor: agent });
  r._db.treatments[0].status = "APPROVED";

  const res = await syncTreatment(r, { sourceRow: 2, values: { NOM: "CORRECTION" }, actor: agent });

  assert.equal(res.status, "DRAFT");
  assert.equal(res.version, 2);
});

test("champ inconnu refusé", async () => {
  await assert.rejects(syncTreatment(createMemoryRepos(), { sourceRow: 2, values: { input99: "x" }, actor: agent }), { status: 400 });
});
