import { useEffect, useState } from 'react';
import { api, upload } from './api';

const Stars = ({ n }) => <span className="stars" aria-label={`Rated ${n} out of 5`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;

// Real, approved, verified-buyer reviews only. Shows nothing invented when there are none yet.
export function ProductReviews({ slug, canReview }) {
  const [data, setData] = useState({ items: [], rating: 0, count: 0 });
  const [form, setForm] = useState({ rating: 5, title: '', body: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState([]);
  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 3 - photos.length); e.target.value = '';
    if (!files.length) return;
    setBusy(true); setMessage('');
    try { const r = await upload('/api/uploads/review-photos', files); setPhotos((p) => [...p, ...r.files].slice(0, 3)); }
    catch (err) { setMessage(err.status === 401 ? 'Please sign in to add photos.' : err.message); } finally { setBusy(false); }
  };
  useEffect(() => { api(`/api/products/${encodeURIComponent(slug)}/reviews`).then(setData).catch(() => {}); }, [slug]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try { const r = await api(`/api/products/${encodeURIComponent(slug)}/reviews`, { method: 'POST', body: { ...form, rating: Number(form.rating), photos: photos.map((p) => p.publicId) } }); setMessage(r.message); setForm({ rating: 5, title: '', body: '' }); setPhotos([]); }
    catch (error) { setMessage(error.status === 401 ? 'Please sign in to write a review.' : error.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="panel-body review-list" id="reviews">
      {data.count > 0 ? <p><strong>★ {data.rating}</strong> from {data.count} verified {data.count === 1 ? 'review' : 'reviews'}</p> : <p>No reviews yet.</p>}
      {data.items.map((r) => (
        <div key={r.id} className="mini-review">
          <strong>{r.name}</strong> <Stars n={r.rating} />
          {r.title && <p><strong>{r.title}</strong></p>}
          <p>{r.body}</p>
          {(r.photos || []).length > 0 && <div className="acc-row">{r.photos.map((u) => <img key={u} src={u} alt={`Photo from ${r.name}`} loading="lazy" width="96" height="96" style={{ objectFit: 'cover', borderRadius: 8 }} />)}</div>}
        </div>
      ))}
      <form className="admin-form" onSubmit={submit}>
        <h4>Bought this? Share your experience</h4>
        <label>Rating
          <select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}</select>
        </label>
        <input value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Headline (optional)" />
        <textarea value={form.body} maxLength={1000} rows={3} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What did you think? (at least 10 characters)" />
        <label>Add photos (optional, up to 3)
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} disabled={busy || photos.length >= 3} />
        </label>
        {photos.length > 0 && <div className="acc-row">{photos.map((p) => <img key={p.publicId} src={p.url} alt="Your upload" width="56" height="56" style={{ objectFit: 'cover', borderRadius: 8 }} />)}</div>}
        <button type="submit" className="secondary-btn" disabled={busy || form.body.trim().length < 10}>{busy ? 'Sending...' : 'Submit review'}</button>
        <p className="tiny-note">Only signed-in customers whose order was delivered can review. Reviews appear after a quick check.</p>
        {message && <p role="status" className="tiny-note">{message}</p>}
      </form>
    </div>
  );
}

// Home page strip. Renders nothing until there are real approved reviews.
export function RecentReviews() {
  const [items, setItems] = useState([]);
  useEffect(() => { api('/api/reviews/recent').then((d) => setItems(d.items || [])).catch(() => {}); }, []);
  if (!items.length) return null;
  return (
    <section className="container home-section">
      <h2>What customers say</h2>
      <div className="review-grid">
        {items.map((r) => (
          <article key={r.id} className="review-card">
            <Stars n={r.rating} />
            <p className="review-text">“{r.body}”</p>
            <strong>{r.name}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}
