import mongoose from "mongoose";
import { ACTOR_TYPE, AUDIT_ACTION, PRIORITY, TREATMENT_STATUS } from "../constants/index.js";

const { Schema } = mongoose;

/**
 * Schéma pour l'acteur (embeddé dans plusieurs documents).
 * actorId : identifiant (ex: "agent1", "demo-seed")
 * actorType : enum ACTOR_TYPE (AGENT, QC, ADMIN, SYSTEM)
 */
const actor = new Schema({
  actorId: { type: String, required: true },
  actorType: { type: String, enum: Object.values(ACTOR_TYPE), required: true }
}, { _id: false });

/**
 * Schéma clé-valeur pour currentData, firstSubmittedData, data (versions).
 * Format : [{ k: "NOM", v: "CHOCOLAT" }, ...]
 * Permet un index multikey unique sur currentData.k + currentData.v pour filtrer efficacement.
 */
const kv = new Schema({ k: { type: String, required: true }, v: { type: String, default: "" } }, { _id: false });

/**
 * Schéma principal : Treatment (état courant dénormalisé).
 * Un document par sourceRow (ligne du fichier source).
 * Contient l'état courant, les données courantes, et des champs dénormalisés
 * pour éviter de relire versions/audits pour les listes.
 */
const treatmentSchema = new Schema({
  /** Clé métier stable : numéro de ligne dans le fichier source (1 = en-têtes, donc ≥ 2) */
  sourceRow: { type: Number, required: true, unique: true, min: 2 },
  /** Statut du workflow */
  status: { type: String, enum: Object.values(TREATMENT_STATUS), required: true, index: true },
  /** Version courante (incrémentée à chaque modification) */
  currentVersion: { type: Number, required: true },
  /** Données courantes : tableau [{k, v}] */
  currentData: [kv],
  /** Données de la première soumission (figées) */
  firstSubmittedAt: Date, firstSubmittedBy: actor, firstSubmittedData: [kv],
  /** Dernière mise à jour */
  lastUpdatedAt: { type: Date, required: true }, lastUpdatedBy: actor,
  /** Résumé d'erreurs dénormalisé pour affichage rapide dans les listes */
  errorSummary: { count: Number, byPriority: { type: Map, of: Number } },
  /** Dernier retour QC affiché à l'agent jusqu'à la prochaine resoumission */
  qualityFeedback: {
    message: { type: String, maxlength: 2000 },
    createdAt: Date,
    createdBy: actor,
  },
  /** Éligible comme référence (futur) */
  referenceEligible: { type: Boolean, default: false },
}, { timestamps: { createdAt: "createdAt", updatedAt: false } });

// Index pour les requêtes fréquentes (QC, listes, filtres)
treatmentSchema.index({ status: 1, lastUpdatedAt: -1 });                    // Liste par statut + date
treatmentSchema.index({ "lastUpdatedBy.actorId": 1, lastUpdatedAt: -1 });    // Par agent
treatmentSchema.index({ "currentData.k": 1, "currentData.v": 1 });           // Filtre par valeur de champ

/**
 * Schéma TreatmentVersion (historique immuable).
 * Une entrée par version d'un traitement.
 */
const versionSchema = new Schema({
  treatmentId: { type: Schema.Types.ObjectId, ref: "Treatment", required: true },
  version: { type: Number, required: true },
  data: [kv], // Snapshot complet des données à cette version
  changes: [{ _id: false, field: String, oldValue: String, newValue: String }], // Diff de cette version
  status: String, // Statut à cette version
  author: actor,
  createdAt: { type: Date, default: Date.now },
});
// Unicité : une seule version N par traitement
versionSchema.index({ treatmentId: 1, version: -1 }, { unique: true });

/**
 * Schéma AuditLog (historique immuable des actions).
 * Traçabilité complète : qui a fait quoi, quand, sur quel champ, ancienne/nouvelle valeur.
 */
