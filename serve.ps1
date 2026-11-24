$port = 8002
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Ornate Chess is running at http://localhost:$port/ (press Ctrl+C to stop)"
Start-Process "http://localhost:$port/"
$types = @{ ".html"="text/html"; ".js"="text/javascript"; ".mjs"="text/javascript"; ".css"="text/css"; ".svg"="image/svg+xml"; ".json"="application/json"; ".png"="image/png"; ".ico"="image/x-icon"; ".wasm"="application/wasm"; ".webmanifest"="application/manifest+json"; ".txt"="text/plain" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = $ctx.Request.Url.LocalPath
  if ($path -eq "/") { $path = "/index.html" }
  $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
  if ((Test-Path $file -PathType Leaf) -and ($file.StartsWith($root))) {
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" })
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
