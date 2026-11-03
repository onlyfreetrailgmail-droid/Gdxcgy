// Advance (part) payments for custom and bulk orders. The plan is decided by the server from the stored order lines:
// the browser can only ask for "advance"; it never sends an amount.
export const DEFAULT_ADVANCE = Object.freeze({ advancePercent: 0, advanceMinTotalPaise: 200000, bulkMinQuantity: 10 });

export const isCustomLine = (l) => Array.isArray(l?.options?.photos) && l.options.photos.length > 0;

export const planAdvance = ({ lines = [], totalPaise, cfg = DEFAULT_ADVANCE }) => {
  const percent = Number(cfg.advancePercent) || 0;
  const custom = lines.some(isCustomLine);
  const bulk = lines.some((l) => l.quantity >= (cfg.bulkMinQuantity || 10));
  const eligible = percent > 0 && (custom || bulk) && totalPaise >= (cfg.advanceMinTotalPaise ?? 0);
  if (!eligible) return { eligible: false, percent, advancePaise: totalPaise, balancePaise: 0, reason: custom || bulk ? 'below_minimum' : 'not_custom_or_bulk' };
  const advancePaise = Math.min(Math.max(Math.round((totalPaise * percent) / 100), 100), totalPaise - 100);
  return { eligible: true, percent, advancePaise, balancePaise: totalPaise - advancePaise, kind: custom ? 'custom' : 'bulk' };
};

// What must be paid on the first Razorpay checkout for this order.
export const dueNowPaise = (order) => (order.paymentPlan === 'advance' ? order.advancePaise : order.totalPaise);
export const PAID_ENOUGH_TO_PRODUCE = ['paid', 'advance_paid'];
export const REFUNDABLE_STATUSES = ['paid', 'advance_paid', 'partially_refunded', 'refund_processing'];
// Money actually received for an order (full orders: the total).
export const receivedPaise = (order) => order.paidAmountPaise ?? order.totalPaise;
