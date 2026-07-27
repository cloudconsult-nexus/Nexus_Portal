import pool from '../db/pool.js';

// Every descendant id of rootId (not including rootId itself), via the
// optional organizations.parent_id nesting (migrations/014_organization_hierarchy.sql).
// Most Customers have parent_id = NULL and simply have no descendants.
export async function getDescendantIds(rootId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM organizations WHERE parent_id = $1
       UNION ALL
       SELECT o.id FROM organizations o JOIN descendants d ON o.parent_id = d.id
     )
     SELECT id FROM descendants`,
    [rootId]
  );
  return rows.map((r) => r.id);
}

// The single source of truth for "which organization ids can this request
// see" — deliberately expands Customer Admin/User access from "their own
// Customer only" to "their Customer + every descendant," per the client's
// explicit request (an intentional exception to the TAS Client Portal
// spec's "fully siloed per Customer" default — see CLAUDE.md).
//
// Returns:
//   - null                 → no filter, see everything (Global Admin only,
//                             and only when no organizationId was requested)
//   - array of org ids      → restrict to these ids
//
// A requested `organizationId` (query or body) is honored as a "view as"
// drill-down, but for non-Global-Admins it's only ever honored if it falls
// within their own subtree — this is what closes the previous gap where
// several routes trusted a client-supplied organizationId with no
// ownership check at all. Never trust req.query/req.body directly for
// scoping elsewhere; always go through this function.
export async function resolveScopedOrgIds(req) {
  const requestedRoot = req.query?.organizationId || req.body?.organizationId || null;

  if (req.user.role === 'global_admin') {
    if (!requestedRoot) return null;
    return [requestedRoot, ...(await getDescendantIds(requestedRoot))];
  }

  const ownSubtree = [req.user.organizationId, ...(await getDescendantIds(req.user.organizationId))];
  if (requestedRoot && ownSubtree.includes(requestedRoot)) {
    return [requestedRoot, ...(await getDescendantIds(requestedRoot))];
  }
  return ownSubtree;
}
