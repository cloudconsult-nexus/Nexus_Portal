import { useEffect, useState } from 'react';
import { PageHeader, Card, Button, Input, Field, Textarea, LoadingBlock, ErrorBanner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import LogoUpload from '../components/LogoUpload.jsx';

const FIELDS = [
  'name', 'phone', 'email', 'website', 'address', 'primary_contact', 'call_messages_url',
  'name_override', 'tagline', 'primary_color', 'accent_color', 'description', 'message_html',
];

// TAS-wide instance settings (Global Admin only) — the singleton config
// that replaced the old single master_organization row's branding fields.
// See migrations/013_tas_customer_model.sql and routes/tasSettings.js.
export default function TasSettings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { tasSettings } = await api.get('/tas-settings');
      setSettings(tasSettings);
      setForm(tasSettings);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const payload = {};
      FIELDS.forEach((f) => {
        const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        payload[camel] = form[f] ?? '';
      });
      const { tasSettings } = await api.put('/tas-settings', payload);
      setSettings(tasSettings);
      setForm(tasSettings);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="TAS Settings" description="Instance-wide branding and contact info — every Customer inherits from this unless it overrides a field itself." />
      <div className="p-8 max-w-2xl space-y-6">
        {error && <ErrorBanner message={error} />}
        {loading || !form ? (
          <LoadingBlock />
        ) : (
          <>
            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold text-ink">Contact details</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="TAS name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Website"><Input value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
                <Field label="Primary contact"><Input value={form.primary_contact || ''} onChange={(e) => setForm({ ...form, primary_contact: e.target.value })} /></Field>
              </div>
              <Field label="Address"><Input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
              <Field label="Call messages URL"><Input value={form.call_messages_url || ''} onChange={(e) => setForm({ ...form, call_messages_url: e.target.value })} /></Field>
            </Card>

            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold text-ink">Branding <span className="text-xs font-normal text-muted">(the default every Customer inherits from)</span></h3>
              <Field label="Logo">
                <LogoUpload organizationId="tas" imageUrl={form.logo_url} kind="logo" uploadPath="/tas-settings/logo"
                  onUploaded={(url) => setForm({ ...form, logo_url: url })} />
              </Field>
              <Field label="Favicon">
                <LogoUpload organizationId="tas" imageUrl={form.favicon_url} kind="favicon" uploadPath="/tas-settings/favicon"
                  onUploaded={(url) => setForm({ ...form, favicon_url: url })} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Display name override" hint="Shown instead of the TAS name in the sidebar/login screen"><Input value={form.name_override || ''} onChange={(e) => setForm({ ...form, name_override: e.target.value })} /></Field>
                <Field label="Tagline"><Input value={form.tagline || ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></Field>
                <Field label="Primary color"><Input type="color" value={form.primary_color || '#1B2333'} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} /></Field>
                <Field label="Accent color"><Input type="color" value={form.accent_color || '#F5A623'} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} /></Field>
              </div>
              <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <Field label="Message HTML"><Textarea rows={3} value={form.message_html || ''} onChange={(e) => setForm({ ...form, message_html: e.target.value })} /></Field>
            </Card>

            <div className="flex items-center justify-end gap-3">
              {saved && <span className="text-xs text-signal-green">Saved.</span>}
              <Button onClick={handleSave} loading={saving}>Save changes</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
