import { useEffect, useState } from 'react';
import { api, rupees } from './api';
import { Roles, Banners, Returns, Alerts, Materials, Links } from './AdminExtra';

const TABS = ['Reports', 'Coupons', 'Customers', 'Inventory', 'Reviews', 'Returns', 'Enquiries', 'Banners', 'Links', 'Materials', 'Roles', 'Alerts', 'Settings', 'Security'];
const day = (d) => new Date(d).toISOString().slice(0, 10);

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const reload = () => { setState((s) => ({ ...s, loading: true })); return fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.status === 403 ? 'Your role does not have access to this section.' : e.message, loading: false })); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { ...state, reload };
}
const Note = ({ error, loading }) => (error ? <p role="alert" className="notice-text error">{error}</p> : loading ? <p className="tiny-note">Loading…</p> : null);

function Reports() {
  const [range, setRange] = useState({ from: day(Date.now() - 30 * 86400000), to: day(Date.now()) });
  const { data, error, loading, reload } = useLoad(() => api(`/api/admin/reports/sales?from=${range.from}&to=${range.to}T23:59:59Z`), [range.from, range.to]);
  return (
    <div>
      <div className="acc-row">
        <label>From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label>To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <button type="button" className="secondary-btn small-btn" onClick={reload}>Refresh</button>
        <a className="primary-btn small-btn" href="/api/admin/reports/orders.csv" download>Download all orders (CSV)</a>
      </div>
      <Note error={error} loading={loading} />
      {data && (
        <>
          <p><strong>{data.orders}</strong> paid orders • Revenue <strong>{rupees(data.revenuePaise)}</strong> • Refunded {rupees(data.refundedPaise)} • Net <strong>{rupees(data.netPaise)}</strong> • Average order {rupees(data.averageOrderPaise)}</p>
          {data.refundsNeedingAttention > 0 && <p role="alert" className="notice-text error">{data.refundsNeedingAttention} cancelled order(s) still need a refund.</p>}
          <h4>Top products</h4>
          {data.topProducts.length ? <ul>{data.topProducts.map((p) => <li key={p.productId}>{p.title}: {p.units} sold, {rupees(p.revenuePaise)}</li>)}</ul> : <p className="tiny-note">No sales in this period.</p>}
          <h4>By day</h4>
          <ul>{data.byDay.map((d) => <li key={d.date}>{d.date}: {d.orders} orders, {rupees(d.revenuePaise)}</li>)}</ul>
          <h4>Order sources</h4>
          <ul>{data.bySource.map((s) => <li key={s.source}>{s.source}: {s.orders}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function Coupons() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/coupons'), []);
  const blank = { code: '', type: 'percent', value: '', minOrder: '', maxDiscount: '', usageLimit: '', perUserLimit: '', expiresAt: '' };
  const [form, setForm] = useState(blank); const [msg, setMsg] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const create = async (e) => { e.preventDefault(); setMsg(''); const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')); try { await api('/api/admin/coupons', { method: 'POST', body }); setForm(blank); await reload(); setMsg('Coupon created.'); } catch (err) { setMsg(err.message); } };
  const toggle = async (c) => { try { await api(`/api/admin/coupons/${c.id}`, { method: 'PUT', body: { active: !c.active } }); await reload(); } catch (err) { setMsg(err.message); } };
  return (
    <div>
      <Note error={error} loading={loading} />
      {data?.items?.map((c) => (
        <div key={c.id} className="acc-address">
          <strong>{c.code}</strong> {c.type === 'percent' ? `${c.value}% off` : `${rupees(c.value)} off`}{c.minOrderPaise ? ` over ${rupees(c.minOrderPaise)}` : ''}{c.maxDiscountPaise ? `, max ${rupees(c.maxDiscountPaise)}` : ''}
          <p className="tiny-note">Used {c.usedCount || 0}{c.usageLimit ? ` of ${c.usageLimit}` : ''}{c.expiresAt ? ` • expires ${day(c.expiresAt)}` : ''} • {c.active ? 'active' : 'off'}</p>
          <button type="button" className="secondary-btn small-btn" onClick={() => toggle(c)}>{c.active ? 'Turn off' : 'Turn on'}</button>
        </div>
      ))}
      <form className="admin-form" onSubmit={create}>
        <h4>New coupon</h4>
        <input value={form.code} onChange={set('code')} placeholder="Code (letters and digits)" required />
        <select value={form.type} onChange={set('type')}><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option></select>
        <input value={form.value} onChange={set('value')} placeholder={form.type === 'percent' ? 'Percent (1-100)' : 'Rupees off'} required inputMode="decimal" />
        <input value={form.minOrder} onChange={set('minOrder')} placeholder="Minimum order ₹ (optional)" inputMode="decimal" />
        <input value={form.maxDiscount} onChange={set('maxDiscount')} placeholder="Maximum discount ₹ (optional)" inputMode="decimal" />
        <input value={form.usageLimit} onChange={set('usageLimit')} placeholder="Total uses (optional)" inputMode="numeric" />
        <input value={form.perUserLimit} onChange={set('perUserLimit')} placeholder="Uses per customer (optional)" inputMode="numeric" />
        <label>Expires <input type="date" value={form.expiresAt} onChange={set('expiresAt')} /></label>
        <button type="submit" className="primary-btn">Create coupon</button>
        {msg && <p role="status" className="tiny-note">{msg}</p>}
      </form>
    </div>
  );
}

function Customers() {
  const { data, error, loading } = useLoad(() => api('/api/admin/customers'), []);
  return (<div><Note error={error} loading={loading} />{data?.items?.map((c) => <div key={c.email} className="acc-address"><strong>{c.name || c.email}</strong> <span className="tiny-note">{c.email}</span><p>{c.orders} orders ({c.paidOrders} paid) • Lifetime value {rupees(c.lifetimeValuePaise)} • Last order {c.lastOrderAt ? day(c.lastOrderAt) : '-'}</p></div>)}{data && !data.items.length && <p className="tiny-note">No customers yet.</p>}</div>);
}

function Inventory() {
  const [threshold, setThreshold] = useState(5);
  const { data, error, loading } = useLoad(() => api(`/api/admin/inventory/low-stock?threshold=${threshold}`), [threshold]);
  return (<div><label>Show items with stock at or below <input type="number" min="0" value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 0)} style={{ width: 80 }} /></label><Note error={error} loading={loading} />{data?.items?.map((p) => <p key={p.id}>{p.title}: <strong>{p.stock}</strong> left</p>)}{data && !data.items.length && <p className="tiny-note">Nothing is running low.</p>}</div>);
}

function Reviews() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/reviews'), []);
  const [msg, setMsg] = useState('');
  const act = async (id, action) => { try { await api(`/api/admin/reviews/${id}/${action}`, { method: 'POST' }); await reload(); } catch (e) { setMsg(e.message); } };
  return (<div><Note error={error} loading={loading} />{msg && <p role="status" className="tiny-note">{msg}</p>}{data?.items?.map((r) => <div key={r.id} className="acc-address"><strong>{r.name}</strong> {'★'.repeat(r.rating)} <p>{r.title && <strong>{r.title} </strong>}{r.body}</p>{(r.photos || []).map((u) => <img key={u} src={u} alt="Review" width="72" height="72" style={{ objectFit: 'cover', borderRadius: 8, marginRight: 6 }} />)}<div className="acc-row"><button type="button" className="primary-btn small-btn" onClick={() => act(r.id, 'approve')}>Approve</button><button type="button" className="secondary-btn small-btn" onClick={() => act(r.id, 'reject')}>Reject</button></div></div>)}{data && !data.items.length && <p className="tiny-note">No reviews waiting.</p>}</div>);
}

function Enquiries() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/enquiries'), []);
  const set = async (id, status) => { await api(`/api/admin/enquiries/${id}`, { method: 'PATCH', body: { status } }).catch(() => {}); reload(); };
  return (<div><Note error={error} loading={loading} />{data?.items?.map((q) => <div key={q.id} className="acc-address"><strong>{q.id}</strong> • {q.type} • {q.status}<p>{q.name} ({q.email}{q.phone ? `, ${q.phone}` : ''}){q.company ? `, ${q.company}` : ''}{q.quantity ? `, qty ${q.quantity}` : ''}</p><p>{q.message}</p><button type="button" className="secondary-btn small-btn" onClick={() => set(q.id, q.status === 'open' ? 'resolved' : 'open')}>{q.status === 'open' ? 'Mark resolved' : 'Reopen'}</button></div>)}{data && !data.items.length && <p className="tiny-note">No enquiries yet.</p>}</div>);
}

function Settings() {
  const { data, error, loading } = useLoad(() => api('/api/admin/settings'), []);
  const [ship, setShip] = useState(null); const [biz, setBiz] = useState(null); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setShip(data.shipping); setBiz(data.business); } }, [data]);
  const save = async (url, body, okText) => { setMsg(''); try { await api(url, { method: 'PUT', body }); setMsg(okText); } catch (e) { setMsg(e.message); } };
  if (error || loading || !ship || !biz) return <Note error={error} loading={loading} />;
  return (
    <div>
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); save('/api/admin/settings/shipping', { freeShippingThreshold: Number(ship.freeShippingThreshold), shippingFee: Number(ship.shippingFee) }, 'Shipping settings saved.'); }}>
        <h4>Shipping</h4>
        <label>Free shipping above (₹) <input value={ship.freeShippingThreshold} onChange={(e) => setShip({ ...ship, freeShippingThreshold: e.target.value })} inputMode="decimal" /></label>
        <label>Flat fee when courier rate is unavailable (₹) <input value={ship.shippingFee} onChange={(e) => setShip({ ...ship, shippingFee: e.target.value })} inputMode="decimal" /></label>
        <button type="submit" className="primary-btn">Save shipping</button>
      </form>
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); save('/api/admin/settings/business', biz, 'Business details saved. They appear on invoices.'); }}>
        <h4>Business details (shown on invoices)</h4>
        {['legalName', 'address', 'phone', 'email', 'terms'].map((k) => <label key={k}>{({ legalName: 'Legal name', address: 'Address', phone: 'Phone', email: 'Email', terms: 'Invoice terms' })[k]}<input value={biz[k]} onChange={(e) => setBiz({ ...biz, [k]: e.target.value })} /></label>)}
        <fieldset className="plan-choice" data-testid="gst-settings">
          <legend>GST</legend>
          <label className="checkbox-row"><input type="checkbox" checked={Boolean(biz.gstEnabled)} onChange={(e) => setBiz({ ...biz, gstEnabled: e.target.checked })} /> Issue GST tax invoices (your product prices are treated as GST-inclusive)</label>
          <label>GSTIN<input value={biz.gstin || ''} maxLength={15} placeholder="15-character GSTIN" onChange={(e) => setBiz({ ...biz, gstin: e.target.value.toUpperCase() })} /></label>
          <label>GST rate<select value={biz.gstRatePercent ?? 18} onChange={(e) => setBiz({ ...biz, gstRatePercent: Number(e.target.value) })}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
          <label>Default HSN code (optional, 4 to 8 digits; a product's own HSN wins)<input value={biz.defaultHsn || ''} inputMode="numeric" maxLength={8} onChange={(e) => setBiz({ ...biz, defaultHsn: e.target.value })} /></label>
          <p className="tiny-note">Invoices show CGST + SGST when the customer's state matches your GSTIN's state, otherwise IGST. Ask your accountant to confirm the rate and HSN code for your products.</p>
        </fieldset>
        <button type="submit" className="primary-btn">Save business details</button>
      </form>
      {msg && <p role="status" className="tiny-note">{msg}</p>}
    </div>
  );
}

