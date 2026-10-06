import { ACTOR_TYPE, AUDIT_ACTION as A, TREATMENT_STATUS as S } from "../constants/index.js";
import { EDITABLE_FIELDS } from "../config/fields.js";
import { diffValues } from "../diff/diffEngine.js";
import { runRules } from "../rules/index.js";
import { normalizeValues } from "../utils/normalize.js";
import { toKV, fromKV } from "../utils/kv.js";

/**
 * Erreur métier du domaine (différente des erreurs de validation technique).
 * Porte un code HTTP, un code métier, un message et des détails optionnels.
 */
export class DomainError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

/**
 * Résume les erreurs pour stockage dénormalisé dans le traitement.
 * @param {Array} errors - Tableau d'erreurs
 * @returns {Object} { count, byPriority: { CRITICAL: n, HIGH: n, ... } }
 */
const summarize = (errors) => ({
  count: errors.length,
  byPriority: errors.reduce((acc, e) => ({ ...acc, [e.priority]: (acc[e.priority] ?? 0) + 1 }), {}),
});

/**
 * POST /data/sync : crée ou met à jour un traitement (identifié par sourceRow), versionne, audite, valide.
 * Tout se passe dans une transaction : traitement + version + audit + résultat de validation.
 * Idempotence : même Idempotency-Key => même réponse, sans nouvelle écriture.
 * Une soumission (submit=true) est refusée (422) si des règles échouent, comme le fait déjà le formulaire ;
 * un brouillon (submit=false) est toujours accepté et ses erreurs sont enregistrées.
 * Une ligne existante reste modifiable quel que soit son statut ; une correction soumise repart au contrôle qualité.
 *
 * @param {Object} repos - Dépôts injectés
 * @param {Object} params - Paramètres
 * @param {number} params.sourceRow - Ligne source (clé métier stable, ≥ 2)
 * @param {Object} params.values - Valeurs des champs { champ: valeur }
 * @param {boolean} params.submit - true = soumission finale, false = brouillon
 * @param {Object} params.actor - { actorId, actorType }
 * @param {string} params.idempotencyKey - Clé d'idempotence optionnelle
 * @param {Function} params.now - Fonction renvoyant la date actuelle (pour tests)
 * @returns {Object} Résultat { treatmentId, version, status, changed, errors, errorSummary, replayed? }
 */
