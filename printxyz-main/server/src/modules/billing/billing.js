import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { nextSequence } from '../../db/counters.js';
import { escapeHtml } from '../../services/mailer.js';
import { validateGstin, stateCodeFromName, computeInvoiceTax, refundTax, GST_STATES } from './gst.js';

// Financial year runs April to March, evaluated in IST.
export const financialYear = (date = new Date()) => {
  const ist = new Date(date.getTime() + 5.5 * 3600_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const pad = (n) => String(n).padStart(4, '0');

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${below100(n % 100)}`;
export const amountInWords = (paise) => {
  let rupees = Math.floor(paise / 100); const ps = paise % 100;
  if (rupees === 0 && ps === 0) return 'Zero Rupees Only';
  const parts = [];
  for (const [div, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']]) {
    const q = Math.floor(rupees / div); if (q) { parts.push(`${below1000(q)} ${name}`); rupees %= div; }
  }
  if (rupees) parts.push(below1000(rupees));
  const r = parts.length ? `${parts.join(' ')} Rupees` : '';
  return `${[r, ps ? `${below100(ps)} Paise` : ''].filter(Boolean).join(' and ')} Only`;
};

// Business details come from settings or env. Unset values stay visibly unset instead of being invented.
export const getBusinessSettings = async (db, config) => {
  const saved = (await db.collection('settings').findOne({ _id: 'business' })) || {};
  // GST is only active with a valid GSTIN, so a tax invoice can never be printed without one.
  const g = saved.gstEnabled ? validateGstin(saved.gstin) : { valid: false };
  const gst = g.valid ? { enabled: true, gstin: g.gstin, stateCode: g.stateCode, ratePercent: Number.isInteger(saved.gstRatePercent) ? saved.gstRatePercent : 18, defaultHsn: saved.defaultHsn || '' } : { enabled: false };
  return {
    gst,
    legalName: saved.legalName || 'Printxyz', address: saved.address || '{{BUSINESS_ADDRESS}}',
    email: saved.email || config?.support?.email || '', phone: saved.phone || config?.support?.phone || '',
    terms: saved.terms || 'Made-to-order items are non-returnable unless defective. See the refund policy on our website.'
  };
};

const snapshotBuyer = (o) => ({ name: o.customer.name, email: o.customer.email, phone: o.customer.phone,
  address: [o.customer.street, o.customer.apartment, o.customer.landmark, o.customer.city, o.customer.state, o.customer.pincode].filter(Boolean).join(', ') });

// Documents are write-once. There is no update path: corrections are credit notes.
export const issueInvoice = async ({ db, order, settings, now = new Date() }) => {
  const docs = db.collection('invoices');
  const existing = await docs.findOne({ orderId: order.id, type: 'invoice' });
  if (existing) return existing;
  if (order.paymentStatus !== 'paid' && !order.paidAt) throw new AppError(409, 'NOT_PAID', 'Invoices are issued only after payment is confirmed.');
  // Claim first so only one caller draws a number from the gapless sequence.
  const claim = await db.collection('orders').updateOne({ _id: order._id, invoiceClaimed: { $ne: true } }, { $set: { invoiceClaimed: true } });
  if (!claim.modifiedCount) return docs.findOne({ orderId: order.id, type: 'invoice' });
  try {
    const fy = financialYear(now);
    let gst = null;
    if (settings.gst?.enabled) {
      const ids = order.items.map((l) => l.productId);
      const products = ids.length ? await db.collection('products').find({ id: { $in: ids } }).toArray() : [];
      const hsnOf = (id) => products.find((p) => p.id === id)?.hsn || settings.gst.defaultHsn || '';
      const buyerStateCode = stateCodeFromName(order.customer.state);
      gst = { gstin: settings.gst.gstin, sellerStateCode: settings.gst.stateCode, buyerStateCode, placeOfSupply: buyerStateCode ? GST_STATES[buyerStateCode] : (order.customer.state || ''),
        ...computeInvoiceTax({ lines: order.items.map((l) => ({ description: l.title, hsn: hsnOf(l.productId), quantity: l.quantity, grossPaise: l.lineTotalPaise })),
          discountPaise: order.discountPaise || 0, shippingPaise: order.shippingPaise || 0, ratePercent: settings.gst.ratePercent, sellerStateCode: settings.gst.stateCode, buyerStateCode }) };
    }
    const doc = {
      _id: crypto.randomUUID(), type: 'invoice', ...(gst ? { gst } : {}), number: `PX/${fy}/${pad(await nextSequence(db, `invoice:${fy}`))}`,
      orderId: order.id, issuedAt: now, seller: settings, buyer: snapshotBuyer(order),
      lines: order.items.map((l) => ({ description: l.title, quantity: l.quantity, unitPricePaise: l.unitPricePaise, amountPaise: l.lineTotalPaise })),
      subtotalPaise: order.subtotalPaise, discountPaise: order.discountPaise, shippingPaise: order.shippingPaise, totalPaise: order.totalPaise,
      amountInWords: amountInWords(order.totalPaise), paymentId: order.paymentReference || '', paymentMethod: 'Online (Razorpay)'
    };
    await docs.insertOne(doc);
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { invoiceNumber: doc.number } });
    return doc;
  } catch (e) {
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { invoiceClaimed: false } });
    throw e;
  }
};

export const issueReceipt = async ({ db, order, paymentId, amountPaise, settings, now = new Date() }) => {
  const docs = db.collection('invoices');
  const existing = await docs.findOne({ type: 'receipt', paymentId });
  if (existing) return existing;
  const year = new Date(now.getTime() + 5.5 * 3600_000).getUTCFullYear();
  const doc = { _id: crypto.randomUUID(), type: 'receipt', number: `RCP-${year}-${pad(await nextSequence(db, `receipt:${year}`))}`,
    orderId: order.id, paymentId, issuedAt: now, seller: settings, buyer: snapshotBuyer(order), totalPaise: amountPaise, amountInWords: amountInWords(amountPaise) };
  try { await docs.insertOne(doc); } catch (e) { if (e?.code === 11000) return docs.findOne({ type: 'receipt', paymentId }); throw e; }
  return doc;
};

export const issueCreditNote = async ({ db, order, refund, settings, now = new Date() }) => {
  const docs = db.collection('invoices');
  const existing = await docs.findOne({ type: 'credit_note', refundId: refund.id });
  if (existing) return existing;
  const fy = financialYear(now);
  const doc = { _id: crypto.randomUUID(), type: 'credit_note', number: `CN/${fy}/${pad(await nextSequence(db, `credit_note:${fy}`))}`,
    orderId: order.id, refundId: refund.id, invoiceNumber: order.invoiceNumber || '', issuedAt: now, seller: settings, buyer: snapshotBuyer(order),
    reason: refund.reason || '', totalPaise: refund.amountPaise, amountInWords: amountInWords(refund.amountPaise) };
  // A credit note for a taxed invoice carries the tax contained in the refund, split like the original invoice.
  const original = order.invoiceNumber ? await docs.findOne({ orderId: order.id, type: 'invoice' }) : null;
  if (original?.gst) doc.gst = { gstin: original.gst.gstin, placeOfSupply: original.gst.placeOfSupply, ratePercent: original.gst.ratePercent, intra: original.gst.intra, ...refundTax({ amountPaise: refund.amountPaise, ratePercent: original.gst.ratePercent, intra: original.gst.intra }) };
  try { await docs.insertOne(doc); } catch (e) { if (e?.code === 11000) return docs.findOne({ type: 'credit_note', refundId: refund.id }); throw e; }
  return doc;
};

const inr = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TITLES = { invoice: 'Invoice', receipt: 'Payment receipt', credit_note: 'Credit note' };
const titleOf = (d) => (d.type === 'invoice' && d.gst ? 'Tax Invoice' : TITLES[d.type]);
// Printable page (Save as PDF from the browser). Every value is escaped. GST columns appear only on taxed invoices.
export const renderDocumentHtml = (d, { logoUrl = '/logo.jpeg' } = {}) => {
  const e = escapeHtml; const g = d.gst; const intra = g?.intra;
  const title = titleOf(d);
  const taxHead = g ? (intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>') : '';
  const taxCells = (r) => (intra ? `<td class="r">${inr(r.cgst)}</td><td class="r">${inr(r.sgst)}</td>` : `<td class="r">${inr(r.igst)}</td>`);
  let table = '';
  if (g && d.type === 'invoice') {
    const rows = g.lines.map((l) => `<tr><td>${e(l.description)}${l.hsn ? `<br><span class="m">HSN ${e(l.hsn)}</span>` : ''}</td><td class="r">${l.quantity}</td><td class="r">${inr(l.taxablePaise)}</td>${taxCells(l)}<td class="r">${inr(l.grossPaise)}</td></tr>`).join('');
    const t = g.totals;
    table = `<div class="wrap"><table><tr><th>Item</th><th class="r">Qty</th><th class="r">Taxable value</th>${taxHead}<th class="r">Amount</th></tr>${rows}
<tr class="tot"><td colspan="2">Total</td><td class="r">${inr(t.taxablePaise)}</td>${taxCells(t)}<td class="r">${inr(t.grossPaise)}</td></tr></table></div>
<p class="m">Prices include GST at ${g.ratePercent}%. ${intra ? `CGST ${g.ratePercent / 2}% + SGST ${g.ratePercent / 2}%` : `IGST ${g.ratePercent}%`}${d.discountPaise ? ` • Discount of ${inr(d.discountPaise)} is already deducted from the amounts above.` : ''}</p>`;
  } else if (d.lines) {
    const rows = d.lines.map((l) => `<tr><td>${e(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${inr(l.unitPricePaise)}</td><td class="r">${inr(l.amountPaise)}</td></tr>`).join('');
    const extra = d.type === 'invoice' ? `<tr><td colspan="3" class="r">Subtotal</td><td class="r">${inr(d.subtotalPaise)}</td></tr>${d.discountPaise ? `<tr><td colspan="3" class="r">Discount</td><td class="r">-${inr(d.discountPaise)}</td></tr>` : ''}<tr><td colspan="3" class="r">Shipping</td><td class="r">${inr(d.shippingPaise)}</td></tr>` : '';
    table = `<div class="wrap"><table><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>${rows}${extra}</table></div>`;
  }
  const cnTax = g && d.type === 'credit_note' ? `<p class="m">Includes GST of ${inr(g.taxPaise)} (taxable value ${inr(g.taxablePaise)}; ${g.intra ? `CGST ${inr(g.cgst)} + SGST ${inr(g.sgst)}` : `IGST ${inr(g.igst)}`}) • Place of supply: ${e(g.placeOfSupply)}</p>` : '';
  const sellerGst = d.seller.gst?.enabled ? `<br><strong>GSTIN: ${e(d.seller.gst.gstin)}</strong>` : '';
  const pos = g && d.type === 'invoice' ? ` • Place of supply: ${e(g.placeOfSupply)}` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} ${e(d.number)}</title><style>
body{font-family:Arial,sans-serif;color:#0F172A;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.45}
.head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #F97316;padding-bottom:12px;margin-bottom:12px}.head img{height:56px;width:auto;border-radius:6px}
h1{color:#0F172A;margin:0;font-size:22px}h2{margin:14px 0 4px;font-size:18px;color:#F97316}.m{color:#64748B;font-size:13px}.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border-bottom:1px solid #E2E8F0;padding:8px;text-align:left}th{background:#F8FAFC}.r{text-align:right;white-space:nowrap}.tot td{font-weight:700;border-top:2px solid #0F172A}
@media print{body{margin:0}}</style></head><body>
<div class="head"><img src="${e(logoUrl)}" alt="${e(d.seller.legalName)}"><div><h1>${e(d.seller.legalName)}</h1><span class="m">${e(d.seller.address)}<br>${e([d.seller.email, d.seller.phone].filter(Boolean).join(' • '))}</span>${sellerGst}</div></div>
<h2>${e(title)} ${e(d.number)}</h2><p class="m">Date: ${e(new Date(d.issuedAt).toLocaleDateString('en-IN'))} • Order: ${e(d.orderId)}${d.invoiceNumber ? ` • Against invoice: ${e(d.invoiceNumber)}` : ''}${pos}</p>
<p><strong>Billed to:</strong> ${e(d.buyer.name)}<br>${e(d.buyer.address)}<br>${e(d.buyer.email)} • ${e(d.buyer.phone)}</p>
${table}
<p><strong>${d.type === 'credit_note' ? 'Amount refunded' : 'Total'}: ${inr(d.totalPaise)}</strong><br><span class="m">${e(d.amountInWords)}</span></p>${cnTax}
${d.reason ? `<p class="m">Reason: ${e(d.reason)}</p>` : ''}${d.paymentId ? `<p class="m">Payment: ${e(d.paymentMethod || 'Online')} • ID ${e(d.paymentId)}</p>` : ''}
<p class="m">${e(d.seller.terms || '')}</p>${g && d.type === 'invoice' ? '<p class="m">This is a computer-generated tax invoice and does not need a signature.</p>' : ''}</body></html>`;
};
