import { ok } from "../utils/response.js";

const MAX_NOTIFICATIONS = 100;

export function makeNotificationsController(repos) {
  return {
    async list(req, res, next) {
      try {
        const notifications = await repos.notifications.listForRecipient(req.auth.id, MAX_NOTIFICATIONS);
        return ok(res, { notifications });
      } catch (error) {
        return next(error);
      }
    },
  };
}
