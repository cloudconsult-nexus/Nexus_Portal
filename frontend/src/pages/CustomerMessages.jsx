import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '../lib/api.js';
import { PageHeader, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

// Nav/permission scaffolding (CLAUDE.md) — no database table, just a single
// env-var-driven embed target (see routes/customerMessages.js).
export default function CustomerMessages() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/customer-messages').then(setState).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <PageHeader title="Customer Messages" description="Embedded customer messaging, configured per deployment." />
      <div className="p-8">
        {error && <ErrorBanner message={error} />}
        {!state ? (
          <LoadingBlock />
        ) : !state.configured ? (
          <EmptyState icon={MessageSquare} title="Not configured" description="Set CUSTOMER_MESSAGING_URL (and optionally an SSO secret) on the API service to enable this." />
        ) : (
          <iframe src={state.embedUrl} title="Customer Messages" className="w-full rounded-xl border border-line" style={{ height: 'calc(100vh - 160px)' }} />
        )}
      </div>
    </div>
  );
}
