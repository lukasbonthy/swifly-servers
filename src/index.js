const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const APP_SECRET = process.env.APP_SECRET || 'dev-secret-change-me';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GAMESERVERS_URL = process.env.GAMESERVERS_URL || 'https://gameserve.rs/?game=t7';
const REFRESH_INTERVAL_SECONDS = Number(process.env.REFRESH_INTERVAL_SECONDS || 300);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 600);
const HEARTBEAT_TTL_SECONDS = Number(process.env.HEARTBEAT_TTL_SECONDS || 180);
const ALLOW_PUBLIC_SUBMISSIONS = (process.env.ALLOW_PUBLIC_SUBMISSIONS || 'true') === 'true';

const BASE_MAP_DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'base_mp_maps.json'), 'utf8')
);
const BASE_MAP_NAMES = new Set();
const BASE_MAP_IDS = new Set();
for (const map of BASE_MAP_DATA.allowed) {
  BASE_MAP_IDS.add(normalize(map.id));
  BASE_MAP_NAMES.add(normalize(map.name));
}

const manualServers = new Map();
let gameserveCache = {
  updatedAt: null,
  sourceUrl: GAMESERVERS_URL,
  servers: [],
  rawCount: 0,
  acceptedCount: 0,
  rejectedCount: 0,
  lastError: null,
};

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\-\s]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function idSafe(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_.:\-[\]]/g, '')
    .slice(0, 128);
}

function sign(payload) {
  return crypto
    .createHmac('sha256', APP_SECRET)
    .update(payload)
    .digest('base64url');
}

