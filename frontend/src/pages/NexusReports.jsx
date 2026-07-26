import { useEffect, useState } from 'react';
import { ExternalLink, BarChart3 } from 'lucide-react';
import { api } from '../lib/api.js';
import { PageHeader, Card, Button, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

// Platform-wide embedded reports (routes/reports.js's /mappings + /mappings/:id/embed)
// — distinct from OnCallReports.jsx, which renders coverage/workload charts
// computed directly from scheduling data rather than an external embed.
export default function NexusReports() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState(null);
  const [activeEmbed, setActiveEmbed] = useState(null);

  useEffect(() => {
    api.get('/reports/mappings').then((data) => setReports(data.reports)).catch((err) => setError(err.message));
  }, []);

  async function openReport(report) {
    setOpeningId(report.id);
    setError('');
    try {
      const data = await api.get(`/reports/mappings/${report.id}/embed`);
      setActiveEmbed({ name: report.name, url: data.embedUrl });
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Reports" description="Nexus Portal-wide embedded reports." />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}

        {activeEmbed ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">{activeEmbed.name}</h3>
              <Button variant="secondary" size="sm" onClick={() => setActiveEmbed(null)}>Back to list</Button>
            </div>
            <iframe src={activeEmbed.url} title={activeEmbed.name} className="w-full rounded-xl border border-line" style={{ height: 'calc(100vh - 220px)' }} />
          </div>
        ) : !reports ? (
          <LoadingBlock />
        ) : reports.length === 0 ? (
          <EmptyState icon={BarChart3} title="No reports available" description="Ask a Global Admin to configure reports under Report Mappings." />
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {reports.map((r) => (
              <Card key={r.id} className="p-4 flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-ink">{r.name}</h3>
                {r.description && <p className="text-xs text-muted flex-1">{r.description}</p>}
                <Button size="sm" onClick={() => openReport(r)} loading={openingId === r.id}><ExternalLink size={13} /> Open</Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
