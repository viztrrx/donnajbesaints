// Saints Service home-screen app: starts the same console script the
// bookmarklet injects, in app mode (full screen, safe areas, no close).
(function () {
  'use strict';
  window.__agentConsoleApp = true;
  var boot = document.getElementById('boot');
  var msg = document.getElementById('boot-msg');
  var retry = document.getElementById('boot-retry');
  var install = document.getElementById('install');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/console/sw.js', { scope: '/console/' }).catch(function () { /* app still works online */ });
  }

  // Opened from the Home Screen (iOS sets navigator.standalone) or as an
  // installed app elsewhere. In Safari, iPhone users first see how to install.
  var standalone = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  var iPhoneSafari = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function start() {
    install.hidden = true;
    retry.hidden = true;
    msg.textContent = 'Loading…';
    var s = document.createElement('script');
    s.src = '/console/script.js';
    s.onload = function () {
      // The console mounts its own full-screen surface; the splash goes.
      if (document.getElementById('gpa-root-host')) boot.remove();
      else { msg.textContent = 'The console didn’t start.'; retry.hidden = false; }
    };
    s.onerror = function () {
      s.remove();
      msg.textContent = navigator.onLine === false
        ? 'You’re offline and the console isn’t saved on this device yet. Connect once, then it opens offline too.'
        : 'Couldn’t load the console. Check your connection and try again.';
      retry.hidden = false;
    };
    document.head.appendChild(s);
  }
  retry.addEventListener('click', start);

  try { var seen = localStorage.getItem('agent-console-app.install-seen') === '1'; } catch (e) { seen = true; }
  if (!standalone && iPhoneSafari && !seen) {
    msg.textContent = 'Add Saints Service to your Home Screen to use it as an app.';
    install.hidden = false;
    document.getElementById('install-continue').addEventListener('click', function () {
      try { localStorage.setItem('agent-console-app.install-seen', '1'); } catch (e) { /* private mode */ }
      start();
    });
  } else {
    start();
  }
})();
