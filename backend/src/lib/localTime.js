// "What local wall-clock date/time is this instant, in this IANA zone" —
// needed because assignments.date/start_time/end_time (migrations/
// 001_init.sql) are plain DATE/TIME columns with no timezone attached.
// See migrations/017_tas_settings_timezone.sql for where the single
// deployment-wide zone this resolves against actually lives.
//
// Uses Intl.DateTimeFormat rather than a date library — Node's built-in
// ICU already covers this, no new dependency needed for one conversion.
export function resolveLocalDateTime(isoTimestamp, timezone) {
  const instant = new Date(isoTimestamp);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid timestamp: ${isoTimestamp}`);
  }

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    // Intl throws RangeError for an unrecognized IANA zone name — surface
    // as a plain Error so callers don't have to know that detail.
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  // en-CA gives YYYY-MM-DD ordering for date parts, which is also exactly
  // Postgres's DATE input format — no reassembly needed there.
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // hour12: false can still format midnight as "24" in some ICU
    // versions rather than "00" — normalize so this is always a valid
    // Postgres TIME literal.
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`,
  };
}
