import express from "express";
import { calculateLabelInformation, getLabels } from "../services/labelService.js";
import { fail } from "../utils/response.js";

const MAX_SELECTED_LABELS = 100;
const MAX_LABEL_LENGTH = 200;

function validateSelectedLabels(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [{ field: "body", message: "Objet JSON attendu" }];
  }

  const { selectedLabels } = body;
  if (!Array.isArray(selectedLabels)) {
    return [{ field: "selectedLabels", message: "Liste de labels attendue" }];
  }
  if (selectedLabels.length > MAX_SELECTED_LABELS) {
    return [{ field: "selectedLabels", message: `${MAX_SELECTED_LABELS} labels maximum` }];
  }

  const errors = [];
  selectedLabels.forEach((label, index) => {
    if (typeof label !== "string") {
      errors.push({ field: `selectedLabels[${index}]`, message: "Texte attendu" });
    } else if (label.length > MAX_LABEL_LENGTH) {
      errors.push({ field: `selectedLabels[${index}]`, message: `${MAX_LABEL_LENGTH} caractères maximum` });
    }
  });
  return errors;
}

const router = express.Router();

/**
 * GET /api/v1/labels
 * Retourne la liste complète des labels de référence avec leurs métadonnées.
 * Réponse : { success: true, count: number, data: LABEL_REFERENCES[] }
 */
router.get("/", (_req, res) => {
  res.json({ success: true, count: getLabels().length, data: getLabels() });
});

/**
 * POST /api/v1/labels/calculate
 * Calcule les informations dérivées (biologique, équitable, écologique, végétal)
 * à partir d'une liste de labels sélectionnés.
 * Body : { selectedLabels: string[] }
 * Réponse : { success: true, data: { infoBiologique, infoEquitable, infoEcologique, infoVegetal } }
 * Erreur 400 si label(s) inconnu(s).
 */
router.post("/calculate", (req, res) => {
  const validationErrors = validateSelectedLabels(req.body);
  if (validationErrors.length) {
    return fail(res, 400, validationErrors.map((error) => ({ code: "VALIDATION_ERROR", ...error })));
  }

  try {
    const { selectedLabels } = req.body;
    const result = calculateLabelInformation(selectedLabels);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 400) {
      return fail(res, 400, [{ code: "UNKNOWN_LABEL", field: "selectedLabels", message: "Un ou plusieurs labels sont inconnus" }]);
    }
    return fail(res, 500, [{ code: "INTERNAL_ERROR", field: null, message: "Erreur interne" }]);
  }
});

export default router;
