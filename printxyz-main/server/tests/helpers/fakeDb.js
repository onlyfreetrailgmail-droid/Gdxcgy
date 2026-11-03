// Minimal in-memory stand-in for the MongoDB driver subset the services use.
// Supports equality, $gte, $ne, $in, $type:'string' filters; $set/$inc/$setOnInsert/$unset updates;
// and unique-key enforcement (error code 11000) for configured fields.
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const matchOne = (doc, cond) => {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, v]) => {
      if (op === '$gte') return doc >= v; if (op === '$lt') return doc < v; if (op === '$gt') return doc > v; if (op === '$lte') return doc <= v;
      if (op === '$ne') return doc !== v; if (op === '$in') return v.includes(doc);
      if (op === '$type') return v === 'string' ? typeof doc === 'string' : false;
      return false;
    });
  }
  return doc === cond;
};
const matches = (doc, filter = {}) => Object.entries(filter).every(([k, c]) => matchOne(get(doc, k), c));
const applyUpdate = (doc, update, inserting) => {
  for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v;
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
  for (const [k, v] of Object.entries(update.$push || {})) doc[k] = [...(doc[k] || []), v];
  for (const k of Object.keys(update.$unset || {})) delete doc[k];
  if (inserting) for (const [k, v] of Object.entries(update.$setOnInsert || {})) doc[k] = v;
};
const dup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
const clone = (d) => (d ? structuredClone(d) : d);

export const createFakeDb = ({ unique = {} } = {}) => {
  const stores = new Map();
  const col = (name) => {
    if (!stores.has(name)) stores.set(name, []);
    const rows = stores.get(name);
    const keys = unique[name] || [];
    const checkUnique = (doc, skip) => {
      for (const k of keys) if (doc[k] != null && rows.some((r) => r !== skip && r[k] === doc[k])) throw dup();
    };
    return {
      async insertOne(doc) { const d = clone(doc); if (d._id == null) d._id = `${name}_${rows.length + 1}`; if (rows.some((r) => r._id === d._id)) throw dup(); checkUnique(d); rows.push(d); return { insertedId: d._id }; },
      async findOne(f) { return clone(rows.find((r) => matches(r, f)) || null); },
      find(f) { let out = rows.filter((r) => matches(r, f)); const cur = { sort(s) { const [[k, dir]] = Object.entries(s); out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : -1) * dir); return cur; }, limit(n) { out = out.slice(0, n); return cur; }, async toArray() { return out.map(clone); } }; return cur; },
      async countDocuments(f) { return rows.filter((r) => matches(r, f)).length; },
      async updateOne(f, u, o = {}) {
        let r = rows.find((x) => matches(x, f));
        if (!r && o.upsert) { r = { _id: f._id ?? `${name}_${rows.length + 1}`, ...Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v !== 'object')) }; applyUpdate(r, u, true); checkUnique(r); rows.push(r); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
        if (!r) return { matchedCount: 0, modifiedCount: 0 };
        const next = clone(r); applyUpdate(next, u, false); checkUnique(next, r); for (const k of Object.keys(r)) if (!(k in next)) delete r[k]; Object.assign(r, next); return { matchedCount: 1, modifiedCount: 1 };
      },
      async findOneAndUpdate(f, u, o = {}) {
        let r = rows.find((x) => matches(x, f)); let inserting = false;
        if (!r && o.upsert) { r = { _id: f._id ?? `${name}_${rows.length + 1}` }; inserting = true; rows.push(r); }
        if (!r) return null;
        applyUpdate(r, u, inserting); return clone(r);
      },
      async deleteOne(f) { const i = rows.findIndex((r) => matches(r, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
      async deleteMany(f) { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], f)) { rows.splice(i, 1); n++; } return { deletedCount: n }; }
    };
  };
  return { collection: col };
};
