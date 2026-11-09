param([string]$ApiUrl = 'https://counter-api.app-playground.co.uk')
$ErrorActionPreference = 'Stop'
if ($ApiUrl -notmatch '^https?://[^\s]+$') { throw 'Provide an HTTP or HTTPS API URL' }
$previousApiUrl = $env:VITE_API_URL
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  $env:VITE_API_URL = $ApiUrl.TrimEnd('/')
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
  Write-Output 'Build complete. Upload the contents of dist/ to the frontend document root.'
} finally {
  if ($null -eq $previousApiUrl) { Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue }
  else { $env:VITE_API_URL = $previousApiUrl }
  Pop-Location
}
