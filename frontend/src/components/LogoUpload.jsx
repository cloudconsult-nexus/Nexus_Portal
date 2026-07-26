import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import { ImageIcon, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, Button, ErrorBanner } from './ui.jsx';

async function getCroppedBlob(imageSrc, cropPixels) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });
  const canvas = document.createElement('canvas');
  canvas.width = cropPixels.width;
  canvas.height = cropPixels.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height, 0, 0, cropPixels.width, cropPixels.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

// Logos and favicons share this component (both cropped to a 1:1 square,
// different endpoint/preview size) since both are "pick an image, crop it,
// POST to an org asset route" — same flow as PhotoUpload.jsx but for
// organization branding, not a Person.
export default function LogoUpload({ organizationId, imageUrl, onUploaded, kind = 'logo', disabled, uploadPath }) {
  const isFavicon = kind === 'favicon';
  const [source, setSource] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSource(URL.createObjectURL(file));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    e.target.value = '';
  }

  const onCropComplete = useCallback((_, pixels) => setCropPixels(pixels), []);

  async function handleSave() {
    if (!cropPixels) return;
    setSaving(true);
    setError('');
    try {
      const blob = await getCroppedBlob(source, cropPixels);
      const form = new FormData();
      form.append(kind, blob, `${kind}.png`);
      const data = await api.upload(uploadPath || `/organizations/${organizationId}/${kind}`, form);
      onUploaded?.(isFavicon ? data.faviconUrl : data.logoUrl);
      setSource(null);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center justify-center bg-surface border border-line rounded-lg overflow-hidden shrink-0 ${isFavicon ? 'h-10 w-10' : 'h-14 w-14'}`}>
        {imageUrl ? <img src={imageUrl} alt="" className="max-h-full max-w-full object-contain" /> : <ImageIcon size={18} className="text-muted" />}
      </div>
      <label className={`inline-flex items-center gap-1.5 text-xs font-medium text-ink cursor-pointer hover:underline ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <Upload size={13} /> {imageUrl ? `Change ${kind}` : `Upload ${kind}`}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={disabled} />
      </label>

      <Modal
        open={!!source}
        onClose={() => setSource(null)}
        title={`Crop ${kind}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSource(null)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <div className="relative h-64 w-full bg-ink/5 rounded-lg overflow-hidden">
            {source && (
              <Cropper image={source} crop={crop} zoom={zoom} aspect={1} showGrid={false}
                onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
            )}
          </div>
          <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
        </div>
      </Modal>
    </div>
  );
}
