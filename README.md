# Swifly Server Registry — One-Click / No Database

This is the easiest test version of the Swifly server-list website.

## What the host does

1. Visit `/host`.
2. Fill out the tiny form.
3. Click **Download Server Kit**.
4. Extract the ZIP into their BO3/Swifly server folder.
5. Double-click `START_SWIFLY_SERVER.bat`.
6. Their server appears in `/api/servers` after the heartbeat succeeds.

## Render deploy

Create a new GitHub repo, upload these files, then create a Render Node.js Web Service.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Environment variables are optional for testing, but recommended:

```text
APP_SECRET=<long random string>
HEARTBEAT_TTL_SECONDS=180
PUBLIC_BASE_URL=https://your-app.onrender.com
```

## Public client endpoint

```text
GET /api/servers
```

The Swifly client should read this endpoint and show only these servers.

## No database behavior

This version stores only actively heartbeating servers in memory. If Render restarts or the service sleeps, the list clears, but any running `heartbeat.ps1` will automatically re-add the server on its next heartbeat.

## Important

This website does not include BO3 game files or executables. Hosts must use their own legally installed BO3/Unranked Dedicated Server files.
