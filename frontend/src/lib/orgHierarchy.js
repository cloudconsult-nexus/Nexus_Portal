// Flat Customer list helpers — the hierarchy this used to walk (Master Org
// through Provider) is gone; every organizations row is now a standalone
// Customer. See migrations/013_tas_customer_model.sql.
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
