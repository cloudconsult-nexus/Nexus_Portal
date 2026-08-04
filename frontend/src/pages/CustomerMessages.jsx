import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Printer, Trash2, ArrowUpDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { PageHeader, Card, Button, Select, Table, Badge, LoadingBlock, EmptyState, ErrorBanner, ConfirmDialog } from '../components/ui.jsx';

const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Date' },
  { value: 'from', label: 'From' },
  { value: 'channel', label: 'Channel' },
];

// Opens a print-formatted popup for one message rather than printing the
// whole page — keeps the printed output to just what the person asked for.
function printMessage(m) {
  const w = window.open('', '_blank', 'width=600,height=800');
  if (!w) return;
  const row = (label, value) => `<p><strong>${label}:</strong> ${value ?? '—'}</p>`;
  w.document.write(`
    <html><head><title>Message ${m.id}</title></head>
    <body style="font-family: sans-serif; padding: 24px; color: #1B2333;">
      <h2 style="margin-bottom: 16px;">Message</h2>
      ${row('Date', m.createdAt ? new Date(m.createdAt).toLocaleString() : null)}
      ${row('From', m.from)}
      ${row('To', m.to)}
      ${row('Channel', m.channel)}
      ${row('Type', m.type)}
      <hr style="margin: 16px 0;" />
      <p>${m.preview || '(no preview available)'}</p>
    </body></html>
  `);
  w.document.close();
  w.print();
}

export default function CustomerMessages() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  function load() {
    setError('');
    api.get('/customer-messages').then(setState).catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);

  const sorted = useMemo(() => {
    if (!state?.messages) return [];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...state.messages].sort((a, b) => {
      const av = a[sortKey] || '';
      const bv = b[sortKey] || '';
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [state, sortKey, sortDir]);

  async function handleRemove() {
    setRemoving(true);
    try {
      await api.post(`/customer-messages/${encodeURIComponent(removeTarget.id)}/remove`, {});
      setRemoveTarget(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Customer Messages" description="Messages from NCC — removing one here only hides it from this view; NCC keeps the record." />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        {!state ? (
          <LoadingBlock />
        ) : !state.configured ? (
          <EmptyState icon={MessageSquare} title="Not configured" description="Set THRIO_USERNAME and THRIO_PASSWORD on the API service to enable this." />
        ) : (
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="max-w-[10rem]">
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <Button variant="secondary" size="sm" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
                <ArrowUpDown size={13} /> {sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </Button>
            </div>

            {sorted.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages" />
            ) : (
              <Table columns={['Date', 'From', 'To', 'Channel', 'Type', 'Preview', '']}>
                {sorted.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 text-ink whitespace-nowrap">{m.createdAt ? new Date(m.createdAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-2.5 text-ink">{m.from || '—'}</td>
                    <td className="px-4 py-2.5 text-ink">{m.to || '—'}</td>
                    <td className="px-4 py-2.5"><Badge tone="blue">{m.channel || '—'}</Badge></td>
                    <td className="px-4 py-2.5 text-ink">{m.type || '—'}</td>
                    <td className="px-4 py-2.5 text-muted truncate max-w-xs">{m.preview || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => printMessage(m)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-ink" title="Print">
                          <Printer size={14} />
                        </button>
                        <button onClick={() => setRemoveTarget(m)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-signal-red" title="Remove from portal view">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove message from portal view?"
        message="This only hides it here — the record stays in NCC and can't be recovered from this portal once removed."
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
        loading={removing}
      />
    </div>
  );
}
