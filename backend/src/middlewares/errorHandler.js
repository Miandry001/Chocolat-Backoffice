import { DomainError } from "../services/syncService.js";
import { ValidationError } from "../validators/index.js";
import { logger } from "../utils/logger.js";
import { fail } from "../utils/response.js";

/**
 * Gestionnaire d'erreurs centralisé Express.
 * Garantit : aucune trace de pile ni message interne n'est renvoyé au client.
 * Structure de réponse d'erreur : { success: false, data: null, errors: [...], meta }
 * @param {Error} err - Erreur interceptée
 * @param {Request} req - Requête Express
 * @param {Response} res - Réponse Express
 * @param {Function} _next - Next middleware (non utilisé)
 */
export function errorHandler(err, req, res, _next) {
  // Erreurs de validation de payload (400)
  if (err instanceof ValidationError) return fail(res, 400, err.errors);

  // Erreurs métier du domaine (400, 409, 422, etc.)
  if (err instanceof DomainError) {
    const errors = err.status === 422 && Array.isArray(err.details)
      // Erreurs de validation détaillées (règles) : on mappe vers le format standard
      ? err.details.map((d) => ({ code: d.code, field: d.field, message: d.message, priority: d.priority }))
      // Erreur métier simple
      : [{ code: err.code, field: null, message: err.message }];
    return fail(res, err.status, errors);
  }

  // Erreurs Express spécifiques
  if (err?.type === "entity.parse.failed") return fail(res, 400, [{ code: "INVALID_JSON", field: null, message: "JSON invalide" }]);
  if (err?.type === "entity.too.large") return fail(res, 413, [{ code: "PAYLOAD_TOO_LARGE", field: null, message: "Requête trop volumineuse" }]);

  if (err?.code === 11000) {
    const indexName = typeof err.message === "string"
      ? err.message.match(/\bindex:\s+([^\s]+)\s+dup key\b/)?.[1]
      : undefined;
    const keyFields = Object.keys(err.keyPattern ?? {});
    const loginConflict = keyFields.includes("login")
      || keyFields.includes("usernameKey")
      || Object.hasOwn(err.keyValue ?? {}, "login")
      || Object.hasOwn(err.keyValue ?? {}, "usernameKey")
      || /(?:^|_)(?:login|usernameKey)(?:_|$)/i.test(indexName ?? "");
    logger.warn("duplicate_key_conflict", {
      path: req.path,
      method: req.method,
      indexName: indexName ?? "unknown",
      keyFields,
    });
    if (loginConflict) {
      return fail(res, 409, [{
        code: "USER_LOGIN_INDEX_MIGRATION_REQUIRED",
        field: "login",
        message: "La base impose encore l’unicité du login. Redémarrez le backend pour appliquer la migration des index.",
      }]);
    }
    return fail(res, 409, [{
      code: "DUPLICATE_KEY",
      field: null,
      message: "Une contrainte d’unicité de la base de données a été violée.",
    }]);
  }
  if (err?.code === "USER_EXISTS") return fail(res, 409, [{ code: "USER_EXISTS", field: "login", message: "Cet identifiant est déjà utilisé" }]);

  // Erreur non gérée : ne jamais logger le message brut d'une dépendance ou d'un client.
  // Ces messages peuvent contenir des URI MongoDB, tokens ou fragments de payload.
  logger.error("unhandled_error", {
    path: req.path,
    method: req.method,
    errorType: /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(err?.name ?? "") ? err.name : "Error",
  });
  return fail(res, 500, [{ code: "INTERNAL_ERROR", field: null, message: "Erreur interne" }]);
}

/**
 * Middleware 404 pour routes inconnues.
 * @param {Request} req
 * @param {Response} res
 */
export const notFound = (req, res) => {
  logger.warn("api_route_not_found", { path: req.path, method: req.method });
  return fail(res, 404, [{ code: "NOT_FOUND", field: null, message: "Une erreur est survenue!" }]);
};
