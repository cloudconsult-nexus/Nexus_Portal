import 'dotenv/config';
import app from './app.js';
import { startStatusAlertScheduler } from './lib/statusAlertScheduler.js';

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

// Defense-in-depth for rejections outside the Express request cycle (e.g. a
// fire-and-forget query). Logs instead of silently dying; Cloud Run will
// restart the container if the process does eventually exit.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`oncall-pro-api listening on :${port}`));

startStatusAlertScheduler();
