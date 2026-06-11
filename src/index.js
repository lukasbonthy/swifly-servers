const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const JSZip = require('jszip');
const { Pool } = require('pg');
const { z } = require('zod');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const HEARTBEAT_TTL_SECONDS = Number(process.env.HEARTBEAT_TTL_SECONDS || 180);
const ALLOW_PUBLIC_SUBMISSIONS = String(process.env.ALLOW_PUBLIC_SUBMISSIONS || 'true') === 'true';
const AUTO_VERIFY_PUBLIC_SUBMISSIONS = String(process.env.AUTO_VERIFY_PUBLIC_SUBMISSIONS || 'true') === 'true';

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. The app needs PostgreSQL in production.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
      ? { rejectUnauthorized: false }
      : false,
});

const serverSchema = z.object({
  name: z.string().trim().min(3).max(64),
  mode: z.enum(['mp', 'zm', 'cp']).default('zm'),
  map: z.string().trim().min(1).max(64).default('zm_zod'),
  gametype: z.string().trim().max(64).default(''),
  region: z.string().trim().max(32).default(''),
  description: z.string().trim().max(256).default(''),
  address: z.string().trim().max(128).optional(),
  port: z.coerce.number().int().min(1).max(65535).default(27017),
  players: z.coerce.number().int().min(0).max(64).default(0),
  maxPlayers: z.coerce.number().int().min(1).max(64).default(8),
  passworded: z.union([z.boolean(), z.literal('on'), z.literal('true')]).optional().transform(v => v === true || v === 'on' || v === 'true').default(false),
  hidden: z.boolean().default(false),
  verified: z.boolean().default(true),
});

const publicSubmitSchema = serverSchema.omit({ verified: true, hidden: true, players: true, address: true }).extend({
  passworded: z.union([z.boolean(), z.literal('on'), z.literal('true')]).optional().transform(v => v === true || v === 'on' || v === 'true').default(false),
});

const heartbeatSchema = serverSchema.partial().extend({
  version: z.string().trim().max(64).optional(),
});

function makeId() {
  return crypto.randomUUID();
}

function makeToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function bearerToken(req) {
  const header = req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function clientIp(req) {
  const forwarded = req.header('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : (req.socket.remoteAddress || '');
}

function baseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(500).json({ error: 'ADMIN_API_KEY is not configured' });
  }
  if ((req.header('x-admin-key') || '') !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'invalid admin key' });
  }
  next();
}

async function migrate() {
  await pool.query(`
    create table if not exists servers (
      id text primary key,
      name text not null,
      mode text not null default 'zm',
      map text not null default 'zm_zod',
      gametype text not null default '',
      region text not null default '',
      description text not null default '',
      address text,
      port integer not null default 27017,
      players integer not null default 0,
      max_players integer not null default 8,
      passworded boolean not null default false,
      version text not null default '',
      token_hash text not null,
      verified boolean not null default true,
      hidden boolean not null default false,
      last_heartbeat_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create index if not exists servers_public_idx
    on servers (verified, hidden, last_heartbeat_at desc);
  `);
}

function publicServer(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    port: row.port,
    mode: row.mode,
    map: row.map,
    gametype: row.gametype,
    region: row.region,
    description: row.description,
    players: row.players,
    maxPlayers: row.max_players,
    passworded: row.passworded,
    version: row.version,
    lastHeartbeatAt: row.last_heartbeat_at,
  };
}

