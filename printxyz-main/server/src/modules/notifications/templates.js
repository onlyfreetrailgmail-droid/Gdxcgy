import { escapeHtml as e } from '../../services/mailer.js';

const NAVY = '#0F172A'; const ORANGE = '#F97316'; const MUTED = '#64748B';
const money = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Mobile-friendly single-column layout. Every dynamic value is escaped; links are built here, never taken raw from data.
const layout = ({ title, bodyHtml, cta, unsubscribeUrl }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:${NAVY}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:${NAVY};padding:18px 24px;color:#fff;font-size:20px;font-weight:700">Print<span style="color:${ORANGE}">xyz</span></td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.55"><h2 style="margin:0 0 12px;font-size:20px">${e(title)}</h2>${bodyHtml}
${cta ? `<p style="margin:24px 0 0"><a href="${e(cta.url)}" style="background:${ORANGE};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:700">${e(cta.label)}</a></p>` : ''}</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:${MUTED}">You are receiving this about your Printxyz order.${unsubscribeUrl ? ` <a href="${e(unsubscribeUrl)}" style="color:${MUTED}">Unsubscribe from reminders</a>.` : ''}</td></tr>
</table></td></tr></table></body></html>`;

const track = (ctx, d) => `${ctx.siteUrl}/track/${encodeURIComponent(d.trackToken || '')}`;

const T = {
  welcome: (d, ctx) => ({
    subject: 'Welcome to Printxyz', title: `Welcome, ${d.name || 'there'}`,
    body: `<p>Thanks for creating your Printxyz account. You can track orders, save addresses and keep a wishlist.</p>`,
    cta: { label: 'Start shopping', url: ctx.siteUrl }, text: `Welcome to Printxyz. ${ctx.siteUrl}`
  }),
  review_request: (d, ctx) => ({
    subject: `How was your order ${d.orderId}?`, title: 'Tell us how it turned out',
    body: `<p>Hi ${e(d.name)}, your order <strong>${e(d.orderId)}</strong> was delivered. If you have a minute, a short review helps other buyers.</p>`,
    cta: { label: 'Write a review', url: `${ctx.siteUrl}/product/${encodeURIComponent(d.productSlug || '')}#reviews` }, text: `Review your purchase: ${ctx.siteUrl}/product/${encodeURIComponent(d.productSlug || '')}#reviews`
  }),
  enquiry_alert: (d) => ({
    subject: `New ${d.type === 'bulk' ? 'bulk' : 'contact'} enquiry ${d.id}`, title: `Enquiry ${d.id}`,
    body: `<p><strong>${e(d.name)}</strong> (${e(d.email)}${d.phone ? `, ${e(d.phone)}` : ''})</p><p>${e(d.message)}</p>`, text: `${d.name} <${d.email}>: ${d.message}`
  }),
  order_paid: (d, ctx) => ({
    subject: `Payment received: order ${d.orderId}`, title: `Thank you, ${d.name}`,
    body: `<p>We received your payment of <strong>${e(money(d.amount))}</strong> for order <strong>${e(d.orderId)}</strong>.</p><p>We will keep you updated as your order moves through production and shipping.</p>`,
    cta: { label: 'Track your order', url: track(ctx, d) }, secondary: d.invoiceUrl ? { label: 'View invoice', url: d.invoiceUrl } : null,
    text: `Thank you, ${d.name}. We received your payment of ${money(d.amount)} for order ${d.orderId}. Track: ${track(ctx, d)}`
  }),
  preview_ready: (d, ctx) => ({
    subject: `Your design preview is ready (${d.orderId})`, title: 'Your design preview is ready',
    body: `<p>Hi ${e(d.name)}, the preview for order <strong>${e(d.orderId)}</strong> is ready for your approval.</p>${d.note ? `<p>${e(d.note)}</p>` : ''}${d.previewUrl ? `<p><a href="${e(d.previewUrl)}">Open the preview</a></p>` : ''}<p>Production starts only after you approve.</p>`,
    cta: { label: 'Review and approve', url: track(ctx, d) },
    text: `Your preview for order ${d.orderId} is ready. Review and approve: ${track(ctx, d)}`
  }),
  shipped: (d, ctx) => ({
    subject: `Your order ${d.orderId} has been shipped`, title: 'Your order is on its way',
    body: `<p>Hi ${e(d.name)}, order <strong>${e(d.orderId)}</strong> has been picked up${d.courier ? ` by ${e(d.courier)}` : ''}.</p>${d.awb ? `<p>Tracking number: <strong>${e(d.awb)}</strong></p>` : ''}`,
    cta: { label: 'Track your order', url: d.trackingUrl && /^https:\/\//.test(d.trackingUrl) ? d.trackingUrl : track(ctx, d) },
    text: `Order ${d.orderId} has shipped. ${d.awb ? `Tracking number ${d.awb}. ` : ''}${track(ctx, d)}`
  }),
  out_for_delivery: (d, ctx) => ({
    subject: `Out for delivery: order ${d.orderId}`, title: 'Arriving today', body: `<p>Hi ${e(d.name)}, order <strong>${e(d.orderId)}</strong> is out for delivery. Please keep your phone handy.</p>`,
    cta: { label: 'Track your order', url: track(ctx, d) }, text: `Order ${d.orderId} is out for delivery. ${track(ctx, d)}`
  }),
  delivered: (d, ctx) => ({
    subject: `Delivered: order ${d.orderId}`, title: 'Your order was delivered', body: `<p>Hi ${e(d.name)}, order <strong>${e(d.orderId)}</strong> has been delivered. We hope you love it. If anything is wrong, just reply to this email.</p>`,
    cta: { label: 'View order', url: track(ctx, d) }, text: `Order ${d.orderId} was delivered. ${track(ctx, d)}`
  }),
  order_cancelled: (d, ctx) => ({
    subject: `Order ${d.orderId} cancelled`, title: 'Your order is cancelled',
    body: `<p>Hi ${e(d.name)}, order <strong>${e(d.orderId)}</strong> has been cancelled as you asked.</p><p>${d.refundStarted ? 'Your refund has started. Banks usually take 5 to 7 working days to show it.' : 'Our team will process your refund shortly and email you when it is done.'}</p>`,
    cta: { label: 'View order', url: track(ctx, d) },
    text: `Order ${d.orderId} is cancelled. ${d.refundStarted ? 'Your refund has started.' : 'Our team will process your refund shortly.'}`
  }),
  refund_processed: (d, ctx) => ({
    subject: `Refund processed for order ${d.orderId}`, title: 'Your refund is on its way',
    body: `<p>Hi ${e(d.name)}, we refunded <strong>${e(money(d.amount))}</strong> for order <strong>${e(d.orderId)}</strong>. Banks usually take 5 to 7 working days to show it.</p>${d.creditNote ? `<p>Credit note: ${e(d.creditNote)}</p>` : ''}`,
    cta: { label: 'View order', url: track(ctx, d) }, text: `We refunded ${money(d.amount)} for order ${d.orderId}.`
  }),
  advance_paid: (d, ctx) => ({
    subject: `Advance received: order ${d.orderId}`, title: `Thank you, ${d.name}`,
    body: `<p>We received your advance of <strong>${e(money(d.amount))}</strong> for order <strong>${e(d.orderId)}</strong>.</p><p>The remaining <strong>${e(money(d.balance))}</strong> is due before we ship. We will email you when your order is ready, and you can also pay it any time from your tracking page.</p>`,
    cta: { label: 'Track your order', url: track(ctx, d) },
    text: `We received your advance of ${money(d.amount)} for order ${d.orderId}. Balance ${money(d.balance)} is due before shipping. Track: ${track(ctx, d)}`
  }),
  balance_due: (d, ctx) => ({
    subject: `Balance due for order ${d.orderId}`, title: 'Your order is ready for the final payment',
    body: `<p>Hi ${e(d.name)}, order <strong>${e(d.orderId)}</strong> is ready. Please pay the remaining <strong>${e(money(d.balance))}</strong> so we can ship it.</p>`,
    cta: { label: `Pay ${money(d.balance)}`, url: track(ctx, d) }, text: `Order ${d.orderId}: please pay the balance of ${money(d.balance)} so we can ship. ${track(ctx, d)}`
  }),
  balance_reminder: (d, ctx) => ({
    subject: `Reminder: balance due for order ${d.orderId}`, title: 'A small reminder about your balance',
    body: `<p>Hi ${e(d.name)}, your order <strong>${e(d.orderId)}</strong> is waiting for the remaining <strong>${e(money(d.balance))}</strong> before it can ship.</p>`,
    cta: { label: `Pay ${money(d.balance)}`, url: track(ctx, d) }, text: `Reminder: balance of ${money(d.balance)} for order ${d.orderId}. ${track(ctx, d)}`
  }),
  return_alert: (d) => ({
    subject: `New return request ${d.returnId} for order ${d.orderId}`, title: `Return request ${d.returnId}`,
    body: `<p>Order <strong>${e(d.orderId)}</strong>, reason: <strong>${e(d.reason)}</strong>.</p><p>${e(d.details || '')}</p>`, text: `Return ${d.returnId} for order ${d.orderId}: ${d.reason}. ${d.details || ''}`
  }),
  return_update: (d, ctx) => ({
    subject: `Return request ${d.returnId}: ${d.statusLabel}`, title: `Your return request: ${d.statusLabel}`,
    body: `<p>Hi ${e(d.name)}, your return request <strong>${e(d.returnId)}</strong> for order <strong>${e(d.orderId)}</strong> is now <strong>${e(d.statusLabel)}</strong>.</p>${d.note ? `<p>${e(d.note)}</p>` : ''}${d.refundAmount ? `<p>Refund: <strong>${e(money(d.refundAmount))}</strong>. Banks usually take 5 to 7 working days to show it.</p>` : ''}`,
    cta: { label: 'View order', url: track(ctx, d) }, text: `Return ${d.returnId} for order ${d.orderId} is ${d.statusLabel}. ${d.note || ''}`
  }),
  abandoned_cart: (d, ctx) => ({
    subject: 'You left something behind at Printxyz', title: 'Still thinking it over?',
    body: `<p>Hi ${e(d.name)}, your checkout was not completed, so we released your items. They may still be available.</p><p>Items: ${e(d.itemsSummary || '')}</p>`,
    cta: { label: 'Back to my cart', url: `${ctx.siteUrl}/cart` }, text: `You left items in your cart. ${ctx.siteUrl}/cart`
  })
};

export const TEMPLATE_NAMES = Object.keys(T);

export const renderEmail = (name, data, ctx) => {
  const build = T[name];
  if (!build) throw new Error(`Unknown email template: ${name}`);
  const t = build(data || {}, ctx);
  let bodyHtml = t.body;
  if (t.secondary) bodyHtml += `<p><a href="${e(t.secondary.url)}">${e(t.secondary.label)}</a></p>`;
  return { subject: t.subject, text: `${t.text}${ctx.unsubscribeUrl ? `\nUnsubscribe from reminders: ${ctx.unsubscribeUrl}` : ''}`, html: layout({ title: t.title, bodyHtml, cta: t.cta, unsubscribeUrl: ctx.unsubscribeUrl }) };
};
