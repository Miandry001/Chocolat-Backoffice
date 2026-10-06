import { ValidationError } from "../validators/index.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const ALLOWED_ROLES = new Set(["AGENT", "SUPERVISEUR", "ADMIN"]);

function parseDate(value, field, addDay = false) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new ValidationError([{ code: "VALIDATION_ERROR", field, message: "Date attendue au format AAAA-MM-JJ" }]);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationError([{ code: "VALIDATION_ERROR", field, message: "Date invalide" }]);
  }
  if (addDay) date.setUTCDate(date.getUTCDate() + 1);
  return new Date(date.getTime() - NAIROBI_OFFSET_MS);
}

export async function listFilteredExportTreatments(repos, filters = {}) {
  const from = parseDate(filters.from, "from");
  const to = parseDate(filters.to, "to", true);
  if (from && to && from >= to) {
    throw new ValidationError([{ code: "VALIDATION_ERROR", field: "from/to", message: "La date de début doit précéder la date de fin" }]);
  }

  const role = filters.role ?? "";
  const agent = filters.agent ?? "";
  if (role && !ALLOWED_ROLES.has(role)) {
    throw new ValidationError([{ code: "VALIDATION_ERROR", field: "role", message: "Rôle invalide" }]);
  }
  if (typeof agent !== "string" || agent.length > 120) {
    throw new ValidationError([{ code: "VALIDATION_ERROR", field: "agent", message: "Nom d’agent invalide" }]);
  }
  const normalizedAgent = agent.trim().toLocaleLowerCase("fr");

  const users = await repos.users.list();
  let actorIds;
  if (role || normalizedAgent) {
    actorIds = users.filter((user) => {
      if (role && user.role !== role) return false;
      const fullName = user.fullName
        || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
        || user.login
        || "Agent";
      return !normalizedAgent || fullName.toLocaleLowerCase("fr").includes(normalizedAgent);
    }).map(({ id }) => String(id));
  }

  const treatments = await repos.treatments.listForExport({ from, to, actorIds });
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  return treatments.map((treatment) => {
    const actorId = treatment.exportAgentId
      ?? treatment.firstSubmittedBy?.actorId
      ?? treatment.lastUpdatedBy?.actorId;
    const agent = usersById.get(String(actorId));
    const agentName = agent?.fullName
      || `${agent?.firstName ?? ""} ${agent?.lastName ?? ""}`.trim()
      || agent?.login
      || (actorId ? String(actorId) : "");
    return {
      ...treatment,
      treatmentDate: treatment.exportedAt ?? treatment.firstSubmittedAt ?? treatment.lastUpdatedAt ?? null,
      agentName,
    };
  });
}
