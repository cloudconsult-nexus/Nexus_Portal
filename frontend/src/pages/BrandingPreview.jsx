import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { PageHeader, Card, LoadingBlock, EmptyState } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';
import BrandedHeader from '../components/BrandedHeader.jsx';

const DEFAULTS = { primaryColor: '#1B2333', accentColor: '#F5A623' };

function normalize(data) {
  return {
    nameOverride: data.name_override || null,
    tagline: data.tagline || null,
    logoUrl: data.logo_url || null,
    primaryColor: data.primary_color || DEFAULTS.primaryColor,
    accentColor: data.accent_color || DEFAULTS.accentColor,
    description: data.description || null,
    messageHtml: data.message_html || null,
    sources: data.sources || {},
  };
}

// Lets an admin see, per node, what's inherited vs. overridden (CLAUDE.md:
// branding is configurable at any level, not just Master Org) before it
// goes live on the sidebar/login screen/public pages.
export default function BrandingPreview() {
  const [organizationId, setOrganizationId] = useState(null);
  const [branding, setBranding] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    api.get(`/organizations/${organizationId}/effective-branding`)
      .then((data) => setBranding(normalize(data)))
      .finally(() => setLoading(false));
  }, [organizationId]);

  return (
    <div>
      <PageHeader
        title="Branding Preview"
        description="See how a node's effective branding renders, including anything inherited from an ancestor."
        actions={<div className="w-64"><OrganizationSelector value={organizationId} onChange={setOrganizationId} /></div>}
      />

      <div className="p-8">
        {!organizationId ? (
          <EmptyState title="Select an organization to preview" />
        ) : loading || !branding ? (
          <LoadingBlock />
        ) : (
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
            <div>
              <p className="text-xs font-medium text-muted mb-2">Sidebar header</p>
              <div className="rounded-xl overflow-hidden border border-line" style={{ backgroundColor: branding.primaryColor }}>
                <BrandedHeader branding={branding} />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted mb-2">Login card</p>
              <div className="rounded-xl p-8 flex items-center justify-center" style={{ backgroundColor: branding.primaryColor }}>
                <Card className="w-full max-w-[240px] p-6 text-center">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt="" className="h-8 mb-3 mx-auto object-contain" />
                  ) : (
                    <ShieldCheck size={24} style={{ color: branding.accentColor }} className="mx-auto mb-2" />
                  )}
                  <p className="text-sm font-semibold text-ink">{branding.nameOverride || 'Nexus Portal'}</p>
                  {branding.tagline && <p className="text-xs text-muted mt-1">{branding.tagline}</p>}
                </Card>
              </div>
            </div>

            <Card className="p-5 md:col-span-2 space-y-3">
              <p className="text-xs font-medium text-muted">Effective fields</p>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                {Object.entries({
                  'Display name': branding.nameOverride, Tagline: branding.tagline,
                  'Primary color': branding.primaryColor, 'Accent color': branding.accentColor,
                  Description: branding.description,
                }).map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-ink">{value || <span className="text-muted italic">not set</span>}</dd>
                  </div>
                ))}
              </dl>
              {branding.messageHtml && (
                <div className="pt-2 border-t border-line">
                  <p className="text-xs text-muted mb-1">Message HTML</p>
                  <div className="text-sm text-ink" dangerouslySetInnerHTML={{ __html: branding.messageHtml }} />
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
