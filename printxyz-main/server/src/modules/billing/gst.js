// GST helpers. Prices shown to customers are GST-inclusive, so tax is carved out of the amount paid:
// taxable = amount / (1 + rate), tax = amount - taxable. All math is integer paise.
export const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};
const ALIASES = { 'j&k': '01', 'jammu & kashmir': '01', 'new delhi': '07', 'nct of delhi': '07', 'delhi ncr': '07', orissa: '21', uttaranchal: '05', pondicherry: '34',
  'dadra and nagar haveli': '26', 'daman and diu': '26', 'dadra & nagar haveli': '26', 'andaman & nicobar islands': '35', 'andaman and nicobar': '35', chattisgarh: '22' };
const clean = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const BY_NAME = Object.fromEntries(Object.entries(GST_STATES).map(([code, name]) => [clean(name), code]));
export const stateList = () => Object.values(GST_STATES);
export const stateCodeFromName = (name) => { const k = clean(name).replace(/\band\b/g, 'and'); return BY_NAME[k] || ALIASES[k] || BY_NAME[k.replace(/&/g, 'and')] || null; };

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const checkChar = (g) => { let sum = 0; for (let i = 0; i < 14; i++) { const p = CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); } return CHARS[(36 - (sum % 36)) % 36]; };
export const validateGstin = (value) => {
  const g = String(value || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { valid: false, reason: 'A GSTIN has 15 characters, for example 27AAPFU0939F1ZV.' };
  if (!GST_STATES[g.slice(0, 2)]) return { valid: false, reason: 'The first two digits are not a valid state code.' };
  if (checkChar(g) !== g[14]) return { valid: false, reason: 'This GSTIN fails its check digit. Re-check for a typing mistake.' };
  return { valid: true, gstin: g, stateCode: g.slice(0, 2) };
};

export const ALLOWED_RATES = [0, 5, 12, 18, 28];
const splitTax = (tax, intra) => (intra ? { cgst: Math.floor(tax / 2), sgst: tax - Math.floor(tax / 2), igst: 0 } : { cgst: 0, sgst: 0, igst: tax });
export const carveTax = (grossPaise, ratePercent) => { const taxable = ratePercent ? Math.round((grossPaise * 100) / (100 + ratePercent)) : grossPaise; return { taxable, tax: grossPaise - taxable }; };

// Spread an order-level discount over lines in proportion to their value, without losing a paisa.
const allocate = (amounts, total) => {
  const sum = amounts.reduce((s, a) => s + a, 0);
  if (!total || !sum) return amounts.map(() => 0);
  const raw = amounts.map((a) => (a * total) / sum); const base = raw.map(Math.floor);
  let left = total - base.reduce((s, a) => s + a, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i] += 1; left -= 1; } });
  return base;
};

// lines: [{ description, hsn, quantity, grossPaise }], plus order discount and shipping (both GST-inclusive).
export const computeInvoiceTax = ({ lines, discountPaise = 0, shippingPaise = 0, ratePercent, sellerStateCode, buyerStateCode }) => {
  const intra = Boolean(buyerStateCode) && buyerStateCode === sellerStateCode;
  const disc = allocate(lines.map((l) => l.grossPaise), discountPaise);
  const rows = lines.map((l, i) => ({ description: l.description, hsn: l.hsn || '', quantity: l.quantity, grossPaise: l.grossPaise - disc[i] }));
  if (shippingPaise > 0) rows.push({ description: 'Shipping and handling', hsn: '', quantity: 1, grossPaise: shippingPaise });
  const out = rows.map((r) => { const { taxable, tax } = carveTax(r.grossPaise, ratePercent); return { ...r, taxablePaise: taxable, taxPaise: tax, ...splitTax(tax, intra) }; });
  const sum = (k) => out.reduce((s, r) => s + r[k], 0);
  return { ratePercent, intra, lines: out, totals: { taxablePaise: sum('taxablePaise'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), taxPaise: sum('taxPaise'), grossPaise: sum('grossPaise') } };
};

// Tax contained in a refund, split the same way as the original invoice.
export const refundTax = ({ amountPaise, ratePercent, intra }) => { const { taxable, tax } = carveTax(amountPaise, ratePercent); return { taxablePaise: taxable, taxPaise: tax, ...splitTax(tax, intra) }; };