const auditSchema = new Schema({
  entityType: { type: String, required: true }, // "TREATMENT"
  entityId: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, enum: Object.values(AUDIT_ACTION), required: true },
  field: String, // Pour FIELD_UPDATED
  oldValue: String, newValue: String,
  actor,
  timestamp: { type: Date, default: Date.now },
});
// Historique d'un traitement
auditSchema.index({ entityId: 1, timestamp: -1 });
// « Qui a fait quoi »
auditSchema.index({ "actor.actorId": 1, timestamp: -1 });
auditSchema.index({ action: 1, timestamp: 1, "actor.actorId": 1 });
// Filtre par champ (sparse car pas tous les audits ont un champ)
auditSchema.index({ field: 1, timestamp: -1 }, { sparse: true });

/**
 * Schéma ValidationResult (erreurs de règles par version).
 */
const validationSchema = new Schema({
  treatmentId: { type: Schema.Types.ObjectId, required: true },
  version: Number,
  errors: [{
    _id: false,
    ruleId: String,        // ex: "NOM:required"
    code: String,          // ex: "REQUIRED_FIELD"
    errorType: String,     // alias de code
    field: String,
    priority: { type: String, enum: Object.values(PRIORITY) },
    message: String,
  }],
  createdAt: { type: Date, default: Date.now },
});
validationSchema.index({ treatmentId: 1, version: -1 });
// Filtre QC par type/priorité d'erreur
validationSchema.index({ "errors.errorType": 1, "errors.priority": 1 });

/**
 * Schéma IdempotencyKey (clé → résultat, TTL 24h).
 * Permet la réentrance sûre des requêtes POST /data/sync.
 */
const idempotencySchema = new Schema({
  key: { type: String, unique: true },
  result: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, expires: 86400 }, // TTL 24h
});

/**
 * Schéma FieldSuggestion (apprentissage suggestions par champ).
 * Compte les usages de chaque mot par champ.
 */
const fieldSuggestionSchema = new Schema({
  field: { type: String, required: true },
  word: { type: String, required: true },
  uses: { type: Number, default: 0, min: 0 },
  lastUsedAt: { type: Date, default: Date.now },
});
fieldSuggestionSchema.index({ field: 1, word: 1 }, { unique: true });
fieldSuggestionSchema.index({ field: 1, word: 1, uses: -1 });

const userSchema = new Schema({
  login: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  passwordHash: { type: String, required: true, select: false },
  firstName: { type: String, required: true, maxlength: 100 },
  lastName: { type: String, required: true, maxlength: 100 },
  fullName: { type: String, required: true, maxlength: 201 },
  role: { type: String, enum: ["AGENT", "SUPERVISEUR", "ADMIN"], required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });
userSchema.index({ login: 1 });

const activeSessionSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  sessionId: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });

const distributionGroupSchema = new Schema({
  groupStart: { type: Number, required: true, unique: true, min: 1 },
  status: { type: String, enum: ["NON ASSIGNE", "EN COURS", "SAISIE TERMINEE", "VALIDEE"], required: true },
  updatedAt: { type: Date, required: true },
  updatedBy: { type: String, required: true },
});

// Export des modèles Mongoose
export const Treatment = mongoose.model("Treatment", treatmentSchema);
export const TreatmentVersion = mongoose.model("TreatmentVersion", versionSchema);
export const AuditLog = mongoose.model("AuditLog", auditSchema);
export const ValidationResult = mongoose.model("ValidationResult", validationSchema);
export const IdempotencyKey = mongoose.model("IdempotencyKey", idempotencySchema);
export const FieldSuggestion = mongoose.model("FieldSuggestion", fieldSuggestionSchema);
export const User = mongoose.model("User", userSchema);
export const ActiveSession = mongoose.model("ActiveSession", activeSessionSchema);
export const DistributionGroup = mongoose.model("DistributionGroup", distributionGroupSchema);
