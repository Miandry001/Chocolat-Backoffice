import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeDataController } from "../src/controllers/dataController.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { readActor, readIdempotencyKey, validateSyncBody } from "../src/validators/index.js";
import { validValues } from "./fixtures.js";
import { authenticatedClient } from "./authHelper.js";

// Mini req/res pour tester les contrôleurs sans Express (Express lui-même : NOT TESTED ici).
const call = async (handler, { body, headers = {} } = {}) => {
  const req = { body, headers, auth: { id: "test-agent", role: "AGENT" }, path: "/x", method: "POST", };
  const out = {};
  const res = { status(s) { out.status = s; return this; }, json(j) { out.body = j; return this; } };
  await handler(req, res, (e) => errorHandler(e, req, res, () => {}));
  return out;
};
const full = () => validValues();

test("sync : 201 + enveloppe standard", async () => {
  const c = makeDataController(createMemoryRepos());
  const r = await call(c.sync, { body: { sourceRow: 2, values: full(), submit: true } });
  assert.equal(r.status, 201);
  assert.equal(r.body.success, true);
  assert.deepEqual(r.body.errors, []);
  assert.equal(r.body.data.status, "SUBMITTED");
  assert.equal(r.body.data.storageMode, "memory");
});

test("sync : rejeu avec la même Idempotency-Key → 200 replayed", async () => {
  const c = makeDataController(createMemoryRepos());
  const opt = { body: { sourceRow: 2, values: full(), submit: true }, headers: { "idempotency-key": "abc-1" } };
  await call(c.sync, opt);
  const r = await call(c.sync, opt);
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.replayed, true);
});