function makeToken(serverId) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const payload = `${serverId}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(serverId, token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return parts[0] === serverId && sign(payload) === parts[2];
}

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) return res.status(500).json({ error: 'ADMIN_API_KEY is not configured' });
  if ((req.header('x-admin-key') || '') !== ADMIN_API_KEY) return res.status(401).json({ error: 'invalid admin key' });
  next();
}

function baseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function clientIp(req) {
  const forwarded = req.header('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : (req.socket.remoteAddress || '');
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return '';
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return '';
}

function extractAddressPort(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  const hostPort = raw.match(/^\[?([a-fA-F0-9:.]+)\]?:(\d{2,5})$/) || raw.match(/^([^:\s]+):(\d{2,5})$/);
  if (hostPort) return { address: idSafe(hostPort[1]), port: num(hostPort[2], 0) };
  return { address: idSafe(raw), port: 0 };
}

function looksLikeServerObject(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const hasName = firstValue(object, ['name', 'hostname', 'serverName', 'server_name']);
  const hasAddress = firstValue(object, ['address', 'ip', 'host', 'addr', 'endpoint', 'connectAddr', 'connect_addr']);
  const hasPort = firstValue(object, ['port', 'gamePort', 'game_port', 'queryPort', 'query_port']);
  const hasMap = firstValue(object, ['map', 'mapName', 'mapname', 'currentMap', 'current_map']);
  return !!(hasName && (hasAddress || hasPort || hasMap));
}

function collectServerObjects(value, output = []) {
  if (!value || output.length > 2000) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectServerObjects(item, output);
    return output;
  }
  if (typeof value !== 'object') return output;
  if (looksLikeServerObject(value)) output.push(value);
  for (const key of Object.keys(value)) collectServerObjects(value[key], output);
  return output;
}

function normalizeServer(object, source = 'gameserve.rs') {
  let address = String(firstValue(object, ['connectAddr', 'connect_addr', 'address', 'ip', 'host', 'addr', 'endpoint']) || '').trim();
  let port = num(firstValue(object, ['port', 'gamePort', 'game_port', 'queryPort', 'query_port']), 0);

  if (address.includes(':') && !port) {
    const parsed = extractAddressPort(address);
    address = parsed.address;
    port = parsed.port;
  }

  const name = String(firstValue(object, ['name', 'hostname', 'serverName', 'server_name']) || 'T7 Server').trim();
  const map = String(firstValue(object, ['map', 'mapName', 'mapname', 'currentMap', 'current_map']) || '').trim();
  const gametype = String(firstValue(object, ['gametype', 'gameType', 'game_type', 'mode', 'playlist', 'type']) || '').trim();
  const players = num(firstValue(object, ['players', 'numPlayers', 'num_players', 'clients', 'clientCount', 'playerCount']), 0);
  const maxPlayers = num(firstValue(object, ['maxPlayers', 'max_players', 'maxclients', 'maxClients', 'max_clients']), 18);
  const passwordedValue = firstValue(object, ['passworded', 'passwordProtected', 'password_protected', 'private']);
  const passworded =
    passwordedValue === true ||
    String(passwordedValue || '').toLowerCase() === 'true' ||
    String(passwordedValue || '') === '1';

  return {
    id: crypto.createHash('sha1').update(`${source}|${address}|${port}|${name}`).digest('hex').slice(0, 16),
    source,
    name,
    address: idSafe(address),
    port,
    connectAddr: port ? `${idSafe(address)}:${port}` : idSafe(address),
    mode: 'mp',
    map,
    gametype,
    region: String(firstValue(object, ['region', 'country', 'location']) || '').trim(),
    description: String(firstValue(object, ['description', 'desc', 'details']) || '').trim(),
    players,
    maxPlayers,
    passworded,
    lastHeartbeatAt: new Date().toISOString(),
  };
}

function isTeamDeathmatch(server) {
  const haystack = normalize(`${server.gametype} ${server.mode} ${server.name} ${server.description}`);
  return (
    /\btdm\b/.test(haystack) ||
    haystack.includes('team deathmatch') ||
    haystack.includes('teamdeathmatch')
  );
}

function isBaseMultiplayerMap(server) {
  const mapNorm = normalize(server.map);
  if (!mapNorm) return false;
  if (BASE_MAP_IDS.has(mapNorm.replace(/ /g, '_'))) return true;
  if (BASE_MAP_NAMES.has(mapNorm)) return true;

  // Gameserve entries sometimes contain the friendly map name in description/name instead.
  const text = normalize(`${server.map} ${server.name} ${server.description}`);
  for (const name of BASE_MAP_NAMES) {
    if (text.includes(name)) return true;
  }
  for (const id of BASE_MAP_IDS) {
    if (text.includes(id.replace(/_/g, ' '))) return true;
  }
  return false;
}

function isValidFilteredServer(server) {
  if (!server.address || !server.port) return false;
  if (server.passworded) return false;
  if (!isTeamDeathmatch(server)) return false;
  if (!isBaseMultiplayerMap(server)) return false;
  return true;
}

function parseJsonFromHtml(html) {
  const $ = cheerio.load(html);
  const candidates = [];

  const nextData = $('#__NEXT_DATA__').text();
  if (nextData) candidates.push(nextData);

  $('script').each((_, el) => {
    const text = $(el).text();
    if (!text || text.length < 20) return;
    // Try whole-script JSON first.
    candidates.push(text.trim());

    // Try common assignment forms: window.__DATA__ = {...};
    const assignment = text.match(/=\s*({[\s\S]*}|\[[\s\S]*\])\s*;?\s*$/);
    if (assignment) candidates.push(assignment[1]);

    // Try embedded arrays/objects near server-looking words.
    if (/server|hostname|map|gametype|players/i.test(text)) {
      const blocks = text.match(/(\{[\s\S]{50,}\}|\[[\s\S]{50,}\])/g) || [];
      for (const block of blocks.slice(0, 10)) candidates.push(block);
    }
  });

  const objects = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      collectServerObjects(parsed, objects);
    } catch {
      // Ignore non-JSON scripts.
    }
  }

  return objects;
}

function parseTableRowsFromHtml(html) {
  const $ = cheerio.load(html);
  const objects = [];

  $('table tbody tr, table tr, .server, [class*="server"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 8) return;

    const endpoint = text.match(/((?:\d{1,3}\.){3}\d{1,3}|\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9_.-]+\.[a-zA-Z]{2,})(?::|\s+)(\d{2,5})/);
    if (!endpoint) return;

    const map = (text.match(/\bmp[_a-z0-9-]+\b/i) || [])[0] || '';
    const gametype = /\btdm\b|team deathmatch/i.test(text) ? 'tdm' : '';

    objects.push({
      name: text.slice(0, 80),
      address: endpoint[1].replace(/^\[|\]$/g, ''),
      port: endpoint[2],
      map,
      gametype,
      players: 0,
      maxPlayers: 18,
    });
  });

  return objects;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/json',
        'user-agent': 'SwiflyServerRegistry/0.3 (+https://swifly-servers.onrender.com)'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshGameserveServers() {
  const urls = [
    GAMESERVERS_URL,
    'https://gameserve.rs/api/servers?game=t7',
    'https://gameserve.rs/api/servers/t7',
    'https://gameserve.rs/servers.json?game=t7'
  ];

  let lastError = null;
  const rawObjects = [];
  for (const url of urls) {
    try {
      const text = await fetchText(url);
      const contentTypeLooksJson = /^\s*[\[{]/.test(text);
      if (contentTypeLooksJson) {
        try {
          collectServerObjects(JSON.parse(text), rawObjects);
        } catch {}
      }
      rawObjects.push(...parseJsonFromHtml(text));
      rawObjects.push(...parseTableRowsFromHtml(text));
      if (rawObjects.length > 0) break;
    } catch (error) {
      lastError = `${url}: ${error.message}`;
    }
  }

  const seen = new Set();
  const accepted = [];
  const normalized = rawObjects.map((item) => normalizeServer(item, 'gameserve.rs'));

  for (const server of normalized) {
    const key = `${server.address}:${server.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isValidFilteredServer(server)) accepted.push(server);
  }

  gameserveCache = {
    updatedAt: new Date().toISOString(),
    sourceUrl: GAMESERVERS_URL,
    servers: accepted,
    rawCount: normalized.length,
    acceptedCount: accepted.length,
    rejectedCount: Math.max(0, normalized.length - accepted.length),
    lastError: accepted.length ? null : lastError,
  };

  return gameserveCache;
}

