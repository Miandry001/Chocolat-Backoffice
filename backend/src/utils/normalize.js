/**
 * Même mise en forme que le frontend : majuscules, sans accents (le serveur ne fait pas confiance au client).
 * @param {string} s - Chaîne à formater
 * @returns {string} Chaîne en majuscules, sans accents, ligatures remplacées
 */
export const formatValue = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // Supprime les diacritiques (accents)
    .replace(/œ/gi, "oe")             // Remplace œ par oe
    .replace(/æ/gi, "ae")             // Remplace æ par ae
    .toUpperCase();

/**
 * Normalise toutes les valeurs d'un objet : applique formatValue à chaque valeur après trim().
 * Utilisé côté serveur avant validation et enregistrement.
 * @param {Object} values - Objet { champ: valeur }
 * @returns {Object} Nouvel objet avec valeurs normalisées
 */
export const normalizeValues = (values) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, formatValue(String(v ?? "").trim())]));