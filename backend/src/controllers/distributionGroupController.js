import { DistributionGroup } from "../models/index.js";
import { fail, ok } from "../utils/response.js";

const GROUP_SIZE = 50;
const GROUP_STATUSES = new Set(["NON ASSIGNE", "EN COURS", "SAISIE TERMINEE", "VALIDEE"]);

function isValidGroupStart(value) {
  return Number.isInteger(value) && value >= 1 && (value - 1) % GROUP_SIZE === 0;
}

export function makeDistributionGroupController(repos) {
  return {
    async list(_req, res, next) {
      try {
        const groups = await repos.distributionGroups.list();
        return ok(res, {
          groups: groups.map((group) => ({
            ...group,
            status: group.status === "VALIDE" ? "VALIDEE" : group.status,
          })),
        });
      } catch (error) {
        return next(error);
      }
    },

    async update(req, res, next) {
      const groupStart = Number(req.params.groupStart);
      if (!isValidGroupStart(groupStart)) {
        return fail(res, 400, [{ code: "VALIDATION_ERROR", field: "groupStart", message: "Début de bloc invalide." }]);
      }

      const requestedStatus = req.body?.status;
      const status = requestedStatus === "VALIDE" ? "VALIDEE" : requestedStatus;
      if (typeof status !== "string" || !GROUP_STATUSES.has(status)) {
        return fail(res, 400, [{ code: "VALIDATION_ERROR", field: "status", message: "Statut de bloc invalide." }]);
      }

      try {
        const group = await repos.distributionGroups.setStatus(groupStart, status, req.auth.id);
        return ok(res, { group });
      } catch (error) {
        return next(error);
      }
    },
  };
}
