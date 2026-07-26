import { logAction } from '../lib/auditService.js';

// Attaches req.logAudit(...) so route handlers don't have to thread the
// current user's id/email through every call site — just the fields that
// vary per action (entity type/id/name, old/new values).
export function auditContext(req, res, next) {
  req.logAudit = (fields) =>
    logAction({
      userId: req.user?.id ?? null,
      userEmail: req.user?.email ?? 'unknown',
      organizationId: req.user?.organizationId ?? null,
      ...fields,
    });
  next();
}
