import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';

let gcsClient = null;
function getBucket() {
  if (!process.env.BRANDING_BUCKET_NAME) return null;
  gcsClient ??= new Storage();
  return gcsClient.bucket(process.env.BRANDING_BUCKET_NAME);
}

// UUID-suffixed so object names are not guessable/enumerable — belt-and-
// suspenders alongside resolveAssetUrl()'s signed URLs below (see
// DEPLOYMENT_ARCHITECTURE.md's storage design section).
export function assetKey(prefix, originalFilename) {
  const ext = path.extname(originalFilename || '').toLowerCase() || '.png';
  return `${prefix}/${crypto.randomUUID()}${ext}`;
}

// Uploads to GCS when configured (production); falls back to local disk
// under backend/uploads/ otherwise, served back out via app.js's /uploads
// static route — this is what local dev and tests run against.
export async function uploadAsset(key, buffer, contentType) {
  const bucket = getBucket();
  if (bucket) {
    const file = bucket.file(key);
    await file.save(buffer, { contentType, resumable: false });
    return `https://storage.googleapis.com/${process.env.BRANDING_BUCKET_NAME}/${key}`;
  }

  const localPath = path.join(process.cwd(), 'uploads', key);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
  return `/uploads/${key}`;
}

export async function deleteAsset(key) {
  const bucket = getBucket();
  if (bucket) {
    await bucket.file(key).delete({ ignoreNotFound: true });
    return;
  }
  const localPath = path.join(process.cwd(), 'uploads', key);
  fs.rmSync(localPath, { force: true });
}

// The branding bucket has no public-read grant (this org's Domain Restricted
// Sharing policy blocks allUsers/allAuthenticatedUsers IAM bindings — see
// infra/iam.tf), so every stored GCS URL has to be re-signed before it's
// safe to hand to a browser. uploadAsset() still stores/returns the plain
// https://storage.googleapis.com/<bucket>/<key> form unchanged — this is a
// read-time wrapper only, applied wherever a logo/favicon/photo URL is about
// to go into a JSON response.
//
// V4 signed URLs generated via IAM signBlob impersonation (no key file —
// Cloud Run has none) cap out at 7 days; that's also the cache TTL below
// (minus a day of margin) so a cached URL is never handed out already
// expired. Cache is per-instance/in-memory: on a cold start it just re-signs
// once, never a correctness issue.
const SIGNED_URL_CACHE = new Map(); // key -> { url, cachedUntil }
const SIGN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MARGIN_MS = 24 * 60 * 60 * 1000;

export async function resolveAssetUrl(storedUrl) {
  if (!storedUrl || !process.env.BRANDING_BUCKET_NAME) return storedUrl;
  const prefix = `https://storage.googleapis.com/${process.env.BRANDING_BUCKET_NAME}/`;
  if (!storedUrl.startsWith(prefix)) return storedUrl; // local-disk /uploads/... path, or a foreign URL

  const key = storedUrl.slice(prefix.length);
  const cached = SIGNED_URL_CACHE.get(key);
  if (cached && cached.cachedUntil > Date.now()) return cached.url;

  const bucket = getBucket();
  const [url] = await bucket.file(key).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + SIGN_EXPIRY_MS,
  });
  SIGNED_URL_CACHE.set(key, { url, cachedUntil: Date.now() + SIGN_EXPIRY_MS - CACHE_MARGIN_MS });
  return url;
}
