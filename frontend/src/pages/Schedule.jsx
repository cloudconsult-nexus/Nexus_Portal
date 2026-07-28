import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Wand2, Copy, Trash2, Pencil, ArrowDown, Radio, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { canEditSchedule, isAdmin } from '../lib/roles.js';
import {
  PageHeader, Card, Button, Input, Field, Select, Textarea, Checkbox, Tabs, Badge,
  Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner,
} from '../components/ui.jsx';
import EscalationChain from '../components/EscalationChain.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

const VIEWS = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function toISODate(d) { return d.toISOString().slice(0, 10); }
function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function isPast(dateStr) { return new Date(dateStr) < new Date(new Date().toDateString()); }

const EMPTY_SHIFT = {
  date: toISODate(new Date()), startTime: '09:00', endTime: '17:00', mode: 'escalation',
  primaryPersonId: '', secondaryPersonId: '', tertiaryPersonId: '', defaultPersonId: '',
  notes: '', notifySlack: true, notifyEmail: true, replicateMonths: 0,
};

export default function Schedule() {
  const { user } = useAuth();
  const canEdit = canEditSchedule(user);
  const canFilterByLevel = isAdmin(user);
  const [searchParams, setSearchParams] = useSearchParams();

  const [calendars, setCalendars] = useState([]);
  const [calendarId, setCalendarId] = useState(searchParams.get('calendarId') || '');
  const [viewOrgId, setViewOrgId] = useState(null);
  const [people, setPeople] = useState([]);
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(new Date());
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState(null);
  const [form, setForm] = useState(EMPTY_SHIFT);
  const [conflicts, setConflicts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [autoOpen, setAutoOpen] = useState(false);

  useEffect(() => {
    api.get(viewOrgId ? `/calendars?organizationId=${viewOrgId}` : '/calendars').then((data) => {
      setCalendars(data.calendars);
      if (data.calendars.length > 0 && !data.calendars.some((c) => c.id === calendarId)) {
        setCalendarId(data.calendars[0].id);
      } else if (data.calendars.length === 0) {
        setCalendarId('');
      }
    });
  }, [viewOrgId]);

  useEffect(() => {
    if (calendarId) setSearchParams({ calendarId }, { replace: true });
  }, [calendarId]);

  // Person picker is scoped to whoever's actually eligible for the selected
  // calendar's organization — their primary org, or one of their
  // additionally-linked orgs ("full scheduling reach," People page). Refetch
  // whenever the selected calendar (or its known org) changes.
  const selectedCalendarOrgId = calendars.find((c) => c.id === calendarId)?.organization_id;
  useEffect(() => {
    if (!selectedCalendarOrgId) { setPeople([]); return; }
    api.get(`/people?assignableToOrganizationId=${selectedCalendarOrgId}`).then((data) => setPeople(data.people));
  }, [selectedCalendarOrgId]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === 'day') return { rangeStart: anchor, rangeEnd: anchor };
    if (view === 'week') { const s = startOfWeek(anchor); return { rangeStart: s, rangeEnd: addDays(s, 6) }; }
    return { rangeStart: startOfMonth(anchor), rangeEnd: endOfMonth(anchor) };
  }, [view, anchor]);

  async function loadAssignments() {
    if (!calendarId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/assignments?calendarId=${calendarId}&startDate=${toISODate(rangeStart)}&endDate=${toISODate(rangeEnd)}`);
      setAssignments(data.assignments);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAssignments(); }, [calendarId, rangeStart.getTime(), rangeEnd.getTime()]);

  // Any field edit after a conflict was reported invalidates that report —
  // require a fresh save (and fresh confirmation) rather than letting a
  // stale "conflicts" list silently apply to changed tiers.
  useEffect(() => { setConflicts([]); }, [form]);

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const byDate = useMemo(() => {
    const map = {};
    // a.date comes back as a full ISO timestamp (Postgres DATE -> pg -> JS
    // Date -> JSON.stringify, e.g. "2026-07-27T00:00:00.000Z"), but every
    // view keys its lookup with a bare YYYY-MM-DD from toISODate() — without
    // normalizing here first, the two never match and shifts silently never
    // render in Day/Week/Month, even though they exist (confirmed via the
    // API directly, and via Dashboard's count, which never touches this
    // string at all).
    for (const a of assignments) (map[a.date.slice(0, 10)] ||= []).push(a);
    for (const key in map) map[key].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
    return map;
  }, [assignments]);

  function openCreate(date) {
    setEditingShift(null);
    setForm({ ...EMPTY_SHIFT, date: date || toISODate(anchor) });
    setConflicts([]);
    setShiftModalOpen(true);
  }

  function openEdit(a) {
    setEditingShift(a);
    setForm({
      date: a.date?.slice(0, 10), startTime: a.start_time?.slice(0, 5), endTime: a.end_time?.slice(0, 5), mode: a.mode,
      primaryPersonId: a.primary_person_id || '', secondaryPersonId: a.secondary_person_id || '',
      tertiaryPersonId: a.tertiary_person_id || '', defaultPersonId: a.default_person_id || '',
      notes: a.notes || '', notifySlack: a.notify_slack, notifyEmail: a.notify_email, replicateMonths: 0,
    });
    setConflicts([]);
    setShiftModalOpen(true);
  }

  // A person can legitimately end up on multiple calendars/overlapping
  // shifts — this never blocks the save. The backend instead reports which
  // tiers conflict and waits for an explicit resubmission with
  // confirmConflicts: true before committing, which is the "scheduler
  // approves the conflict" step.
  async function handleSaveShift(confirmConflicts = false) {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, confirmConflicts };
      const data = editingShift
        ? await api.put(`/assignments/${editingShift.id}`, payload)
        : await api.post('/assignments', { ...payload, calendarId });
      if (data.requiresConfirmation) {
        setConflicts(data.conflicts || []);
        return;
      }
      setConflicts([]);
      setShiftModalOpen(false);
      await loadAssignments();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteShift() {
    setSaving(true);
    try {
      await api.del(`/assignments/${deleteTarget.id}`);
      setDeleteTarget(null);
      await loadAssignments();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function navigate(dir) {
    if (view === 'day') setAnchor(addDays(anchor, dir));
    else if (view === 'week') setAnchor(addDays(anchor, dir * 7));
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  }

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Click a shift to edit it. Past shifts are read-only."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {canFilterByLevel && (
              <div className="w-56">
                <OrganizationSelector value={viewOrgId} onChange={setViewOrgId} allowClear clearLabel="All Customers" placeholder="All Customers" />
              </div>
            )}
            <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className="w-48">
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {canEdit && calendarId && (
              <>
                <Button variant="secondary" onClick={() => setAutoOpen(true)}><Wand2 size={14} /> Auto-schedule</Button>
                <Button onClick={() => openCreate()}><Plus size={14} /> New shift</Button>
              </>
            )}
          </div>
        }
      />
      <Tabs tabs={VIEWS} active={view} onChange={setView} />

      <div className="px-4 sm:px-8 py-4 flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded hover:bg-surface text-muted"><ChevronLeft size={16} /></button>
        <span className="text-sm font-medium text-ink">
          {view === 'month'
            ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
            : `${rangeStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${rangeEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        </span>
        <button onClick={() => navigate(1)} className="p-1.5 rounded hover:bg-surface text-muted"><ChevronRight size={16} /></button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
      </div>

      <div className="px-4 sm:px-8 pb-8 space-y-3">
        {error && <ErrorBanner message={error} />}

        {!calendarId ? (
          <EmptyState title="No calendar selected" description="Create a calendar first from the Calendars page." />
        ) : loading ? (
          <LoadingBlock />
        ) : view === 'month' ? (
          <MonthGrid anchor={anchor} byDate={byDate} onSelectDay={(d) => { setAnchor(d); setView('day'); }} />
        ) : view === 'week' ? (
          <WeekGrid rangeStart={rangeStart} byDate={byDate} peopleById={peopleById} canEdit={canEdit}
            onCreate={openCreate} onEdit={openEdit} onDelete={setDeleteTarget} />
        ) : (
          <DayTimeline date={anchor} shifts={byDate[toISODate(anchor)] || []} peopleById={peopleById} canEdit={canEdit}
            onCreate={() => openCreate(toISODate(anchor))} onEdit={openEdit} onDelete={setDeleteTarget} />
        )}
      </div>

      <ShiftModal open={shiftModalOpen} onClose={() => setShiftModalOpen(false)} form={form} setForm={setForm}
        people={people} peopleById={peopleById} editingShift={editingShift} conflicts={conflicts}
        onSave={handleSaveShift} saving={saving} />

      <ConfirmDialog open={!!deleteTarget} title="Delete shift?" message="This removes the shift from the schedule."
        confirmLabel="Delete" onConfirm={handleDeleteShift} onCancel={() => setDeleteTarget(null)} loading={saving} />

      <AutoScheduleModal open={autoOpen} onClose={() => setAutoOpen(false)} calendarId={calendarId} people={people}
        onCommitted={() => { setAutoOpen(false); loadAssignments(); }} />
    </div>
  );
}

function ShiftCard({ shift, peopleById, canEdit, onEdit, onDelete }) {
  const disabled = isPast(shift.date);
  return (
    <div className="rounded-lg border border-line bg-white p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted">{shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}</span>
        {canEdit && !disabled && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => onEdit(shift)} className="p-1 rounded hover:bg-surface text-muted hover:text-ink"><Pencil size={12} /></button>
            <button onClick={() => onDelete(shift)} className="p-1 rounded hover:bg-surface text-muted hover:text-signal-red"><Trash2 size={12} /></button>
          </div>
        )}
      </div>
      <EscalationChain assignment={shift} peopleById={peopleById} />
    </div>
  );
}