function Security({ me, onChanged }) {
  const [pw, setPw] = useState({ current: '', next: '' }); const [msg, setMsg] = useState('');
  const [setup, setSetup] = useState(null); const [code, setCode] = useState(''); const [disable, setDisable] = useState({ password: '', code: '' });
  const run = async (fn, ok) => { setMsg(''); try { await fn(); setMsg(ok); await onChanged(); } catch (e) { setMsg(e.message); } };
  return (
    <div>
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/auth/change-password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); }, 'Password changed.'); }}>
        <h4>Change password</h4>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <input type="password" autoComplete="new-password" placeholder="New password (12+ characters, upper, lower, digit, symbol)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <button type="submit" className="primary-btn">Change password</button>
      </form>
      <div className="admin-form">
        <h4>Two-factor login: {me?.totpEnabled ? 'on' : 'off'}</h4>
        {!me?.totpEnabled && !setup && <button type="button" className="secondary-btn" onClick={() => run(async () => setSetup(await api('/api/auth/2fa/setup', { method: 'POST' })), 'Add the key to your authenticator app, then enter a code below.')}>Set up two-factor login</button>}
        {!me?.totpEnabled && setup && (
          <>
            <p>Add this key in an authenticator app (Google Authenticator, Authy, 1Password): <code>{setup.secret}</code></p>
            <p className="tiny-note"><a href={setup.otpauthUrl}>Open in authenticator app</a> (works on a phone with one installed)</p>
            <input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="button" className="primary-btn" onClick={() => run(async () => { await api('/api/auth/2fa/enable', { method: 'POST', body: { code } }); setSetup(null); setCode(''); }, 'Two-factor login is on.')}>Turn on</button>
          </>
        )}
        {me?.totpEnabled && (
          <>
            <input type="password" placeholder="Password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
            <input inputMode="numeric" maxLength={6} placeholder="Current 6-digit code" value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} />
            <button type="button" className="secondary-btn" onClick={() => run(async () => { await api('/api/auth/2fa/disable', { method: 'POST', body: disable }); setDisable({ password: '', code: '' }); }, 'Two-factor login is off.')}>Turn off</button>
          </>
        )}
      </div>
      {msg && <p role="status" className="tiny-note">{msg}</p>}
    </div>
  );
}

