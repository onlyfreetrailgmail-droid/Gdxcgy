import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { validateGstin, stateCodeFromName, computeInvoiceTax, carveTax, refundTax } from '../src/modules/billing/gst.js';
import { getBusinessSettings, issueInvoice, issueCreditNote, renderDocumentHtml } from '../src/modules/billing/billing.js';
import { updateBusiness } from '../src/modules/settings/settings.js';

// Published sample GSTINs (valid structure and check digit). Not Printxyz's number.
const MH = '27AAPFU0939F1ZV'; const DL = '07AAGFF2194N1Z1';
const actor = { sub: 'o', email: 'o@x.com', role: 'owner' };

test('GSTIN validation: structure, state code and check digit', () => {
  assert.deepEqual(validateGstin(MH), { valid: true, gstin: MH, stateCode: '27' });
  assert.equal(validateGstin(MH.toLowerCase()).valid, true);
  assert.equal(validateGstin('27AAPFU0939F1ZX').valid, false);          // wrong check digit
  assert.equal(validateGstin('99AAPFU0939F1ZV').valid, false);          // no such state
  assert.equal(validateGstin('123').valid, false);
  assert.equal(validateGstin('').valid, false);
});
test('state names map to GST codes, including common spellings', () => {
  for (const [n, c] of [['Bihar', '10'], [' bihar ', '10'], ['Maharashtra', '27'], ['Jammu & Kashmir', '01'], ['Orissa', '21'], ['New Delhi', '07'], ['Tamil Nadu', '33'], ['West Bengal', '19']]) assert.equal(stateCodeFromName(n), c, n);
  assert.equal(stateCodeFromName('Atlantis'), null);
});
test('tax is carved out of GST-inclusive prices with no paisa lost', () => {
  assert.deepEqual(carveTax(11800, 18), { taxable: 10000, tax: 1800 });
  assert.deepEqual(carveTax(179900, 18), { taxable: 152458, tax: 27442 });
  const r = computeInvoiceTax({ lines: [{ description: 'A', quantity: 1, grossPaise: 100001 }, { description: 'B', quantity: 2, grossPaise: 33333 }], discountPaise: 12345, shippingPaise: 4900, ratePercent: 18, sellerStateCode: '27', buyerStateCode: '27' });
  assert.equal(r.totals.grossPaise, 100001 + 33333 - 12345 + 4900);
  assert.equal(r.totals.taxablePaise + r.totals.taxPaise, r.totals.grossPaise);
  assert.equal(r.totals.cgst + r.totals.sgst, r.totals.taxPaise); assert.equal(r.totals.igst, 0);
  assert.ok(r.lines.every((l) => Math.abs(l.cgst - l.sgst) <= 1));
  const inter = computeInvoiceTax({ lines: [{ description: 'A', quantity: 1, grossPaise: 11800 }], ratePercent: 18, sellerStateCode: '27', buyerStateCode: '10' });
  assert.equal(inter.intra, false); assert.equal(inter.totals.igst, 1800); assert.equal(inter.totals.cgst, 0);
});
test('refund tax follows the original split', () => {
  assert.deepEqual(refundTax({ amountPaise: 5900, ratePercent: 18, intra: true }), { taxablePaise: 5000, taxPaise: 900, cgst: 450, sgst: 450, igst: 0 });
  assert.equal(refundTax({ amountPaise: 5900, ratePercent: 18, intra: false }).igst, 900);
});

