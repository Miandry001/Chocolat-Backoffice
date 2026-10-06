import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/services/authService.js";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { sheetsPlugin } from "../../frontend/server/sheetsPlugin.js";

const actor = { id: "agent-1", login: "agent", firstName: "Awa", lastName: "Agent", fullName: "Awa Agent", role: "AGENT", active: true };
const secret = "test-jwt-secret-at-least-thirty-two-bytes";

async function setup() {
  const repos = createMemoryRepos({ users: [{ ...actor, passwordHash: await hashPassword("motdepasse-demo-123") }] });
  repos._db.audits.push({ entityType: "TREATMENT", entityId: "own", action: "SUBMITTED", actor: { actorId: actor.id, actorType: "AGENT" }, timestamp: new Date() });
  repos._db.audits.push({ entityType: "TREATMENT", entityId: "other", action: "SUBMITTED", actor: { actorId: "other-agent", actorType: "AGENT" }, timestamp: new Date() });
  const app = createApp(repos, { authSecret: secret });
  return { app, repos };
}

test("a new login replaces the previous session and invalidates its token", async () => {
  const { app, repos } = await setup();
  const firstClient = request.agent(app);
  const login = await firstClient.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test").send({ login: "agent", password: "motdepasse-demo-123" });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_session="));
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.match(sessionCookie, /Path=\/api/i);
  const csrfCookie = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_csrf="));
  assert.doesNotMatch(csrfCookie, /HttpOnly/i);
  assert.match(csrfCookie, /Path=\//i);

  const secondClient = request.agent(app);
  const secondLogin = await secondClient.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test")
    .send({ login: "agent", password: "motdepasse-demo-123" });
  assert.equal(secondLogin.status, 200);

  const anonymous = await request(app).get("/api/v1/stats/agents");
  assert.equal(anonymous.status, 401);
  await firstClient.get("/api/v1/stats/agents").expect(401);
  const authenticated = await secondClient.get("/api/v1/stats/agents");
  assert.equal(authenticated.status, 200);
  assert.deepEqual(authenticated.body.data.agents.map((entry) => entry.actorId), [actor.id]);
  assert.match(authenticated.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(Object.hasOwn(repos._db.users.get(actor.id), "password"), false);
  assert.match(repos._db.users.get(actor.id).passwordHash, /^scrypt\$/);
});

test("CSRF origin/token checks reject forged mutations; audit actor comes from JWT", async () => {
  const { app, repos } = await setup();
  const client = request.agent(app);
  const login = await client.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test").send({ login: "agent", password: "motdepasse-demo-123" });
  const csrfCookie = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_csrf=")).split(";")[0].split("=")[1];

  const forgedOrigin = await client.post("/api/v1/data/sync").set("Host", "app.test").set("X-CSRF-Token", csrfCookie).set("Origin", "https://attacker.invalid").send({ sourceRow: 2, values: { NOM: "PRODUIT" }, submit: false });
  assert.equal(forgedOrigin.status, 403);
  const missingCsrf = await client.post("/api/v1/data/sync").set("Host", "app.test").set("Origin", "http://app.test").send({ sourceRow: 2, values: { NOM: "PRODUIT" }, submit: false });
  assert.equal(missingCsrf.status, 403);

  const saved = await client.post("/api/v1/data/sync").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrfCookie)
    .set("X-Actor-Id", "attacker-controlled").send({ sourceRow: 2, values: { NOM: "PRODUIT" }, submit: false });
  assert.equal(saved.status, 201);
  assert.ok(repos._db.audits.length > 0);
  assert.equal(repos._db.audits.at(-1).actor.actorId, actor.id);
});

test("admin-created accounts keep only a server-side password hash and can authenticate", async () => {
  const admin = { id: "admin-1", login: "admin", firstName: "Test", lastName: "Admin", fullName: "Test Admin", role: "ADMIN", active: true };
  const repos = createMemoryRepos({ users: [{ ...admin, passwordHash: await hashPassword("admin-password-123") }] });
  const app = createApp(repos, { authSecret: secret });
  const administrator = request.agent(app);
  const login = await administrator.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test")
    .send({ login: "admin", password: "admin-password-123" }).expect(200);
  const csrfValue = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_csrf=")).split(";")[0].split("=")[1];
  const created = await administrator.post("/api/v1/users").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrfValue)
    .send({ login: "new.agent", password: "agent-password-123", firstName: "New", lastName: "Agent", role: "AGENT" }).expect(201);
  const userId = created.body.data.user.id;
  const stored = repos._db.users.get(userId);
  assert.equal(Object.hasOwn(stored, "password"), false);
  assert.match(stored.passwordHash, /^scrypt\$/);
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test")
    .send({ login: "new.agent", password: "agent-password-123" }).expect(200);
});

