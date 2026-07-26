import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check, X, Ban, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { canEditSchedule } from '../lib/roles.js';
import { PageHeader, Card, Button, Field, Select, Input, Textarea, Table, Badge, Modal, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

const STATUS_TONE = { pending_target: 'amber', pending_admin: 'amber', approved: 'green', rejected: 'red', cancelled: 'neutral' };
const STATUS_LABEL = { pending_target: 'Awaiting target', pending_admin: 'Awaiting admin', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

export default function ShiftSwaps() {
  const { user } = useAuth();
  const canApprove = canEditSchedule(user);

  const [swaps, setSwaps] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  async function load() {
    setLoading(true);
    try {
      const [swapData, peopleData] = await Promise.all([api.get('/shift-swaps'), api.get('/people')]);
      setSwaps(swapData.shiftSwaps);
      setPeople(peopleData.people);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(id, action, body) {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/shift-swaps/${id}/${action}`, body);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Shift Swaps" description="Two-stage approval: the target accepts, then a scheduler approves."
        actions={<Button onClick={() => setRequestOpen(true)}><Plus size={14} /> Request swap</Button>} />

      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : swaps.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No shift swap requests" />
        ) : (
          <Card>
            <Table columns={['Requested by', 'Role', 'Target', 'Reason', 'Status', { label: '' }]}>
              {swaps.map((s) => {
                const canAccept = s.status === 'pending_target' && s.target_person_id === user.id;
                const canCancel = s.status !== 'approved' && s.status !== 'rejected' && s.status !== 'cancelled' && s.requested_by === user.id;
                const canReview = canApprove && s.status === 'pending_admin';
                return (
                  <tr key={s.id} className="hover:bg-surface">
                    <td className="px-4 py-2.5 text-ink">{peopleById[s.requested_by]?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-muted capitalize">{s.swap_role}</td>
                    <td className="px-4 py-2.5 text-ink">{peopleById[s.target_person_id]?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-muted">{s.reason || '—'}</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        {canAccept && <Button size="sm" variant="secondary" onClick={() => act(s.id, 'accept')} loading={busyId === s.id}><Check size={13} /> Accept</Button>}
                        {canReview && (
                          <>
                            <Button size="sm" onClick={() => act(s.id, 'approve')} loading={busyId === s.id}><Check size={13} /> Approve</Button>
                            <Button size="sm" variant="danger" onClick={() => act(s.id, 'reject')} loading={busyId === s.id}><X size={13} /> Reject</Button>
                          </>
                        )}
                        {canCancel && <Button size="sm" variant="ghost" onClick={() => act(s.id, 'cancel')} loading={busyId === s.id}><Ban size={13} /> Cancel</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )}
      </div>

      <RequestSwapModal open={requestOpen} onClose={() => setRequestOpen(false)} people={people} onCreated={() => { setRequestOpen(false); load(); }} />
    </div>
  );
}

function RequestSwapModal({ open, onClose, people, onCreated }) {
  const [calendars, setCalendars] = useState([]);
  const [calendarId, setCalendarId] = useState('');
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [swapRole, setSwapRole] = useState('primary');
  const [targetPersonId, setTargetPersonId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) api.get('/calendars').then((d) => setCalendars(d.calendars));
  }, [open]);

  useEffect(() => {
    if (!calendarId) return;
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    api.get(`/assignments?calendarId=${calendarId}&startDate=${start}&endDate=${end}`).then((d) => setAssignments(d.assignments));
  }, [calendarId]);

  async function handleSubmit() {
    setSaving(true);
    setError('');
    try {
      await api.post('/shift-swaps', { assignmentId, swapRole, targetPersonId, reason });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request a shift swap"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSubmit} loading={saving} disabled={!assignmentId || !targetPersonId}>Submit</Button></>}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Calendar">
          <Select value={calendarId} onChange={(e) => { setCalendarId(e.target.value); setAssignmentId(''); }}>
            <option value="">Select…</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Shift">
          <Select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} disabled={!calendarId}>
            <option value="">Select…</option>
            {assignments.map((a) => <option key={a.id} value={a.id}>{a.date} {a.start_time?.slice(0, 5)}–{a.end_time?.slice(0, 5)}</option>)}
          </Select>
        </Field>
        <Field label="My role in this shift">
          <Select value={swapRole} onChange={(e) => setSwapRole(e.target.value)}>
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="tertiary">Tertiary</option>
          </Select>
        </Field>
        <Field label="Swap with">
          <Select value={targetPersonId} onChange={(e) => setTargetPersonId(e.target.value)}>
            <option value="">Select…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Reason (optional)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
