#!/bin/sh
# Test-only fixture setup for tests/browser/proxy.mjs (run as root in a
# disposable test container; never on a real machine you care about).
#
# The proxy Worker only fetches approved public HTTPS hostnames, and it
# refuses localhost and IP addresses. So the browser test serves two fake
# sites under real-looking names, fixture.saints-test.dev and
# docs.saints-test.dev, from 127.0.0.1:443. This script:
#   - makes a throwaway CA and a certificate for each name (in $DIR);
#   - trusts that CA in this container's system store (so the Workers
#     runtime accepts the certificates);
#   - points both names at 127.0.0.1 in /etc/hosts.
# Idempotent. Nothing here is committed: keys live only in $DIR.
set -e
DIR="${PROXY_FIXTURE_DIR:-/tmp/saints-proxy-fixtures}"
mkdir -p "$DIR"
cd "$DIR"
if [ ! -f ca.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=Saints Proxy Test CA" -keyout ca.key -out ca.crt 2>/dev/null
fi
for h in fixture docs; do
  if [ ! -f "$h.crt" ]; then
    openssl req -newkey rsa:2048 -nodes -subj "/CN=$h.saints-test.dev" -keyout "$h.key" -out "$h.csr" 2>/dev/null
    printf "subjectAltName=DNS:%s.saints-test.dev\n" "$h" > "$h.ext"
    openssl x509 -req -in "$h.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days 7 -extfile "$h.ext" -out "$h.crt" 2>/dev/null
  fi
done
if [ -d /usr/local/share/ca-certificates ] && command -v update-ca-certificates >/dev/null 2>&1; then
  cp ca.crt /usr/local/share/ca-certificates/saints-proxy-test-ca.crt
  update-ca-certificates >/dev/null 2>&1
fi
grep -q "fixture.saints-test.dev" /etc/hosts || echo "127.0.0.1 fixture.saints-test.dev docs.saints-test.dev" >> /etc/hosts
echo "$DIR"
