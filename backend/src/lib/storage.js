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

// UUID-suffixed so object names are not guessable/enumerable — see
// DEPLOYMENT_ARCHITECTURE.md's storage design section for why that matters
// given the branding bucket is publicly readable.
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