function visibleManualServers() {
  const now = Date.now();
  const visible = [];
  for (const server of manualServers.values()) {
    if (!server.verified || server.hidden) continue;
    if (!server.lastHeartbeatAt) continue;
    if (now - Date.parse(server.lastHeartbeatAt) > HEARTBEAT_TTL_SECONDS * 1000) continue;
    // Keep the same strict filters unless the host has explicitly chosen a base TDM setup.
    if (!isValidFilteredServer(server)) continue;
    visible.push(server);
  }
  return visible;
}

async function ensureFreshGameserveCache() {
  if (!gameserveCache.updatedAt) return refreshGameserveServers();
  const ageMs = Date.now() - Date.parse(gameserveCache.updatedAt);
  if (ageMs > CACHE_TTL_SECONDS * 1000) return refreshGameserveServers();
  return gameserveCache;
}

function htmlPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
  :root{color-scheme:dark}body{font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;background:#0b0d13;color:#fff;max-width:980px;margin:40px auto;padding:0 18px}a{color:#8ab4ff}h1{letter-spacing:-.04em}.card{background:#151927;border:1px solid #293044;border-radius:18px;padding:22px;margin:16px 0}.muted{color:rgba(255,255,255,.62)}input,select,textarea{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #333b51;background:#0f1420;color:#fff}label{display:block;margin:12px 0 6px}.btn,button{display:inline-block;background:#f47b20;color:#fff;border:0;border-radius:12px;padding:12px 16px;font-weight:800;text-decoration:none;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}code,pre{background:#06080d;border-radius:10px;padding:12px;overflow:auto}.pill{display:inline-block;border:1px solid #343b52;border-radius:999px;padding:4px 9px;margin:3px;color:#ddd}.server{border-bottom:1px solid #273046;padding:12px 0}.server:last-child{border-bottom:0}.ok{color:#22c55e}.bad{color:#ef4444}
  </style></head><body>${body}</body></html>`;
}

function serverCfg(server) {
  const safeName = String(server.name || 'Swifly TDM Server').replaceAll('"', "'");
  const safeMap = String(server.map || 'mp_sector').replace(/[^a-zA-Z0-9_]/g, '');
  return [
    '// Generated by Swifly Server Registry',
    'set sv_hostname "' + safeName + '"',
    'set live_steam_server_name "' + safeName + '"',
    'set sv_maxclients "' + Number(server.maxPlayers || 18) + '"',
    'set net_port "' + Number(server.port || 27017) + '"',
    'set g_password ""',
    'set gametype "tdm"',
    'set sv_maprotation "gametype tdm map ' + safeMap + '"',
    ''
  ].join('\r\n');
}

function heartbeatPs1(apiUrl, serverId, token, server) {
  return `$ErrorActionPreference = "Stop"\r\n\r\n$Api = "${apiUrl}"\r\n$ServerId = "${serverId}"\r\n$Token = "${token}"\r\n\r\nWrite-Host "Swifly heartbeat started for $ServerId"\r\nWrite-Host "Keep this window open while your Team Deathmatch server is running."\r\n\r\nwhile ($true) {\r\n  try {\r\n    $Body = @{\r\n      address = ""\r\n      port = ${Number(server.port || 27017)}\r\n      mode = "mp"\r\n      map = "${String(server.map || 'mp_sector')}"\r\n      gametype = "tdm"\r\n      players = 0\r\n      maxPlayers = ${Number(server.maxPlayers || 18)}\r\n      passworded = $false\r\n      version = "swifly-tdm-kit-0.3.0"\r\n    } | ConvertTo-Json\r\n\r\n    Invoke-RestMethod -Method Post -Uri "$Api/api/servers/$ServerId/heartbeat" -Headers @{ Authorization = "Bearer $Token" } -ContentType "application/json" -Body $Body | Out-Null\r\n    Write-Host "Heartbeat OK $(Get-Date)"\r\n  } catch {\r\n    Write-Warning "Heartbeat failed: $($_.Exception.Message)"\r\n  }\r\n\r\n  Start-Sleep -Seconds 30\r\n}\r\n`;
}

async function makeKit(req, serverId, token, server) {
  const zip = new JSZip();
  const apiUrl = baseUrl(req);
  zip.file('README_FIRST.txt', [
    'Swifly Team Deathmatch Server Kit',
    '',
    'This kit is base-map Team Deathmatch only. No DLC maps are included or selected.',
    '1. Put these files next to your Swifly/BO3 dedicated server executable.',
    '2. Edit server_mp.cfg only if you know what you are changing.',
    '3. Run START_SWIFLY_TDM_SERVER.bat.',
    '4. Keep the heartbeat window open so the server appears in Swifly.',
    '',
    'This kit does not include BO3 game files.'
  ].join('\r\n'));
  zip.file('swifly_server.json', JSON.stringify({ serverId, token, api: apiUrl, mode: 'mp', gametype: 'tdm', port: server.port, map: server.map }, null, 2));
  zip.file('server_mp.cfg', serverCfg(server));
  zip.file('heartbeat.ps1', heartbeatPs1(apiUrl, serverId, token, server));
  zip.file('START_SWIFLY_TDM_SERVER.bat', '@echo off\r\nsetlocal\r\nset GamePort=' + Number(server.port || 27017) + '\r\nset ServerFilename=server_mp.cfg\r\nstart "Swifly TDM Heartbeat" powershell -ExecutionPolicy Bypass -File "%~dp0heartbeat.ps1"\r\nif exist swiflyboiii.exe (\r\n  start "Swifly TDM Server" swiflyboiii.exe -dedicated +set net_port "%GamePort%" +set logfile 2 +exec %ServerFilename%\r\n) else if exist t7x.exe (\r\n  start "Swifly TDM Server" t7x.exe -dedicated +set net_port "%GamePort%" +set logfile 2 +exec %ServerFilename%\r\n) else (\r\n  echo Put this kit next to swiflyboiii.exe or t7x.exe, then run this file again.\r\n  pause\r\n)\r\n');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const app = express();
app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('tiny'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'swifly-gameservers-tdm', cache: gameserveCache }));

app.get('/', async (req, res) => {
  await ensureFreshGameserveCache().catch(() => {});
  const list = [...gameserveCache.servers, ...visibleManualServers()];
  const rows = list.map(s => `<div class="server"><b>${escapeHtml(s.name)}</b><br><span class="muted">${escapeHtml(s.connectAddr)} · ${escapeHtml(s.map)} · ${escapeHtml(s.gametype || 'tdm')} · ${s.players}/${s.maxPlayers}</span></div>`).join('') || '<p class="muted">No filtered TDM base-map servers are online right now.</p>';
  res.type('html').send(htmlPage('Swifly TDM Servers', `<h1>Swifly TDM Servers</h1><div class="card"><p>Live list filtered from Gameserve.rs for <b>Black Ops 3 / T7 multiplayer</b>, <b>Team Deathmatch only</b>, and <b>base maps only</b>. DLC maps are excluded.</p><p><a class="btn" href="/api/servers">View API</a> <a class="btn" href="/host">Add your TDM server</a></p></div><div class="card"><p class="muted">Last refresh: ${gameserveCache.updatedAt || 'never'} · Raw: ${gameserveCache.rawCount} · Accepted: ${gameserveCache.acceptedCount} · Rejected: ${gameserveCache.rejectedCount}</p>${rows}</div>`));
});

app.get('/host', (req, res) => {
  const mapOptions = BASE_MAP_DATA.allowed.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  res.type('html').send(htmlPage('Add Swifly TDM Server', `<h1>Add your Swifly TDM Server</h1><div class="card"><p class="muted">This form only creates a base-map Team Deathmatch kit. It will not create Zombies, Campaign, or DLC listings.</p><form method="post" action="/host"><label>Server name</label><input name="name" required minlength="3" maxlength="64" value="Swifly TDM Server"><label>Base map</label><select name="map">${mapOptions}</select><label>Region</label><input name="region" placeholder="NA / EU / AU"><label>Port</label><input name="port" type="number" min="1" max="65535" value="27017"><label>Max players</label><input name="maxPlayers" type="number" min="1" max="32" value="18"><button type="submit">Download TDM Server Kit</button></form></div>`));
});

app.post('/host', async (req, res, next) => {
  try {
    if (!ALLOW_PUBLIC_SUBMISSIONS) return res.status(403).send('Public submissions are disabled.');
    const serverId = crypto.randomUUID();
    const token = makeToken(serverId);
    const map = String(req.body.map || 'mp_sector');
    if (!BASE_MAP_IDS.has(normalize(map).replace(/ /g, '_'))) return res.status(400).send('Only base multiplayer maps are allowed.');
    const server = {
      id: serverId,
      source: 'manual',
      name: String(req.body.name || 'Swifly TDM Server').slice(0, 64),
      address: '',
      port: num(req.body.port, 27017),
      connectAddr: '',
      mode: 'mp',
      map,
      gametype: 'tdm',
      region: String(req.body.region || '').slice(0, 32),
      description: 'Manual Swifly Team Deathmatch server',
      players: 0,
      maxPlayers: Math.min(num(req.body.maxPlayers, 18), 32),
      passworded: false,
      verified: true,
      hidden: false,
      token,
      lastHeartbeatAt: null,
    };
    manualServers.set(serverId, server);
    const zip = await makeKit(req, serverId, token, server);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="swifly-tdm-server-${serverId}.zip"`);
    res.send(zip);
  } catch (error) {
    next(error);
  }
});

