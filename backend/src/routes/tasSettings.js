import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { assetKey, uploadAsset } from '../lib/storage.js';

// TAS-wide instance settings — a singleton row (one deployed Portal = one
// TAS; see migrations/013_tas_customer_model.sql). Replaces what used to
// live on the single master_organization row before the hierarchy flattened.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Unauthenticated by design — this is what renders the logo/name on the
// Login screen, before anyone has a token. Every field here is branding
// or public contact info, nothing sensitive (mirrors routes/publicBranding.js).
router.get('/public', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tas_settings LIMIT 1');
  res.json({ tasSettings: rows[0] });
});

router.use(requireAuth, auditContext);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tas_settings LIMIT 1');
  res.json({ tasSettings: rows[0] });
});

const FIELDS = [
  'name', 'phone', 'email', 'website', 'address', 'primary_contact', 'call_messages_url',
  'logo_url', 'primary_color', 'accent_color', 'name_override', 'tagline', 'favicon_url',
  'description', 'message_html',
];

router.put('/', requireRole('global_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM tas_settings LIMIT 1');
  const existing = existingRows[0];

  const updates = [];
  const values = [];
  let i = 1;
  for (const field of FIELDS) {
    const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[camel] !== undefined) {
      updates.push(`${field} = $${i++}`);
      values.push(req.body[camel]);
    }
  }
  if (updates.length === 0) return res.json({ tasSettings: existing });

  values.push(existing.id);
  const { rows } = await pool.query(
    `UPDATE tas_settings SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );

  await req.logAudit({ action: 'update', entityType: 'tas_settings', entityId: rows[0].id, entityName: rows[0].name, oldValues: existing, newValues: rows[0] });
  res.json({ tasSettings: rows[0] });
});

router.post('/logo', requireRole('global_admin'), upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows } = await pool.query('SELECT id FROM tas_settings LIMIT 1');
  const key = assetKey('tas-logos', req.file.originalname);
  const url = await uploadAsset(key, req.file.buffer, req.file.mimetype);
  await pool.query('UPDATE tas_settings SET logo_url = $1, updated_at = now() WHERE id = $2', [url, rows[0].id]);
  res.json({ logoUrl: url });
});

router.post('/favicon', requireRole('global_admin'), upload.single('favicon'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows } = await pool.query('SELECT id FROM tas_settings LIMIT 1');
  const key = assetKey('tas-favicons', req.file.originalname);
  const url = await uploadAsset(key, req.file.buffer, req.file.mimetype);
  await pool.query('UPDATE tas_settings SET favicon_url = $1, updated_at = now() WHERE id = $2', [url, rows[0].id]);
  res.json({ faviconUrl: url });
});

export default router;
