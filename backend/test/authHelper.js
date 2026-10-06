import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/services/authService.js";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";

export async function authenticatedClient(repos = createMemoryRepos(), credentials = {}) {
  const loginName = credentials.login ?? "test-admin";
  const password = credentials.password ?? "test-password-123";
  if ((await repos.users.list()).length === 0) {
    await repos.users.create({
      id: "test-admin",
      login: loginName,
      passwordHash: await hashPassword(password),
      firstName: "Test",
      lastName: "Admin",
      fullName: "Test Admin",
      role: "ADMIN",
      active: true,
    });
  }
  const app = createApp(repos);
  const agent = request.agent(app);
  const login = await agent.post("/api/v1/auth/login")
    .set("Host", "app.test")
    .set("Origin", "http://app.test")
    .send({ login: loginName, password });
  if (login.status !== 200) throw new Error(`Test login failed: ${login.status}`);
  const csrf = login.headers["set-cookie"].find((cookie) => cookie.startsWith("chocolat_csrf=")).split(";")[0].split("=")[1];
  return {
    app,
    client: {
      get(path) { return agent.get(path); },
      post(path) { return agent.post(path).set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf); },
      put(path) { return agent.put(path).set("Host", "app.test").set("Origin", "http://app.test").set("X-CSRF-Token", csrf); },
    },
    repos,
  };
}
