// Logs techniques (JSON, une ligne par événement). Distincts de l'audit métier (collection audit_logs).
/**
 * Niveaux de log et leur priorité numérique.
 * Plus le nombre est petit, plus le niveau est prioritaire.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Niveau minimum à logger selon la variable d'environnement LOG_LEVEL.
 * Par défaut : info (20).
 * @returns {number} Seuil numérique
 */
const min = () => LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

/**
 * Regex pour détecter les clés sensibles à ne pas logger (tokens, mots de passe, secrets).
 */
const SENSITIVE = /authorization|password|token|secret/i;

/**
 * Écrit une ligne de log JSON sur stdout si le niveau est suffisant.
 * Filtre les clés sensibles du contexte.
 * @param {string} level - Niveau (debug, info, warn, error)
 * @param {string} msg - Message court
 * @param {Object} ctx - Contexte additionnel (sera filtré)
 */
const write = (level, msg, ctx = {}) => {
  if (LEVELS[level] < min()) return;
  // Supprime les clés sensibles du contexte
  const safe = Object.fromEntries(Object.entries(ctx).filter(([k]) => !SENSITIVE.test(k)));
  process.stdout.write(JSON.stringify({ level, time: new Date().toISOString(), msg, ...safe }) + "\n");
};

/**
 * Logger avec méthodes debug, info, warn, error.
 * Usage : logger.info("message", { key: "value" })
 */
export const logger = Object.fromEntries(Object.keys(LEVELS).map((l) => [l, (msg, ctx) => write(l, msg, ctx)]));