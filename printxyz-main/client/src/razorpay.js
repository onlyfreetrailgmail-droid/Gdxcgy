// Loads Razorpay Checkout once and opens it for an order the server already created.
export const loadRazorpay = async () => {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Unable to load the payment window. Check your connection and retry.'));
    document.body.appendChild(script);
  });
  if (!window.Razorpay) throw new Error('Payment window is not available.');
};

export const openCheckout = async ({ data, description, prefill, onPaid, onDismiss, onFailed }) => {
  await loadRazorpay();
  const rz = new window.Razorpay({
    key: data.keyId, amount: data.amount, currency: data.currency, name: 'Printxyz', description, order_id: data.order.id,
    handler: onPaid, prefill, theme: { color: '#0f172a' }, modal: { ondismiss: () => onDismiss?.() }
  });
  rz.on?.('payment.failed', () => onFailed?.());
  rz.open();
};
