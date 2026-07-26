import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Input, Field, ErrorBanner, Card } from '../components/ui.jsx';

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');

    setLoading(true);
    try {
      await api.post('/auth/accept-invite', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(err.message || 'Invalid or expired invitation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <Card className="w-full max-w-sm p-8">
        {done ? (
          <div className="text-center">
            <CheckCircle2 size={28} className="text-signal-green mx-auto mb-2" />
            <h1 className="text-lg font-semibold text-ink">You're all set</h1>
            <p className="text-sm text-muted mt-2">Redirecting you to sign in…</p>
          </div>
        ) : !token ? (
          <div className="text-center">
            <ErrorBanner message="This invitation link is missing its token." />
            <Link to="/login" className="inline-block mt-5 text-sm text-ink hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-ink mb-1">Welcome to Nexus Portal</h1>
            <p className="text-xs text-muted mb-5">Set a password to activate your account.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <Field label="Password" hint="At least 8 characters">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              </Field>
              <Field label="Confirm password">
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
              <Button type="submit" className="w-full" loading={loading}>Activate account</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
