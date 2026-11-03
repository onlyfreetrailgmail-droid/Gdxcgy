// One-time / idempotent setup. Run: npm run seed --workspace server
// Reads ADMIN_EMAIL + ADMIN_PASSWORD from the environment. Never takes a password from code.
import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { loadEnv, validateAdminPassword } from '../src/config/env.js';
import { connectDb, closeDb } from '../src/db/connect.js';
import { ensureIndexes } from '../src/db/indexes.js';
import { seedProducts } from '../src/content.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
dotenv.config();

const config = loadEnv();
const db = await connectDb(config.mongo);
await ensureIndexes(db);

if ((await db.collection('products').countDocuments({})) === 0) {
  await db.collection('products').insertMany(seedProducts.map((p) => ({ ...p, createdAt: new Date() })));
  console.log(`Seeded ${seedProducts.length} placeholder products (replace with real ones in the admin panel).`);
}

const coupons = [
  { code: 'PRINT10', type: 'percent', value: 10, minOrderPaise: 0, active: true, usedCount: 0 },
  { code: 'SAVE200', type: 'flat', value: 20000, minOrderPaise: 120000, active: true, usedCount: 0 },
  { code: 'FIRSTBUY', type: 'percent', value: 15, minOrderPaise: 150000, perUserLimit: 1, active: true, usedCount: 0 }
];
for (const c of coupons) await db.collection('coupons').updateOne({ code: c.code }, { $setOnInsert: { _id: crypto.randomUUID(), ...c } }, { upsert: true });

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (email) {
  const problems = validateAdminPassword(password);
  if (problems.length) { console.error(`ADMIN_PASSWORD is too weak. It needs: ${problems.join(', ')}.`); await closeDb(); process.exit(1); }
  const exists = await db.collection('users').findOne({ email });
  if (!exists) {
    const id = crypto.randomUUID();
    await db.collection('users').insertOne({ _id: id, id, name: 'Printxyz Owner', email, role: 'owner', passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, createdAt: new Date() });
    console.log(`Created owner account ${email}. Password change is required at first login.`);
  } else console.log('Owner account already exists; left unchanged.');
} else console.log('ADMIN_EMAIL not set; no admin account created.');

await closeDb();
