import { useEffect, useState } from 'react';
import { api } from './api';

// Contact and bulk-order enquiries. The hidden "website" field is a honeypot for bots.
export default function ContactForm({ kind = 'contact' }) {
  const bulk = kind === 'bulk';
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', quantity: '', message: '', website: '' });
  const [status, setStatus] = useState({ text: '', ok: false });
  const [busy, setBusy] = useState(false);
  const [business, setBusiness] = useState({});
  useEffect(() => { api('/api/settings/public').then((d) => setBusiness(d.business || {})).catch(() => {}); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setStatus({ text: '', ok: false });
    try { const r = await api('/api/enquiries', { method: 'POST', body: { ...form, type: kind } }); setStatus({ text: `${r.message} Reference: ${r.id}`, ok: true }); setForm({ name: '', email: '', phone: '', company: '', quantity: '', message: '', website: '' }); }
    catch (error) { setStatus({ text: error.message, ok: false }); }
    finally { setBusy(false); }
  };

  return (
    <div className="container page-shell">
      <div className="page-header"><p className="eyebrow">{bulk ? 'Bulk and corporate orders' : 'Contact us'}</p><h1>{bulk ? 'Planning a larger order?' : 'How can we help?'}</h1></div>
      {(business.email || business.phone) && <p>{[business.email && `Email: ${business.email}`, business.phone && `Phone: ${business.phone}`].filter(Boolean).join(' • ')}</p>}
      <form className="admin-form" onSubmit={submit} style={{ maxWidth: 560 }}>
        <input value={form.name} onChange={set('name')} placeholder="Your name" autoComplete="name" required />
        <input type="email" value={form.email} onChange={set('email')} placeholder="Email" autoComplete="email" required />
        <input value={form.phone} onChange={set('phone')} placeholder="Mobile (optional)" autoComplete="tel" />
        {bulk && <input value={form.company} onChange={set('company')} placeholder="Company (optional)" />}
        {bulk && <input value={form.quantity} onChange={set('quantity')} placeholder="Approximate quantity" />}
        <textarea value={form.message} onChange={set('message')} rows={5} maxLength={2000} placeholder={bulk ? 'What do you need, and by when?' : 'Your message'} required />
        <input value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }} />
        <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Sending...' : 'Send message'}</button>
        {status.text && <p role="status" className={status.ok ? 'success-text' : 'notice-text error'}>{status.text}</p>}
      </form>
    </div>
  );
}
