const day = (d) => new Date(d).toISOString().slice(0, 10);

export const salesReport = async ({ db, from, to }) => {
  const orders = (await db.collection('orders').find({ paymentStatus: { $in: ['paid', 'advance_paid', 'partially_refunded', 'refunded', 'refund_processing'] } }).toArray())
    .filter((o) => o.paidAt && new Date(o.paidAt) >= from && new Date(o.paidAt) <= to);
  const byDay = new Map(); const products = new Map(); const coupons = new Map();
  let revenue = 0; let refunded = 0;
  for (const o of orders) {
    const got = o.paidAmountPaise ?? o.totalPaise; revenue += got; refunded += o.refundedPaise || 0;
    const k = day(o.paidAt); const d = byDay.get(k) || { date: k, orders: 0, revenuePaise: 0 }; d.orders++; d.revenuePaise += got; byDay.set(k, d);
    for (const l of o.items) { const p = products.get(l.productId) || { productId: l.productId, title: l.title, units: 0, revenuePaise: 0 }; p.units += l.quantity; p.revenuePaise += l.lineTotalPaise; products.set(l.productId, p); }
    if (o.couponCode) coupons.set(o.couponCode, (coupons.get(o.couponCode) || 0) + 1);
  }
  const attributed = new Map();
  for (const o of orders) { const src = o.utm?.source || 'direct'; attributed.set(src, (attributed.get(src) || 0) + 1); }
  return {
    orders: orders.length, revenuePaise: revenue, refundedPaise: refunded, netPaise: revenue - refunded, averageOrderPaise: orders.length ? Math.round(revenue / orders.length) : 0,
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topProducts: [...products.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 10),
    couponUse: [...coupons].map(([code, orders]) => ({ code, orders })), bySource: [...attributed].map(([source, orders]) => ({ source, orders })),
    refundsNeedingAttention: await db.collection('orders').countDocuments({ refundNeeded: true })
  };
};

// Spreadsheet apps run text that starts with = + - @ as a formula. Prefix those cells so exports cannot execute anything.
export const csvCell = (v) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const ordersCsv = async ({ db, status, from, to }) => {
  const rows = (await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray())
    .filter((o) => (!status || o.status === status) && (!from || o.createdAt >= from) && (!to || o.createdAt <= to));
  const head = ['Order', 'Date', 'Customer', 'Email', 'Phone', 'City', 'State', 'Pincode', 'Items', 'Subtotal', 'Discount', 'Shipping', 'Total', 'Refunded', 'Payment', 'Production', 'Shipping status', 'Courier', 'AWB', 'Invoice'];
  const lines = rows.map((o) => [o.id, o.createdAt, o.customer?.name, o.customer?.email, o.customer?.phone, o.customer?.city, o.customer?.state, o.customer?.pincode,
    o.items.map((l) => `${l.title} x${l.quantity}`).join('; '), o.subtotalPaise / 100, o.discountPaise / 100, o.shippingPaise / 100, o.totalPaise / 100, (o.refundedPaise || 0) / 100,
    o.paymentStatus, o.productionStatus, o.shippingStatus, o.courierName, o.trackingNumber, o.invoiceNumber].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n');
};

export const customersReport = async ({ db }) => {
  const map = new Map();
  for (const o of await db.collection('orders').find({}).toArray()) {
    if (!o.customerEmail) continue;
    const c = map.get(o.customerEmail) || { email: o.customerEmail, name: o.customer?.name || '', orders: 0, paidOrders: 0, lifetimeValuePaise: 0, lastOrderAt: null };
    c.orders++; if (['paid', 'advance_paid', 'partially_refunded'].includes(o.paymentStatus)) { c.paidOrders++; c.lifetimeValuePaise += (o.paidAmountPaise ?? o.totalPaise) - (o.refundedPaise || 0); }
    if (!c.lastOrderAt || o.createdAt > c.lastOrderAt) c.lastOrderAt = o.createdAt; map.set(o.customerEmail, c);
  }
  return [...map.values()].sort((a, b) => b.lifetimeValuePaise - a.lifetimeValuePaise);
};

export const lowStock = async ({ db, threshold = 5 }) =>
  (await db.collection('products').find({}).toArray()).filter((p) => Number.isFinite(p.stock) && p.stock <= threshold)
    .map((p) => ({ id: p.id, title: p.title, stock: p.stock })).sort((a, b) => a.stock - b.stock);
