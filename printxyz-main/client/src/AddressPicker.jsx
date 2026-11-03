import { useEffect, useState } from 'react';

// For logged-in customers only. Renders nothing for guests (the request is simply rejected).
export default function AddressPicker({ onPick }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let live = true;
    fetch('/api/account/addresses').then((r) => (r.ok ? r.json() : { items: [] })).then((d) => {
      if (!live) return;
      const list = Array.isArray(d.items) ? d.items : [];
      setItems(list);
      const preferred = list.find((a) => a.isDefault);
      if (preferred) onPick(preferred);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!items.length) return null;
  return (
    <label className="acc-field">Use a saved address
      <select defaultValue={(items.find((a) => a.isDefault) || {}).id || ''} onChange={(event) => { const a = items.find((x) => x.id === event.target.value); if (a) onPick(a); }}>
        <option value="">Enter a new address</option>
        {items.map((a) => <option key={a.id} value={a.id}>{a.label}: {a.street}, {a.city} {a.pincode}</option>)}
      </select>
    </label>
  );
}
