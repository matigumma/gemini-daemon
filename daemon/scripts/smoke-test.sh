#!/bin/bash
set -euo pipefail

# Smoke test: build, start daemon on a test port, verify key endpoints, then kill.
# Adapts to whether real credentials are available on the machine.
PORT=7966
DAEMON_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID=""
PASS=0
FAIL=0

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

check() {
  local desc="$1" url="$2" expected_status="$3" body_pattern="${4:-}"
  local status body

  body=$(curl -s -w "\n%{http_code}" "$url" 2>/dev/null) || true
  status=$(echo "$body" | tail -1)
  body=$(echo "$body" | sed '$d')

  if [ "$status" != "$expected_status" ]; then
    echo "  FAIL  $desc (expected $expected_status, got $status)"
    FAIL=$((FAIL + 1))
    return
  fi

  if [ -n "$body_pattern" ] && ! echo "$body" | grep -q "$body_pattern"; then
    echo "  FAIL  $desc (body missing: $body_pattern)"
    FAIL=$((FAIL + 1))
    return
  fi

  echo "  PASS  $desc"
  PASS=$((PASS + 1))
}

check_post() {
  local desc="$1" url="$2" data="$3" expected_status="$4" body_pattern="${5:-}"
  local status body

  body=$(curl -s -w "\n%{http_code}" -X POST "$url" \
    -H "Content-Type: application/json" -d "$data" 2>/dev/null) || true
  status=$(echo "$body" | tail -1)
  body=$(echo "$body" | sed '$d')

  if [ "$status" != "$expected_status" ]; then
    echo "  FAIL  $desc (expected $expected_status, got $status)"
    FAIL=$((FAIL + 1))
    return
  fi

  if [ -n "$body_pattern" ] && ! echo "$body" | grep -q "$body_pattern"; then
    echo "  FAIL  $desc (body missing: $body_pattern)"
    FAIL=$((FAIL + 1))
    return
  fi

  echo "  PASS  $desc"
  PASS=$((PASS + 1))
}

echo "=== gemini-daemon smoke test ==="
echo ""

# 1. Build
echo "[1/5] Building..."
cd "$DAEMON_DIR"
pnpm build --silent 2>/dev/null
if [ ! -f dist/index.js ]; then
  echo "FATAL: build failed, dist/index.js not found"
  exit 1
fi
echo "  OK    Build succeeded"
echo ""

# 2. Start daemon on test port
echo "[2/5] Starting daemon on port $PORT..."
node dist/index.js --port "$PORT" &
PID=$!

# Wait for it to be ready (up to 5 seconds)
for i in $(seq 1 50); do
  if curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "FATAL: daemon exited unexpectedly"
    exit 1
  fi
  sleep 0.1
done

if ! curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "FATAL: daemon did not become ready in 5s"
  exit 1
fi
echo "  OK    Daemon started (PID $PID)"
echo ""

# 3. Determine auth state
BASE="http://127.0.0.1:$PORT"
AUTH_STATUS=$(curl -s "$BASE/auth/status" | grep -o '"authenticated":\(true\|false\)' | head -1)

if echo "$AUTH_STATUS" | grep -q "true"; then
  IS_AUTHED=true
  echo "[3/5] Detected: AUTHENTICATED (real credentials found)"
else
  IS_AUTHED=false
  echo "[3/5] Detected: UNAUTHENTICATED (no credentials)"
fi
echo ""

# 4. Test endpoints (always-available routes)
echo "[4/5] Testing always-available endpoints..."
check "GET /health returns 200"          "$BASE/health"        200  '"status":"ok"'
check "GET /health has version"          "$BASE/health"        200  '"version":"0.1.0"'
check "GET /v1/models returns 200"       "$BASE/v1/models"     200  '"object":"list"'
check "GET /v1/models has models"        "$BASE/v1/models"     200  'gemini-2.5-flash'
check "GET /stats returns 200"           "$BASE/stats"         200  'requests_by_model'
check "GET /auth/status returns 200"     "$BASE/auth/status"   200  'authenticated'
check "GET /auth/start returns auth_url" "$BASE/auth/start"    200  'auth_url'
echo ""

# 5. Test auth-gated endpoints (behavior depends on auth state)
echo "[5/5] Testing auth-gated endpoints..."

if [ "$IS_AUTHED" = true ]; then
  check "GET /quota returns 200 (authed)"  "$BASE/quota"  200  'quotas'

  check_post "POST /v1/chat/completions returns 200 (authed)" \
    "$BASE/v1/chat/completions" \
    '{"messages":[{"role":"user","content":"Say OK"}],"max_tokens":5}' \
    200 '"chat.completion"'

  check_post "POST /v1/chat/completions 400 on missing messages" \
    "$BASE/v1/chat/completions" \
    '{"model":"gemini-2.5-flash"}' \
    400 'invalid_request_error'
else
  check "GET /quota returns 401 (unauthed)"  "$BASE/quota"  401  'authentication_error'

  check_post "POST /v1/chat/completions returns 401 (unauthed)" \
    "$BASE/v1/chat/completions" \
    '{"messages":[{"role":"user","content":"hi"}]}' \
    401 'authentication_error'
fi

echo ""

# Cleanup and report
echo "Stopping daemon..."
kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null || true
PID=""
echo "  OK    Daemon stopped"
echo ""

echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All smoke tests passed."
