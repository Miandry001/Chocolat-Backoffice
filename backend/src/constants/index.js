const freeze = (o) => Object.freeze(o);
/**
 * Crée un objet immuable où chaque clé a pour valeur son propre nom.
 * Exemple : enumOf("A", "B") => { A: "A", B: "B" }
 * Cela permet d'écrire TREATMENT_STATUS.DRAFT au lieu de chaînes magiques.
 */
const enumOf = (...keys) => freeze(Object.fromEntries(keys.map((k) => [k, k])));

/**
 * États possibles d'un traitement (workflow Agent → Contrôle Qualité).
 * - DRAFT : Brouillon, modifiable par l'agent
 * - SUBMITTÉ : Envoyé par l'agent, en attente de prise en charge QC
 * - IN_QC : En cours de contrôle qualité
 * - CORRECTION_REQUIRED : QC demande des corrections à l'agent
 * - RESUBMITTED : Agent a corrigé et renvoyé
 * - APPROVED : Validé par QC
 * - REJECTED : Rejeté par QC
 */
export const TREATMENT_STATUS = enumOf(
  "DRAFT", "SUBMITTED", "IN_QC", "CORRECTION_REQUIRED", "RESUBMITTED", "APPROVED", "REJECTED"
);

/**
 * Transitions autorisées du workflow (source unique de vérité).
 * Seules ces transitions sont valides ; toute autre sera refusée (409).
 * Note : DRAFT ne peut aller qu'à SUBMITTED (pas directement à IN_QC).
 * APPROVED et REJECTED sont des états terminaux (pas de transition sortante).
 */
export const STATUS_TRANSITIONS = freeze({
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["IN_QC"],
  IN_QC: ["CORRECTION_REQUIRED", "APPROVED", "REJECTED"],
  CORRECTION_REQUIRED: ["RESUBMITTED"],
  RESUBMITTED: ["IN_QC"],
  APPROVED: [],
  REJECTED: [],
});

/**
 * Vérifie si une transition d'état est autorisée.
 * @param {string} from - État actuel
 * @param {string} to - État cible
 * @returns {boolean} true si la transition est autorisée
 */
export const canTransition = (from, to) => (STATUS_TRANSITIONS[from] ?? []).includes(to);

/**
 * Niveaux de priorité des erreurs de validation.
 * CRITICAL = bloquant (ex: NOM vide)
 * HIGH = important (ex: format invalide)
 * MEDIUM = modéré (ex: valeur hors limites)
 * LOW = informationnel
 */
export const PRIORITY = enumOf("CRITICAL", "HIGH", "MEDIUM", "LOW");

/**
 * Rang numérique pour le tri : plus petit = plus urgent.
 * Utilisé pour trier les erreurs : CRITICAL d'abord, puis HIGH, etc.
 */
export const PRIORITY_RANK = freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 });

/**
 * Types d'erreurs de validation possibles.
 * - REQUIRED_FIELD : champ obligatoire manquant
 * - INVALID_FORMAT : format incorrect (ex: nombre attendu)
 * - INVALID_VALUE : valeur non autorisée (ex: hors liste oneOf)
 * - BUSINESS_RULE : règle métier complexe (future)
 * - DUPLICATE : doublon détecté (future)
 * - INCONSISTENCY : incohérence entre champs (future)
 */
export const ERROR_TYPE = enumOf(
  "REQUIRED_FIELD", "INVALID_FORMAT", "INVALID_VALUE", "BUSINESS_RULE", "DUPLICATE", "INCONSISTENCY"
);

/**
 * Types d'acteurs qui peuvent effectuer des actions.
 * AGENT = saisisseur, QC = contrôleur qualité, ADMIN = administrateur, SYSTEM = automatisme
 */
export const ACTOR_TYPE = enumOf("AGENT", "QC", "ADMIN", "SYSTEM");

/**
 * Actions d'audit traçables (historique immuable).
 * Chaque action crée une entrée dans la collection audit_logs.
 */
export const AUDIT_ACTION = enumOf(
  "CREATED", "SUBMITTED", "FIELD_UPDATED", "QC_REVIEW_STARTED", "COMMENT_ADDED",
  "CORRECTION_REQUESTED", "RESUBMITTED", "APPROVED", "REJECTED",
  "SUGGESTION_CREATED", "SUGGESTION_ACCEPTED", "SUGGESTION_MODIFIED", "SUGGESTION_REJECTED"
);