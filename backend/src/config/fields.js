/**
 * Configuration des champs côté backend.
 * Les 62 champs = 53 champs de saisie (FIELDS) + 9 champs source en lecture seule (READONLY).
 * Copies autonomes (config/vendor) du frontend : le backend ne dépend plus de la position du dossier.
 */
import { FIELDS, READONLY, fieldType } from "./vendor/fields.js";
import { getRules } from "./vendor/rules.js";

/** Liste figée des 53 champs éditables par l'agent. */
export const EDITABLE_FIELDS = Object.freeze([...FIELDS]);

/** Liste figée des 9 champs source en lecture seule (noms techniques seulement). */
export const SOURCE_FIELDS = Object.freeze(READONLY.map(([name]) => name));

/** Tous les champs connus (source + éditables), figés. */
export const ALL_FIELDS = Object.freeze([...SOURCE_FIELDS, ...EDITABLE_FIELDS]);

/**
 * Vérifie si un champ est éditable par l'agent.
 * @param {string} name - Nom du champ
 * @returns {boolean}
 */
export const isEditableField = (name) => EDITABLE_FIELDS.includes(name);

// Réexport des fonctions utilitaires depuis vendor
export { fieldType, getRules };