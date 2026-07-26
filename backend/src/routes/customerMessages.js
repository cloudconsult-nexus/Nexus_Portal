import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';

// Nav/permission scaffolding only (CLAUDE.md: "do not build a real external
// integration unless explicitly asked") — no database table backs this.
// Configuration is a single global embed target via env vars, not a
// per-org catalog like report_mappings.
const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const configured = !!process.env.CUSTOMER_MESSAGING_URL;
  if (!configured) {
    return res.json({ configured: false });
  }

  let embedUrl = process.env.CUSTOMER_MESSAGING_URL;
  if (process.env.CUSTOMER_MESSAGING_SSO_SECRET) {
    const token = jwt.sign(
      { userId: req.user.id, role: req.user.role },
      process.env.CUSTOMER_MESSAGING_SSO_SECRET,
      { expiresIn: '10m' }
    );
    const tokenParam = process.env.CUSTOMER_MESSAGING_TOKEN_PARAM || 'token';
    const separator = embedUrl.includes('?') ? '&' : '?';
    embedUrl = `${embedUrl}${separator}${encodeURIComponent(tokenParam)}=${token}`;
  }

  res.json({ configured: true, embedUrl });
});

export default router;
