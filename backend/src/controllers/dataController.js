import { PRIORITY_RANK } from "../constants/index.js";
import { runRules } from "../rules/index.js";
import { syncTreatment } from "../services/syncService.js";
import { findFieldSuggestions, recordFieldSuggestions } from "../services/suggestionService.js";
import { logger } from "../utils/logger.js";
import { normalizeValues } from "../utils/normalize.js";
import { fail, ok } from "../utils/response.js";
import { readActor, readIdempotencyKey, validateRulesBody, validateSyncBody } from "../validators/index.js";

/**
 * Résume un tableau d'erreurs par priorité.
 * @param {Array} errors - Tableau d'erreurs avec propriété priority
 * @returns {Object} { CRITICAL: count, HIGH: count, ... }
 */
const summarize = (errors) => errors.reduce((acc, e) => ({ ...acc, [e.priority]: (acc[e.priority] ?? 0) + 1 }), {});

/**
 * Crée le contrôleur de données avec les dépôts injectés.
 * @param {Object} repos - Dépôts (treatments, versions, audits, validations, suggestions, idempotency, statistics)
 * @returns {Object} Contrôleur avec méthodes sync, suggestions, validate
 */
export function makeDataController(repos) {
  return {
    /**
     * POST /api/v1/data/sync
     * Crée ou met à jour un traitement (identifié par sourceRow), versionne, audite, valide.
     * Tout se passe dans une transaction : traitement + version + audit + résultat de validation.
     * Idempotence : même Idempotency-Key => même réponse, sans nouvelle écriture.
     * Une soumission (submit=true) est refusée (422) si des règles échouent ;
     * un brouillon (submit=false) est toujours accepté et ses erreurs sont enregistrées.
     */
    async sync(req, res, next) {
      try {
        // 1. Valide le payload
        const body = validateSyncBody(req.body);
        // 2. Exécute le traitement métier dans une transaction
        const result = await syncTreatment(repos, {
          ...body,
          actor: readActor(req),           // Acteur depuis en-têtes
          idempotencyKey: readIdempotencyKey(req), // Clé d'idempotence
        });
        // 3. Apprend les suggestions si soumission réussie (non replayed)
        const { replayed, ...data } = result;
        if (body.submit && result.changed && !replayed) {
          try {
            await recordFieldSuggestions(repos, body.values);
          } catch {
            logger.warn("field_suggestions_learning_failed");
          }
        }
        // 4. Réponse standardisée
        return ok(res, { ...data, storageMode: repos.storageMode ?? "unknown" },
          { replayed: replayed === true }, data.changed && !replayed ? 201 : 200);
      } catch (e) { next(e); }
    },

    async getBySourceRow(req, res, next) {
      try {
        const sourceRow = Number(req.params.sourceRow);
        if (!Number.isInteger(sourceRow) || sourceRow < 2 || sourceRow > 1_000_000) {
          return fail(res, 400, [{ code: "VALIDATION_ERROR", field: "sourceRow", message: "Entier ≥ 2 attendu" }]);
        }
        const treatment = await repos.treatments.findByRow(sourceRow);
        return ok(res, {
          treatment: treatment ? {
            sourceRow: treatment.sourceRow,
            status: treatment.status,
            currentVersion: treatment.currentVersion,
            qualityFeedback: treatment.qualityFeedback ?? null,
            currentData: Object.fromEntries(
              (treatment.currentData ?? []).map(({ k, v }) => [k, v]),
            ),
          } : null,
        });
      } catch (e) { next(e); }
    },

    /**
     * GET /suggestions?field=...&prefix=...
     * Retourne les suggestions d'autocomplétion pour un champ et un préfixe.
     * Combine : suggestions apprises (seuil 20 usages), valeurs historiques, catalogue sémantique.
     */
    async suggestions(req, res, next) {
      try {
        const { field = "", prefix = "" } = req.query;
        if (!field || !prefix) return fail(res, 400, [{ field: "field/prefix", message: "Champ et préfixe requis" }]);
        const suggestions = await findFieldSuggestions(repos, field, prefix);
        return ok(res, suggestions);
      } catch (e) { next(e); }
    },

    /**
     * POST /api/v1/rules/validate
     * Exécute les règles de validation sur des valeurs SANS rien enregistrer.
     * L'enregistrement passe par /data/sync.
     * Réponse : { valid: boolean, errors: [...], meta: { count, byPriority } }
     */
    async validate(req, res, next) {
      try {
        const { values } = validateRulesBody(req.body);
        // Normalise (majuscules, sans accents) puis exécute les règles
        const errors = runRules(normalizeValues(values));
        // Trie : priorité (CRITICAL d'abord) puis ordre des champs du formulaire
        errors.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
        return ok(res, { valid: errors.length === 0, errors }, { count: errors.length, byPriority: summarize(errors) });
      } catch (e) { next(e); }
    },
  };
}