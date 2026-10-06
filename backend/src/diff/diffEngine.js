/**
 * Normalise une valeur pour la comparaison : undefined/null → chaîne vide, sinon String().
 * @param {*} v - Valeur à normaliser
 * @returns {string}
 */
const norm = (v) => (v === undefined || v === null ? "" : String(v));

/**
 * Compare deux objets de valeurs (avant/après) et renvoie la liste des champs modifiés.
 * @param {Object} before - Valeurs avant modification
 * @param {Object} after - Valeurs après modification
 * @returns {Array} Tableau d'objets { field, oldValue, newValue } pour chaque champ changé
 */
export function diffValues(before = {}, after = {}) {
  // Union des clés des deux objets
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    // Filtre : seulement les champs dont la valeur normalisée a changé
    .filter((f) => norm(before[f]) !== norm(after[f]))
    // Mappe vers le format de changement
    .map((field) => ({ field, oldValue: norm(before[field]), newValue: norm(after[field]) }));
}