import { MongoClient } from 'mongodb';

let client = null;
let db = null;

export const connectDb = async ({ uri, dbName }) => {
  if (db) return db;
  if (!uri) throw new Error('MONGODB_URI is required');
  client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(dbName);
  return db;
};
export const getDb = () => { if (!db) throw new Error('Database not connected'); return db; };
export const pingDb = async () => { await getDb().command({ ping: 1 }); return true; };
export const closeDb = async () => { await client?.close(); client = null; db = null; };
