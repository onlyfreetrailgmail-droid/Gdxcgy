import { useState } from 'react';

// Shown on the tracking page for confirmed orders that have not shipped.
export default function CancelOrder({ orderId, guestToken, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({ message: '', error: false });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestToken, reason })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Could not cancel this order.');
      setResult({ message: data.message, error: false });
      setOpen(false);
      onDone?.();
    } catch (error) {
      setResult({ message: error.message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cancel-order">
      {!open && <button type="button" className="secondary-btn" onClick={() => setOpen(true)}>Cancel order</button>}
      {open && (
        <form onSubmit={submit} className="acc-form">
          <p className="subtle-text">Cancelling is free until printing starts. After that, our team reviews your request. Custom items are made to order.</p>
          <label className="acc-field">Why are you cancelling?
            <textarea required minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="acc-row">
            <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button>
            <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Keep my order</button>
          </div>
        </form>
      )}
      {result.message && <p role={result.error ? 'alert' : 'status'} className={result.error ? 'form-error' : 'form-success'}>{result.message}</p>}
    </div>
  );
}
