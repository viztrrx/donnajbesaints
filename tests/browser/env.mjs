// Test environment for the Eaglercraft browser checks:
//   * a file host for the stand-in client (fixtures/stub-client) and this
//     repo's eaglercraft/loader/, playing the part of EAGLER_CLIENT and
//     EAGLER_LOADER;
//   * worker.js running in workerd (Cloudflare's runtime) through Miniflare;
//   * a WebSocket echo server standing in for an Eaglercraft server;
//   * optionally the official Shared World relay (EaglerSPRelay.jar from the
//     EaglercraftX sources' relay_download.zip) when RELAY_JAR points at it.
// Miniflare isn't a dependency of this repo; set MINIFLARE_DIR to a folder
// where `npm i miniflare ws` was run.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { serve, ROOT } from './harness.mjs';

const req = createRequire(path.join(process.env.MINIFLARE_DIR || ROOT, 'package.json'));
const { Miniflare } = req('miniflare');
const { WebSocketServer } = req('ws');

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.epk': 'application/octet-stream', '.lang': 'text/plain', '.map': 'application/json', '.png': 'image/png' };
export const STUB_CLIENT_DIR = path.join(ROOT, 'tests/browser/fixtures/stub-client');
export const requests = [];   // every request the file host saw: proves who fetched what

// clientDir: the folder served as EAGLER_CLIENT. The stand-in by default;
// real-client.mjs passes a real EaglercraftX build folder.
export async function startEnv({ relay = !!process.env.RELAY_JAR, extraEnv = {}, clientDir = STUB_CLIENT_DIR } = {}) {
  const files = await serve((rq, rs) => {
    requests.push({ url: rq.url, ua: rq.headers['user-agent'] || '' });
    const u = new URL(rq.url, 'http://x');
    let file = null;
    if (u.pathname.startsWith('/client/')) file = path.join(clientDir, decodeURIComponent(u.pathname.slice(8)));
    else if (u.pathname.startsWith('/loader/')) file = path.join(ROOT, 'eaglercraft/loader', u.pathname.slice(8));
    if (!file || file.includes('..') || !fs.existsSync(file)) { rs.statusCode = 404; rs.end('nope'); return; }
    rs.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    rs.end(fs.readFileSync(file));
  });

  // Echo "game server": answers every message, counts connections.
  const echo = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => echo.on('listening', r));
  echo.peers = [];
  echo.on('connection', (ws, rq) => { echo.peers.push(rq.socket.remotePort); ws.on('message', (m) => ws.send('echo:' + m)); });
  const echoPort = echo.address().port;

  let relayProc = null, relayPort = 0;
  if (relay) {
    relayPort = 16699 + Math.floor(Math.random() * 1000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eag-relay-'));
    fs.writeFileSync(path.join(dir, 'relayConfig.ini'), `[EaglerSPRelay]\naddress: 127.0.0.1\nport: ${relayPort}\ncode-length: 5\ncode-chars: abcdefghijklmnopqrstuvwxyz0123456789\ncode-mix-case: false\nconnections-per-ip: 128\nping-ratelimit-enable: false\nping-ratelimit-period: 256\nping-ratelimit-limit: 128\nping-ratelimit-lockout-limit: 192\nping-ratelimit-lockout-duration: 300\nworlds-per-ip: 32\nworld-ratelimit-enable: false\nworld-ratelimit-period: 192\nworld-ratelimit-limit: 32\nworld-ratelimit-lockout-limit: 48\nworld-ratelimit-lockout-duration: 600\norigin-whitelist: \nreal-ip-header-name: X-Real-IP\nenable-real-ip-header: false\nshow-local-worlds: true\nserver-comment: Test relay\n`);
    // No reachable STUN/TURN from a sandbox: host candidates only, which is
    // exactly the same-network case.
    fs.writeFileSync(path.join(dir, 'relays.txt'), '[STUN]\nurl=stun:127.0.0.1:3478\n');
    relayProc = spawn('java', ['-jar', path.resolve(process.env.RELAY_JAR), '--debug'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    relayProc.log = '';
    relayProc.stdout.on('data', (d) => { relayProc.log += d; });
    relayProc.stderr.on('data', (d) => { relayProc.log += d; });
    for (let i = 0; i < 100 && !/Listening on/i.test(relayProc.log); i++) await new Promise((r) => setTimeout(r, 100));
  }

  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, 'worker.js'),
    compatibilityDate: '2024-09-23',
    kvNamespaces: ['TELEMETRY'],
    host: '127.0.0.1',
    port: 0,
    bindings: {
      EAGLER_CLIENT: `http://127.0.0.1:${files.port}/client/`,
      EAGLER_LOADER: `http://127.0.0.1:${files.port}/loader/`,
      EAGLER_RELAYS: relay ? `ws://127.0.0.1:${relayPort}/` : 'wss://relay.example.invalid/',
      EAGLER_SERVERS: `Echo test|ws://127.0.0.1:${echoPort}/`,
      ...extraEnv
    }
  });
  const workerUrl = String(await mf.ready).replace(/\/$/, '');
  return {
    files, filesPort: files.port, echo, echoPort, relayPort, relayProc, mf, workerUrl,
    async close() {
      await mf.dispose();
      await files.close();
      echo.close();
      if (relayProc) relayProc.kill();
    }
  };
}