test("sync : payload invalide → 400 structuré", async () => {
  const c = makeDataController(createMemoryRepos());
  const r = await call(c.sync, { body: { sourceRow: 1, values: { $where: "1" }, submit: "oui" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(r.body.data, null);
  const fields = r.body.errors.map((e) => e.field);
  assert.deepEqual(fields.sort(), ["$where", "sourceRow", "submit"].sort());
});

test("sync : soumission incomplète → 422 avec erreurs de règles triées", async () => {
  const c = makeDataController(createMemoryRepos());
  const r = await call(c.sync, { body: { sourceRow: 2, values: { NOM: "" }, submit: true } });
  assert.equal(r.status, 422);
  assert.equal(r.body.errors[0].field, "NOM");
  assert.equal(r.body.errors[0].priority, "CRITICAL");
});

test("sync : champ inconnu → 400, une ligne approuvée reste modifiable", async () => {
  const repos = createMemoryRepos();
  const c = makeDataController(repos);
  assert.equal((await call(c.sync, { body: { sourceRow: 2, values: { input99: "x" } } })).status, 400);
  await call(c.sync, { body: { sourceRow: 2, values: full(), submit: true } });
  repos._db.treatments[0].status = "APPROVED";
  const update = await call(c.sync, { body: { sourceRow: 2, values: { NOM: "y" } } });
  assert.equal(update.status, 201);
  assert.equal(update.body.data.status, "DRAFT");
  assert.equal(update.body.data.version, 2);
});

test("data/row : restitue les valeurs et le statut du traitement pour recharger le formulaire", async () => {
  const repos = createMemoryRepos();
  const { client } = await authenticatedClient(repos);
  await repos.treatments.insert({
    sourceRow: 2,
    status: "SUBMITTED",
    currentVersion: 3,
    qualityFeedback: null,
    currentData: [{ k: "NOM", v: "CHOCOLAT" }, { k: "TYPE DE SPECIALITE", v: "SPECIALE" }],
  });

  const response = await client.get("/api/v1/data/row/2").expect(200);
  assert.deepEqual(response.body.data.treatment, {
    sourceRow: 2,
    status: "SUBMITTED",
    currentVersion: 3,
    qualityFeedback: null,
    currentData: { NOM: "CHOCOLAT", "TYPE DE SPECIALITE": "SPECIALE" },
  });
});

test("data/row : absence de traitement et sourceRow invalide", async () => {
  const { client } = await authenticatedClient(createMemoryRepos());
  const missing = await client.get("/api/v1/data/row/2").expect(200);
  assert.equal(missing.body.data.treatment, null);
  const invalid = await client.get("/api/v1/data/row/1").expect(400);
  assert.equal(invalid.body.errors[0].field, "sourceRow");
});

test("rules/validate : erreurs triées par priorité, rien d'enregistré", async () => {
  const repos = createMemoryRepos();
  const r = await call(makeDataController(repos).validate, { body: { values: { NOM: "", "Compte Total": "1,5" } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.valid, false);
  assert.equal(r.body.data.errors[0].priority, "CRITICAL");
  assert.equal(repos._db.treatments.length, 0);
});

test("erreur inattendue → 500 sans fuite d'information", async () => {
  const c = makeDataController({ withTransaction: () => { throw new Error("secret mongodb://user:pw@host"); }, idempotency: { get: async () => null } });
  const r = await call(c.sync, { body: { sourceRow: 2, values: { NOM: "a" } } });
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.body).includes("secret"));
});

test("validateurs : en-têtes acteur et clé", () => {
  assert.throws(() => readIdempotencyKey({ headers: { "idempotency-key": "a b" } }));
  assert.deepEqual(readActor({ auth: { id: "agent-1", role: "AGENT" }, headers: { "x-actor-id": "forged-admin", "x-actor-type": "ADMIN" } }), { actorId: "agent-1", actorType: "AGENT" });
  assert.throws(() => readActor({ headers: {} }));
  assert.throws(() => validateSyncBody(null));
});

test("label service : routes express montées sous /api/v1/labels", async () => {
  const { app, client } = await authenticatedClient(createMemoryRepos());

  const health = await request(app).get("/api/v1/health").expect(200);
  assert.equal(health.body.data.storageMode, "memory");

  const list = await client.get("/api/v1/labels").expect(200);
  assert.equal(list.body.success, true);
  assert.ok(Array.isArray(list.body.data));

  const calc = await client
    .post("/api/v1/labels/calculate")
    .send({ selectedLabels: ["BIO EQUITABLE", "VEGAN"] })
    .expect(200);

  assert.deepEqual(calc.body.data, {
    infoBiologique: "BIOLOGIQUE",
    infoEquitable: "EQUITABLE",
    infoEcologique: "NON ECOLOGIQUE",
    infoVegetal: "VEGETAL",
  });
});

test("labels/calculate : rejette une forme de payload invalide et les listes excessives", async () => {
  const { client } = await authenticatedClient(createMemoryRepos());

  const malformed = await client
    .post("/api/v1/labels/calculate")
    .send({ selectedLabels: "BIO EQUITABLE" })
    .expect(400);
  assert.equal(malformed.body.errors[0].field, "selectedLabels");

  const excessive = await client
    .post("/api/v1/labels/calculate")
    .send({ selectedLabels: Array.from({ length: 101 }, () => "VEGAN") })
    .expect(400);
  assert.match(excessive.body.errors[0].message, /100 labels maximum/);
});

test("suggestions : dictionnaire partagé accessible après 20 usages par champ", async () => {
  const repos = createMemoryRepos();
  for (let use = 0; use < 20; use++) await repos.suggestions.increment("Emballage", "BOITE");
  for (let use = 0; use < 25; use++) await repos.suggestions.increment("Company", "BOITE");
  const { client } = await authenticatedClient(repos);

  const response = await client
    .get("/api/v1/suggestions")
    .query({ field: "Emballage", prefix: "bo" })
    .expect(200);

  assert.equal(response.body.data[0].word, "BOITE");
  assert.equal(response.body.data[0].uses, 20);
});

test("suggestions : vocabulaire sémantique du champ disponible immédiatement", async () => {
  const { client } = await authenticatedClient(createMemoryRepos());
  const response = await client
    .get("/api/v1/suggestions")
    .query({ field: "Emballage", prefix: "bo" })
    .expect(200);

  assert.equal(response.body.data[0].word, "BOCAL");
  assert.equal(response.body.data[0].uses, 0);
});

test("sync apprend les mots de champ sans apprendre les choix de liste", async () => {
  const repos = createMemoryRepos();
  const { client } = await authenticatedClient(repos);
  for (let sourceRow = 2; sourceRow < 22; sourceRow++) {
    await client.post("/api/v1/data/sync").send({
      sourceRow,
      values: { ...full(), Emballage: "BOITE", Additifs: "MULTI ADDITIFS" },
      submit: true,
    }).expect(201);
  }

  const response = await client
    .get("/api/v1/suggestions")
    .query({ field: "Emballage", prefix: "BO" })
    .expect(200);
  assert.equal(response.body.data[0].word, "BOITE");
  assert.equal(response.body.data[0].uses, 20);
  assert.equal(repos._db.suggestions.has("Additifs\u0000MULTI"), false);
  assert.equal(repos._db.suggestions.has("Additifs\u0000ADDITIFS"), false);
});

test("sync ne compte les mots d'emballage qu'après une soumission", async () => {
  const repos = createMemoryRepos();
  const { client } = await authenticatedClient(repos);
  await client.post("/api/v1/data/sync").send({
    sourceRow: 2,
    values: { Emballage: "FOURREAU" },
  }).expect(201);
  assert.equal(repos._db.suggestions.has("Emballage\u0000FOURREAU"), false);

  await client.post("/api/v1/data/sync").send({
    sourceRow: 2,
    values: { ...full(), Emballage: "FOURREAU" },
    submit: true,
  }).expect(201);
  assert.equal(repos._db.suggestions.get("Emballage\u0000FOURREAU").uses, 1);
});
