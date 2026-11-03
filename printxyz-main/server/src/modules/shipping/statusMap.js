// Courier wording -> our shipping status. Returns null when the event is not a shipping-progress change.
const T = (v) => String(v || '').toUpperCase();

export const mapShiprocketStatus = (raw) => {
  const t = T(raw);
  if (!t) return null;
  if (t.includes('RTO')) return t.includes('DELIVERED') ? 'returned' : 'delivery-failed';
  if (t.includes('UNDELIVERED') || t.includes('DELIVERY FAILED')) return 'delivery-failed';
  if (t.includes('OUT FOR DELIVERY')) return 'out-for-delivery';
  if (t.includes('DELIVERED')) return 'delivered';
  if (t.includes('IN TRANSIT') || t.includes('REACHED AT DESTINATION')) return 'in-transit';
  if (t.includes('PICKED UP') || t === 'SHIPPED') return 'shipped';
  return null;   // NEW, AWB ASSIGNED, PICKUP SCHEDULED, CANCELED, etc.
};

// Delhivery status is { Status, StatusType }: UD undelivered/in network, DL delivered, RT return, PP/PU pickup.
export const mapDelhiveryStatus = ({ status, statusType } = {}) => {
  const s = T(status); const type = T(statusType);
  if (type === 'RT' || s.startsWith('RTO')) return s.includes('DELIVERED') ? 'returned' : 'delivery-failed';
  if (type === 'DL' || s === 'DELIVERED') return 'delivered';
  if (s.includes('OUT FOR DELIVERY') || s === 'DISPATCHED') return 'out-for-delivery';
  if (s.includes('IN TRANSIT') || s === 'PENDING') return 'in-transit';
  if (s.includes('PICKED UP') || s === 'PICKED') return 'shipped';
  return null;   // Manifested, Not Picked, etc.
};

// Couriers are the source of truth, so a forward jump is allowed (pickup scan missed), but never backwards or out of a final state.
const FORWARD = {
  pending: ['shipped', 'in-transit', 'out-for-delivery', 'delivered', 'delivery-failed', 'returned'],
  shipped: ['in-transit', 'out-for-delivery', 'delivered', 'delivery-failed', 'returned'],
  'in-transit': ['out-for-delivery', 'delivered', 'delivery-failed', 'returned'],
  'out-for-delivery': ['delivered', 'delivery-failed'],
  'delivery-failed': ['out-for-delivery', 'delivered', 'returned'],
  delivered: [], returned: []
};
export const canCourierMove = (from, to) => (FORWARD[from] || []).includes(to);
