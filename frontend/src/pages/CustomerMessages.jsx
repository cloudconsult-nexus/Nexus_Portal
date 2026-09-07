import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, CheckCircle2, Clock, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Card, Button, Field, Table, Badge, Tabs, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

// NCC-backed Customer Messages (Phase 5.2, scoped 2026-09-03 per
// NCCMessageIntegrationGuide.docx's Q&A; message content un-masked per the
// NCC dev/release plan's Phase C1, decided 2026-09-07). NCC's message
// envelope carries full free-text content (the guide's live data included
// tenant-identifiable names, lease terms, legal/financial matters) — the
// target spec's compliance gate on viewing it is resolved as role-based:
// the backend's `requireRole('customer_admin')` on every route under here
// IS the gate, so content now passes through and renders below. Still
// never persisted anywhere in the Portal's own database — fetched live on
// every load, same as before.
//
// One Customer at a time (like OnCall Reports' Organization picker) — a
// Customer Admin/User's scope can span several Customers, each its own NCC
// tenant, so "everything in scope" isn't a single fetch.

const PRIORITY_TONE = { 1: 'red', 2: 'amber', 3: 'neutral' };

function formatTimestamp(epochMs) {
  if (!epochMs) return '—';
  return new Date(Number(epochMs)).toLocaleString();
}

function StatusBadge({ acknowledged }) {
  return acknowledged ? (
    <Badge tone="green"><CheckCircle2 size={12} /> Acknowledged</Badge>
  ) : (
    <Badge tone="amber"><Clock size={12} /> Unacknowledged</Badge>
  );
}

