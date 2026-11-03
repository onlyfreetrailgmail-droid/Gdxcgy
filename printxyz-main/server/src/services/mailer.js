const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc as escapeHtml };

export const createMailer = (config) => {
  const configured = Boolean(config.resend.apiKey && config.resend.from);
  const send = async ({ to, subject, html, text, tags = [], headers }) => {
    if (!configured) return { ok: false, skipped: true };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.resend.from, to: Array.isArray(to) ? to : [to], subject, html, text, tags, ...(headers ? { headers } : {}) }),
        signal: AbortSignal.timeout(10_000)
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, id: data?.id || null };
    } catch { return { ok: false, error: true }; }
  };
  return {
    configured, send,
    sendOtp: async (email, otp) => (await send({
      to: email, subject: 'Your Printxyz login code',
      html: `<div style="font-family:Arial,sans-serif;padding:24px"><h2>Your Printxyz login code</h2><p style="font-size:32px;letter-spacing:6px;font-weight:700">${esc(otp)}</p><p>It expires in 10 minutes. If you did not ask for it, ignore this email.</p></div>`,
      text: `Your Printxyz login code is ${otp}. It expires in 10 minutes.`, tags: [{ name: 'source', value: 'otp-login' }]
    })).ok
  };
};
