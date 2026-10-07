import { ACTOR_TYPE, TREATMENT_STATUS } from "../constants/index.js";
import { ok, fail } from "../utils/response.js";
import { distributionLinePath } from "../utils/distributionLine.js";

const MAX_FEEDBACK_LENGTH = 2000;
const PAGE_SIZE = 100;

const valuesFromKV = (entries = []) => Object.fromEntries(entries.map(({ k, v }) => [k, v]));

function toQueueItem(treatment, validation) {
  return {
    sourceRow: treatment.sourceRow,
    status: treatment.status,
    currentVersion: treatment.currentVersion,
    currentData: valuesFromKV(treatment.currentData),
    lastUpdatedAt: treatment.lastUpdatedAt,
    lastUpdatedBy: treatment.lastUpdatedBy,
    qualityFeedback: treatment.qualityFeedback ?? null,
    errors: validation?.errors ?? [],
  };
}

export function makeQualityController(repos) {
  return {
    async list(req, res, next) {
      try {
        const page = Number(req.query?.page ?? 0);
        if (!Number.isInteger(page) || page < 0 || page > 10_000) {
          return fail(res, 400, [{ code: "VALIDATION_ERROR", field: "page", message: "Numéro de page invalide." }]);
        }
        const pageItems = await repos.treatments.listForQuality(PAGE_SIZE + 1, page * PAGE_SIZE);
        const hasMore = pageItems.length > PAGE_SIZE;
        const treatments = pageItems.slice(0, PAGE_SIZE);
        const validations = await repos.validations.findLatestByTreatmentIds(treatments.map(({ _id }) => _id));
        const validationByTreatment = new Map(validations.map((entry) => [String(entry.treatmentId ?? entry._id), entry]));
        return ok(res, {
          page,
          hasMore,
          treatments: treatments.map((treatment) => toQueueItem(
            treatment,
            validationByTreatment.get(String(treatment._id)),
          )),
        });
      } catch (error) {
        return next(error);
      }
    },

    async returnForCorrection(req, res, next) {
      const message = req.body?.message;
      if (typeof message !== "string" || !message.trim() || message.trim().length > MAX_FEEDBACK_LENGTH) {
        return fail(res, 400, [{
          code: "VALIDATION_ERROR",
          field: "message",
          message: `Un retour est requis (maximum ${MAX_FEEDBACK_LENGTH} caractères).`,
        }]);
      }

      const sourceRow = Number(req.params.sourceRow);
      if (!Number.isInteger(sourceRow) || sourceRow < 2 || sourceRow > 1_000_000) {
        return fail(res, 400, [{
          code: "VALIDATION_ERROR",
          field: "sourceRow",
          message: "Entier ≥ 2 attendu.",
        }]);
      }

      try {
        const result = await repos.withTransaction(async () => {
          const treatment = await repos.treatments.findByRow(sourceRow);
          if (!treatment) return { status: 404 };
          if (!["SUBMITTED", "RESUBMITTED", "IN_QC"].includes(treatment.status)) {
            return { status: 409 };
          }

          const timestamp = new Date();
          const actor = { actorId: req.auth.id, actorType: req.auth.role === "ADMIN" ? ACTOR_TYPE.ADMIN : ACTOR_TYPE.QC };
          const feedback = { message: message.trim(), createdAt: timestamp, createdBy: actor };
          const agentId = treatment.lastUpdatedBy?.actorId;
          await repos.treatments.update(treatment._id, {
            status: TREATMENT_STATUS.CORRECTION_REQUIRED,
            qualityFeedback: feedback,
            lastUpdatedAt: timestamp,
          });
          if (treatment.lastUpdatedBy?.actorType === ACTOR_TYPE.AGENT && agentId) {
            await repos.notifications.insert({
              recipientId: String(agentId),
              treatmentId: treatment._id,
              type: "CORRECTION_REQUESTED",
              text: `Retour du contrôle qualité — Ligne ${sourceRow - 1}`,
              message: feedback.message,
              link: distributionLinePath(sourceRow),
              date: timestamp,
            });
          }
          await repos.audits.insertMany([
            {
              entityType: "TREATMENT",
              entityId: treatment._id,
              action: "COMMENT_ADDED",
              field: "qualityFeedback",
              newValue: feedback.message,
              actor,
              timestamp,
            },
            {
              entityType: "TREATMENT",
              entityId: treatment._id,
              action: "CORRECTION_REQUESTED",
              actor,
              timestamp,
            },
          ]);
          return { status: 200, sourceRow, statusAfterReturn: TREATMENT_STATUS.CORRECTION_REQUIRED };
        });

        if (result.status === 404) {
          return fail(res, 404, [{ code: "TREATMENT_NOT_FOUND", field: "sourceRow", message: "Traitement introuvable." }]);
        }
        if (result.status === 409) {
          return fail(res, 409, [{ code: "TREATMENT_NOT_PENDING_QC", field: "sourceRow", message: "Ce traitement n’est plus en attente de contrôle qualité." }]);
        }
        return ok(res, result);
      } catch (error) {
        return next(error);
      }
    },
  };
}
