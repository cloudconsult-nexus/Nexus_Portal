import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, ShieldAlert, CheckCircle2, Clock, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Card, Button, Field, Table, Badge, Tabs, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

// NCC-backed Customer Messages (Phase 5.2, scoped 2026-09-03 per
// NCCMessageIntegrationGuide.docx's Q&A). Metadata only, by design: NCC's
// message envelope carries full free-text content (the guide's live data
// included tenant-identifiable names, lease terms, legal/financial
// matters), and the target spec says the Portal must never persist or
// render that itself. The backend (routes/customerMessages.js) strips
// `message` before it ever reaches this page — there is no client-side
// redaction to get wrong here, the content simply never arrives.
//
// One Customer at a time (like OnCall Reports' Organization picker) — a
// Customer Admin/User's scope can span several Customers, each its own NCC
// tenant, so "everything in scope" isn't a single fetch.

const PRIORITY_TONE = { 1: 'red', 2: 'amber', 3: 'neutral' };

function formatTimestamp(epochMs) {
  if (!epochMs) return '—';
  return new Date(Number(epochMs)).toLocaleString();
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

// The secure-content handoff (target spec: message body only ever viewed
// through an iframe straight into NCC, gated by a compliance check) is an
// open design decision — the Q&A that scoped this page ("leave a
// placeholder, decide later") deliberately punted the gate mechanism
// (role flag / re-auth / consent) rather than guess at one. This button is
// the placeholder: visible so the intended action is legible in the UI,
// disabled so nothing here fakes a security control that hasn't actually
// been designed yet.
function ViewContentPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-3 py-3 text-xs text-muted flex items-start gap-2">
      <ShieldAlert size={14} className="shrink-0 mt-0.5 text-signal-amber" />
      <span>
        Full message content isn&rsquo;t shown here by design — it&rsquo;s meant to open in a secure iframe straight into NCC, gated by a
        compliance check (role flag, re-auth, or consent — not yet decided). Not wired up yet.
      </span>
    </div>
  );
}

// Message detail — a right-hand panel on wide viewports (list stays visible
// for context) and a full-screen takeover below the sm breakpoint, so the
// same markup works from phone to desktop rather than shipping a second
// mobile-only layout.
function MessageDetailPanel({ message, organizationId, onClose, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function acknowledge() {
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
  }

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
            {message.acknowledged ? (
              <Badge tone="green"><CheckCircle2 size={12} /> Acknowledged</Badge>
            ) : (
              <Badge tone="amber"><Clock size={12} /> Unacknowledged</Badge>
            )}
            {message.priority && <Badge tone={PRIORITY_TONE[message.priority] || 'neutral'}>Priority {message.priority}</Badge>}
          </div>

          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Contact</dt><dd className="text-ink font-medium text-right">{message.contactId || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">NCC Customer</dt><dd className="text-ink text-right">{message.customerId || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Created</dt><dd className="text-ink text-right">{formatTimestamp(message.createdAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Last modified</dt><dd className="text-ink text-right">{formatTimestamp(message.modifiedAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Last follow-up</dt><dd className="text-ink text-right">{formatTimestamp(message.lastFollowUp)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Acknowledged at</dt><dd className="text-ink text-right">{formatTimestamp(message.acknowledgedAt)}</dd></div>
          </dl>

          <ViewContentPlaceholder />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-t border-line shrink-0">
          <Button variant="secondary" size="sm" loading={busy === 'follow-up'} disabled={!!busy} onClick={updateFollowUp}>
            Update follow-up
          </Button>
          <Button variant="primary" size="sm" loading={busy === 'acknowledge'} disabled={!!busy || message.acknowledged} onClick={acknowledge}>
            {message.acknowledged ? 'Acknowledged' : 'Acknowledge'}
          </Button>
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
        description="Message metadata from NCC. Full content opens in NCC directly — never stored or shown here."
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
              <Table columns={[{ label: 'Contact' }, { label: 'Priority' }, { label: 'Created' }, { label: 'Last follow-up' }, { label: 'Status' }]}>
                {data.messages.map((m) => (
                  <tr key={m.messageId || m._id} className="hover:bg-surface cursor-pointer" onClick={() => setSelected(m)}>
                    <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{m.contactId || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{m.priority ? <Badge tone={PRIORITY_TONE[m.priority] || 'neutral'}>P{m.priority}</Badge> : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatTimestamp(m.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatTimestamp(m.lastFollowUp)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {m.acknowledged ? <Badge tone="green"><CheckCircle2 size={12} /> Acknowledged</Badge> : <Badge tone="amber"><Clock size={12} /> Unacknowledged</Badge>}
                    </td>
                  </tr>
                ))}
              </Table>
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
