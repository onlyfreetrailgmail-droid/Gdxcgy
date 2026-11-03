import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';

// Shows only what the owner has entered in Admin > Materials. Nothing is pre-filled or invented.
export default function MaterialGuidePage() {
  const [data, setData] = useState(null);
  useEffect(() => { document.title = 'Material guide | Printxyz'; api('/api/materials').then(setData).catch(() => setData({ intro: '', items: [] })); }, []);
  if (!data) return <div className="container page-shell"><p className="tiny-note">Loading…</p></div>;
  return (
    <div className="container page-shell">
      <div className="page-header"><p className="eyebrow">Guide</p><h1>Materials and finishes</h1></div>
      {data.intro && <p>{data.intro}</p>}
      {data.items.length === 0 && <p>This guide is being prepared. For questions about materials, <Link to="/contact">contact us</Link>.</p>}
      <div className="admin-panel-grid">
        {data.items.map((m) => (
          <article key={m.name} className="admin-form-card">
            <h3>{m.name}</h3>
            {m.finish && <p><strong>Finish:</strong> {m.finish}</p>}
            {m.bestFor && <p><strong>Best for:</strong> {m.bestFor}</p>}
            {m.care && <p><strong>Care:</strong> {m.care}</p>}
            {m.limits && <p><strong>Limits:</strong> {m.limits}</p>}
          </article>
        ))}
      </div>
      <p className="tiny-note"><Link to="/care">Care guide</Link> · <Link to="/size-guide">Size guide</Link></p>
    </div>
  );
}
