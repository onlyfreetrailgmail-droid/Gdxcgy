import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Something went wrong. Please try again.');
  return data;
};

const emptyAddress = { label: 'Home', name: '', phone: '', street: '', apartment: '', landmark: '', city: '', state: '', pincode: '' };

export default function AccountPanel({ onLogout }) {
  const [profile, setProfile] = useState({ name: '', phone: '', dob: '', email: '' });
  const [addresses, setAddresses] = useState([]);
  const [prefs, setPrefs] = useState({ marketing: false, whatsapp: false, reminders: true });
  const [address, setAddress] = useState(emptyAddress);
  const [editingId, setEditingId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');

  const guard = async (fn, okMessage) => {
    setError(''); setNotice('');
    try { await fn(); if (okMessage) setNotice(okMessage); } catch (e) { setError(e.message); }
  };

  const load = () => guard(async () => {
    const [p, a, pr] = await Promise.all([api('/api/account/profile'), api('/api/account/addresses'), api('/api/account/preferences')]);
    setProfile((cur) => ({ ...cur, ...p.profile })); setAddresses(a.items || []); setPrefs(pr.preferences);
  });
  useEffect(() => { load(); }, []);

  const saveProfile = (event) => { event.preventDefault(); guard(async () => {
    const d = await api('/api/account/profile', { method: 'PATCH', body: { name: profile.name, phone: profile.phone, dob: profile.dob } });
    setProfile((cur) => ({ ...cur, ...d.profile }));
  }, 'Profile saved.'); };

  const saveAddress = (event) => { event.preventDefault(); guard(async () => {
    if (editingId) await api(`/api/account/addresses/${editingId}`, { method: 'PUT', body: address });
    else await api('/api/account/addresses', { method: 'POST', body: address });
    setAddress(emptyAddress); setEditingId(''); await load();
  }, 'Address saved.'); };

  const removeAddress = (id) => guard(async () => { await api(`/api/account/addresses/${id}`, { method: 'DELETE' }); await load(); }, 'Address removed.');
  const makeDefault = (id) => guard(async () => { await api(`/api/account/addresses/${id}/default`, { method: 'POST' }); await load(); }, 'Default address updated.');
  const togglePref = (key) => guard(async () => {
    const d = await api('/api/account/preferences', { method: 'PATCH', body: { [key]: !prefs[key] } }); setPrefs(d.preferences);
  }, 'Preferences updated.');

  const exportData = () => guard(async () => {
    const data = await api('/api/account/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'printxyz-my-data.json'; a.click(); URL.revokeObjectURL(url);
  });

  const deleteAccount = () => guard(async () => {
    await api('/api/account/delete', { method: 'POST', body: { confirm } });
    onLogout();
  });

  const field = (key, label, props = {}) => (
    <label className="acc-field">{label}
      <input value={address[key]} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} {...props} />
    </label>
  );

  return (
    <div className="container page-shell account-page">
      <div className="account-panel acc-wide">
        <p className="eyebrow">My account</p>
        <h1>Hello{profile.name ? `, ${profile.name.split(' ')[0]}` : ''}</h1>
        {error && <p role="alert" className="form-error">{error}</p>}
        {notice && <p role="status" className="form-success">{notice}</p>}
        <div className="account-actions">
          <Link to="/orders" className="primary-btn">View orders</Link>
          <Link to="/wishlist" className="secondary-btn">Wishlist</Link>
          <button type="button" className="secondary-btn" onClick={onLogout}>Log out</button>
        </div>

        <section className="acc-section">
          <h2>Profile</h2>
          <form onSubmit={saveProfile} className="acc-form">
            <label className="acc-field">Name<input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
            <label className="acc-field">Email<input value={profile.email} disabled /></label>
            <label className="acc-field">Mobile<input inputMode="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
            <label className="acc-field">Date of birth (optional)<input type="date" value={profile.dob} onChange={(e) => setProfile({ ...profile, dob: e.target.value })} /></label>
            <button type="submit" className="primary-btn">Save profile</button>
          </form>
        </section>

        <section className="acc-section">
          <h2>Saved addresses</h2>
          {addresses.length === 0 && <p className="subtle-text">No saved addresses yet.</p>}
          {addresses.map((a) => (
            <div key={a.id} className="acc-address">
              <strong>{a.label}{a.isDefault ? ' • Default' : ''}</strong>
              <p>{a.name}, {a.phone}<br />{[a.street, a.apartment, a.landmark].filter(Boolean).join(', ')}<br />{a.city}, {a.state} {a.pincode}</p>
              <div className="acc-row">
                <button type="button" className="secondary-btn small-btn" onClick={() => { setAddress({ ...emptyAddress, ...a }); setEditingId(a.id); }}>Edit</button>
                {!a.isDefault && <button type="button" className="secondary-btn small-btn" onClick={() => makeDefault(a.id)}>Make default</button>}
                <button type="button" className="secondary-btn small-btn" onClick={() => removeAddress(a.id)}>Remove</button>
              </div>
            </div>
          ))}
          <form onSubmit={saveAddress} className="acc-form">
            <h3>{editingId ? 'Edit address' : 'Add an address'}</h3>
            {field('label', 'Label (Home, Work, Gift)')}
            {field('name', 'Full name', { required: true })}
            {field('phone', 'Mobile', { inputMode: 'tel', required: true })}
            {field('street', 'Street address', { required: true })}
            {field('apartment', 'Flat / building (optional)')}
            {field('landmark', 'Landmark (optional)')}
            {field('city', 'City', { required: true })}
            {field('state', 'State', { required: true })}
            {field('pincode', 'Pincode', { inputMode: 'numeric', maxLength: 6, required: true })}
            <button type="submit" className="primary-btn">{editingId ? 'Update address' : 'Save address'}</button>
            {editingId && <button type="button" className="secondary-btn" onClick={() => { setAddress(emptyAddress); setEditingId(''); }}>Cancel</button>}
          </form>
        </section>

        <section className="acc-section">
          <h2>Communication</h2>
          <p className="subtle-text">Order and payment emails are always on. Everything else is your choice.</p>
          {[['marketing', 'Offers and new designs by email'], ['whatsapp', 'Order updates on WhatsApp'], ['reminders', 'Cart and balance reminders']].map(([key, label]) => (
            <label key={key} className="acc-check"><input type="checkbox" checked={Boolean(prefs[key])} onChange={() => togglePref(key)} /> {label}</label>
          ))}
        </section>

        <section className="acc-section">
          <h2>Your data</h2>
          <button type="button" className="secondary-btn" onClick={exportData}>Download my data</button>
          <div className="acc-danger">
            <h3>Delete my account</h3>
            <p className="subtle-text">This removes your profile, addresses and wishlist. Orders we must keep for tax records are anonymised. Type DELETE to confirm.</p>
            <input aria-label="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button type="button" className="secondary-btn" disabled={confirm !== 'DELETE'} onClick={deleteAccount}>Delete account</button>
          </div>
        </section>
      </div>
    </div>
  );
}
