import { ArrowRight, UserRound, Users } from 'lucide-react';

const TIERS = [
  { role: 'primary', personKey: 'primary_person_id', timeoutKey: 'primary_timeout_min' },
  { role: 'secondary', personKey: 'secondary_person_id', timeoutKey: 'secondary_timeout_min' },
  { role: 'tertiary', personKey: 'tertiary_person_id', timeoutKey: null },
  { role: 'default', personKey: 'default_person_id', timeoutKey: null },
];

// Which tier is currently "live" for an in-progress escalation-mode shift —
// primary until its timeout elapses, then secondary until its timeout
// elapses, then whichever of tertiary/default exists. Static shifts (not
// happening right now) render with no pulse at all.
function getLiveTierIndex(assignment, tiers) {
  const now = new Date();
  const [y, m, d] = assignment.date.slice(0, 10).split('-').map(Number);
  const start = new Date(y, m - 1, d, ...assignment.start_time.split(':').map(Number));
  const end = new Date(y, m - 1, d, ...assignment.end_time.split(':').map(Number));
  if (now < start || now > end) return -1;

  const elapsedMin = (now - start) / 60000;
  let threshold = 0;
  for (let i = 0; i < tiers.length; i++) {
    const timeoutMin = assignment[tiers[i].timeoutKey] ?? null;
    if (timeoutMin == null || elapsedMin < threshold + timeoutMin) return i;
    threshold += timeoutMin;
  }
  return tiers.length - 1;
}

function PersonChip({ person, live, label }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div className={`relative h-9 w-9 rounded-full overflow-hidden bg-surface border border-line flex items-center justify-center ${live ? 'pulse-live ring-2 ring-signal-green' : ''}`}>
        {person?.photo_url ? (
          <img src={person.photo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserRound size={16} className="text-muted" />
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-ink leading-tight">{person?.name || 'Unassigned'}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}

export default function EscalationChain({ assignment, peopleById = {} }) {
  if (!assignment) return null;

  if (assignment.mode === 'broadcast') {
    const pool = assignment.broadcast_pool || [];
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Users size={14} className="text-muted" />
        {pool.length === 0 && <span className="text-xs text-muted">No one in broadcast pool</span>}
        {pool.map((id) => {
          const person = peopleById[id];
          const accepted = assignment.accepted_by === id;
          return (
            <span key={id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${accepted ? 'border-signal-green/30 bg-signal-green/10 text-signal-green' : 'border-line text-ink'}`}>
              {person?.name || 'Unknown'} {accepted && '✓'}
            </span>
          );
        })}
      </div>
    );
  }

  const tiers = TIERS.filter((t) => assignment[t.personKey]);
  if (tiers.length === 0) return <span className="text-xs text-muted">No escalation chain configured</span>;

  const liveIndex = getLiveTierIndex(assignment, tiers);

  return (
    <div className="flex items-center gap-2">
      {tiers.map((tier, i) => (
        <div key={tier.role} className="flex items-center gap-2">
          {i > 0 && <ArrowRight size={13} className="text-muted shrink-0" />}
          <PersonChip person={peopleById[assignment[tier.personKey]]} live={i === liveIndex} label={tier.role} />
        </div>
      ))}
    </div>
  );
}
