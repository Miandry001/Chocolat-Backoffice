import { fieldType, getRules, isEditableField } from "../config/fields.js";
import { SEMANTIC_SUGGESTION_CATALOG } from "../data/semanticSuggestionCatalog.js";
import { formatValue } from "../utils/normalize.js";

/**
 * Seuil minimum d'usages pour qu'une suggestion apprise apparaisse (20).
 * Évite le bruit des fautes de frappe occasionnelles.
 */
export const SUGGESTION_MIN_USES = 20;

/**
 * Nombre maximum de suggestions retournées par requête (8).
 */
export const SUGGESTION_LIMIT = 8;

/**
 * Valeurs prédéfinies (listes de choix) à NE PAS apprendre comme suggestions libres.
 * Ces valeurs viennent des listes déroulantes (select), pas de la saisie libre.
 */
const PREDEFINED_VALUES = new Set([
  "MULTI ADDITIFS", "VALEUR INDISPONIBLE", "SANS ADDITIF", "OUI", "NON",
  "NON APPLICABLE", "MULTIFORMES", "NON GARNI", "CHOVIVA", "DRAGEIFIE",
  "NON DRAGEIFIE", "DRAGEIFIE/NON DRAGEIFIE", "CREUX", "PLEINS", "CREUX/PLEINS",
  "SANS ATTACHE", "AVEC ATTACHE", "PERMANENT", "SAISONNIER", "PERMANENT/SAISONNIER",
  "SUBSTITUT CHOCOLAT & SPECIALITE CHOCOLAT", "CHOCOLAT & SPECIALITE CHOCOLAT",
  "SPECIALITE CHOCOLAT", "CONFISERIE CHOCOLAT", "MOULAGE",
  "ASSORTIMENT CHOCOLAT", "ASSORTIMENT CONFISERIE CHOCOLAT", "ASSORTIMENT MOULAGE",
  "NON NOEL", "NOEL", "NON PAQUES", "PAQUES", "NON AUTOMNE", "AUTOMNE",
  "NON HALLOWEEN", "HALLOWEEN", "NON SAINT VALENTIN", "SAINT VALENTIN",
  "NON FETES DES MERES", "FETES DES MERES",
]);

/**
 * Enregistre les mots d'une valeur saisie pour alimenter les suggestions futures.
 * Appelé après une soumission réussie (submit=true).
 * - Ignore les champs de type number et yesno
 * - Ignore les valeurs vides et les valeurs prédéfinies (listes de choix)
 * - Ignore les valeurs qui sont dans oneOf (listes de choix autorisées)
 * - Extrait les mots (séquences de majuscules) et incrémente leur compteur par champ
 * @param {Object} repos - Dépôts (suggestions)
 * @param {Object} values - Valeurs soumises { champ: valeur }
 */
export async function recordFieldSuggestions(repos, values = {}) {
  if (!repos.suggestions) return; // Pas de repo suggestions (ex: mémoire sans implémentation)
  for (const [field, rawValue] of Object.entries(values)) {
    const type = fieldType(field);
    if (type === "number" || type === "yesno") continue; // Pas de suggestions pour ces types
    const value = formatValue(rawValue).trim();
    if (!value || PREDEFINED_VALUES.has(value)) continue; // Vide ou valeur de liste prédéfinie
    const rules = getRules(field);
    if (rules.oneOf?.includes(value)) continue; // Valeur de la liste autorisée (select)

    // Extrait les mots (séquences de lettres majuscules)
    const words = new Set(value.match(/[A-Z]+/g) ?? []);
    for (const word of words) {
      if (word.length >= 2) await repos.suggestions.increment(field, word);
    }
  }
}

/**
 * Trouve les suggestions pour un champ et un préfixe.
 * Combine 3 sources, dédupliquées et triées :
 * 1. Apprises (mots utilisés ≥ 20 fois sur ce champ)
 * 2. Historiques (valeurs complètes des traitements existants, décomposées en mots)
 * 3. Sémantiques (catalogue prédéfini par champ, disponibles immédiatement)
 * @param {Object} repos - Dépôts (suggestions, treatments)
 * @param {string} field - Nom du champ
 * @param {string} rawPrefix - Préfixe saisi par l'utilisateur
 * @returns {Array} [{ field, word, uses }] trié par uses décroissant puis alphabétique
 */
export async function findFieldSuggestions(repos, field, rawPrefix) {
  // Champs non éditables ou types non supportés → pas de suggestions
  if (!isEditableField(field)) return [];
  const type = fieldType(field);
  if (type === "number" || type === "yesno") return [];

  const prefix = formatValue(rawPrefix).trim();
  if (prefix.length < 2) return []; // Minimum 2 caractères pour déclencher

  // 1. Suggestions apprises (seuil SUGGESTION_MIN_USES)
  // 2. Valeurs historiques des traitements (décomposées en mots)
  const [learned, historical] = await Promise.all([
    repos.suggestions?.find(field, prefix, SUGGESTION_MIN_USES, SUGGESTION_LIMIT) ?? [],
    repos.treatments.findFieldValuesByPrefix?.(field, prefix) ?? [],
  ]);

  // 3. Catalogue sémantique prédéfini pour ce champ (disponible immédiatement, uses=0)
  const semanticWords = (SEMANTIC_SUGGESTION_CATALOG[field] ?? [])
    .filter((word) => formatValue(word).startsWith(prefix));

  // Fusionne les 3 sources en dédupliquant par mot, en gardant le max des uses
  const byWord = new Map(semanticWords.map((word) => [word, 0]));
  for (const { word, uses } of learned) byWord.set(word, Math.max(byWord.get(word) ?? 0, uses));
  for (const { value, uses } of historical) {
    // Décompose la valeur historique en mots
    const words = new Set(formatValue(value).match(/[A-Z]+/g) ?? []);
    for (const word of words) {
      if (!word.startsWith(prefix) || word.length < 2 || PREDEFINED_VALUES.has(word)) continue;
      byWord.set(word, Math.max(byWord.get(word) ?? 0, uses));
    }
  }

  // Filtre final : garde si mot dans le catalogue sémantique OU uses ≥ seuil
  // Trie : uses décroissant, puis alphabétique
  // Limite à SUGGESTION_LIMIT
  return [...byWord]
    .filter(([word, uses]) => semanticWords.includes(word) || uses >= SUGGESTION_MIN_USES)
    .map(([word, uses]) => ({ field, word, uses }))
    .sort((left, right) => right.uses - left.uses || left.word.localeCompare(right.word))
    .slice(0, SUGGESTION_LIMIT);
}