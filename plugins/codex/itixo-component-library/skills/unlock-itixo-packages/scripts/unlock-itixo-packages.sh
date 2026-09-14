#!/usr/bin/env bash
# Stores a GitHub classic personal access token for npm.pkg.github.com in the
# user-level npm config, so npm can download @itixo packages.
#
# The token is read from a hidden prompt, verified against GitHub before it is
# written, and never printed or passed as a command-line argument.
#
# Usage: unlock-itixo-packages.sh [--no-browser]

set -euo pipefail

ORG="ITIXO"
REGISTRY_HOST="npm.pkg.github.com"
PROBE_PACKAGE="@itixo%2fcomponent-library"
GITHUB_API="${UNLOCK_ITIXO_GITHUB_API:-https://api.github.com}"
REGISTRY_URL="${UNLOCK_ITIXO_REGISTRY_URL:-https://${REGISTRY_HOST}}"
TOKEN_URL="https://github.com/settings/tokens/new?scopes=read:packages&description=itixo-npm"
TOKENS_URL="https://github.com/settings/tokens"
USERCONFIG="${NPM_CONFIG_USERCONFIG:-${npm_config_userconfig:-$HOME/.npmrc}}"

open_browser=1
for arg in "$@"; do
  case "$arg" in
    --no-browser) open_browser=0 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

if [ -t 1 ]; then
  bold=$'\033[1m'; yellow=$'\033[33m'; red=$'\033[31m'; green=$'\033[32m'; reset=$'\033[0m'
else
  bold=""; yellow=""; red=""; green=""; reset=""
fi

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "${yellow}${bold}$*${reset}"; }
fail() { printf '%s\n' "${red}${bold}$*${reset}" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "'curl' is required but was not found on PATH."

# Sends an authenticated request without exposing the token in process arguments.
# Prints the response headers; the body is discarded.
github_request() {
  local token="$1" url="$2"
  printf 'header = "Authorization: Bearer %s"\n' "$token" \
    | curl -sS -K - -o /dev/null -D - "$url"
}

header_value() {
  local headers="$1" name="$2"
  printf '%s\n' "$headers" | tr -d '\r' | awk -v name="$name" '
    BEGIN { lname = tolower(name) }
    { split($0, parts, ":"); if (tolower(parts[1]) == lname) { sub(/^[^:]*:[ \t]*/, ""); print; exit } }
  '
}

status_code() {
  printf '%s\n' "$1" | tr -d '\r' | awk '/^HTTP\// { code = $2 } END { print code }'
}

say "${bold}Unlock @itixo packages on GitHub Packages${reset}"
say ""
say "npm needs a GitHub ${bold}classic${reset} personal access token with the ${bold}read:packages${reset} scope."
say ""
say "1. Create the token:"
say "   ${TOKEN_URL}"
say "   - Keep it a classic token (fine-grained tokens are not accepted)."
say "   - Keep the read:packages scope, pick an expiration, click Generate token, and copy it."
say ""
warn "2. Authorize the token for the ${ORG} organization via SSO:"
warn "   In the token list (${TOKENS_URL}) click 'Configure SSO' next to the new token"
warn "   and choose 'Authorize' for ${ORG}. Without this step GitHub rejects the token."
say ""

if [ "$open_browser" -eq 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "$TOKEN_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$TOKEN_URL" >/dev/null 2>&1 || true
  fi
fi

wait_for_enter() {
  printf '%s' "$1"
  IFS= read -r _ || fail "Input closed."
  printf '\n'
}

token=""
while :; do
  printf 'Paste the token (input is hidden), then press Enter: '
  IFS= read -r -s token || fail "No token entered."
  printf '\n'
  token="$(printf '%s' "$token" | tr -d '[:space:]')"

  case "$token" in
    "") say "The token is empty. Try again."; continue ;;
    *"<"*|*">"*) say "The token contains angle brackets — paste only the token itself."; continue ;;
    github_pat_*) say "This is a fine-grained token. GitHub Packages accepts only classic tokens — create one at ${TOKEN_URL}"; continue ;;
    ghp_*) ;;
    *) warn "The token does not start with 'ghp_' (a classic token). Checking it anyway." ;;
  esac

  # Re-checks the same token until it works, needs SSO authorization, or must be replaced.
  while :; do
    say "Checking the token with GitHub…"
    api_headers="$(github_request "$token" "${GITHUB_API}/orgs/${ORG}/packages?package_type=npm&per_page=1")" \
      || fail "Could not reach ${GITHUB_API}. Check your network connection."
    api_status="$(status_code "$api_headers")"
    sso="$(header_value "$api_headers" "X-GitHub-SSO")"
    scopes="$(header_value "$api_headers" "X-OAuth-Scopes")"

    if [ "$api_status" = "401" ]; then
      say "GitHub does not recognize this token (401). It may be mistyped, expired, or revoked."
      continue 2
    fi

    if [ -n "$sso" ]; then
      sso_url="$(printf '%s' "$sso" | sed -n 's/.*url=\([^ ;]*\).*/\1/p')"
      warn "The token is not authorized for ${ORG} SSO yet."
      if [ -n "$sso_url" ]; then
        warn "Open this link and click 'Authorize': ${sso_url}"
      else
        warn "In ${TOKENS_URL} click 'Configure SSO' next to the token and authorize ${ORG}."
      fi
      wait_for_enter "Press Enter once the token is authorized to check again… "
      continue
    fi

    if [ -n "$scopes" ]; then
      case ", ${scopes}," in
        *", read:packages,"*|*", write:packages,"*|*", delete:packages,"*) ;;
        *)
          say "The token is missing the read:packages scope (it has: ${scopes})."
          say "Edit it in ${TOKENS_URL} or create a new one at ${TOKEN_URL}."
          continue 2
          ;;
      esac
    fi

    registry_headers="$(github_request "$token" "${REGISTRY_URL}/${PROBE_PACKAGE}")" \
      || fail "Could not reach ${REGISTRY_URL}. Check your network connection."
    registry_status="$(status_code "$registry_headers")"
    [ "$registry_status" = "200" ] && break 2

    say "GitHub Packages rejected the token (HTTP ${registry_status:-unknown})."
    warn "Check that it is a classic token with read:packages and that 'Configure SSO' → Authorize is done for ${ORG}."
    say "Paste the token again once it is fixed, or press Ctrl+C to quit."
    continue 2
  done
done

# Replace any existing token line for the registry, keep everything else.
# Writing through the existing path (instead of moving a file over it) keeps a
# symlinked ~/.npmrc intact.
mkdir -p "$(dirname "$USERCONFIG")"
touch "$USERCONFIG"
chmod 600 "$USERCONFIG"
tmp="$(mktemp "${TMPDIR:-/tmp}/unlock-itixo-packages.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
grep -v "^//${REGISTRY_HOST}/:_authToken=" "$USERCONFIG" > "$tmp" || true
printf '//%s/:_authToken=%s\n' "$REGISTRY_HOST" "$token" >> "$tmp"
cat "$tmp" > "$USERCONFIG"
rm -f "$tmp"
trap - EXIT
unset token

say ""
say "${green}${bold}Token verified and saved to ${USERCONFIG}.${reset}"
say "Run the project's install command (npm install, pnpm install, …) from the project root."
say "If the install still fails with a 404 against registry.npmjs.org, the project .npmrc is missing the @itixo:registry scope mapping."
