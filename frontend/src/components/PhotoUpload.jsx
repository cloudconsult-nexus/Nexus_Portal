import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import { UserRound, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, Button, ErrorBanner } from './ui.jsx';

// Renders a cropped square from the source image + react-easy-crop's
// pixel-space crop rect. Canvas is sized to the crop itself (no upscaling)
// since person photos only need to look good at avatar size.
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
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

export default function PhotoUpload({ personId, photoUrl, onUploaded, disabled }) {
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
      form.append('photo', blob, 'photo.jpg');
      const data = await api.upload(`/people/${personId}/photo`, form);
      onUploaded?.(data.photoUrl);
      setSource(null);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="h-14 w-14 rounded-full overflow-hidden bg-surface border border-line flex items-center justify-center shrink-0">
        {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <UserRound size={22} className="text-muted" />}
      </div>
      <label className={`inline-flex items-center gap-1.5 text-xs font-medium text-ink cursor-pointer hover:underline ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <Upload size={13} /> Change photo
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={disabled} />
      </label>

      <Modal
        open={!!source}
        onClose={() => setSource(null)}
        title="Crop photo"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSource(null)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <div className="relative h-72 w-full bg-ink/5 rounded-lg overflow-hidden">
            {source && (
              <Cropper image={source} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}
                onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
            )}
          </div>
          <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
        </div>
      </Modal>
    </div>
  );
}
