import { ValidationError } from "../validators/index.js";
import { ok } from "../utils/response.js";

/**
 * Constantes pour le calcul de la fenêtre "hier" en fuseau Africa/Nairobi (UTC+3).
 * Utilisé pour les statistiques de production J-1.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, field, addDay = false) {
  if (value == null || value === "") return undefined;
  if (!DATE_RE.test(value)) throw new ValidationError([{ code: "VALIDATION_ERROR", field, message: "Date attendue au format AAAA-MM-JJ" }]);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationError([{ code: "VALIDATION_ERROR", field, message: "Date invalide" }]);
  }
  if (addDay) date.setUTCDate(date.getUTCDate() + 1);
  return new Date(date.getTime() - NAIROBI_OFFSET_MS);
}

function summarizeAgent(agent) {
  const correctionDays = Array.isArray(agent.correctionsDaily) ? agent.correctionsDaily : [];
  const correctionsByDay = new Map(correctionDays.map(({ date, correctedReturns }) => [date, correctedReturns]));
  const days = agent.daily.map((day) => ({ ...day, correctedReturns: day.correctedReturns ?? correctionsByDay.get(day.date) ?? 0 }));
  const validatedLines = days.reduce((sum, day) => sum + day.validatedLines, 0);
  const productiveDays = days.filter((day) => day.validatedLines > 0);
  const activeDays = productiveDays.length;
  const rankedDays = [...productiveDays].sort((left, right) => left.validatedLines - right.validatedLines || left.date.localeCompare(right.date));
  return {
    actorId: agent.actorId,
    validatedLines,
    correctedReturns: agent.correctedReturns,
    qualityPercent: validatedLines === 0 ? null : Math.max(0, Math.round(((validatedLines - agent.correctedReturns) / validatedLines) * 100)),
    averageDailyProductivity: activeDays ? Number((validatedLines / activeDays).toFixed(1)) : 0,
    lowestDay: rankedDays[0] ?? null,
    bestDay: rankedDays.at(-1) ?? null,
    daily: days,
  };
}

/**
 * Calcule la fenêtre temporelle "hier" dans le fuseau Africa/Nairobi.
 * @param {Date} now - Date de référence (défaut: maintenant)
 * @returns {Object} { yesterdayStart: Date, todayStart: Date } en UTC
 */
function yesterdayWindow(now = new Date()) {
  // Formate la date dans le fuseau Africa/Nairobi pour obtenir les composantes année/mois/jour
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const date = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  // Début d'aujourd'hui à minuit Nairobi, converti en UTC
  const todayStart = new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day)) - NAIROBI_OFFSET_MS);
  // Début d'hier = aujourd'hui - 1 jour
  return { yesterdayStart: new Date(todayStart.getTime() - DAY_MS), todayStart };
}

/**
 * Crée le contrôleur de statistiques.
 * @param {Object} repos - Dépôts (statistics)
 * @returns {Object} Contrôleur avec méthode summary
 */
export function makeStatsController(repos) {
  return {
    async agents(req, res, next) {
      try {
        const from = parseDate(req.query?.from, "from");
        const to = parseDate(req.query?.to, "to", true);
        if (from && to && from >= to) {
          throw new ValidationError([{ code: "VALIDATION_ERROR", field: "from/to", message: "La date de début doit précéder la date de fin" }]);
        }
        let performance = await repos.statistics.getAgentPerformance({ from, to });
        if (req.auth.role === "AGENT") performance = performance.filter((agent) => String(agent.actorId) === String(req.auth.id));
        return ok(res, { agents: performance.map(summarizeAgent) });
      } catch (error) {
        return next(error);
      }
    },

    /**
     * GET /api/v1/stats/summary
     * Retourne les KPIs du dashboard :
     * - validatedLines : nombre de traitements soumis/validés
     * - returnsReceived : nombre de corrections demandées (CORRECTION_REQUESTED)
     * - connectedHours : placeholder (0 pour l'instant)
     * - yesterdayProduction : soumissions/renvois d'hier (fuseau Nairobi)
     */
    async summary(req, res, next) {
      try {
        if (req.auth.role === "AGENT") {
          const { yesterdayStart } = yesterdayWindow();
          const yesterday = new Date(yesterdayStart.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
          const agents = await repos.statistics.getAgentPerformance({});
          const own = agents.find((agent) => String(agent.actorId) === String(req.auth.id));
          return ok(res, {
            validatedLines: own?.daily.reduce((sum, day) => sum + day.validatedLines, 0) ?? 0,
            returnsReceived: own?.correctedReturns ?? 0,
            connectedHours: 0,
            yesterdayProduction: own?.daily.find((day) => day.date === yesterday)?.validatedLines ?? 0,
          });
        }
        return ok(res, await repos.statistics.getHomeSummary(yesterdayWindow()));
      } catch (error) {
        return next(error);
      }
    },
  };
}
