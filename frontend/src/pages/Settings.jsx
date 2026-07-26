import { useState } from 'react';
import { ShieldCheck, ShieldOff, Copy } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { ROLE_LABELS } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, ErrorBanner } from '../components/ui.jsx';

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [otpAuthUrl, setOtpAuthUrl] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const secret = otpAuthUrl ? new URL(otpAuthUrl).searchParams.get('secret') : '';

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);
    if (newPassword.length < 8) return setPasswordError('New password must be at least 8 characters');
    if (newPassword !== confirmPassword) return setPasswordError('New passwords do not match');

    setPasswordSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(err.message || 'Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function startEnroll() {
    setError('');
    setSaving(true);
    try {
      const data = await api.post('/auth/mfa/enroll');
      setOtpAuthUrl(data.otpAuthUrl);
      setEnrolling(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmEnroll() {
    setError('');
    setSaving(true);
    try {
      await api.post('/auth/mfa/verify', { token: mfaToken });
      setEnrolling(false);
      setMfaToken('');
      await refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Your account and security preferences." />
      <div className="p-8 max-w-2xl space-y-6">
        <Card className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">Profile</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-muted">Name</p><p className="text-ink">{user?.name}</p></div>
            <div><p className="text-xs text-muted">Email</p><p className="text-ink">{user?.email}</p></div>
            <div><p className="text-xs text-muted">Role</p><p className="text-ink">{ROLE_LABELS[user?.role]}</p></div>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-ink">Change password</h3>
          {passwordError && <ErrorBanner message={passwordError} />}
          {passwordSaved && <p className="text-sm text-signal-green">Password updated.</p>}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <Field label="Current password">
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 8 characters">
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
            </Field>
            <Button type="submit" loading={passwordSaving}>Update password</Button>
          </form>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            {user?.mfaEnabled ? <ShieldCheck size={16} className="text-signal-green" /> : <ShieldOff size={16} className="text-muted" />}
            <h3 className="text-sm font-semibold text-ink">Two-factor authentication</h3>
          </div>
          {error && <ErrorBanner message={error} />}

          {user?.mfaEnabled ? (
            <p className="text-sm text-muted">Two-factor authentication is enabled on your account.</p>
          ) : !enrolling ? (
            <>
              <p className="text-sm text-muted">Add an authenticator app (Google Authenticator, 1Password, Authy) as a second factor on login.</p>
              <Button onClick={startEnroll} loading={saving}>Enable two-factor authentication</Button>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">Scan or enter this key into your authenticator app, then confirm with a generated code.</p>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                <code className="text-xs font-mono flex-1 break-all">{secret}</code>
                <button onClick={() => navigator.clipboard.writeText(secret)} className="text-muted hover:text-ink"><Copy size={14} /></button>
              </div>
              <Field label="6-digit code">
                <Input value={mfaToken} onChange={(e) => setMfaToken(e.target.value)} inputMode="numeric" maxLength={6} className="max-w-[10rem]" />
              </Field>
              <div className="flex gap-2">
                <Button onClick={confirmEnroll} loading={saving} disabled={mfaToken.length !== 6}>Confirm</Button>
                <Button variant="secondary" onClick={() => setEnrolling(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
