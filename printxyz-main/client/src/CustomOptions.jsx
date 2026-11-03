import { useState } from 'react';
import { upload } from './api';

const text = (p) => [p.category, p.categorySlug, p.title, ...(p.tags || [])].join(' ');
export const isCustomProduct = (p) => p?.customizable === true || /custom|lithophane|statue|photo|name\s?plate/i.test(text(p || {}));
export const needsPhoto = (p) => /lithophane|statue|photo/i.test(text(p || {}));

// Photo upload and note for personalised products. Photos go to private storage; only their references are kept in the cart.
export function CustomOptions({ product, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const photos = value.photos || [];

  const pick = async (event) => {
    const files = [...(event.target.files || [])].slice(0, 5 - photos.length);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const r = await upload('/api/uploads/order-images', files);
      onChange({ ...value, photos: [...photos, ...r.files.map((f) => ({ publicId: f.publicId, previewUrl: f.previewUrl }))].slice(0, 5) });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="variant-box custom-options" data-testid="custom-options">
      <h4>Personalise it</h4>
      <p className="tiny-note">{needsPhoto(product) ? 'Upload at least one clear photo.' : 'Photos are optional.'} You will see a design preview and approve it before we print.</p>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={pick} disabled={busy || photos.length >= 5} aria-label="Upload photos" />
      {busy && <p className="tiny-note">Uploading…</p>}
      {error && <p role="alert" className="notice-text error">{error}</p>}
      {photos.length > 0 && (
        <div className="acc-row">
          {photos.map((p) => (
            <span key={p.publicId} className="photo-chip">
              {p.previewUrl && <img src={p.previewUrl} alt="Uploaded" width="56" height="56" style={{ objectFit: 'cover', borderRadius: 8 }} />}
              <button type="button" className="text-link danger" onClick={() => onChange({ ...value, photos: photos.filter((x) => x.publicId !== p.publicId) })}>Remove</button>
            </span>
          ))}
        </div>
      )}
      <label>Name, date or instructions (optional)
        <textarea rows={2} maxLength={500} value={value.note || ''} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="For example: name to print, preferred colour" />
      </label>
    </div>
  );
}

// Compact form used in the cart: only references, never preview URLs.
export const toCartOptions = (v) => {
  const photos = (v?.photos || []).map((p) => p.publicId);
  const note = String(v?.note || '').trim();
  return photos.length || note ? { photos, note } : undefined;
};
