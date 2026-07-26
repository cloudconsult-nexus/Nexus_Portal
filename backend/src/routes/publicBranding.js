import { Router } from 'express';
import { getEffectiveBranding } from '../lib/branding.js';

// Unauthenticated by design — logos/branding render for a customer's own
// end users, who are never authenticated against this app at all (README's
// "Scope" section). No secrets are exposed here, just display fields.
const router = Router();

router.get('/:organizationId', async (req, res) => {
  const branding = await getEffectiveBranding(req.params.organizationId);
  const { sources, ...publicFields } = branding;
  res.json({ branding: publicFields });
});

export default router;
