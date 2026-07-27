import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Building2 } from 'lucide-react';
import { useOrgSelector } from '../lib/useOrgSelector.js';
import { Input, LoadingBlock, EmptyState } from './ui.jsx';

// Customer picker — used across Dashboard, People, Calendars, Schedule,
// Organizations, OnCall Reports, Audit Logs, Bulk Import, and Status Alerts,
// both to set a record's own Customer and (with allowClear) as a "view as
// this level and everything below it" scope filter for admins. Renders as
// an indented flat list — Customers can optionally nest under one another
// (migrations/014_organization_hierarchy.sql) — not a full tree widget.
export default function OrganizationSelector({ value, onChange, placeholder = 'Select customer…', allowClear = false, clearLabel = 'All Customers' }) {
  const { filtered, loading, selected, setSelectedId, search, setSearch } = useOrgSelector({ initialId: value });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setSelectedId(value ?? null);
  }, [value, setSelectedId]);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handleSelect(org) {
    onChange(org.id, org);
    setOpen(false);
  }

  function handleClear() {
    onChange(null, null);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-left hover:border-ink/30"
      >
        <span className={selected ? 'text-ink truncate' : 'text-muted'}>{selected ? selected.name : (allowClear ? clearLabel : placeholder)}</span>
        <ChevronDown size={14} className="text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[240px] rounded-xl border border-line bg-card shadow-card p-2">
          <div className="relative mb-1.5">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 py-1.5" autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-0.5">
            {allowClear && !search && (
              <button
                type="button"
                onClick={handleClear}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-left hover:bg-surface ${
                  !selected ? 'bg-signal-amber/10 text-ink font-medium' : 'text-muted'
                }`}
              >
                <span className="truncate">{clearLabel}</span>
              </button>
            )}
            {loading ? (
              <LoadingBlock label="Loading customers…" />
            ) : filtered.length === 0 ? (
              <EmptyState title="No customers found" />
            ) : (
              filtered.map(({ org, depth }) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => handleSelect(org)}
                  style={{ paddingLeft: 8 + depth * 16 }}
                  className={`w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-lg text-sm text-left hover:bg-surface ${
                    selected?.id === org.id ? 'bg-signal-amber/10 text-ink font-medium' : 'text-ink'
                  }`}
                >
                  <Building2 size={13} className="text-muted shrink-0" />
                  <span className="truncate">{org.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
