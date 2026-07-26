// Role hierarchy, highest privilege first. Three tiers per the TAS Client
// Portal spec (CLAUDE.md's "Target spec" section) — Global Admin (TAS-wide),
// Customer Admin (single Customer), User (baseline, scoped). Schedule-edit
// authority is a per-user grant (people.can_edit_schedule / req.user.canEditSchedule),
// not a role tier — see requireScheduleAccess below.
const ROLE_RANK = {
  global_admin: 2,
  customer_admin: 1,
  user: 0,
};

// requireRole('customer_admin') passes for customer_admin AND global_admin
// (anything ranked at or above the named role) — "at least this privileged",
// not "exactly this role". Route handlers still need to apply their own
// organization_id scoping since that depends on which resource is being
// touched, not just the caller's role.
export function requireRole(minRole) {
  const minRank = ROLE_RANK[minRole];
  if (minRank === undefined) {
    throw new Error(`Unknown role in requireRole(): ${minRole}`);
  }
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const rank = ROLE_RANK[req.user.role];
    if (rank === undefined || rank < minRank) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Schedule mutations (shifts, auto-schedule, shift-swap approval) are open
// to Customer Admin and above, or to a User who's been individually granted
// schedule-edit authority (spec: "User ... view/edit schedule if granted").
export function requireScheduleAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const isAdminTier = (ROLE_RANK[req.user.role] ?? -1) >= ROLE_RANK.customer_admin;
  if (isAdminTier || req.user.canEditSchedule) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
}

export function isAtLeast(role, minRole) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minRole] ?? Infinity);
}

export { ROLE_RANK };
