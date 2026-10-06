import { EDITABLE_FIELDS, getRules } from "../config/fields.js";
import { ERROR_TYPE, PRIORITY, PRIORITY_RANK } from "../constants/index.js";

/**
 * Vérifie si une valeur est vide (undefined, null, ou chaîne vide après trim).
 */
const isEmpty = (v) => String(v ?? "").trim() === "";

/**
 * Parse un nombre (gère la virgule française).
 */
const num = (s) => Number(String(s).trim().replace(",", "."));

/**
 * Regex pour valider un format numérique (entier ou décimal avec virgule ou point).
 */
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;
const NUMBER_WITH_UNIT_RE = /^(-?\d+(?:[.,]\d+)?)(?:\s+[A-Z]+(?:\s+[A-Z]+)*)?$/;

/**
 * Interface d'une règle :
 * {
 *   id: "NOM:required",           // Identifiant unique
 *   name: "required",             // Nom court
 *   description: "Champ obligatoire",
 *   field: "NOM",                 // Champ concerné
 *   errorType: "REQUIRED_FIELD",  // Type d'erreur (enum ERROR_TYPE)
 *   severity: "CRITICAL",         // Priorité (enum PRIORITY)
 *   validate: (values) => string | null  // Fonction de validation
 * }
 */

/**
 * Génère les règles de base pour un champ à partir de sa configuration (getRules).
 * @param {string} field - Nom du champ
 * @returns {Array} Liste des règles pour ce champ
 */
function rulesForField(field) {
  const cfg = getRules(field); // Configuration { required, maxLength, number, integer, min, max, oneOf }

  /**
   * Fabrique une règle standard.
   * @param {string} suffix - Suffixe pour l'id (ex: "required", "maxLength")
   * @param {string} errorType - Type d'erreur (ERROR_TYPE)
   * @param {string} severity - Priorité (PRIORITY)
   * @param {string} description - Description lisible
   * @param {Function} validate - Fonction de validation (valeur → message erreur ou null)
   */
  const rule = (suffix, errorType, severity, description, validate) => ({
    id: `${field}:${suffix}`, name: suffix, description, field, errorType, severity,
    // Ne valide pas si champ vide (sauf pour required)
    validate: (values) => {
      const value = String(values[field] ?? "").trim();
      return isEmpty(value) && suffix !== "required" ? null : validate(value, values);
    },
  });

  const asNumber = (v) => {
    const match = cfg.unitSuffix ? NUMBER_WITH_UNIT_RE.exec(v) : NUMBER_RE.exec(v);
    return match ? num(cfg.unitSuffix ? match[1] : v) : null;
  };
  const list = [];

  // Règle required
  if (cfg.required)
    list.push(rule("required", ERROR_TYPE.REQUIRED_FIELD, field === "NOM" ? PRIORITY.CRITICAL : PRIORITY.HIGH,
      "Champ obligatoire", (v) => (v ? null : "Champ obligatoire")));

  // Règle maxLength
  if (cfg.maxLength)
    list.push(rule("maxLength", ERROR_TYPE.INVALID_FORMAT, PRIORITY.MEDIUM, "Longueur maximale",
      (v) => (v.length > cfg.maxLength ? `${cfg.maxLength} caractères maximum` : null)));

  // Règles numériques
  if (cfg.number) {
    list.push(rule("number", ERROR_TYPE.INVALID_FORMAT, PRIORITY.HIGH, "Format numérique",
      (v) => (asNumber(v) !== null ? null : cfg.unitSuffix
        ? "Nombre attendu, suivi éventuellement d'une unité (ex. 12 GR)"
        : "Nombre attendu (ex. 12,5)")));
    if (cfg.integer)
      list.push(rule("integer", ERROR_TYPE.INVALID_VALUE, PRIORITY.MEDIUM, "Entier attendu",
        (v) => { const n = asNumber(v); return n !== null && !Number.isInteger(n) ? "Nombre entier attendu" : null; }));
    if (cfg.min != null)
      list.push(rule("min", ERROR_TYPE.INVALID_VALUE, PRIORITY.MEDIUM, "Valeur minimale",
        (v) => { const n = asNumber(v); return n !== null && n < cfg.min ? `Minimum : ${cfg.min}` : null; }));
    if (cfg.max != null)
      list.push(rule("max", ERROR_TYPE.INVALID_VALUE, PRIORITY.MEDIUM, "Valeur maximale",
        (v) => { const n = asNumber(v); return n !== null && n > cfg.max ? `Maximum : ${cfg.max}` : null; }));
  }

  // Règle oneOf (valeurs autorisées)
  if (cfg.oneOf)
    list.push(rule("oneOf", ERROR_TYPE.INVALID_VALUE, PRIORITY.HIGH, "Valeurs autorisées",
      (v, values) => {
        const allowed = getRules(field, values).oneOf ?? [];
        return allowed.includes(v) ? null : `Valeurs possibles : ${allowed.join(", ")}`;
      }));

  return list;
}

/**
 * Règles métier supplémentaires (futures : DUPLICATE, INCONSISTENCY, BUSINESS_RULE…).
 * Actuellement vide.
 */
const extraRules = [];

/**
 * Ensemble complet de toutes les règles, figé.
 * Ordre : règles par champ (dans l'ordre EDITABLE_FIELDS) + extraRules.
 */
export const RULES = Object.freeze([...EDITABLE_FIELDS.flatMap(rulesForField), ...extraRules]);

/**
 * Exécute toutes les règles sur un jeu de valeurs.
 * @param {Object} values - Objet { champ: valeur }
 * @param {Array} rules - Règles à exécuter (défaut: RULES)
 * @returns {Array} Erreurs triées : priorité (CRITICAL→LOW) puis ordre des champs du formulaire
 */
export function runRules(values, rules = RULES) {
  // Map champ → index dans EDITABLE_FIELDS pour le tri secondaire
  const order = new Map(EDITABLE_FIELDS.map((f, i) => [f, i]));
  const errors = [];
  for (const r of rules) {
    const message = r.validate(values);
    if (message)
      errors.push({ ruleId: r.id, code: r.errorType, errorType: r.errorType, field: r.field, priority: r.severity, message });
  }
  // Tri : priorité numérique croissante (CRITICAL=0 d'abord), puis ordre du formulaire
  return errors.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (order.get(a.field) ?? 999) - (order.get(b.field) ?? 999));
}