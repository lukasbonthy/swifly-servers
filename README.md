# Swifly Server Registry Website

A standalone website/API that lets people register their own Swifly BO3/T7 servers, download a tokenized Server Kit, run a heartbeat script, and appear in a Swifly-only server list.

This should live in a **separate GitHub repo** from the Swifly client.

## What it does

- Provides a public `/host` form for creating a server entry.
- Generates a private token for each server.
- Generates a downloadable Server Kit ZIP containing:
  - `swifly_server.json`
  - `heartbeat.ps1`
  - `Start-Heartbeat.bat`
  - `Start-Swifly-Zombies.bat`
  - `Start-Swifly-MP.bat`
  - `server_zm.cfg`
  - `server_mp.cfg`
- Exposes `GET /api/servers` for the Swifly client.
- Hides servers unless they heartbeat recently.
- Stores state in PostgreSQL.

## What it does NOT do

It does **not** include BO3 game files, BO3 executable files, or any proprietary game content. Hosts must use BO3 server files they are authorized to run.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

You need a PostgreSQL database and a valid `DATABASE_URL`.

## Deploy to Render

This project includes `render.yaml`.

1. Create a new, separate GitHub repo.
2. Upload/extract this project into that repo.
3. In Render, choose **New → Blueprint**.
4. Connect the repo.
5. Render will create:
   - a Node web service
   - a PostgreSQL database
   - generated `ADMIN_API_KEY`
6. Open the app URL and visit `/host`.

Render Blueprints are configured with a `render.yaml` file in the repository root.

## Environment variables

```text
DATABASE_URL=<Postgres URL>
ADMIN_API_KEY=<long random admin secret>
PUBLIC_BASE_URL=https://your-render-app.onrender.com
HEARTBEAT_TTL_SECONDS=180
ALLOW_PUBLIC_SUBMISSIONS=true
AUTO_VERIFY_PUBLIC_SUBMISSIONS=true
PORT=3000
```

## Public flow

1. Go to `/host`.
2. Fill out server name/mode/map/port.
3. Download the generated Server Kit.
4. Extract it next to the server executable/configs.
5. Run `Start-Heartbeat.bat` or `heartbeat.ps1`.
6. The server appears in `GET /api/servers` after heartbeat succeeds.

## Admin API

List all servers:

```bash
curl https://YOUR-APP.onrender.com/api/admin/servers \
  -H "x-admin-key: YOUR_ADMIN_API_KEY"
```

Hide/unhide or verify/unverify:

```bash
curl -X PATCH https://YOUR-APP.onrender.com/api/admin/servers/SERVER_ID \
  -H "content-type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_API_KEY" \
  -d '{"verified":true,"hidden":false}'
```

Delete:

```bash
curl -X DELETE https://YOUR-APP.onrender.com/api/admin/servers/SERVER_ID \
  -H "x-admin-key: YOUR_ADMIN_API_KEY"
```

## Client integration target

The Swifly client/server browser should call:

```text
GET https://YOUR-APP.onrender.com/api/servers
```

and render only those entries.
