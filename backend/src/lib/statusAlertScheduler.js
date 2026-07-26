import pool from '../db/pool.js';

const EVALUATE_INTERVAL_MS = 60_000;

// Maintains status_alerts.is_currently_active on a timer rather than
// computing it on every read, so the public external-display endpoint
// (routes/statusAlerts.js) stays a cheap indexed lookup — see
// migrations/010_status_alerts.sql's header comment.
export function startStatusAlertScheduler() {
  evaluateAll().catch((err) => console.error('statusAlertScheduler: initial evaluation failed', err));
  const timer = setInterval(() => {
    evaluateAll().catch((err) => console.error('statusAlertScheduler: evaluation failed', err));
  }, EVALUATE_INTERVAL_MS);
  timer.unref(); // don't keep the process alive just for this
  return timer;
}

async function evaluateAll() {
  const { rows } = await pool.query('SELECT * FROM status_alerts WHERE is_enabled = true');
  const now = new Date();

  for (const alert of rows) {
    const active = isActiveNow(alert, now);
    await pool.query(
      `UPDATE status_alerts SET is_currently_active = $1, last_evaluated_at = now() WHERE id = $2`,
      [active, alert.id]
    );
  }

  // Alerts that got disabled since the last pass won't show up in the
  // is_enabled=true query above, so their is_currently_active flag would
  // otherwise stay stale at true.
  await pool.query(
    `UPDATE status_alerts SET is_currently_active = false, last_evaluated_at = now()
     WHERE is_enabled = false AND is_currently_active = true`
  );
}

function isActiveNow(alert, now) {
  if (alert.alert_type === 'one_time') {
    return alert.start_at && alert.end_at && now >= new Date(alert.start_at) && now <= new Date(alert.end_at);
  }

  // recurring
  const today = now.toISOString().slice(0, 10);
  if (alert.recurrence_start_date && today < alert.recurrence_start_date) return false;
  if (alert.recurrence_end_date && today > alert.recurrence_end_date) return false;

  const dayOfWeek = now.getUTCDay(); // 0=Sunday..6=Saturday, matches migration's comment
  if (!alert.recurrence_days?.includes(dayOfWeek)) return false;

  const currentTime = now.toISOString().slice(11, 19); // HH:MM:SS
  return currentTime >= alert.recurrence_start_time && currentTime <= alert.recurrence_end_time;
}
