$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom($Path, $Content) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($fullPath, $Content, $utf8NoBom)
}

function Apply-SwiflyBranding($Content) {
  $c = $Content
  $c = $c.Replace('https://r2.ezz.lol/', 'https://swifly-servers.onrender.com/')
  $c = $c.Replace('https://cdn.ezz.lol/', 'https://swifly-servers.onrender.com/')
  $c = $c.Replace('https://ezz.lol', 'https://swifly.gg')
  $c = $c.Replace('http://ezz.lol', 'https://swifly.gg')
  $c = $c.Replace('discord.gg/ezz', 'discord.gg/swifly')
  $c = $c.Replace('r2.ezz.lol', 'swifly-servers.onrender.com')
  $c = $c.Replace('cdn.ezz.lol', 'swifly-servers.onrender.com')
  $c = $c.Replace('ezz.lol', 'swifly.gg')

  $pairs = @(
    @('EZZ Swifly', 'Swifly BOIII'),
    @('Ezz Swifly', 'Swifly BOIII'),
    @('EZZ BOIII', 'Swifly BOIII'),
    @('Ezz BOIII', 'Swifly BOIII'),
    @('ezz BOIII', 'Swifly BOIII'),
    @('EZZ Boiii', 'Swifly BOIII'),
    @('Ezz Boiii', 'Swifly BOIII'),
    @('EZZ Client', 'Swifly Client'),
    @('Ezz Client', 'Swifly Client'),
    @('EZZ', 'SWIFLY'),
    @('Ezz', 'Swifly'),
    @('ezz', 'swifly'),
    @('SWIFLY BOIII', 'Swifly BOIII'),
    @('Swifly Boiii', 'Swifly BOIII'),
    @('Swifly boiii', 'Swifly BOIII'),
    @('Swifly Swifly', 'Swifly BOIII')
  )

  foreach ($pair in $pairs) {
    $c = $c.Replace($pair[0], $pair[1])
  }
  return $c
}

$roots = @('data', 'src')
$extensions = @('.bat','.cfg','.c','.cc','.cpp','.css','.h','.hpp','.html','.ini','.js','.json','.lua','.md','.ps1','.rc','.txt','.xml','.yml','.yaml')

foreach ($root in $roots) {
  if (!(Test-Path $root)) { continue }
  Get-ChildItem $root -Recurse -File | Where-Object {
    $extensions -contains $_.Extension.ToLowerInvariant() -and
    $_.FullName -notlike '*\build\*' -and
    $_.FullName -notlike '*\deps\*' -and
    $_.FullName -notlike '*\third_party\*'
  } | ForEach-Object {
    $path = $_.FullName
    $original = Get-Content $path -Raw
    $updated = Apply-SwiflyBranding $original
    if ($updated -ne $original) { Write-Utf8NoBom $path $updated }
  }
}

foreach ($file in @('premake5.lua', 'generate.bat', 'README.md')) {
  if (Test-Path $file) {
    $original = Get-Content $file -Raw
    $updated = Apply-SwiflyBranding $original
    if ($updated -ne $original) { Write-Utf8NoBom $file $updated }
  }
}

$htmlPath = 'data/launcher/main.html'
if (Test-Path $htmlPath) {
  $html = Get-Content $htmlPath -Raw
  $html = $html.Replace('<title>BOIII</title>', '<title>Swifly BOIII</title>')
  $html = [regex]::Replace($html, '<title>.*?</title>', '<title>Swifly BOIII</title>', 1)
  $html = [regex]::Replace(
    $html,
    '<span class="title-white title-big">.*?</span><span class="title-white">.*?</span>\s*(<span class="title-gap"></span>\s*)?<span class="title-orange">.*?</span>',
    '<span class="title-white title-big">S</span><span class="title-white">wifly</span> <span class="title-orange">BOIII</span>',
    1
  )
  $html = $html.Replace('Call of Duty: Black Ops 3 enhanced with our modifications.', 'Call of Duty: Black Ops 3 enhanced by Swifly BOIII.')
  $html = $html.Replace('Latest (Auto-update)', 'Latest')

  if ($html -notmatch 'data-option="vanilla"') {
    $marker = '              <div class="launch-option-card" data-option="console"'
    $insert = '              <div class="launch-option-card" data-option="vanilla" title="Vanilla campaign/speedrun mode: disables campaign unlock/stat patches"><span class="launch-option-dot"></span><span class="launch-option-name">Vanilla Mode</span></div>' + [Environment]::NewLine
    $html = $html.Replace($marker, $insert + $marker)
  }

  Write-Utf8NoBom $htmlPath $html
}

$cppPath = 'src/client/launcher/launcher.cpp'
if (Test-Path $cppPath) {
  $cpp = Get-Content $cppPath -Raw
  $cpp = [regex]::Replace($cpp, 'html_window window\(".*?(BOIII|Swifly).*?", 1260, 680\);', 'html_window window("Swifly BOIII", 1260, 680);')
  $cpp = Apply-SwiflyBranding $cpp
  Write-Utf8NoBom $cppPath $cpp
}

Write-Host 'Swifly BOIII branding and Vanilla Mode launcher option applied.'