function WeekGrid({ rangeStart, byDate, peopleById, canEdit, onCreate, onEdit, onDelete }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));
  return (
    // 7 fixed columns never fit a phone-width viewport — scroll horizontally
    // within this container instead of overflowing the whole page.
    <div className="overflow-x-auto">
      <div className="grid grid-cols-7 gap-3 min-w-[700px]">
        {days.map((d) => {
          const key = toISODate(d);
          const shifts = byDate[key] || [];
          return (
            <div key={key} className="min-h-[10rem]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted">{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</p>
                {canEdit && !isPast(key) && (
                  <button onClick={() => onCreate(key)} className="text-muted hover:text-ink"><Plus size={13} /></button>
                )}
              </div>
              <div className="space-y-2">
                {shifts.map((s) => <ShiftCard key={s.id} shift={s} peopleById={peopleById} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayTimeline({ date, shifts, peopleById, canEdit, onCreate, onEdit, onDelete }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">{date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        {canEdit && !isPast(toISODate(date)) && <Button size="sm" onClick={onCreate}><Plus size={13} /> Add shift</Button>}
      </div>
      {shifts.length === 0 ? (
        <EmptyState title="No shifts scheduled" />
      ) : (
        <div className="relative border border-line rounded-lg overflow-hidden">
          {HOURS.map((h) => (
            <div key={h} className="flex border-b border-line last:border-b-0 text-xs">
              <div className="w-14 shrink-0 px-2 py-2 text-muted border-r border-line">{h.toString().padStart(2, '0')}:00</div>
              <div className="flex-1 px-2 py-2 space-y-1">
                {shifts.filter((s) => timeToMinutes(s.start_time) < (h + 1) * 60 && timeToMinutes(s.end_time) > h * 60).map((s) => (
                  <div key={s.id} onClick={() => canEdit && !isPast(s.date) && onEdit(s)} className={`rounded-md bg-signal-amber/10 border border-signal-amber/30 px-2 py-1 ${canEdit ? 'cursor-pointer hover:bg-signal-amber/20' : ''}`}>
                    <EscalationChain assignment={s} peopleById={peopleById} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MonthGrid({ anchor, byDate, onSelectDay }) {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));
  return (
    <Card className="p-4">
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-7 text-xs font-medium text-muted mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((d) => {
              const key = toISODate(d);
              const count = (byDate[key] || []).length;
              const inMonth = d.getMonth() === anchor.getMonth();
              return (
                <button key={key} onClick={() => onSelectDay(d)}
                  className={`text-left rounded-lg border border-line p-2 h-20 hover:border-ink/30 ${inMonth ? 'bg-white' : 'bg-surface text-muted'}`}>
                  <span className="text-xs">{d.getDate()}</span>
                  {count > 0 && <span className="block mt-1 text-[10px] font-medium text-signal-amber">{count} shift{count > 1 ? 's' : ''}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

const MODE_OPTIONS = [
  {
    value: 'escalation', icon: ArrowDown, title: 'Escalation Chain',
    description: "Primary → Secondary → Tertiary → Default. Each contacted in order if the previous doesn't respond.",
  },
  {
    value: 'broadcast', icon: Radio, title: 'Broadcast / First-Accept',
    description: 'Offer the shift to a pool of people simultaneously. First person to accept gets assigned.',
  },
];

// The same four tiers back both modes — only the description of what each
// tier means changes. Primary and Default are the only mandatory tiers
// (enforced by the disabled Save button below and mirrored server-side);
// they may be the same person.
const TIER_DEFS = [
  {
    key: 'primaryPersonId', num: 1, label: 'Primary', tone: 'blue', required: true,
    escalation: 'First person contacted when the shift triggers.',
    broadcast: 'Offered the shift immediately, alongside Secondary/Tertiary if set.',
  },
  {
    key: 'secondaryPersonId', num: 2, label: 'Secondary', tone: 'green', required: false,
    escalation: 'Contacted if Primary does not respond within the configured timeout.',
    broadcast: 'Offered the shift at the same time as Primary.',
  },
  {
    key: 'tertiaryPersonId', num: 3, label: 'Tertiary', tone: 'purple', required: false,
    escalation: 'Contacted if Primary and Secondary both do not respond.',
    broadcast: 'Offered the shift at the same time as Primary.',
  },
  {
    key: 'defaultPersonId', num: 4, label: 'Default', tone: 'amber', required: true,
    escalation: 'Used when no one is assigned, or all of the above fail to respond.',
    broadcast: 'Assigned automatically if no one accepts the broadcast.',
  },
];

function ShiftModal({ open, onClose, form, setForm, people, peopleById, editingShift, conflicts, onSave, saving }) {
  const personOptions = (
    <>
      <option value="">— None —</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </>
  );
  const hasConflicts = conflicts?.length > 0;
  const canSave = !!form.primaryPersonId && !!form.defaultPersonId;

  return (
    <Modal open={open} onClose={onClose} title={editingShift ? 'Edit shift' : 'Create On-Call Assignment'} size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(hasConflicts)} loading={saving} disabled={!canSave} variant={hasConflicts ? 'danger' : undefined}>
            {hasConflicts ? 'Save anyway' : (editingShift ? 'Save' : 'Create')}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Start Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={!!editingShift} /></Field>
          <Field label="Start Time"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} disabled={!!editingShift} /></Field>
          <Field label="End Time"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} disabled={!!editingShift} /></Field>
        </div>
        {editingShift && <p className="text-xs text-muted -mt-2">Date/time are locked once created — delete and recreate to reschedule.</p>}

        <div>
          <span className="block text-xs font-medium text-ink mb-1">Assignment Mode</span>
          <div className="grid grid-cols-2 gap-3">
            {MODE_OPTIONS.map((m) => {
              const selected = form.mode === m.value;
              return (
                <button key={m.value} type="button" disabled={!!editingShift}
                  onClick={() => setForm({ ...form, mode: m.value })}
                  className={`text-left rounded-lg border p-3 space-y-1 transition-colors ${
                    selected ? 'border-signal-amber bg-signal-amber/5' : 'border-line hover:border-ink/20'
                  } ${editingShift ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <div className="flex items-center gap-2">
                    <m.icon size={15} className={selected ? 'text-signal-amber' : 'text-muted'} />
                    <span className="text-sm font-semibold text-ink">{m.title}</span>
                  </div>
                  <p className="text-xs text-muted">{m.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-ink mb-2">
            {form.mode === 'escalation' ? 'Escalation Chain' : 'Broadcast Pool'}
          </span>
          <div className="space-y-2.5">
            {TIER_DEFS.map((t) => (
              <div key={t.key} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="h-5 w-5 rounded-full bg-surface border border-line flex items-center justify-center text-[11px] font-medium text-ink">{t.num}</span>
                    <Badge tone={t.tone}>{t.label}{t.required ? ' *' : ''}</Badge>
                  </div>
                  <p className="text-xs text-muted text-right">{form.mode === 'escalation' ? t.escalation : t.broadcast}</p>
                </div>
                <Select value={form[t.key]} onChange={(e) => setForm({ ...form, [t.key]: e.target.value })}>
                  {personOptions}
                </Select>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-1.5">* Primary and Default are required to schedule — they may be the same person.</p>
        </div>

        {hasConflicts && (
          <div className="rounded-lg border border-signal-red/30 bg-signal-red/5 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-signal-red">
              <AlertTriangle size={14} />
              <p className="text-xs font-semibold">Scheduling conflicts detected — review before saving</p>
            </div>
            <ul className="text-xs text-ink space-y-1 list-disc list-inside">
              {conflicts.map((c, idx) => (
                <li key={idx}>
                  <span className="font-medium capitalize">{c.tier}</span>
                  {' '}({peopleById[c.personId]?.name || 'Unknown'}) is already on call:{' '}
                  {c.conflictsWith.map((cw) => `${cw.calendar_name} ${cw.start_time?.slice(0, 5)}–${cw.end_time?.slice(0, 5)}`).join(', ')}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Saving anyway will knowingly double-book this person across calendars.</p>
          </div>
        )}

        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex items-center gap-4">
          <Checkbox label="Notify via Slack" checked={form.notifySlack} onChange={(e) => setForm({ ...form, notifySlack: e.target.checked })} />
          <Checkbox label="Notify via email" checked={form.notifyEmail} onChange={(e) => setForm({ ...form, notifyEmail: e.target.checked })} />
        </div>

        {!editingShift && (
          <Field label="Repeat weekly for (months)" hint="0 = just this one shift, up to 36 months">
            <Input type="number" min={0} max={36} value={form.replicateMonths} onChange={(e) => setForm({ ...form, replicateMonths: Number(e.target.value) })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_PRESETS = [
  { label: 'All days', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays (Mon–Fri)', days: [1, 2, 3, 4, 5] },
  { label: 'After hours (Mon–Thu)', days: [1, 2, 3, 4] },
  { label: 'Weekend (Sat–Sun)', days: [6, 0] },
];

let ruleIdCounter = 0;
function makeRule(overrides = {}) {
  return {
    id: `rule-${++ruleIdCounter}`,
    label: '',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '09:00',
    endTime: '17:00',
    rotationDays: 7,
    personIds: [],
    ...overrides,
  };
}

// Rules are meant to partition the week (e.g. "after hours Mon-Thu" +
// "weekends" as two separate pools) — a day claimed by more than one rule
// would silently double-book that date, so this is checked client-side
// before hitting the API's identical server-side check.
function findDayOverlap(rules) {
  const claimedBy = new Map();
  for (let i = 0; i < rules.length; i++) {
    for (const day of rules[i].daysOfWeek) {
      if (claimedBy.has(day)) {
        return `${DAY_LABELS[day]} is selected in more than one rule below — each day can only belong to one rule.`;
      }
      claimedBy.set(day, i);
    }
  }
  return null;
}

function AutoScheduleModal({ open, onClose, calendarId, people, onCommitted }) {
  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [endDate, setEndDate] = useState(toISODate(addDays(new Date(), 27)));
  const [rules, setRules] = useState(() => [makeRule()]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function updateRule(id, patch) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPreview(null);
  }

  function toggleDay(id, day) {
    setRules((prev) => prev.map((r) => (r.id === id
      ? { ...r, daysOfWeek: r.daysOfWeek.includes(day) ? r.daysOfWeek.filter((d) => d !== day) : [...r.daysOfWeek, day].sort() }
      : r)));
    setPreview(null);
  }

  function togglePerson(id, personId) {
    setRules((prev) => prev.map((r) => (r.id === id
      ? { ...r, personIds: r.personIds.includes(personId) ? r.personIds.filter((x) => x !== personId) : [...r.personIds, personId] }
      : r)));
    setPreview(null);
  }

  function addRule() {
    setRules((prev) => [...prev, makeRule({ daysOfWeek: [], startTime: '17:00', endTime: '09:00' })]);
    setPreview(null);
  }

  function removeRule(id) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    setPreview(null);
  }

  const overlapError = findDayOverlap(rules);
  const incomplete = rules.some((r) => r.daysOfWeek.length === 0 || r.personIds.length === 0);

  function buildPayload() {
    return {
      calendarId,
      startDate,
      endDate,
      rules: rules.map((r, i) => ({
        label: r.label.trim() || `Rule ${i + 1}`,
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
        personIds: r.personIds,
        rotationDays: Number(r.rotationDays),
      })),
    };
  }

  async function handlePreview() {
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/auto-schedule/preview', buildPayload());
      setPreview(data.preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    setLoading(true);
    setError('');
    try {
      await api.post('/auto-schedule/commit', buildPayload());
      onCommitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Auto-schedule" size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {!preview ? (
            <Button onClick={handlePreview} loading={loading} disabled={incomplete || !!overlapError}>Preview</Button>
          ) : (
            <Button onClick={handleCommit} loading={loading}>Commit {preview.length} shifts</Button>
          )}
        </>
      }>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {overlapError && <ErrorBanner message={overlapError} />}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPreview(null); }} /></Field>
          <Field label="End date"><Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPreview(null); }} /></Field>
        </div>

        <div className="space-y-3">
          {rules.map((rule, i) => (
            <div key={rule.id} className="border border-line rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Input value={rule.label} onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                  placeholder={`Rule ${i + 1} (e.g. After hours Mon–Thu)`} className="text-sm" />
                {rules.length > 1 && (
                  <button type="button" onClick={() => removeRule(rule.id)} className="text-muted hover:text-signal-red shrink-0 p-1.5">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <Field label="Days of week">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {DAY_PRESETS.map((preset) => (
                    <button key={preset.label} type="button"
                      onClick={() => updateRule(rule.id, { daysOfWeek: [...preset.days] })}
                      className="text-[11px] px-2 py-1 rounded-full border border-line text-muted hover:bg-surface hover:text-ink">
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((label, day) => (
                    <button key={day} type="button" onClick={() => toggleDay(rule.id, day)}
                      className={`w-9 h-9 rounded-full text-xs font-medium border ${
                        rule.daysOfWeek.includes(day) ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:bg-surface'
                      }`}>
                      {label[0]}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Shift start"><Input type="time" value={rule.startTime} onChange={(e) => updateRule(rule.id, { startTime: e.target.value })} /></Field>
                <Field label="Shift end"><Input type="time" value={rule.endTime} onChange={(e) => updateRule(rule.id, { endTime: e.target.value })} /></Field>
                <Field label="Rotate every" hint="matching shifts">
                  <Input type="number" min={1} value={rule.rotationDays} onChange={(e) => updateRule(rule.id, { rotationDays: e.target.value })} />
                </Field>
              </div>

              <Field label="Rotation pool">
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {people.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePerson(rule.id, p.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${rule.personIds.includes(p.id) ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:bg-surface'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ))}
        </div>

        <Button variant="secondary" size="sm" onClick={addRule}><Plus size={14} /> Add rule</Button>

        {preview && (
          <div className="border border-line rounded-lg max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-line text-left text-muted"><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Rule</th><th className="px-3 py-1.5">Primary</th><th className="px-3 py-1.5">Secondary</th></tr></thead>
              <tbody className="divide-y divide-line">
                {preview.map((slot, i) => (
                  <tr key={`${slot.date}-${i}`}>
                    <td className="px-3 py-1.5">{slot.date}</td>
                    <td className="px-3 py-1.5 text-muted">{slot.ruleLabel}</td>
                    <td className="px-3 py-1.5">{people.find((p) => p.id === slot.primaryPersonId)?.name}</td>
                    <td className="px-3 py-1.5">{people.find((p) => p.id === slot.secondaryPersonId)?.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
