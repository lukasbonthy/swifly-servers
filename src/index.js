const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 30);

const ROOT = path.resolve(__dirname, "..");
const BOIII_DIR = path.join(ROOT, "public", "boiii");

let cachedManifest = null;
let cachedAt = 0;

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }

  return out;
}

function sha1File(file) {
  const hash = crypto.createHash("sha1");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex").toUpperCase();
}

function buildManifest() {
  const files = walkFiles(BOIII_DIR)
    .sort((a, b) => normalizeSlashes(a).localeCompare(normalizeSlashes(b)));

  return files.map((file) => {
    const rel = normalizeSlashes(path.relative(BOIII_DIR, file));
    const size = fs.statSync(file).size;
    const sha1 = sha1File(file);
    return [rel, size, sha1];
  });
}

function getManifest() {
  const now = Date.now();
  if (cachedManifest && now - cachedAt < CACHE_SECONDS * 1000) {
    return cachedManifest;
  }

  cachedManifest = buildManifest();
  cachedAt = now;
  return cachedManifest;
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(cors());
app.use(morgan("tiny"));

app.get("/", (_req, res) => {
  const manifest = getManifest();
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Swifly BOIII Manifest</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; background: #0d0f16; color: #fff; }
    a { color: #8ab4ff; }
    code { background: #171b27; padding: 2px 6px; border-radius: 6px; }
    .card { background: #171b27; border: 1px solid #2a3144; border-radius: 14px; padding: 18px; margin: 18px 0; }
  </style>
</head>
<body>
  <h1>Swifly BOIII Manifest</h1>
  <div class="card">
    <p>Manifest entries: <strong>${manifest.length}</strong></p>
    <p>Manifest URL: <a href="/boiii.json"><code>/boiii.json</code></a></p>
    <p>File base URL: <code>/boiii/&lt;file path&gt;</code></p>
  </div>
  <div class="card">
    <p>Put your update files in <code>public/boiii</code>. The manifest is generated automatically.</p>
  </div>
</body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "swifly-manifest-site" });
});

app.get("/status", (_req, res) => {
  const manifest = getManifest();
  res.json({
    ok: true,
    fileCount: manifest.length,
    baseFolder: "public/boiii",
    manifest: "/boiii.json",
    fileBase: "/boiii/"
  });
});

app.get("/boiii.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(getManifest());
});

app.use("/boiii", express.static(BOIII_DIR, {
  fallthrough: false,
  dotfiles: "deny",
  etag: true,
  lastModified: true,
  maxAge: "5m"
}));

app.use((err, _req, res, _next) => {
  if (err && err.status === 404) {
    return res.status(404).json({ error: "not found" });
  }

  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, HOST, () => {
  console.log(`Swifly manifest site listening on ${HOST}:${PORT}`);
  console.log(`Serving update files from ${BOIII_DIR}`);
});