function page(title, body) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0d0f16;--card:#171b27;--line:#2a3144;--text:#fff;--muted:#b3bed6;--orange:#f47b20;--blue:#8ab4ff}
*{box-sizing:border-box}body{font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;background:radial-gradient(circle at top,#182033,#0d0f16 55%);color:var(--text);max-width:980px;margin:40px auto;padding:0 20px}a{color:var(--blue)}.card{background:rgba(23,27,39,.94);border:1px solid var(--line);border-radius:18px;padding:24px;margin:18px 0;box-shadow:0 20px 80px rgba(0,0,0,.25)}.muted{color:var(--muted)}label{display:block;margin:14px 0 6px;color:var(--muted)}input,select,textarea{width:100%;padding:12px;border-radius:12px;border:1px solid #394157;background:#111722;color:#fff}button,.btn{display:inline-block;margin-top:18px;padding:12px 18px;border:0;border-radius:12px;background:var(--orange);color:#fff;font-weight:800;text-decoration:none;cursor:pointer}.btn.secondary{background:#273149}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}code,pre{background:#0b0d13;border:1px solid #202738;border-radius:10px;padding:12px;display:block;overflow:auto}.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:#273149;color:#d8e2ff;font-size:12px}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function serverCfg(server, mode) {
  const name = String(server.name || 'Swifly Server').replaceAll('"', "'");
  const map = String(server.map || 'zm_zod').replace(/[^a-zA-Z0-9_]/g, '');
  const maxPlayers = Number(server.max_players || server.maxPlayers || 8);
  const port = Number(server.port || 27017);
  return [
    '// Generated by Swifly Server Registry',
    `set sv_hostname "${name}"`,
    `set live_steam_server_name "${name}"`,
    `set sv_maxclients "${maxPlayers}"`,
    `set net_port "${port}"`,
    'set g_password ""',
    `set sv_maprotation "map ${map}"`,
    '',
  ].join('\r\n');
}

function heartbeatScript(apiUrl, serverId, token, server) {
  const safeApi = apiUrl.replaceAll('`', '');
  const safeId = String(serverId).replaceAll('`', '');
  const safeToken = String(token).replaceAll('`', '');
  const mode = String(server.mode || 'zm').replaceAll('`', '');
  const map = String(server.map || 'zm_zod').replaceAll('`', '');
  const port = Number(server.port || 27017);
  const maxPlayers = Number(server.max_players || server.maxPlayers || 8);

  return `$ErrorActionPreference = "Stop"\r\n\r\n$Api = "${safeApi}"\r\n$ServerId = "${safeId}"\r\n$Token = "${safeToken}"\r\n\r\nWrite-Host "Swifly heartbeat started for $ServerId"\r\nWrite-Host "Keep this window open while your BO3 server is running."\r\n\r\nwhile ($true) {\r\n  try {\r\n    $Body = @{\r\n      port = ${port}\r\n      mode = "${mode}"\r\n      map = "${map}"\r\n      players = 0\r\n      maxPlayers = ${maxPlayers}\r\n      version = "swifly-server-kit-0.2.0"\r\n    } | ConvertTo-Json\r\n\r\n    Invoke-RestMethod -Method Post -Uri "$Api/api/servers/$ServerId/heartbeat" -Headers @{ Authorization = "Bearer $Token" } -ContentType "application/json" -Body $Body | Out-Null\r\n    Write-Host "Heartbeat OK $(Get-Date)"\r\n  } catch {\r\n    Write-Warning "Heartbeat failed: $($_.Exception.Message)"\r\n  }\r\n\r\n  Start-Sleep -Seconds 30\r\n}\r\n`;
}

function startServerBat(server, mode) {
  const cfg = mode === 'mp' ? 'server_mp.cfg' : 'server_zm.cfg';
  const port = Number(server.port || 27017);
  const title = mode === 'mp' ? 'Swifly MP Server' : 'Swifly Zombies Server';
  return `@echo off\r\nsetlocal\r\nset GamePort=${port}\r\nset ServerFilename=${cfg}\r\n\r\nif not exist swiflyboiii.exe (\r\n  echo Put this kit in the same folder as swiflyboiii.exe and the BO3 server files.\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\nstart "${title}" swiflyboiii.exe -dedicated +set net_port "%GamePort%" +set logfile 2 +exec %ServerFilename%\r\nstart "Swifly Heartbeat" powershell -ExecutionPolicy Bypass -File "%~dp0heartbeat.ps1"\r\n`;
}

async function makeServerKitZip(req, row, token) {
  const apiUrl = baseUrl(req);
  const zip = new JSZip();
  zip.file('README.txt', [
    'Swifly Server Kit',
    '',
    'This package does not include BO3 game files or executables.',
    'Use it only with BO3 server files you are authorized to run.',
    '',
    'Quick start:',
    '1. Extract this ZIP into the folder with swiflyboiii.exe and the BO3 server files.',
    '2. Review server_zm.cfg or server_mp.cfg.',
    '3. Port-forward the configured UDP port if hosting from home.',
    '4. Run Start-Swifly-Zombies.bat or Start-Swifly-MP.bat.',
    '5. Keep the heartbeat window open so your server appears in Swifly.',
    '',
    'Public server list API:',
    `${apiUrl}/api/servers`,
    '',
  ].join('\r\n'));

  zip.file('swifly_server.json', JSON.stringify({
    serverId: row.id,
    token,
    api: apiUrl,
    mode: row.mode,
    map: row.map,
    port: row.port,
  }, null, 2));

  zip.file('heartbeat.ps1', heartbeatScript(apiUrl, row.id, token, row));
  zip.file('Start-Heartbeat.bat', '@echo off\r\npowershell -ExecutionPolicy Bypass -File "%~dp0heartbeat.ps1"\r\npause\r\n');
  zip.file('Start-Swifly-Zombies.bat', startServerBat(row, 'zm'));
  zip.file('Start-Swifly-MP.bat', startServerBat(row, 'mp'));
  zip.file('server_zm.cfg', serverCfg(row, 'zm'));
  zip.file('server_mp.cfg', serverCfg(row, 'mp'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function createServerRecord(payload) {
  const id = makeId();
  const token = makeToken();
  const result = await pool.query(`
    insert into servers (id, name, mode, map, gametype, region, description, address, port, players, max_players, passworded, token_hash, verified, hidden)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    returning *
  `, [id, payload.name, payload.mode, payload.map, payload.gametype, payload.region, payload.description, payload.address || null, payload.port, payload.players || 0, payload.maxPlayers, payload.passworded, hashToken(token), payload.verified, payload.hidden]);
  return { row: result.rows[0], token };
}

async function serverFromToken(id, token) {
  const result = await pool.query('select * from servers where id = $1', [id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return hashToken(token) === row.token_hash ? row : null;
}

const app = express();
app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('tiny'));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'swifly-server-registry' });
});

app.get('/', (_req, res) => {
  res.type('html').send(page('Swifly Server Registry', `
    <h1>Swifly Server Registry</h1>
    <p class="muted">Self-service listings for Swifly-approved BO3/T7 servers.</p>
    <div class="card">
      <div class="grid">
        <div><h2>Create a server</h2><p class="muted">Generate a tokenized Server Kit and heartbeat script.</p><a class="btn" href="/host">Start hosting</a></div>
        <div><h2>Public API</h2><p class="muted">This is what the Swifly client should read.</p><a class="btn secondary" href="/api/servers">View /api/servers</a></div>
      </div>
    </div>
  `));
});

app.get('/host', (_req, res) => {
  res.type('html').send(page('Create Swifly Server', `
    <h1>Create a Swifly Server</h1>
    <p class="muted">Fill this out, download the Server Kit, and run the heartbeat while your server is online.</p>
    <div class="card">
      <form method="post" action="/host">
        <label>Server name</label>
        <input name="name" placeholder="Swifly Zombies #1" required minlength="3" maxlength="64">
        <label>Mode</label>
        <select name="mode"><option value="zm">Zombies</option><option value="mp">Multiplayer</option><option value="cp">Campaign</option></select>
        <label>Map</label>
        <input name="map" value="zm_zod" required>
        <label>Region</label>
        <input name="region" placeholder="NA / EU / AU">
        <label>Port</label>
        <input name="port" type="number" min="1" max="65535" value="27017">
        <label>Max players</label>
        <input name="maxPlayers" type="number" min="1" max="64" value="8">
        <label>Description</label>
        <textarea name="description" maxlength="256" rows="4" placeholder="Short server description"></textarea>
        <label><input style="width:auto" type="checkbox" name="passworded"> Passworded</label>
        <button type="submit">Create Server + Download Kit</button>
      </form>
    </div>
  `));
});

app.post('/host', async (req, res, next) => {
  try {
    if (!ALLOW_PUBLIC_SUBMISSIONS) {
      return res.status(403).send('Public submissions are disabled.');
    }
    const payload = publicSubmitSchema.parse(req.body || {});
    const { row, token } = await createServerRecord({
      ...payload,
      players: 0,
      verified: AUTO_VERIFY_PUBLIC_SUBMISSIONS,
      hidden: false,
    });
    const kitUrl = `/api/servers/${row.id}/kit.zip?token=${encodeURIComponent(token)}`;
    res.type('html').send(page('Server Created', `
      <h1>Server created</h1>
      <div class="card">
        <p><span class="pill">${escapeHtml(row.mode.toUpperCase())}</span></p>
        <h2>${escapeHtml(row.name)}</h2>
        <p class="muted">Download this kit now. Keep the link/token private.</p>
        <p><a class="btn" href="${escapeHtml(kitUrl)}">Download Swifly Server Kit</a></p>
        <p>Server ID:</p><pre>${escapeHtml(row.id)}</pre>
        <p>Client API URL:</p><pre>${escapeHtml(baseUrl(req))}/api/servers</pre>
      </div>
      <p><a href="/host">Create another server</a></p>
    `));
  } catch (error) {
    next(error);
  }
});

app.get('/api/servers', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      select * from servers
      where verified = true
        and hidden = false
        and address is not null
        and last_heartbeat_at > now() - ($1::int * interval '1 second')
      order by players desc, last_heartbeat_at desc, name asc
    `, [HEARTBEAT_TTL_SECONDS]);
    res.json(result.rows.map(publicServer));
  } catch (error) {
    next(error);
  }
});

app.get('/api/servers.json', async (req, res, next) => {
  req.url = '/api/servers';
  next();
});

app.get('/api/servers/:id/kit.zip', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const row = await serverFromToken(req.params.id, token);
    if (!row) return res.status(404).json({ error: 'server not found or invalid token' });

    const zip = await makeServerKitZip(req, row, token);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="swifly-server-${row.id}.zip"`);
    res.send(zip);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/servers', requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query('select * from servers order by created_at desc');
    res.json(result.rows.map((row) => ({ ...publicServer(row), verified: row.verified, hidden: row.hidden, createdAt: row.created_at })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/servers', requireAdmin, async (req, res, next) => {
  try {
    const payload = serverSchema.parse(req.body || {});
    const { row, token } = await createServerRecord(payload);
    res.status(201).json({
      server: publicServer(row),
      token,
      kitUrl: `${baseUrl(req)}/api/servers/${row.id}/kit.zip?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/servers/:id/heartbeat', async (req, res, next) => {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'missing bearer token' });

    const result = await pool.query('select * from servers where id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'server not found' });

    const row = result.rows[0];
    if (hashToken(token) !== row.token_hash) return res.status(401).json({ error: 'invalid token' });

    const body = heartbeatSchema.parse(req.body || {});
    const address = body.address || clientIp(req);
    const updated = await pool.query(`
      update servers set
        name = coalesce($1, name),
        mode = coalesce($2, mode),
        map = coalesce($3, map),
        gametype = coalesce($4, gametype),
        region = coalesce($5, region),
        description = coalesce($6, description),
        address = coalesce($7, address),
        port = coalesce($8, port),
        players = coalesce($9, players),
        max_players = coalesce($10, max_players),
        passworded = coalesce($11, passworded),
        version = coalesce($12, version),
        last_heartbeat_at = now(),
        updated_at = now()
      where id = $13
      returning *
    `, [body.name, body.mode, body.map, body.gametype, body.region, body.description, address, body.port, body.players, body.maxPlayers, body.passworded, body.version, row.id]);

    res.json({ ok: true, server: publicServer(updated.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/servers/:id', requireAdmin, async (req, res, next) => {
  try {
    const verified = typeof req.body.verified === 'boolean' ? req.body.verified : null;
    const hidden = typeof req.body.hidden === 'boolean' ? req.body.hidden : null;
    const result = await pool.query(`
      update servers set
        verified = coalesce($1, verified),
        hidden = coalesce($2, hidden),
        updated_at = now()
      where id = $3
      returning *
    `, [verified, hidden, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'server not found' });
    res.json({ server: publicServer(result.rows[0]), verified: result.rows[0].verified, hidden: result.rows[0].hidden });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/servers/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('delete from servers where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'validation failed', details: error.errors });
  }
  console.error(error);
  res.status(500).json({ error: 'internal server error' });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Swifly registry listening on ${PORT}`)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
