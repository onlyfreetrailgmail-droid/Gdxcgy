import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent, subscribeConsent } from './tracking';

// Equal-weight Accept and Reject buttons; rejecting keeps the shop fully usable.
export default function CookieBanner() {
  const [decided, setDecided] = useState(() => getConsent() !== null);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeConsent(() => { setDecided(getConsent() !== null); setOpen(false); }), []);
  useEffect(() => { const reopen = () => setOpen(true); window.addEventListener('printxyz:cookie-settings', reopen); return () => window.removeEventListener('printxyz:cookie-settings', reopen); }, []);
  if (decided && !open) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie preferences">
      <p>
        We use essential cookies to run the shop. With your permission we also use marketing cookies (Meta Pixel) to measure our ads and show relevant offers.
        {' '}<Link to="/policies/privacy">Privacy policy</Link>
      </p>
      <div className="cookie-actions">
        <button type="button" className="secondary-btn" onClick={() => setConsent(false)}>Essential only</button>
        <button type="button" className="primary-btn" onClick={() => setConsent(true)}>Accept all</button>
      </div>
    </div>
  );
}
export const openCookieSettings = () => window.dispatchEvent(new Event('printxyz:cookie-settings'));
