// Customer list helpers. The rigid Master Org → Provider hierarchy from
// before Phase 5.1 is gone for good (migrations/013_tas_customer_model.sql)
// — every organizations row is a standalone Customer with equal standing.
// `parent_id` (migrations/014_organization_hierarchy.sql) was reintroduced
// afterward, at the client's request, purely for optional display/data
// nesting (e.g. a health system's hospital and its clinics) — it's not a
// return to fixed hierarchy levels, and RBAC scope is unaffected by it (see
// CLAUDE.md). buildTree/getDescendantIds/filterTree below are what let the
// Customers page render and search that optional nesting.
export function findOrg(orgs, id) {
  return orgs.find((o) => o.id === id) || null;
}

export function sortByName(orgs) {
  return [...orgs].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterBySearch(orgs, query) {
  if (!query.trim()) return orgs;
  const q = query.trim().toLowerCase();
  return orgs.filter((o) => o.name.toLowerCase().includes(q));
}

// Flat list -> nested tree via parent_id. A row whose parent isn't present
// in the given set (soft-deleted, or simply not fetched) falls back to
// top-level rather than being dropped.
export function buildTree(orgs) {
  const byId = new Map(orgs.map((o) => [o.id, { ...o, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const node of byId.values()) node.children = sortByName(node.children);
  return sortByName(roots);
}

// Every descendant id of `id`, given the flat list — used to keep a
// Customer from being set as its own descendant's parent (would create a
// cycle; the backend re-checks this too, this is just immediate UI feedback).
export function getDescendantIds(orgs, id) {
  const childrenByParent = new Map();
  for (const o of orgs) {
    if (!o.parent_id) continue;
    if (!childrenByParent.has(o.parent_id)) childrenByParent.set(o.parent_id, []);
    childrenByParent.get(o.parent_id).push(o.id);
  }
  const result = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const childId of childrenByParent.get(current) || []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

// Flattens a tree (from buildTree) into a single ordered list of
// { org, depth, hasChildren } — depth-first, so a parent is always
// immediately followed by its own children. `collapsedIds` (a Set of org
// ids) hides a node's children without removing the node itself; leave it
// empty/omitted for a fully-expanded flat list (e.g. a picker dropdown that
// has no concept of collapsing).
export function flattenTree(nodes, collapsedIds = new Set(), depth = 0) {
  const rows = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    rows.push({ org: node, depth, hasChildren });
    if (hasChildren && !collapsedIds.has(node.id)) {
      rows.push(...flattenTree(node.children, collapsedIds, depth + 1));
    }
  }
  return rows;
}

// Recursive search over a tree (from buildTree) — keeps a node if its own
// name matches, or any descendant's does, so a matched grandchild doesn't
// get orphaned out of its ancestor chain mid-search.
export function filterTree(tree, query) {
  if (!query.trim()) return tree;
  const q = query.trim().toLowerCase();
  function walk(nodes) {
    const kept = [];
    for (const node of nodes) {
      const children = walk(node.children);
      if (node.name.toLowerCase().includes(q) || children.length > 0) {
        kept.push({ ...node, children });
      }
    }
    return kept;
  }
  return walk(tree);
}
