/**
 * Dépôts en mémoire : mêmes méthodes que les dépôts MongoDB.
 * Servent aux tests unitaires de la logique métier, sans base de données.
 * Utilise des tableaux JS simples et structuredClone pour l'isolation.
 */
export function createMemoryRepos({ users: initialUsers = [] } = {}) {
  // Stockage en mémoire
  const db = { treatments: [], versions: [], audits: [], validations: [], distributionGroups: new Map(), idem: new Map(), suggestions: new Map(), users: new Map(), sessions: new Map() };
  let seq = 0;
  const id = () => `mem_${++seq}`;
  const clone = (o) => (o ? structuredClone(o) : o);
  for (const user of initialUsers) db.users.set(String(user.id), clone({ ...user, id: String(user.id) }));

  return {
    storageMode: "memory",
    _db: db, // Expose pour les tests (inspection directe)

    distributionGroups: {
      async list() { return [...db.distributionGroups.values()].sort((left, right) => left.groupStart - right.groupStart).map(clone); },
      async setStatus(groupStart, status, userId) {
        const group = { groupStart, status, updatedAt: new Date(), updatedBy: String(userId) };
        db.distributionGroups.set(groupStart, group);
        return clone(group);
      },
    },

    users: {
      async findByLogin(login) { return clone([...db.users.values()].find((user) => user.login.toLowerCase() === login.toLowerCase())); },
      async findByLoginCandidates(login) { return clone([...db.users.values()].filter((user) => user.login.toLowerCase() === login.toLowerCase())); },
      async findByName(firstName, lastName) {
        const normalizedFirstName = firstName.trim().toLowerCase();
        const normalizedLastName = lastName.trim().toLowerCase();
        return clone([...db.users.values()].filter((user) => user.firstName.trim().toLowerCase() === normalizedFirstName
          && user.lastName.trim().toLowerCase() === normalizedLastName));
      },
      async findById(userId) { return clone(db.users.get(String(userId))); },
      async list() { return [...db.users.values()].map(clone); },
      async create(user) {
        const next = { ...clone(user), id: user.id ? String(user.id) : id() };
        db.users.set(next.id, next);
        return clone(next);
      },
      async update(userId, patch) {
        const current = db.users.get(String(userId));
        if (!current) return null;
        Object.assign(current, clone(patch));
        return clone(current);
      },
      async delete(userId) { return db.users.delete(String(userId)); },
    },
    sessions: {
      async create(session) { db.sessions.set(String(session.userId), clone(session)); },
      async find(userId) { return clone(db.sessions.get(String(userId))); },
      async delete(userId, sessionId) {
        const current = db.sessions.get(String(userId));
        if (current?.sessionId === sessionId) db.sessions.delete(String(userId));
      },
      async deleteByUserId(userId) { db.sessions.delete(String(userId)); },
    },

    /**
     * Simule une transaction : snapshot avant, rollback si erreur.
     * @param {Function} fn - Fonction à exécuter
     * @returns {*} Résultat de fn
     */
    async withTransaction(fn) {
      const snapshot = structuredClone({ ...db, idem: [...db.idem] });
      try { return await fn(); }
      catch (e) { // Rollback sur erreur
        Object.assign(db, { treatments: snapshot.treatments, versions: snapshot.versions, audits: snapshot.audits,
          validations: snapshot.validations, idem: new Map(snapshot.idem) });
        throw e;
      }
    },

    /** Dépôt traitements */
    treatments: {
      /** Trouve par sourceRow */
      async findByRow(sourceRow) { return clone(db.treatments.find((t) => t.sourceRow === sourceRow)); },
      async listForQuality(limit = 100, skip = 0) {
        const statuses = new Set(["SUBMITTED", "RESUBMITTED", "IN_QC"]);
        return db.treatments.filter(({ status }) => statuses.has(status))
          .sort((left, right) => new Date(right.lastUpdatedAt ?? 0) - new Date(left.lastUpdatedAt ?? 0))
          .slice(skip, skip + limit).map(clone);
      },
      async listForExport({ from, to, actorIds } = {}) {
        const statuses = new Set(["SUBMITTED", "IN_QC", "RESUBMITTED", "APPROVED"]);
        const hasFilters = Boolean(from || to || actorIds !== undefined);
        const eligibleAudits = db.audits.filter(({ entityType, action, actor, timestamp }) => {
          if (entityType && entityType !== "TREATMENT") return false;
          if (!["SUBMITTED", "RESUBMITTED"].includes(action) || actor?.actorType !== "AGENT") return false;
          const submittedAt = new Date(timestamp);
          return (!hasFilters || (!from || submittedAt >= from)
            && (!to || submittedAt < to)
            && (actorIds === undefined || actorIds.includes(String(actor.actorId))));
        });
        const auditsByTreatment = new Map();
        for (const audit of eligibleAudits.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))) {
          const id = String(audit.entityId);
          if (!auditsByTreatment.has(id)) {
            auditsByTreatment.set(id, { exportAgentId: audit.actor.actorId, exportedAt: audit.timestamp });
          }
        }
        const eligibleTreatmentIds = hasFilters
          ? new Set(auditsByTreatment.keys())
          : null;
        return db.treatments.filter(({ _id, status }) => statuses.has(status)
          && (!eligibleTreatmentIds || eligibleTreatmentIds.has(String(_id))))
          .sort((left, right) => left.sourceRow - right.sourceRow)
          .map((treatment) => ({
            ...clone(treatment),
            ...(auditsByTreatment.get(String(treatment._id)) ?? {}),
          }));
      },
      /** Insère un traitement */
      async insert(doc) { const d = { ...clone(doc), _id: id() }; db.treatments.push(d); return clone(d); },
      /** Met à jour par _id */
      async update(_id, patch) { Object.assign(db.treatments.find((t) => t._id === _id), clone(patch)); },
      /**
       * Recherche valeurs historiques par préfixe (pour suggestions).
       * Parcourt tous les traitements, extrait la valeur du champ, décompose en mots, compte.
       */
      async findFieldValuesByPrefix(field, prefix) {
        const counts = new Map();
        for (const treatment of db.treatments) {
          const value = treatment.currentData?.find((entry) => entry.k === field)?.v ?? "";
          const words = String(value).match(/[A-Z]+/g) ?? [];
          if (!words.some((word) => word.startsWith(prefix))) continue;
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts].map(([value, uses]) => ({ value, uses }));
      },
    },

    /** Dépôt versions */
    versions: { async insert(doc) { db.versions.push({ ...clone(doc), _id: id() }); } },

    /** Dépôt audits */
    audits: { async insertMany(docs) { docs.forEach((d) => db.audits.push({ ...clone(d), _id: id() })); } },

    /** Dépôt validations */
    validations: {
      async insert(doc) { db.validations.push({ ...clone(doc), _id: id() }); },
      async findLatestByTreatmentIds(treatmentIds) {
        const ids = new Set(treatmentIds.map(String));
        const latest = new Map();
        for (const validation of db.validations) {
          const key = String(validation.treatmentId);
          if (!ids.has(key) || validation.version < (latest.get(key)?.version ?? -1)) continue;
          latest.set(key, clone(validation));
        }
        return [...latest.values()];
      },
    },

    /** Statistiques */
    statistics: {
      async getAgentPerformance({ from, to }) {
        const inRange = (timestamp) => {
          const date = new Date(timestamp);
          return (!from || date >= from) && (!to || date < to);
        };
        const dateInNairobi = (timestamp) => new Date(new Date(timestamp).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const agents = new Map();
        const getAgent = (actorId) => {
          if (!agents.has(actorId)) agents.set(actorId, { actorId, correctedReturns: 0, daily: {}, correctionsDaily: {} });
          return agents.get(actorId);
        };

        for (const audit of db.audits) {
          if (audit.actor?.actorType !== "AGENT" || !inRange(audit.timestamp)) continue;
          const actorId = audit.actor.actorId ?? "anonymous";
          if (audit.action === "SUBMITTED") {
            const agent = getAgent(actorId);
            const date = dateInNairobi(audit.timestamp);
            agent.daily[date] = (agent.daily[date] ?? 0) + 1;
          } else if (audit.action === "RESUBMITTED") {
            const agent = getAgent(actorId);
            const date = dateInNairobi(audit.timestamp);
            agent.correctedReturns += 1;
            agent.correctionsDaily[date] = (agent.correctionsDaily[date] ?? 0) + 1;
          }
        }

        return [...agents.values()].map((agent) => ({
          ...agent,
          daily: [...new Set([...Object.keys(agent.daily), ...Object.keys(agent.correctionsDaily)])].map((date) => ({ date, validatedLines: agent.daily[date] ?? 0, correctedReturns: agent.correctionsDaily[date] ?? 0 }))
            .sort((left, right) => left.date.localeCompare(right.date)),
        })).sort((left, right) => left.actorId.localeCompare(right.actorId));
      },

      async getHomeSummary({ yesterdayStart, todayStart }) {
        const validatedStatuses = new Set(["SUBMITTED", "IN_QC", "RESUBMITTED", "APPROVED"]);
        const submittedActions = new Set(["SUBMITTED", "RESUBMITTED"]);
        return {
          validatedLines: db.treatments.filter(({ status }) => validatedStatuses.has(status)).length,
          returnsReceived: db.audits.filter(({ action }) => action === "CORRECTION_REQUESTED").length,
          connectedHours: 0,
          yesterdayProduction: db.audits.filter(({ action, timestamp }) => {
            const time = new Date(timestamp);
            return submittedActions.has(action) && time >= yesterdayStart && time < todayStart;
          }).length,
        };
      },
    },

    /** Idempotence en Map */
    idempotency: {
      async get(key) { return clone(db.idem.get(key)); },
      async set(key, result) { db.idem.set(key, clone(result)); },
    },

    /** Suggestions en Map (clé = "champ\0mot") */
    suggestions: {
      async increment(field, word) {
        const key = `${field}\u0000${word}`;
        const current = db.suggestions.get(key) ?? { field, word, uses: 0 };
        const next = { ...current, uses: current.uses + 1, lastUsedAt: new Date().toISOString() };
        db.suggestions.set(key, next);
        return clone(next);
      },
      async find(field, prefix, minimumUses, limit) {
        return [...db.suggestions.values()]
          .filter((entry) => entry.field === field && entry.word.startsWith(prefix) && entry.uses >= minimumUses)
          .sort((left, right) => right.uses - left.uses || left.word.localeCompare(right.word))
          .slice(0, limit)
          .map(clone);
      },
    },
  };
}
