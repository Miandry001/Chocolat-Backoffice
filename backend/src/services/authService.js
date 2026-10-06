import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = "chocolat_session";
const CSRF_COOKIE = "chocolat_csrf";

export const cookieNames = { session: COOKIE_NAME, csrf: CSRF_COOKIE };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [algorithm, saltHex, hashHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(saltHex ?? "") || !/^[a-f0-9]{128}$/.test(hashHex ?? "")) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

const authError = (code) => Object.assign(new Error(code), { code });

function b64url(value) { return Buffer.from(value).toString("base64url"); }
function sign(unsigned, secret) { return createHmac("sha256", secret).update(unsigned).digest("base64url"); }

export function createAuthService(repos, {
  secret = process.env.JWT_SECRET,
  cookieSecure = process.env.NODE_ENV === "production" || process.env.APP_ORIGIN?.startsWith("https://"),
} = {}) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("JWT_SECRET doit contenir au moins 32 octets");

  const issueToken = ({ userId, login, role, sessionId }) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: String(userId), login, role, jti: sessionId, iat: now, exp: now + SESSION_MS / 1000 };
    const unsigned = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
    return `${unsigned}.${sign(unsigned, secret)}`;
  };

  const verifyToken = (token) => {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(sign(unsigned, secret));
    const supplied = Buffer.from(parts[2]);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    try {
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (header.alg !== "HS256" || !claims.sub || !claims.jti || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null;
      return claims;
    } catch { return null; }
  };

  return {
    async login(login, password) {
      const normalizedLogin = login.trim().toLowerCase();
      const candidates = repos.users.findByLoginCandidates
        ? await repos.users.findByLoginCandidates(normalizedLogin)
        : [await repos.users.findByLogin(normalizedLogin)].filter(Boolean);
      const matchingUsers = [];
      for (const candidate of candidates) {
        if (candidate.active && await verifyPassword(password, candidate.passwordHash)) matchingUsers.push(candidate);
      }
      if (matchingUsers.length > 1) return { ok: false, ambiguous: true };
      const user = matchingUsers[0];
      if (!user) return { ok: false };
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_MS);
      await repos.sessions.create({ userId: String(user.id), sessionId, expiresAt });
      return {
        ok: true,
        token: issueToken({ userId: user.id, login: user.login, role: user.role, sessionId }),
        csrfToken: createCsrfToken(),
        user: publicUser(user),
        expiresAt,
      };
    },
    async authenticate(token) {
      const claims = verifyToken(token);
      if (!claims) return null;
      const session = await repos.sessions.find(claims.sub);
      if (!session || session.sessionId !== claims.jti || new Date(session.expiresAt) <= new Date()) return null;
      const user = await repos.users.findById(claims.sub);
      if (!user || !user.active || user.role !== claims.role) return null;
      return { id: String(user.id), login: user.login, role: user.role, sessionId: claims.jti };
    },
    async logout(userId, sessionId) { await repos.sessions.delete(userId, sessionId); },
    async createUser(input) {
      const { password, ...user } = input;
      const sameNameUsers = await repos.users.findByName(user.firstName, user.lastName);
      for (const existing of sameNameUsers) {
        if (await verifyPassword(password, existing.passwordHash)) throw authError("DUPLICATE_IDENTITY");
      }
      const sameLoginUsers = repos.users.findByLoginCandidates
        ? await repos.users.findByLoginCandidates(user.login)
        : [await repos.users.findByLogin(user.login)].filter(Boolean);
      for (const existing of sameLoginUsers) {
        if (await verifyPassword(password, existing.passwordHash)) throw authError("DUPLICATE_CREDENTIALS");
      }
      const passwordHash = await hashPassword(password);
      return publicUser(await repos.users.create({ ...user, passwordHash, active: true }));
    },
    async updateUser(id, input, { invalidateSession = false } = {}) {
      const patch = { ...input };
      if (patch.password) patch.passwordHash = await hashPassword(patch.password);
      delete patch.password;
      const user = await repos.users.update(id, patch);
      if (input.active === false || invalidateSession || input.password) await repos.sessions.deleteByUserId(id);
      return user ? publicUser(user) : null;
    },
    async deleteUser(id) { await repos.sessions.deleteByUserId(id); return repos.users.delete(id); },
    listUsers: async () => (await repos.users.list()).map(publicUser),
    findUser: async (id) => {
      const user = await repos.users.findById(id);
      return user ? publicUser(user) : null;
    },
    cookieSecure,
  };
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return { ...safe, id: String(user.id) };
}

export function createCsrfToken() { return createHash("sha256").update(randomBytes(32)).digest("hex"); }

export const SESSION_DURATION_MS = SESSION_MS;
