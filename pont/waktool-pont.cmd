<# : batch portion
@echo off
rem Partie batch (cmd) : relance ce meme fichier avec PowerShell, integre a Windows.
title Waktool - pont du journal Wakfu
set "WAKTOOL_PONT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText($env:WAKTOOL_PONT))"
if errorlevel 1 pause
exit /b
#>
# ============================================================================
# Waktool - pont du journal Wakfu  (https://wakfu.manaorbit.app)
# Chrome interdit aux sites d'ouvrir un fichier du dossier AppData. Ce script lit
# wakfu_chat.log et le sert au site sur http://127.0.0.1:47811 (ton PC uniquement).
# - seules les lignes "[Information (jeu)]" sont envoyees (jamais les discussions) ;
# - seul le site Waktool peut les lire (controle de l'origine et de l'hote) ;
# - rien n'est ecrit, rien n'est installe (sauf si tu acceptes le lancement au demarrage).
# Pour l'arreter : ferme cette fenetre.
# ============================================================================
$ErrorActionPreference = 'Stop'
$Version = 1
$Port = 47811
$Origins = @('https://wakfu.manaorbit.app', 'http://localhost:8799', 'http://127.0.0.1:8799')
$Log = if ($env:WAKTOOL_LOG) { $env:WAKTOOL_LOG } else { Join-Path $env:APPDATA 'zaap\gamesLogs\wakfu\logs\wakfu_chat.log' }
$MaxBytes = 5MB
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Say([string]$msg, [string]$color = 'Gray') { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -ForegroundColor $color }

# ---------------------------------------------------------------- lancement au demarrage de Windows (propose une fois)
try {
  $self = $env:WAKTOOL_PONT
  $startup = [Environment]::GetFolderPath('Startup')
  $dest = Join-Path $startup 'waktool-pont.cmd'
  $flag = Join-Path $env:LOCALAPPDATA 'Waktool\pont-demarrage.txt'
  if ($self -and $startup -and ($self -ne $dest) -and -not (Test-Path -LiteralPath $flag)) {
    $answer = Read-Host 'Lancer le pont automatiquement au demarrage de Windows ? (o/n)'
    New-Item -ItemType Directory -Force -Path (Split-Path $flag) | Out-Null
    Set-Content -LiteralPath $flag -Value $answer
    if ($answer -match '^\s*[oOyY]') {
      Copy-Item -LiteralPath $self -Destination $dest -Force
      Unblock-File -LiteralPath $dest -ErrorAction SilentlyContinue
      Say "Ajoute au demarrage : $dest (supprime ce fichier pour annuler)" 'Green'
    }
  }
} catch { Say "Demarrage automatique non configure : $($_.Exception.Message)" 'Yellow' }

