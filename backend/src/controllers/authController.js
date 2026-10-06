import { fail, ok } from "../utils/response.js";
import { cookieNames, SESSION_DURATION_MS } from "../services/authService.js";
import { cookieOptions } from "../middlewares/auth.js";

const roles = new Set(["AGENT", "SUPERVISEUR", "ADMIN"]);
const invalid = (res, field, message) => fail(res, 400, [{ code: "VALIDATION_ERROR", field, message }]);

function validateUser(body, { creating }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { field: "body", message: "Objet attendu" };
  const { login, firstName, lastName, role, password } = body;
  if (typeof login !== "string" || login.trim().length < 2 || login.trim().length > 100) return { field: "login", message: "Identifiant de 2 à 100 caractères requis" };
  if (typeof firstName !== "string" || !firstName.trim() || firstName.length > 100) return { field: "firstName", message: "Prénom requis (100 caractères maximum)" };
  if (typeof lastName !== "string" || !lastName.trim() || lastName.length > 100) return { field: "lastName", message: "Nom requis (100 caractères maximum)" };
  if (!roles.has(role)) return { field: "role", message: "Rôle invalide" };
  if (creating && (typeof password !== "string" || password.length < 8 || password.length > 200)) return { field: "password", message: "Mot de passe de 8 à 200 caractères requis" };
  if (!creating && password !== undefined && password !== "" && (typeof password !== "string" || password.length < 8 || password.length > 200)) return { field: "password", message: "Le nouveau mot de passe doit contenir entre 8 et 200 caractères" };
  return null;
}

export function makeAuthController(authService) {
  return {
    async login(req, res, next) {
      try {
        const { login, password } = req.body ?? {};
        if (typeof login !== "string" || typeof password !== "string" || login.length > 100 || password.length > 200) {
          return fail(res, 401, [{ code: "INVALID_CREDENTIALS", message: "Identifiants invalides" }]);
        }
        const normalizedLogin = login.trim().toLowerCase();
        const result = await authService.login(normalizedLogin, password);
        if (!result.ok) return fail(res, result.ambiguous ? 409 : 401, [{
          code: result.ambiguous ? "AMBIGUOUS_CREDENTIALS" : "INVALID_CREDENTIALS",
          message: result.ambiguous ? "Ce login et ce mot de passe correspondent à plusieurs comptes. Contactez un administrateur."
            : "Identifiants invalides",
        }]);
        const cookie = cookieOptions({ secure: authService.cookieSecure, maxAge: SESSION_DURATION_MS });
        res.cookie(cookieNames.session, result.token, cookie);
        res.cookie(cookieNames.csrf, result.csrfToken, cookieOptions({ secure: authService.cookieSecure, httpOnly: false, maxAge: SESSION_DURATION_MS, path: "/" }));
        return ok(res, { user: result.user, expiresAt: result.expiresAt });
      } catch (error) { return next(error); }
    },
    async me(req, res, next) {
      try { return ok(res, { user: await authService.findUser(req.auth.id) }); }
      catch (error) { return next(error); }
    },
    async logout(req, res, next) {
      try {
        await authService.logout(req.auth.id, req.auth.sessionId);
        res.clearCookie(cookieNames.session, cookieOptions({ secure: authService.cookieSecure }));
        res.clearCookie(cookieNames.csrf, cookieOptions({ secure: authService.cookieSecure, httpOnly: false, path: "/" }));
        return ok(res, { loggedOut: true });
      } catch (error) { return next(error); }
    },
    async listUsers(_req, res, next) {
      try { return ok(res, { users: await authService.listUsers() }); }
      catch (error) { return next(error); }
    },
    async createUser(req, res, next) {
      const problem = validateUser(req.body, { creating: true });
      if (problem) return invalid(res, problem.field, problem.message);
      if (req.auth.role === "SUPERVISEUR" && req.body.role !== "AGENT") {
        return fail(res, 403, [{ code: "FORBIDDEN_ROLE", field: "role", message: "Un superviseur peut uniquement créer un compte Agent" }]);
      }
      try {
        const { login, firstName, lastName, role, password } = req.body;
        const user = await authService.createUser({ login: login.trim().toLowerCase(), firstName: firstName.trim(), lastName: lastName.trim(), fullName: `${firstName.trim()} ${lastName.trim()}`, role, password });
        return ok(res, { user }, {}, 201);
      } catch (error) {
        if (error?.code === "DUPLICATE_IDENTITY") return fail(res, 409, [{ code: error.code, field: "password", message: "Un utilisateur avec ce nom, ce prénom et ce mot de passe existe déjà" }]);
        if (error?.code === "DUPLICATE_CREDENTIALS") return fail(res, 409, [{ code: error.code, field: "password", message: "Un compte avec ce login et ce mot de passe existe déjà" }]);
        return next(error);
      }
    },
    async updateUser(req, res, next) {
      const problem = validateUser(req.body, { creating: false });
      if (problem) return invalid(res, problem.field, problem.message);
      try {
        const { login, firstName, lastName, role, password, active } = req.body;
        const current = await authService.findUser(req.params.id);
        if (!current) return fail(res, 404, [{ code: "USER_NOT_FOUND", message: "Utilisateur introuvable" }]);
        const activeAdmins = (await authService.listUsers()).filter((entry) => entry.role === "ADMIN" && entry.active !== false);
        if (current.role === "ADMIN" && activeAdmins.length === 1 && (role !== "ADMIN" || active === false)) {
          return fail(res, 409, [{ code: "LAST_ADMIN", message: "Le dernier compte admin actif ne peut pas être désactivé ou rétrogradé" }]);
        }
        const patch = { login: login.trim().toLowerCase(), firstName: firstName.trim(), lastName: lastName.trim(), fullName: `${firstName.trim()} ${lastName.trim()}`, role };
        if (password) patch.password = password;
        if (typeof active === "boolean") patch.active = active;
        const invalidateSession = current.login !== patch.login || current.role !== role || Boolean(password) || active === false;
        const user = await authService.updateUser(req.params.id, patch, { invalidateSession });
        return user ? ok(res, { user }) : fail(res, 404, [{ code: "USER_NOT_FOUND", message: "Utilisateur introuvable" }]);
      } catch (error) { return next(error); }
    },
    async deleteUser(req, res, next) {
      try {
        if (String(req.params.id) === String(req.auth.id)) return fail(res, 409, [{ code: "SELF_DELETE", message: "Vous ne pouvez pas supprimer votre propre compte" }]);
        const target = await authService.findUser(req.params.id);
        const activeAdmins = (await authService.listUsers()).filter((entry) => entry.role === "ADMIN" && entry.active !== false);
        if (target?.role === "ADMIN" && target.active !== false && activeAdmins.length === 1) {
          return fail(res, 409, [{ code: "LAST_ADMIN", message: "Le dernier compte admin actif ne peut pas être supprimé" }]);
        }
        const deleted = await authService.deleteUser(req.params.id);
        return deleted ? ok(res, { deleted: true }) : fail(res, 404, [{ code: "USER_NOT_FOUND", message: "Utilisateur introuvable" }]);
      } catch (error) { return next(error); }
    },
  };
}
