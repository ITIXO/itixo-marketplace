<#
.SYNOPSIS
  Stores a GitHub classic personal access token for npm.pkg.github.com in the
  user-level npm config, so npm can download @itixo packages.

.DESCRIPTION
  The token is read from a hidden prompt, verified against GitHub before it is
  written, and never printed or passed as a command-line argument.
  Works with Windows PowerShell 5.1 and PowerShell 7+.

.PARAMETER NoBrowser
  Do not open the token page in the browser.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File unlock-itixo-packages.ps1
#>
[CmdletBinding()]
param(
  [switch]$NoBrowser
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Org = "ITIXO"
$RegistryHost = "npm.pkg.github.com"
$ProbePackage = "@itixo%2fcomponent-library"
$GitHubApi = "https://api.github.com"
$RegistryUrl = "https://$RegistryHost"
$TokenUrl = "https://github.com/settings/tokens/new?scopes=read:packages&description=itixo-npm"
$TokensUrl = "https://github.com/settings/tokens"

$UserConfig = $env:NPM_CONFIG_USERCONFIG
if (-not $UserConfig) { $UserConfig = $env:npm_config_userconfig }
if (-not $UserConfig) { $UserConfig = Join-Path $HOME ".npmrc" }

function Say([string]$Message) { Write-Host $Message }
function Warn([string]$Message) { Write-Host $Message -ForegroundColor Yellow }
function Fail([string]$Message) {
  Write-Host $Message -ForegroundColor Red
  exit 1
}

# Test-only endpoint overrides. They are accepted only for a loopback host, so an
# inherited environment variable can never send the token to another server.
function Resolve-TestEndpoint([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { return $Default }
  $uri = $null
  if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri) -or -not $uri.IsLoopback) {
    Fail "$Name is set to '$value'. It is only for tests and must point to localhost - unset it and run the script again."
  }
  return $value.TrimEnd("/")
}
$GitHubApi = Resolve-TestEndpoint "UNLOCK_ITIXO_GITHUB_API" $GitHubApi
$RegistryUrl = Resolve-TestEndpoint "UNLOCK_ITIXO_REGISTRY_URL" $RegistryUrl

Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Http = New-Object System.Net.Http.HttpClient
$Http.DefaultRequestHeaders.UserAgent.ParseAdd("unlock-itixo-packages")

# Sends an authenticated GET and returns the status code and response headers.
# The token only travels in the Authorization header.
function Invoke-GitHubRequest([string]$Token, [string]$Url) {
  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Url)
  $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $Token)
  try {
    $response = $Http.SendAsync($request).GetAwaiter().GetResult()
  } catch {
    Fail "Could not reach $Url. Check your network connection."
  }
  $headers = @{}
  foreach ($header in $response.Headers) {
    $headers[$header.Key.ToLowerInvariant()] = ($header.Value -join ", ")
  }
  $result = [pscustomobject]@{ Status = [int]$response.StatusCode; Headers = $headers }
  $response.Dispose()
  $request.Dispose()
  return $result
}

function Read-Token {
  if ([Console]::IsInputRedirected) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { Fail "No token entered." }
    return $line
  }
  $secure = Read-Host -AsSecureString "Paste the token (input is hidden), then press Enter"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Wait-ForEnter([string]$Message) {
  if ([Console]::IsInputRedirected) {
    Write-Host $Message
    if ($null -eq [Console]::In.ReadLine()) { Fail "Input closed." }
  } else {
    [void](Read-Host $Message)
  }
}

Say "Unlock @itixo packages on GitHub Packages"
Say ""
Say "npm needs a GitHub classic personal access token with the read:packages scope."
Say ""
Say "1. Create the token:"
Say "   $TokenUrl"
Say "   - Keep it a classic token (fine-grained tokens are not accepted)."
Say "   - Keep the read:packages scope, pick an expiration, click Generate token, and copy it."
Say ""
Warn "2. Authorize the token for the $Org organization via SSO:"
Warn "   In the token list ($TokensUrl) click 'Configure SSO' next to the new token"
Warn "   and choose 'Authorize' for $Org. Without this step GitHub rejects the token."
Say ""

if (-not $NoBrowser) {
  try { Start-Process $TokenUrl } catch { }
}

