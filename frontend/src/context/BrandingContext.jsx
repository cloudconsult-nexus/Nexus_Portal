import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

// Falls back to CLAUDE.md's base brand tokens (also the tailwind.config.js
// defaults) whenever neither the Customer nor the TAS-wide settings have an
// override set for a given field.
const DEFAULT_BRANDING = {
  nameOverride: null,
  tagline: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#1B2333',
  accentColor: '#F5A623',
  description: null,
  messageHtml: null,
};

const BrandingContext = createContext(DEFAULT_BRANDING);

function normalizeBranding(data) {
  if (!data) return DEFAULT_BRANDING;
  return {
    nameOverride: data.name_override ?? null,
    tagline: data.tagline ?? null,
    logoUrl: data.logo_url ?? null,
    faviconUrl: data.favicon_url ?? null,
    primaryColor: data.primary_color || DEFAULT_BRANDING.primaryColor,
    accentColor: data.accent_color || DEFAULT_BRANDING.accentColor,
    description: data.description ?? null,
    messageHtml: data.message_html ?? null,
  };
}

// logoUrl/faviconUrl are signed GCS URLs that expire after 7 days (see
// backend/src/lib/storage.js's resolveAssetUrl) — refetching periodically
// keeps a long-lived open tab from ever showing a broken image, on top of
// the normal refetch below that already happens on every org-id change.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function BrandingProvider({ children }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState(DEFAULT_BRANDING);

  useEffect(() => {
    let cancelled = false;
    function fetchBranding() {
      // No Customer to inherit from (logged out, or a Global Admin with no
      // organization) — fall back to the TAS-wide settings directly, publicly
      // readable so the Login screen can show the TAS's own branding too.
      const request = user?.organizationId
        ? api.get(`/organizations/${user.organizationId}/effective-branding`)
        : api.get('/tas-settings/public').then((data) => data.tasSettings);
      request
        .then((data) => { if (!cancelled) setBranding(normalizeBranding(data)); })
        .catch(() => { if (!cancelled) setBranding(DEFAULT_BRANDING); });
    }
    fetchBranding();
    const interval = setInterval(fetchBranding, REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.organizationId]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
