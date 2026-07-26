import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Input, Field, ErrorBanner, Card } from '../components/ui.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Always 204 regardless of whether the account exists (routes/auth.js)
      // — the UI shows the same success state either way, by design.
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <Card className="w-full max-w-sm p-8">
        {sent ? (
          <div className="text-center">
            <MailCheck size={28} className="text-signal-green mx-auto mb-2" />
            <h1 className="text-lg font-semibold text-ink">Check your email</h1>
            <p className="text-sm text-muted mt-2">If an account exists for {email}, we've sent a link to reset the password.</p>
            <Link to="/login" className="inline-block mt-5 text-sm text-ink hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-ink mb-1">Reset your password</h1>
            <p className="text-xs text-muted mb-5">Enter your email and we'll send you a reset link.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </Field>
              <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
            </form>
            <div className="flex justify-center mt-4">
              <Link to="/login" className="text-xs text-muted hover:text-ink hover:underline">Back to sign in</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
