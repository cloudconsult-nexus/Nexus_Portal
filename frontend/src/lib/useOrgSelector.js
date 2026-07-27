import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { findOrg, buildTree, filterTree, flattenTree } from './orgHierarchy.js';

// Shared data/state behind OrganizationSelector.jsx — the Customer picker
// used across Dashboard, People, Calendars, Schedule, Organizations, etc.
// `filtered` is a flattened, indented tree ({org, depth, hasChildren}[]),
// not just a flat sorted list — Customers can optionally nest under one
// another (migrations/014_organization_hierarchy.sql), and this picker is
// how a level "and everything below it" gets selected.
export function useOrgSelector({ initialId = null } = {}) {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(initialId);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/organizations')
      .then((data) => { if (!cancelled) setOrgs(data.organizations); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => flattenTree(filterTree(buildTree(orgs), search)), [orgs, search]);
  const selected = useMemo(() => findOrg(orgs, selectedId), [orgs, selectedId]);

  return { orgs, filtered, loading, error, selectedId, setSelectedId, selected, search, setSearch };
}
