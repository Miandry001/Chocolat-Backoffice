import { ok } from "../utils/response.js";
import { listFilteredExportTreatments } from "../services/dataExportService.js";

export function makeDataExportController(repos) {
  return {
    async listSubmitted(req, res, next) {
      try {
        const treatments = await listFilteredExportTreatments(repos, req.query);
        return ok(res, {
          treatments: treatments
            .filter(({ sourceRow, currentData }) => Number.isInteger(sourceRow) && sourceRow >= 2 && Array.isArray(currentData))
            .map(({ sourceRow, status, currentData, treatmentDate, agentName }) => ({
              sourceRow,
              status,
              currentData,
              treatmentDate,
              agentName,
            })),
        });
      } catch (error) {
        return next(error);
      }
    },
  };
}
