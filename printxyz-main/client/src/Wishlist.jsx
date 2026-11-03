import { useEffect, useState } from 'react';

// Heart button. Works for signed-in customers; guests are sent to log in.
export function WishlistButton({ productId }) {
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/account/wishlist').then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setSaved((d.productIds || []).includes(productId)); }).catch(() => {});
    return () => { live = false; };
  }, [productId]);

  const toggle = async () => {
    setNote('');
    const response = await fetch(`/api/account/wishlist/${encodeURIComponent(productId)}`, { method: saved ? 'DELETE' : 'PUT' });
    if (response.status === 401) { setNote('Log in to save favourites.'); return; }
    if (!response.ok) { setNote('Could not update your wishlist.'); return; }
    setSaved(!saved);
  };
  return (
    <div>
      <button type="button" className="secondary-btn" aria-pressed={saved} onClick={toggle}>{saved ? '♥ Saved' : '♡ Save to wishlist'}</button>
      {note && <p role="status" className="pincode-msg">{note}</p>}
    </div>
  );
}

export async function loadWishlistProducts() {
  const r = await fetch('/api/account/wishlist');
  if (!r.ok) return null;
  const { productIds = [] } = await r.json();
  if (!productIds.length) return [];
  const p = await fetch(`/api/products?ids=${productIds.map(encodeURIComponent).join(',')}`);
  const data = await p.json();
  return Array.isArray(data.items) ? data.items : [];
}
