import { Router } from "express";
import { makeDataController } from "../controllers/dataController.js";
import { makeStatsController } from "../controllers/statsController.js";
import { makeAuthController } from "../controllers/authController.js";
import { makeQualityController } from "../controllers/qualityController.js";
import { makeDistributionGroupController } from "../controllers/distributionGroupController.js";
import { makeDataExportController } from "../controllers/dataExportController.js";
import { makeNotificationsController } from "../controllers/notificationsController.js";
import { makeAuthenticate, requireCsrf, requireRoles, requireTrustedOrigin } from "../middlewares/auth.js";
import labelRoutes from "./labelRoutes.js";

/**
 * Construit le routeur principal de l'API (/api/v1).
 * Monte les sous-routeurs et définit les endpoints principaux.
 * @param {Object} repos - Dépôts (mongo ou memory) injectés
 * @returns {Router} Routeur Express configuré
 */
export function buildRouter(repos, authService) {
  // Instancie les contrôleurs avec les dépôts
  const data = makeDataController(repos);
  const stats = makeStatsController(repos);
  const auth = makeAuthController(authService);
  const quality = makeQualityController(repos);
  const distributionGroups = makeDistributionGroupController(repos);
  const dataExport = makeDataExportController(repos);
  const notifications = makeNotificationsController(repos);
  const r = Router();

  // Health check : retourne le mode de stockage (mongodb/memory)
  r.get("/health", (_req, res) => res.json({
    success: true,
    data: { status: "ok", storageMode: repos.storageMode ?? "unknown" },
    errors: [],
    meta: {},
  }));

  r.post("/auth/login", requireTrustedOrigin, auth.login);
  r.get("/auth/me", makeAuthenticate(authService), auth.me);
  r.post("/auth/logout", makeAuthenticate(authService), requireCsrf, auth.logout);
  r.use(makeAuthenticate(authService), requireCsrf);

  r.get("/users", requireRoles("ADMIN", "SUPERVISEUR"), auth.listUsers);
  r.post("/users", requireRoles("ADMIN", "SUPERVISEUR"), auth.createUser);
  r.patch("/users/:id", requireRoles("ADMIN"), auth.updateUser);
  r.delete("/users/:id", requireRoles("ADMIN"), auth.deleteUser);

  // Statistiques dashboard
  r.get("/stats/summary", stats.summary);
  r.get("/stats/agents", stats.agents);
  r.get("/notifications", notifications.list);
  r.get("/quality/treatments", quality.list);
  r.post("/quality/treatments/:sourceRow/return", requireRoles("ADMIN", "SUPERVISEUR"), quality.returnForCorrection);
  r.get("/distribution-groups", distributionGroups.list);
  r.put("/distribution-groups/:groupStart/status", distributionGroups.update);

  // Routes labels (CRUD + calcul)
  r.use("/labels", labelRoutes);

  // Synchronisation données (création/MAJ traitement + versioning + audit)
  r.post("/data/sync", data.sync);
  r.get("/data/row/:sourceRow", data.getBySourceRow);
  r.get("/data/export", requireRoles("ADMIN", "SUPERVISEUR"), dataExport.listSubmitted);

  // Validation règles seule (sans enregistrement)
  r.post("/rules/validate", data.validate);

  // Suggestions d'autocomplétion par champ
  r.get("/suggestions", data.suggestions);

  return r;
}
