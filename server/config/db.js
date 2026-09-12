import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabaseUrl = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

const toJsonParam = (value) => {
  if (value === undefined || value === null) return null;
  if (Buffer.isBuffer(value)) return { __bytea: value.toString('base64') };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonParam);
  return value;
};

const postgresError = (payload, status) => {
  const error = new Error(payload?.message || payload?.error_description || `Database request failed (${status}).`);
  error.code = payload?.code || String(status);
  error.status = status >= 500 ? 502 : status;
  return error;
};

const callAppQuery = async (query_text, query_params = []) => {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');

  const response = await fetch(`${url}/rest/v1/rpc/app_query`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      query_text,
      query_params: query_params.map(toJsonParam),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404 || payload?.code === 'PGRST202' || payload?.code === 'PGRST203') {
      throw new Error('Run server/sql/app_query_rpc.sql once in the Supabase SQL Editor, then restart the API.');
    }
    throw postgresError(payload, response.status);
  }

  const body = Array.isArray(payload) ? payload[0] : payload;
  let rows = body?.result_rows ?? body?.rows;
  if (typeof body?.result_json === 'string') {
    try { rows = JSON.parse(body.result_json); } catch { rows = []; }
  }
  if (!body || typeof body !== 'object' || !Array.isArray(rows)) {
    throw new Error('Database RPC returned an unexpected result.');
  }
  const rowCount = Number(body.result_count ?? body.rowCount);
  return { rows, rowCount: Number.isFinite(rowCount) ? rowCount : rows.length };
};

const isTxnControl = (text) => /^(begin|commit|rollback)\b/i.test(String(text || '').trim());

const query = async (text, params) => {
  if (isTxnControl(text)) return { rows: [], rowCount: 0 };
  return callAppQuery(text, Array.isArray(params) ? params : []);
};

const connect = async () => ({
  query,
  release() {},
});

const pool = {
  query,
  connect,
  async end() {},
  on() {},
};

export default pool;
