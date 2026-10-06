import { fail } from "../utils/response.js";
import { cookieNames } from "../services/authService.js";

export function readCookies(req) {
  const value = req.headers?.cookie ?? "";
  return Object.fromEntries(value.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part, ""];
    let decoded = "";
    try { decoded = decodeURIComponent(part.slice(index + 1)); } catch { /* Cookie malformé: valeur vide, authentification refusée. */ }
    return [part.slice(0, index), decoded];
  }));
}

function expectedOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

export function requireTrustedOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin || origin !== expectedOrigin(req)) return fail(res, 403, [{ code: "BAD_ORIGIN", message: "Origine de requête refusée" }]);
  return next();
}

export function makeAuthenticate(authService) {
  return async (req, res, next) => {
    try {
      const token = readCookies(req)[cookieNames.session];
      const identity = await authService.authenticate(token);
      if (!identity) return fail(res, 401, [{ code: "UNAUTHENTICATED", message: "Session absente, expirée ou révoquée" }]);
      req.auth = identity;
      return next();
    } catch (error) { return next(error); }
  };
}

export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const cookies = readCookies(req);
  const cookieToken = cookies[cookieNames.csrf];
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !/^[A-Za-z0-9_-]{40,64}$/.test(cookieToken)) {
    return fail(res, 403, [{ code: "CSRF_REJECTED", message: "Jeton CSRF manquant ou invalide" }]);
  }
  let mismatch = 0;
  for (let i = 0; i < cookieToken.length; i += 1) mismatch |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  if (mismatch !== 0) return fail(res, 403, [{ code: "CSRF_REJECTED", message: "Jeton CSRF manquant ou invalide" }]);
  return requireTrustedOrigin(req, res, next);
}

export function requireRoles(...roles) {
  return (req, res, next) => req.auth && roles.includes(req.auth.role)
    ? next()
    : fail(res, 403, [{ code: "FORBIDDEN", message: "Droits insuffisants" }]);
}

export function cookieOptions({ secure, httpOnly = true, maxAge, path = "/api" } = {}) {
  return { secure: Boolean(secure), httpOnly, sameSite: "strict", path, ...(maxAge == null ? {} : { maxAge }) };
}