$token = $null
while ($true) {
  if ([Console]::IsInputRedirected) { Say "Paste the token (input is hidden), then press Enter:" }
  $candidate = (Read-Token) -replace "\s", ""

  if ($candidate -eq "") { Say "The token is empty. Try again."; continue }
  if ($candidate -match "[<>]") { Say "The token contains angle brackets - paste only the token itself."; continue }
  if ($candidate.StartsWith("github_pat_")) { Say "This is a fine-grained token. GitHub Packages accepts only classic tokens - create one at $TokenUrl"; continue }
  if (-not $candidate.StartsWith("ghp_")) { Warn "The token does not start with 'ghp_' (a classic token). Checking it anyway." }

  # Re-checks the same token until it works, needs SSO authorization, or must be replaced.
  $replace = $false
  while (-not $replace) {
    Say "Checking the token with GitHub..."
    $api = Invoke-GitHubRequest $candidate "$GitHubApi/orgs/$Org/packages?package_type=npm&per_page=1"

    if ($api.Status -eq 401) {
      Say "GitHub does not recognize this token (401). It may be mistyped, expired, or revoked."
      $replace = $true
      continue
    }

    if ($api.Headers.ContainsKey("x-github-sso")) {
      Warn "The token is not authorized for $Org SSO yet."
      if ($api.Headers["x-github-sso"] -match "url=([^\s;,]+)") {
        Warn "Open this link and click 'Authorize': $($Matches[1])"
      } else {
        Warn "In $TokensUrl click 'Configure SSO' next to the token and authorize $Org."
      }
      Wait-ForEnter "Press Enter once the token is authorized to check again"
      continue
    }

    if ($api.Headers.ContainsKey("x-oauth-scopes")) {
      $scopes = $api.Headers["x-oauth-scopes"] -split "\s*,\s*"
      if (-not ($scopes -contains "read:packages" -or $scopes -contains "write:packages" -or $scopes -contains "delete:packages")) {
        Say "The token is missing the read:packages scope (it has: $($api.Headers["x-oauth-scopes"]))."
        Say "Edit it in $TokensUrl or create a new one at $TokenUrl."
        $replace = $true
        continue
      }
    }

    $registry = Invoke-GitHubRequest $candidate "$RegistryUrl/$ProbePackage"
    if ($registry.Status -eq 200) {
      $token = $candidate
      break
    }

    Say "GitHub Packages rejected the token (HTTP $($registry.Status))."
    Warn "Check that it is a classic token with read:packages and that 'Configure SSO' -> Authorize is done for $Org."
    Say "Paste the token again once it is fixed, or press Ctrl+C to quit."
    $replace = $true
  }

  if ($token) { break }
}

# Replace any existing token line for the registry, keep everything else.
# Writing through the existing path keeps a symlinked .npmrc intact; UTF-8
# without BOM keeps npm's ini parser happy.
$configDir = Split-Path -Parent $UserConfig
if ($configDir -and -not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }

# On macOS/Linux, create the file and restrict it to the owner before the token
# is written into it.
if (-not (Test-Path $UserConfig)) { [IO.File]::WriteAllText($UserConfig, "") }
if ($env:OS -ne "Windows_NT" -and (Get-Command chmod -ErrorAction SilentlyContinue)) {
  & chmod 600 $UserConfig
  if ($LASTEXITCODE -ne 0) { Fail "Could not restrict permissions on $UserConfig - the token was not saved." }
}

$existing = [IO.File]::ReadAllText($UserConfig)
$newline = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = New-Object System.Collections.Generic.List[string]
foreach ($line in ($existing -split "\r?\n")) {
  if (-not $line.StartsWith("//$RegistryHost/:_authToken=")) { $lines.Add($line) }
}
while ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq "") { $lines.RemoveAt($lines.Count - 1) }
$lines.Add("//$RegistryHost/:_authToken=$token")
$content = ($lines -join $newline) + $newline
[IO.File]::WriteAllText($UserConfig, $content, (New-Object System.Text.UTF8Encoding($false)))

$token = $null
$candidate = $null

Say ""
Write-Host "Token verified and saved to $UserConfig." -ForegroundColor Green
Say "Run the project's install command (npm install, pnpm install, ...) from the project root."
Say "If the install still fails with a 404 against registry.npmjs.org, the project .npmrc is missing the @itixo:registry scope mapping."
