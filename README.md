# Swifly TDM Server Registry

Node.js-only Swifly server list website for Render.

This version is configured for:

- Source: `https://gameserve.rs/?game=t7`
- Game: T7 / Black Ops 3
- Mode: Multiplayer only
- Gametype: Team Deathmatch only
- Maps: base multiplayer maps only
- DLC maps: excluded

## Deploy on Render

1. Create a new GitHub repo.
2. Extract this ZIP into that repo.
3. Push it.
4. Render → New → Web Service.
5. Build command: `npm install`
6. Start command: `npm start`

Environment variables:

```text
APP_SECRET=<long random secret>
ADMIN_API_KEY=<long random admin secret>
PUBLIC_BASE_URL=https://your-app.onrender.com
GAMESERVERS_URL=https://gameserve.rs/?game=t7
REFRESH_INTERVAL_SECONDS=300
CACHE_TTL_SECONDS=600
HEARTBEAT_TTL_SECONDS=180
ALLOW_PUBLIC_SUBMISSIONS=true
```

## Endpoints

```text
GET  /
GET  /host
GET  /api/servers
GET  /api/status
POST /api/admin/refresh
POST /api/servers/:id/heartbeat
```

## Notes

The importer is intentionally strict. It only returns non-passworded Team Deathmatch servers on known base multiplayer maps.
If Gameserve.rs changes its HTML/API layout, check `/api/status` to see raw/accepted/rejected counts and the latest import error.

The `/host` page also creates Swifly Team Deathmatch server kits. Those kits are base-map TDM only.


## Import troubleshooting

This version tries the Gameserve HTML page first, then common API routes, then discovers API URLs from script bundles when possible.

If `/api/status` still shows `rawCount: 0`, open:

```text
/api/debug/import
```

with the `x-admin-key` header to see attempted URLs, discovered URLs, and notes.

You can also seed known servers without a database by adding `data/seed_servers.json` or setting `STATIC_TDM_SERVERS_JSON` to a JSON array of server objects. The same filters still apply: multiplayer, `tdm`, non-passworded, base-map only.
