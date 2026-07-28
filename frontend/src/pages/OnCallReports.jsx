import { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { exportTableToPdf } from '../lib/pdfExport.js';
import { PageHeader, Card, Button, Field, Select, Input, Table, Badge, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

function toISODate(d) { return d.toISOString().slice(0, 10); }

export default function OnCallReports() {
  const { user } = useAuth();
  const [calendars, setCalendars] = useState([]);
  const [calendarId, setCalendarId] = useState('');
  const [organizationId, setOrganizationId] = useState(user?.organizationId || null);
  const [startDate, setStartDate] = useState(toISODate(new Date(Date.now() - 30 * 86400000)));
  const [endDate, setEndDate] = useState(toISODate(new Date()));

  const [coverage, setCoverage] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [hierarchySummary, setHierarchySummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/calendars').then((data) => {
      setCalendars(data.calendars);
      if (!calendarId && data.calendars[0]) setCalendarId(data.calendars[0].id);
    });
  }, []);

  async function load() {
    if (!calendarId || !organizationId) return;
    setLoading(true);
    setError('');
    try {
      const [cov, work, hierarchy] = await Promise.all([
        api.get(`/reports/coverage?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`),
        api.get(`/reports/workload?organizationId=${organizationId}&startDate=${startDate}&endDate=${endDate}`),
        api.get(`/reports/hierarchy-summary?organizationId=${organizationId}&startDate=${startDate}&endDate=${endDate}`),
      ]);
      setCoverage(cov);
      setWorkload(work.workload);
      setHierarchySummary(hierarchy);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [calendarId, organizationId, startDate, endDate]);

  function exportPdf() {
    exportTableToPdf({
      title: 'OnCall Workload Report',
      subtitle: `${startDate} to ${endDate}`,
      columns: ['Person', 'Shifts'],
      rows: (workload || []).map((w) => [w.name, w.shift_count]),
      filename: 'oncall-workload',
    });
  }

  function exportHierarchyPdf() {
    exportTableToPdf({
      title: 'Customer Hierarchy Summary',
      subtitle: `${startDate} to ${endDate}`,
      columns: ['Customer', 'People', 'Calendars', 'Upcoming shifts', 'Coverage gaps', 'Missing chains'],
      rows: (hierarchySummary?.rows || []).map((r) => [
        r.isRoot ? `${r.organizationName} (parent)` : r.organizationName,
        r.peopleCount, r.calendarCount, r.upcomingAssignments, r.coverageGaps, r.missingEscalationChains,
      ]),
      filename: 'customer-hierarchy-summary',
    });
  }

  return (
    <div>
      <PageHeader title="OnCall Reports" description="Coverage and workload for the selected calendar and date range."
        actions={<Button variant="secondary" onClick={exportPdf} disabled={!workload?.length}><Download size={14} /> Export PDF</Button>} />

      <div className="p-8 space-y-6">
        <Card className="p-4 grid grid-cols-4 gap-4">
          <Field label="Calendar">
            <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Organization"><OrganizationSelector value={organizationId} onChange={setOrganizationId} /></Field>
          <Field label="From"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </Card>

        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : !coverage ? <EmptyState title="Select a calendar and organization" /> : (
          <>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-ink">Coverage over time</h3>
                <span className="text-sm font-mono text-ink">{coverage.coveragePercent == null ? '—' : `${coverage.coveragePercent}%`}</span>
              </div>
              {coverage.byDate.length === 0 ? <EmptyState title="No shifts in range" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={coverage.byDate.map((d) => ({ date: d.date.slice(5), pct: Number(d.total) === 0 ? 0 : Math.round((Number(d.covered) / Number(d.total)) * 100) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="pct" stroke="#F5A623" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Workload by person</h3>
              {!workload?.length ? <EmptyState title="No assigned shifts in range" /> : (
                <ResponsiveContainer width="100%" height={Math.max(180, workload.length * 32)}>
                  <BarChart data={workload} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="shift_count" fill="#1B2333" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {hierarchySummary?.rows?.length > 1 && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink">Customer hierarchy summary</h3>
                  <Button variant="secondary" size="sm" onClick={exportHierarchyPdf}><Download size={13} /> Export PDF</Button>
                </div>
                <Table columns={['Customer', 'People', 'Calendars', 'Upcoming shifts', 'Coverage gaps', 'Missing chains']}>
                  {hierarchySummary.rows.map((r) => (
                    <tr key={r.organizationId} className={r.isRoot ? 'bg-surface' : ''}>
                      <td className="px-4 py-2.5 text-ink font-medium">
                        {r.organizationName}
                        {r.isRoot && <Badge tone="blue" className="ml-2">Parent</Badge>}
                      </td>
                      <td className="px-4 py-2.5 text-ink">{r.peopleCount}</td>
                      <td className="px-4 py-2.5 text-ink">{r.calendarCount}</td>
                      <td className="px-4 py-2.5 text-ink">{r.upcomingAssignments}</td>
                      <td className="px-4 py-2.5 text-ink">{r.coverageGaps > 0 ? <Badge tone="red">{r.coverageGaps}</Badge> : r.coverageGaps}</td>
                      <td className="px-4 py-2.5 text-ink">{r.missingEscalationChains > 0 ? <Badge tone="amber">{r.missingEscalationChains}</Badge> : r.missingEscalationChains}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold border-t-2 border-line">
                    <td className="px-4 py-2.5 text-ink">Total</td>
                    <td className="px-4 py-2.5 text-ink">{hierarchySummary.total.peopleCount}</td>
                    <td className="px-4 py-2.5 text-ink">{hierarchySummary.total.calendarCount}</td>
                    <td className="px-4 py-2.5 text-ink">{hierarchySummary.total.upcomingAssignments}</td>
                    <td className="px-4 py-2.5 text-ink">{hierarchySummary.total.coverageGaps}</td>
                    <td className="px-4 py-2.5 text-ink">{hierarchySummary.total.missingEscalationChains}</td>
                  </tr>
                </Table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
