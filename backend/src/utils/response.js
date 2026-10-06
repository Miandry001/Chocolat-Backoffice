/**
 * Réponse HTTP standardisée pour les succès.
 * Format : { success: true, data, errors: [], meta }
 * @param {Response} res - Objet réponse Express
 * @param {*} data - Données à retourner
 * @param {Object} meta - Métadonnées additionnelles (ex: replayed, count)
 * @param {number} status - Code HTTP (défaut 200)
 * @returns {Response} Réponse Express chainée
 */
export const ok = (res, data, meta = {}, status = 200) =>
  res.status(status).json({ success: true, data, errors: [], meta });

/**
 * Réponse HTTP standardisée pour les erreurs.
 * Format : { success: false, data: null, errors: [...], meta }
 * @param {Response} res - Objet réponse Express
 * @param {number} status - Code HTTP d'erreur
 * @param {Array} errors - Tableau d'objets erreur { code, field, message, priority? }
 * @param {Object} meta - Métadonnées additionnelles
 * @returns {Response} Réponse Express chainée
 */
export const fail = (res, status, errors, meta = {}) =>
  res.status(status).json({ success: false, data: null, errors, meta });