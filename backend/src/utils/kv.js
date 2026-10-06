/**
 * Conversion bidirectionnelle entre objet {champ: valeur} et tableau [{k, v}].
 * Le format tableau [{k, v}] est indexable par un seul index multikey MongoDB sur currentData.k / currentData.v.
 * Cela permet de filtrer efficacement : { "currentData.k": "NOM", "currentData.v": "CHOCOLAT" }
 */

/**
 * Objet → Tableau [{k, v}]
 * @param {Object} obj - Objet { champ: valeur }
 * @returns {Array} Tableau d'objets { k, v }
 */
export const toKV = (obj) => Object.entries(obj).map(([k, v]) => ({ k, v }));

/**
 * Tableau [{k, v}] → Objet {champ: valeur}
 * @param {Array} arr - Tableau d'objets { k, v }
 * @returns {Object} Objet reconstruit
 */
export const fromKV = (arr = []) => Object.fromEntries(arr.map(({ k, v }) => [k, v]));