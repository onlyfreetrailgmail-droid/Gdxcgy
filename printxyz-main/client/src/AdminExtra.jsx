import { useEffect, useState } from 'react';
import { api, upload, rupees } from './api';

function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const reload = () => { setState((s) => ({ ...s, loading: true })); return fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.status === 403 ? 'Your role does not have access to this section.' : e.message, loading: false })); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { ...state, reload };
}
const Note = ({ error, loading }) => (error ? <p role="alert" className="notice-text error">{error}</p> : loading ? <p className="tiny-note">Loading…</p> : null);
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// ---------------- Roles ----------------
export function Roles() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/staff'));
  const [form, setForm] = useState({ name: '', email: '', role: 'support' });
  const [msg, setMsg] = useState(''); const [secret, setSecret] = useState(null);
  const run = async (fn) => { setMsg(''); setSecret(null); try { await fn(); await reload(); } catch (e) { setMsg(e.message); } };
  if (error || loading || !data) return <Note error={error} loading={loading} />;
  return (
    <div data-testid="roles-screen">
      <h4>Team and roles</h4>
      {msg && <p role="alert" className="notice-text error">{msg}</p>}
      {secret && <p role="status" className="notice-text" data-testid="temp-password">One-time password for <strong>{secret.email}</strong>: <code>{secret.password}</code><br />Share it privately. They must change it at first sign-in. It will not be shown again.</p>}
      {data.items.map((u) => (
        <div key={u.id} className="acc-address">
          <strong>{u.name}</strong> • {u.email} {u.totpEnabled ? '• 2FA on' : ''} {u.mustChangePassword ? '• must change password' : ''}
          {u.id === data.you ? <p className="tiny-note">This is you ({u.role}).</p> : (
            <div className="acc-row">
              <select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => run(() => api(`/api/admin/staff/${u.id}/role`, { method: 'PUT', body: { role: e.target.value } }))}>
                {Object.keys(data.roles).map((r) => <option key={r} value={r}>{r}</option>)}<option value="user">remove staff access</option>
              </select>
              <button type="button" className="secondary-btn small-btn" onClick={() => run(async () => { const r = await api(`/api/admin/staff/${u.id}/reset-password`, { method: 'POST' }); setSecret({ email: u.email, password: r.temporaryPassword }); })}>Reset password</button>
            </div>
          )}
        </div>
      ))}
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api('/api/admin/staff', { method: 'POST', body: form }); setSecret({ email: r.user.email, password: r.temporaryPassword }); setForm({ name: '', email: '', role: 'support' }); }); }}>
        <h4>Add a team member</h4>
        <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input required type="email" placeholder="Email (must be new)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.keys(data.roles).map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <p className="tiny-note">{data.roles[form.role]}</p>
        <button type="submit" className="primary-btn small-btn">Create account</button>
      </form>
      <p className="tiny-note">Role changes end that person's sessions; their current page may keep working for up to 15 minutes.</p>
    </div>
  );
}