export default function AdminTools() {
  const [tab, setTab] = useState('Reports');
  const [me, setMe] = useState(null);
  const loadMe = () => api('/api/auth/me').then((d) => setMe(d.user)).catch(() => {});
  useEffect(() => { loadMe(); }, []);
  const mustChange = Boolean(me?.mustChangePassword);
  return (
    <div className="admin-form-card">
      <h3>Admin tools</h3>
      {mustChange && <p role="alert" className="notice-text error">Please change your password first. Other admin sections stay locked until you do.</p>}
      <div className="tabs" role="tablist" style={{ flexWrap: 'wrap' }}>
        {(mustChange ? ['Security'] : TABS).map((t) => <button key={t} type="button" role="tab" aria-selected={(mustChange ? 'Security' : tab) === t} className={(mustChange ? 'Security' : tab) === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {(mustChange ? 'Security' : tab) === 'Reports' && <Reports />}
      {tab === 'Coupons' && !mustChange && <Coupons />}
      {tab === 'Customers' && !mustChange && <Customers />}
      {tab === 'Inventory' && !mustChange && <Inventory />}
      {tab === 'Reviews' && !mustChange && <Reviews />}
      {tab === 'Returns' && !mustChange && <Returns />}
      {tab === 'Enquiries' && !mustChange && <Enquiries />}
      {tab === 'Banners' && !mustChange && <Banners />}
      {tab === 'Links' && !mustChange && <Links />}
      {tab === 'Materials' && !mustChange && <Materials />}
      {tab === 'Roles' && !mustChange && <Roles />}
      {tab === 'Alerts' && !mustChange && <Alerts />}
      {tab === 'Settings' && !mustChange && <Settings />}
      {(mustChange || tab === 'Security') && <Security me={me} onChanged={loadMe} />}
    </div>
  );
}