test("duplicate logins are resolved by password and duplicate credentials or named identity are refused", async () => {
  const admin = { id: "admin-duplicate-login", login: "shared-login", firstName: "Test", lastName: "Admin", fullName: "Test Admin", role: "ADMIN", active: true };
  const repos = createMemoryRepos({ users: [{ ...admin, passwordHash: await hashPassword("admin-password-123") }] });
  const app = createApp(repos, { authSecret: secret });
  const administrator = request.agent(app);
  const login = await administrator.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test")
    .send({ login: "shared-login", password: "admin-password-123" }).expect(200);
  const csrf = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_csrf=")).split(";")[0].split("=")[1];
  await administrator.post("/api/v1/users").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf)
    .send({ login: "shared-login", password: "agent-password-123", firstName: "New", lastName: "Agent", role: "AGENT" }).expect(201);
  const duplicateCredentials = await administrator.post("/api/v1/users").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf)
    .send({ login: "shared-login", password: "agent-password-123", firstName: "Other", lastName: "Agent", role: "AGENT" }).expect(409);
  assert.equal(duplicateCredentials.body.errors[0].code, "DUPLICATE_CREDENTIALS");

  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test")
    .send({ login: "shared-login", password: "agent-password-123" }).expect(200);

  const duplicateIdentity = await administrator.post("/api/v1/users").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf)
    .send({ login: "another-login", password: "admin-password-123", firstName: "Test", lastName: "Admin", role: "AGENT" }).expect(409);
  assert.equal(duplicateIdentity.body.errors[0].code, "DUPLICATE_IDENTITY");
});

test("supervisors can create agents but cannot grant privileged roles", async () => {
  const supervisor = { id: "supervisor-create", login: "supervisor", firstName: "Test", lastName: "Supervisor", fullName: "Test Supervisor", role: "SUPERVISEUR", active: true };
  const repos = createMemoryRepos({ users: [{ ...supervisor, passwordHash: await hashPassword("supervisor-password-123") }] });
  const app = createApp(repos, { authSecret: secret });
  const client = request.agent(app);
  const login = await client.post("/api/v1/auth/login").set("Host", "app.test").set("Origin", "http://app.test")
    .send({ login: "supervisor", password: "supervisor-password-123" }).expect(200);
  const csrf = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_csrf=")).split(";")[0].split("=")[1];

  await client.post("/api/v1/users").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf)
    .send({ login: "agent-login", password: "agent-password-123", firstName: "New", lastName: "Agent", role: "AGENT" }).expect(201);
  const forbidden = await client.post("/api/v1/users").set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf)
    .send({ login: "admin-login", password: "admin-password-123", firstName: "New", lastName: "Admin", role: "ADMIN" }).expect(403);
  assert.equal(forbidden.body.errors[0].code, "FORBIDDEN_ROLE");
});

test("Google Sheets endpoints refuse unauthenticated or cross-origin access", async () => {
  let middleware;
  const server = {
    config: { custom: { authService: { authenticate: async (token) => token === "valid" ? { id: "agent-1" } : null } } },
    middlewares: { use(handler) { middleware = handler; } },
  };
  sheetsPlugin({ keyFile: "unused-in-this-test.json", range: "A:Z" }).configureServer(server);

  const call = async ({ url, method, headers = {} }) => {
    const response = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
    const req = { url, method, headers, socket: { encrypted: false } };
    await middleware(req, response, () => { response.nextCalled = true; });
    return response;
  };

  const unauthenticated = await call({ url: "/api/source?row=2", method: "GET", headers: { host: "app.test" } });
  assert.equal(unauthenticated.statusCode, 401);
  const forgedConnect = await call({
    url: "/api/sheets/connect",
    method: "POST",
    headers: { host: "app.test", origin: "https://attacker.invalid", cookie: "chocolat_session=valid; chocolat_csrf=csrf", "x-csrf-token": "csrf" },
  });
  assert.equal(forgedConnect.statusCode, 403);
  assert.equal(forgedConnect.nextCalled, undefined);
});