export async function syncTreatment(repos, { sourceRow, values, submit = false, actor, idempotencyKey, now = () => new Date() }) {
  // 1. Idempotence : si clé fournie et déjà traitée, renvoie le résultat mémorisé
  if (idempotencyKey) {
    const previous = await repos.idempotency.get(idempotencyKey);
    if (previous) return { ...previous, replayed: true };
  }

  // 2. Vérifie qu'il n'y a pas de champs inconnus (protection)
  const unknown = Object.keys(values).filter((k) => !EDITABLE_FIELDS.includes(k));
  if (unknown.length) throw new DomainError(400, "UNKNOWN_FIELD", `Champs inconnus : ${unknown.join(", ")}`, unknown);

  // 3. Normalise les valeurs entrantes (majuscules, sans accents)
  const incoming = normalizeValues(values);
  const at = now();
  const who = { actorId: actor?.actorId ?? "anonymous", actorType: actor?.actorType ?? ACTOR_TYPE.AGENT };

  // 4. Tout dans une transaction (rollback auto si erreur)
  return repos.withTransaction(async () => {
    // 4a. Récupère le traitement existant par sourceRow
    const existing = await repos.treatments.findByRow(sourceRow);

    // 4b. Calcule les changements (diff) par rapport aux données actuelles
    const before = existing ? fromKV(existing.currentData) : {};
    const merged = { ...before, ...incoming };
    const changes = diffValues(before, merged);

    // 4c. Valide les règles sur l'ensemble des champs éditables (valeurs manquantes = "")
    const errors = runRules(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, merged[f] ?? ""])));

    // 4d. Si soumission et erreurs → refuse (422), rollback transaction
    if (submit && errors.length)
      throw new DomainError(422, "VALIDATION_ERROR", "Des règles ne sont pas respectées", errors);

    // 4e. Toute nouvelle soumission repart en contrôle qualité; un brouillon modifié
    // après validation/réception est rouvert pour éviter de conserver un statut validé.
    const wasReturnedForCorrection = [S.CORRECTION_REQUIRED, S.RESUBMITTED].includes(existing?.status);
    let target = existing?.status ?? S.DRAFT;
    if (submit) target = wasReturnedForCorrection ? S.RESUBMITTED : S.SUBMITTED;
    else if (existing && changes.length && ![S.DRAFT, S.CORRECTION_REQUIRED].includes(existing.status)) target = S.DRAFT;
    const statusChanged = existing ? existing.status !== target : true;

    // 4f. Si rien n'a changé (ni valeurs, ni statut) → renvoie l'existant sans nouvelle version
    if (existing && !changes.length && !statusChanged) {
      const result = { treatmentId: existing._id, version: existing.currentVersion, status: existing.status, changed: false,
        errors, errorSummary: summarize(errors) };
      if (idempotencyKey) await repos.idempotency.set(idempotencyKey, result);
      return result;
    }

    // 4g. Incrémente la version
    const version = (existing?.currentVersion ?? 0) + 1;
    const base = { entityType: "TREATMENT", actor: who, timestamp: at };
    const events = [];
    let treatment;

    // 4h. Crée ou met à jour le traitement
    if (!existing) {
      // Nouveau traitement
      treatment = await repos.treatments.insert({
        sourceRow, status: target, currentVersion: 1, currentData: toKV(merged),
        firstSubmittedAt: submit ? at : null, firstSubmittedBy: submit ? who : null, firstSubmittedData: submit ? toKV(merged) : [],
        lastUpdatedAt: at, lastUpdatedBy: who, errorSummary: summarize(errors), referenceEligible: false, createdAt: at,
      });
      events.push({ ...base, action: A.CREATED });
    } else {
      // Mise à jour existant
      const patch = { status: target, currentVersion: version, currentData: toKV(merged), lastUpdatedAt: at, lastUpdatedBy: who,
        errorSummary: summarize(errors) };
      if (submit && wasReturnedForCorrection) patch.qualityFeedback = null;
      // Si première soumission, enregistre les données de première soumission
      if (submit && !existing.firstSubmittedAt) Object.assign(patch, { firstSubmittedAt: at, firstSubmittedBy: who, firstSubmittedData: toKV(merged) });
      await repos.treatments.update(existing._id, patch);
      treatment = { ...existing, ...patch };
    }

    // 4i. Génère les événements d'audit pour chaque champ modifié
    for (const c of changes.filter((c) => existing || c.newValue !== ""))
      events.push({ ...base, action: A.FIELD_UPDATED, field: c.field, oldValue: c.oldValue, newValue: c.newValue });

    // 4j. Événement de soumission si applicable
    if (submit) events.push({ ...base, action: target === S.RESUBMITTED ? A.RESUBMITTED : A.SUBMITTED });

    // 4k. Lie les événements au traitement
    events.forEach((e) => (e.entityId = treatment._id));

    // 4l. Persiste : version, audits, validation
    await repos.versions.insert({ treatmentId: treatment._id, version, data: toKV(merged), changes, status: target, author: who, createdAt: at });
    await repos.audits.insertMany(events);
    await repos.validations.insert({ treatmentId: treatment._id, version, errors, createdAt: at });

    // 4m. Résultat final
    const result = { treatmentId: treatment._id, version, status: target, changed: true, errors, errorSummary: summarize(errors) };
    if (idempotencyKey) await repos.idempotency.set(idempotencyKey, result);
    return result;
  });
}