import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";
import { ActiveSession, AuditLog, DistributionGroup, FieldSuggestion, IdempotencyKey, Treatment, TreatmentVersion, User, ValidationResult } from "../models/index.js";

/**
 * Dépôts MongoDB avec support des transactions via AsyncLocalStorage.
 * La session de transaction est propagée implicitement : les dépôts ont la même interface que memoryRepos.
 * AsyncLocalStorage stocke la session Mongoose courante pour que tous les appels DB l'utilisent.
 */
const als = new AsyncLocalStorage();
const opts = () => (als.getStore() ? { session: als.getStore() } : {});

/**
 * Crée l'objet dépôts pour MongoDB.
 * @returns {Object} Dépôts avec méthodes : withTransaction, treatments, versions, audits, validations, statistics, idempotency, suggestions
 */
export function createMongoRepos() {
  return {
    storageMode: "mongodb",

    distributionGroups: {
      async list() {
        return DistributionGroup.find().sort({ groupStart: 1 }).lean();
      },
      async setStatus(groupStart, status, userId) {
        return DistributionGroup.findOneAndUpdate(
          { groupStart },
          { $set: { status, updatedAt: new Date(), updatedBy: userId } },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
        ).lean();
      },
    },

    users: {
      async findByLogin(login) {
        const user = await User.findOne({ login: login.trim() }).select("+passwordHash").lean();
        return user ? { ...user, id: String(user._id) } : null;
      },
      async findByLoginCandidates(login) {
        const escapedLogin = login.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const users = await User.find({ login: new RegExp(`^${escapedLogin}$`, "i") }).select("+passwordHash").lean();
        return users.map((user) => ({ ...user, id: String(user._id) }));
      },
      async findByName(firstName, lastName) {
        const escape = (value) => value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const users = await User.find({
          firstName: new RegExp(`^${escape(firstName)}$`, "i"),
          lastName: new RegExp(`^${escape(lastName)}$`, "i"),
        }).select("+passwordHash").lean();
        return users.map((user) => ({ ...user, id: String(user._id) }));
      },
      async findById(userId) {
        if (!mongoose.isValidObjectId(userId)) return null;
        const user = await User.findById(userId).lean();
        return user ? { ...user, id: String(user._id) } : null;
      },
      async list() { return (await User.find().sort({ lastName: 1, firstName: 1 }).lean()).map((user) => ({ ...user, id: String(user._id) })); },
      async create(user) {
        const created = await User.create(user);
        return { ...created.toObject(), id: String(created._id) };
      },
      async update(userId, patch) {
        if (!mongoose.isValidObjectId(userId)) return null;
        const updated = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true, runValidators: true }).lean();
        return updated ? { ...updated, id: String(updated._id) } : null;
      },
      async delete(userId) {
        if (!mongoose.isValidObjectId(userId)) return false;
        return Boolean(await User.findByIdAndDelete(userId));
      },
    },
    sessions: {
      async create(session) {
        await ActiveSession.findOneAndUpdate(
          { userId: session.userId },
          { $set: session },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      },
      async find(userId) { return ActiveSession.findOne({ userId }).lean(); },
      async delete(userId, sessionId) { await ActiveSession.deleteOne({ userId, sessionId }); },
      async deleteByUserId(userId) { await ActiveSession.deleteOne({ userId }); },
    },

    /**
     * Exécute une fonction dans une transaction MongoDB.
     * Rollback automatique si erreur.
     * @param {Function} fn - Fonction async à exécuter dans la transaction
     * @returns {*} Résultat de fn
     */
    async withTransaction(fn) {
      const session = await mongoose.startSession();
      try {
        let out;
        // Exécute fn avec la session dans le AsyncLocalStorage
        await session.withTransaction(async () => { out = await als.run(session, fn); });
        return out;
      } finally { await session.endSession(); }
    },

    /** Dépôt des traitements (état courant dénormalisé) */
    treatments: {
      /** Trouve un traitement par sourceRow (clé métier) */
      findByRow: (sourceRow) => Treatment.findOne({ sourceRow }, null, opts()).lean(),
      /** Retourne les soumissions en attente de contrôle qualité */
      listForQuality: (limit = 100, skip = 0) => Treatment.find({ status: { $in: ["SUBMITTED", "RESUBMITTED", "IN_QC"] } }, null, opts())
        .sort({ lastUpdatedAt: -1 }).skip(skip).limit(limit).lean(),
      /** Retourne les lignes envoyées et non rejetées pour l'export final */
      async listForExport({ from, to, actorIds } = {}) {
        const hasFilters = Boolean(from || to || actorIds !== undefined);
        const filter = { status: { $in: ["SUBMITTED", "IN_QC", "RESUBMITTED", "APPROVED"] } };
        if (actorIds?.length === 0) return [];

        const timestamp = {};
        if (from) timestamp.$gte = from;
        if (to) timestamp.$lt = to;
        const auditFilter = {
          action: { $in: ["SUBMITTED", "RESUBMITTED"] },
          "actor.actorType": "AGENT",
          ...(Object.keys(timestamp).length ? { timestamp } : {}),
          ...(actorIds !== undefined ? { "actor.actorId": { $in: actorIds } } : {}),
        };

        if (hasFilters) {
          const matchingAudits = await AuditLog.find(auditFilter)
            .select({ entityId: 1, actor: 1, timestamp: 1 })
            .sort({ timestamp: -1 }).lean().exec();
          if (!matchingAudits.length) return [];
          filter._id = { $in: [...new Set(matchingAudits.map(({ entityId }) => String(entityId)))] };
          const metadataById = new Map();
          for (const audit of matchingAudits) {
            const id = String(audit.entityId);
            if (!metadataById.has(id)) metadataById.set(id, { exportAgentId: audit.actor?.actorId, exportedAt: audit.timestamp });
          }
          const treatments = await Treatment.find(filter, null, opts())
            .select({ sourceRow: 1, status: 1, currentData: 1, firstSubmittedAt: 1, firstSubmittedBy: 1, lastUpdatedAt: 1, lastUpdatedBy: 1 })
            .sort({ sourceRow: 1 }).lean().exec();
          return treatments.map((treatment) => ({
            ...treatment,
            ...(metadataById.get(String(treatment._id)) ?? {}),
          }));
        }

        const treatments = await Treatment.find(filter, null, opts())
          .select({ sourceRow: 1, status: 1, currentData: 1, firstSubmittedAt: 1, firstSubmittedBy: 1, lastUpdatedAt: 1, lastUpdatedBy: 1 })
          .sort({ sourceRow: 1 }).lean().exec();
        if (!treatments.length) return [];
        const audits = await AuditLog.find({
          ...auditFilter,
          entityId: { $in: treatments.map(({ _id }) => _id) },
        }).select({ entityId: 1, actor: 1, timestamp: 1 }).sort({ timestamp: -1 }).lean().exec();
        const metadataById = new Map();
        for (const audit of audits) {
          const id = String(audit.entityId);
          if (!metadataById.has(id)) metadataById.set(id, { exportAgentId: audit.actor?.actorId, exportedAt: audit.timestamp });
        }
        return treatments.map((treatment) => ({
          ...treatment,
          ...(metadataById.get(String(treatment._id)) ?? {}),
        }));
      },
      /** Insère un nouveau traitement */
      insert: async (doc) => (await Treatment.create([doc], opts()))[0].toObject(),
      /** Met à jour un traitement par _id */
      update: (id, patch) => Treatment.updateOne({ _id: id }, { $set: patch }, opts()),
      /**
       * Recherche les valeurs d'un champ par préfixe (pour suggestions historiques).
       * Utilise une agrégation MongoDB : unwind currentData, match sur k et v (regex), group/count.
       */
      findFieldValuesByPrefix: (field, prefix) => Treatment.aggregate([
        { $unwind: "$currentData" },
        { $match: {
          "currentData.k": field,
          // Regex : préfixe au début ou après séparateur (espace, /, &)
          "currentData.v": { $regex: `(^|[ /&])${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Z]*` },
        } },
        { $group: { _id: "$currentData.v", uses: { $sum: 1 } } },
        { $sort: { uses: -1 } },
        { $limit: 1000 },
        { $project: { _id: 0, value: "$_id", uses: 1 } },
      ]).exec(),
    },

    /** Dépôt des versions (historique immuable) */
    versions: { insert: (doc) => TreatmentVersion.create([doc], opts()) },

    /** Dépôt des logs d'audit (historique immuable) */
    audits: { insertMany: (docs) => AuditLog.insertMany(docs, opts()) },

    /** Dépôt des résultats de validation */
    validations: {
      insert: (doc) => ValidationResult.create([doc], opts()),
      async findLatestByTreatmentIds(treatmentIds) {
        if (!treatmentIds.length) return [];
        return ValidationResult.aggregate([
          { $match: { treatmentId: { $in: treatmentIds } } },
          { $sort: { version: -1 } },
          { $group: { _id: "$treatmentId", errors: { $first: "$errors" }, version: { $first: "$version" } } },
        ]).exec();
      },
    },

    /** Statistiques pour le dashboard */
    statistics: {
      async getAgentPerformance({ from, to }) {
        const timestamp = {};
        if (from) timestamp.$gte = from;
        if (to) timestamp.$lt = to;
        const dateMatch = Object.keys(timestamp).length ? { timestamp } : {};
        const baseMatch = { entityType: "TREATMENT", "actor.actorType": "AGENT", ...dateMatch };
        const [submissions, corrections] = await Promise.all([
          AuditLog.aggregate([
            { $match: { ...baseMatch, action: "SUBMITTED" } },
            { $group: {
              _id: {
                actorId: "$actor.actorId",
                date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: "Africa/Nairobi" } },
              },
              validatedLines: { $sum: 1 },
            } },
            { $sort: { "_id.actorId": 1, "_id.date": 1 } },
          ]).exec(),
          AuditLog.aggregate([
            { $match: { ...baseMatch, action: "RESUBMITTED" } },
            { $group: {
              _id: {
                actorId: "$actor.actorId",
                date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: "Africa/Nairobi" } },
              },
              correctedReturns: { $sum: 1 },
            } },
          ]).exec(),
        ]);

        const agents = new Map();
        const getAgent = (actorId) => {
          if (!agents.has(actorId)) agents.set(actorId, { actorId, correctedReturns: 0, daily: new Map() });
          return agents.get(actorId);
        };
        for (const row of submissions) {
          getAgent(row._id.actorId ?? "anonymous").daily.set(row._id.date, { date: row._id.date, validatedLines: row.validatedLines, correctedReturns: 0 });
        }
        for (const row of corrections) {
          const agent = getAgent(row._id.actorId ?? "anonymous");
          agent.correctedReturns += row.correctedReturns;
          const day = agent.daily.get(row._id.date) ?? { date: row._id.date, validatedLines: 0, correctedReturns: 0 };
          day.correctedReturns = row.correctedReturns;
          agent.daily.set(row._id.date, day);
        }
        return [...agents.values()].map((agent) => ({ ...agent, daily: [...agent.daily.values()].sort((a, b) => a.date.localeCompare(b.date)) }))
          .sort((left, right) => left.actorId.localeCompare(right.actorId));
      },

      /**
       * Résumé pour la page d'accueil.
       * @param {Object} window - { yesterdayStart, todayStart } Dates UTC
       * @returns {Object} { validatedLines, returnsReceived, connectedHours, yesterdayProduction }
       */
      async getHomeSummary({ yesterdayStart, todayStart }) {
        const [validatedLines, returnsReceived, yesterdayProduction] = await Promise.all([
          // Traitements soumis ou validés (pas DRAFT, pas CORRECTION_REQUIRED)
          Treatment.countDocuments({ status: { $in: ["SUBMITTED", "IN_QC", "RESUBMITTED", "APPROVED"] } }),
          // Corrections demandées par QC
          AuditLog.countDocuments({ action: "CORRECTION_REQUESTED" }),
          // Soumissions/renvois d'hier (fuseau Nairobi)
          AuditLog.countDocuments({
            action: { $in: ["SUBMITTED", "RESUBMITTED"] },
            timestamp: { $gte: yesterdayStart, $lt: todayStart },
          }),
        ]);
        return { validatedLines, returnsReceived, connectedHours: 0, yesterdayProduction };
      },
    },

    /** Idempotence : clé → résultat (TTL 24h via index MongoDB) */
    idempotency: {
      get: async (key) => (await IdempotencyKey.findOne({ key }, null, opts()).lean())?.result,
      set: (key, result) => IdempotencyKey.updateOne({ key }, { $setOnInsert: { result } }, { upsert: true, ...opts() }),
    },

    /** Suggestions apprises par champ */
    suggestions: {
      /** Incrémente le compteur d'usage d'un mot pour un champ */
      increment: (field, word) => FieldSuggestion.findOneAndUpdate(
        { field, word },
        { $inc: { uses: 1 }, $set: { lastUsedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true, ...opts() },
      ).lean(),
      /** Trouve les suggestions pour un champ/préfixe avec seuil minimum d'usages */
      find: (field, prefix, minimumUses, limit) => FieldSuggestion.find({
        field,
        word: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` },
        uses: { $gte: minimumUses },
      }, null, opts()).sort({ uses: -1, word: 1 }).limit(limit).lean(),
    },
  };
}