# ---------------------------------------------------------------- lecture du journal
# Renvoie les lignes "Information (jeu)" lues depuis l'octet $from (-1 = premiere lecture : les 5 derniers Mo)
function Read-Log([long]$from) {
  $r = @{ exists = $false; size = 0; next = 0; mod = 0; reset = $false; text = '' }
  if (-not (Test-Path -LiteralPath $Log)) { return $r }
  $r.exists = $true
  $r.mod = [DateTimeOffset]::new([IO.File]::GetLastWriteTimeUtc($Log)).ToUnixTimeMilliseconds()
  $fs = [IO.File]::Open($Log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
  try {
    $size = $fs.Length
    $r.size = $size
    if ($from -lt 0) { $start = [Math]::Max([long]0, $size - $MaxBytes) }
    elseif ($from -gt $size) { $start = [long]0; $r.reset = $true }   # fichier recree ou vide
    else { $start = $from }
    $len = [int][Math]::Min([long]$MaxBytes, $size - $start)
    $buf = New-Object byte[] $len
    $fs.Position = $start
    $read = 0
    while ($read -lt $len) {
      $n = $fs.Read($buf, $read, $len - $read)
      if ($n -le 0) { break }
      $read += $n
    }
  } finally { $fs.Dispose() }
  # on ne garde que les lignes completes (la derniere peut etre en cours d'ecriture)
  $end = -1
  if ($read -gt 0) { $end = [Array]::LastIndexOf($buf, [byte]10, $read - 1) }
  if ($end -lt 0) { $r.next = $start; return $r }
  $r.next = $start + $end + 1
  $text = $Utf8.GetString($buf, 0, $end + 1)
  if ($from -lt 0 -and $start -gt 0) {   # premiere ligne coupee
    $i = $text.IndexOf("`n")
    $text = $text.Substring($i + 1)
  }
  $keep = New-Object System.Collections.Generic.List[string]
  foreach ($line in $text.Split("`n")) {
    if ($line.Contains('[Information (jeu)]')) { $keep.Add($line.TrimEnd("`r")) }
  }
  $r.text = [string]::Join("`n", $keep)
  return $r
}

# ---------------------------------------------------------------- mini serveur HTTP (127.0.0.1 uniquement)
function Send($stream, [int]$code, [string]$status, [string]$body, [string]$origin, [hashtable]$extra) {
  $bytes = $Utf8.GetBytes($body)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("HTTP/1.1 $code $status`r`n")
  [void]$sb.Append("Content-Type: text/plain; charset=utf-8`r`n")
  [void]$sb.Append("Content-Length: $($bytes.Length)`r`n")
  [void]$sb.Append("Cache-Control: no-store`r`nConnection: close`r`nX-Pont: $Version`r`n")
  if ($origin) {
    [void]$sb.Append("Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`n")
    [void]$sb.Append("Access-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`n")
    [void]$sb.Append("Access-Control-Allow-Headers: *`r`nAccess-Control-Max-Age: 600`r`n")
    [void]$sb.Append("Access-Control-Expose-Headers: X-Pont, X-Exists, X-Size, X-Next, X-Mod, X-Reset`r`n")
  }
  if ($extra) { foreach ($k in $extra.Keys) { [void]$sb.Append("${k}: $($extra[$k])`r`n") } }
  [void]$sb.Append("`r`n")
  $head = [Text.Encoding]::ASCII.GetBytes($sb.ToString())
  $stream.Write($head, 0, $head.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

$script:seen = $false
function Handle($client) {
  $client.ReceiveTimeout = 1500
  $client.SendTimeout = 5000
  $stream = $client.GetStream()
  $buf = New-Object byte[] 8192
  $got = 0
  $req = ''
  while ($got -lt $buf.Length) {
    $n = $stream.Read($buf, $got, $buf.Length - $got)
    if ($n -le 0) { break }
    $got += $n
    $req = [Text.Encoding]::ASCII.GetString($buf, 0, $got)
    if ($req.Contains("`r`n`r`n")) { break }
  }
  if (-not $req) { return }
  $lines = $req -split "`r`n"
  $first = $lines[0] -split ' '
  if ($first.Count -lt 2) { return }
  $method = $first[0]
  $target = $first[1]
  $h = @{}
  foreach ($l in ($lines | Select-Object -Skip 1)) {
    $i = $l.IndexOf(':')
    if ($i -gt 0) { $h[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() }
  }
  # protection contre le "DNS rebinding" et les autres sites
  if (@("127.0.0.1:$Port", "localhost:$Port") -notcontains $h['host']) { Send $stream 403 'Forbidden' 'hote refuse' '' $null; return }
  $origin = $h['origin']
  if ($origin -and ($Origins -notcontains $origin)) { Send $stream 403 'Forbidden' 'site non autorise' '' $null; return }
  $path = ($target -split '\?', 2)[0]
  if ($method -eq 'OPTIONS') { Send $stream 204 'No Content' '' $origin $null; return }
  if ($method -ne 'GET') { Send $stream 405 'Method Not Allowed' '' $origin $null; return }
  if ($path -eq '/log') {
    $from = [long]-1
    if ($target -match '[?&]from=(-?\d+)') { $from = [long]$Matches[1] }
    $r = Read-Log $from
    $ex = @{ 'X-Exists' = [int]$r.exists; 'X-Size' = $r.size; 'X-Next' = $r.next; 'X-Mod' = $r.mod; 'X-Reset' = [int]$r.reset }
    Send $stream 200 'OK' $r.text $origin $ex
    if (-not $script:seen) {
      $script:seen = $true
      if ($r.exists) { Say 'Site Waktool connecte : lecture en direct.' 'Green' } else { Say "Journal introuvable : $Log" 'Yellow' }
    }
    return
  }
  if ($path -eq '/' -or $path -eq '/ping') {
    Send $stream 200 'OK' "Pont Waktool v$Version actif.`nJournal : $Log`nTrouve : $(Test-Path -LiteralPath $Log)" $origin $null
    return
  }
  Send $stream 404 'Not Found' '' $origin $null
}

# ---------------------------------------------------------------- demarrage
$listener = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), $Port
try { $listener.Start() }
catch {
  Say "Le port $Port est deja utilise : le pont tourne sans doute deja dans une autre fenetre." 'Yellow'
  Start-Sleep -Seconds 6
  exit 0
}
Write-Host ''
Write-Host '  Pont Waktool actif - laisse cette fenetre ouverte (tu peux la reduire).' -ForegroundColor Green
Write-Host "  Journal : $Log"
if (-not (Test-Path -LiteralPath $Log)) { Write-Host '  (introuvable pour le moment : lance Wakfu)' -ForegroundColor Yellow }
Write-Host '  Sur le site : page Objectif > Journal du chat > Connecter.'
Write-Host ''
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try { Handle $client }
    catch { if ($_.Exception.InnerException -isnot [System.IO.IOException] -and $_.Exception -isnot [System.IO.IOException]) { Say "Erreur : $($_.Exception.Message)" 'Yellow' } }
    finally { $client.Close() }
  }
} finally { $listener.Stop() }