// ---------------- Banners and home sections ----------------
const blank = { title: '', subtitle: '', buttonText: 'Shop now', link: '/', imageDesktop: '', imageMobile: '', position: 0, active: true, startsAt: '', endsAt: '' };
export function Banners() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/banners'));
  const sections = useLoad(() => api('/api/admin/sections'));
  const [form, setForm] = useState(blank); const [editing, setEditing] = useState(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const save = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      const body = { ...form, startsAt: form.startsAt || null, endsAt: form.endsAt || null };
      if (editing) await api(`/api/admin/banners/${editing}`, { method: 'PUT', body }); else await api('/api/admin/banners', { method: 'POST', body });
      setForm(blank); setEditing(null); await reload(); setMsg('Banner saved.');
    } catch (err) { setMsg(err.message); }
  };
  const pickImage = async (e, field) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setBusy(true); setMsg('');
    try { const r = await upload('/api/admin/uploads/banner-image', [f], 'file'); setForm((cur) => ({ ...cur, [field]: r.url })); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };
  const [chosen, setChosen] = useState(null);
  useEffect(() => { if (sections.data) setChosen(sections.data.items); }, [sections.data]);
  const toggle = (k) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const move = (k, d) => setChosen((c) => { const i = c.indexOf(k); const j = i + d; if (j < 0 || j >= c.length) return c; const n = [...c]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <div data-testid="banners-screen">
      <Note error={error} loading={loading} />
      {msg && <p role="status" className="tiny-note">{msg}</p>}
      {data?.items?.map((b) => (
        <div key={b.id} className="acc-address">
          <strong>{b.title}</strong> • position {b.position} • {b.active ? 'live' : 'hidden'} {b.startsAt || b.endsAt ? `• ${day(b.startsAt)} → ${day(b.endsAt)}` : ''}
          <div className="acc-row">
            <button type="button" className="secondary-btn small-btn" onClick={() => { setEditing(b.id); setForm({ ...blank, ...b, startsAt: day(b.startsAt), endsAt: day(b.endsAt) }); }}>Edit</button>
            <button type="button" className="text-link danger" onClick={async () => { if (window.confirm('Delete this banner?')) { await api(`/api/admin/banners/${b.id}`, { method: 'DELETE' }).catch((e) => setMsg(e.message)); reload(); } }}>Delete</button>
          </div>
        </div>
      ))}
      {data && !data.items.length && <p className="tiny-note">No banners yet. The home page shows its default banner until you add one.</p>}
      <form className="admin-form" onSubmit={save}>
        <h4>{editing ? 'Edit banner' : 'Add banner'}</h4>
        <input required placeholder="Headline" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input placeholder="Sub-heading" maxLength={220} value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
        <div className="acc-row"><input placeholder="Button text" maxLength={40} value={form.buttonText} onChange={(e) => setForm({ ...form, buttonText: e.target.value })} /><input placeholder="Link (e.g. /category/devotional)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} /></div>
        <input required placeholder="Desktop image URL (https)" value={form.imageDesktop} onChange={(e) => setForm({ ...form, imageDesktop: e.target.value })} />
        <label>…or upload <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => pickImage(e, 'imageDesktop')} /></label>
        <input placeholder="Mobile image URL (optional)" value={form.imageMobile} onChange={(e) => setForm({ ...form, imageMobile: e.target.value })} />
        <div className="acc-row">
          <label>Order <input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></label>
          <label>Show from <input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
          <label>Until <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
          <label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Live</label>
        </div>
        <div className="acc-row"><button type="submit" className="primary-btn small-btn">Save banner</button>{editing && <button type="button" className="text-link" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</button>}</div>
      </form>

      <h4>Home page product rows</h4>
      <Note error={sections.error} loading={sections.loading} />
      {sections.data && chosen && (
        <div>
          {Object.entries(sections.data.choices).map(([k, label]) => (
            <div key={k} className="acc-row">
              <label><input type="checkbox" checked={chosen.includes(k)} onChange={() => toggle(k)} /> {label}</label>
              {chosen.includes(k) && <><button type="button" className="text-link" onClick={() => move(k, -1)} aria-label={`Move ${label} up`}>↑</button><button type="button" className="text-link" onClick={() => move(k, 1)} aria-label={`Move ${label} down`}>↓</button></>}
            </div>
          ))}
          <button type="button" className="secondary-btn small-btn" onClick={async () => { try { await api('/api/admin/sections', { method: 'PUT', body: { items: chosen } }); setMsg('Home sections saved.'); } catch (e) { setMsg(e.message); } }}>Save home sections</button>
          <p className="tiny-note">Rows show products whose "section" matches. Products are assigned a section when added.</p>
        </div>
      )}
    </div>
  );
}

