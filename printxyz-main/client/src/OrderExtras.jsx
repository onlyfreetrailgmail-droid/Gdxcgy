import { useEffect, useState } from 'react';
import { api, upload, rupees } from './api';
import { openCheckout } from './razorpay';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Part-paid orders: shows what was paid and lets the customer pay the rest.
export function PaymentPlan({ order, token, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (order.payment_plan !== 'advance') return null;
  const due = order.balance_due > 0;

  const payBalance = async () => {
    setBusy(true); setError('');
    try {
      const data = await api('/api/payments/create-balance-order', { method: 'POST', body: { orderId: order.id, guestToken: token } });
      await openCheckout({
        data, description: `Balance for ${order.id}`,
        onPaid: async (r) => {
          try {
            await api('/api/payments/verify', { method: 'POST', body: { razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature } });
            onDone?.();
          } catch (e) { setError(`${e.message} If money was deducted, do not pay again. Quote ${order.id} to support.`); }
          finally { setBusy(false); }
        },
        onDismiss: () => setBusy(false), onFailed: () => setError('Payment failed. You can try again.')
      });
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="admin-form-card" data-testid="payment-plan">
      <h3>Part payment</h3>
      <p>Advance: <strong>{inr(order.advance_amount)}</strong> {order.paid_amount > 0 ? '(paid)' : ''}</p>
      <p>Balance: <strong>{inr(order.balance_amount)}</strong> {due ? '(due before shipping)' : order.payment_status === 'paid' ? '(paid)' : ''}</p>
      {due && <button type="button" className="primary-btn" disabled={busy} onClick={payBalance}>{busy ? 'Opening payment…' : `Pay balance ${inr(order.balance_due)}`}</button>}
      {error && <p role="alert" className="notice-text error">{error}</p>}
    </div>
  );
}

// Return request for delivered orders (window and rules come from the server).
export function ReturnRequest({ order, token }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ reason: '', details: '' });
  const [photos, setPhotos] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api(`/api/orders/${encodeURIComponent(order.id)}/returns?token=${encodeURIComponent(token)}`).then(setInfo).catch(() => setInfo(null));
  useEffect(() => { if (order.shipping_status === 'delivered') load(); /* eslint-disable-next-line */ }, [order.id, order.shipping_status]);
  if (order.shipping_status !== 'delivered' || !info) return null;
  const mustPhoto = ['damaged', 'defective'].includes(form.reason);

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 5 - photos.length); e.target.value = '';
    if (!files.length) return;
    setBusy(true); setMessage('');
    try { const r = await upload('/api/uploads/order-images', files); setPhotos((p) => [...p, ...r.files.map((f) => f.publicId)].slice(0, 5)); }
    catch (err) { setMessage(err.message); } finally { setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const r = await api(`/api/orders/${encodeURIComponent(order.id)}/returns`, { method: 'POST', body: { guestToken: token, reason: form.reason, details: form.details, photos } });
      setMessage(r.message); setForm({ reason: '', details: '' }); setPhotos([]); await load();
    } catch (err) { setMessage(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="admin-form-card" data-testid="return-request">
      <h3>Returns</h3>
      {info.requests.map((r) => <p key={r.id}><strong>{r.id}</strong>: {r.reasonLabel} — <em>{r.statusLabel}</em>{r.decisionNote ? `. ${r.decisionNote}` : ''}</p>)}
      {info.eligibility.eligible ? (
        <form className="admin-form" onSubmit={submit}>
          {info.eligibility.until && <p className="tiny-note">You can request a return until {new Date(info.eligibility.until).toLocaleDateString('en-IN')}.</p>}
          {info.eligibility.custom && <p className="tiny-note">Personalised items can be returned only if they arrive damaged, have a print flaw, or are not what you ordered.</p>}
          <label>Reason
            <select required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              <option value="">Choose a reason</option>
              {info.reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <textarea required rows={3} minLength={10} maxLength={1000} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Tell us what went wrong (at least 10 characters)" />
          <label>Photos {mustPhoto ? '(required)' : '(optional)'}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} disabled={busy || photos.length >= 5} />
          </label>
          {photos.length > 0 && <p className="tiny-note">{photos.length} photo(s) attached.</p>}
          <button type="submit" className="secondary-btn" disabled={busy || !form.reason || form.details.trim().length < 10 || (mustPhoto && !photos.length)}>{busy ? 'Please wait…' : 'Request return'}</button>
        </form>
      ) : (!info.requests.length && <p className="tiny-note">{info.eligibility.reason || 'Returns are not available for this order.'}</p>)}
      {message && <p role="status" className="tiny-note">{message}</p>}
    </div>
  );
}

export { rupees };
