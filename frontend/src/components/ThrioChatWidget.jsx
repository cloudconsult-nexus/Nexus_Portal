import { useEffect } from 'react';

// Live chat widget (Thrio/NCC) — a floating widget the vendor's own script
// injects into the page, not an iframe embed like Customer Messages/Secure
// Messaging (routes/customerMessages.js) use. Deliberately separate from
// those two nav stubs per 2026-08-11 discussion — this isn't meant to
// become either of them, just its own thing.
//
// Config is hardcoded (same values across test/prod) rather than
// env-var-driven — revisit if/when multi-tenant onboarding (Phase 5.5)
// needs a different Thrio tenant/campaign per TAS instance.
const THRIO_PARAMS = {
  host: 'mancity.thrio.io',
  tenantId: '4287060',
  campaignId: '6a6c9cf8244e7d66cb9c69fa',
  // Verbose widget-internal logging to the browser console — fine for
  // validating this in test, worth turning off (or gating on NODE_ENV)
  // once it's confirmed working, so prod users' consoles stay clean.
  trace: true,
  context: {},
};

const SCRIPT_SRC = 'https://storage.googleapis.com/thrio-public-prod-files/thriowidgets-1.4.1.js';

// Module-level, not component state: Shell (App.jsx) can mount fresh on
// every route change (each route wraps its page in its own <Protected>),
// so this guards against injecting the vendor script more than once per
// page load rather than tying "already loaded" to this component's
// lifecycle.
let injected = false;

// Renders nothing itself — the vendor script owns its own floating UI
// once loaded, appended directly to <body>.
export default function ThrioChatWidget() {
  useEffect(() => {
    if (injected) return;
    injected = true;

    window.thrioParams = THRIO_PARAMS;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = SCRIPT_SRC;
    // The vendor script only initializes inside its own
    // `window.addEventListener('load', ...)` handler (confirmed by reading
    // the actual source at SCRIPT_SRC) — but by the time this component
    // mounts, well after the SPA's real page load, that event has already
    // fired once and won't fire again, so the listener registers too late
    // and silently never runs (no error, no log, no network call — it just
    // never executes). Re-dispatching a synthetic 'load' event on window
    // once our script has actually loaded triggers it manually. This is a
    // page-wide event, so in principle it could also re-trigger some other
    // unrelated 'load' listener elsewhere in the app — not a concern today
    // (nothing else in this codebase listens for it), but worth knowing if
    // that ever changes.
    script.onload = () => window.dispatchEvent(new Event('load'));
    document.body.appendChild(script);
  }, []);

  return null;
}
