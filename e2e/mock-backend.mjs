// Backend de PRUEBAS (solo desarrollo/E2E). Imita el subconjunto de la API de Supabase
// (Auth + PostgREST) que usa la app, ejecutando el SQL REAL de la migración en un
// PostgreSQL local con el esquema auth simulado (supabase/tests/00_stub_supabase.sql).
// No usar en producción.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

pg.types.setTypeParser(1700, (v) => Number(v)); // numeric → número (como PostgREST)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT ?? 54331);
const users = new Map(); // email -> { id, email, password, created_at }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtFor = (u) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const subOf = (req) => {
  const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub ?? null; } catch { return null; }
};
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('identificador inválido'); return `"${s}"`; };
const userObj = (u) => ({ id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', created_at: u.created_at, app_metadata: {}, user_metadata: {} });
const session = (u) => ({ access_token: jwtFor(u), refresh_token: crypto.randomUUID(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: userObj(u) });

async function withUser(sub, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

function parseFilters(params, values) {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|neq|in|is)\.(.*)$/.exec(v);
    if (!m) throw new Error(`filtro no soportado ${k}=${v}`);
    if (m[1] === 'in') {
      const list = m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      values.push(list); where.push(`${ident(k)}::text = any($${values.length})`);
    } else if (m[1] === 'is') where.push(`${ident(k)} is ${m[2] === 'null' ? 'null' : 'not null'}`);
    else { values.push(m[2]); where.push(`${ident(k)}::text ${m[1] === 'eq' ? '=' : '<>'} $${values.length}`); }
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}

const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const pgErr = (res, e) => send(res, e.code === '23505' ? 409 : 400, { message: e.message, code: e.code, details: e.detail ?? null, hint: e.hint ?? null });

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  try {
    // ---------------- Auth ----------------
    if (url.pathname === '/auth/v1/signup') {
      if (users.has(body.email)) return send(res, 422, { code: 'user_already_exists', msg: 'User already registered', message: 'User already registered' });
      const u = { id: crypto.randomUUID(), email: body.email, password: body.password, created_at: new Date().toISOString() };
      await pool.query('insert into auth.users(id, email) values ($1, $2)', [u.id, u.email]);
      users.set(u.email, u);
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/token') {
      const u = users.get(body.email);
      if (!u || u.password !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', message: 'Invalid login credentials', code: 'invalid_credentials' });
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const sub = subOf(req);
      const u = [...users.values()].find((x) => x.id === sub);
      return u ? send(res, 200, userObj(u)) : send(res, 401, { message: 'invalid token' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);

    // ---------------- PostgREST ----------------
    const sub = subOf(req);
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpc) {
      const args = Object.entries(body ?? {});
      const sql = `select to_jsonb(r) as j from ${ident(rpc[1])}(${args.map(([k], i) => `${ident(k)} => $${i + 1}`).join(', ')}) r`;
      const out = await withUser(sub, (c) => c.query(sql, args.map(([, v]) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))));
      const j = out.rows[0]?.j;
      return send(res, 200, j && typeof j === 'object' && !('id' in j) ? null : j);
    }
    const tbl = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (!tbl) return send(res, 404, { message: 'no encontrado' });
    const table = `public.${ident(tbl[1])}`;
    const values = [];
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    let sql;
    if (req.method === 'GET') {
      const order = url.searchParams.get('order');
      const orderSql = order ? ' order by ' + order.split(',').map((o) => { const [c, d] = o.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ') : '';
      sql = `select * from ${table}${parseFilters(url.searchParams, values)}${orderSql}`;
    } else if (req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const cols = Object.keys(rows[0]);
      const tuples = rows.map((r) => `(${cols.map((c) => { values.push(r[c]); return `$${values.length}`; }).join(', ')})`);
      sql = `insert into ${table} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')} returning *`;
    } else if (req.method === 'PATCH') {
      const sets = Object.entries(body).map(([k, v]) => { values.push(v); return `${ident(k)} = $${values.length}`; });
      sql = `update ${table} set ${sets.join(', ')}${parseFilters(url.searchParams, values)} returning *`;
    } else if (req.method === 'DELETE') {
      sql = `delete from ${table}${parseFilters(url.searchParams, values)} returning *`;
    } else return send(res, 405, { message: 'método no soportado' });
    const r = await withUser(sub, (c) => c.query(sql, values));
    const wantsRep = req.method === 'GET' || (req.headers.prefer ?? '').includes('return=representation');
    if (!wantsRep) return send(res, 204);
    if (single) return r.rows.length === 1 ? send(res, 200, r.rows[0]) : send(res, 406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' });
    return send(res, 200, r.rows);
  } catch (e) { return pgErr(res, e); }
}).listen(PORT, () => console.log(`mock-backend en http://localhost:${PORT}`));
