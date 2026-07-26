import jwt from 'jsonwebtoken';

// Signed embed URLs for report_mappings with sso_enabled=true — the common
// Metabase/Looker-style pattern: a short-lived JWT appended to the iframe
// URL as the mapping's configured token_param.
export function buildEmbedUrl(mapping, viewerContext = {}) {
  if (!mapping.sso_enabled) return mapping.embed_url;

  const secret = mapping.sso_shared_secret || process.env.REPORT_SSO_FALLBACK_SECRET;
  if (!secret) {
    throw new Error(`Report mapping "${mapping.name}" has SSO enabled but no shared secret is configured`);
  }

  const token = jwt.sign({ ...viewerContext, resource: mapping.id }, secret, { expiresIn: '10m' });
  const separator = mapping.embed_url.includes('?') ? '&' : '?';
  return `${mapping.embed_url}${separator}${encodeURIComponent(mapping.token_param)}=${token}`;
}
