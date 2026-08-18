import express from 'express';
import 'express-async-errors'; // must be required after express, before routes
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { ZodError } from 'zod';

import authRoutes from './routes/auth.js';
import organizationsRoutes from './routes/organizations.js';
import tasSettingsRoutes from './routes/tasSettings.js';
import peopleRoutes from './routes/people.js';
import calendarsRoutes from './routes/calendars.js';
import assignmentsRoutes from './routes/assignments.js';
import autoScheduleRoutes from './routes/autoSchedule.js';
import shiftSwapsRoutes from './routes/shiftSwaps.js';
import contactChangesRoutes from './routes/contactChanges.js';
import auditLogsRoutes from './routes/auditLogs.js';
import reportsRoutes from './routes/reports.js';
import invitationsRoutes from './routes/invitations.js';
import importsRoutes from './routes/imports.js';
import reportMappingsRoutes from './routes/reportMappings.js';
import customerMessagesRoutes from './routes/customerMessages.js';
import statusAlertsRoutes from './routes/statusAlerts.js';
import publicBrandingRoutes from './routes/publicBranding.js';
import onCallRoutes from './routes/onCall.js';

// Express app construction, split out from index.js so tests can
// supertest() it directly without binding a port or starting the
// background status-alert scheduler.
const app = express();

// crossOriginResourcePolicy: helmet's default is 'same-origin', which blocks
// the browser from consuming *any* cross-origin response — independent of
// and stricter than the cors() policy below. api and web are deployed as
// separate Cloud Run services (different origins), so every response needs
// to be readable cross-origin; cors() below is what actually restricts which
// origins may do so.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// .trim() each entry: CORS_ORIGIN is operator-entered (Cloud Run console/
// deploy scripts), and cors() does exact string matching against Origin —
// a single stray leading/trailing space or newline from a copy-paste is
// invisible in the console but silently fails every preflight (no
// Access-Control-Allow-Origin on the response, no error, just a browser-side
// "Failed to fetch" with nothing useful server-side to point at).
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Not /healthz — that exact literal path is intercepted by Google's edge
// infrastructure before reaching any Cloud Run backend, globally, regardless
// of project/service (confirmed empirically: identical requests to /HEALTHZ,
// /healthz2, or any other path reach the app fine; only exact-lowercase
// /healthz never does). See RUNBOOK.md for the investigation.
app.get('/_health', (req, res) => res.json({ status: 'ok' }));

// Local-dev logo storage fallback (see lib/storage.js) — served across origins
// since the web app runs on a different port than the API. The global
// crossOriginResourcePolicy override above covers this now; production
// doesn't hit this route at all (real uploads go to GCS).
app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'))
);

// Unauthenticated by design — see routes/publicBranding.js.
app.use('/public-branding', publicBrandingRoutes);

app.use('/auth', authRoutes);
// Mounted BEFORE organizationsRoutes, same '/organizations' prefix: it's a
// separate router, service-API-key-gated (NCC), not human-JWT-gated — see
// routes/onCall.js. organizationsRoutes' own top-level `router.use(requireAuth,
// ...)` is unconditional (no path filter), so it intercepts every request
// under '/organizations/*' before Express even checks that router's own
// route patterns — mounting onCallRoutes second would never be reached.
// onCallRoutes only claims the exact '/:orgId/on-call' GET route and falls
// through (next()) for everything else, so organizationsRoutes still
// handles all of its own paths normally.
app.use('/organizations', onCallRoutes);
app.use('/organizations', organizationsRoutes);
app.use('/tas-settings', tasSettingsRoutes);
app.use('/people', peopleRoutes);
app.use('/calendars', calendarsRoutes);
app.use('/assignments', assignmentsRoutes);
app.use('/auto-schedule', autoScheduleRoutes);
app.use('/shift-swaps', shiftSwapsRoutes);
app.use('/contact-changes', contactChangesRoutes);
app.use('/audit-logs', auditLogsRoutes);
app.use('/reports', reportsRoutes);
app.use('/invitations', invitationsRoutes);
app.use('/imports', importsRoutes);
app.use('/report-mappings', reportMappingsRoutes);
app.use('/customer-messages', customerMessagesRoutes);
app.use('/status-alerts', statusAlertsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Centralized error handler — catches anything thrown/rejected in a route
// that wasn't already caught locally.
app.use((err, req, res, next) => {
  // Every route validates its input with `schema.parse(req.body)` (zod)
  // rather than a try/catch of its own, relying on this handler to turn a
  // thrown ZodError into a response. Without this branch, a malformed
  // request (missing field, wrong type, wrong auth shape — e.g. a client
  // sending HTTP Basic Auth to /auth/login instead of a JSON body) fell
  // through to the generic 500 below, indistinguishable from an actual
  // server fault. Not a real error, so it's also not console.error'd.
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid request',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
