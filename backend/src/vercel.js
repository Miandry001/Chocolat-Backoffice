import mongoose from "mongoose";
import { createApp } from "./app.js";
import { createMongoRepos } from "./repositories/mongoRepos.js";
import { logger } from "./utils/logger.js";
import { hashPassword, verifyPassword } from "./services/authService.js";
import { User } from "./models/index.js";
import { removeUniqueUserLoginIndexes } from "./migrations/userIndexes.js";

let appPromise;

async function bootstrap() {
  const { MONGODB_URI, JWT_SECRET } = process.env;
  if (!MONGODB_URI) throw new Error("MONGODB_URI manquant");
  if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET manquant ou trop court (32 octets minimum)");
  }

  await mongoose.connect(MONGODB_URI);
  await removeUniqueUserLoginIndexes(User.collection);
  await Promise.all([mongoose.model("User").init(), mongoose.model("ActiveSession").init()]);

  const repos = createMongoRepos();

  // Création de l'admin initial (si configuré)
  const login = process.env.AUTH_BOOTSTRAP_ADMIN_LOGIN?.trim().toLowerCase();
  const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
  if (login && password && password.length >= 12) {
    const sameLogin = await repos.users.findByLoginCandidates(login);
    if (!sameLogin.some((u) => u.role === "ADMIN")) {
      const sameName = await repos.users.findByName("Admin", "Principal");
      for (const c of [...sameLogin, ...sameName]) {
        if (await verifyPassword(password, c.passwordHash)) {
          throw new Error("bootstrap_admin_credentials_conflict");
        }
      }
      await repos.users.create({
        login, firstName: "Admin", lastName: "Principal", fullName: "Admin Principal",
        role: "ADMIN", passwordHash: await hashPassword(password), active: true,
      });
      logger.info("bootstrap_admin_created");
    }
  }

  return createApp(repos);
}

export default async function handler(req, res) {
  try {
    appPromise ??= bootstrap();
    const app = await appPromise;
    return app(req, res);
  } catch (error) {
    appPromise = undefined; // permet de réessayer à la requête suivante
    logger.error("vercel_bootstrap_failed", { message: error.message });
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server initialization failed" }));
  }
}
