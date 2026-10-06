import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import { buildRouter } from "./routes/index.js";
import { createAuthService } from "./services/authService.js";

export function createApp(repos, { bodyLimit = process.env.JSON_BODY_LIMIT ?? "256kb", rateMax = 300, authSecret } = {}) {
  const app = express();
  const localSecret = process.env.NODE_ENV === "production" ? undefined : "local-dev-only-chocolat-jwt-secret-change-before-deploy";
  const authService = createAuthService(repos, { secret: authSecret ?? process.env.JWT_SECRET ?? localSecret });
  app.locals.authService = authService;
  app.use(helmet());
  app.use(rateLimit({ windowMs: 60_000, limit: rateMax, standardHeaders: true, legacyHeaders: false }));
  app.use("/api/v1/auth/login", rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: bodyLimit }));
  app.use("/api/v1", buildRouter(repos, authService));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