app.get('/api/servers', async (req, res, next) => {
  try {
    await ensureFreshGameserveCache();
    const list = [...gameserveCache.servers, ...visibleManualServers()];
    res.json(list.map(({ token, ...server }) => server));
  } catch (error) {
    next(error);
  }
});

app.get('/api/status', async (req, res) => {
  res.json({
    cache: gameserveCache,
    manualServerCount: manualServers.size,
    allowedMaps: BASE_MAP_DATA.allowed,
    filters: {
      game: 't7',
      mode: 'mp',
      gametype: 'tdm',
      dlc: 'excluded',
      source: GAMESERVERS_URL
    }
  });
});

app.post('/api/admin/refresh', requireAdmin, async (req, res, next) => {
  try {
    const result = await refreshGameserveServers();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/servers/:id/heartbeat', (req, res) => {
  const token = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  const server = manualServers.get(req.params.id);
  if (!server || !verifyToken(req.params.id, token)) return res.status(401).json({ error: 'invalid server or token' });

  const address = String(req.body.address || '').trim() || clientIp(req);
  server.address = idSafe(address);
  server.port = num(req.body.port, server.port);
  server.connectAddr = `${server.address}:${server.port}`;
  server.players = num(req.body.players, server.players);
  server.maxPlayers = num(req.body.maxPlayers, server.maxPlayers);
  server.map = String(req.body.map || server.map);
  server.gametype = 'tdm';
  server.mode = 'mp';
  server.passworded = false;
  server.lastHeartbeatAt = new Date().toISOString();
  manualServers.set(server.id, server);
  const { token: _, ...publicView } = server;
  res.json({ ok: true, server: publicView });
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'internal server error', message: error.message });
});

refreshGameserveServers().catch(error => {
  gameserveCache.lastError = error.message;
});

setInterval(() => {
  refreshGameserveServers().catch(error => {
    gameserveCache.lastError = error.message;
    gameserveCache.updatedAt = new Date().toISOString();
  });
}, Math.max(REFRESH_INTERVAL_SECONDS, 60) * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Swifly TDM registry listening on ${PORT}`);
});