test('settings: GST needs a valid GSTIN, an allowed rate and a sane HSN; saved values reach invoices', async () => {
  const db = createFakeDb(); const base = { legalName: 'Printxyz', address: '12 Road, Patna' };
  await assert.rejects(updateBusiness({ db, body: { ...base, gstEnabled: true, gstin: '' }, actor }), /GSTIN/);
  await assert.rejects(updateBusiness({ db, body: { ...base, gstEnabled: true, gstin: '27AAPFU0939F1ZX' }, actor }), /check digit/);
  await assert.rejects(updateBusiness({ db, body: { ...base, gstEnabled: true, gstin: MH, gstRatePercent: 17 }, actor }), /rate/);
  await assert.rejects(updateBusiness({ db, body: { ...base, gstEnabled: true, gstin: MH, defaultHsn: 'abc' }, actor }), /HSN/);
  const saved = await updateBusiness({ db, body: { ...base, gstEnabled: true, gstin: MH.toLowerCase(), defaultHsn: '3926' }, actor });
  assert.equal(saved.gstin, MH); assert.equal(saved.gstRatePercent, 18);
  const biz = await getBusinessSettings(db, null);
  assert.deepEqual(biz.gst, { enabled: true, gstin: MH, stateCode: '27', ratePercent: 18, defaultHsn: '3926' });
  await updateBusiness({ db, body: { ...base, gstEnabled: false, gstin: MH }, actor });
  assert.equal((await getBusinessSettings(db, null)).gst.enabled, false);
});

const order = (state) => ({ _id: 'o1', id: 'PX-1', paymentStatus: 'paid', paidAt: new Date(), paymentReference: 'pay_1', customer: { name: 'Asha', email: 'a@x.com', phone: '9876543210', street: '1 Rd', city: 'X', state, pincode: '400001' },
  items: [{ productId: 'p1', title: 'Lamp', quantity: 2, unitPricePaise: 179900, lineTotalPaise: 359800 }], subtotalPaise: 359800, discountPaise: 0, shippingPaise: 0, totalPaise: 359800 });
const taxed = async (state) => {
  const db = createFakeDb(); await db.collection('products').insertOne({ id: 'p1', hsn: '3926' });
  await updateBusiness({ db, body: { legalName: 'Printxyz', address: 'Mumbai', gstEnabled: true, gstin: MH, defaultHsn: '9999' }, actor });
  const o = order(state); await db.collection('orders').insertOne(o);
  const settings = await getBusinessSettings(db, null);
  return { db, o, settings, inv: await issueInvoice({ db, order: o, settings }) };
};

test('tax invoice: same state gets CGST + SGST, other states get IGST; HSN comes from the product', async () => {
  const a = await taxed('Maharashtra');
  assert.equal(a.inv.gst.intra, true); assert.equal(a.inv.gst.placeOfSupply, 'Maharashtra'); assert.equal(a.inv.gst.lines[0].hsn, '3926');
  assert.equal(a.inv.gst.totals.cgst + a.inv.gst.totals.sgst, 54885); assert.equal(a.inv.gst.totals.igst, 0);
  const html = renderDocumentHtml(a.inv);
  assert.match(html, /Tax Invoice PX\//); assert.match(html, /GSTIN: 27AAPFU0939F1ZV/); assert.match(html, /CGST/); assert.match(html, /SGST/); assert.match(html, /HSN 3926/); assert.match(html, /src="\/logo\.jpeg"/);
  const b = await taxed('Bihar');
  assert.equal(b.inv.gst.intra, false); assert.equal(b.inv.gst.totals.igst, 54885); assert.match(renderDocumentHtml(b.inv), /IGST/);
  assert.equal(b.inv.totalPaise, 359800);                                   // what the customer paid never changes
});
test('credit note for a taxed invoice carries the GST inside the refund', async () => {
  const { db, o, settings } = await taxed('Bihar');
  await db.collection('orders').updateOne({ _id: 'o1' }, { $set: { invoiceNumber: 'PX/2026-27/0001' } });
  const cn = await issueCreditNote({ db, order: { ...o, invoiceNumber: 'PX/2026-27/0001' }, refund: { id: 'r1', amountPaise: 11800, reason: 'Return' }, settings });
  assert.equal(cn.gst.taxPaise, 1800); assert.equal(cn.gst.igst, 1800);
  assert.match(renderDocumentHtml(cn), /Includes GST of ₹18\.00/);
});
test('without GST enabled, invoices keep the plain layout (no tax wording)', async () => {
  const db = createFakeDb(); const o = order('Bihar'); await db.collection('orders').insertOne(o);
  const inv = await issueInvoice({ db, order: o, settings: await getBusinessSettings(db, null) });
  assert.equal(inv.gst, undefined); assert.ok(!/GSTIN|CGST|IGST|Tax Invoice/.test(renderDocumentHtml(inv)));
});
