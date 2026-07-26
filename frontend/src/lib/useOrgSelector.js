import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { filterBySearch, findOrg, sortByName } from './orgHierarchy.js';

// Shared data/state behind OrganizationSelector.jsx — the Customer picker
// used across Dashboard, People, Calendars, Schedule, etc.
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

  const filtered = useMemo(() => sortByName(filterBySearch(orgs, search)), [orgs, search]);
  const selected = useMemo(() => findOrg(orgs, selectedId), [orgs, selectedId]);

  return { orgs, filtered, loading, error, selectedId, setSelectedId, selected, search, setSearch };
}
