// Mirrors backend/src/middleware/rbac.js's ROLE_RANK — kept in sync by hand
// since the frontend never imports backend code. Three tiers per the TAS
// Client Portal spec (see CLAUDE.md's "Target spec" section) — schedule-edit
// authority is a per-user grant (user.canEditSchedule), not a role tier.
export const ROLE_RANK = {
  global_admin: 2,
  customer_admin: 1,
  user: 0,
};

export const ROLE_LABELS = {
  global_admin: 'Global Admin',
  customer_admin: 'Customer Admin',
  user: 'User',
};

export function roleRank(user) {
  return ROLE_RANK[user?.role] ?? -1;
}

export function hasMinRole(user, minRole) {
  return roleRank(user) >= (ROLE_RANK[minRole] ?? Infinity);
}

export function isGlobalAdmin(user) {
  return user?.role === 'global_admin';
}

export function isAdmin(user) {
  return hasMinRole(user, 'customer_admin');
}

// Schedule mutations (shifts, auto-schedule, shift-swap approval) are open
// to Customer Admin and above, or to a User individually granted
// schedule-edit authority — matches requireScheduleAccess on the backend.
export function canEditSchedule(user) {
  return isAdmin(user) || !!user?.canEditSchedule;
}

// Customer Messages / Secure Messaging are nav+permission scaffolding
// (CLAUDE.md) surfaced to the same audience as other admin tooling.
export function canViewMessages(user) {
  return isAdmin(user);
}
