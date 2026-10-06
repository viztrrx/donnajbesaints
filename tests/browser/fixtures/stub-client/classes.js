/*
 * TEST STAND-IN for an EaglercraftX 1.8 classes.js. It is NOT Minecraft and
 * contains no Minecraft code. It follows the same contract the real client
 * uses with its page (read from the EaglercraftX 1.8 sources), so the
 * console's loader, worker routes and CSP can be tested without a build:
 *   - a global main(args); main(["_worker_process_"]) inside a Worker
 *   - window.eaglercraftXOpts: container, assetsURI, worldsDB, servers, relays
 *   - document.getElementById(container), a WebGL 2.0 canvas in it
 *   - pointer lock on click; losing it while "in game" opens a pause menu
 *   - singleplayer: a Worker started from a blob: copy of this file
 *     (window.eaglercraftXClientScriptURL), worlds saved in IndexedDB
 *   - Shared Worlds: the real relay packet format over a WebSocket, then an
 *     RTCPeerConnection with a "lan" data channel, as PlatformWebRTC does
 * State is exposed on window.__stub for the browser tests to read.
 */
function main(args) {
  'use strict';
  if (args && args[0] === '_worker_process_') {
    self.onmessage = function (e) { self.postMessage({ ch: 'pong', ticks: (e.data && e.data.n) || 0, worker: typeof WorkerGlobalScope !== 'undefined' }); };
    return;
  }
  var S = window.__stub = { started: true, frames: 0, keys: [], mouse: 0, locked: false, paused: false, inGame: false, worker: 'pending', world: null, errors: [] };
  var opts = window.eaglercraftXOpts;
  if (!opts || !opts.container) throw new Error('window.eaglercraftXOpts.container is undefined!');
  var root = document.getElementById(opts.container);
  if (!root) throw new Error('Root element not found');
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  canvas.tabIndex = 0;
  root.appendChild(canvas);
  var gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL 2.0 is not supported on this device!');
  S.webgl = gl.getParameter(gl.VERSION);
  (function frame() {
    canvas.width = root.clientWidth || 1; canvas.height = root.clientHeight || 1;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(S.paused ? 0.2 : 0.35, S.paused ? 0.2 : 0.55, S.paused ? 0.2 : 0.95, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    S.frames++;
    requestAnimationFrame(frame);
  })();
  fetch(opts.assetsURI).then(function (r) { S.assets = r.status; });
  window.addEventListener('keydown', function (e) { S.keys.push(e.key); if (e.key === 'Escape') { S.paused = true; } e.preventDefault(); });
  canvas.addEventListener('mousedown', function () { S.mouse++; canvas.requestPointerLock(); S.inGame = true; S.paused = false; });
  document.addEventListener('pointerlockchange', function () {
    S.locked = !!document.pointerLockElement;
    if (!S.locked && S.inGame) S.paused = true;   // the real client's displayInGameMenu()
  });
  // Integrated server, started the way ClientPlatformSingleplayer does it.
  fetch(window.eaglercraftXClientScriptURL).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
    var url = URL.createObjectURL(new Blob([buf, '\n\nmain(["_worker_process_"]);'], { type: 'text/javascript;charset=utf8' }));
    var w = new Worker(url);
    w.onmessage = function (e) { S.worker = e.data && e.data.ch === 'pong' && e.data.worker ? 'ok' : 'bad'; };
    w.onerror = function (e) { S.worker = 'error: ' + (e.message || 'worker failed'); };
    w.postMessage({ n: 1 });
  }).catch(function (e) { S.worker = 'error: ' + e.message; });
  // A "world" in IndexedDB that counts how many times it was opened.
  var req = indexedDB.open(opts.worldsDB || 'worlds', 1);
  req.onupgradeneeded = function () { req.result.createObjectStore('worlds'); };
  req.onsuccess = function () {
    var db = req.result, tx = db.transaction('worlds', 'readwrite'), st = tx.objectStore('worlds');
    var g = st.get('World 1');
    g.onsuccess = function () {
      var w = g.result || { name: 'World 1', opens: 0 };
      w.opens++;
      st.put(w, 'World 1');
      tx.oncomplete = function () { S.world = w; };
    };
  };
  req.onerror = function () { S.world = { error: String(req.error) }; };

  // ---- Shared Worlds: relay packets (sp/relay/pkt/*.java) ----
  function a8(s) { var o = [s.length]; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i)); return o; }
  function a16(s) { var o = [(s.length >> 8) & 255, s.length & 255]; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i)); return o; }
  function pkt(id, body) { return new Uint8Array([id].concat(body)); }
  function reader(buf) {
    var b = new Uint8Array(buf), p = 0;
    return {
      id: b[p++],
      u8: function () { return b[p++]; },
      u16: function () { var v = (b[p] << 8) | b[p + 1]; p += 2; return v; },
      s8: function () { var l = b[p++], s = ''; for (var i = 0; i < l; i++) s += String.fromCharCode(b[p++]); return s; },
      s16: function () { var l = (b[p] << 8) | b[p + 1], s = ''; p += 2; for (var i = 0; i < l; i++) s += String.fromCharCode(b[p++]); return s; }
    };
  }
  function iceFrom(r) {
    var n = r.u16(), list = [];
    for (var i = 0; i < n; i++) { r.u8(); var url = r.s16(), u = r.s8(), pw = r.s8(); list.push(u ? { urls: url, username: u, credential: pw } : { urls: url }); }
    return list;
  }
  function gather(pc, cb) {
    var c = [], timer = null;
    pc.addEventListener('icecandidate', function (e) {
      if (e.candidate) {
        c.push({ sdpMLineIndex: '' + e.candidate.sdpMLineIndex, candidate: e.candidate.candidate });
        if (!timer) timer = setTimeout(function () { cb(c.slice()); }, 1500);
      }
    });
  }
  S.share = { log: [] };
  S.hostWorld = function (relay) {
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket(relay); ws.binaryType = 'arraybuffer';
      var ice = [], peers = {};
      ws.onopen = function () { ws.send(pkt(0x00, [1, 1].concat(a8('Stub World;0')))); S.share.log.push('host: handshake sent'); };
      ws.onerror = function () { reject(new Error('relay socket error')); };
      ws.onmessage = function (e) {
        var r = reader(e.data);
        if (r.id === 0x00) { r.u8(); r.u8(); S.share.code = r.s8(); S.share.log.push('host: code ' + S.share.code); resolve(S.share.code); }
        else if (r.id === 0x01) { ice = iceFrom(r); S.share.ice = ice; }
        else if (r.id === 0x02) {
          var id = r.s8(); S.share.log.push('host: new client ' + id);
          var pc = new RTCPeerConnection({ iceServers: ice });
          peers[id] = pc;
          gather(pc, function (c) { ws.send(pkt(0x03, a8(id).concat(a16(JSON.stringify(c))))); });
          pc.ondatachannel = function (ev) {
            var ch = ev.channel;
            ch.onmessage = function (m) { S.share.hostGot = String(m.data); ch.send('welcome from host'); };
          };
        } else if (r.id === 0x04) {
          var pid = r.s8(), desc = r.s16(), p = peers[pid];
          p.setRemoteDescription(JSON.parse(desc)).then(function () { return p.createAnswer(); }).then(function (a) {
            return p.setLocalDescription(a).then(function () { ws.send(pkt(0x04, a8(pid).concat(a16(JSON.stringify(a))))); });
          });
        } else if (r.id === 0x03) {
          var pid3 = r.s8(); JSON.parse(r.s16()).forEach(function (c) { peers[pid3].addIceCandidate(new RTCIceCandidate(c)); });
        } else if (r.id === 0x05) { S.share.log.push('host: client success ' + r.s8()); }
        else if (r.id === 0xFF) { var code = r.u8(); S.share.log.push('host: relay error ' + code + ' ' + r.s16()); }
      };
    });
  };
  S.joinWorld = function (relay, code) {
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket(relay); ws.binaryType = 'arraybuffer';
      var pc = null, ch = null;
      ws.onopen = function () { ws.send(pkt(0x00, [2, 1].concat(a8(code)))); };
      ws.onerror = function () { reject(new Error('relay socket error')); };
      ws.onmessage = function (e) {
        var r = reader(e.data);
        if (r.id === 0x00) { r.u8(); r.u8(); S.share.clientId = r.s8(); }
        else if (r.id === 0x01) {
          pc = new RTCPeerConnection({ iceServers: iceFrom(r) });
          gather(pc, function (c) { ws.send(pkt(0x03, a8('').concat(a16(JSON.stringify(c))))); });
          ch = pc.createDataChannel('lan');
          ch.onopen = function () { ws.send(pkt(0x05, a8(''))); ch.send('hello from joiner'); };
          ch.onmessage = function (m) { S.share.joinGot = String(m.data); resolve(S.share.joinGot); };
          pc.createOffer().then(function (o) { return pc.setLocalDescription(o).then(function () { ws.send(pkt(0x04, a8('').concat(a16(JSON.stringify(o))))); }); });
        } else if (r.id === 0x04) { r.s8(); pc.setRemoteDescription(JSON.parse(r.s16())); }
        else if (r.id === 0x03) { r.s8(); JSON.parse(r.s16()).forEach(function (c) { pc.addIceCandidate(new RTCIceCandidate(c)); }); }
        else if (r.id === 0xFF) { var c2 = r.u8(); reject(new Error('relay error ' + c2 + ' ' + r.s16())); }
      };
    });
  };
}
