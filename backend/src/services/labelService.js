import LABEL_REFERENCES from "../data/labelReferences.js";

/**
 * Index de recherche rapide : Map { LABEL_UPPERCASE: labelObject }
 * Permet une lookup O(1) au lieu de O(n) à chaque calcul.
 */
const index = new Map(LABEL_REFERENCES.map(x => [x.label.trim().toUpperCase(), x]));

/**
 * Calcule les informations dérivées (biologique, équitable, écologique, végétal)
 * à partir d'une liste de labels sélectionnés.
 * @param {string[]} selectedLabels - Labels choisis par l'utilisateur
 * @returns {Object} { infoBiologique, infoEquitable, infoEcologique, infoVegetal }
 * @throws {Error} Si label(s) inconnu(s) (statusCode 400)
 */
export function calculateLabelInformation(selectedLabels = []) {
  // Cas vide : tout "NON ..."
  if (!Array.isArray(selectedLabels) || selectedLabels.length === 0) {
    return { infoBiologique: "", infoEquitable: "", infoEcologique: "", infoVegetal: "" };
  }

  // Déduplique, trim, filtre vides
  const unique = [...new Set(selectedLabels.map(v => String(v).trim()).filter(Boolean))];
  // Lookup dans l'index
  const data = unique.map(label => index.get(label.toUpperCase()));
  // Détecte les labels inconnus
  const unknown = unique.filter((label, i) => !data[i]);

  if (unknown.length) {
    const error = new Error(`Label(s) inconnu(s): ${unknown.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  // Déduit les 4 informations : true si AU MOINS UN label a la valeur positive
  return {
    infoBiologique: data.some(x => x.biologique === "BIOLOGIQUE") ? "BIOLOGIQUE" : "NON BIOLOGIQUE",
    infoEquitable: data.some(x => x.equitable === "EQUITABLE") ? "EQUITABLE" : "NON EQUITABLE",
    infoEcologique: data.some(x => x.ecologique === "ECOLOGIQUE") ? "ECOLOGIQUE" : "NON ECOLOGIQUE",
    infoVegetal: data.some(x => x.vegetal === "OUI") ? "VEGETAL" : "NON VEGETAL"
  };
}

/**
 * Retourne la liste complète des labels de référence.
 * @returns {Array} LABEL_REFERENCES
 */
export function getLabels() { return LABEL_REFERENCES; }