// ---------------- Returns ----------------
export function Returns() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/returns'));
  const [msg, setMsg] = useState(''); const [note, setNote] = useState({}); const [amt, setAmt] = useState({});
  const act = async (r, action) => {
    setMsg('');
    try { await api(`/api/admin/returns/${r.id}/${action}`, { method: 'POST', body: { note: note[r.id], amount: action === 'refund' ? amt[r.id] : undefined } }); await reload(); setMsg(`${r.id}: ${action} done.`); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <div data-testid="returns-screen">
      <Note error={error} loading={loading} />
      {msg && <p role="status" className="tiny-note">{msg}</p>}
      {data && !data.items.length && <p className="tiny-note">No return requests.</p>}
      {data?.items?.map((r) => (
        <div key={r.id} className="acc-address">
          <strong>{r.id}</strong> • order {r.orderId} • <em>{r.status}</em> • {r.reasonLabel}
          <p>{r.details}</p>
          <p className="tiny-note">{r.items.map((i) => `${i.quantity} × ${i.title}`).join(', ')} • items {rupees(r.itemsPaise)} • {r.customerEmail} • {when(r.createdAt)}</p>
          {r.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-link">Photo </a>)}
          {['requested', 'approved', 'received'].includes(r.status) && (
            <div className="acc-row">
              <input placeholder="Note to customer" value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
              {r.status === 'requested' && <><button type="button" className="primary-btn small-btn" onClick={() => act(r, 'approve')}>Approve</button><button type="button" className="secondary-btn small-btn" onClick={() => act(r, 'reject')}>Decline</button></>}
              {r.status === 'approved' && <button type="button" className="secondary-btn small-btn" onClick={() => act(r, 'received')}>Mark received</button>}
              {['approved', 'received'].includes(r.status) && <><input type="number" min="1" placeholder={`Refund ₹ (default ${r.itemsPaise / 100})`} value={amt[r.id] || ''} onChange={(e) => setAmt({ ...amt, [r.id]: e.target.value })} /><button type="button" className="primary-btn small-btn" onClick={() => act(r, 'refund')}>Refund</button></>}
              <button type="button" className="text-link" onClick={() => act(r, 'close')}>Close</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- Alerts ----------------
export function Alerts() {
  const { data, error, loading, reload } = useLoad(() => api('/api/admin/alerts'));
  const [msg, setMsg] = useState('');
  return (
    <div data-testid="alerts-screen">
      <Note error={error} loading={loading} />
      {data && (
        <>
          <p className="tiny-note">Delivery: email {data.notify.email ? 'on' : 'off (set ALERT_EMAIL)'} • webhook {data.notify.webhook ? 'on' : 'off (set ALERT_WEBHOOK_URL)'} • uptime heartbeat {data.notify.heartbeat ? 'on' : 'off (set UPTIME_HEARTBEAT_URL)'}</p>
          <button type="button" className="secondary-btn small-btn" onClick={async () => { try { const r = await api('/api/admin/alerts/test', { method: 'POST' }); setMsg(r.notified ? 'Test alert sent.' : 'Test alert stored, but no delivery channel is configured.'); reload(); } catch (e) { setMsg(e.message); } }}>Send test alert</button>
          {msg && <p role="status" className="tiny-note">{msg}</p>}
          {!data.items.length && <p className="tiny-note">No alerts. Payment failures, webhook problems, email backlog, stuck refunds and database outages appear here.</p>}
          {data.items.map((a) => (
            <div key={a.key} className="acc-address">
              <strong>{a.severity === 'critical' ? '🔴' : a.severity === 'info' ? 'ℹ️' : '🟠'} {a.title}</strong> • {a.status} • seen {a.count}× • last {when(a.lastSeenAt)}
              <p>{a.message}</p>
              {a.status === 'open' && <button type="button" className="text-link" onClick={async () => { await api(`/api/admin/alerts/${encodeURIComponent(a.key)}/resolve`, { method: 'POST' }).catch(() => {}); reload(); }}>Mark resolved</button>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------- Materials (owner supplies the facts) ----------------
export function Materials() {
  const { data, error, loading } = useLoad(() => api('/api/materials'));
  const [intro, setIntro] = useState(''); const [items, setItems] = useState([]); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setIntro(data.intro); setItems(data.items); } }, [data]);
  if (error || loading) return <Note error={error} loading={loading} />;
  const set = (i, k, v) => setItems((cur) => cur.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  return (
    <div data-testid="materials-screen">
      <p className="tiny-note">Write only what is true for your products. The public Material guide shows exactly this and stays hidden from the menu until you add a material.</p>
      <textarea rows={2} maxLength={600} placeholder="Short introduction (optional)" value={intro} onChange={(e) => setIntro(e.target.value)} />
      {items.map((m, i) => (
        <div key={i} className="acc-address">
          <input placeholder="Material name (e.g. as you describe it to customers)" maxLength={60} value={m.name} onChange={(e) => set(i, 'name', e.target.value)} />
          <input placeholder="Finish" maxLength={120} value={m.finish || ''} onChange={(e) => set(i, 'finish', e.target.value)} />
          <input placeholder="Best for" maxLength={300} value={m.bestFor || ''} onChange={(e) => set(i, 'bestFor', e.target.value)} />
          <input placeholder="Care instructions" maxLength={400} value={m.care || ''} onChange={(e) => set(i, 'care', e.target.value)} />
          <input placeholder="Limits (heat, outdoor use, etc.)" maxLength={300} value={m.limits || ''} onChange={(e) => set(i, 'limits', e.target.value)} />
          <button type="button" className="text-link danger" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="acc-row">
        <button type="button" className="secondary-btn small-btn" disabled={items.length >= 12} onClick={() => setItems([...items, { name: '' }])}>Add material</button>
        <button type="button" className="primary-btn small-btn" onClick={async () => { try { await api('/api/admin/materials', { method: 'PUT', body: { intro, items } }); setMsg('Saved.'); } catch (e) { setMsg(e.message); } }}>Save</button>
      </div>
      {msg && <p role="status" className="tiny-note">{msg}</p>}
    </div>
  );
}

// ---------------- Share links for ads ----------------
const copy = async (text, setMsg) => {
  try { await navigator.clipboard.writeText(text); setMsg('Copied.'); }
  catch { window.prompt('Copy this link:', text); }
};

export function Links() {
  const links = useLoad(() => api('/api/admin/links'));
  const catalog = useLoad(() => api('/api/products'));
  const [form, setForm] = useState({ type: 'product', value: '', placement: 'instagram_ad', campaign: '', content: '' });
  const [made, setMade] = useState(null); const [msg, setMsg] = useState('');
  const items = catalog.data?.items || [];
  const categories = [...new Map(items.map((p) => [p.categorySlug, p.category])).entries()];
  const options = form.type === 'product' ? items.map((p) => [p.slug, p.title]) : form.type === 'category' ? categories : [['/', 'Home page'], ['/bulk-orders', 'Bulk orders'], ['/gallery', 'Gallery'], ['/contact', 'Contact']];

  const create = async (e) => {
    e.preventDefault(); setMsg(''); setMade(null);
    try { const r = await api('/api/admin/links', { method: 'POST', body: form }); setMade(r.item); await links.reload(); }
    catch (err) { setMsg(err.message); }
  };
  if (links.error || links.loading || !links.data) return <Note error={links.error} loading={links.loading} />;
  return (
    <div data-testid="links-screen">
      <h4>Create a share link for an ad or video</h4>
      <p className="tiny-note">Pick what to promote and where the link will be posted. The link records visits from that ad. Paste the short link in your Instagram ad button, YouTube description or WhatsApp message.</p>
      <form className="admin-form" onSubmit={create}>
        <select aria-label="What to link" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, value: '' })}>
          <option value="product">A product</option><option value="category">A category</option><option value="page">A page</option>
        </select>
        <select aria-label="Item" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}>
          <option value="">Choose…</option>{options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <select aria-label="Where will you share it" value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })}>
          {Object.entries(links.data.placements).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        <input required placeholder="Campaign name, e.g. diwali-sale" maxLength={60} value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} />
        <input placeholder="Ad or video name (optional), e.g. reel-1" maxLength={60} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        <button type="submit" className="primary-btn small-btn">Create link</button>
      </form>
      {msg && <p role="alert" className="notice-text error">{msg}</p>}
      {made && (
        <div className="admin-form-card" data-testid="made-link">
          <strong>Your link is ready</strong>
          <p>Short link (recommended): <code>{made.shortUrl}</code></p>
          <div className="acc-row"><button type="button" className="primary-btn small-btn" onClick={() => copy(made.shortUrl, setMsg)}>Copy short link</button><button type="button" className="secondary-btn small-btn" onClick={() => copy(made.longUrl, setMsg)}>Copy full link</button></div>
          <p className="tiny-note">Instagram captions do not make links clickable. Use the bio link, a story link sticker, or the ad's website button. YouTube descriptions are clickable.</p>
        </div>
      )}
      <h4>Your links</h4>
      {!links.data.items.length && <p className="tiny-note">No links yet.</p>}
      {links.data.items.map((l) => (
        <div key={l.code} className="acc-address">
          <strong>{l.title}</strong> • {l.placement.replace(/_/g, ' ')} • campaign {l.utm.utm_campaign}{l.utm.utm_content ? ` • ${l.utm.utm_content}` : ''}
          <p className="tiny-note"><code>{l.shortUrl}</code> • {l.clicks} click{l.clicks === 1 ? '' : 's'}{l.lastClickAt ? ` • last ${when(l.lastClickAt)}` : ''} • {l.active ? 'active' : 'disabled'}</p>
          <div className="acc-row">
            <button type="button" className="secondary-btn small-btn" onClick={() => copy(l.shortUrl, setMsg)}>Copy</button>
            <button type="button" className="text-link" onClick={async () => { await api(`/api/admin/links/${l.code}/${l.active ? 'disable' : 'enable'}`, { method: 'POST' }).catch((e) => setMsg(e.message)); links.reload(); }}>{l.active ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
