import { useEffect, useState } from 'react';

// Asks the server (which asks the couriers). Shows an estimate only if a courier returned one.
export default function PincodeCheck({ initial = '' }) {
  const [pincode, setPincode] = useState(initial);
  useEffect(() => { if (/^\d{6}$/.test(initial)) setPincode(initial); }, [initial]);
  const [state, setState] = useState({ loading: false, message: '', tone: '' });

  const check = async (event) => {
    event.preventDefault();
    if (!/^[1-9]\d{5}$/.test(pincode)) {
      setState({ loading: false, message: 'Enter a valid 6-digit pincode.', tone: 'error' });
      return;
    }
    setState({ loading: true, message: '', tone: '' });
    try {
      const response = await fetch(`/api/shipping/serviceability?pincode=${pincode}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Could not check this pincode.');
      if (!data.configured || data.serviceable === null) {
        setState({ loading: false, message: 'We could not confirm delivery for this pincode right now. Contact us and we will check for you.', tone: '' });
      } else if (!data.serviceable) {
        setState({ loading: false, message: 'Sorry, delivery is not available for this pincode yet.', tone: 'error' });
      } else {
        const etd = data.options.map((o) => o.etd).find(Boolean);
        const eta = etd ? ` Courier estimate: ${etd} (after production).` : '';
        setState({ loading: false, message: `Delivery is available.${eta}`, tone: 'success' });
      }
    } catch (error) {
      setState({ loading: false, message: error.message, tone: 'error' });
    }
  };

  return (
    <form className="pincode-check" onSubmit={check} aria-label="Check delivery">
      <label htmlFor="pincode-input">Check delivery</label>
      <div className="pincode-row">
        <input id="pincode-input" inputMode="numeric" maxLength={6} placeholder="Pincode" value={pincode}
          onChange={(event) => setPincode(event.target.value.replace(/\D/g, ''))} />
        <button type="submit" className="secondary-btn" disabled={state.loading}>{state.loading ? 'Checking…' : 'Check'}</button>
      </div>
      {state.message && <p role="status" className={`pincode-msg ${state.tone}`}>{state.message}</p>}
    </form>
  );
}
