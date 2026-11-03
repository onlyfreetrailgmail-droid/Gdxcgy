import { useEffect, useState } from 'react';

const call = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Request failed.');
  return data;
};

// Open customer cancellation requests (production already started) and cancelled orders whose refund failed.
export default function AdminCancellations() {
  const [data, setData] = useState({ requests: [], refundPending: [] });
  const [message, setMessage] = useState('');
  const load = () => call('/api/admin/cancellations').then(setData).catch((e) => setMessage(e.message));
  useEffect(() => { load(); }, []);
  const act = async (fn, ok) => { setMessage(''); try { await fn(); setMessage(ok); await load(); } catch (e) { setMessage(e.message); } };

  if (!data.requests.length && !data.refundPending.length && !message) return null;
  return (
    <div className="admin-form-card">
      <h3>Cancellations</h3>
      {message && <p role="status" className="tiny-note">{message}</p>}
      {data.requests.map((r) => (
        <div key={r.orderId} className="acc-address">
          <strong>{r.orderId}</strong>
          <p>{r.reason}</p>
          <div className="acc-row">
            <button type="button" className="primary-btn small-btn" onClick={() => act(() => call(`/api/admin/cancellations/${encodeURIComponent(r.orderId)}/approve`, 'POST'), 'Cancelled and refund started.')}>Approve and refund</button>
            <button type="button" className="secondary-btn small-btn" onClick={() => { const note = window.prompt('Note for the record (optional):') || ''; act(() => call(`/api/admin/cancellations/${encodeURIComponent(r.orderId)}/decline`, 'POST', { note }), 'Request declined.'); }}>Decline</button>
          </div>
        </div>
      ))}
      {data.refundPending.map((o) => (
        <div key={o.orderId} className="acc-address">
          <strong>{o.orderId}</strong>
          <p>Cancelled, but the automatic refund of ₹{o.total} failed.</p>
          <button type="button" className="secondary-btn small-btn" onClick={() => act(() => call(`/api/admin/cancellations/${encodeURIComponent(o.orderId)}/retry-refund`, 'POST'), 'Refund started.')}>Retry refund</button>
        </div>
      ))}
    </div>
  );
}
