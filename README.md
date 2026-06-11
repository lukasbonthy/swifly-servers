# Swifly Server Registry (No Database)

This is a database-free Node.js website/API for Swifly server listings.

## How it works

- A host visits `/host`.
- They create a server entry.
- The website generates a signed token and a Server Kit ZIP.
- The host runs the included heartbeat script.
- The website stores active servers in memory.
- `GET /api/servers` returns only servers that are actively heartbeating.

Because there is no database, server listings are not permanently stored. That is intentional:
if Render restarts, the in-memory list clears, then running heartbeat scripts re-add servers automatically.

## Render setup

1. Create a new GitHub repo.
2. Extract this ZIP into that repo.
3. Push to GitHub.
4. In Render, create a new **Web Service** or **Blueprint** from the repo.
5. Build command:

```bash
npm install
```

6. Start command:

```bash
npm start
```

7. Environment variables:

```text
APP_SECRET=<long random secret>
ADMIN_API_KEY=<long random admin secret>
HEARTBEAT_TTL_SECONDS=180
ALLOW_PUBLIC_SUBMISSIONS=true
AUTO_VERIFY_PUBLIC_SUBMISSIONS=true
PUBLIC_BASE_URL=https://your-app.onrender.com
```

## Pages

- `/` home
- `/host` create a server + download a kit
- `/api/servers` public Swifly-only JSON list
- `/api/admin/servers` active server list, requires `x-admin-key`
- `/health` health check

## User flow

1. Host creates server at `/host`.
2. Host downloads `swifly-server-kit.zip`.
3. Host extracts it into their server folder.
4. Host runs `Start-Heartbeat.bat`.
5. Once heartbeating, the server appears in `/api/servers`.

## Important

This does not include BO3 game files or executables. Hosts still need to install BO3 / the unranked dedicated server legitimately.
