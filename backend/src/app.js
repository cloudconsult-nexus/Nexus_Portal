import express from 'express';
import 'express-async-errors'; // must be required after express, before routes
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';

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

// Express app construction, split out from index.js so tests can
// supertest() it directly without binding a port or starting the
// background status-alert scheduler.
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Not /healthz — that exact literal path is intercepted by Google's edge
// infrastructure before reaching any Cloud Run backend, globally, regardless
// of project/service (confirmed empirically: identical requests to /HEALTHZ,
// /healthz2, or any other path reach the app fine; only exact-lowercase
// /healthz never does). See RUNBOOK.md for the investigation.
app.get('/_health', (req, res) => res.json({ status: 'ok' }));

// Local-dev logo storage fallback (see lib/storage.js) — served across origins
// since the web app runs on a different port than the API. helmet's default
// same-origin Cross-Origin-Resource-Policy would otherwise block the <img>
// load; production doesn't hit this route at all (real uploads go to GCS).
app.use(
  '/uploads',
  (req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next(); },
  express.static(path.join(process.cwd(), 'uploads'))
);

// Unauthenticated by design — see routes/publicBranding.js.
app.use('/public-branding', publicBrandingRoutes);

app.use('/auth', authRoutes);
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
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
