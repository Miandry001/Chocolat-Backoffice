import { ACTOR_TYPE } from "../constants/index.js";

/**
 * Erreur de validation de payload (400).
 * Contient un tableau d'erreurs détaillées par champ.
 */
export class ValidationError extends Error {
  constructor(errors) { super("Payload invalide"); this.errors = errors; }
}

/**
 * Vérifie si une valeur est un objet plain (pas array, pas null, pas Date, etc.).
 * @param {*} o - Valeur à tester
 * @returns {boolean}
 */
const isPlainObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

/**
 * Crée un objet erreur standardisé pour la validation.
 * @param {string} field - Nom du champ concerné
 * @param {string} message - Message d'erreur
 * @returns {Object} { code, field, message }
 */
const err = (field, message) => ({ code: "VALIDATION_ERROR", field, message });

// Limites de sécurité
const MAX_VALUE_LENGTH = 2000;  // Longueur max d'une valeur
const MAX_KEYS = 100;           // Nombre max de champs dans values

/**
 * Valide l'objet `values` (champs de saisie) :
 * - Doit être un objet plain
 * - Clés : pas de $, pas de __proto__, pas de points (protection injection MongoDB)
 * - Longueur de clé ≤ 100
 * - Valeurs : string, number ou null seulement
 * - Longueur de valeur ≤ 2000
 * @param {Object} values - Objet à valider
 * @param {Array} errors - Tableau où pousser les erreurs trouvées
 * @returns {Object} Objet nettoyé { champ: string } (null → "")
 */
function checkValues(values, errors) {
  if (!isPlainObject(values)) return errors.push(err("values", "Objet attendu")), null;
  const keys = Object.keys(values);
  if (keys.length > MAX_KEYS) errors.push(err("values", `${MAX_KEYS} champs maximum`));
  const clean = {};
  for (const k of keys) {
    const v = values[k];
    // Protection injection MongoDB : rejette $..., __proto__, clés avec points
    if (k.length > 100 || k.startsWith("$") || k === "__proto__" || k.includes(".")) errors.push(err(k, "Nom de champ invalide"));
    else if (!(v === null || typeof v === "string" || typeof v === "number")) errors.push(err(k, "Texte ou nombre attendu"));
    else if (String(v ?? "").length > MAX_VALUE_LENGTH) errors.push(err(k, `${MAX_VALUE_LENGTH} caractères maximum`));
    else clean[k] = v === null ? "" : String(v);
  }
  return clean;
}

/**
 * Si des erreurs ont été collectées, lance ValidationError ; sinon retourne la valeur.
 * @param {*} value - Valeur à retourner si pas d'erreur
 * @param {Array} errors - Tableau d'erreurs collectées
 * @returns {*} value si pas d'erreur
 */
function finish(value, errors) {
  if (errors.length) throw new ValidationError(errors);
  return value;
}

/**
 * Valide le body de POST /api/v1/data/sync.
 * Attendu : { sourceRow: number, values: object, submit?: boolean }
 * @param {Object} body - Corps de requête
 * @returns {Object} { sourceRow, values: cleanValues, submit: boolean }
 */
export function validateSyncBody(body) {
  const errors = [];
  if (!isPlainObject(body)) throw new ValidationError([err("body", "Objet JSON attendu")]);
  const { sourceRow, values, submit } = body;
  // sourceRow : entier ≥ 2 (ligne 1 = en-têtes dans Google Sheets), max 1M pour sécurité
  if (!Number.isInteger(sourceRow) || sourceRow < 2 || sourceRow > 1_000_000) errors.push(err("sourceRow", "Entier ≥ 2 attendu"));
  // submit : booléen optionnel (défaut false)
  if (submit !== undefined && typeof submit !== "boolean") errors.push(err("submit", "Booléen attendu"));
  const clean = checkValues(values, errors);
  return finish({ sourceRow, values: clean, submit: submit === true }, errors);
}

/**
 * Valide le body de POST /api/v1/rules/validate.
 * Attendu : { values: object }
 * @param {Object} body - Corps de requête
 * @returns {Object} { values: cleanValues }
 */
export function validateRulesBody(body) {
  const errors = [];
  if (!isPlainObject(body)) throw new ValidationError([err("body", "Objet JSON attendu")]);
  const clean = checkValues(body.values, errors);
  return finish({ values: clean }, errors);
}

/**
 * Regex pour clé d'idempotence : 1-128 caractères alphanumériques + . _ : -
 */
const IDEM_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Lit et valide l'en-tête Idempotency-Key.
 * @param {Request} req - Requête Express
 * @returns {string|undefined} Clé validée ou undefined si absente
 * @throws {ValidationError} Si clé invalide
 */
export function readIdempotencyKey(req) {
  const key = req.headers?.["idempotency-key"];
  if (key === undefined) return undefined;
  if (!IDEM_RE.test(key)) throw new ValidationError([err("Idempotency-Key", "1 à 128 caractères [A-Za-z0-9._:-]")]);
  return key;
}

/**
 * Retourne l'identité issue du JWT vérifié par le middleware d'authentification.
 * @param {Request} req - Requête Express
 * @returns {Object} { actorId, actorType }
 * @throws {ValidationError} Si la session authentifiée est absente
 */
export function readActor(req) {
  if (!req.auth?.id || !req.auth?.role) throw new ValidationError([err("Authorization", "Session authentifiée requise")]);
  const actorType = req.auth.role === "ADMIN" ? ACTOR_TYPE.ADMIN
    : req.auth.role === "SUPERVISEUR" ? ACTOR_TYPE.QC
      : ACTOR_TYPE.AGENT;
  return { actorId: req.auth.id, actorType };
}
