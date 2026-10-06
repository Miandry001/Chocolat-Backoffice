// COPIE de chocolat-main/src/data/rules.js — garder synchronisée avec le frontend (voir README).
import { fieldType, getFieldOptions } from "./fields.js";

/**
 * Règles de validation par défaut selon le type de champ.
 * Ces règles sont fusionnées avec FIELD_RULES (surcharges champ par champ).
 * - required : champ obligatoire
 * - maxLength : longueur maximale
 * - number : doit être un nombre (entier ou décimal)
 * - integer : doit être un entier (si number=true)
 * - min/max : bornes numériques
 * - oneOf : liste de valeurs autorisées (pour yesno et select)
 */
export const DEFAULT_RULES = {
  text: { required: true, maxLength: 255 },
  textarea: { required: true, maxLength: 2000 },
  number: { required: true, maxLength: 20, number: true, min: 0 },
  yesno: { required: true, oneOf: ["OUI", "NON"] },
  select: { required: true },
};

/**
 * Mots qui se terminent par S ou X mais qui sont des singuliers (exceptions à la détection de pluriel).
 * Utilisé par hasPluralWord() pour éviter les faux positifs.
 */
const SINGULAR_EXCEPTIONS = new Set(["ANIS", "BIS", "MAIS", "PLUS", "SANS", "CHOIX", "PRIX", "TAUX", "FRAIS"]);

/**
 * Détermine si un champ nécessite une vérification de pluriel.
 * - "INFO FOURRAGE" : toujours (ex: "AMANDES" = pluriel suspect)
 * - "Additifs" : seulement si l'utilisateur a choisi "Autre" (customFields.Additifs = true)
 * @param {string} name - Nom du champ
 * @param {Object} customFields - Champs en mode saisie libre { champ: boolean }
 * @returns {boolean}
 */
export function requiresPluralVerification(name, customFields = {}) {
  return name === "INFO FOURRAGE" || (name === "Additifs" && Boolean(customFields.Additifs));
}

/**
 * Détecte si une chaîne contient un mot au pluriel (se terminant par S ou X).
 * Ignore les mots "DE", "D'" et les exceptions SINGULAR_EXCEPTIONS.
 * @param {string} value - Valeur à analyser
 * @returns {boolean} true si au moins un mot pluriel détecté
 */
export function hasPluralWord(value = "") {
  // Extrait les mots (lettres majuscules, éventuellement avec apostrophe)
  const words = value.match(/[A-ZÀ-ÖØ-Þ]+(?:'[A-ZÀ-ÖØ-Þ]+)?/g) || [];
  return words.some((word) => {
    const normalized = word.replaceAll("'", "");
    if (["DE", "D"].includes(normalized) || SINGULAR_EXCEPTIONS.has(normalized)) return false;
    // Test de fin de mot : S ou X (pluriels français courants)
    return /(?:S|X)$/.test(normalized);
  });
}

/**
 * Surcharges de règles pour des champs spécifiques.
 * Fusionnées avec DEFAULT_RULES[fieldType(name)] dans getRules().
 * Exemple : "Compte Total" doit être un entier.
 */
export const FIELD_RULES = {
  "Onces Totales": { unitSuffix: true },
  "Compte Total": { integer: true },
  Bonus2: { required: false },
  Bonus3: { required: false },
  Bonus4: { required: false },
};

/**
 * Renvoie les règles de validation complètes pour un champ.
 * Combine : règles par défaut selon le type + surcharges FIELD_RULES + oneOf dynamique pour les select.
 * @param {string} name - Nom du champ
 * @param {Object} values - Valeurs actuelles du formulaire (pour options dynamiques des select)
 * @param {Object} customFields - Champs en mode saisie libre
 * @returns {Object} Règles fusionnées
 */
export function getRules(name, values = {}, customFields = {}) {
  const rules = { ...DEFAULT_RULES[fieldType(name)], ...FIELD_RULES[name] };
  // Pour les champs select (non personnalisés), on construit oneOf à partir des options actuelles
  if (fieldType(name) === "select" && !customFields[name]) {
    rules.oneOf = getFieldOptions(name, values)
      .filter(({ disabled }) => !disabled)
      .map(({ value }) => value)
      .filter((value) => value && value !== "__OTHER__");
  }
  return rules;
}

/**
 * Normalise une valeur : majuscules, suppression des accents, ligatures œ/æ → oe/ae.
 * Appliquée CÔTE SERVEUR (ne fait pas confiance au client) et côté client.
 * @param {string} s - Chaîne à normaliser
 * @returns {string} Chaîne normalisée
 */
export const formatValue = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toUpperCase();

const parseNumber = (s) => Number(s.replace(",", "."));

/**
 * Valide une valeur selon des règles données.
 * @param {string} value - Valeur brute
 * @param {Object} rules - Règles (depuis getRules)
 * @returns {string|null} Message d'erreur si invalide, null si valide
 */
export function validate(value, rules) {
  const v = value.trim();

  // Champ vide
  if (!v) return rules.required ? "Champ obligatoire" : null;

  // Longueur max
  if (rules.maxLength && v.length > rules.maxLength)
    return `${rules.maxLength} caractères maximum`;

  // Validation numérique
  if (rules.number) {
    const match = rules.unitSuffix
      ? /^(-?\d+(?:[.,]\d+)?)(?:\s+[A-Z]+(?:\s+[A-Z]+)*)?$/.exec(v)
      : /^(-?\d+(?:[.,]\d+)?)$/.exec(v);
    if (!match) {
      return rules.unitSuffix
        ? "Nombre attendu, suivi éventuellement d'une unité (ex. 12 GR)"
        : "Nombre attendu (ex. 12,5)";
    }
    const n = parseNumber(match[1]);
    if (rules.integer && !Number.isInteger(n)) return "Nombre entier attendu";
    if (rules.min != null && n < rules.min) return `Minimum : ${rules.min}`;
    if (rules.max != null && n > rules.max) return `Maximum : ${rules.max}`;
  }

  // Liste de valeurs autorisées (oneOf)
  if (rules.oneOf && !rules.oneOf.includes(v))
    return `Valeurs possibles : ${rules.oneOf.join(", ")}`;

  return null;
}

/**
 * Valide toutes les valeurs d'un formulaire.
 * @param {Object} values - Objet { champ: valeur }
 * @param {Object} customFields - Champs en mode saisie libre
 * @param {Object} pluralVerified - Champs dont le pluriel a été confirmé { champ: boolean }
 * @returns {Object} Objet { champ: messageErreur } pour les champs en erreur
 */
export function validateAll(values, customFields = {}, pluralVerified = {}) {
  const errors = {};
  for (const [name, value] of Object.entries(values)) {
    const error = validate(value, getRules(name, values, customFields));
    if (error) errors[name] = error;
    // Vérification pluriel additionnelle
    else if (requiresPluralVerification(name, customFields) && hasPluralWord(value) && !pluralVerified[name]) {
      errors[name] = "Pluralité vérifiée obligatoire";
    }
  }
  return errors;
}