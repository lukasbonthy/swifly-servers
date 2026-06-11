# Swifly BOIII Manifest Site

This is a simple Node.js/Express site that generates a BOIII-style update manifest.

## Manifest format

`GET /boiii.json` returns:

```json
[
  ["file/path.ext", 12345, "SHA1HASH"]
]
```

That matches the upstream manifest shape you provided.

## Where to put files

Put your update files inside:

```text
public/boiii
```

Example:

```text
public/boiii/swiflyboiii.exe
public/boiii/ext.dll
public/boiii/data/launcher/main.html
public/boiii/data/ui_scripts/server_browser/__init__.lua
```

The site serves files from:

```text
https://YOUR_SITE/boiii/<file path>
```

and generates the manifest at:

```text
https://YOUR_SITE/boiii.json
```

## Render deploy

Build command:

```text
npm install
```

Start command:

```text
npm start
```

## Important

Do not upload files you do not have the rights to distribute.