// Below `sm`, a data table just moves the overflow problem sideways (extra
// columns end up off-screen, requiring a horizontal scroll to reach them) —
// a stacked card puts every field within a single vertical read, so this is
// a different layout for the same rows rather than a squeezed-down table.
function MessageCard({ message, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface active:bg-surface"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium text-ink truncate">{message.contactName || message.contactId || '—'}</span>
        {message.priority && <Badge tone={PRIORITY_TONE[message.priority] || 'neutral'} className="shrink-0">P{message.priority}</Badge>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{formatTimestamp(message.createdAt)}</span>
        <StatusBadge acknowledged={message.acknowledged} />
      </div>
    </button>
  );
}

function AckFilterTabs({ value, onChange }) {
  return (
    <Tabs
      tabs={[
        { value: 'all', label: 'All' },
        { value: 'false', label: 'Unacknowledged' },
        { value: 'true', label: 'Acknowledged' },
      ]}
      active={value}
      onChange={onChange}
    />
  );
}

// Message detail — a right-hand panel on wide viewports (list stays visible
// for context) and a full-screen takeover below the sm breakpoint, so the
// same markup works from phone to desktop rather than shipping a second
// mobile-only layout.
function MessageDetailPanel({ message, organizationId, onClose, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // Guards the auto-acknowledge effect below against firing twice for the
  // same message (StrictMode double-invoke, or a re-render before the
  // first PATCH resolves) — keyed by message id so opening a different
  // message re-arms it.
  const autoAckedFor = useRef(null);

  const acknowledge = useCallback(async () => {
    setBusy('acknowledge');
    setError('');
    try {
      const updated = await api.patch(`/customer-messages/ncc/messages/${encodeURIComponent(message.messageId || message._id)}/acknowledge`, { organizationId });
      onChanged(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }, [message.messageId, message._id, organizationId, onChanged]);

  // Phase D1 of the NCC dev/release plan, finalizing the v1 decision:
  // opening a message auto-acknowledges it — no separate manual step.
  useEffect(() => {
    const id = message.messageId || message._id;
    if (message.acknowledged || autoAckedFor.current === id) return;
    autoAckedFor.current = id;
    acknowledge();
    // Only re-run when the message identity changes, not on every
    // `acknowledge` identity change (which itself changes when the message
    // prop updates after acknowledging) — that would re-fire this effect
    // right after the ack succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.messageId, message._id]);

  async function updateFollowUp() {
    setBusy('follow-up');
    setError('');
    try {
      const updated = await api.patch(`/customer-messages/ncc/messages/${encodeURIComponent(message.messageId || message._id)}/follow-up`, { organizationId });
      onChanged(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end sm:bg-ink/30" onClick={onClose}>
      <div
        className="w-full sm:w-[420px] lg:w-[480px] h-full bg-card border-l border-line shadow-card flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <h2 className="text-sm font-semibold text-ink">Message</h2>
          <button onClick={onClose} className="text-muted hover:text-ink rounded p-1 hover:bg-surface">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <ErrorBanner message={error} />}

          <div className="flex items-center gap-2">
            <StatusBadge acknowledged={message.acknowledged} />
            {message.priority && <Badge tone={PRIORITY_TONE[message.priority] || 'neutral'}>Priority {message.priority}</Badge>}
          </div>

          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Contact</dt><dd className="text-ink font-medium text-right">{message.contactName || message.contactId || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">NCC Customer</dt><dd className="text-ink text-right">{message.customerId || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Created</dt><dd className="text-ink text-right">{formatTimestamp(message.createdAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Last modified</dt><dd className="text-ink text-right">{formatTimestamp(message.modifiedAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Last follow-up</dt><dd className="text-ink text-right">{formatTimestamp(message.lastFollowUp)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Acknowledged at</dt><dd className="text-ink text-right">{formatTimestamp(message.acknowledgedAt)}</dd></div>
          </dl>

          {/* Un-masked per Phase C1 of the NCC dev/release plan — see the
              file header comment. Still never persisted in the Portal's
              own database, only rendered from the live fetch. */}
          {message.message && (
            <div>
              <div className="text-xs font-medium text-muted mb-1">Message</div>
              <div className="rounded-lg border border-line bg-surface px-3 py-3 text-sm text-ink whitespace-pre-wrap">
                {message.message}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-t border-line shrink-0">
          <Button variant="secondary" size="sm" loading={busy === 'follow-up'} disabled={!!busy} onClick={updateFollowUp}>
            Update follow-up
          </Button>
          {/* Acknowledging is automatic on open (Phase D1) — this reflects
              status rather than offering a redundant manual action, except
              as a retry if the automatic PATCH above failed. */}
          {message.acknowledged ? (
            <Badge tone="green"><CheckCircle2 size={12} /> Acknowledged</Badge>
          ) : (
            <Button variant="primary" size="sm" loading={busy === 'acknowledge'} disabled={!!busy} onClick={acknowledge}>
              Retry acknowledge
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomerMessages() {
  const { user } = useAuth();
  const [organizationId, setOrganizationId] = useState(user?.organizationId || null);
  const [ackFilter, setAckFilter] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    if (!organizationId) { setData(null); return; }
    setLoading(true);
    setError('');
    const query = ackFilter === 'all' ? '' : `&acknowledged=${ackFilter}`;
    api
      .get(`/customer-messages/ncc/messages?organizationId=${organizationId}${query}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [organizationId, ackFilter]);

  useEffect(() => { load(); }, [load]);

  function handleChanged(updated) {
    setData((prev) => prev && { ...prev, messages: prev.messages.map((m) => ((m.messageId || m._id) === (updated.messageId || updated._id) ? { ...m, ...updated } : m)) });
    setSelected((prev) => prev && { ...prev, ...updated });
  }

  return (
    <div>
      <PageHeader
        title="Customer Messages"
        description="Messages fetched live from NCC — never stored in the Portal's own database."
      />
      <div className="p-4 sm:p-8 space-y-4">
        <Card className="p-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="sm:w-72"><Field label="Customer"><OrganizationSelector value={organizationId} onChange={setOrganizationId} /></Field></div>
        </Card>

        {error && <ErrorBanner message={error} />}

        {!organizationId ? (
          <EmptyState icon={MessageSquare} title="Select a Customer" description="Pick a Customer above to view its NCC messages." />
        ) : loading && !data ? (
          <LoadingBlock />
        ) : data && !data.configured ? (
          <EmptyState icon={MessageSquare} title="NCC not configured" description="This Customer has no NCC credentials set (per-Customer or TAS-wide default) — see Global Admin → NCC settings." />
        ) : (
          <Card className="overflow-hidden">
            <AckFilterTabs value={ackFilter} onChange={setAckFilter} />
            {!data || data.messages.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages" description="Nothing matches this filter for the selected Customer." />
            ) : (
              <>
                {/* Card list below `sm` — see MessageCard's comment. */}
                <div className="sm:hidden">
                  {data.messages.map((m) => (
                    <MessageCard key={m.messageId || m._id} message={m} onClick={() => setSelected(m)} />
                  ))}
                </div>

                <div className="hidden sm:block">
                  <Table columns={[{ label: 'Contact' }, { label: 'Priority' }, { label: 'Created' }, { label: 'Last follow-up' }, { label: 'Status' }]}>
                    {data.messages.map((m) => (
                      <tr key={m.messageId || m._id} className="hover:bg-surface cursor-pointer" onClick={() => setSelected(m)}>
                        <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{m.contactName || m.contactId || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{m.priority ? <Badge tone={PRIORITY_TONE[m.priority] || 'neutral'}>P{m.priority}</Badge> : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">{formatTimestamp(m.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">{formatTimestamp(m.lastFollowUp)}</td>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge acknowledged={m.acknowledged} /></td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      {selected && (
        <MessageDetailPanel message={selected} organizationId={organizationId} onClose={() => setSelected(null)} onChanged={handleChanged} />
      )}
    </div>
  );
}
