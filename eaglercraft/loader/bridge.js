/*!
 * Eaglercraft loader bridge — runs inside the Eaglercraft tab's game frame.
 * -------------------------------------------------------------------------
 * Served by worker.js at /eagler/loader/bridge.js, after /eagler/config.js
 * has set window.__eaglerConfig. It:
 *   1. checks the browser can run the game (WebGL 2.0) and that the owner
 *      configured a client build on the worker;
 *   2. routes every WebSocket the game opens (servers and Shared World
 *      relays) through the worker's /eagler/ws proxy. The page's CSP refuses
 *      any other connection, so a socket that slipped past this would fail,
 *      not go direct;
 *   3. sets window.eaglercraftXOpts and starts the client's main();
 *   4. reports state to the console that embeds it (postMessage), and takes
 *      two commands from it: "pause" (let go of the mouse, which makes the
 *      game open its pause menu) and "focus".
 * Nothing here changes how the game itself plays.
 */
(function () {
  'use strict';
  var cfg = window.__eaglerConfig || {};
  var parentWin = window.parent && window.parent !== window ? window.parent : null;
  // The embedding page's origin when the browser exposes it, so reports only
  // go to the console that opened this frame.
  var parentOrigin = (location.ancestorOrigins && location.ancestorOrigins.length && location.ancestorOrigins[0] !== 'null')
    ? location.ancestorOrigins[0] : '*';

  function post(type, data) {
    if (!parentWin) return;
    var msg = { eagler: 1, type: type };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) msg[k] = data[k];
    try { parentWin.postMessage(msg, parentOrigin); } catch (e) { /* parent gone */ }
  }
  function fail(kind, message, detail) {
    post('error', { kind: kind, message: message, detail: detail ? String(detail).slice(0, 400) : '' });
  }

  // ---- Commands from the console -----------------------------------------
  // From the page that embeds this frame, or, in the about:blank window, from
  // the console that opened that window: its script posts from its own
  // window, so that is the message's source.
  function fromConsole(src) {
    if (!parentWin || !src) return false;
    if (src === parentWin) return true;
    try { return src === parentWin.opener; } catch (e) { return false; }
  }
  window.addEventListener('message', function (e) {
    if (!fromConsole(e.source)) return;
    var d = e.data;
    if (!d || d.eagler !== 1) return;
    if (d.type === 'pause') {
      // Losing pointer lock is the game's own pause signal: with no screen
      // open and the mouse released it opens the in-game menu, which pauses
      // a singleplayer world.
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* none held */ }
    } else if (d.type === 'focus') {
      try { window.focus(); } catch (err) { /* ignore */ }
      var c = document.querySelector('#game_frame canvas');
      if (c) {
        // The game reads text and key presses from its canvas. In a popup's
        // about:blank window some browsers won't focus a canvas unless it has
        // an explicit tab index, so the username editor appears unresponsive.
        if (!c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0');
        try { c.focus({ preventScroll: true }); } catch (err) { try { c.focus(); } catch (ignored) { /* ignore */ } }
      }
    }
  });

  document.addEventListener('pointerlockchange', function () {
    post('pointerlock', { locked: !!document.pointerLockElement });
  });
  // A connection the CSP refused: say which, so it can be fixed instead of
  // guessed at.
  document.addEventListener('securitypolicyviolation', function (e) {
    post('blocked', { directive: e.effectiveDirective || e.violatedDirective || '', target: String(e.blockedURI || '').slice(0, 200) });
  });

  // ---- 1. Can this browser run it? ----------------------------------------
  var gl = null;
  try { gl = document.createElement('canvas').getContext('webgl2'); } catch (e) { gl = null; }
  if (!gl) {
    fail('webgl', 'This browser or device has no WebGL 2.0, which Eaglercraft needs to draw the game.');
    return;
  }
  try { var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) { /* ignore */ }
  if (!cfg.clientConfigured) {
    fail('not-configured', 'No Eaglercraft client is set up on the worker yet.');
    return;
  }

  // ---- 2. Every WebSocket goes through the worker ---------------------------
  var NativeWebSocket = window.WebSocket;
  var wsBase = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (cfg.wsPath || '/eagler/ws');
  var relayHosts = {};
  (cfg.relays || []).forEach(function (r) { try { relayHosts[new URL(r).host] = true; } catch (e) { /* skip */ } });
  var allowed = {};
  (cfg.allowedHosts || []).forEach(function (h) { allowed[String(h).toLowerCase()] = true; });
  var nextSocketId = 1;

  function ProxiedWebSocket(url, protocols) {
    var target = null;
    try { target = new URL(String(url), location.href); } catch (e) { target = null; }
    var direct = !target || !/^wss?:$/.test(target.protocol) || target.host === location.host;
    var dest = direct ? url : wsBase + '?url=' + encodeURIComponent(target.href);
    var sock = protocols === undefined ? new NativeWebSocket(dest) : new NativeWebSocket(dest, protocols);
    if (!direct) {
      var id = nextSocketId++;
      var info = {
        id: id, host: target.host, kind: relayHosts[target.host] ? 'relay' : 'server',
        via: location.host, allowed: !!(allowed[target.host.toLowerCase()] || cfg.openProxy)
      };
      post('net', Object.assign({ state: 'connecting' }, info));
      sock.addEventListener('open', function () { post('net', Object.assign({ state: 'open' }, info)); });
      sock.addEventListener('error', function () { post('net', Object.assign({ state: 'error' }, info)); });
      sock.addEventListener('close', function (e) { post('net', Object.assign({ state: 'closed', code: e.code }, info)); });
    }
    return sock;
  }
  ProxiedWebSocket.prototype = NativeWebSocket.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { ProxiedWebSocket[k] = NativeWebSocket[k]; });
  window.WebSocket = ProxiedWebSocket;

  // Shared Worlds connect players with WebRTC, which no worker can carry.
  // Report how each peer connection actually routed (direct on the network,
  // through NAT, or through a TURN relay) instead of implying it was proxied.
  var NativePC = window.RTCPeerConnection;
  if (typeof NativePC === 'function') {
    var describePath = function (pc) {
      return pc.getStats().then(function (stats) {
        var pair = null, local = null, remote = null;
        stats.forEach(function (s) {
          if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
        });
        if (!pair) stats.forEach(function (s) { if (!pair && s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = s; });
        if (pair) { local = stats.get(pair.localCandidateId); remote = stats.get(pair.remoteCandidateId); }
        return {
          local: local ? local.candidateType : '', remote: remote ? remote.candidateType : '',
          protocol: local ? (local.protocol || '') : ''
        };
      });
    };
    var WrappedPC = function (conf, extra) {
      var pc = extra === undefined ? new NativePC(conf) : new NativePC(conf, extra);
      var pid = nextSocketId++;
      pc.addEventListener('connectionstatechange', function () {
        var st = pc.connectionState;
        if (st === 'connected') {
          describePath(pc).then(function (p) { post('peer', { id: pid, state: st, local: p.local, remote: p.remote, protocol: p.protocol }); },
            function () { post('peer', { id: pid, state: st }); });
        } else {
          post('peer', { id: pid, state: st });
        }
      });
      return pc;
    };
    WrappedPC.prototype = NativePC.prototype;
    if (NativePC.generateCertificate) WrappedPC.generateCertificate = NativePC.generateCertificate;
    window.RTCPeerConnection = WrappedPC;
  }

  // Ask the browser to keep this origin's storage (worlds, resource packs)
  // instead of clearing it under storage pressure. Best-effort.
  var persisted = Promise.resolve(false);
  try { if (navigator.storage && navigator.storage.persist) persisted = navigator.storage.persist().catch(function () { return false; }); } catch (e) { /* ignore */ }

  // ---- 3. Start the client ---------------------------------------------------
  var base = new URL(cfg.clientBase || '/eagler/client/', location.href).href;
  var relayPick = Math.floor(Math.random() * Math.max(1, (cfg.relays || []).length));
  window.eaglercraftXOpts = {
    container: 'game_frame',
    assetsURI: base + 'assets.epk',
    localesURI: base + 'lang/',
    worldsDB: 'worlds',
    resourcePacksDB: 'resourcePacks',
    servers: cfg.servers || [],
    relays: (cfg.relays || []).map(function (addr, i) { return { addr: addr, comment: new URL(addr).host, primary: i === relayPick }; }),
    allowVoiceClient: !!cfg.voice,
    // Updates, the offline download and signature badges are for the
    // official site; here the owner decides which build runs.
    allowUpdateSvc: false,
    allowUpdateDL: false,
    checkRelaysForUpdates: false,
    enableDownloadOfflineButton: false,
    enableSignatureBadge: false,
    html5CursorSupport: true
  };
  // The integrated server (singleplayer) is a Worker the client builds from
  // its own classes.js; say exactly where that is.
  window.eaglercraftXClientScriptURL = base + 'classes.js';

  // Crash screens: the client draws them into the container. Pass the first
  // line of the report up so the console can explain what happened.
  var CRASH_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAATEAAABx';
  var crashed = false;
  function watchForCrash(root) {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      if (crashed) return;
      var reason = root.querySelector('#crashReason');
      var img = root.querySelector('img[src^="' + CRASH_IMG + '"]');
      if (!reason && !img) return;
      crashed = true;
      var text = reason ? reason.textContent : ((img && img.nextElementSibling && img.nextElementSibling.textContent) || '');
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
      fail('crash', 'Eaglercraft crashed.', String(text || '').split('\n').filter(Boolean).slice(0, 3).join(' · '));
    }).observe(root, { childList: true, subtree: true });
  }

  window.addEventListener('error', function (e) {
    if (!started) fail('client-error', 'The Eaglercraft client failed while loading.', e.message || '');
  });
  var started = false;
  function start() {
    var container = document.getElementById('game_frame');
    watchForCrash(container);
    if (typeof window.main !== 'function') {
      fail('client-invalid', 'classes.js loaded but has no main() — this does not look like an EaglercraftX 1.8 JavaScript build.');
      return;
    }
    persisted.then(function (p) { post('ready', { persisted: !!p }); });
    started = true;
    try {
      window.main();
      post('started', {});
    } catch (e) {
      fail('crash', 'Eaglercraft stopped while starting.', (e && e.message) || e);
    }
  }
  function load() {
    var s = document.createElement('script');
    s.src = window.eaglercraftXClientScriptURL;
    s.onload = function () {
      // Install into u35's native pack list before the game reads it. This
      // never edits the selected packs or video settings. Failure is optional:
      // the game still starts and the launcher reports how to retry.
      Promise.resolve().then(function () {
        if (typeof window.eaglerPreloadResourcePacks !== 'function') throw new Error('Pack installer unavailable');
        return window.eaglerPreloadResourcePacks(window.eaglercraftXOpts.resourcePacksDB);
      }).then(function (state) {
        post('resourcepack', { state: state });
      }, function (error) {
        console.warn('Chromebox Lite preload skipped:', error);
        post('resourcepack', { state: 'unavailable' });
      }).then(start);
    };
    s.onerror = function () {
      fail('client-load', 'Could not load the Eaglercraft client (classes.js) from the worker.');
    };
    document.head.appendChild(s);
  }
  post('loading', {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
