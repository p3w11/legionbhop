# Local server for the LEGION forum.
# Run it and open the printed address:
#
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1
#
# Serving over http is recommended: browsers restrict IndexedDB (file storage)
# on file:// URLs, so uploads would fall back to a smaller localStorage limit.
#
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
}
catch {
    Write-Host "Port $Port is busy. Try:  .\serve.ps1 -Port 8090" -ForegroundColor Red
    exit 1
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json'
    '.txt'  = 'text/plain; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

Write-Host ""
Write-Host "  LEGION forum is running" -ForegroundColor Yellow
Write-Host "  http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

        $full = Join-Path $root ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
            $ctx.Response.StatusCode = 404
            $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $ctx.Response.ContentType = 'text/plain; charset=utf-8'
            $ctx.Response.ContentLength64 = $body.Length
            $ctx.Response.OutputStream.Write($body, 0, $body.Length)
        }
        else {
            $ext = [IO.Path]::GetExtension($full).ToLower()
            $ctx.Response.StatusCode = 200
            $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
            $ctx.Response.AddHeader('Cache-Control', 'no-store')
            $bytes = [IO.File]::ReadAllBytes($full)
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    }
    catch {
        $ctx.Response.StatusCode = 500
    }
    finally {
        $ctx.Response.OutputStream.Close()
    }
}

$listener.Stop()