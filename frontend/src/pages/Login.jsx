import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth, ApiError } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { Button, Input, Field, ErrorBanner, Card } from '../components/ui.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, mfaRequired ? mfaToken : undefined);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.body?.mfaRequired) {
        setMfaRequired(true);
        setError('Enter your 6-digit authenticator code to continue.');
      } else if (err instanceof ApiError && err.status === 423) {
        setError(err.message);
      } else {
        setError(err.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="flex flex-col items-center text-center mb-6">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.nameOverride || 'Nexus Portal'} className="h-9 mb-3 object-contain" />
          ) : (
            <ShieldCheck size={28} className="text-signal-amber mb-2" />
          )}
          <h1 className="text-lg font-semibold text-ink">{branding.nameOverride || 'Nexus Portal'}</h1>
          <p className="text-xs text-muted mt-1">Sign in to OnCall Pro</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus disabled={mfaRequired} />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={mfaRequired} />
          </Field>
          {mfaRequired && (
            <Field label="Authenticator code">
              <Input value={mfaToken} onChange={(e) => setMfaToken(e.target.value)} inputMode="numeric" maxLength={6} autoFocus />
            </Field>
          )}
          <Button type="submit" className="w-full" loading={loading}>{mfaRequired ? 'Verify' : 'Sign in'}</Button>
        </form>

        <div className="flex justify-center mt-4">
          <Link to="/forgot-password" className="text-xs text-muted hover:text-ink hover:underline">Forgot password?</Link>
        </div>
      </Card>
    </div>
  );
}
