import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, UserRound, CalendarDays, CalendarClock, AlertTriangle, ShieldAlert, Users2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { sortByName } from '../lib/orgHierarchy.js';
import { PageHeader, Card, LoadingBlock, ErrorBanner, EmptyState, Badge } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-signal-amber/10 flex items-center justify-center shrink-0">
        <Icon size={17} className="text-signal-amber" />
      </div>
      <div>
        <p className="text-xl font-semibold text-ink leading-tight">{value ?? '—'}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </Card>
  );
}

function AlertGroup({ icon: Icon, tone, title, items, renderItem, emptyLabel }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className={tone} />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <Badge tone={items.length ? 'amber' : 'green'}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {items.map(renderItem)}
        </ul>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [organizationId, setOrganizationId] = useState(user?.organizationId || null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Global Admins may have no organizationId of their own — default the
  // dashboard scope to the first Customer (alphabetically) in that case.
  useEffect(() => {
    if (organizationId) return;
    api.get('/organizations').then((data) => {
      const sorted = sortByName(data.organizations);
      if (sorted[0]) setOrganizationId(sorted[0].id);
    });
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    api
      .get(`/reports/dashboard-summary?organizationId=${organizationId}`)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Coverage and escalation health for the selected organization."
        actions={<div className="w-64"><OrganizationSelector value={organizationId} onChange={setOrganizationId} /></div>}
      />

      <div className="p-8 space-y-6">
        {error && <ErrorBanner message={error} />}

        {loading || !summary ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Building2} label="Customers" value={summary.organizationCount} />
              <StatCard icon={UserRound} label="People" value={summary.peopleCount} />
              <StatCard icon={CalendarDays} label="Calendars" value={summary.calendarCount} />
              <StatCard icon={CalendarClock} label="Upcoming shifts (7d)" value={summary.upcomingAssignments} />
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <AlertGroup
                icon={AlertTriangle}
                tone="text-signal-red"
                title="Coverage gaps"
                items={summary.alerts.coverageGaps}
                emptyLabel="No unassigned shifts upcoming."
                renderItem={(a) => (
                  <li key={a.id} className="text-xs">
                    <Link to="/schedule" className="text-ink hover:underline">{a.calendar_name}</Link>
                    <span className="text-muted"> — {a.date}</span>
                  </li>
                )}
              />
              <AlertGroup
                icon={ShieldAlert}
                tone="text-signal-amber"
                title="Missing escalation chains"
                items={summary.alerts.missingEscalationChains}
                emptyLabel="Every shift has a backup and default."
                renderItem={(a) => (
                  <li key={a.id} className="text-xs">
                    <Link to="/schedule" className="text-ink hover:underline">{a.calendar_name}</Link>
                    <span className="text-muted"> — {a.date}</span>
                  </li>
                )}
              />
              <AlertGroup
                icon={Users2}
                tone="text-signal-blue"
                title="Conflicted users"
                items={summary.alerts.conflictedUsers}
                emptyLabel="No one is double-booked."
                renderItem={(a) => (
                  <li key={a.assignment_id} className="text-xs text-ink">
                    {a.date} <span className="text-muted">— overlapping shifts</span>
                  </li>
                )}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
