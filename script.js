/*!
 * Agent Console — injectable console/bookmarklet AI overlay (OpenAI only)
 * -------------------------------------------------------------
 * WHAT THIS DOES
 *  - "Page Insights" tab: reads the visible TEXT of the current page
 *    (document.body.innerText) and/or captures an actual SCREENSHOT (via
 *    getDisplayMedia), and sends either or both to OpenAI to
 *    summarize, analyze, or answer questions. Includes a "Solve quiz on
 *    this page" button that also reads dropdown (<select>) options and
 *    radio/checkbox choices the AI can't see from plain page text, then
 *    returns one answer per question — including multi-part ones like
 *    "2a"/"2b" — as a small animated answer grid.
 *  - A general "Ask AI" chat section, independent of page content.
 *  - A "Music" section with a few ways to play something:
 *      1) Type a song name/description ("mi historia entre tus dedos by
 *         eslabon armado") and it searches YouTube's official Data API
 *         for the closest match and plays it via YouTube's own embed
 *         player. Needs a free YouTube Data API v3 key (see below).
 *      2) Paste a SoundCloud link directly, played via SoundCloud's own
 *         official embeddable player.
 *      3) A local/preloaded music library: fill in PRELOADED_TRACKS below
 *         with raw.githubusercontent.com URLs to audio files in your repo
 *         (must be public) and they'll show up in the playlist on load —
 *         or just click "Add audio files" to pick files off your own
 *         device for the session. Playback is a plain <audio> element, no
 *         embed/iframe involved.
 *    Playback keeps running in the background while you switch tabs (the
 *    player element stays in the DOM, just visually hidden).
 *  - A "Proxy" section: loads pages through Scramjet (a separate proxy
 *    project the user runs on their own device — github.com/MercuryWorkshop
 *    /scramjet), so sites that block plain iframe embedding can still be
 *    reached. The proxy server address is user-configurable and defaults to
 *    this device's own localhost; it is never a shared/public default, so
 *    it does nothing unless the person using this script is also running
 *    their own proxy server, and it never routes anyone else's traffic.
 *  - A "Theme" section to change the panel's color scheme, plus optional
 *    ambient background particles (several styles, adjustable play area)
 *    and typing-speed/response-font controls.
 *  - All sections are switched via a dropdown in place of tabs.
 *  - Draggable panel. Minimizing flies it to the bottom-right corner as
 *    a resting spot (still fully draggable from there); the minimized
 *    button's icon is customizable in Settings (original icon styles,
 *    not any company's actual logo — see note in Settings section).
 *
 * SETUP
 *  1. Get an OpenAI API key from https://platform.openai.com/api-keys
 *     (starts with "sk-"), or have the owner assign you one from the admin
 *     console. OpenAI is the only AI provider this script uses.
 *  2. For the Music search feature: get a free YouTube Data API v3 key
 *     at console.cloud.google.com — create/select a project, enable
 *     "YouTube Data API v3" under APIs & Services, then create an API
 *     key under Credentials. Free tier covers roughly 100 searches/day.
 *  3. Host this file somewhere you control (a GitHub Gist "raw" URL,
 *     a repo on GitHub Pages, etc).
 *  4. On any page, open DevTools console and run:
 *       fetch('https://YOUR-RAW-URL/script.js').then(r=>r.text()).then(eval)
 *  5. The first time you use each feature, it'll ask you to paste the
 *     relevant API key. Keys are stored in localStorage FOR THAT SITE'S
 *     ORIGIN ONLY (browser security — a script can't share localStorage
 *     across different domains). You'll be asked again on a new domain.
 *
 * SCREEN CAPTURE
 *  - "Capture Screen" uses the browser's native getDisplayMedia prompt —
 *    Chrome will ask YOU to pick a tab/window/screen to share, take one
 *    frame, then immediately stop sharing. It cannot capture silently;
 *    that permission dialog is a browser-level protection and can't be
 *    skipped by this or any page script.
 *  - Requires a secure context (https) and a real click on the button.
 *
 * NOTES / LIMITS
 *  - This is plain injected JS, not a Chrome extension — it disappears
 *    on page reload/navigation. Re-run the fetch command each time, or
 *    turn it into a browser bookmarklet / DevTools Snippet.
 *  - Page text is truncated (see MAX_PAGE_CHARS) and screenshots are
 *    downscaled (see MAX_IMAGE_WIDTH) to keep requests fast and within
 *    token limits.
 *  - Calls OpenAI's Chat Completions API, through the worker proxy when
 *    one is configured (OPENAI_PROXY), otherwise directly from the browser.
 */
(function () {
  'use strict';

  // ---- Config -------------------------------------------------------
  const OPENAI_STORAGE_KEY = 'gpa_openai_api_key';
  // Set once a user declines the "paste your key" prompt while the proxy is
  // configured, so they aren't nagged every call — the owner may have
  // assigned them a key server-side via the admin console's "Assign key".
  const OPENAI_KEY_SKIP = 'gpa_openai_key_skip';
  // Whether the worker says this account has an owner-assigned OpenAI key.
  // Boolean only — the key itself never leaves the worker (see
  // applyAssignedKeys).
  const serverAssignedKeys = { openai: false };
  // Default models. Every page load and every sign-in writes these back into
  // the admin model settings (see enforceDefaultModels), so a session always
  // starts on gpt-4.1-mini with gpt-5 for hard tasks.
  const OPENAI_MODEL = 'gpt-4.1-mini';
  const SMART_MODEL_DEFAULT = 'gpt-5';
  const REASON_KEY = 'gpa_reason';
const REASONING_MODELS = new Set([
  'gpt-5',
  'gpt-6-astra',
  'gpt-5.6-luna',
  // add other reasoning-capable IDs you allow-list, e.g.:
  // 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5-pro',
]);
let reasoningEffort = localStorage.getItem(REASON_KEY) || 'medium';
function modelSupportsReasoning(id) { return REASONING_MODELS.has((id || '').trim()); }
  // Browser→OpenAI calls can be blocked by ad blockers, antivirus shields or
  // network filters (they look like CORS errors). Routing through this proxy
  // avoids that: it forwards to api.openai.com and adds the CORS header.
  // Set to '' to call OpenAI directly.
  const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';
  // ---- Usage telemetry ----
  // Every instance sends a small heartbeat to the worker's /track endpoint so
  // the owner can see who's active (admin console → Usage). The worker keeps
  // the data and gates reads behind an ADMIN_TOKEN, so this stays owner-only.
  // Set TELEMETRY_ENABLED to false to turn all of it off in a build you ship.
  // When it's on, every user is shown a one-time notice that usage is recorded.
  const TELEMETRY_ENABLED = true;
  const TELEMETRY_ENDPOINT = OPENAI_PROXY; // same worker; blank disables tracking
  // Leftovers from the removed Gemini support, deleted on startup so an old
  // Gemini key doesn't linger in this site's storage.
  (function purgeGeminiLeftovers() {
    ['gpa_gemini_api_key', 'gpa_ai_provider'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  })();
  // Tells the AI what it is and what the console can do, so questions like
  // "what can you do?" get a real answer. Injected into the chat-facing
  // system prompts (Ask AI + page Q&A), not into the JSON-only ones.
  const CAPABILITIES_BRIEF = [
    'ABOUT YOU: You are the AI inside "Agent Console", a floating assistant panel the user runs on any web page.',
    'Its features: PAGE INSIGHTS — reads the current page\'s text and/or a screenshot, summarizes, analyzes, answers questions about the page, solves quizzes and multiple-choice questions found on the page (answer grid with highlights on the page), auto-fills form fields with mock values, extracts tables to CSV, watches the page for changes the user cares about, and follows natural-language page commands like "click the third link".',
    'ASK AI — general chat like this conversation, with voice input and spoken answers.',
    'MUSIC — plays songs via YouTube search, SoundCloud links, or a local audio library.',
    'BROWSER — embeds other sites in a frame, plus research mode that reads sources automatically and writes a cited brief.',
    'STUDY — generates flashcard decks from the current page with spaced practice.',
    'NOTES — the user pastes a passage; the AI reads it, researches it across the web, writes organized study notes, and then remembers the passage, notes and research so follow-up questions about the text are answered with full context.',
    'SAVED — saved insights, an autosaved scratchpad, and a pomodoro timer.',
    'When the user asks what you can do, describe these features briefly and naturally and point them to the right tab. You do not automatically see the page text in this conversation — for page-specific questions, Page Insights is the tab to use.'
  ].join(' ');
  const SPEED_KEY = 'gpa_type_speed';
  const FONT_KEY = 'gpa_response_font';
  const ICON_KEY = 'gpa_mini_icon';
  const ICON_LOOK_KEY = 'gpa_mini_look';
  const ICON_COLOR_MODE_KEY = 'gpa_mini_color_mode';
  const PANEL_SIZE_KEY = 'gpa_panel_size';
  const PANEL_SIZES = {
    compact: { w: 300, h: 400 },
    normal: { w: 360, h: 480 },
    large: { w: 420, h: 560 },
    xl: { w: 480, h: 640 }
  };
  // "Full" isn't a fixed entry in PANEL_SIZES since it has to track whatever
  // the viewport actually is right now, not a stored pixel size — this is
  // the new full-page "app" surface, computed live rather than cached.
  const FULL_MARGIN = 16;
  function sizeFor(key) {
    if (key === 'full') {
      return {
        w: Math.max(360, window.innerWidth - FULL_MARGIN * 2),
        h: Math.max(400, window.innerHeight - FULL_MARGIN * 2)
      };
    }
    return PANEL_SIZES[key] || PANEL_SIZES.normal;
  }
  const PARTICLE_KEY = 'gpa_particle_style';
  const PARTICLE_SIZE_KEY = 'gpa_particle_margin';
  let PARTICLE_PANEL_W = PANEL_SIZES.normal.w;
  let PARTICLE_PANEL_H = PANEL_SIZES.normal.h;
  const YT_STORAGE_KEY = 'gpa_youtube_api_key';
  const THEME_KEY = 'gpa_theme';
  const CUSTOM_COLOR_KEY = 'gpa_custom_accent';
  const MAX_PAGE_CHARS = 18000;
  const MAX_IMAGE_WIDTH = 1280;

  // Preloaded music library — pulled straight from your GitHub repo. Add
  // audio files to your repo, then list them here as raw.githubusercontent.com
  // URLs (open the file on GitHub, click "Raw", copy that URL). These stream
  // directly via a normal <audio> element — no fetch/download step needed —
  // so this only works if the repo (or at least this folder) is PUBLIC.
  // Example:
  //   const PRELOADED_TRACKS = [
  //     { name: 'My Song.mp3', url: 'https://raw.githubusercontent.com/USER/REPO/main/music/my-song.mp3' },
  //     { name: 'Another Track.mp3', url: 'https://raw.githubusercontent.com/USER/REPO/main/music/another.mp3' },
  //   ];
  const PRELOADED_TRACKS = [
    { name: 'Me Gusta Todo De Ti', url: 'https://raw.githubusercontent.com/viztrrx/gemini-ui/refs/heads/music/me-gusta-todo-de-ti.mp3' }
  ];

  // Prevent duplicate instances — toggle instead of re-injecting
  const existing = document.getElementById('gpa-root-host');
  if (existing) {
    existing.dispatchEvent(new CustomEvent('gpa-toggle'));
    return;
  }

  // ---- Instance lifecycle ---------------------------------------------------
  // The Reload button re-runs this whole file in place. That only works if the
  // old copy leaves nothing behind: a second set of key handlers would
  // double-fire, a second heartbeat would double-report, a second selection
  // listener would pop two bubbles. So every global side effect this instance
  // creates is registered here and undone by teardownInstance().
  //
  // Listeners go through onWin/onDoc, which attach an AbortSignal — one abort()
  // removes all of them at once, including anonymous handlers that could never
  // be removed individually. Intervals go through the shadowed setInterval
  // below, so none can be missed.
  const gpaAbort = new AbortController();
  function withSig(opts) {
    if (opts === true) return { capture: true, signal: gpaAbort.signal };
    if (opts && typeof opts === 'object') return { ...opts, signal: gpaAbort.signal };
    return { signal: gpaAbort.signal };
  }
  function onWin(type, fn, opts) { window.addEventListener(type, fn, withSig(opts)); }
  function onDoc(type, fn, opts) { document.addEventListener(type, fn, withSig(opts)); }

  // Deliberately shadows the globals for this whole file so every repeating
  // timer is tracked without touching the call sites. Ids stay real, so
  // clearInterval elsewhere keeps working.
  const gpaIntervals = new Set();
  const setInterval = function (fn, ms, ...rest) {
    const id = window.setInterval(fn, ms, ...rest);
    gpaIntervals.add(id);
    return id;
  };
  const clearInterval = function (id) { gpaIntervals.delete(id); return window.clearInterval(id); };
  // Anything else an instance starts (observers, animation loops, media-query
  // listeners) registers its undo here; teardownInstance() runs them all.
  const gpaCleanups = [];
  let gpsRefreshAll = null; // set by the settings module; used after a profile restore

  // Holds the mounted Welcome-pane 3D scene (declared early since applyTheme,
  // called during initial setup, reads it via updateWelcome3dColor()).
  let gpaWelcome3d = null; // { renderer, scene, camera, mesh, raf } once mounted

  // ---- Theme engine ---------------------------------------------------
  // A theme is a palette of design tokens. The eight core keys (bg, panel,
  // field, text, sub, accent, accentFg, border) are read directly all over
  // this file (canvases, inline styles, games), so they stay plain #rrggbb.
  // The extended keys are optional and derived by resolveTheme() when a theme
  // leaves them out:
  //   bg2      secondary background (sidebar wells, preview floors)
  //   accent2  secondary accent (gradients, 3D highlights)
  //   glow     halo color around the panel and focused surfaces
  //   particle ambient particle color
  //   atmos    CSS background-image layered over the panel background
  // Nothing in the stylesheet reads a theme directly any more: applyTheme()
  // turns the resolved tokens into CSS custom properties on :host, so a theme
  // change is one small style write instead of rebuilding ~1,100 lines of CSS.
  const THEMES = {
    dark:      { bg: '#0b0b0f', panel: '#16161c', field: '#1e1e26', text: '#eaeaf0', sub: '#9a9aa8', accent: '#5b8cff', accentFg: '#ffffff', border: '#26262f' },
    matte:     { bg: '#131313', panel: '#1a1a1a', field: '#222222', text: '#e6e6e6', sub: '#9c9c9c', accent: '#b0b0b0', accentFg: '#171717', border: '#2b2b2b' },
    red:       { bg: '#180a0a', panel: '#241010', field: '#2e1414', text: '#f5e9e9', sub: '#cf9d9d', accent: '#e5453a', accentFg: '#ffffff', border: '#3a1818' },
    blue:      { bg: '#081420', panel: '#0f1e2e', field: '#132840', text: '#e7eef7', sub: '#9db4c9', accent: '#4da3ff', accentFg: '#ffffff', border: '#1b3149' },
    purple:    { bg: '#120c1e', panel: '#1c1430', field: '#251c3d', text: '#efe9fb', sub: '#b6a8d1', accent: '#8b5cf6', accentFg: '#ffffff', border: '#2f2350' },
    pink:      { bg: '#1e0c16', panel: '#301425', field: '#3d1b30', text: '#fbe9f2', sub: '#d1a8bf', accent: '#ec4899', accentFg: '#ffffff', border: '#4a2038' },
    lightblue: { bg: '#eaf6ff', panel: '#f5fbff', field: '#ffffff', text: '#0f2740', sub: '#5b7c93', accent: '#0ea5e9', accentFg: '#ffffff', border: '#cfe8f7' },
    white:     { bg: '#ffffff', panel: '#f5f5f7', field: '#ffffff', text: '#17171a', sub: '#6b6b70', accent: '#2563eb', accentFg: '#ffffff', border: '#e1e1e6' },
    // Signature themes: each has its own atmosphere, not just a new accent.
    aurora: {
      bg: '#061318', panel: '#0a1b21', field: '#10252c', text: '#e3f6f4', sub: '#8fb5b3', accent: '#2dd4bf', accentFg: '#04201c', border: '#173238',
      bg2: '#08171c', accent2: '#a78bfa', glow: '#2dd4bf', particle: '#5eead4',
      atmos: 'radial-gradient(120% 70% at 0% 0%, rgba(45,212,191,0.16), transparent 58%), radial-gradient(90% 60% at 100% 0%, rgba(167,139,250,0.14), transparent 60%), radial-gradient(80% 50% at 60% 110%, rgba(56,189,248,0.08), transparent 70%)'
    },
    obsidian: {
      bg: '#09090b', panel: '#101012', field: '#17171a', text: '#ececee', sub: '#94949c', accent: '#e4e4e7', accentFg: '#0b0b0d', border: '#232327',
      bg2: '#0c0c0e', accent2: '#8b8b94', glow: '#ffffff', particle: '#a1a1aa',
      atmos: 'linear-gradient(180deg, rgba(255,255,255,0.045), transparent 22%), radial-gradient(70% 40% at 50% 0%, rgba(255,255,255,0.05), transparent 70%)'
    },
    arctic: {
      bg: '#edf3f8', panel: '#f6f9fc', field: '#ffffff', text: '#0e1a28', sub: '#46596e', accent: '#2563eb', accentFg: '#ffffff', border: '#d3dee9',
      bg2: '#e4edf5', accent2: '#0891b2', glow: '#60a5fa', particle: '#38bdf8',
      atmos: 'radial-gradient(100% 70% at 100% 0%, rgba(56,189,248,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0) 40%)'
    },
    solar: {
      bg: '#140c05', panel: '#1c1209', field: '#27190c', text: '#f7ecdd', sub: '#c9ab86', accent: '#f59e0b', accentFg: '#1c1003', border: '#3a2711',
      bg2: '#180f07', accent2: '#f43f5e', glow: '#f59e0b', particle: '#fbbf24',
      atmos: 'radial-gradient(120% 70% at 50% -12%, rgba(245,158,11,0.2), transparent 58%), radial-gradient(70% 50% at 100% 100%, rgba(244,63,94,0.1), transparent 70%)'
    },
    midnight: {
      bg: '#050914', panel: '#0a1122', field: '#101a31', text: '#e5ebff', sub: '#94a1c4', accent: '#7c93ff', accentFg: '#060b1c', border: '#1a2542',
      bg2: '#070d1b', accent2: '#38bdf8', glow: '#7c93ff', particle: '#c7d2fe',
      atmos: 'radial-gradient(140% 80% at 50% 120%, rgba(124,147,255,0.16), transparent 60%), linear-gradient(180deg, rgba(20,33,74,0.55), transparent 45%)'
    },
    nebula: {
      bg: '#0c0615', panel: '#140b21', field: '#1d112f', text: '#f4eaff', sub: '#b8a4d6', accent: '#c084fc', accentFg: '#1a0b2b', border: '#2e1b47',
      bg2: '#10081b', accent2: '#f472b6', glow: '#c084fc', particle: '#e9d5ff',
      atmos: 'radial-gradient(80% 60% at 12% 18%, rgba(192,132,252,0.2), transparent 62%), radial-gradient(70% 55% at 88% 82%, rgba(244,114,182,0.14), transparent 66%), radial-gradient(40% 30% at 70% 20%, rgba(129,140,248,0.1), transparent 70%)'
    }
  };
  // Display names and gallery grouping. Order here is gallery order.
  const THEME_META = {
    aurora: { name: 'Aurora', group: 'signature', blurb: 'Teal and violet light over deep water' },
    obsidian: { name: 'Obsidian', group: 'signature', blurb: 'Near-black, restrained highlights' },
    arctic: { name: 'Arctic', group: 'signature', blurb: 'Cool, clean and bright' },
    solar: { name: 'Solar', group: 'signature', blurb: 'Warm amber on dark bronze' },
    midnight: { name: 'Midnight', group: 'signature', blurb: 'Deep navy, cinematic blue' },
    nebula: { name: 'Nebula', group: 'signature', blurb: 'Violet and rose haze' },
    matte: { name: 'Matte Black', group: 'classic' },
    dark: { name: 'Dark', group: 'classic' },
    red: { name: 'Red', group: 'classic' },
    blue: { name: 'Blue', group: 'classic' },
    purple: { name: 'Purple', group: 'classic' },
    pink: { name: 'Pink', group: 'classic' },
    lightblue: { name: 'Light Blue', group: 'classic' },
    white: { name: 'White', group: 'classic' },
    custom: { name: 'Custom', group: 'custom', blurb: 'Your own palette' }
  };

  // ---- Color math (hex in, hex out) ----
  function normHex(h) {
    if (typeof h !== 'string') return null;
    let s = h.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
  }
  function hexRgb(h) {
    const n = parseInt((normHex(h) || '#000000').slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbHex(c) {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + f(c.r) + f(c.g) + f(c.b);
  }
  // t = 0 gives a, t = 1 gives b; values past 1 extrapolate (clamped).
  function mixHex(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b);
    return rgbHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  }
  function rgbaHex(h, a) { const c = hexRgb(h); return `rgba(${c.r},${c.g},${c.b},${a})`; }
  function hexLum(h) {
    const c = hexRgb(h);
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function contrastRatio(a, b) {
    const x = hexLum(a), y = hexLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function readableOn(h) { return contrastRatio(h, '#ffffff') >= contrastRatio(h, '#0b0b0f') ? '#ffffff' : '#0b0b0f'; }
  function rotateHue(h, deg) {
    const { r, g, b } = hexRgb(h);
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
    let hh = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      hh = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      hh /= 6;
    }
    hh = ((hh * 360 + deg) % 360 + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const conv = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return s === 0 ? rgbHex({ r: l * 255, g: l * 255, b: l * 255 }) : rgbHex({ r: conv(hh + 1 / 3) * 255, g: conv(hh) * 255, b: conv(hh - 1 / 3) * 255 });
  }

  // ---- Custom theme (the builder in Settings → Colors) ----
  // Stored as JSON. Older builds only stored one accent (gpa_custom_accent);
  // that is migrated into a full custom theme on first load.
  const CUSTOM_THEME_KEY = 'gpa_custom_theme';
  const CUSTOM_FIELDS = ['bg', 'panel', 'text', 'accent', 'accent2', 'glow', 'border', 'particle'];
  function customThemeFrom(src) {
    const base = { ...THEMES.dark };
    const c = {};
    CUSTOM_FIELDS.forEach((k) => { const v = normHex(src && src[k]); if (v) c[k] = v; });
    const bg = c.bg || base.bg, panel = c.panel || base.panel, text = c.text || base.text, accent = c.accent || base.accent;
    return {
      bg, panel, text, accent,
      field: mixHex(panel, text, 0.06),
      sub: mixHex(text, bg, 0.38),
      border: c.border || mixHex(panel, text, 0.12),
      accentFg: readableOn(accent),
      accent2: c.accent2 || rotateHue(accent, 40),
      glow: c.glow || accent,
      particle: c.particle || accent
    };
  }
  function loadCustomTheme() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') {
      // Migration from the single-accent custom color.
      raw = { accent: normHex(localStorage.getItem(CUSTOM_COLOR_KEY)) || '#8b5cf6' };
    }
    return customThemeFrom(raw);
  }
  function customThemeSource() {
    try { const raw = JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY) || 'null'); if (raw && typeof raw === 'object') return raw; } catch (e) { /* fall through */ }
    return { accent: normHex(localStorage.getItem(CUSTOM_COLOR_KEY)) || '#8b5cf6' };
  }
  THEMES.custom = loadCustomTheme();

  // Fills in every extended token a theme didn't specify.
  function resolveTheme(name) {
    const t = THEMES[name] || THEMES.matte;
    return {
      ...t,
      bg2: t.bg2 || mixHex(t.bg, t.panel, 0.5),
      accent2: t.accent2 || rotateHue(t.accent, 40),
      glow: t.glow || t.accent,
      particle: t.particle || t.accent,
      atmos: t.atmos || 'none'
    };
  }

  // ---- Panel appearance (Settings → Panel) ----
  // Independent of the theme, so it survives theme switches. Every value is
  // clamped to a range that keeps the UI legible and clickable.
  const APPEARANCE_KEY = 'gpa_appearance';
  const APPEARANCE_DEFAULTS = { radius: 100, opacity: 100, blur: 0, border: 100, shadow: 60, glow: 15, density: 'comfortable' };
  const APPEARANCE_LIMITS = { radius: [30, 170], opacity: [70, 100], blur: [0, 24], border: [0, 160], shadow: [0, 100], glow: [0, 100] };
  const DENSITY_SCALE = { compact: 0.8, comfortable: 1, spacious: 1.2 };
  function loadAppearance() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    const out = { ...APPEARANCE_DEFAULTS };
    Object.keys(APPEARANCE_LIMITS).forEach((k) => {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = Math.max(APPEARANCE_LIMITS[k][0], Math.min(APPEARANCE_LIMITS[k][1], v));
    });
    if (DENSITY_SCALE[raw.density]) out.density = raw.density;
    return out;
  }
  let appearance = loadAppearance();

  // Turns resolved tokens + appearance into the CSS custom properties the
  // stylesheet uses. Colors that need alpha variants are written with
  // color-mix() in the stylesheet itself, so only base values live here.
  function tokenCss(tk, ap) {
    const op = ap.opacity / 100;
    const s = ap.shadow / 100, g = ap.glow / 100;
    const border = ap.border === 100 ? tk.border : mixHex(tk.panel, tk.border, ap.border / 100);
    const shadow = [
      `0 ${Math.round(28 * s)}px ${Math.round(70 * s)}px rgba(0,0,0,${(0.5 * s).toFixed(3)})`,
      `0 ${Math.round(2 + 4 * s)}px ${Math.round(10 + 10 * s)}px rgba(0,0,0,${(0.18 * s).toFixed(3)})`,
      g > 0 ? `0 0 ${Math.round(60 * g)}px ${rgbaHex(tk.glow, (0.4 * g).toFixed(3))}` : '0 0 0 transparent'
    ].join(', ');
    const vars = {
      '--gpa-bg': tk.bg, '--gpa-bg2': tk.bg2, '--gpa-panel': tk.panel, '--gpa-field': tk.field,
      '--gpa-text': tk.text, '--gpa-sub': tk.sub, '--gpa-accent': tk.accent, '--gpa-accent2': tk.accent2,
      '--gpa-accent-fg': tk.accentFg, '--gpa-border': border, '--gpa-glow': tk.glow, '--gpa-particle': tk.particle,
      '--gpa-atmos': tk.atmos,
      '--gpa-bg-t': op < 1 ? rgbaHex(tk.bg, op) : tk.bg,
      '--gpa-panel-t': op < 1 ? rgbaHex(tk.panel, op) : tk.panel,
      '--gpa-card-bg': op < 1 ? rgbaHex(tk.panel, Math.min(1, op + 0.12)) : tk.panel,
      '--gpa-panel-shadow': shadow,
      '--gpa-mini-shadow': `0 ${Math.round(14 * s)}px ${Math.round(30 * s)}px rgba(0,0,0,${(0.55 * s).toFixed(3)})` + (g > 0 ? `, 0 0 ${Math.round(28 * g)}px ${rgbaHex(tk.glow, (0.45 * g).toFixed(3))}` : ''),
      '--gpa-panel-blur': ap.blur > 0 && op < 1 ? `blur(${ap.blur}px) saturate(1.35)` : 'none',
      '--gpa-rs': (ap.radius / 100).toFixed(2),
      '--gpa-dz': String(DENSITY_SCALE[ap.density] || 1),
      '--gpa-scheme': hexLum(tk.bg) > 0.5 ? 'light' : 'dark'
    };
    return ':host{' + Object.keys(vars).map((k) => `${k}:${vars[k]};`).join('') + 'color-scheme:' + vars['--gpa-scheme'] + ';}';
  }

  let theme = localStorage.getItem(THEME_KEY) || 'matte';
  const savedCustomAccent = THEMES.custom.accent;
  if (!THEMES[theme]) theme = 'matte';


  // ---- Settings control center: static building blocks --------------------
  // Declared before panel.innerHTML because the Settings markup interpolates
  // them. Everything visual here reads the theme's CSS custom properties, so
  // previews re-color themselves with zero JS when a theme changes.
  let onThemeApplied = null; // set by the settings module once it exists
  const gpsSvg = (body, extra) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra || ''}>${body}</svg>`;
  const GPS_ICONS = {
    search: gpsSvg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    overview: gpsSvg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>'),
    theme: gpsSvg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 3.5a8.5 8.5 0 0 1 0 17" fill="currentColor" stroke="none"/>'),
    colors: gpsSvg('<path d="M12 3.2c3.2 3.8 5.8 7 5.8 10.2a5.8 5.8 0 0 1-11.6 0C6.2 10.2 8.8 7 12 3.2z"/><path d="M9.2 14.2a2.8 2.8 0 0 0 2.8 2.8"/>'),
    panel: gpsSvg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M8.5 9v10.5"/>'),
    effects: gpsSvg('<path d="M12 3.5l1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6 5-1.6z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
    type: gpsSvg('<path d="M4 18L9 5.5h.2L14 18M5.8 13.5h6.6"/><path d="M16.5 10.5a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM19.3 10.5V18"/>'),
    icon: gpsSvg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>'),
    ai: gpsSvg('<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>'),
    controls: gpsSvg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>'),
    account: gpsSvg('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>'),
    advanced: gpsSvg('<path d="M12 3.5l7 3v5.2c0 4.3-2.9 7.6-7 8.8-4.1-1.2-7-4.5-7-8.8V6.5z"/><path d="M9.2 12.2l2 2 3.8-4"/>'),
    arrow: gpsSvg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    reset: gpsSvg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4.5H9"/>'),
    play: gpsSvg('<path d="M8 5.5v13l10.5-6.5z"/>'),
    off: gpsSvg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
    snow: gpsSvg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>'),
    bubbles: gpsSvg('<circle cx="9" cy="14" r="5"/><circle cx="17" cy="7.5" r="3"/><circle cx="18" cy="16.5" r="1.8"/>'),
    star: gpsSvg('<path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/>'),
    network: gpsSvg('<circle cx="5.5" cy="7" r="1.8"/><circle cx="18.5" cy="6" r="1.8"/><circle cx="12" cy="13" r="1.8"/><circle cx="6.5" cy="18.5" r="1.8"/><circle cx="18" cy="17.5" r="1.8"/><path d="M7.2 7.8l3.4 3.8M16.9 7.2l-3.6 4.4M10.7 14.4l-3 2.8M13.7 13.9l2.8 2.6"/>'),
    firefly: gpsSvg('<circle cx="12" cy="12" r="2.4" fill="currentColor"/><circle cx="12" cy="12" r="6" opacity="0.45"/><circle cx="12" cy="12" r="9" opacity="0.2"/>'),
    confetti: gpsSvg('<rect x="4" y="5" width="4" height="2.6" rx="0.6" transform="rotate(-20 6 6.3)"/><rect x="15" y="4" width="4" height="2.6" rx="0.6" transform="rotate(25 17 5.3)"/><rect x="10" y="11" width="4" height="2.6" rx="0.6" transform="rotate(10 12 12.3)"/><rect x="4.5" y="16" width="4" height="2.6" rx="0.6" transform="rotate(35 6.5 17.3)"/><rect x="15.5" y="16.5" width="4" height="2.6" rx="0.6" transform="rotate(-30 17.5 17.8)"/>'),
    sparkleFill: gpsSvg('<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" fill="currentColor" stroke="none"/>'),
    boltFill: gpsSvg('<path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none"/>'),
    orbit: gpsSvg('<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9" ry="4"/>'),
    chatFill: gpsSvg('<path d="M4 4h16v11H8l-4 4z" fill="currentColor" stroke="none"/>'),
    check: gpsSvg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
    warn: gpsSvg('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>')
  };
  // A miniature Agent Console built from plain divs. Sized in em, so one
  // font-size (--mc) scales the whole thing; colored entirely by the theme
  // variables, so a scoped override of those variables re-themes just it.
  function gpsMiniConsole() {
    return '<div class="gps-mc" aria-hidden="true">'
      + '<div class="gps-mc-head"><i></i><i></i><i></i><span></span></div>'
      + '<div class="gps-mc-body"><div class="gps-mc-side"><b class="on"></b><b></b><b></b><b></b><b></b></div>'
      + '<div class="gps-mc-main"><div class="gps-mc-line w55 strong"></div><div class="gps-mc-line w35"></div>'
      + '<div class="gps-mc-card"><div class="gps-mc-line w80"></div><div class="gps-mc-line w65"></div><div class="gps-mc-line w40"></div></div>'
      + '<div class="gps-mc-row"><div class="gps-mc-btn"></div><div class="gps-mc-chip"></div><div class="gps-mc-chip"></div></div>'
      + '<div class="gps-mc-bubble"></div></div></div></div>';
  }
  // A small CSS-3D cube tinted with the accent pair.
  function gpsCube() {
    return '<div class="gps-cube" aria-hidden="true"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></div>';
  }
  const GPS_CSS = `
      /* ===== Settings control center ======================================
         Design system (all values below derive from these):
           type      11 eyebrow · 12 hint · 13 body/label · 15 section · 22 hero
           space     4 · 8 · 12 · 16 · 20 · 24 (4px rhythm)
           radius    8 · 12 · 16, multiplied by the user's --gpa-rs
           elevation e1 hairline · e2 lifted card · e3 3D stage
           motion    140ms feedback · 240ms state · 420ms scene; out-expo easing
         Colors come only from the theme tokens (--gpa-*). */
      .gps {
        --gps-r1: calc(8px * var(--gpa-rs)); --gps-r2: calc(12px * var(--gpa-rs)); --gps-r3: calc(16px * var(--gpa-rs));
        --gps-ease: cubic-bezier(0.16, 1, 0.3, 1); --gps-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
        --gps-t1: 140ms; --gps-t2: 240ms; --gps-t3: 420ms;
        --gps-line: color-mix(in srgb, var(--gpa-border) 100%, transparent);
        --gps-soft: color-mix(in srgb, var(--gpa-text) 6%, transparent);
        --gps-e1: 0 1px 0 color-mix(in srgb, var(--gpa-text) 5%, transparent) inset;
        --gps-e2: 0 1px 0 color-mix(in srgb, var(--gpa-text) 6%, transparent) inset, 0 10px 28px -12px rgba(0,0,0,0.45);
        container: gps / inline-size;
        display: flex; flex-direction: column; gap: 16px;
        color: var(--gpa-text); font-size: 13px; line-height: 1.45;
        padding-bottom: 24px;
      }
      .gps svg { width: 18px; height: 18px; flex-shrink: 0; }
      .gps button { font-family: inherit; }
      .gps :focus-visible { outline: 2px solid var(--gpa-accent); outline-offset: 2px; }
      .gps-eyebrow {
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gpa-sub);
      }
      .gps-h { margin: 2px 0 0; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; }

      /* Top bar + search */
      .gps-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .gps-search {
        display: flex; align-items: center; gap: 8px; flex: 0 1 300px; min-width: 200px; height: 40px; padding: 0 12px;
        border-radius: var(--gps-r2); background: var(--gpa-field); border: 1px solid var(--gpa-border); color: var(--gpa-sub);
        transition: border-color var(--gps-t1) ease, box-shadow var(--gps-t1) ease;
      }
      .gps-search:focus-within { border-color: var(--gpa-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 22%, transparent); }
      .gps-search input {
        flex: 1; min-width: 0; height: 100%; background: none; border: none; outline: none;
        color: var(--gpa-text); font-size: 13px; font-family: inherit;
      }
      .gps-search input::placeholder { color: var(--gpa-sub); }
      .gps-search input::-webkit-search-cancel-button { filter: grayscale(1); }
      .gps-search kbd {
        font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; line-height: 1; padding: 3px 6px;
        border-radius: 5px; border: 1px solid var(--gpa-border); color: var(--gpa-sub);
      }

      /* Layout: vertical rail on wide panels, chip grid on narrow ones */
      .gps-layout { display: grid; grid-template-columns: 188px minmax(0, 1fr); gap: 20px; align-items: start; }
      .gps-nav {
        position: sticky; top: 0; z-index: 2; display: flex; flex-direction: column; gap: 2px; padding: 6px;
        border-radius: var(--gps-r3); border: 1px solid var(--gpa-border);
        background: color-mix(in srgb, var(--gpa-panel) 88%, transparent); box-shadow: var(--gps-e1);
      }
      .gps-tab {
        position: relative; display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 10px;
        border: none; border-radius: var(--gps-r1); background: transparent; color: var(--gpa-sub);
        font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;
        transition: background var(--gps-t1) ease, color var(--gps-t1) ease;
      }
      .gps-tab:hover { background: var(--gps-soft); color: var(--gpa-text); }
      .gps-tab[aria-selected="true"] { color: var(--gpa-text); background: color-mix(in srgb, var(--gpa-accent) 14%, transparent); }
      .gps-tab[aria-selected="true"]::before {
        content: ''; position: absolute; left: -6px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0;
        background: var(--gpa-accent); box-shadow: 0 0 10px var(--gpa-accent);
      }
      .gps-tab[aria-selected="true"] svg { color: var(--gpa-accent); }
      .gps-content { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

      /* Sections */
      .gps-sec { display: none; flex-direction: column; gap: 12px; }
      .gps-sec.active { display: flex; animation: gps-in var(--gps-t2) var(--gps-ease) both; }
      @keyframes gps-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      .gps-sec-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 2px 2px 4px; }
      .gps-sec-title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; }
      .gps-sec-desc { margin: 2px 0 0; color: var(--gpa-sub); font-size: 12px; }
      .gps-item {
        display: flex; flex-direction: column; gap: 10px; padding: calc(14px * var(--gpa-dz)) 16px;
        border-radius: var(--gps-r3); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg); box-shadow: var(--gps-e1);
      }
      .gps-item-row { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
      .gps-item-flush { padding: 0; border: none; background: none; box-shadow: none; }
      .gps-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--gpa-text); }
      .gps-label output { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; font-weight: 500; color: var(--gpa-sub); font-variant-numeric: tabular-nums; }
      .gps-hint { margin: 2px 0 0; font-size: 12px; line-height: 1.45; color: var(--gpa-sub); }
      .gps-note { padding: 0 4px; }
      .gps-tag { font-size: 11px; font-weight: 500; color: var(--gpa-sub); }
      .gps-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .gps-row > .gpa-input { min-width: 140px; }

      /* Buttons */
      .gps-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 0 14px;
        border-radius: var(--gps-r2); border: 1px solid var(--gpa-border); background: var(--gpa-field); color: var(--gpa-text);
        font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer;
        transition: border-color var(--gps-t1) ease, background var(--gps-t1) ease, transform var(--gps-t1) ease, box-shadow var(--gps-t1) ease;
      }
      .gps-btn:hover { border-color: color-mix(in srgb, var(--gpa-accent) 55%, var(--gpa-border)); }
      .gps-btn:active { transform: scale(0.97); }
      .gps-btn svg { width: 16px; height: 16px; }
      .gps-btn-primary { background: var(--gpa-accent); border-color: var(--gpa-accent); color: var(--gpa-accent-fg); }
      .gps-btn-primary:hover { box-shadow: 0 6px 20px -6px var(--gpa-accent); border-color: var(--gpa-accent); }
      .gps-btn-danger { color: #f87171; border-color: color-mix(in srgb, #ef4444 45%, var(--gpa-border)); background: color-mix(in srgb, #ef4444 8%, var(--gpa-field)); }
      .gps-btn-danger:hover { border-color: #ef4444; background: color-mix(in srgb, #ef4444 16%, var(--gpa-field)); }
      .gps-reset {
        display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; flex-shrink: 0;
        border-radius: var(--gps-r1); border: 1px solid transparent; background: transparent; color: var(--gpa-sub);
        font-size: 12px; font-weight: 500; cursor: pointer; transition: color var(--gps-t1) ease, background var(--gps-t1) ease;
      }
      .gps-reset:hover { color: var(--gpa-text); background: var(--gps-soft); }
      .gps-reset svg { width: 15px; height: 15px; }

      /* Sliders: filled track driven by --p (set from JS) */
      .gps-range {
        -webkit-appearance: none; appearance: none; width: 100%; height: 28px; margin: 0; background: transparent; cursor: pointer;
        --p: 50%;
      }
      .gps-range::-webkit-slider-runnable-track {
        height: 6px; border-radius: 999px;
        background: linear-gradient(to right, var(--gpa-accent) var(--p), color-mix(in srgb, var(--gpa-text) 14%, transparent) var(--p));
      }
      .gps-range::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 18px; height: 18px; margin-top: -6px; border-radius: 50%;
        background: #ffffff; border: 3px solid var(--gpa-accent);
        box-shadow: 0 2px 8px rgba(0,0,0,0.35); transition: transform var(--gps-t1) var(--gps-spring);
      }
      .gps-range:active::-webkit-slider-thumb { transform: scale(1.15); }
      .gps-range::-moz-range-track { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--gpa-text) 14%, transparent); }
      .gps-range::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--gpa-accent); }
      .gps-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #ffffff; border: 3px solid var(--gpa-accent); }
      .gps-range:focus-visible { outline: none; }
      .gps-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px color-mix(in srgb, var(--gpa-accent) 35%, transparent); }

      /* Segmented control (also hosts the legacy speed/look/color/lang buttons) */
      .gps-seg {
        display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; padding: 4px;
        border-radius: var(--gps-r2); background: var(--gpa-field); border: 1px solid var(--gpa-border);
      }
      .gps .gps-seg-btn {
        min-height: 34px; padding: 0 8px; border: none; border-radius: var(--gps-r1); background: transparent; color: var(--gpa-sub);
        font-size: 13px; font-weight: 500; cursor: pointer; flex: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: background var(--gps-t2) var(--gps-ease), color var(--gps-t1) ease, box-shadow var(--gps-t2) ease;
      }
      .gps .gps-seg-btn:hover { color: var(--gpa-text); background: var(--gps-soft); }
      .gps .gps-seg-btn.primary {
        color: var(--gpa-text); background: var(--gpa-card-bg); border-color: transparent;
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--gpa-accent) 55%, transparent), 0 4px 12px -6px rgba(0,0,0,0.5);
      }

      /* Choice tiles (particles, fonts, glyphs) */
      .gps-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
      .gps-choices-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .gps-choices-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      .gps .gps-choices > button {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 72px; padding: 10px 6px;
        border-radius: var(--gps-r2); border: 1px solid var(--gpa-border); background: var(--gpa-field); color: var(--gpa-sub);
        font-size: 12px; font-weight: 500; cursor: pointer; flex: none;
        transition: border-color var(--gps-t1) ease, background var(--gps-t2) ease, color var(--gps-t1) ease, transform var(--gps-t2) var(--gps-spring);
      }
      .gps .gps-choices > button:hover { color: var(--gpa-text); border-color: color-mix(in srgb, var(--gpa-accent) 45%, var(--gpa-border)); transform: translateY(-1px); }
      .gps .gps-choices > button.primary {
        color: var(--gpa-text); border-color: var(--gpa-accent);
        background: linear-gradient(160deg, color-mix(in srgb, var(--gpa-accent) 16%, var(--gpa-field)), var(--gpa-field));
        box-shadow: 0 8px 22px -12px var(--gpa-accent);
      }
      .gps-glyph { display: grid; place-items: center; width: 28px; height: 28px; color: var(--gpa-sub); transition: color var(--gps-t1) ease; }
      .gps-glyph svg { width: 22px; height: 22px; }
      .gps-glyph-txt { font-size: 18px; font-weight: 700; font-family: 'Geist Mono', ui-monospace, monospace; }
      .gps .gps-choices > button.primary .gps-glyph { color: var(--gpa-accent); }
      .gps-aa { font-size: 22px; font-weight: 600; line-height: 28px; color: var(--gpa-text); }
      .gps-aa-mono { font-family: 'Geist Mono', ui-monospace, monospace; }

      /* Switch (voice, auto-run). The button's own text stays for screen readers. */
      .gps-switch {
        position: relative; flex-shrink: 0; width: 46px; height: 28px; padding: 0; border-radius: 999px;
        border: 1px solid var(--gpa-border); background: var(--gpa-field); color: transparent; font-size: 0; cursor: pointer;
        transition: background var(--gps-t2) ease, border-color var(--gps-t2) ease;
      }
      .gps-switch::after {
        content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
        background: var(--gpa-sub); box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        transition: transform var(--gps-t2) var(--gps-spring), background var(--gps-t2) ease;
      }
      .gps-switch.primary { background: var(--gpa-accent); border-color: var(--gpa-accent); }
      .gps-switch.primary::after { transform: translateX(18px); background: var(--gpa-accent-fg); }

      .gps-badge {
        display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; min-height: 26px; padding: 0 10px; border-radius: 999px;
        font-size: 12px; font-weight: 600; font-family: 'Geist Mono', ui-monospace, monospace;
        background: var(--gpa-field); border: 1px solid var(--gpa-border); color: var(--gpa-text);
      }
      .gps-badge::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--gpa-sub); }
      .gps-badge.ok::before { background: #34d399; box-shadow: 0 0 8px #34d399; }
      .gps-badge.warn::before { background: #fbbf24; }
      .gps-badge.off::before { background: var(--gpa-sub); }

      /* ---- 3D: miniature console ---- */
      .gps-mc {
        --mc: 10px; font-size: var(--mc); position: relative; width: 100%; aspect-ratio: 16 / 10.5;
        display: flex; flex-direction: column; overflow: hidden;
        border-radius: calc(1.1em * var(--gpa-rs)); border: 1px solid var(--gpa-border);
        background: var(--gpa-atmos), var(--gpa-bg);
        box-shadow: 0 2.4em 4.8em -1.6em rgba(0,0,0,0.65), 0 0 3.2em -1em var(--gpa-glow), inset 0 1px 0 color-mix(in srgb, var(--gpa-text) 8%, transparent);
      }
      .gps-mc-head { display: flex; align-items: center; gap: 0.35em; height: 1.9em; padding: 0 0.8em; flex-shrink: 0; background: var(--gpa-panel); border-bottom: 1px solid var(--gpa-border); }
      .gps-mc-head i { width: 0.5em; height: 0.5em; border-radius: 50%; background: color-mix(in srgb, var(--gpa-sub) 70%, transparent); }
      .gps-mc-head span { margin-left: 0.6em; width: 28%; height: 0.45em; border-radius: 1em; background: color-mix(in srgb, var(--gpa-text) 30%, transparent); }
      .gps-mc-body { flex: 1; display: flex; min-height: 0; }
      .gps-mc-side { width: 22%; padding: 0.7em 0.55em; display: flex; flex-direction: column; gap: 0.4em; background: var(--gpa-panel); border-right: 1px solid var(--gpa-border); }
      .gps-mc-side b { height: 0.75em; border-radius: calc(0.3em * var(--gpa-rs)); background: color-mix(in srgb, var(--gpa-text) 10%, transparent); }
      .gps-mc-side b.on { background: var(--gpa-accent); box-shadow: 0 0 0.8em -0.1em var(--gpa-accent); }
      .gps-mc-main { flex: 1; min-width: 0; padding: 0.8em; display: flex; flex-direction: column; gap: 0.5em; }
      .gps-mc-line { height: 0.45em; border-radius: 1em; background: color-mix(in srgb, var(--gpa-text) 20%, transparent); }
      .gps-mc-line.strong { height: 0.65em; background: color-mix(in srgb, var(--gpa-text) 55%, transparent); }
      .gps-mc-line.w80 { width: 80%; } .gps-mc-line.w65 { width: 65%; } .gps-mc-line.w55 { width: 55%; } .gps-mc-line.w40 { width: 40%; } .gps-mc-line.w35 { width: 35%; }
      .gps-mc-card { display: flex; flex-direction: column; gap: 0.4em; padding: 0.65em; border-radius: calc(0.6em * var(--gpa-rs)); background: var(--gpa-field); border: 1px solid var(--gpa-border); }
      .gps-mc-row { display: flex; gap: 0.4em; }
      .gps-mc-btn { width: 30%; height: 1.2em; border-radius: calc(0.4em * var(--gpa-rs)); background: linear-gradient(135deg, var(--gpa-accent), color-mix(in srgb, var(--gpa-accent) 70%, var(--gpa-accent2))); }
      .gps-mc-chip { width: 16%; height: 1.2em; border-radius: 1em; border: 1px solid color-mix(in srgb, var(--gpa-accent) 50%, transparent); }
      .gps-mc-bubble { margin-top: auto; align-self: flex-end; width: 42%; height: 1.3em; border-radius: 0.8em 0.8em 0.2em 0.8em; background: color-mix(in srgb, var(--gpa-accent) 85%, transparent); }

      /* ---- 3D: stage (perspective scene with floor grid, tilt, parallax layers) ---- */
      .gps-stage {
        position: relative; height: 240px; display: grid; place-items: center; overflow: hidden; isolation: isolate;
        perspective: 900px; perspective-origin: 50% 35%;
        border-radius: var(--gps-r3); border: 1px solid var(--gpa-border);
        background: radial-gradient(90% 70% at 50% 0%, color-mix(in srgb, var(--gpa-glow) 16%, transparent), transparent 70%), var(--gpa-bg2);
        --rx: 0deg; --ry: 0deg;
      }
      .gps-stage-wide { height: 300px; }
      .gps-stage-compact { height: 210px; }
      .gps-floor {
        position: absolute; left: -30%; right: -30%; bottom: -55%; height: 110%; z-index: -1; pointer-events: none;
        transform: rotateX(78deg); transform-origin: 50% 0%;
        background:
          repeating-linear-gradient(90deg, color-mix(in srgb, var(--gpa-text) 9%, transparent) 0 1px, transparent 1px 38px),
          repeating-linear-gradient(0deg, color-mix(in srgb, var(--gpa-text) 9%, transparent) 0 1px, transparent 1px 38px);
        -webkit-mask-image: radial-gradient(60% 55% at 50% 0%, #000, transparent 75%); mask-image: radial-gradient(60% 55% at 50% 0%, #000, transparent 75%);
      }
      .gps-rig {
        position: relative; width: min(320px, 68%); transform-style: preserve-3d;
        transform: rotateX(calc(16deg + var(--ry))) rotateY(calc(-20deg + var(--rx)));
        transition: transform 700ms var(--gps-ease);
        animation: gps-bob 7s ease-in-out infinite;
      }
      .gps-stage-wide .gps-rig { width: min(360px, 56%); }
      @keyframes gps-bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }
      .gps-rig .gps-mc { transform: translateZ(0); }
      .gps-float { position: absolute; transform-style: preserve-3d; pointer-events: none; }
      .gps-float-toast {
        left: -9%; top: 18%; display: flex; align-items: center; gap: 6px; padding: 7px 10px; font-size: 10px;
        transform: translateZ(56px); border-radius: calc(10px * var(--gpa-rs));
        background: color-mix(in srgb, var(--gpa-panel) 92%, transparent); border: 1px solid var(--gpa-border);
        box-shadow: 0 14px 30px -10px rgba(0,0,0,0.6);
      }
      .gps-float-toast i { width: 8px; height: 8px; border-radius: 50%; background: var(--gpa-accent); box-shadow: 0 0 10px var(--gpa-accent); }
      .gps-float-toast span { width: 58px; height: 5px; border-radius: 4px; background: color-mix(in srgb, var(--gpa-text) 35%, transparent); }
      .gps-float-core { right: 6%; top: 14%; transform: translateZ(64px); }
      .gps-stage-cap {
        position: absolute; left: 12px; bottom: 12px; z-index: 1; display: flex; align-items: center; gap: 8px;
        padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
        background: color-mix(in srgb, var(--gpa-panel) 85%, transparent); border: 1px solid var(--gpa-border); color: var(--gpa-text);
      }
      .gps-stage-cap:empty { display: none; }

      /* ---- 3D: accent cube ---- */
      .gps-cube { --c: 40px; position: relative; width: var(--c); height: var(--c); transform-style: preserve-3d; animation: gps-cube 18s linear infinite; }
      .gps-cube i {
        position: absolute; inset: 0; border-radius: 6px;
        border: 1px solid color-mix(in srgb, var(--gpa-accent) 80%, #ffffff 20%);
        background: linear-gradient(135deg, color-mix(in srgb, var(--gpa-accent) 58%, transparent), color-mix(in srgb, var(--gpa-accent2) 30%, transparent));
        box-shadow: inset 0 0 14px color-mix(in srgb, var(--gpa-accent) 55%, transparent);
      }
      .gps-cube .f1 { transform: translateZ(calc(var(--c) / 2)); }
      .gps-cube .f2 { transform: rotateY(180deg) translateZ(calc(var(--c) / 2)); }
      .gps-cube .f3 { transform: rotateY(90deg) translateZ(calc(var(--c) / 2)); }
      .gps-cube .f4 { transform: rotateY(-90deg) translateZ(calc(var(--c) / 2)); }
      .gps-cube .f5 { transform: rotateX(90deg) translateZ(calc(var(--c) / 2)); }
      .gps-cube .f6 { transform: rotateX(-90deg) translateZ(calc(var(--c) / 2)); }
      @keyframes gps-cube { from { transform: rotateX(-22deg) rotateY(0deg); } to { transform: rotateX(-22deg) rotateY(360deg); } }

      /* ---- Overview ---- */
      .gps-hero {
        display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 20px; align-items: center; padding: 12px;
        border-radius: calc(20px * var(--gpa-rs)); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg); box-shadow: var(--gps-e2);
      }
      .gps-hero-copy { display: flex; flex-direction: column; gap: 6px; padding: 8px 8px 8px 0; min-width: 0; }
      .gps-hero-title { font-size: 22px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; }
      .gps-hero-sub { color: var(--gpa-sub); font-size: 12px; }
      .gps-hero-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .gps-palette { display: flex; margin-top: 8px; }
      .gps-palette i {
        width: 26px; height: 26px; border-radius: calc(8px * var(--gpa-rs)); border: 2px solid var(--gpa-card-bg); margin-left: -6px;
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--gpa-text) 22%, transparent), 0 4px 10px -4px rgba(0,0,0,0.5);
      }
      .gps-palette i:first-child { margin-left: 0; }
      .gps-ov-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 10px; }
      .gps-ov {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "k go" "v go" "m m"; gap: 4px 8px; align-items: center;
        min-height: 76px; padding: 14px; text-align: left; cursor: pointer; color: var(--gpa-text);
        border-radius: var(--gps-r3); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg); box-shadow: var(--gps-e1);
        transition: border-color var(--gps-t1) ease, transform var(--gps-t2) var(--gps-spring), box-shadow var(--gps-t2) ease;
      }
      .gps-ov:hover { border-color: color-mix(in srgb, var(--gpa-accent) 50%, var(--gpa-border)); transform: translateY(-2px); box-shadow: var(--gps-e2); }
      .gps-ov-k { grid-area: k; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gpa-sub); }
      .gps-ov-v { grid-area: v; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; line-height: 1.3; }
      .gps-ov-go { grid-area: go; color: var(--gpa-sub); transition: color var(--gps-t1) ease, transform var(--gps-t2) var(--gps-spring); }
      .gps-ov:hover .gps-ov-go { color: var(--gpa-accent); transform: translateX(2px); }
      .gps-ov-wide { grid-column: span 2; }
      .gps-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 2px var(--gpa-card-bg), 0 0 0 3px var(--gpa-border); }
      .gps-meter { grid-area: m; height: 5px; margin-top: 6px; border-radius: 999px; background: color-mix(in srgb, var(--gpa-text) 10%, transparent); overflow: hidden; }
      .gps-meter i { display: block; height: 100%; width: 0%; border-radius: inherit; background: linear-gradient(90deg, var(--gpa-accent), var(--gpa-accent2)); transition: width var(--gps-t3) var(--gps-ease); }

      /* ---- Theme gallery ---- */
      .gps-label + .gps-gallery { margin-top: 2px; }
      .gps-gallery { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .gps-gallery-sm { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .gps .gps-tile {
        width: auto; height: auto; display: flex; flex-direction: column; gap: 0; padding: 0; overflow: hidden; text-align: left;
        border-radius: var(--gps-r2); border: 1px solid var(--gpa-border); background: var(--gpa-panel); color: var(--gpa-text);
        font-size: 12px; font-weight: 500; cursor: pointer;
        transition: transform var(--gps-t2) var(--gps-spring), box-shadow var(--gps-t2) ease, border-color var(--gps-t1) ease;
      }
      .gps .gps-tile:hover { transform: translateY(-3px); box-shadow: 0 16px 30px -16px var(--gpa-glow), 0 12px 24px -14px rgba(0,0,0,0.6); }
      .gps .gps-tile[aria-pressed="true"] { border-color: var(--gpa-accent); box-shadow: 0 0 0 1px var(--gpa-accent), 0 14px 28px -14px var(--gpa-accent); }
      .gps-tile-scene {
        position: relative; display: grid; place-items: center; height: 96px; overflow: hidden; perspective: 500px;
        background: radial-gradient(80% 90% at 50% 0%, color-mix(in srgb, var(--gpa-glow) 22%, transparent), transparent 70%), var(--gpa-bg2);
      }
      .gps-gallery-sm .gps-tile-scene { height: 70px; }
      .gps-tile-scene .gps-mc {
        --mc: 5px; width: 74%; transform: rotateX(18deg) rotateY(-18deg) translateY(6%);
        transition: transform var(--gps-t3) var(--gps-ease);
      }
      .gps-gallery-sm .gps-tile-scene .gps-mc { --mc: 3.6px; }
      .gps .gps-tile:hover .gps-tile-scene .gps-mc { transform: rotateX(8deg) rotateY(-6deg) translateY(2%) scale(1.04); }
      .gps-tile-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--gpa-border); }
      .gps-tile-name { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .gps-tile-dots { display: flex; gap: 3px; flex-shrink: 0; }
      .gps-tile-dots i { width: 8px; height: 8px; border-radius: 50%; }
      .gps-tile-check { color: var(--gpa-accent); display: none; }
      .gps-tile[aria-pressed="true"] .gps-tile-check { display: inline-flex; }
      .gps-tile-check svg { width: 14px; height: 14px; }

      /* ---- Colors / builder ---- */
      .gps-builder { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 12px; align-items: start; }
      .gps-builder-preview { display: flex; flex-direction: column; gap: 10px; position: sticky; top: 0; }
      .gps-colors { display: flex; flex-direction: column; gap: 8px; }
      .gps-color {
        display: grid; grid-template-columns: 40px minmax(0, 1fr) 96px 32px; align-items: center; gap: 10px; padding: 8px 10px 8px 8px;
        border-radius: var(--gps-r2); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg);
      }
      .gps-swatch {
        position: relative; width: 40px; height: 40px; border-radius: calc(10px * var(--gpa-rs)); overflow: hidden; cursor: pointer;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gpa-text) 18%, transparent), 0 6px 14px -8px rgba(0,0,0,0.6);
      }
      .gps-swatch input { position: absolute; inset: -8px; width: calc(100% + 16px); height: calc(100% + 16px); opacity: 0; cursor: pointer; }
      .gps-swatch:focus-within { outline: 2px solid var(--gpa-accent); outline-offset: 2px; }
      .gps-color-name { font-size: 13px; font-weight: 600; }
      .gps-color-desc { font-size: 12px; color: var(--gpa-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .gps-hex {
        width: 100%; height: 32px; padding: 0 8px; border-radius: var(--gps-r1); border: 1px solid var(--gpa-border);
        background: var(--gpa-field); color: var(--gpa-text); font: 500 12px 'Geist Mono', ui-monospace, monospace; text-transform: lowercase;
      }
      .gps-hex:focus { outline: none; border-color: var(--gpa-accent); }
      .gps-hex[aria-invalid="true"] { border-color: #ef4444; }
      .gps-icon-btn {
        display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--gps-r1); border: 1px solid transparent;
        background: transparent; color: var(--gpa-sub); cursor: pointer;
      }
      .gps-icon-btn:hover { color: var(--gpa-text); background: var(--gps-soft); }
      .gps-icon-btn svg { width: 15px; height: 15px; }
      .gps-contrast { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--gps-r2); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg); font-size: 12px; color: var(--gpa-sub); }
      .gps-contrast b { color: var(--gpa-text); font-family: 'Geist Mono', ui-monospace, monospace; }
      .gps-contrast.warn { border-color: color-mix(in srgb, #f59e0b 60%, var(--gpa-border)); }
      .gps-contrast svg { width: 16px; height: 16px; }
      .gps-contrast.warn svg { color: #f59e0b; }
      .gps-contrast.ok svg { color: #34d399; }

      /* ---- Panel sizes ---- */
      .gps-sizes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
      .gps .gps-sizes > button {
        display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 8px; min-height: 104px; padding: 10px 4px;
        border-radius: var(--gps-r2); border: 1px solid var(--gpa-border); background: var(--gpa-field); color: var(--gpa-sub);
        font-size: 12px; font-weight: 500; cursor: pointer; flex: none; perspective: 240px;
        transition: border-color var(--gps-t1) ease, color var(--gps-t1) ease, background var(--gps-t2) ease;
      }
      .gps .gps-sizes > button:hover { color: var(--gpa-text); border-color: color-mix(in srgb, var(--gpa-accent) 45%, var(--gpa-border)); }
      .gps .gps-sizes > button.primary { color: var(--gpa-text); border-color: var(--gpa-accent); background: color-mix(in srgb, var(--gpa-accent) 10%, var(--gpa-field)); }
      .gps-sil {
        width: var(--w); height: var(--h); max-width: 100%; border-radius: calc(4px * var(--gpa-rs));
        border: 1.5px solid color-mix(in srgb, var(--gpa-text) 35%, transparent);
        background: linear-gradient(180deg, color-mix(in srgb, var(--gpa-text) 16%, transparent) 0 14%, transparent 14%), var(--gpa-bg);
        transform: rotateX(16deg); transform-origin: 50% 100%; box-shadow: 0 8px 12px -8px rgba(0,0,0,0.7);
        transition: transform var(--gps-t2) var(--gps-spring), border-color var(--gps-t1) ease, box-shadow var(--gps-t2) ease;
      }
      .gps .gps-sizes > button:hover .gps-sil { transform: rotateX(4deg) translateY(-2px); }
      .gps .gps-sizes > button.primary .gps-sil {
        border-color: var(--gpa-accent);
        background: linear-gradient(180deg, var(--gpa-accent) 0 14%, transparent 14%), color-mix(in srgb, var(--gpa-accent) 12%, var(--gpa-bg));
        box-shadow: 0 10px 18px -8px var(--gpa-accent);
      }

      /* ---- Effects ---- */
      .gps-fxstage {
        position: relative; height: 220px; overflow: hidden; display: grid; place-items: center; perspective: 800px;
        border-radius: var(--gps-r3); border: 1px solid var(--gpa-border);
        background: radial-gradient(70% 60% at 50% 40%, color-mix(in srgb, var(--gpa-glow) 10%, transparent), transparent 75%), var(--gpa-bg2);
      }
      .gps-fxstage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .gps-fx-ghost { position: relative; width: min(220px, 48%); transform: rotateX(12deg); }
      .gps-fx-ghost .gps-mc { --mc: 6px; }

      /* ---- Typography ---- */
      .gps-typeprev { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: var(--gps-r3); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg); }
      .gps-typeprev-k { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gpa-sub); }
      .gps .gps-type-sample { flex: none; margin: 0; min-height: 110px; max-height: 220px; user-select: text; }
      .gps-typeprev .gps-btn { align-self: flex-start; }

      /* ---- Icon studio ---- */
      .gps-iconstage {
        position: relative; height: 170px; overflow: hidden; border-radius: var(--gps-r3); border: 1px solid var(--gpa-border);
        background: var(--gps-page-bg, #f3f4f6);
      }
      .gps-page { position: absolute; inset: 18px 30% 18px 18px; display: flex; flex-direction: column; gap: 9px; }
      .gps-page i { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--gps-page-fg, #111827) 14%, transparent); }
      .gps-page i:nth-child(1) { width: 60%; height: 12px; background: color-mix(in srgb, var(--gps-page-fg, #111827) 26%, transparent); }
      .gps-page i:nth-child(2) { width: 92%; } .gps-page i:nth-child(3) { width: 84%; } .gps-page i:nth-child(4) { width: 70%; }
      .gps-page b { width: 42%; height: 48px; margin-top: 4px; border-radius: 8px; background: color-mix(in srgb, var(--gps-page-fg, #111827) 8%, transparent); }
      .gps-iconstage .gps-mini { position: absolute; right: 42px; bottom: 40px; scale: 1.35; cursor: default; }

      /* ---- AI ---- */
      .gps-ai {
        display: flex; align-items: center; gap: 18px; padding: 16px; border-radius: var(--gps-r3); border: 1px solid var(--gpa-border);
        background: radial-gradient(60% 120% at 0% 50%, color-mix(in srgb, var(--gpa-glow) 14%, transparent), transparent 70%), var(--gpa-card-bg);
      }
      .gps-ai-core { width: 84px; height: 84px; flex-shrink: 0; }
      .gps-ai-core svg { width: 100%; height: 100%; overflow: visible; }
      .gps-ai-core circle { fill: none; stroke: var(--gpa-accent); }
      .gps-ai-core .r1 { stroke-opacity: 0.55; stroke-width: 1.2; }
      .gps-ai-core .r2 { stroke-opacity: 0.35; stroke-width: 1; stroke-dasharray: 3 5; }
      .gps-ai-core .r3 { stroke-opacity: 0.15; stroke-width: 1; }
      .gps-ai-core .nucleus { fill: var(--gpa-accent); stroke: none; filter: drop-shadow(0 0 8px var(--gpa-accent)); }
      .gps-ai-core .orb circle, .gps-ai-core .orb2 circle { fill: var(--gpa-accent2); stroke: none; }
      .gps-ai-core .orb { transform-origin: 60px 60px; animation: gps-orbit 9s linear infinite; }
      .gps-ai-core .orb2 { transform-origin: 60px 60px; animation: gps-orbit 14s linear infinite reverse; }
      @keyframes gps-orbit { to { transform: rotate(360deg); } }
      .gps-ai-copy { min-width: 0; }
      .gps-models { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
      .gps-model {
        display: flex; flex-direction: column; gap: 4px; padding: 14px; border-radius: var(--gps-r3); border: 1px solid var(--gpa-border);
        background: var(--gpa-card-bg); box-shadow: var(--gps-e1);
      }
      .gps-model-smart {
        border-color: color-mix(in srgb, var(--gpa-accent) 45%, var(--gpa-border));
        background: linear-gradient(150deg, color-mix(in srgb, var(--gpa-accent) 12%, transparent), transparent 60%), var(--gpa-card-bg);
      }
      .gps-model-k { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gpa-sub); }
      .gps-model-v { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
      .gps-model-d { font-size: 12px; color: var(--gpa-sub); }

      /* ---- Account ---- */
      .gps-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .gps-who svg { color: var(--gpa-accent); }
      .gps-textarea { width: 100%; min-height: 64px; }
      .gps #gpa-admin { margin-top: 4px !important; padding: 16px !important; border-radius: var(--gps-r3); border: 1px dashed var(--gpa-accent) !important; background: var(--gpa-card-bg); }
      .gps-danger-zone { border-color: color-mix(in srgb, #ef4444 35%, var(--gpa-border)); }

      /* Grouped rows: one card, hairline dividers */
      .gps-list { display: flex; flex-direction: column; border-radius: var(--gps-r3); border: 1px solid var(--gpa-border); background: var(--gpa-card-bg); box-shadow: var(--gps-e1); }
      .gps-list > .gps-item { border: none; border-radius: 0; background: none; box-shadow: none; }
      .gps-list > .gps-item + .gps-item { border-top: 1px solid var(--gpa-border); }
      .gps.is-searching .gps-list:not(:has(> .gps-item:not(.no-match))) { display: none; }
      .gps.is-searching .gps-list > .gps-item:not(.no-match) ~ .gps-item:not(.no-match) { border-top: 1px solid var(--gpa-border); }
      .gps-split { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr); gap: 12px; align-items: start; }
      .gps-split-preview { position: sticky; top: 0; }
      .gps-choices-8 { grid-template-columns: repeat(8, minmax(0, 1fr)); }
      .gps-glyph-sans { font-family: 'Geist', -apple-system, 'Segoe UI', sans-serif; }
      /* Live panel preview: the real surface tokens (opacity, blur, shadow) */
      .gps-blobs { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
      .gps-blobs i { position: absolute; border-radius: 50%; filter: blur(2px); }
      .gps-blobs i:nth-child(1) { width: 120px; height: 120px; left: 18%; top: 22%; background: radial-gradient(circle, color-mix(in srgb, var(--gpa-accent) 75%, transparent), transparent 70%); }
      .gps-blobs i:nth-child(2) { width: 90px; height: 90px; right: 20%; top: 12%; background: radial-gradient(circle, color-mix(in srgb, var(--gpa-accent2) 70%, transparent), transparent 70%); }
      .gps-blobs i:nth-child(3) { width: 140px; height: 38px; left: 34%; bottom: 20%; border-radius: 8px; background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--gpa-text) 40%, transparent) 0 10px, transparent 10px 18px); filter: none; }
      .gps-rig-live .gps-mc {
        background: var(--gpa-atmos), var(--gpa-bg-t);
        backdrop-filter: var(--gpa-panel-blur); -webkit-backdrop-filter: var(--gpa-panel-blur);
        box-shadow: var(--gpa-mini-shadow);
      }
      .gps-rig-live .gps-mc-head, .gps-rig-live .gps-mc-side { background: var(--gpa-panel-t); }
      .gps-rig-live .gps-mc-card { padding: calc(0.65em * var(--gpa-dz)); }
      .gps-rig-live .gps-mc-main { padding: calc(0.8em * var(--gpa-dz)); gap: calc(0.5em * var(--gpa-dz)); }

      /* ---- Search results / empty ---- */
      .gps-results-head { display: none; font-size: 12px; color: var(--gpa-sub); padding: 0 2px; }
      .gps.is-searching .gps-results-head { display: block; }
      .gps.is-searching .gps-sec { display: flex; animation: none; }
      .gps.is-searching .gps-sec.no-match, .gps.is-searching .gps-item.no-match,
      .gps.is-searching .gps-hero, .gps.is-searching .gps-ov.no-match, .gps.is-searching .gps-reset { display: none; }
      .gps.is-searching .gps-tab { opacity: 0.45; }
      .gps.is-searching .gps-tab.has-match { opacity: 1; }
      .gps-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 16px; text-align: center; color: var(--gpa-sub); }
      .gps-empty svg { width: 28px; height: 28px; }
      .gps-empty[hidden] { display: none; }

      /* ---- Confirm dialog (mounted directly on the panel) ---- */
      .gps-dialog-scrim {
        position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px;
        background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); animation: gps-fade var(--gps-t2, 240ms) ease both;
      }
      .gps-dialog-scrim[hidden] { display: none; }
      .gps-dialog {
        width: min(360px, 100%); display: flex; flex-direction: column; gap: 8px; padding: 20px;
        border-radius: calc(16px * var(--gpa-rs)); border: 1px solid var(--gpa-border); background: var(--gpa-panel); color: var(--gpa-text);
        box-shadow: 0 30px 60px -20px rgba(0,0,0,0.7); animation: gps-pop 280ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
      }
      .gps-dialog-title { font-size: 15px; font-weight: 600; }
      .gps-dialog-body { margin: 0; font-size: 13px; color: var(--gpa-sub); line-height: 1.5; }
      .gps-dialog-actions { justify-content: flex-end; margin-top: 8px; }
      @keyframes gps-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes gps-pop { from { opacity: 0; transform: scale(0.96) translateY(6px); } to { opacity: 1; transform: none; } }

      /* Previews only animate while Settings is on screen (see .is-live). */
      .gps:not(.is-live) .gps-rig, .gps:not(.is-live) .gps-cube, .gps:not(.is-live) .gps-ai-core g { animation-play-state: paused; }

      /* Theme crossfade: on only for ~0.5s after a theme change. */
      .gpa-panel.gpa-theming, .gpa-panel.gpa-theming * {
        transition: background-color 0.45s ease, border-color 0.45s ease, color 0.45s ease, fill 0.45s ease, stroke 0.45s ease, box-shadow 0.45s ease !important;
      }

      /* ---- Responsive (container queries on the settings root) ---- */
      @container gps (max-width: 720px) {
        .gps-layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
        .gps-nav { position: static; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 4px; }
        .gps-tab[aria-selected="true"]::before { left: 8px; right: 8px; top: auto; bottom: 2px; width: auto; height: 2px; border-radius: 2px; }
        .gps-hero { grid-template-columns: minmax(0, 1fr); }
        .gps-hero-copy { padding: 4px 8px 8px; }
        .gps-builder { grid-template-columns: minmax(0, 1fr); }
        .gps-builder-preview { position: static; }
        .gps-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .gps-split { grid-template-columns: minmax(0, 1fr); }
        .gps-split-preview { position: static; }
        .gps-choices-8 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .gps-gallery-sm { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @container gps (max-width: 460px) {
        .gps-top { align-items: stretch; }
        .gps-search { flex: 1 1 100%; }
        .gps-nav { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .gps-nav { padding: 4px; gap: 2px; }
        .gps-tab { flex-direction: column; justify-content: center; gap: 4px; min-height: 52px; padding: 6px 1px; font-size: 10.5px; letter-spacing: -0.01em; text-align: center; }
        .gps-tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gps-stage { height: 200px; } .gps-stage-wide { height: 220px; }
        .gps-float-toast { display: none; }
        .gps-ov-grid { grid-template-columns: minmax(0, 1fr); }
        .gps-ov-wide { grid-column: auto; }
        .gps-models { grid-template-columns: minmax(0, 1fr); }
        .gps-sizes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .gps .gps-sizes > button[data-size="full"] { grid-column: span 2; }
        .gps-gallery-sm { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .gps-choices-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .gps-color { grid-template-columns: 40px minmax(0, 1fr) 84px 32px; gap: 8px; }
        .gps-item-row { flex-wrap: wrap; }
        .gps-ai { flex-direction: column; align-items: flex-start; }
      }
      @media (pointer: coarse) {
        .gps-btn, .gps .gps-seg-btn, .gps-tab { min-height: 44px; }
        .gps-reset, .gps-icon-btn { min-height: 40px; min-width: 40px; }
      }
    `;

  // ---- Host + Shadow DOM (isolates styles from the host page) -------
  const host = document.createElement('div');
  host.id = 'gpa-root-host';
  host.style.cssText = 'all:initial; position:fixed; top:80px; left:80px; z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  // Best-effort load of the UI's real typeface (chrome + AI output). If the
  // host page's CSP blocks external stylesheets, this silently no-ops and
  // the CSS font-family fallback stack (system sans/monospace fonts) is used.
  if (!document.getElementById('gpa-font-link')) {
    try {
      const fontLink = document.createElement('link');
      fontLink.id = 'gpa-font-link';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap';
      document.head.appendChild(fontLink);
    } catch (e) { /* ignore — falls back to system sans/monospace fonts */ }
  }

  // Styles for on-page highlight spans MUST live in the host page's own
  // <head>, not our shadow root's stylesheet — shadow DOM styles don't
  // reach elements injected into the outer document.
  if (!document.getElementById('gpa-highlight-style')) {
    const hlStyle = document.createElement('style');
    hlStyle.id = 'gpa-highlight-style';
    hlStyle.textContent = `
      .gpa-page-highlight {
        background: var(--gpa-hl-bg, rgba(255, 235, 59, 0.5)) !important;
        border-radius: 3px; padding: 0 2px; box-shadow: 0 0 0 rgba(0,0,0,0);
        animation: gpa-hl-in 0.5s ease;
      }
      @keyframes gpa-hl-in {
        0% { box-shadow: 0 0 0 0 var(--gpa-hl-glow, rgba(255,235,59,0.9)); }
        60% { box-shadow: 0 0 10px 3px var(--gpa-hl-glow, rgba(255,235,59,0.9)); }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
    `;
    document.head.appendChild(hlStyle);
  }

  const style = document.createElement('style');
  root.appendChild(style);
  // Theme tokens live in their own tiny stylesheet (see applyTheme).
  const tokenStyle = document.createElement('style');
  root.appendChild(tokenStyle);

  // Wrapper lets an ambient particle canvas float around the panel's edges
  // without sitting on top of (or blocking clicks on) any actual content.
  const particleWrap = document.createElement('div');
  particleWrap.className = 'gpa-particle-wrap';
  root.appendChild(particleWrap);

  const particleCanvas = document.createElement('canvas');
  particleCanvas.id = 'gpa-particles';
  particleWrap.appendChild(particleCanvas);

  const panel = document.createElement('div');
  panel.className = 'gpa-panel';
  particleWrap.appendChild(panel);

  panel.innerHTML = `
    <div class="gpa-header" id="gpa-drag">
      <button id="gpa-sidebar-toggle" title="Show/hide the sidebar">&#9776;</button>
      <button id="gpa-min" title="Minimize">&minus;</button>
      <span class="gpa-title">Agent Console</span>
      <span class="gpa-dot"></span>
      <button id="gpa-reload" title="Reload the console — fetches the latest script and restarts it">&#10227;</button>
      <button id="gpa-console-fullscreen" title="Fullscreen the whole console">⛶</button>
      <button id="gpa-close" title="Close">&times;</button>
    </div>
    <div class="gpa-toast-wrap" id="gpa-toast-wrap"></div>
    <div class="gpa-login" id="gpa-login">
      <div class="gpa-login-card">
        <div class="gpa-login-brand">
          <button id="gpa-signup-btn" class="gpa-login-logo" title="Register new account">＋</button>
          <div class="gpa-login-brandtext">
            <div class="gpa-login-company">Agent Console</div>
            <div class="gpa-login-dept">Sign in to continue</div>
          </div>
          <div class="gpa-login-winbtns">
            <button id="gpa-login-min" class="gpa-login-winbtn" title="Minimize">&minus;</button>
            <button id="gpa-login-close" class="gpa-login-winbtn" title="Close">&times;</button>
          </div>
        </div>
        <div class="gpa-login-divider"></div>
        <div class="gpa-login-heading">Welcome back</div>
        <label class="gpa-login-label" for="gpa-login-user">Username</label>
        <input id="gpa-login-user" class="gpa-login-input" placeholder="e.g. j.smith" autocomplete="off" />
        <label class="gpa-login-label" for="gpa-login-pin">PIN</label>
        <input id="gpa-login-pin" class="gpa-login-input" type="password" placeholder="••••••" autocomplete="off" />
        <div id="gpa-login-msg" class="gpa-login-msg"></div>
        <button id="gpa-login-btn" class="gpa-login-primary">Sign in</button>
        <div class="gpa-login-actions">
          <button id="gpa-login-restore" class="gpa-login-link">Transfer access code</button>
        </div>
        <div class="gpa-login-footer">
          <div class="gpa-login-legal">
            Your account lives only in this browser — nothing is sent to a server.
            Pick a PIN you don't use anywhere else.
          </div>
        </div>
      </div>
    </div>
    <div class="gpa-langpick" id="gpa-langpick" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="gpa-langpick-title">
      <div class="gpa-langpick-card">
        <div class="gpa-langpick-glyph">🌐</div>
        <div class="gpa-langpick-title" id="gpa-langpick-title">Choose your language</div>
        <div class="gpa-langpick-sub">Elige tu idioma</div>
        <div class="gpa-langpick-who" id="gpa-langpick-who"></div>
        <div class="gpa-langpick-opts">
          <button class="gpa-langpick-opt" data-lang="en">English</button>
          <button class="gpa-langpick-opt" data-lang="es">Español</button>
        </div>
        <div class="gpa-langpick-note">Saved to this account only — other profiles on this browser keep their own language. You can change it later in Settings.</div>
      </div>
    </div>
    <div class="gpa-body" id="gpa-body">
      <nav class="gpa-sidebar" aria-label="Agent Console sections">
      <div class="gpa-dropdown" id="gpa-dropdown">
        <button class="gpa-dropdown-btn" id="gpa-dropdown-btn">
          <span id="gpa-dropdown-label">Page Insights</span>
          <svg class="gpa-chevron" viewBox="0 0 20 20" width="13" height="13"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="gpa-dropdown-menu" id="gpa-dropdown-menu">
          <button class="gpa-dropdown-item" data-tab="welcome"><span class="gpa-nav-ic">☀</span><span class="gpa-nav-label">Welcome</span></button>
          <button class="gpa-dropdown-item active" data-tab="scan"><span class="gpa-nav-ic">◧</span><span class="gpa-nav-label">Page Insights</span></button>
          <button class="gpa-dropdown-item" data-tab="ask"><span class="gpa-nav-ic">✦</span><span class="gpa-nav-label">Ask AI</span></button>
          <button class="gpa-dropdown-item" data-tab="chat"><span class="gpa-nav-ic">◔</span><span class="gpa-nav-label">Chat</span><span id="gpa-chat-badge" class="gpa-chat-badge" style="display:none;">0</span></button>
          <button class="gpa-dropdown-item" data-tab="music"><span class="gpa-nav-ic">♫</span><span class="gpa-nav-label">Music</span></button>
          <button class="gpa-dropdown-item" data-tab="browser"><span class="gpa-nav-ic">◫</span><span class="gpa-nav-label">Proxy</span></button>
          <button class="gpa-dropdown-item" data-tab="games"><span class="gpa-nav-ic">▣</span><span class="gpa-nav-label">Games</span></button>
          <button class="gpa-dropdown-item" data-tab="study"><span class="gpa-nav-ic">◈</span><span class="gpa-nav-label">Study</span></button>
          <button class="gpa-dropdown-item" data-tab="notes"><span class="gpa-nav-ic">▤</span><span class="gpa-nav-label">Notes</span></button>
          <button class="gpa-dropdown-item" data-tab="humanize"><span class="gpa-nav-ic">✎</span><span class="gpa-nav-label">Humanize</span></button>
          <button class="gpa-dropdown-item" data-tab="grammar"><span class="gpa-nav-ic">✓</span><span class="gpa-nav-label">Grammar</span></button>
          <button class="gpa-dropdown-item" data-tab="saved"><span class="gpa-nav-ic">☆</span><span class="gpa-nav-label">Saved</span></button>
          <button class="gpa-dropdown-item" data-tab="theme"><span class="gpa-nav-ic">⚙</span><span class="gpa-nav-label">Settings</span></button>
        </div>
      </div>
      </nav>
      <main class="gpa-main" id="gpa-main">

      <div class="gpa-pane" data-pane="welcome">
        <div class="gpa-welcome-flow">
          <div class="gpa-card gpa-welcome-hero">
            <div class="gpa-row" style="flex-wrap:wrap; align-items:center;">
              <div style="flex:1; min-width:160px;">
                <div id="gpa-welcome-greeting" class="gpa-welcome-greeting">Welcome</div>
                <div id="gpa-welcome-sub" class="gpa-sub"></div>
                <div class="gpa-welcome-ai-status">
                  <span class="gpa-welcome-ai-line"><span id="gpa-welcome-ai-dot-openai" class="gpa-status-dot"></span>OpenAI: <span id="gpa-welcome-ai-text-openai">checking…</span></span>
                </div>
              </div>
              <canvas id="gpa-welcome-3d" width="140" height="140" style="display:none;"></canvas>
            </div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Right now</div>
            <div class="gpa-snapshot-grid">
              <div class="gpa-snapshot-stat">
                <div id="gpa-welcome-nyc-time" class="gpa-snapshot-num">--:--</div>
                <div class="gpa-snapshot-label">NYC time</div>
              </div>
              <div class="gpa-snapshot-stat">
                <div id="gpa-welcome-temp" class="gpa-snapshot-num">--°</div>
                <div id="gpa-welcome-condition" class="gpa-snapshot-label">Lehigh Acres, FL</div>
              </div>
              <div class="gpa-snapshot-stat">
                <div id="gpa-welcome-active-num" class="gpa-snapshot-num">--</div>
                <div class="gpa-snapshot-label"><span id="gpa-welcome-active-dot" class="gpa-live-dot" style="display:none;"></span>Active now</div>
              </div>
            </div>
            <div id="gpa-welcome-weather-meta" class="gpa-sub" style="margin-top:8px;">Loading weather…</div>
            <div id="gpa-welcome-sun-meta" class="gpa-sub"></div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Your activity</div>
            <div class="gpa-snapshot-grid">
              <div class="gpa-snapshot-stat">
                <div id="gpa-welcome-opens" class="gpa-snapshot-num">--</div>
                <div class="gpa-snapshot-label">Sessions opened</div>
              </div>
              <div class="gpa-snapshot-stat">
                <div id="gpa-welcome-member-since" class="gpa-snapshot-num">--</div>
                <div class="gpa-snapshot-label">Member since</div>
              </div>
            </div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Quick actions</div>
            <div class="gpa-row gpa-welcome-quick-row">
              <button class="gpa-btn gpa-welcome-quick" data-jump="ask">💬 Ask AI</button>
              <button class="gpa-btn gpa-welcome-quick" data-jump="notes">📝 Notes</button>
              <button class="gpa-btn gpa-welcome-quick" data-jump="chat">👥 Chat</button>
              <button class="gpa-btn gpa-welcome-quick" data-jump="study">🎓 Study</button>
            </div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Lehigh Acres, FL — local news</div>
            <div id="gpa-welcome-news" class="gpa-welcome-news-text">Looking for local news…</div>
            <div class="gpa-row" style="margin-top:8px;">
              <button id="gpa-welcome-news-refresh" class="gpa-btn">🔄 Refresh</button>
            </div>
            <div id="gpa-welcome-news-meta" class="gpa-sub"></div>
          </div>
        </div>
      </div>

      <div class="gpa-pane active" data-pane="scan">
        <div class="gpa-scan-flow">
          <div class="gpa-card">
            <div class="gpa-card-title">Read the page</div>
            <div class="gpa-row">
              <button id="gpa-scan-btn" class="gpa-btn">Scan page text</button>
              <button id="gpa-capture-btn" class="gpa-btn">Capture screen</button>
              <button id="gpa-upload-btn" class="gpa-btn">Upload image</button>
              <input type="file" id="gpa-image-upload" accept="image/*" style="display:none" />
              <button id="gpa-translate-page-btn" class="gpa-btn">🌐 Translate this page</button>
            </div>
            <div class="gpa-sub">or paste (Ctrl+V) a screenshot anywhere in this panel</div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Page snapshot</div>
            <div id="gpa-snapshot-stats" class="gpa-snapshot-grid"></div>
            <div id="gpa-snapshot-meta" class="gpa-sub" style="margin-top:8px;"></div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Quick actions</div>
            <div class="gpa-row">
              <button id="gpa-copy-text-btn" class="gpa-btn">📋 Copy page text</button>
              <button id="gpa-copy-url-btn" class="gpa-btn">🔗 Copy page URL</button>
              <button id="gpa-print-btn" class="gpa-btn">🖨 Print page</button>
            </div>
            <div id="gpa-quick-action-status" class="gpa-sub"></div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Quick settings</div>
            <div class="gpa-sub" style="margin-bottom:6px;">Page actions</div>
            <div class="gpa-row">
              <button class="gpa-btn autoconfirm-btn">✋ Confirm page clicks: ON</button>
              <button id="gpa-more-settings-btn" class="gpa-btn">⚙ More settings…</button>
            </div>
          </div>

          <div class="gpa-card">
            <div class="gpa-card-title">Automate</div>
            <div class="gpa-row">
              <button id="gpa-quiz-btn" class="gpa-btn quiz-btn">✨ Solve quiz on this page</button>
            </div>
            <div class="gpa-row">
              <button id="gpa-tutor-btn" class="gpa-btn">🎓 Tutor mode</button>
              <button id="gpa-autofollow-btn" class="gpa-btn">📍 Auto-explain</button>
              <button id="gpa-tables-btn" class="gpa-btn">📋 Extract tables</button>
              <button id="gpa-watch-btn" class="gpa-btn">👀 Watch page</button>
            </div>
            <div class="gpa-row" id="gpa-watch-row" style="display:none;">
              <input id="gpa-watch-cond" class="gpa-input" placeholder='Tell me when… (e.g. "price drops below $50")' />
              <button id="gpa-watch-start" class="gpa-btn primary">Arm</button>
            </div>
            <div class="gpa-row">
              <input id="gpa-cmd-input" class="gpa-input" placeholder='⚡ Tell the page what to do… ("click the third assignment")' />
              <button id="gpa-cmd-btn" class="gpa-btn primary">Do it</button>
            </div>
          </div>

          <div class="gpa-scan-ask-section">
            <div class="gpa-card-title">Ask about it</div>
            <div id="gpa-ask-empty-hint" class="gpa-sub">Nothing scanned yet — click Scan page text or Capture screen above (or paste a screenshot anywhere in this panel), then use the tools below to summarize, analyze, or ask anything about it.</div>
            <div class="gpa-row" id="gpa-status-row" style="display:none;">
              <img id="gpa-thumb" alt="captured screen" />
              <span id="gpa-scan-status" class="gpa-sub"></span>
              <button id="gpa-clear-context" class="gpa-btn" title="Clear captured page text and screenshot">Clear</button>
            </div>
            <div class="gpa-row gpa-actions" id="gpa-scan-actions" style="display:none;">
              <button class="gpa-btn primary" data-action="summarize">Summarize</button>
              <button class="gpa-btn primary" data-action="analyze">Analyze</button>
              <button class="gpa-btn" data-action="autofill">Auto-Fill Form</button>
            </div>
            <div class="gpa-row gpa-actions" id="gpa-scan-more-actions" style="display:none;">
              <button id="gpa-tone-btn" class="gpa-btn">🎭 Tone &amp; insights</button>
              <button id="gpa-explore-btn" class="gpa-btn">🧭 Explore further</button>
            </div>
            <div class="gpa-row" id="gpa-question-row" style="display:none;">
              <input id="gpa-question" class="gpa-input" placeholder="Ask a question about this page…" />
              <button id="gpa-question-btn" class="gpa-btn primary">Answer</button>
            </div>
          </div>
          <div id="gpa-scan-output" class="gpa-output"></div>
          <div id="gpa-tone-output" class="gpa-card" style="display:none;">
            <div class="gpa-card-title">Tone &amp; insight analysis</div>
            <div id="gpa-tone-gauges"></div>
            <div id="gpa-tone-summary" class="gpa-sub" style="margin-top:6px;"></div>
          </div>
          <div id="gpa-explore-output" class="gpa-card" style="display:none;">
            <div class="gpa-card-title">Explore further</div>
            <div id="gpa-explore-chips" class="gpa-chip-row"></div>
          </div>
          <div class="gpa-row" style="margin-top:6px;">
            <button id="gpa-clear-highlights" class="gpa-btn" style="display:none;">✕ Clear page highlights</button>
          </div>
        </div>
      </div>

      <div class="gpa-pane" data-pane="ask">
  <div class="gpa-row" style="justify-content:space-between; align-items:center;">
    <span class="gpa-sub" style="flex:1;">Remembers this conversation</span>
    <button id="gpa-ask-new" class="gpa-btn" title="Start a fresh conversation (clears memory)">🗑 New</button>
    <button id="gpa-ask-settings-btn" class="gpa-btn" title="Study settings">⚙️</button>
  </div>
  <div id="gpa-ask-settings" class="gpa-card" style="display:none; margin-bottom:10px;">
    <div class="gpa-card-title">Study settings</div>
    <label class="gpa-sub" for="gpa-ask-subject">Subject</label>
    <input id="gpa-ask-subject" class="gpa-input" placeholder="e.g. AP Chemistry, Algebra II, US History" autocomplete="off" />
    <label class="gpa-sub" for="gpa-ask-level" style="display:block; margin-top:8px;">Level / complexity</label>
    <select id="gpa-ask-level" class="gpa-input">
      <option value="simple">Explain simply (beginner)</option>
      <option value="standard" selected>Standard</option>
      <option value="advanced">Advanced / in-depth</option>
      <option value="exam">Exam-prep — show the working</option>
    </select>
    <label class="gpa-sub" for="gpa-ask-context" style="display:block; margin-top:8px;">Anything else the AI should know</label>
    <textarea id="gpa-ask-context" class="gpa-sync-box" style="height:52px;" placeholder="e.g. Test on Friday; prefer step-by-step; I already know basic derivatives."></textarea>
    <label class="gpa-sub" style="display:block; margin-top:8px;">Reasoning effort</label>
    <div class="gpa-segmented" style="margin-top:4px;">
      <button class="gpa-btn gpa-reason" data-reason="low">Low</button>
      <button class="gpa-btn gpa-reason primary" data-reason="medium">Medium</button>
      <button class="gpa-btn gpa-reason" data-reason="high">High</button>
    </div>
    <div id="gpa-reason-note" class="gpa-sub" style="margin-top:4px;"></div>
    <div class="gpa-row" style="margin-top:8px; margin-bottom:0;">
      <button id="gpa-ask-settings-save" class="gpa-btn primary" style="flex:1;">Save</button>
    </div>
  </div>
  <div id="gpa-chat" class="gpa-chat"></div>
  <div id="gpa-ask-images" class="gpa-row" style="flex-wrap:wrap; gap:6px; display:none; margin-bottom:6px;"></div>
  <div class="gpa-row">
    <input id="gpa-ask-input" class="gpa-input" placeholder="Ask me anything… (paste an image too)" />
    <button id="gpa-ask-attach" class="gpa-btn" title="Attach an image">📎</button>
    <button id="gpa-ask-btn" class="gpa-btn primary">Send</button>
    <button id="gpa-voice-btn" class="gpa-btn" title="Speak your question">🎙</button>
  </div>
  <input id="gpa-ask-file" type="file" accept="image/*" multiple style="display:none;" />
</div>

      <div class="gpa-pane" data-pane="chat">
        <div class="gpa-row" style="flex-wrap:wrap;">
          <select id="gpa-chat-room" class="gpa-input" style="flex:1;"></select>
          <button id="gpa-chat-join" class="gpa-btn" title="Join a private room with a code">🔑 Join</button>
        </div>
        <div id="gpa-chat-note" class="gpa-sub" style="margin:4px 0;"></div>
        <div id="gpa-chat-log" class="gpa-chat-log"></div>
        <div class="gpa-row" style="margin-top:6px;">
          <input id="gpa-chat-input" class="gpa-input" placeholder="Message…" maxlength="500" autocomplete="off" />
          <button id="gpa-chat-send" class="gpa-btn primary">Send</button>
        </div>
      </div>

      <div class="gpa-pane" data-pane="music">
        <div class="gpa-row">
          <input id="gpa-music-query" class="gpa-input" placeholder="Type a song name or description…" />
          <button id="gpa-music-search" class="gpa-btn primary">Play</button>
        </div>
        <div id="gpa-music-status" class="gpa-sub" style="margin-bottom:6px;"></div>
        <div id="gpa-music-wrap" class="gpa-sc-wrap"></div>

        <div class="gpa-sub" style="margin:12px 0 6px;">Or paste a SoundCloud link directly:</div>
        <div class="gpa-row">
          <input id="gpa-sc-url" class="gpa-input" placeholder="soundcloud.com/…" />
          <button id="gpa-sc-load" class="gpa-btn">Load</button>
        </div>
        <div id="gpa-sc-wrap" class="gpa-sc-wrap"></div>

        <div class="gpa-sub" style="margin:14px 0 6px;">📁 Music library — files you add are saved on this device and play with no internet</div>
        <div class="gpa-row" style="flex-wrap:wrap;">
          <button id="gpa-local-add-btn" class="gpa-btn">Add audio files</button>
          <button id="gpa-local-clear-btn" class="gpa-btn">🗑 Clear saved</button>
          <input type="file" id="gpa-local-file-input" accept="audio/*" multiple style="display:none" />
        </div>
        <div id="gpa-local-status" class="gpa-sub" style="margin:6px 0 0;"></div>
        <div id="gpa-local-playlist" class="gpa-local-playlist"></div>
        <div id="gpa-local-player" class="gpa-local-player" style="display:none;">
          <div id="gpa-local-nowplaying" class="gpa-sub"></div>
          <div class="gpa-row">
            <input type="range" id="gpa-local-seek" class="gpa-range" min="0" max="100" value="0" />
          </div>
          <div class="gpa-row" style="justify-content:space-between;">
            <span id="gpa-local-time" class="gpa-sub">0:00 / 0:00</span>
          </div>
          <div class="gpa-row" style="justify-content:center; gap:10px;">
            <button id="gpa-local-prev" class="gpa-btn">⏮</button>
            <button id="gpa-local-playpause" class="gpa-btn primary">▶</button>
            <button id="gpa-local-next" class="gpa-btn">⏭</button>
          </div>
          <div class="gpa-row">
            <span class="gpa-sub">🔊</span>
            <input type="range" id="gpa-local-volume" class="gpa-range" min="0" max="100" value="80" />
          </div>
        </div>
      </div>

      <div class="gpa-pane" data-pane="browser">
        <div class="gpa-card-title">Scramjet Proxy</div>
        <div class="gpa-sub" style="margin-bottom:8px;">Browse through a proxy server running on your own device (or another one you point this at below) — nothing here reaches anyone else's connection but whatever this is pointed at. Use the Music tab for actual SoundCloud playback.</div>
        <div class="gpa-row">
          <input id="gpa-proxy-url" class="gpa-input" placeholder="Enter a website or URL…" autocomplete="off" />
          <button id="gpa-proxy-go" class="gpa-btn primary">Go</button>
        </div>
        <div class="gpa-row" style="margin:8px 0; flex-wrap:wrap; align-items:center; gap:6px;">
          <button id="gpa-proxy-reload" class="gpa-btn">🔄 Reload</button>
          <button id="gpa-proxy-home" class="gpa-btn">🏠 Home</button>
          <button id="gpa-proxy-popout" class="gpa-btn">↗ Pop Out</button>
          <span id="gpa-proxy-status" class="gpa-sub" style="margin-left:auto;">Not connected</span>
        </div>
        <div class="gpa-row" style="margin-bottom:6px;">
          <input id="gpa-proxy-server" class="gpa-input" placeholder="Proxy server URL (advanced — defaults to your own localhost)" autocomplete="off" style="font-size:11px;" />
        </div>
        <div id="gpa-proxy-error" class="gpa-sub" style="display:none; margin-bottom:6px;"></div>
        <iframe id="gpa-proxy-frame" class="gpa-iframe" allow="fullscreen; clipboard-read; clipboard-write; autoplay; camera; microphone; geolocation" referrerpolicy="no-referrer"></iframe>
        <div class="gpa-sub" style="margin:12px 0 6px;">🔎 Research mode — AI reads web sources and writes you a brief</div>
        <div class="gpa-row">
          <input id="gpa-research-input" class="gpa-input" placeholder="Topic or question to research…" />
          <button id="gpa-research-btn" class="gpa-btn primary">Research</button>
        </div>
        <div id="gpa-research-out" class="gpa-output" style="max-height:200px;"></div>
      </div>

      <div class="gpa-pane" data-pane="games">
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn game-btn primary" data-game="ttt">Tic-Tac-Toe</button>
          <button class="gpa-btn game-btn" data-game="rps">RPS</button>
          <button class="gpa-btn game-btn" data-game="memory">Memory</button>
          <button class="gpa-btn game-btn" data-game="snake">Snake</button>
          <button class="gpa-btn game-btn" data-game="2048">2048</button>
          <button class="gpa-btn game-btn" data-game="whack">Whack-a-Mole</button>
          <button class="gpa-btn game-btn" data-game="guess">Guess Number</button>
          <button class="gpa-btn game-btn" data-game="hangman">Hangman</button>
          <button class="gpa-btn game-btn" data-game="wordle">Wordle</button>
          <button class="gpa-btn game-btn" data-game="connect4">Connect 4</button>
          <button class="gpa-btn game-btn" data-game="minesweeper">Minesweeper</button>
          <button class="gpa-btn game-btn" data-game="simon">Simon</button>
          <button class="gpa-btn game-btn" data-game="breakout">Breakout</button>
          <button class="gpa-btn game-btn" data-game="flappy">Flappy</button>
          <button class="gpa-btn game-btn" data-game="scramble">Word Scramble</button>
          <button class="gpa-btn game-btn" data-game="reaction">Reaction Test</button>
          <button class="gpa-btn game-btn" data-game="tetris">Tetris</button>
          <button class="gpa-btn game-btn" data-game="checkers">Checkers</button>
          <button class="gpa-btn game-btn" data-game="sudoku">Sudoku</button>
          <button class="gpa-btn game-btn" data-game="pong">Pong</button>
          <button class="gpa-btn game-btn" data-game="lightsout">Lights Out</button>
          <button class="gpa-btn game-btn" data-game="fifteen">15-Puzzle</button>
          <button class="gpa-btn game-btn" data-game="hanoi">Hanoi</button>
          <button class="gpa-btn game-btn" data-game="mastermind">Mastermind</button>
          <button class="gpa-btn game-btn" data-game="blackjack">Blackjack</button>
          <button class="gpa-btn game-btn" data-game="typing">Typing Test</button>
          <button class="gpa-btn game-btn" data-game="mathsprint">Math Sprint</button>
          <button class="gpa-btn game-btn" data-game="maze">Maze</button>
          <button class="gpa-btn game-btn" data-game="invaders">Invaders</button>
          <button class="gpa-btn game-btn" data-game="platformer">Platformer</button>
          <button class="gpa-btn game-btn" data-game="crusade">Crusade</button>
          <button class="gpa-btn game-btn" data-game="racer">Racer</button>
        </div>
        <div class="gpa-row" style="margin-top:6px;">
          <button id="gpa-game-restart" class="gpa-btn">🔄 Restart</button>
          <button id="gpa-game-pause" class="gpa-btn">⏸ Pause</button>
          <button id="gpa-game-fullscreen" class="gpa-btn">⛶ Fullscreen</button>
        </div>
        <div class="gpa-sub" style="text-align:center; margin-bottom:4px;">Keys — P: pause · R: restart · T: timer</div>
        <div id="gpa-game-stage" class="gpa-game-stage">
          <div id="gpa-game-timer" class="gpa-game-timer" style="display:none;">0:00</div>
          <div id="gpa-game-viewport" class="gpa-game-viewport"><div id="gpa-game-fit" class="gpa-game-fit"></div></div>
          <div id="gpa-game-pausemenu" class="gpa-pause-menu" style="display:none;">
            <div class="gpa-pause-card">
              <div class="gpa-pause-title">⏸ Paused</div>
              <div id="gpa-pause-stats" class="gpa-pause-stats"></div>
              <div id="gpa-pause-options" class="gpa-pause-options"></div>
              <div class="gpa-row" style="justify-content:center; margin-top:10px;">
                <button id="gpa-pause-resume" class="gpa-btn primary">▶ Resume</button>
                <button id="gpa-pause-restart" class="gpa-btn">🔄 Restart</button>
              </div>
              <div class="gpa-sub" style="text-align:center; margin-top:8px;">P resume · R restart · T timer</div>
            </div>
          </div>
        </div>
      </div>

      <div class="gpa-pane" data-pane="saved">
        <div class="gpa-row" style="justify-content:space-between;">
          <button id="gpa-saved-view-cal" class="gpa-btn saved-view-btn primary">📅 Calendar</button>
          <button id="gpa-saved-view-folders" class="gpa-btn saved-view-btn">🗂 Folders</button>
          <button id="gpa-saved-new-folder" class="gpa-btn" style="display:none;">＋ New folder</button>
        </div>
        <div class="gpa-row" id="gpa-saved-cal-head" style="justify-content:space-between;">
          <button id="gpa-cal-prev" class="gpa-btn" title="Previous month">‹</button>
          <span id="gpa-cal-title" class="gpa-cal-title"></span>
          <button id="gpa-cal-next" class="gpa-btn" title="Next month">›</button>
        </div>
        <div id="gpa-cal-grid" class="gpa-cal"></div>
        <div id="gpa-folder-tree" class="gpa-folder-tree" style="display:none;"></div>
        <div id="gpa-saved-day-label" class="gpa-sub" style="margin:8px 0 4px;"></div>
        <div id="gpa-saved-list" class="gpa-chat" style="max-height:260px;"></div>
        <div class="gpa-sub" style="margin:12px 0 6px;">📝 Scratchpad — autosaved to your profile</div>
        <textarea id="gpa-scratch" class="gpa-sync-box" style="height:90px;" placeholder="Jot anything… it saves as you type."></textarea>
        <div class="gpa-row" style="margin-top:6px;">
          <button id="gpa-scratch-tidy" class="gpa-btn">✨ Tidy notes with AI</button>
        </div>
        <div class="gpa-sub" style="margin:12px 0 6px;">🍅 Pomodoro — 25 min focus / 5 min break</div>
        <div class="gpa-row" style="justify-content:center;">
          <span id="gpa-pomo-time" class="gpa-pomo-time">25:00</span>
        </div>
        <div class="gpa-row" style="justify-content:center;">
          <button id="gpa-pomo-start" class="gpa-btn primary">▶ Start</button>
          <button id="gpa-pomo-reset" class="gpa-btn">Reset</button>
          <span id="gpa-pomo-count" class="gpa-sub"></span>
        </div>
      </div>

      <div class="gpa-pane" data-pane="study">
        <div class="gpa-row">
          <button id="gpa-fc-gen" class="gpa-btn primary">✨ Make flashcards from this page</button>
        </div>
        <div id="gpa-fc-status" class="gpa-sub" style="margin-bottom:6px;">Open a page with material on it, then generate a deck. Cards you "knew" three times are retired until you reset.</div>
        <div id="gpa-fc-study"></div>
      </div>

      <div class="gpa-pane" data-pane="notes">
        <div class="gpa-row">
          <textarea id="gpa-notes-input" class="gpa-sync-box" style="height:100px;" placeholder="Paste a passage here — article, chapter, story, lecture… Then press Enter (Shift+Enter makes a new line)."></textarea>
        </div>
        <div class="gpa-row">
          <button id="gpa-notes-go" class="gpa-btn primary">📝 Read, research &amp; make notes</button>
          <button id="gpa-notes-new" class="gpa-btn" style="display:none;">🗑 Clear &amp; start new</button>
        </div>
        <div id="gpa-notes-status" class="gpa-sub" style="margin-bottom:6px;">The AI reads the passage, researches it across the web, and writes organized notes — then remembers it all so you can ask follow-ups below.</div>
        <div id="gpa-notes-out" class="gpa-output"></div>
        <div class="gpa-sub" style="margin:10px 0 4px;">💬 Ask about this passage — it remembers the text, the notes and the research</div>
        <div class="gpa-row" id="gpa-notes-q-row" style="display:none;">
          <input id="gpa-notes-q" class="gpa-input" placeholder="Ask anything about the passage…" />
          <button id="gpa-notes-q-btn" class="gpa-btn primary">Ask</button>
        </div>
        <div id="gpa-notes-chat" class="gpa-chat"></div>
      </div>

      <div class="gpa-pane" data-pane="humanize">
        <div class="gpa-row">
          <textarea id="gpa-hum-input" class="gpa-sync-box" style="height:140px;" placeholder="Paste any text here — an essay, an email, a paragraph you wrote — from anywhere, not just this page. Get back a version that reads more naturally."></textarea>
        </div>
        <div class="gpa-row">
          <button id="gpa-hum-go" class="gpa-btn primary">✎ Humanize</button>
          <button id="gpa-hum-retry" class="gpa-btn" style="display:none;">🔄 Try again</button>
        </div>
        <div id="gpa-hum-status" class="gpa-sub" style="margin-bottom:6px;">Rewrites stiff or robotic phrasing so it reads the way a person would actually write it — meaning, facts, and length stay the same.</div>
        <div id="gpa-hum-out" class="gpa-output"></div>
      </div>

      <div class="gpa-pane" data-pane="grammar">
        <div class="gpa-row">
          <textarea id="gpa-gram-input" class="gpa-sync-box" style="height:140px;" placeholder="Paste any text here to check for grammar, spelling, and punctuation errors — from anywhere, not just this page."></textarea>
        </div>
        <div class="gpa-row">
          <button id="gpa-gram-go" class="gpa-btn primary">✓ Check grammar</button>
        </div>
        <div id="gpa-gram-status" class="gpa-sub" style="margin-bottom:6px;">Fixes actual errors only — style, tone, and word choice are left alone. Each fix is explained so you can learn from it.</div>
        <div id="gpa-gram-out" class="gpa-output"></div>
      </div>

      <div id="gpa-save-modal" class="gpa-modal" style="display:none;">
        <div class="gpa-modal-card">
          <div class="gpa-modal-title" id="gpa-save-modal-title">💾 Save insight</div>
          <label for="gpa-save-label">Label (optional)</label>
          <input id="gpa-save-label" placeholder="e.g. History, Exam prep, Recipes…" />
          <label for="gpa-save-folder">Section (folder)</label>
          <div class="gpa-row">
            <select id="gpa-save-folder"></select>
            <button id="gpa-save-folder-new" class="gpa-btn" title="Create a new folder">＋</button>
          </div>
          <label for="gpa-save-file">File (subfolder, optional)</label>
          <div class="gpa-row">
            <select id="gpa-save-file"></select>
            <button id="gpa-save-file-new" class="gpa-btn" title="Create a new file in this folder">＋</button>
          </div>
          <div id="gpa-save-when" class="gpa-sub"></div>
          <div class="gpa-row" style="margin-top:4px;">
            <button id="gpa-save-ok" class="gpa-btn primary" style="flex:1;">Save</button>
            <button id="gpa-save-cancel" class="gpa-btn" style="flex:1;">Cancel</button>
          </div>
        </div>
      </div>

      <div class="gpa-pane" data-pane="theme">
        <div class="gps" id="gps">
          <header class="gps-top">
            <div class="gps-titleblock">
              <div class="gps-eyebrow">Control center</div>
              <h2 class="gps-h">Settings</h2>
            </div>
            <div class="gps-search">
              ${GPS_ICONS.search}
              <input id="gps-search" type="search" placeholder="Search settings" aria-label="Search settings" autocomplete="off" spellcheck="false" />
              <kbd aria-hidden="true">/</kbd>
            </div>
          </header>
          <div class="gps-layout">
            <nav class="gps-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
              <button class="gps-tab" role="tab" data-sec="overview" aria-selected="true">${GPS_ICONS.overview}<span>Overview</span></button>
              <button class="gps-tab" role="tab" data-sec="theme" aria-selected="false" tabindex="-1">${GPS_ICONS.theme}<span>Theme</span></button>
              <button class="gps-tab" role="tab" data-sec="colors" aria-selected="false" tabindex="-1">${GPS_ICONS.colors}<span>Colors</span></button>
              <button class="gps-tab" role="tab" data-sec="panel" aria-selected="false" tabindex="-1">${GPS_ICONS.panel}<span>Panel</span></button>
              <button class="gps-tab" role="tab" data-sec="effects" aria-selected="false" tabindex="-1">${GPS_ICONS.effects}<span>Effects</span></button>
              <button class="gps-tab" role="tab" data-sec="type" aria-selected="false" tabindex="-1">${GPS_ICONS.type}<span>Typography</span></button>
              <button class="gps-tab" role="tab" data-sec="icon" aria-selected="false" tabindex="-1">${GPS_ICONS.icon}<span>Icon</span></button>
              <button class="gps-tab" role="tab" data-sec="ai" aria-selected="false" tabindex="-1">${GPS_ICONS.ai}<span>AI</span></button>
              <button class="gps-tab" role="tab" data-sec="controls" aria-selected="false" tabindex="-1">${GPS_ICONS.controls}<span>Controls</span></button>
              <button class="gps-tab" role="tab" data-sec="account" aria-selected="false" tabindex="-1">${GPS_ICONS.account}<span>Account</span></button>
              <button class="gps-tab" role="tab" data-sec="advanced" aria-selected="false" tabindex="-1">${GPS_ICONS.advanced}<span>Advanced</span></button>
            </nav>
            <div class="gps-content" id="gps-content">
              <div class="gps-results-head" id="gps-results-head" aria-live="polite"></div>

              <!-- OVERVIEW -->
              <section class="gps-sec active" data-sec="overview" role="tabpanel" aria-label="Overview">
                <div class="gps-hero">
                  <div class="gps-stage" data-tilt>
                    <div class="gps-floor"></div>
                    <div class="gps-rig">
                      ${gpsMiniConsole()}
                      <div class="gps-float gps-float-toast"><i></i><span></span></div>
                      <div class="gps-float gps-float-core">${gpsCube()}</div>
                    </div>
                  </div>
                  <div class="gps-hero-copy">
                    <div class="gps-eyebrow" id="gps-ov-eyebrow">Current theme</div>
                    <div class="gps-hero-title" id="gps-ov-theme">Matte Black</div>
                    <div class="gps-hero-sub" id="gps-ov-blurb"></div>
                    <div class="gps-palette" id="gps-ov-palette" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
                    <div class="gps-hero-actions">
                      <button class="gps-btn gps-btn-primary" data-jump="theme">Change theme ${GPS_ICONS.arrow}</button>
                      <button class="gps-btn" data-jump="colors">Build your own</button>
                    </div>
                  </div>
                </div>
                <div class="gps-ov-grid">
                  <button class="gps-ov" data-jump="colors" data-k="accent color overview">
                    <span class="gps-ov-k">Accent</span>
                    <span class="gps-ov-v"><i class="gps-dot" id="gps-ov-accent-dot"></i><span id="gps-ov-accent">#b0b0b0</span></span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                  <button class="gps-ov" data-jump="panel" data-k="panel size overview">
                    <span class="gps-ov-k">Panel</span>
                    <span class="gps-ov-v" id="gps-ov-panel">Full page</span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                  <button class="gps-ov" data-jump="effects" data-k="effects particles overview">
                    <span class="gps-ov-k">Effects</span>
                    <span class="gps-ov-v" id="gps-ov-fx">Off</span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                  <button class="gps-ov" data-jump="type" data-k="typography font overview">
                    <span class="gps-ov-k">Typography</span>
                    <span class="gps-ov-v" id="gps-ov-type">Typewriter</span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                  <button class="gps-ov" data-jump="ai" data-k="ai model openai overview">
                    <span class="gps-ov-k">AI</span>
                    <span class="gps-ov-v" id="gps-ov-ai">OpenAI</span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                  <button class="gps-ov" data-jump="icon" data-k="icon minimized overview">
                    <span class="gps-ov-k">Icon</span>
                    <span class="gps-ov-v" id="gps-ov-icon">Dot</span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                  <button class="gps-ov gps-ov-wide" data-jump="advanced" data-k="personalization reset overview">
                    <span class="gps-ov-k">Personalization</span>
                    <span class="gps-ov-v" id="gps-ov-custom">Default setup</span>
                    <span class="gps-meter" aria-hidden="true"><i id="gps-ov-meter"></i></span>
                    <span class="gps-ov-go">${GPS_ICONS.arrow}</span>
                  </button>
                </div>
              </section>

              <!-- THEME -->
              <section class="gps-sec" data-sec="theme" role="tabpanel" aria-label="Theme">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Theme</h3><p class="gps-sec-desc">Hover or focus a theme to preview it. Click to apply.</p></div>
                  <button class="gps-reset" data-reset="theme">${GPS_ICONS.reset}<span>Reset</span></button>
                </div>
                <div class="gps-item gps-item-flush" data-k="theme preview 3d">
                  <div class="gps-stage gps-stage-wide" data-tilt id="gps-theme-stage">
                    <div class="gps-floor"></div>
                    <div class="gps-rig">
                      ${gpsMiniConsole()}
                      <div class="gps-float gps-float-toast"><i></i><span></span></div>
                      <div class="gps-float gps-float-core">${gpsCube()}</div>
                    </div>
                    <div class="gps-stage-cap" id="gps-theme-cap" aria-live="polite"></div>
                  </div>
                </div>
                <div class="gps-item" data-k="theme signature aurora obsidian arctic solar midnight nebula">
                  <div class="gps-label">Signature</div>
                  <div class="gps-gallery" id="gps-gallery-signature"></div>
                </div>
                <div class="gps-item" data-k="theme classic dark matte red blue purple pink light white">
                  <div class="gps-label">Classic</div>
                  <div class="gps-gallery gps-gallery-sm" id="gps-gallery-classic"></div>
                </div>
                <div class="gps-item" data-k="theme custom your own">
                  <div class="gps-label">Yours</div>
                  <div class="gps-gallery gps-gallery-sm" id="gps-gallery-custom"></div>
                </div>
              </section>

              <!-- COLORS (custom theme builder) -->
              <section class="gps-sec" data-sec="colors" role="tabpanel" aria-label="Colors">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Colors</h3><p class="gps-sec-desc">Build a custom theme. Every change applies live.</p></div>
                  <button class="gps-reset" data-reset="colors">${GPS_ICONS.reset}<span>Reset</span></button>
                </div>
                <div class="gps-item gps-item-flush" data-k="colors custom theme builder background surface text accent secondary glow border particle color picker hex contrast">
                <div class="gps-builder">
                  <div class="gps-builder-preview">
                    <div class="gps-stage gps-stage-compact" data-tilt id="gps-builder-stage">
                      <div class="gps-floor"></div>
                      <div class="gps-rig">${gpsMiniConsole()}<div class="gps-float gps-float-core">${gpsCube()}</div></div>
                      <div class="gps-stage-cap">Custom theme</div>
                    </div>
                    <div class="gps-contrast" id="gps-contrast" aria-live="polite"></div>
                    <p class="gps-hint" id="gps-builder-status"></p>
                    <div class="gps-row">
                      <button class="gps-btn gps-btn-primary" id="gps-use-custom">Use custom theme</button>
                      <button class="gps-btn" id="gps-seed">Start from current theme</button>
                    </div>
                  </div>
                  <div class="gps-colors" id="gps-colors">
                    <!-- rows rendered by the settings module; accent keeps the legacy id -->
                  </div>
                </div>
                </div>
              </section>

              <!-- PANEL -->
              <section class="gps-sec" data-sec="panel" role="tabpanel" aria-label="Panel">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Panel</h3><p class="gps-sec-desc">Size, surface and depth of the console window.</p></div>
                  <button class="gps-reset" data-reset="panel">${GPS_ICONS.reset}<span>Reset</span></button>
                </div>
                <div class="gps-item" data-k="panel interface size compact normal large xl full page window">
                  <div class="gps-label">Size</div>
                  <div class="gps-sizes" role="group" aria-label="Interface size">
                    <button class="size-btn" data-size="compact"><span class="gps-sil" style="--w:30px;--h:40px"></span><span>Compact</span></button>
                    <button class="size-btn" data-size="normal"><span class="gps-sil" style="--w:36px;--h:48px"></span><span>Normal</span></button>
                    <button class="size-btn" data-size="large"><span class="gps-sil" style="--w:42px;--h:56px"></span><span>Large</span></button>
                    <button class="size-btn" data-size="xl"><span class="gps-sil" style="--w:48px;--h:64px"></span><span>XL</span></button>
                    <button class="size-btn" data-size="full"><span class="gps-sil gps-sil-full" style="--w:88px;--h:56px"></span><span>Full page</span></button>
                  </div>
                </div>
                <div class="gps-split">
                <div class="gps-item gps-item-flush gps-split-preview" data-k="panel preview live miniature">
                  <div class="gps-stage gps-stage-compact" data-tilt id="gps-panel-stage">
                    <div class="gps-floor"></div><div class="gps-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
                    <div class="gps-rig gps-rig-live">${gpsMiniConsole()}</div>
                    <div class="gps-stage-cap" id="gps-panel-cap"></div>
                  </div>
                </div>
                <div class="gps-list">
                <div class="gps-item" data-k="panel corner radius round sharp">
                  <label class="gps-label" for="gps-ap-radius">Corner radius <output id="gps-ap-radius-v"></output></label>
                  <input type="range" class="gps-range" id="gps-ap-radius" data-ap="radius" min="30" max="170" step="5" />
                </div>
                <div class="gps-item" data-k="panel transparency opacity glass see through">
                  <label class="gps-label" for="gps-ap-opacity">Opacity <output id="gps-ap-opacity-v"></output></label>
                  <input type="range" class="gps-range" id="gps-ap-opacity" data-ap="opacity" min="70" max="100" step="1" />
                </div>
                <div class="gps-item" data-k="panel blur glass frosted backdrop">
                  <label class="gps-label" for="gps-ap-blur">Background blur <output id="gps-ap-blur-v"></output></label>
                  <input type="range" class="gps-range" id="gps-ap-blur" data-ap="blur" min="0" max="24" step="1" />
                  <p class="gps-hint">Blur shows through when opacity is below 100%.</p>
                </div>
                <div class="gps-item" data-k="panel border outline strength">
                  <label class="gps-label" for="gps-ap-border">Border strength <output id="gps-ap-border-v"></output></label>
                  <input type="range" class="gps-range" id="gps-ap-border" data-ap="border" min="0" max="160" step="5" />
                </div>
                <div class="gps-item" data-k="panel shadow depth elevation">
                  <label class="gps-label" for="gps-ap-shadow">Shadow depth <output id="gps-ap-shadow-v"></output></label>
                  <input type="range" class="gps-range" id="gps-ap-shadow" data-ap="shadow" min="0" max="100" step="5" />
                </div>
                <div class="gps-item" data-k="panel glow halo">
                  <label class="gps-label" for="gps-ap-glow">Glow <output id="gps-ap-glow-v"></output></label>
                  <input type="range" class="gps-range" id="gps-ap-glow" data-ap="glow" min="0" max="100" step="5" />
                </div>
                <div class="gps-item" data-k="panel density spacing compact comfortable spacious padding">
                  <div class="gps-label">Density</div>
                  <div class="gps-seg" role="group" aria-label="Density">
                    <button class="gps-seg-btn" data-density="compact">Compact</button>
                    <button class="gps-seg-btn" data-density="comfortable">Regular</button>
                    <button class="gps-seg-btn" data-density="spacious">Spacious</button>
                  </div>
                </div>
                </div>
                </div>
              </section>

              <!-- EFFECTS -->
              <section class="gps-sec" data-sec="effects" role="tabpanel" aria-label="Effects">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Effects</h3><p class="gps-sec-desc">Ambient particles around the panel edges. They never cover content.</p></div>
                  <button class="gps-reset" data-reset="effects">${GPS_ICONS.reset}<span>Reset</span></button>
                </div>
                <div class="gps-item gps-item-flush" data-k="effects particles preview">
                  <div class="gps-fxstage" id="gps-fxstage">
                    <canvas id="gps-fx-canvas" aria-hidden="true"></canvas>
                    <div class="gps-fx-ghost" aria-hidden="true">${gpsMiniConsole()}</div>
                    <div class="gps-stage-cap" id="gps-fx-cap"></div>
                  </div>
                </div>
                <div class="gps-item" data-k="effects particle style sparkles snow bubbles stars network fireflies confetti off">
                  <div class="gps-label">Particle style</div>
                  <div class="gps-choices gps-choices-8" role="group" aria-label="Particle style">
                    <button class="particle-btn" data-particle="off"><span class="gps-glyph">${GPS_ICONS.off}</span><span>Off</span></button>
                    <button class="particle-btn" data-particle="sparkles"><span class="gps-glyph">${GPS_ICONS.effects}</span><span>Sparkles</span></button>
                    <button class="particle-btn" data-particle="snow"><span class="gps-glyph">${GPS_ICONS.snow}</span><span>Snow</span></button>
                    <button class="particle-btn" data-particle="bubbles"><span class="gps-glyph">${GPS_ICONS.bubbles}</span><span>Bubbles</span></button>
                    <button class="particle-btn" data-particle="stars"><span class="gps-glyph">${GPS_ICONS.star}</span><span>Stars</span></button>
                    <button class="particle-btn" data-particle="network"><span class="gps-glyph">${GPS_ICONS.network}</span><span>Network</span></button>
                    <button class="particle-btn" data-particle="fireflies"><span class="gps-glyph">${GPS_ICONS.firefly}</span><span>Fireflies</span></button>
                    <button class="particle-btn" data-particle="confetti"><span class="gps-glyph">${GPS_ICONS.confetti}</span><span>Confetti</span></button>
                  </div>
                </div>
                <div class="gps-list">
                <div class="gps-item" data-k="effects particle density amount count">
                  <label class="gps-label" for="gps-fx-density">Density <output id="gps-fx-density-v"></output></label>
                  <input type="range" class="gps-range" id="gps-fx-density" data-fx="density" min="0.3" max="2" step="0.1" />
                </div>
                <div class="gps-item" data-k="effects particle size scale">
                  <label class="gps-label" for="gps-fx-size">Particle size <output id="gps-fx-size-v"></output></label>
                  <input type="range" class="gps-range" id="gps-fx-size" data-fx="size" min="0.5" max="2.5" step="0.1" />
                </div>
                <div class="gps-item" data-k="effects particle motion speed">
                  <label class="gps-label" for="gps-fx-speed">Motion <output id="gps-fx-speed-v"></output></label>
                  <input type="range" class="gps-range" id="gps-fx-speed" data-fx="speed" min="0.2" max="2.5" step="0.1" />
                </div>
                <div class="gps-item" data-k="effects particle intensity brightness opacity">
                  <label class="gps-label" for="gps-fx-intensity">Intensity <output id="gps-fx-intensity-v"></output></label>
                  <input type="range" class="gps-range" id="gps-fx-intensity" data-fx="intensity" min="0.2" max="1.5" step="0.05" />
                </div>
                <div class="gps-item" data-k="effects particle play area size margin">
                  <label class="gps-label" for="gpa-particle-size">Play area <output id="gps-fx-area-v"></output></label>
                  <input type="range" id="gpa-particle-size" class="gps-range" min="0" max="260" step="10" />
                </div>
                </div>
              </section>

              <!-- TYPOGRAPHY -->
              <section class="gps-sec" data-sec="type" role="tabpanel" aria-label="Typography">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Typography</h3><p class="gps-sec-desc">How AI answers read and appear.</p></div>
                  <button class="gps-reset" data-reset="type">${GPS_ICONS.reset}<span>Reset</span></button>
                </div>
                <div class="gps-item gps-item-flush" data-k="typography preview sample">
                  <div class="gps-typeprev">
                    <div class="gps-typeprev-k">AI response</div>
                    <div class="gpa-output gps-type-sample" id="gps-type-sample"></div>
                    <button class="gps-btn" id="gps-type-play">${GPS_ICONS.play}<span>Play typing</span></button>
                  </div>
                </div>
                <div class="gps-item" data-k="typography response font typewriter standard mono sans">
                  <div class="gps-label">Response font</div>
                  <div class="gps-choices gps-choices-2" role="group" aria-label="Response font">
                    <button class="font-btn" data-font="mono"><span class="gps-aa gps-aa-mono">Aa</span><span>Typewriter</span></button>
                    <button class="font-btn" data-font="system"><span class="gps-aa">Aa</span><span>Standard</span></button>
                  </div>
                </div>
                <div class="gps-list">
                <div class="gps-item" data-k="typography font size text scale">
                  <label class="gps-label" for="gps-type-size">Text size <output id="gps-type-size-v"></output></label>
                  <input type="range" class="gps-range" id="gps-type-size" data-ty="size" min="11" max="18" step="0.5" />
                </div>
                <div class="gps-item" data-k="typography line height spacing leading">
                  <label class="gps-label" for="gps-type-lh">Line height <output id="gps-type-lh-v"></output></label>
                  <input type="range" class="gps-range" id="gps-type-lh" data-ty="lh" min="1.3" max="2" step="0.05" />
                </div>
                <div class="gps-item" data-k="typography typing animation speed slow normal fast instant">
                  <div class="gps-label">Typing speed</div>
                  <div class="gps-seg" role="group" aria-label="Typing speed">
                    <button class="speed-btn gps-seg-btn" data-speed="slow">Slow</button>
                    <button class="speed-btn gps-seg-btn" data-speed="normal">Normal</button>
                    <button class="speed-btn gps-seg-btn" data-speed="fast">Fast</button>
                    <button class="speed-btn gps-seg-btn" data-speed="instant">Instant</button>
                  </div>
                </div>
                </div>
              </section>

              <!-- ICON STUDIO -->
              <section class="gps-sec" data-sec="icon" role="tabpanel" aria-label="Icon studio">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Icon studio</h3><p class="gps-sec-desc">The button the console shrinks to when minimized.</p></div>
                  <button class="gps-reset" data-reset="icon">${GPS_ICONS.reset}<span>Reset</span></button>
                </div>
                <div class="gps-item gps-item-flush" data-k="icon minimized button preview">
                  <div class="gps-iconstage" aria-hidden="true">
                    <div class="gps-page"><i></i><i></i><i></i><i></i><b></b></div>
                    <div class="gps-mini" id="gps-mini-prev"></div>
                  </div>
                </div>
                <div class="gps-item" data-k="icon minimized glyph dot sparkle bolt orbit chat letter">
                  <div class="gps-label">Glyph</div>
                  <div class="gps-choices gps-choices-6" role="group" aria-label="Minimized button icon">
                    <button class="icon-btn" data-icon="dot"><span class="gps-glyph gps-glyph-txt">✦</span><span>Dot</span></button>
                    <button class="icon-btn" data-icon="sparkle"><span class="gps-glyph">${GPS_ICONS.sparkleFill}</span><span>Sparkle</span></button>
                    <button class="icon-btn" data-icon="bolt"><span class="gps-glyph">${GPS_ICONS.boltFill}</span><span>Bolt</span></button>
                    <button class="icon-btn" data-icon="orbit"><span class="gps-glyph">${GPS_ICONS.orbit}</span><span>Orbit</span></button>
                    <button class="icon-btn" data-icon="chat"><span class="gps-glyph">${GPS_ICONS.chatFill}</span><span>Chat</span></button>
                    <button class="icon-btn" data-icon="letter"><span class="gps-glyph gps-glyph-txt gps-glyph-sans">O</span><span>Letter</span></button>
                  </div>
                </div>
                <div class="gps-list">
                <div class="gps-item" data-k="icon minimized look style futuristic minimal rings">
                  <div class="gps-label">Style</div>
                  <div class="gps-seg" role="group" aria-label="Minimized button look">
                    <button class="look-btn gps-seg-btn" data-look="futuristic">Futuristic rings</button>
                    <button class="look-btn gps-seg-btn" data-look="minimal">Minimal</button>
                  </div>
                </div>
                <div class="gps-item" data-k="icon minimized color mode accent match page">
                  <div class="gps-label">Color</div>
                  <div class="gps-seg" role="group" aria-label="Minimized button color">
                    <button class="colormode-btn gps-seg-btn" data-colormode="theme">Theme accent</button>
                    <button class="colormode-btn gps-seg-btn" data-colormode="page">Match this page</button>
                  </div>
                </div>
                </div>
              </section>

              <!-- AI -->
              <section class="gps-sec" data-sec="ai" role="tabpanel" aria-label="AI">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">AI</h3><p class="gps-sec-desc">OpenAI is the only AI provider this console uses.</p></div>
                </div>
                <div class="gps-item gps-item-flush" data-k="ai openai provider models base smart gpt">
                  <div class="gps-ai">
                    <div class="gps-ai-core" aria-hidden="true">
                      <svg viewBox="0 0 120 120"><circle class="r1" cx="60" cy="60" r="44"/><circle class="r2" cx="60" cy="60" r="30"/><circle class="r3" cx="60" cy="60" r="54"/><g class="orb"><circle cx="104" cy="60" r="4"/></g><g class="orb2"><circle cx="30" cy="60" r="3"/></g><circle class="nucleus" cx="60" cy="60" r="12"/></svg>
                    </div>
                    <div class="gps-ai-copy">
                      <div class="gps-eyebrow">Provider</div>
                      <div class="gps-hero-title">OpenAI</div>
                      <div class="gps-hero-sub" id="gps-ai-route">Requests go through your worker proxy.</div>
                    </div>
                  </div>
                  <div class="gps-models">
                    <div class="gps-model">
                      <div class="gps-model-k">Base AI</div>
                      <div class="gps-model-v" id="gps-ai-base">gpt-4.1-mini</div>
                      <div class="gps-model-d">Everyday answers, chat and page reading</div>
                    </div>
                    <div class="gps-model gps-model-smart">
                      <div class="gps-model-k">Smart AI</div>
                      <div class="gps-model-v" id="gps-ai-smart">gpt-5</div>
                      <div class="gps-model-d">Hard tasks such as quizzes, math and multi-part questions</div>
                    </div>
                  </div>
                </div>
                <div class="gps-list">
                <div class="gps-item gps-item-row" data-k="ai auto upgrade hard tasks smart model">
                  <div><div class="gps-label">Auto-upgrade on hard tasks</div><p class="gps-hint">Owner setting. Hard questions switch to the smart model when on.</p></div>
                  <span class="gps-badge" id="gps-ai-auto">On</span>
                </div>
                <div class="gps-item gps-item-row" data-k="ai reasoning effort">
                  <div><div class="gps-label">Reasoning effort</div><p class="gps-hint">Used by the smart model. Change it in Ask AI.</p></div>
                  <span class="gps-badge" id="gps-ai-reason">Medium</span>
                </div>
                <div class="gps-item gps-item-row" data-k="ai openai api key connection status">
                  <div><div class="gps-label">Connection</div><p class="gps-hint" id="gps-ai-keyhint">Keys are never shown here.</p></div>
                  <span class="gps-badge" id="gps-ai-key">Checking</span>
                </div>
                <div class="gps-item gps-item-row" data-k="ai clear saved openai key">
                  <div><div class="gps-label">Saved OpenAI key</div><p class="gps-hint">Removes the key stored in this browser. An owner-assigned key keeps working.</p></div>
                  <button id="gpa-clear-openai-key" class="gps-btn">Clear key</button>
                </div>
                </div>
                <p class="gps-hint gps-note">Base and smart models reset to gpt-4.1-mini and gpt-5 on every load and sign-in.</p>
              </section>

              <!-- CONTROLS -->
              <section class="gps-sec" data-sec="controls" role="tabpanel" aria-label="Controls">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Controls</h3><p class="gps-sec-desc">Language, voice and page actions.</p></div>
                </div>
                <div class="gps-list">
                <div class="gps-item" data-k="controls language english spanish espanol idioma">
                  <div class="gps-label">Language</div>
                  <div class="gps-seg" role="group" aria-label="Language">
                    <button class="gpa-btn lang-btn gps-seg-btn" data-lang="en">English</button>
                    <button class="gpa-btn lang-btn gps-seg-btn" data-lang="es">Español</button>
                  </div>
                  <p class="gps-hint">Translates navigation, header and sign-in. Deeper screens are still English.</p>
                </div>
                <div class="gps-item gps-item-row" data-k="controls voice read answers aloud speech tts">
                  <div><div class="gps-label">Read answers aloud</div><p class="gps-hint">Speaks AI answers with your browser's voice.</p></div>
                  <button id="gpa-tts-toggle" class="gps-switch">Read answers aloud: OFF</button>
                </div>
                <div class="gps-item gps-item-row" data-k="controls page actions confirm clicks auto">
                  <div><div class="gps-label">Auto-run page clicks</div><p class="gps-hint">When on, harmless "Do it" clicks run without asking. Submit, send, delete and pay always ask.</p></div>
                  <button id="gpa-autoconfirm-toggle" class="gps-switch autoconfirm-btn">Confirm page clicks: ON</button>
                </div>
                </div>
              </section>

              <!-- ACCOUNT -->
              <section class="gps-sec" data-sec="account" role="tabpanel" aria-label="Account">
                <div class="gps-sec-head">
                  <div><h3 id="gpa-account-heading" class="gps-sec-title" style="cursor:default; user-select:none;">Account &amp; sync</h3><p class="gps-sec-desc">Your profile lives in this browser.</p></div>
                </div>
                <div class="gps-item gps-item-row" data-k="account sign out logout user">
                  <div class="gps-who">${GPS_ICONS.account}<span id="gpa-account-who" class="gps-label">Not signed in</span></div>
                  <button id="gpa-logout-btn" class="gps-btn">Sign out</button>
                </div>
                <div class="gps-item" data-k="account sync code copy load transfer device">
                  <div class="gps-label">Sync code</div>
                  <div class="gps-row">
                    <button id="gpa-sync-export" class="gps-btn">Copy sync code</button>
                    <button id="gpa-sync-import" class="gps-btn">Load sync code</button>
                  </div>
                  <textarea id="gpa-sync-box" class="gpa-sync-box gps-textarea" aria-label="Sync code" placeholder="Your sync code appears here. Paste one from another device and press Load sync code."></textarea>
                </div>
                <div class="gps-item" data-k="account cloud sync jsonbin upload download">
                  <div class="gps-label">Cloud auto-sync <span class="gps-tag">JSONBin, optional</span></div>
                  <div class="gps-row">
                    <input id="gpa-cloud-bin" class="gpa-input" placeholder="Bin ID" aria-label="JSONBin bin ID" autocomplete="off" />
                    <input id="gpa-cloud-key" class="gpa-input" type="password" placeholder="X-Master-Key" aria-label="JSONBin master key" autocomplete="off" />
                  </div>
                  <div class="gps-row">
                    <button id="gpa-cloud-push" class="gps-btn">Upload</button>
                    <button id="gpa-cloud-pull" class="gps-btn">Download</button>
                  </div>
                  <div id="gpa-cloud-msg" class="gps-hint"></div>
                </div>
        <!-- Admin console: hidden until unlocked by the secret gesture on the
             "Account & sync" heading (click it 5x) + PIN. Rendered here but
             display:none, and re-hidden on every load. -->
        <div id="gpa-admin" style="display:none; margin-top:16px; border-top:1px dashed var(--gpa-accent,#888); padding-top:12px;">
          <div class="gpa-row" style="justify-content:space-between;">
            <div class="gpa-sub gpa-admin-title">🛠 Admin console</div>
            <button id="gpa-admin-lock" class="gpa-btn">🔒 Lock</button>
          </div>

          <div class="gpa-admin-note" id="gpa-admin-reality"></div>

          <div class="gpa-admin-tabs">
            <button class="gpa-admin-tab primary" data-atab="usage">📊 Usage</button>
            <button class="gpa-admin-tab" data-atab="control">🎛 Control</button>
            <button class="gpa-admin-tab" data-atab="tools">⚙️ Power tools</button>
            <button class="gpa-admin-tab" data-atab="data">🗄 Data</button>
            <button class="gpa-admin-tab" data-atab="diag">🩺 Diagnostics</button>
          </div>

          <!-- Usage / logs -->
          <div class="gpa-admin-pane active" data-apane="usage">
            <div id="gpa-admin-stats" class="gpa-admin-stats"></div>
            <div class="gpa-row" style="margin-top:8px; flex-wrap:wrap;">
              <button id="gpa-admin-refresh" class="gpa-btn" style="flex:1;">↻ Refresh</button>
              <button id="gpa-admin-export-logs" class="gpa-btn" style="flex:1;">⬇ Export logs</button>
              <button id="gpa-admin-clear-logs" class="gpa-btn" style="flex:1;">🗑 Clear logs</button>
            </div>
            <div class="gpa-sub" style="margin:12px 0 4px;">Everyone seen on this browser</div>
            <div id="gpa-admin-users" class="gpa-admin-users"></div>
            <div class="gpa-sub" style="margin:12px 0 4px;">Recent activity</div>
            <div id="gpa-admin-log" class="gpa-admin-log"></div>

            <div class="gpa-sub" style="margin:16px 0 4px;">🌐 Live — everyone using it right now (across all devices)</div>
            <div class="gpa-admin-note">
              Reads from your worker, which only answers with your admin token — so these logs are
              genuinely owner-only and no secret ships in the public script. Needs the worker set up
              with a KV namespace and an ADMIN_TOKEN (see the README). Enter that token once below;
              it's kept only on this device. Every user is shown a one-time notice that usage is recorded.
            </div>
            <div class="gpa-row" style="margin-top:6px;">
              <input id="gpa-tele-token" class="gpa-input" type="password" placeholder="Admin token (matches worker ADMIN_TOKEN)" autocomplete="off" />
            </div>
            <div class="gpa-row">
              <input id="gpa-tele-endpoint" class="gpa-input" placeholder="Worker URL (blank = default)" autocomplete="off" />
            </div>
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-tele-refresh" class="gpa-btn primary" style="flex:1;">🔄 Load live users</button>
              <button id="gpa-tele-auto" class="gpa-btn" style="flex:1;">▶ Auto-refresh: OFF</button>
            </div>
            <div class="gpa-row" style="margin-top:6px;">
              <button id="gpa-tele-private" class="gpa-btn" style="flex:1;">🌍 Private mode: OFF (everyone allowed)</button>
            </div>
            <div id="gpa-tele-live" style="margin-top:8px;"></div>
            <div id="gpa-tele-msg" class="gpa-sub" style="margin-top:4px;"></div>
          </div>

          <!-- Control: things pushed to everyone -->
          <div class="gpa-admin-pane" data-apane="control">
            <div class="gpa-admin-note">
              These push to every client on its next status poll (~15s). They need the worker's
              KV and ADMIN_TOKEN set up, and the admin token entered on the Usage tab.
            </div>
            <div class="gpa-sub" style="margin:10px 0 4px;">📢 Broadcast banner — shown to everyone</div>
            <textarea id="gpa-adm-broadcast" class="gpa-sync-box" style="height:52px;" placeholder="e.g. Heads up: quizzes are disabled during the exam."></textarea>
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-adm-broadcast-send" class="gpa-btn primary" style="flex:1;">Send to everyone</button>
              <button id="gpa-adm-broadcast-clear" class="gpa-btn" style="flex:1;">Clear banner</button>
            </div>
            <div class="gpa-sub" style="margin:14px 0 4px;">📣 Announcement popup — everyone must dismiss it</div>
            <div class="gpa-row">
              <input id="gpa-adm-ann-title" class="gpa-input" placeholder="Title" maxlength="80" autocomplete="off" />
            </div>
            <textarea id="gpa-adm-ann-text" class="gpa-sync-box" style="height:52px;" placeholder="The announcement everyone will see as a popup…"></textarea>
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-adm-ann-send" class="gpa-btn primary" style="flex:1;">Pop up for everyone</button>
              <button id="gpa-adm-ann-clear" class="gpa-btn" style="flex:1;">Clear</button>
            </div>

            <div class="gpa-sub" style="margin:14px 0 4px;">💬 Private chat rooms</div>
            <div class="gpa-row">
              <input id="gpa-adm-room-name" class="gpa-input" placeholder="New room name" maxlength="40" autocomplete="off" />
              <button id="gpa-adm-room-create" class="gpa-btn">Create</button>
            </div>
            <div id="gpa-adm-rooms" class="gpa-admin-users" style="max-height:130px;margin-top:6px;"></div>

            <div class="gpa-sub" style="margin:14px 0 4px;">🔄 Force everyone to update</div>
            <div class="gpa-row">
              <button id="gpa-adm-force-reload" class="gpa-btn" style="flex:1;">Push reload to all clients</button>
            </div>
            <div class="gpa-sub" style="margin-top:4px;">Every open copy re-fetches the script and restarts itself.</div>
            <div class="gpa-sub" style="margin:14px 0 4px;">🚦 Feature switches — off hides it for everyone but you</div>
            <div id="gpa-adm-flags" class="gpa-row" style="flex-wrap:wrap;"></div>

            <div class="gpa-sub" style="margin:14px 0 4px;">🎨 Branding &amp; limits — applies to everyone</div>
            <div class="gpa-row">
              <input id="gpa-adm-brand" class="gpa-input" placeholder='Console name (blank = "Agent Console")' maxlength="60" autocomplete="off" />
            </div>
            <div class="gpa-row">
              <select id="gpa-adm-def-theme" class="gpa-input" style="flex:1;">
                <option value="">Default theme: leave as-is</option>
                <option value="aurora">Aurora</option><option value="obsidian">Obsidian</option>
                <option value="arctic">Arctic</option><option value="solar">Solar</option>
                <option value="midnight">Midnight</option><option value="nebula">Nebula</option>
                <option value="dark">Dark</option><option value="matte">Matte Black</option>
                <option value="red">Red</option><option value="blue">Blue</option>
                <option value="purple">Purple</option><option value="pink">Pink</option>
                <option value="lightblue">Light Blue</option><option value="white">White</option>
              </select>
              <input id="gpa-adm-quota" class="gpa-input" type="number" min="0" step="10" placeholder="Daily request cap (0 = unlimited)" style="flex:1;" />
            </div>
            <div class="gpa-admin-note">Default theme only applies to someone who has never picked a theme themselves — it won't override anyone's own choice. The request cap applies per non-owner user per day.</div>
            <div class="gpa-row">
              <button id="gpa-adm-brand-save" class="gpa-btn primary" style="flex:1;">Save branding &amp; limits</button>
            </div>

            <div class="gpa-sub" style="margin:14px 0 4px;">🛡️ Chat &amp; access controls</div>
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-adm-readonly" class="gpa-btn" style="flex:1;">📢 Read-only chat: OFF</button>
              <button id="gpa-adm-approval" class="gpa-btn" style="flex:1;">🚪 Approval queue: OFF</button>
            </div>
            <div class="gpa-row">
              <input id="gpa-adm-blockedcountries" class="gpa-input" placeholder="Blocked country codes, comma-separated (e.g. KP, RU)" autocomplete="off" />
            </div>
            <div class="gpa-row">
              <input id="gpa-adm-allowedmodels" class="gpa-input" placeholder="Allowed models, comma-separated (blank = allow any)" autocomplete="off" />
            </div>
            <div class="gpa-row">
              <input id="gpa-adm-maxtokens" class="gpa-input" type="number" min="0" step="100" placeholder="Max tokens per request (0 = no cap)" style="flex:1;" />
              <input id="gpa-adm-allowedorigins" class="gpa-input" placeholder="Allowed Origins, comma-separated (blank = allow any)" style="flex:1;" />
            </div>
            <div class="gpa-admin-note">Read-only and the approval queue affect everyone (except you). Country/model/token/Origin limits apply to /v1/* (and country also applies to chat); every one of these is off/empty by default, i.e. no change until you set it.</div>
            <div class="gpa-row">
              <button id="gpa-adm-access-save" class="gpa-btn primary" style="flex:1;">Save access controls</button>
            </div>

            <div class="gpa-sub" style="margin:14px 0 4px;">📜 Audit log</div>
            <div class="gpa-row">
              <button id="gpa-adm-audit-load" class="gpa-btn" style="flex:1;">↻ Load last 100 actions</button>
            </div>
            <div id="gpa-adm-audit" class="gpa-admin-log" style="margin-top:6px;max-height:220px;"></div>

            <div class="gpa-sub" style="margin:14px 0 4px;">💾 Full backup</div>
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-adm-backup-dl" class="gpa-btn" style="flex:1;">⬇ Download backup</button>
              <button id="gpa-adm-restore-btn" class="gpa-btn" style="flex:1;">⬆ Restore from file</button>
            </div>
            <input id="gpa-adm-restore-file" type="file" accept="application/json" style="display:none;" />
            <div class="gpa-admin-note">Backup includes config, every moderation record, every room (and its slow-mode/ban settings), and the audit log. Restore overwrites matching records — it does not first wipe anything the backup doesn't mention.</div>

            <div class="gpa-sub" style="margin:14px 0 4px;">🔑 Assign an API key remotely</div>
            <div class="gpa-admin-note">
              Delivered to each targeted user's own browser automatically (no pasting) — OpenAI keys
              also work invisibly server-side even before that. Assigning a new key overwrites
              whatever key that user already had saved.
            </div>
            <div class="gpa-row">
              <select id="gpa-adm-key-target" class="gpa-input" style="flex:1;">
                <option value="specific">Specific user(s)</option>
                <option value="all">Everyone</option>
              </select>
            </div>
            <div class="gpa-row" id="gpa-adm-key-users-row">
              <input id="gpa-adm-key-users" class="gpa-input" placeholder="username, username2, …" autocomplete="off" />
            </div>
            <div class="gpa-row">
              <input id="gpa-adm-key-value" class="gpa-input" type="password" placeholder="API key to assign" autocomplete="off" />
            </div>
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-adm-key-assign" class="gpa-btn primary" style="flex:1;">Assign</button>
              <button id="gpa-adm-key-remove" class="gpa-btn" style="flex:1;">Remove instead</button>
            </div>
            <div id="gpa-adm-key-msg" class="gpa-sub" style="margin-top:4px;"></div>

            <div id="gpa-adm-control-msg" class="gpa-sub" style="margin-top:6px;"></div>
          </div>

          <!-- Diagnostics -->
          <div class="gpa-admin-pane" data-apane="diag">
            <div class="gpa-row" style="flex-wrap:wrap;">
              <button id="gpa-adm-diag-run" class="gpa-btn primary" style="flex:1;">🩺 Run checks</button>
              <button id="gpa-adm-diag-copy" class="gpa-btn" style="flex:1;">📋 Copy report</button>
            </div>
            <div id="gpa-adm-diag" class="gpa-admin-log" style="margin-top:8px;max-height:260px;"></div>
          </div>

          <!-- Power tools -->
          <div class="gpa-admin-pane" data-apane="tools">
            <div class="gpa-sub" style="margin:4px 0 4px;">Base AI model</div>
            <div class="gpa-row"><select id="gpa-adm-model-sel" class="gpa-input"></select></div>
            <div class="gpa-row"><input id="gpa-adm-model" class="gpa-input" placeholder="Custom model id (e.g. gpt-4.1-mini)" autocomplete="off" style="display:none;" /></div>
            <div class="gpa-sub" style="margin:12px 0 4px;">Smart model — used on hard tasks</div>
            <div class="gpa-row"><select id="gpa-adm-smart-sel" class="gpa-input"></select></div>
            <div class="gpa-row"><input id="gpa-adm-smart" class="gpa-input" placeholder="Custom model id" autocomplete="off" style="display:none;" /></div>
            <div class="gpa-row">
              <button id="gpa-adm-autoupgrade" class="gpa-btn" style="flex:1;">⚡ Auto-upgrade on hard tasks: OFF</button>
            </div>
            <div class="gpa-admin-note">
              Hard tasks — quizzes, multi-part or math-heavy questions — automatically switch to the
              Smart model when auto-upgrade is on, so tough questions get a better answer without
              slowing down the easy ones. Every page load and sign-in resets these to gpt-4.1-mini
              (base) and gpt-5 (smart); a change here lasts until the next reload or sign-in.
            </div>
            <div class="gpa-sub" style="margin:12px 0 4px;">System-prompt prefix (prepended to every AI call)</div>
            <textarea id="gpa-adm-sysprefix" class="gpa-sync-box" style="height:70px;" placeholder="Extra standing instructions for the AI on every request…"></textarea>
            <div class="gpa-row" style="margin-top:8px;">
              <label class="gpa-sub" style="flex:1;">Max page characters sent</label>
              <input id="gpa-adm-maxchars" class="gpa-input" type="number" min="1000" max="200000" step="1000" style="max-width:120px;" />
            </div>
            <div class="gpa-row" style="margin-top:8px;">
              <label class="gpa-sub" style="flex:1;">Temperature (OpenAI, 0–2)</label>
              <input id="gpa-adm-temp" class="gpa-input" type="number" min="0" max="2" step="0.1" style="max-width:120px;" placeholder="default" />
            </div>
            <div class="gpa-row" style="margin-top:10px; flex-wrap:wrap;">
              <button id="gpa-adm-save-tools" class="gpa-btn primary" style="flex:1;">Save power settings</button>
              <button id="gpa-adm-reset-tools" class="gpa-btn" style="flex:1;">Reset to defaults</button>
            </div>
            <div class="gpa-sub" style="margin:16px 0 4px;">Raw AI playground</div>
            <textarea id="gpa-adm-play-sys" class="gpa-sync-box" style="height:50px;" placeholder="System prompt (optional)"></textarea>
            <textarea id="gpa-adm-play-user" class="gpa-sync-box" style="height:60px;" placeholder="User message — send straight to the model, bypassing all the panel's own prompts"></textarea>
            <div class="gpa-row">
              <button id="gpa-adm-play-run" class="gpa-btn primary" style="flex:1;">▶ Run raw prompt</button>
            </div>
            <div id="gpa-adm-play-out" class="gpa-admin-log" style="margin-top:6px;"></div>
            <div id="gpa-adm-tools-msg" class="gpa-sub" style="margin-top:4px;"></div>
          </div>

          <!-- Data -->
          <div class="gpa-admin-pane" data-apane="data">
            <div class="gpa-sub" style="margin:4px 0 4px;">🔑 API keys on this device</div>
            <div id="gpa-adm-keys" class="gpa-admin-users" style="max-height:none;"></div>
            <div class="gpa-sub" style="margin:14px 0 4px;">Every gpa_* value in this browser (editable)</div>
            <div id="gpa-adm-ls" class="gpa-admin-ls"></div>
            <div class="gpa-row" style="margin-top:8px; flex-wrap:wrap;">
              <button id="gpa-adm-ls-refresh" class="gpa-btn" style="flex:1;">↻ Refresh</button>
              <button id="gpa-adm-dump" class="gpa-btn" style="flex:1;">⬇ Export everything</button>
              <button id="gpa-adm-wipe" class="gpa-btn" style="flex:1;">💥 Wipe all data</button>
            </div>
            <div id="gpa-adm-data-msg" class="gpa-sub" style="margin-top:4px;"></div>
          </div>
        </div>
              </section>

              <!-- ADVANCED -->
              <section class="gps-sec" data-sec="advanced" role="tabpanel" aria-label="Advanced">
                <div class="gps-sec-head">
                  <div><h3 class="gps-sec-title">Advanced</h3><p class="gps-sec-desc">Keys and resets. Resets never touch your account, notes or saved work.</p></div>
                </div>
                <div class="gps-list">
                <div class="gps-item gps-item-row" data-k="advanced youtube key clear music">
                  <div><div class="gps-label">Saved YouTube key</div><p class="gps-hint">Used by Music search.</p></div>
                  <button id="gpa-clear-yt-key" class="gps-btn">Clear key</button>
                </div>
                <div class="gps-item gps-item-row" data-k="advanced reset theme colors">
                  <div><div class="gps-label">Reset theme</div><p class="gps-hint">Theme choice and custom colors.</p></div>
                  <button class="gps-btn" data-reset="theme">Reset theme</button>
                </div>
                <div class="gps-item gps-item-row" data-k="advanced reset appearance panel effects typography icon">
                  <div><div class="gps-label">Reset appearance</div><p class="gps-hint">Panel, effects, typography and icon.</p></div>
                  <button class="gps-btn" data-reset="appearance">Reset appearance</button>
                </div>
                <div class="gps-item gps-item-row gps-danger-zone" data-k="advanced reset all settings defaults">
                  <div><div class="gps-label">Reset all settings</div><p class="gps-hint">Every setting on this page, for this profile. Account, keys, notes and saved items stay.</p></div>
                  <button class="gps-btn gps-btn-danger" data-reset="all">Reset all</button>
                </div>
                </div>
              </section>

              <div class="gps-empty" id="gps-empty" hidden>
                ${GPS_ICONS.search}
                <div class="gps-label">No settings match that search.</div>
                <p class="gps-hint">Try words like theme, font, particles or panel.</p>
              </div>
            </div>
          </div>
          <div class="gps-dialog-scrim" id="gps-dialog" hidden>
            <div class="gps-dialog" role="alertdialog" aria-modal="true" aria-labelledby="gps-dialog-title" aria-describedby="gps-dialog-body">
              <div class="gps-dialog-title" id="gps-dialog-title"></div>
              <p class="gps-dialog-body" id="gps-dialog-body"></p>
              <div class="gps-row gps-dialog-actions">
                <button class="gps-btn" id="gps-dialog-cancel">Cancel</button>
                <button class="gps-btn gps-btn-danger" id="gps-dialog-ok">Reset</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </main>
    </div>
  `;

  const minimized = document.createElement('div');
  minimized.className = 'gpa-mini';
  minimized.style.display = 'none';
  panel.appendChild(minimized);

  // ---- Toasts ---------------------------------------------------------
  // Replaces window.alert() everywhere in this file: non-blocking, themed,
  // auto-dismissing. alert() froze the whole page (and the panel with it)
  // for a message that was usually just informational.
  // A shaped placeholder for "the AI is thinking" spots, replacing plain
  // "Thinking…"/"Loading…" text — every such call site overwrites this with
  // real content once a response arrives, so it's always transient.
  const SKELETON_HTML = '<div class="gpa-skeleton"><div class="gpa-skeleton-line" style="width:88%"></div><div class="gpa-skeleton-line" style="width:64%"></div><div class="gpa-skeleton-line" style="width:74%"></div></div>';

  const toastWrap = panel.querySelector('#gpa-toast-wrap');
  function showToast(message, opts) {
    opts = opts || {};
    // Falls back to a native alert if the panel has already been torn down
    // (e.g. a reload failure after the old instance removed its own DOM) —
    // better a jarring alert than a toast nobody will ever see.
    if (!toastWrap || !toastWrap.isConnected) { alert(message); return; }
    const el = document.createElement('div');
    el.className = 'gpa-toast' + (opts.type === 'danger' ? ' danger' : '');
    el.textContent = message;
    toastWrap.appendChild(el);
    const ttl = opts.duration || 4200;
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 200);
    }, ttl);
  }

  // Original, non-trademarked icon options for the minimized button — not
  // reproductions of any company's actual logo. "Letter" shows O.
  const MINI_ICONS = {
    dot: '✦',
    sparkle: '<svg viewBox="0 0 24 24"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    orbit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9" ry="4" fill="none" stroke="#fff" stroke-width="1.6"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 4h16v11H8l-4 4z"/></svg>'
  };

  function renderMiniIcon() {
    const style = localStorage.getItem(ICON_KEY) || 'dot';
    if (style === 'letter') {
      minimized.textContent = 'O';
    } else {
      minimized.innerHTML = MINI_ICONS[style] || MINI_ICONS.dot;
    }
  }
  renderMiniIcon();

  // "Futuristic" (default) keeps the spinning rings/pulse; "Minimal" is a
  // calmer, low-key badge for anyone who'd rather it not stand out visually.
  function applyMiniLook() {
    const look = localStorage.getItem(ICON_LOOK_KEY) || 'minimal';
    minimized.classList.toggle('gpa-mini-minimal', look === 'minimal');
  }
  applyMiniLook();

  // Samples the actual page's own colors so the minimized badge can blend
  // with whatever site it's sitting on, instead of always using the panel's
  // theme accent color.
  function getPageAccentColor() {
    const linkEl = document.querySelector('a');
    const linkColor = linkEl && parseRgbString(getComputedStyle(linkEl).color);
    if (linkColor && (linkColor.r + linkColor.g + linkColor.b) > 0) return linkColor;
    const bodyBg = parseRgbString(getComputedStyle(document.body).backgroundColor);
    const bg = (bodyBg && bodyBg.a > 0.05) ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
    const lum = relativeLuminance(bg);
    return lum < 0.5 ? { r: 225, g: 228, b: 235 } : { r: 55, g: 60, b: 72 };
  }

  function applyMiniColorMode() {
    const mode = localStorage.getItem(ICON_COLOR_MODE_KEY) || 'page';
    if (mode === 'page') {
      const c = getPageAccentColor();
      const core = `rgb(${c.r}, ${c.g}, ${c.b})`;
      minimized.style.background = `radial-gradient(circle at 35% 30%, ${core}, ${THEMES[theme].bg} 78%)`;
      minimized.style.boxShadow = `0 0 10px 1px rgba(${c.r}, ${c.g}, ${c.b}, 0.45), 0 6px 16px rgba(0,0,0,0.35)`;
    } else {
      minimized.style.background = '';
      minimized.style.boxShadow = '';
    }
  }
  applyMiniColorMode();

  // Applies a theme by writing its tokens as CSS custom properties. The main
  // stylesheet is built once below and never rewritten, so switching themes
  // doesn't restart animations or flash. opts.instant skips the crossfade
  // (used while dragging a color picker); opts.preview leaves storage alone.
  let themeFadeTimer = null;
  function applyTheme(name, opts) {
    opts = opts || {};
    theme = THEMES[name] ? name : 'matte';
    if (!opts.preview) localStorage.setItem(THEME_KEY, theme);
    if (typeof updateWelcome3dColor === 'function') updateWelcome3dColor();
    const tk = resolveTheme(theme);
    if (!opts.instant && tokenStyle.textContent) {
      panel.classList.add('gpa-theming');
      clearTimeout(themeFadeTimer);
      themeFadeTimer = setTimeout(() => panel.classList.remove('gpa-theming'), 520);
    }
    tokenStyle.textContent = tokenCss(tk, appearance);
    if (typeof applyMiniColorMode === 'function') applyMiniColorMode();
    if (typeof onThemeApplied === 'function') onThemeApplied();
  }
  // Re-writes the tokens after an appearance (Panel section) change.
  function applyAppearance(next, opts) {
    appearance = { ...appearance, ...next };
    if (!(opts && opts.transient)) {
      try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); } catch (e) { /* storage blocked */ }
    }
    tokenStyle.textContent = tokenCss(resolveTheme(theme), appearance);
  }
  style.textContent = `
      * { box-sizing: border-box; font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      /* Scoped to this panel's own shadow root, so it never touches the host
         page: anyone with reduced-motion turned on gets every transition and
         animation in here collapsed to effectively instant, same as the
         rest of a well-behaved page would. */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.001ms !important; animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important; scroll-behavior: auto !important;
        }
      }
      .gpa-particle-wrap { position: relative; }
      #gpa-particles {
        position: absolute; z-index: 0; pointer-events: none; display: none;
      }
      .gpa-panel { position: relative; z-index: 1; }
      .gpa-panel {
        width: 360px;
        height: 480px;
        display: flex;
        flex-direction: column;
        background: var(--gpa-atmos), var(--gpa-bg-t);
        color: var(--gpa-text);
        border: 1px solid var(--gpa-border);
        border-radius: calc(20px * var(--gpa-rs));
        box-shadow: var(--gpa-panel-shadow);
        backdrop-filter: var(--gpa-panel-blur); -webkit-backdrop-filter: var(--gpa-panel-blur);
        overflow: hidden;
        user-select: none;
        animation: gpa-panel-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .gpa-panel.gpa-fullpage { border-radius: calc(16px * var(--gpa-rs)); }
      @keyframes gpa-panel-in {
        from { opacity: 0; transform: scale(0.97) translateY(6px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-header {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px;
        background: var(--gpa-panel-t);
        cursor: grab;
        border-bottom: 1px solid var(--gpa-border);
        flex-shrink: 0;
      }
      .gpa-panel.gpa-fullpage .gpa-header { cursor: default; }
      .gpa-header:active { cursor: grabbing; }
      #gpa-sidebar-toggle, #gpa-min, #gpa-reload, #gpa-console-fullscreen, #gpa-close {
        width: 26px; height: 26px; border-radius: calc(8px * var(--gpa-rs));
        border: 1px solid transparent;
        background: transparent;
        color: var(--gpa-sub);
        font-size: 14px; line-height: 1; cursor: pointer;
        display:flex; align-items:center; justify-content:center;
        flex-shrink: 0;
        transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
      }
      #gpa-sidebar-toggle:hover, #gpa-min:hover, #gpa-reload:hover, #gpa-console-fullscreen:hover { background: var(--gpa-field); color: var(--gpa-text); }
      #gpa-sidebar-toggle.active { background: var(--gpa-accent); color: var(--gpa-accent-fg); }
      #gpa-min:active, #gpa-reload:active, #gpa-console-fullscreen:active, #gpa-close:active { transform: scale(0.92); }
      #gpa-reload:disabled { opacity: 0.5; cursor: default; }
      #gpa-reload.spinning { animation: gpa-spin 0.8s linear infinite; }
      @keyframes gpa-spin { to { transform: rotate(360deg); } }
      .gpa-title {
        font-size: 14px; font-weight: 600; flex: 1;
        color: var(--gpa-text);
      }
      .gpa-dot {
        width: 6px; height: 6px; border-radius: 50%; background: var(--gpa-accent); flex-shrink:0;
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--gpa-accent) 50%, transparent);
        animation: gpa-dot-pulse 2.4s ease-in-out infinite;
      }
      @keyframes gpa-dot-pulse {
        0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gpa-accent) 33%, transparent); }
        50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--gpa-accent) 0%, transparent); }
      }
      #gpa-close:hover { background: #e5453a; color: #fff; }
      .gpa-body { flex: 1; display: flex; flex-direction: row; min-height: 0; }
      .gpa-sidebar {
        flex-shrink: 0; width: 190px; padding: 12px 8px;
        background: var(--gpa-panel-t); border-right: 1px solid var(--gpa-border);
        overflow-y: auto; overflow-x: hidden;
        transition: width 0.26s cubic-bezier(0.16, 1, 0.3, 1), padding 0.26s cubic-bezier(0.16, 1, 0.3, 1),
                    opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.26s cubic-bezier(0.16, 1, 0.3, 1),
                    visibility 0s linear 0s;
      }
      /* Collapsed: just the active tool's content shows, full width — the
         header's toggle button (always visible) brings the sidebar back.
         Animated (width/opacity, not display:none) so both the manual
         toggle and the auto-close-on-tab-select below have something to
         actually animate; visibility switches to hidden only once the rest
         of the transition finishes, so nothing sits invisible-but-clickable
         mid-animation, and switches back to visible immediately on reopen. */
      .gpa-panel.gpa-sidebar-hidden .gpa-sidebar {
        width: 0; padding-left: 0; padding-right: 0; opacity: 0; border-color: transparent;
        pointer-events: none; visibility: hidden;
        transition-delay: 0s, 0s, 0s, 0s, 0.26s;
      }
      .gpa-main {
        flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden;
        padding: calc(16px * var(--gpa-dz)); user-select: text;
        display: flex; flex-direction: column;
      }
      .gpa-dropdown { position: relative; }
      .gpa-dropdown-btn {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        padding: 9px 12px; font-size: 12px; font-weight: 600;
        cursor: pointer; color: var(--gpa-text);
        border: 1px solid var(--gpa-border);
        border-radius: calc(10px * var(--gpa-rs));
        background: var(--gpa-field);
        transition: border-color 0.15s ease;
      }
      .gpa-dropdown-btn { display: none; }
      .gpa-chevron { display: none; }
      .gpa-dropdown-menu {
        position: static; display: flex; flex-direction: column; gap: 2px;
        background: transparent; border: none; box-shadow: none;
        opacity: 1; transform: none; pointer-events: auto; overflow: visible;
      }
      .gpa-dropdown-item {
        position: relative;
        display: flex; align-items: center; gap: 9px;
        text-align: left; padding: 8px 10px;
        font-size: 12.5px; font-weight: 500; color: var(--gpa-sub); line-height: 1.3;
        background: transparent; border: 1px solid transparent; border-radius: calc(9px * var(--gpa-rs));
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
      }
      .gpa-nav-ic { flex-shrink: 0; width: 16px; text-align: center; opacity: 0.85; font-size: 13px; }
      .gpa-dropdown-item:hover { background: var(--gpa-field); color: var(--gpa-text); }
      .gpa-dropdown-item:active { transform: scale(0.98); }
      .gpa-dropdown-item:focus-visible { outline: 2px solid var(--gpa-accent); outline-offset: 1px; }
      .gpa-dropdown-item.active {
        color: var(--gpa-accent-fg); background: var(--gpa-accent);
      }
      .gpa-dropdown-item.active::before { content: none; }
      .gpa-chat-badge {
        margin-left: auto; position: static;
        min-width: 16px; height: 16px; padding: 0 4px;
        border-radius: 999px; background: #e5453a; color: #fff;
        font-size: 9.5px; font-weight: 700; text-align: center;
        display: inline-flex; align-items: center; justify-content: center;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }
      .gpa-pane { display: none; }
      .gpa-pane.active {
        display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0;
        /* Capped and centered rather than left-anchored and stretched full
           width — on a huge full-page/fullscreen panel, letting every pane's
           text boxes, buttons, and rows stretch to 1800+px reads as broken
           (giant sparse buttons, absurd text line-length) even though it's
           technically "using the space". Below the cap this is a no-op:
           the default/compact/normal panel sizes are already narrower than
           it, so nothing changes for them. */
        width: 100%; max-width: 1100px; margin: 0 auto;
        animation: gpa-pane-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      /* Browser (an embedded page) and Games (boards/canvases with their own
         fullscreen mode) are the two panes where more width actually helps
         rather than just adding empty margin — let those two fill the full
         available width instead of the shared reading-width cap above. */
      .gpa-pane.active[data-pane="browser"], .gpa-pane.active[data-pane="games"] {
        max-width: none;
      }
      @keyframes gpa-pane-in {
        from { opacity: 0; transform: translateY(3px); }
        to { opacity: 1; transform: translateY(0); }
      }
      /* flex-wrap by default: a row of buttons/inputs that doesn't fit the
         current panel width wraps onto another line instead of forcing the
         whole pane wider — the previous no-wrap default is what caused
         content to overflow past the panel's edge and get clipped by its
         own overflow:hidden, showing up as an unexpected horizontal
         scrollbar or answers/controls that looked "cut off". */
      .gpa-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; flex-shrink: 0; }
      .gpa-actions { flex-wrap: wrap; }
      /* Page Insights: one full-width flowing column of cards, the same
         convention every other pane already uses (Notes, Humanize, Study…),
         not a fixed-width scrolling rail beside a separate output column.
         That split used to force buttons into equal-width flex:1 slots
         (the actual cause of the Auto-explain overflow bug — see the old
         history of this rule) and needed its own nested scrollbar; a plain
         vertical stack has neither problem, and buttons here get the exact
         same safe, content-width, wraps-naturally sizing every other card's
         buttons already have via .gpa-row's default flex-wrap. */
      .gpa-scan-flow, .gpa-welcome-flow { display: flex; flex-direction: column; gap: 16px; flex: 1; min-height: 0; min-width: 0; }
      /* .gpa-btn's base white-space:nowrap is safe everywhere else, but this
         tab's fixed sidebar (190px) can leave .gpa-main under 100px wide at
         the Compact preset — confirmed by measuring actual rendered widths,
         not assumed — and a handful of labels here ("Confirm page clicks:
         ON", "Solve quiz on this page") simply cannot fit on one line in
         that space at any font size. Letting the label wrap onto a second
         line inside the button (content-driven height, per the "don't clip
         text in a fixed-width box" rule) is the fix; the row's flex-wrap
         alone can't help since that only moves whole buttons to new lines,
         not the text within one. */
      .gpa-scan-flow .gpa-btn, .gpa-welcome-flow .gpa-btn { white-space: normal; min-width: 0; text-align: center; }
      /* text <input> elements default to a sizable browser-intrinsic
         min-width that flex: 1 alone doesn't override — confirmed via
         measurement as the last remaining overflow source at Compact
         (the command-bar and question inputs), even after the button fix
         above. min-width: 0 is the standard, universally-safe fix for a
         flex-item input; scoped here rather than on the shared .gpa-input
         rule to keep this change to the tab that was actually tested. */
      .gpa-scan-flow .gpa-input, .gpa-welcome-flow .gpa-input { min-width: 0; }
      /* Welcome pane: greeting heading, the small ambient 3D accent canvas,
         and the news-summary paragraph. Kept minimal — everything else
         (cards, stat grid, buttons) reuses Page Insights' existing classes
         as-is, per the plan's "reuse, don't duplicate" rule. */
      .gpa-welcome-greeting { font-size: 18px; font-weight: 700; color: var(--gpa-text); text-wrap: balance; line-height: 1.3; }
      /* Reuses the existing gpa-blink keyframes (defined above for the AI
         streaming cursor) so both blink at the same rate — this one just
         never gets removed. */
      .gpa-welcome-cursor { color: var(--gpa-accent); animation: gpa-blink 0.85s steps(1) infinite; }
      /* Provider status line: deliberately smaller than both the greeting
         and its date sub-line, but the pulsing dot keeps it noticeable
         without competing for attention. */
      .gpa-welcome-ai-status { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 5px; font-size: 10.5px; color: var(--gpa-sub); }
      .gpa-welcome-ai-line { display: inline-flex; align-items: center; gap: 5px; }
      .gpa-status-dot {
        display: inline-block; width: 6px; height: 6px; border-radius: 50%;
        background: #9ca3af; flex-shrink: 0;
      }
      .gpa-status-dot.checking { background: #f59e0b; animation: gpa-status-pulse 0.9s ease-in-out infinite; }
      .gpa-status-dot.online {
        background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,0.6);
        animation: gpa-live-pulse 2s ease-out infinite;
      }
      .gpa-status-dot.down { background: #ef4444; animation: gpa-status-pulse 1.4s ease-in-out infinite; }
      .gpa-status-dot.unset { background: #6b7280; }
      @keyframes gpa-status-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      #gpa-welcome-3d { width: 140px; height: 140px; flex-shrink: 0; border-radius: calc(12px * var(--gpa-rs)); }
      .gpa-welcome-news-text { font-size: 13px; line-height: 1.6; color: var(--gpa-text); white-space: pre-wrap; overflow-wrap: break-word; }
      /* A slow-drifting conic-gradient ring behind the greeting card, muted
         enough to read as ambient texture rather than a light show — and
         the existing reduced-motion override (top of this stylesheet)
         already freezes its animation-duration, no extra guard needed. */
      .gpa-welcome-hero { position: relative; overflow: hidden; }
      .gpa-welcome-hero::before {
        content: ''; position: absolute; inset: -60%; z-index: 0; opacity: 0.14;
        background: conic-gradient(from 0deg, var(--gpa-accent), transparent 30%, transparent 70%, var(--gpa-accent));
        animation: gpa-hero-spin 14s linear infinite;
      }
      .gpa-welcome-hero > * { position: relative; z-index: 1; }
      @keyframes gpa-hero-spin { to { transform: rotate(360deg); } }
      .gpa-live-dot {
        display: inline-block; width: 7px; height: 7px; border-radius: 50%;
        background: #22c55e; margin-right: 5px; vertical-align: middle;
        box-shadow: 0 0 0 0 rgba(34,197,94,0.6);
        animation: gpa-live-pulse 2s ease-out infinite;
      }
      @keyframes gpa-live-pulse {
        0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
        70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
      }
      .gpa-welcome-quick-row { flex-wrap: wrap; gap: 8px; }
      .gpa-welcome-quick { flex: 1 1 auto; min-width: 100px; }
      /* "Ask about it" is deliberately not a .gpa-card — no box, no border —
         it's a section heading inside the same flowing column, immediately
         followed by its own output area below. */
      .gpa-scan-ask-section { flex-shrink: 0; }
      /* Page snapshot: always populated the instant the tab opens (plain DOM
         stats, no AI call, no button to click) so there's real content here
         before the user has scanned anything, instead of an empty card. */
      /* min(110px, 100%) as the track floor, not a bare 110px: a bare pixel
         floor never shrinks below itself even when the grid's own container
         is narrower (confirmed via testing at the Compact 300px preset,
         where the fixed sidebar leaves .gpa-main under 110px wide) — the
         grid then forces a horizontal scrollbar on the entire tab instead of
         just stacking to one column, exactly the "content wider than
         viewport" anti-pattern. Capping the floor at 100% lets it shrink to
         fit when the container itself is the constraint. */
      .gpa-snapshot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(110px, 100%), 1fr)); gap: 8px; }
      .gpa-snapshot-stat {
        background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: calc(10px * var(--gpa-rs));
        padding: 8px 10px;
      }
      .gpa-snapshot-num { font-size: 16px; font-weight: 700; color: var(--gpa-accent); line-height: 1.2; }
      .gpa-snapshot-label { font-size: 10.5px; color: var(--gpa-sub); margin-top: 2px; overflow-wrap: anywhere; }
      /* Tone & insight gauges: a sequential (single-hue, magnitude) bar for
         formality/complexity, and a diverging (two-hue + neutral midpoint)
         bar for sentiment, since positive/negative is a polarity, not a
         magnitude — one hue for that would falsely imply "more" rather than
         "which direction". Colors are the validated default diverging pair
         (blue/red) at the correct step for this panel's current light or
         dark surface, not the user's chosen accent — sentiment's red/blue
         reads consistently regardless of which of the 8 UI themes is active,
         the same reasoning the reserved status palette uses. */
      .gpa-gauge { margin-bottom: 12px; }
      .gpa-gauge:last-child { margin-bottom: 0; }
      .gpa-gauge-label { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--gpa-sub); margin-bottom: 4px; }
      .gpa-gauge-value { color: var(--gpa-text); font-weight: 600; }
      .gpa-gauge-track { position: relative; height: 8px; border-radius: 4px; background: var(--gpa-field); border: 1px solid var(--gpa-border); overflow: hidden; }
      .gpa-gauge-fill { position: absolute; top: 0; bottom: 0; border-radius: 4px; transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1), left 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
      .gpa-gauge-mid { position: absolute; top: -2px; bottom: -2px; left: 50%; width: 1px; background: var(--gpa-sub); opacity: 0.6; }
      /* Explore further: clickable related-topic chips that feed straight
         into the existing question box below, rather than a separate flow. */
      .gpa-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .gpa-chip {
        background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: 999px;
        padding: 6px 12px; font-size: 11.5px; color: var(--gpa-text); cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease;
      }
      .gpa-chip:hover { border-color: color-mix(in srgb, var(--gpa-accent) 50%, transparent); background: var(--gpa-panel); }
      .gpa-chip:active { transform: scale(0.97); }
      .gpa-card {
        background: var(--gpa-card-bg); border: 1px solid var(--gpa-border); border-radius: calc(14px * var(--gpa-rs));
        padding: calc(14px * var(--gpa-dz)); flex-shrink: 0;
      }
      .gpa-card-title {
        font-size: 12px; font-weight: 600; color: var(--gpa-text); margin-bottom: 10px;
      }
      .gpa-input {
        flex: 1; padding: calc(8px * var(--gpa-dz)) calc(11px * var(--gpa-dz)); border-radius: calc(9px * var(--gpa-rs));
        border: 1px solid var(--gpa-border); background: var(--gpa-field); color: var(--gpa-text);
        font-size: 13px; outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .gpa-input:focus { border-color: var(--gpa-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 16%, transparent); }
      .gpa-btn {
        padding: calc(8px * var(--gpa-dz)) calc(13px * var(--gpa-dz)); border: 1px solid var(--gpa-border);
        border-radius: calc(9px * var(--gpa-rs));
        background: var(--gpa-field); color: var(--gpa-text); font-size: 12px; font-weight: 500;
        cursor: pointer; white-space: nowrap;
        transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
      }
      .gpa-btn:hover { border-color: color-mix(in srgb, var(--gpa-accent) 50%, transparent); background: var(--gpa-panel); }
      .gpa-btn:active { transform: scale(0.97); }
      .gpa-btn:focus-visible { outline: 2px solid var(--gpa-accent); outline-offset: 1px; }
      .gpa-btn.primary { background: var(--gpa-accent); color: var(--gpa-accent-fg); border-color: var(--gpa-accent); }
      .gpa-btn.primary:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 20%, transparent); }
      .gpa-btn.danger { background: transparent; color: #e5453a; border-color: #e5453a55; }
      .gpa-btn.danger:hover { background: #e5453a1a; border-color: #e5453a; }
      /* A joined 3-way control (e.g. reasoning effort), not 3 loose buttons */
      .gpa-segmented { display: flex; flex: 1; border: 1px solid var(--gpa-border); border-radius: calc(9px * var(--gpa-rs)); overflow: hidden; }
      .gpa-segmented .gpa-btn {
        flex: 1; border: none; border-radius: 0; background: transparent;
        border-right: 1px solid var(--gpa-border);
      }
      .gpa-segmented .gpa-btn:last-child { border-right: none; }
      .gpa-segmented .gpa-btn:hover { background: var(--gpa-field); }
      .gpa-segmented .gpa-btn.primary { background: var(--gpa-accent); color: var(--gpa-accent-fg); }
      .gpa-segmented .gpa-btn.primary:hover { background: var(--gpa-accent); }
      .gpa-segmented .gpa-btn:disabled { opacity: 0.4; }
      .quiz-btn {
        width: 100%; padding: 12px; font-size: 13px; font-weight: 600;
        border: none; border-radius: calc(12px * var(--gpa-rs)); cursor: pointer;
        color: var(--gpa-accent-fg); background: var(--gpa-accent);
        box-shadow: 0 4px 16px color-mix(in srgb, var(--gpa-accent) 25%, transparent);
        transition: transform 0.1s ease, box-shadow 0.15s ease;
      }
      .quiz-btn:hover { box-shadow: 0 6px 20px color-mix(in srgb, var(--gpa-accent) 33%, transparent); }
      .quiz-btn:active { transform: scale(0.98); }
      .quiz-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
      .gpa-sub {
        color: var(--gpa-sub); font-size: 11.5px; flex: 1;
      }
      .gpa-output {
        /* flex: 1 1 auto with a min-height — grows to fill whatever room the
           pane actually has (a lot, in the full-page panel size) instead of
           capping out at a fixed height and leaving the rest of a large
           panel empty, but still won't collapse below min-height when rows
           of buttons above/below it are competing for space in a small
           panel. Content beyond the box's size scrolls inside it. */
        margin-top: 8px; flex: 1 1 auto; min-height: 100px; overflow-y: auto;
        font-size: var(--gpa-out-size, 13px); line-height: var(--gpa-out-lh, 1.6); white-space: pre-wrap;
        overflow-wrap: break-word; word-break: break-word;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        padding: 12px; background: var(--gpa-field); border-radius: calc(12px * var(--gpa-rs));
        border: 1px solid var(--gpa-border);
      }
      .gpa-output:empty { display: none; }
      .gpa-error {
        display: flex; align-items: flex-start; gap: 8px;
        background: rgba(229, 69, 58, 0.1); border: 1px solid rgba(229, 69, 58, 0.35);
        border-radius: calc(10px * var(--gpa-rs)); padding: 10px 12px; color: var(--gpa-text);
      }
      .gpa-error-icon { flex-shrink: 0; font-size: 14px; line-height: 1.4; }
      /* Small solid-fill status/count chips — square-ish, not decorative pills */
      .gpa-badge {
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: calc(6px * var(--gpa-rs));
        font-variant-numeric: tabular-nums;
      }
      /* A real switch, replacing buttons whose label text used to flip ON/OFF */
      .gpa-toggle {
        display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
        font-size: 12px; color: var(--gpa-text); background: transparent; border: none; padding: 0;
      }
      .gpa-toggle-track {
        width: 34px; height: 20px; border-radius: 999px; background: var(--gpa-field);
        border: 1px solid var(--gpa-border); position: relative; flex-shrink: 0;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .gpa-toggle-thumb {
        position: absolute; top: 1px; left: 1px; width: 16px; height: 16px;
        border-radius: 50%; background: var(--gpa-sub);
        transition: transform 0.15s ease, background 0.15s ease;
      }
      .gpa-toggle.on .gpa-toggle-track { background: color-mix(in srgb, var(--gpa-accent) 20%, transparent); border-color: var(--gpa-accent); }
      .gpa-toggle.on .gpa-toggle-thumb { transform: translateX(14px); background: var(--gpa-accent); }
      /* Lightweight non-blocking notifications, replacing window.alert() */
      .gpa-toast-wrap {
        position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
        z-index: 60; display: flex; flex-direction: column; gap: 6px; align-items: center;
        pointer-events: none; max-width: 90%;
      }
      .gpa-toast {
        pointer-events: auto;
        background: var(--gpa-panel); color: var(--gpa-text); border: 1px solid var(--gpa-border);
        border-radius: calc(10px * var(--gpa-rs)); padding: 9px 14px; font-size: 12px; line-height: 1.4;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        animation: gpa-toast-in 0.18s ease both;
        max-width: 100%; overflow-wrap: break-word;
      }
      .gpa-toast.danger { border-color: #e5453a99; }
      .gpa-toast.fade-out { animation: gpa-toast-out 0.18s ease both; }
      @keyframes gpa-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes gpa-toast-out { from { opacity: 1; } to { opacity: 0; } }
      /* Simple skeleton blocks, replacing plain "Thinking…"/"Loading…" text */
      .gpa-skeleton { display: flex; flex-direction: column; gap: 7px; padding: 2px 0; }
      .gpa-skeleton-line {
        height: 11px; border-radius: calc(6px * var(--gpa-rs));
        background: linear-gradient(90deg, var(--gpa-field) 25%, var(--gpa-border) 50%, var(--gpa-field) 75%);
        background-size: 200% 100%; animation: gpa-skeleton-sweep 1.3s ease-in-out infinite;
      }
      @keyframes gpa-skeleton-sweep { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      .gpa-cursor {
        display: inline-block; width: 2px; height: 1em;
        background: var(--gpa-accent); margin-left: 1px; vertical-align: text-bottom;
        animation: gpa-blink 0.85s steps(1) infinite;
      }
      @keyframes gpa-blink { 50% { opacity: 0; } }
      .gpa-answer-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
        gap: 8px;
      }
      .gpa-grid-cell {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 3px; padding: 9px 4px; border-radius: calc(9px * var(--gpa-rs));
        background: var(--gpa-panel); border: 1px solid var(--gpa-border);
        animation: gpa-cell-in 0.3s ease both;
      }
      .gpa-grid-q { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; color: var(--gpa-sub); }
      .gpa-grid-a {
        font-size: 16px; font-weight: 800; color: var(--gpa-accent);
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      @keyframes gpa-cell-in {
        from { opacity: 0; transform: scale(0.82) translateY(5px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-grid-conf {
        font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: calc(8px * var(--gpa-rs)); margin-top: 1px;
      }
      .gpa-confidence-line { margin-top: 8px; }
      /* ---- Chat ---- */
      .gpa-chat-log {
        flex: 1; min-height: 120px; max-height: 320px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 7px; padding: 12px;
        background: var(--gpa-panel); border: 1px solid var(--gpa-border); border-radius: calc(14px * var(--gpa-rs));
      }
      .gpa-chat-msg { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; }
      .gpa-chat-msg .avatar {
        flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: 11px; font-weight: 700; margin-top: 1px;
      }
      .gpa-chat-msg .col { flex: 1; min-width: 0; }
      .gpa-chat-msg .head { display: flex; align-items: baseline; gap: 6px; }
      .gpa-chat-msg .who { font-weight: 600; color: var(--gpa-text); }
      .gpa-chat-msg.mine .who { color: var(--gpa-accent); }
      .gpa-chat-msg.owner .who::after { content: ' 👑'; }
      .gpa-chat-msg .when { font-size: 10px; color: var(--gpa-sub); font-variant-numeric: tabular-nums; }
      .gpa-chat-msg .body { line-height: 1.5; overflow-wrap: anywhere; }
      .gpa-chat-empty { color: var(--gpa-sub); font-size: 12px; text-align: center; padding: 16px 0; }
      /* ---- Announcement modal ---- */
      .gpa-ann-backdrop {
        position: absolute; inset: 0; z-index: 2147482000; display: flex;
        align-items: center; justify-content: center; padding: 18px;
        background: rgba(0,0,0,0.72); backdrop-filter: blur(3px);
      }
      .gpa-ann-card {
        max-width: 300px; width: 100%; background: var(--gpa-panel);
        border: 1px solid var(--gpa-accent); border-radius: calc(12px * var(--gpa-rs)); padding: 16px;
        box-shadow: 0 14px 44px rgba(0,0,0,0.6); text-align: center;
      }
      .gpa-ann-title { font: 700 14px/1.3 ui-monospace, monospace; color: var(--gpa-accent); margin-bottom: 8px; }
      .gpa-ann-text { font: 12px/1.55 ui-monospace, monospace; color: var(--gpa-text); white-space: pre-wrap; overflow-wrap: anywhere; }
      .gpa-ann-ok { margin-top: 14px; }
      /* "Answered by" attribution under every AI response */
      .gpa-model-badge {
        margin-top: 6px; font-size: 9.5px; line-height: 1.4; color: var(--gpa-sub);
        opacity: 0.85; letter-spacing: 0.2px; word-break: break-word;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .gpa-conf-high { background: rgba(34, 197, 94, 0.18); color: #22c55e; }
      .gpa-conf-mid { background: rgba(234, 179, 8, 0.18); color: #eab308; }
      .gpa-conf-low { background: rgba(239, 68, 68, 0.18); color: #ef4444; }
      /* Tutor mode cards: same grid, but wide enough for the explanation text */
      .gpa-answer-grid.wide { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
      .gpa-answer-grid.wide .gpa-grid-cell { align-items: flex-start; text-align: left; padding: 10px 12px; }
      .gpa-answer-grid.wide .gpa-grid-q { font-size: 11px; }
      .gpa-tutor-why, .gpa-tutor-sol, .gpa-tutor-concept, .gpa-tutor-pitfall, .gpa-tutor-cite {
        font-size: 11px; line-height: 1.55; color: var(--gpa-text); word-break: break-word;
      }
      .gpa-tutor-why b, .gpa-tutor-sol b, .gpa-tutor-concept b,
      .gpa-tutor-pitfall b, .gpa-tutor-cite b { color: var(--gpa-accent); font-weight: 700; }
      .gpa-tutor-sol { white-space: pre-wrap; }
      .gpa-tutor-concept { margin-bottom: 2px; opacity: 0.95; }
      .gpa-tutor-pitfall { margin-top: 4px; opacity: 0.9; }
      .gpa-tutor-cite { margin-top: 5px; font-size: 10px; opacity: 0.85; }
      .gpa-tutor-cite a { color: var(--gpa-accent); text-decoration: underline; text-underline-offset: 2px; }
      .gpa-tutor-cite .gpa-cite-plain { opacity: 0.8; }
      .gpa-tutor-pin, .gpa-tutor-card, .gpa-tutor-save { font-size: 10px; padding: 3px 8px; }
      .gpa-chat {
        flex: 1; min-height: 80px; overflow-y: auto; margin-bottom: 8px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .gpa-msg { padding: 8px 12px; border-radius: calc(14px * var(--gpa-rs)); font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
      .gpa-msg.user { background: var(--gpa-accent); color: var(--gpa-accent-fg); align-self: flex-end; max-width: 85%; border-bottom-right-radius: 4px; font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .gpa-msg.ai { font-size: var(--gpa-out-size, 13px); line-height: var(--gpa-out-lh, 1.5); background: var(--gpa-field); border: 1px solid var(--gpa-border); align-self: flex-start; max-width: 90%; border-bottom-left-radius: 4px; font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace; }
      .gpa-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
      .gpa-swatch {
        width: 56px; height: 34px; border-radius: calc(8px * var(--gpa-rs)); border: 2px solid transparent;
        cursor: pointer; font-size: 9px; color: #fff; font-weight: 700;
      }
      .gpa-color-input {
        width: 34px; height: 28px; padding: 0; border: 1px solid var(--gpa-border);
        border-radius: calc(6px * var(--gpa-rs)); background: var(--gpa-field); cursor: pointer;
      }
      .speed-btn, .font-btn, .particle-btn, .icon-btn, .size-btn, .look-btn, .colormode-btn { flex: 1; padding: 6px 4px; font-size: 11px; }
      .speed-btn.primary, .font-btn.primary, .particle-btn.primary, .icon-btn.primary, .size-btn.primary, .look-btn.primary, .colormode-btn.primary { background: var(--gpa-accent); color: #fff; border-color: var(--gpa-accent); }
      .gpa-range {
        width: 100%; -webkit-appearance: none; appearance: none;
        height: 4px; border-radius: 2px; background: var(--gpa-border); outline: none;
      }
      .gpa-range::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--gpa-accent); cursor: pointer; border: 2px solid var(--gpa-panel);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--gpa-accent) 33%, transparent);
      }
      .gpa-range::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--gpa-panel);
        background: var(--gpa-accent); cursor: pointer;
      }
      .gpa-font-system .gpa-output, .gpa-font-system .gpa-msg.ai {
        font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      :is(.gpa-mini, .gps-mini) {
        position: relative;
        width: 40px; height: 40px; border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, var(--gpa-accent), var(--gpa-bg) 78%);
        color: #fff; display: flex;
        align-items: center; justify-content: center; font-size: 16px;
        font-weight: 800; cursor: grab; overflow: visible;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        box-shadow: 0 0 14px 2px color-mix(in srgb, var(--gpa-accent) 53%, transparent), 0 8px 20px rgba(0,0,0,0.45);
        animation: gpa-orb-pulse 2.4s ease-in-out infinite;
      }
      :is(.gpa-mini, .gps-mini)::before {
        content: ''; position: absolute; inset: -6px; border-radius: 50%;
        border: 2px solid transparent; border-top-color: var(--gpa-accent); border-right-color: color-mix(in srgb, var(--gpa-accent) 40%, transparent);
        animation: gpa-orb-spin 3s linear infinite;
      }
      :is(.gpa-mini, .gps-mini)::after {
        content: ''; position: absolute; inset: -12px; border-radius: 50%;
        border: 1px dashed color-mix(in srgb, var(--gpa-accent) 33%, transparent);
        animation: gpa-orb-spin-rev 7s linear infinite;
      }
      :is(.gpa-mini, .gps-mini) svg { width: 18px; height: 18px; fill: #fff; position: relative; z-index: 1; }
      @keyframes gpa-orb-pulse {
        0%, 100% { box-shadow: 0 0 14px 2px color-mix(in srgb, var(--gpa-accent) 53%, transparent), 0 8px 20px rgba(0,0,0,0.45); }
        50% { box-shadow: 0 0 24px 6px color-mix(in srgb, var(--gpa-accent) 80%, transparent), 0 8px 24px rgba(0,0,0,0.5); }
      }
      @keyframes gpa-orb-spin { to { transform: rotate(360deg); } }
      @keyframes gpa-orb-spin-rev { to { transform: rotate(-360deg); } }
      :is(.gpa-mini, .gps-mini).gpa-mini-minimal {
        animation: gpa-mini-soft-pulse 3.6s ease-in-out infinite;
        box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      }
      :is(.gpa-mini, .gps-mini).gpa-mini-minimal::before,
      :is(.gpa-mini, .gps-mini).gpa-mini-minimal::after { display: none; }
      @keyframes gpa-mini-soft-pulse {
        0%, 100% { opacity: 0.92; }
        50% { opacity: 1; }
      }
      #gpa-root-host.gpa-settling {
        transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #gpa-thumb {
        display: none; width: 34px; height: 34px; object-fit: cover;
        border-radius: calc(6px * var(--gpa-rs)); border: 1px solid var(--gpa-border); flex-shrink: 0;
      }
      #gpa-thumb.show { display: block; }
      .gpa-iframe {
        flex: 1; width: 100%; min-height: 120px; border-radius: calc(8px * var(--gpa-rs));
        border: 1px solid var(--gpa-border); background: #000;
      }
      .gpa-sc-wrap { flex: 1; overflow-y: auto; }
      .gpa-sc-frame { width: 100%; height: 166px; border: 0; border-radius: calc(8px * var(--gpa-rs)); }
      .gpa-local-playlist { max-height: 120px; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
      .gpa-local-track {
        display: flex; align-items: center; gap: 6px; padding: 6px 8px;
        background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: calc(6px * var(--gpa-rs));
        cursor: pointer; font-size: 11px; color: var(--gpa-text);
      }
      .gpa-local-track:hover { border-color: var(--gpa-accent); }
      .gpa-local-track.playing { border-color: var(--gpa-accent); background: color-mix(in srgb, var(--gpa-accent) 9%, transparent); color: var(--gpa-accent); }
      .gpa-local-track-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gpa-local-track-badge { flex-shrink: 0; margin-right: 5px; opacity: 0.75; font-size: 10px; }
      .gpa-local-track.gpa-track-unavailable { opacity: 0.45; cursor: not-allowed; }
      .gpa-local-track.gpa-track-unavailable:hover { border-color: var(--gpa-border); }
      .gpa-local-track-remove { flex-shrink: 0; opacity: 0.6; cursor: pointer; padding: 0 4px; }
      .gpa-local-track-remove:hover { opacity: 1; color: #e5453a; }
      .gpa-local-player { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--gpa-border); }
      #gpa-local-nowplaying { text-align: center; margin-bottom: 6px; font-weight: 700; color: var(--gpa-accent); }
      .game-btn { flex: 1 1 auto; min-width: 64px; font-size: 9.5px; }
      .gpa-game-stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .gpa-game-viewport {
        flex: 1; min-height: 0; overflow: auto; margin-top: 8px;
        display: flex; flex-direction: column; align-items: center;
        justify-content: flex-start;
        padding: 6px 2px;
      }
      /* Inner wrapper that gets uniformly scaled by fitGameToStage() so any
         game fits whatever panel size (or fullscreen) is active. */
      .gpa-game-fit {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        transform-origin: top center;
      }
      .gpa-game-timer {
        position: absolute; top: 4px; right: 6px; z-index: 8;
        padding: 3px 8px; border-radius: 3px; pointer-events: none;
        background: color-mix(in srgb, var(--gpa-field) 80%, transparent); border: 1px solid color-mix(in srgb, var(--gpa-accent) 40%, transparent); color: var(--gpa-accent);
        font-size: 11px; font-weight: 800; letter-spacing: 0.8px;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-menu {
        position: absolute; inset: 0; z-index: 10;
        background: color-mix(in srgb, var(--gpa-bg) 91%, transparent); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
        display: flex; align-items: center; justify-content: center; padding: 10px;
        animation: gpa-pane-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .gpa-pause-card {
        width: 100%; max-width: 340px; padding: 18px;
        background: var(--gpa-panel); border: 1px solid var(--gpa-border);
        border-radius: calc(16px * var(--gpa-rs));
        box-shadow: 0 10px 34px rgba(0,0,0,0.35);
      }
      .gpa-pause-title {
        text-align: center; font-size: 14px; font-weight: 600;
        color: var(--gpa-text); margin-bottom: 12px;
      }
      /* Collapsed: the panel is just a backdrop for the round button. */
      .gpa-panel.gpa-minimized {
        border: none !important;
        background: transparent !important;
        box-shadow: none !important;
        border-radius: 50% !important;
        overflow: visible !important;
      }
      /* Signed out uses the exact same themed panel chrome as signed in —
         the login screen is part of the same design system, not a
         separately-styled disguise. */
      .gpa-panel.gpa-locked { }
      /* Neutral, quiet button while signed out — no accent glow or rings. */
      .gpa-mini.gpa-mini-locked {
        width: 42px; height: 42px; border-radius: 50% !important;
        background: linear-gradient(180deg, #5b6b7f, #475464) !important;
        border: 1px solid #6d7c8e !important;
        box-shadow: 0 3px 10px rgba(0,0,0,0.28) !important;
        animation: none !important;
        color: #fff; overflow: hidden;
      }
      .gpa-mini.gpa-mini-locked::before,
      .gpa-mini.gpa-mini-locked::after { display: none !important; }
      .gpa-login {
        position: absolute; inset: 0; z-index: 40;
        background: var(--gpa-bg);
        display: flex; align-items: center; justify-content: center; padding: 16px;
        overflow-y: auto; overscroll-behavior: contain;
        scrollbar-width: thin; scrollbar-color: var(--gpa-border) transparent;
      }
      .gpa-login::-webkit-scrollbar { width: 8px; }
      .gpa-login::-webkit-scrollbar-track { background: transparent; }
      .gpa-login::-webkit-scrollbar-thumb {
        background: var(--gpa-border); border-radius: 99px;
        border: 2px solid var(--gpa-bg); background-clip: padding-box;
      }
      .gpa-login-card { margin: auto 0; }
      .gpa-login-card {
        width: 100%; max-width: 320px; background: var(--gpa-panel);
        border: 1px solid var(--gpa-border); border-radius: calc(16px * var(--gpa-rs)); padding: 24px 20px;
        box-shadow: 0 12px 34px rgba(0,0,0,0.3);
      }
      .gpa-login-brand { display: flex; align-items: center; gap: 12px; cursor: grab; }
      .gpa-panel.gpa-fullpage .gpa-login-brand { cursor: default; }
      .gpa-login-brand:active { cursor: grabbing; }
      .gpa-login-brandtext { flex: 1; min-width: 0; }
      .gpa-login-winbtns { display: flex; gap: 4px; flex-shrink: 0; }
      .gpa-login-winbtn {
        width: 22px; height: 22px; border: 1px solid transparent; background: transparent;
        color: var(--gpa-sub); border-radius: calc(7px * var(--gpa-rs)); cursor: pointer; line-height: 1;
        font-size: 13px; display: flex; align-items: center; justify-content: center;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .gpa-login-winbtn:hover { background: var(--gpa-field); color: var(--gpa-text); }
      #gpa-login-close:hover { background: #e5453a; color: #fff; }
      .gpa-login-logo {
        width: 36px; height: 36px; flex-shrink: 0; background: var(--gpa-accent); color: var(--gpa-accent-fg);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; font-weight: 600; border-radius: calc(10px * var(--gpa-rs));
        border: none; padding: 0; cursor: pointer;
        transition: transform 0.1s ease, box-shadow 0.15s ease;
      }
      .gpa-login-logo:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 20%, transparent); }
      .gpa-login-logo:active { transform: scale(0.94); }
      .gpa-login-company { font-size: 15px; font-weight: 600; color: var(--gpa-text); line-height: 1.2; }
      .gpa-login-dept { font-size: 11px; color: var(--gpa-sub); margin-top: 2px; }
      .gpa-login-divider { height: 1px; background: var(--gpa-border); margin: 16px 0; }
      .gpa-login-heading { font-size: 13px; font-weight: 600; color: var(--gpa-text); margin-bottom: 14px; }
      .gpa-login-label {
        display: block; font-size: 11px; color: var(--gpa-sub); margin-bottom: 5px; font-weight: 500;
      }
      .gpa-login-input {
        width: 100%; padding: 8px 11px; margin-bottom: 14px;
        border: 1px solid var(--gpa-border); border-radius: calc(9px * var(--gpa-rs)); background: var(--gpa-field);
        font-size: 13px; color: var(--gpa-text); outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .gpa-login-input:focus { border-color: var(--gpa-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 16%, transparent); }
      .gpa-login-primary {
        width: 100%; padding: 9px; background: var(--gpa-accent); color: var(--gpa-accent-fg);
        border: none; border-radius: calc(9px * var(--gpa-rs)); cursor: pointer;
        font-size: 13px; font-weight: 600;
        transition: box-shadow 0.15s ease, transform 0.1s ease;
      }
      .gpa-login-primary:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 20%, transparent); }
      .gpa-login-primary:active { transform: scale(0.98); }
      .gpa-login-msg { font-size: 11px; min-height: 14px; margin-bottom: 6px; color: var(--gpa-accent); }
      .gpa-login-msg.error { color: #e5453a; }
      .gpa-login-actions { margin-top: 12px; text-align: center; }
      .gpa-login-link {
        background: none; border: none; padding: 0; cursor: pointer;
        color: var(--gpa-accent); font-size: 11px; text-decoration: underline;
        text-underline-offset: 2px;
      }
      .gpa-login-sep { color: var(--gpa-border); font-size: 11px; margin: 0 6px; }
      .gpa-login-footer {
        margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--gpa-border);
        font-size: 10.5px; color: var(--gpa-sub); line-height: 1.5;
      }
      .gpa-login-legal { color: var(--gpa-sub); }
      /* First-run language picker: sits inside the console, centered over
         whatever pane is behind it, above the login overlay (z-index 40). */
      .gpa-langpick {
        position: absolute; inset: 0; z-index: 60;
        background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center; padding: 16px;
        animation: gpa-langpick-fade 0.16s ease-out;
      }
      @keyframes gpa-langpick-fade { from { opacity: 0; } to { opacity: 1; } }
      .gpa-langpick-card {
        width: 100%; max-width: 300px; background: var(--gpa-panel);
        border: 1px solid var(--gpa-accent); border-radius: calc(16px * var(--gpa-rs)); padding: 22px 20px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
        text-align: center;
        animation: gpa-langpick-pop 0.18s ease-out;
      }
      @keyframes gpa-langpick-pop {
        from { opacity: 0; transform: scale(0.94) translateY(8px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-langpick-glyph { font-size: 22px; line-height: 1; margin-bottom: 10px; }
      .gpa-langpick-title { font-size: 14px; font-weight: 600; color: var(--gpa-text); }
      .gpa-langpick-sub { font-size: 11.5px; color: var(--gpa-sub); margin-top: 3px; }
      .gpa-langpick-who {
        font-size: 10.5px; color: var(--gpa-accent); margin-top: 8px;
        letter-spacing: 0.3px;
      }
      .gpa-langpick-opts { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
      .gpa-langpick-opt {
        width: 100%; padding: 10px 12px; border-radius: calc(9px * var(--gpa-rs));
        background: var(--gpa-field); border: 1px solid var(--gpa-border); color: var(--gpa-text);
        font-family: inherit; font-size: 12.5px; cursor: pointer;
      }
      .gpa-langpick-opt:hover { border-color: var(--gpa-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 13%, transparent); }
      .gpa-langpick-opt:active { transform: scale(0.98); }
      .gpa-langpick-opt.current { border-color: var(--gpa-accent); color: var(--gpa-accent); }
      .gpa-langpick-note {
        margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--gpa-border);
        font-size: 10px; line-height: 1.5; color: var(--gpa-sub);
      }
      .gpa-sync-box {
        width: 100%; min-height: 54px; margin-top: 6px; padding: 7px;
        background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: 5px;
        color: var(--gpa-text); font-size: 9.5px; resize: vertical; outline: none;
        word-break: break-all;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-sync-box:focus { border-color: var(--gpa-accent); }
      /* ---- Admin console ---- */
      .gpa-admin-title { font-weight: 700; color: var(--gpa-accent); }
      .gpa-admin-note {
        font-size: 10px; line-height: 1.5; color: var(--gpa-sub); margin: 8px 0;
        padding: 7px 9px; background: var(--gpa-field); border: 1px solid var(--gpa-border);
        border-radius: calc(6px * var(--gpa-rs));
      }
      .gpa-admin-tabs { display: flex; gap: 5px; margin: 10px 0 8px; flex-wrap: wrap; }
      .gpa-admin-tab { font-size: 10px; padding: 4px 9px; }
      .gpa-admin-pane { display: none; }
      .gpa-admin-pane.active { display: block; }
      .gpa-admin-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
      .gpa-admin-statcard {
        padding: 8px 10px; background: var(--gpa-field); border: 1px solid var(--gpa-border);
        border-radius: calc(7px * var(--gpa-rs)); text-align: center;
      }
      .gpa-admin-statcard .n { font-size: 18px; font-weight: 800; color: var(--gpa-accent); display: block; }
      .gpa-admin-statcard .l { font-size: 9px; color: var(--gpa-sub); margin-top: 2px; }
      .gpa-admin-users, .gpa-admin-log, .gpa-admin-ls {
        max-height: 190px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
      }
      .gpa-admin-userrow, .gpa-admin-logrow {
        display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
        padding: 5px 8px; background: var(--gpa-field); border: 1px solid var(--gpa-border);
        border-radius: 5px; font-size: 10px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
      }
      .gpa-admin-userrow b { color: var(--gpa-accent); font-weight: 700; }
      .gpa-admin-logrow .t { color: var(--gpa-sub); white-space: nowrap; }
      .gpa-admin-logrow .ev { flex: 1; overflow-wrap: anywhere; }
      .gpa-admin-ls-row { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px;
        background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: 5px; }
      .gpa-admin-ls-row .k { font-size: 9.5px; color: var(--gpa-accent); font-weight: 700; overflow-wrap: anywhere; }
      .gpa-admin-ls-row textarea {
        width: 100%; min-height: 34px; background: var(--gpa-panel); color: var(--gpa-text);
        border: 1px solid var(--gpa-border); border-radius: 4px; font-size: 9px; padding: 4px;
        font-family: 'JetBrains Mono', ui-monospace, monospace; resize: vertical;
      }
      .gpa-admin-ls-row .gpa-btn { align-self: flex-end; font-size: 9px; padding: 2px 7px; }
      .gpa-pause-stats { display: flex; flex-direction: column; gap: 5px; }
      .gpa-pause-stat {
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        padding: 5px 8px; background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: 5px;
        font-size: 11px;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-options { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .gpa-pause-options:empty { display: none; }
      .gpa-pause-optrow {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        padding: 4px 8px; background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: 5px;
      }
      .gpa-pause-optlabel {
        color: var(--gpa-sub); text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-optselect {
        background: var(--gpa-panel); color: var(--gpa-accent); border: 1px solid color-mix(in srgb, var(--gpa-accent) 33%, transparent);
        border-radius: 4px; font-size: 10px; font-weight: 700; padding: 3px 5px;
        cursor: pointer; outline: none; max-width: 110px;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-optbtn {
        background: var(--gpa-panel); color: var(--gpa-accent); border: 1px solid color-mix(in srgb, var(--gpa-accent) 33%, transparent);
        border-radius: 4px; font-size: 10px; font-weight: 700; padding: 3px 9px; cursor: pointer;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .gpa-pause-stat-label { color: var(--gpa-sub); text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px; }
      .gpa-pause-stat-value { color: var(--gpa-accent); font-weight: 800; }
      /* Fullscreen: the stage becomes the whole screen, game centered on it.
         Scaling itself is handled in JS by fitGameToStage() so mouse
         coordinates stay correct (a fixed CSS scale would break them). */
      .gpa-game-stage:fullscreen,
      .gpa-game-stage:-webkit-full-screen {
        background: var(--gpa-bg); padding: 20px;
      }
      .gpa-game-stage:fullscreen .gpa-game-viewport,
      .gpa-game-stage:-webkit-full-screen .gpa-game-viewport {
        justify-content: center;
      }
      .gpa-game-stage:fullscreen .game-canvas,
      .gpa-game-stage:-webkit-full-screen .game-canvas {
        image-rendering: pixelated;
      }
      /* Fullscreening the whole console (header, sidebar and all) rather
         than just one game — the panel itself becomes the fullscreen
         element, so it needs to actually fill that space edge-to-edge
         instead of keeping its small floating-widget footprint. */
      .gpa-panel:fullscreen,
      .gpa-panel:-webkit-full-screen {
        width: 100% !important; height: 100% !important;
        border-radius: 0; border: none;
        background: var(--gpa-bg);
      }
      .gpa-game-status {
        font-size: 12px; font-weight: 700; color: var(--gpa-text); text-align: center;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .ttt-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; width: 180px; }
      .ttt-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 26px; font-weight: 800; color: var(--gpa-accent); cursor: pointer;
        background: var(--gpa-field); border: 1px solid color-mix(in srgb, var(--gpa-accent) 27%, transparent); border-radius: calc(6px * var(--gpa-rs));
      }
      .ttt-cell:hover { border-color: var(--gpa-accent); }
      .rps-row { display: flex; gap: 10px; }
      .rps-btn {
        font-size: 26px; width: 52px; height: 52px; border-radius: 50%;
        background: var(--gpa-field); border: 1px solid color-mix(in srgb, var(--gpa-accent) 33%, transparent); cursor: pointer;
      }
      .rps-btn:hover { border-color: var(--gpa-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--gpa-accent) 33%, transparent); }
      .memory-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 220px; }
      .memory-card {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 20px; background: var(--gpa-field); border: 1px solid color-mix(in srgb, var(--gpa-accent) 27%, transparent);
        border-radius: calc(6px * var(--gpa-rs)); cursor: pointer; user-select: none;
      }
      .memory-card.flipped, .memory-card.matched { background: color-mix(in srgb, var(--gpa-accent) 13%, transparent); border-color: var(--gpa-accent); }
      .memory-card.matched { opacity: 0.55; cursor: default; }
      .game-canvas { border: 1px solid color-mix(in srgb, var(--gpa-accent) 33%, transparent); border-radius: calc(6px * var(--gpa-rs)); background: var(--gpa-bg); }
      .g2048-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; width: 220px; }
      .g2048-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 15px; font-weight: 800; border-radius: 5px; background: var(--gpa-field);
        color: var(--gpa-text);
      }
      .whack-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 200px; }
      .whack-hole {
        aspect-ratio: 1; border-radius: 50%; background: var(--gpa-field);
        border: 1px solid color-mix(in srgb, var(--gpa-accent) 27%, transparent); cursor: pointer;
        display: flex; align-items: center; justify-content: center; font-size: 22px;
      }
      .whack-hole.up { background: color-mix(in srgb, var(--gpa-accent) 20%, transparent); border-color: var(--gpa-accent); }
      .hangman-letters { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; width: 230px; }
      .hangman-letter {
        font-size: 10px; padding: 5px 0; background: var(--gpa-field); border: 1px solid color-mix(in srgb, var(--gpa-accent) 27%, transparent);
        border-radius: 4px; cursor: pointer; text-align: center;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .hangman-letter:disabled { opacity: 0.35; cursor: default; }
      .hangman-word {
        font-size: 22px; letter-spacing: 5px; font-weight: 800;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        color: var(--gpa-accent);
      }
      .wordle-grid { display: flex; flex-direction: column; gap: 5px; margin: 6px 0; }
      .wordle-row { display: flex; gap: 5px; }
      .wordle-tile {
        width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 16px; border: 1px solid color-mix(in srgb, var(--gpa-accent) 27%, transparent); border-radius: 4px;
        background: var(--gpa-field); color: var(--gpa-text);
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .wordle-tile.correct { background: #22c55e; border-color: #22c55e; color: #fff; }
      .wordle-tile.present { background: #eab308; border-color: #eab308; color: #111; }
      .wordle-tile.absent { background: var(--gpa-border); border-color: var(--gpa-border); color: var(--gpa-sub); }
      .c4-board { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; width: 238px; background: var(--gpa-field); padding: 6px; border-radius: calc(6px * var(--gpa-rs)); }
      .c4-cell { aspect-ratio: 1; border-radius: 50%; background: var(--gpa-panel); border: 1px solid color-mix(in srgb, var(--gpa-accent) 20%, transparent); cursor: pointer; }
      .c4-cell.c4-red { background: #e5453a; border-color: #e5453a; }
      .c4-cell.c4-yellow { background: #f5c518; border-color: #f5c518; }
      .mine-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; width: 216px; }
      .mine-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; background: var(--gpa-field); border: 1px solid color-mix(in srgb, var(--gpa-accent) 20%, transparent);
        cursor: pointer; border-radius: 2px; user-select: none;
      }
      .mine-cell.revealed { background: var(--gpa-panel); cursor: default; }
      .mine-cell.mine { background: #e5453a55; }
      .mine-cell.n1 { color: #4da3ff; }
      .mine-cell.n2 { color: #22c55e; }
      .mine-cell.n3 { color: #e5453a; }
      .mine-cell.n4 { color: #8b5cf6; }
      .mine-cell.n5 { color: #f5c518; }
      .mine-cell.n6 { color: #06b6d4; }
      .mine-cell.n7 { color: var(--gpa-text); }
      .mine-cell.n8 { color: var(--gpa-sub); }
      .simon-pad { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; width: 160px; height: 160px; }
      .simon-btn { border-radius: calc(10px * var(--gpa-rs)); cursor: pointer; opacity: 0.55; transition: opacity 0.1s ease; }
      .simon-btn.active { opacity: 1; box-shadow: 0 0 14px currentColor; }
      .simon-red { background: #e5453a; }
      .simon-blue { background: #4da3ff; }
      .simon-green { background: #22c55e; }
      .simon-yellow { background: #f5c518; }
      .reaction-box {
        width: 100%; max-width: 240px; height: 120px; border-radius: calc(10px * var(--gpa-rs));
        display: flex; align-items: center; justify-content: center; text-align: center;
        font-weight: 800; font-size: 13px; cursor: pointer; padding: 10px; color: #fff;
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .reaction-box.waiting { background: #e5453a; }
      .reaction-box.ready { background: #22c55e; }
      .checkers-board { display: grid; grid-template-columns: repeat(8, 1fr); width: 224px; border: 2px solid color-mix(in srgb, var(--gpa-accent) 33%, transparent); }
      .checkers-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .checkers-cell.light { background: var(--gpa-field); }
      .checkers-cell.dark { background: var(--gpa-panel); }
      .checkers-cell.selected { outline: 2px solid var(--gpa-accent); outline-offset: -2px; }
      .checkers-cell.valid-move { box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--gpa-accent) 53%, transparent); }
      .checkers-piece {
        width: 70%; height: 70%; border-radius: 50%; display: flex;
        align-items: center; justify-content: center; font-size: 10px;
      }
      .checkers-piece.red { background: #e5453a; border: 2px solid #a8281f; }
      .checkers-piece.black { background: #2a2a30; border: 2px solid #111; }
      .sudoku-grid { display: grid; grid-template-columns: repeat(9, 1fr); width: 225px; border: 2px solid color-mix(in srgb, var(--gpa-accent) 40%, transparent); }
      .sudoku-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 700; background: var(--gpa-field); border: 1px solid var(--gpa-border);
        cursor: pointer; color: var(--gpa-text);
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      .sudoku-cell.given { color: var(--gpa-accent); font-weight: 800; cursor: default; background: var(--gpa-panel); }
      .sudoku-cell.selected { background: color-mix(in srgb, var(--gpa-accent) 20%, transparent); }
      .sudoku-cell.conflict { color: #e5453a; }
      .sudoku-cell.border-right { border-right: 2px solid color-mix(in srgb, var(--gpa-accent) 40%, transparent); }
      .sudoku-cell.border-bottom { border-bottom: 2px solid color-mix(in srgb, var(--gpa-accent) 40%, transparent); }
      .sudoku-numrow { display: flex; gap: 3px; margin-top: 8px; flex-wrap: wrap; }
      .sudoku-num { flex: 1; min-width: 20px; padding: 6px 0; font-size: 12px; }

      /* Themed scrollbars — thumb matches the current accent color */
      .gpa-body, .gpa-output, .gpa-chat, .gpa-sc-wrap {
        scrollbar-width: thin;
        scrollbar-color: var(--gpa-accent) var(--gpa-field);
      }
      .gpa-body::-webkit-scrollbar, .gpa-output::-webkit-scrollbar,
      .gpa-chat::-webkit-scrollbar, .gpa-sc-wrap::-webkit-scrollbar {
        width: 8px; height: 8px;
      }
      .gpa-body::-webkit-scrollbar-track, .gpa-output::-webkit-scrollbar-track,
      .gpa-chat::-webkit-scrollbar-track, .gpa-sc-wrap::-webkit-scrollbar-track {
        background: var(--gpa-field); border-radius: calc(8px * var(--gpa-rs));
      }
      .gpa-body::-webkit-scrollbar-thumb, .gpa-output::-webkit-scrollbar-thumb,
      .gpa-chat::-webkit-scrollbar-thumb, .gpa-sc-wrap::-webkit-scrollbar-thumb {
        background: var(--gpa-accent); border-radius: calc(8px * var(--gpa-rs)); border: 2px solid var(--gpa-field);
      }
      .gpa-body::-webkit-scrollbar-thumb:hover, .gpa-output::-webkit-scrollbar-thumb:hover,
      .gpa-chat::-webkit-scrollbar-thumb:hover, .gpa-sc-wrap::-webkit-scrollbar-thumb:hover {
        background: var(--gpa-sub);
      }
      .gpa-body::-webkit-scrollbar-corner { background: transparent; }

      /* ---- Extended tools ---- */
      .gpa-sel-bubble { position: fixed; z-index: 2147483647; display: flex; gap: 2px; padding: 4px; border-radius: calc(10px * var(--gpa-rs)); background: var(--gpa-panel); border: 1px solid var(--gpa-accent); box-shadow: 0 6px 24px rgba(0,0,0,0.45); }
      .gpa-sel-bubble button { background: transparent; border: none; color: var(--gpa-text); font-size: 11px; padding: 4px 7px; border-radius: calc(6px * var(--gpa-rs)); cursor: pointer; white-space: nowrap; font-family: inherit; }
      .gpa-sel-bubble button:hover { background: color-mix(in srgb, var(--gpa-accent) 20%, transparent); }
      .gpa-sel-pop { position: fixed; z-index: 2147483647; max-width: 340px; max-height: 260px; overflow: auto; padding: 10px 12px; border-radius: calc(10px * var(--gpa-rs)); background: var(--gpa-panel); border: 1px solid var(--gpa-accent); color: var(--gpa-text); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: break-word; box-shadow: 0 8px 28px rgba(0,0,0,0.5); }
      .gpa-sel-pop .gpa-sel-pop-src { display: block; margin-top: 8px; font-size: 10px; opacity: 0.65; overflow-wrap: break-word; }
      .gpa-sel-pop .gpa-sel-pop-retry { display: block; margin-top: 8px; background: transparent; border: 1px solid var(--gpa-accent); color: var(--gpa-text); font-size: 11px; padding: 4px 8px; border-radius: calc(6px * var(--gpa-rs)); cursor: pointer; font-family: inherit; }
      .gpa-sel-pop .gpa-sel-pop-retry:hover { background: color-mix(in srgb, var(--gpa-accent) 20%, transparent); }
      .gpa-sel-pop .gpa-sel-pop-retry:disabled { opacity: 0.6; cursor: default; }
      .gpa-flip { perspective: 900px; cursor: pointer; min-height: 96px; }
      .gpa-flip-inner { position: relative; transition: transform 0.35s; transform-style: preserve-3d; min-height: 96px; }
      .gpa-flip.flipped .gpa-flip-inner { transform: rotateY(180deg); }
      .gpa-flip-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px; border-radius: calc(10px * var(--gpa-rs)); border: 1px solid var(--gpa-border); background: var(--gpa-field); color: var(--gpa-text); font-size: 12.5px; line-height: 1.5; overflow: auto; }
      .gpa-flip-back { transform: rotateY(180deg); background: color-mix(in srgb, var(--gpa-accent) 12%, transparent); border-color: var(--gpa-accent); }
      .gpa-pomo-time { font-size: 22px; font-weight: 700; letter-spacing: 2px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .gpa-flash-once { animation: gpa-flash 1.2s ease-in-out 3; }
      @keyframes gpa-flash { 0%, 100% { outline: none; } 50% { outline: 3px solid var(--gpa-accent); outline-offset: 2px; } }

      /* ---- Saved tab: calendar + folders + save modal ---- */
      .gpa-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-top: 6px; }
      .gpa-cal-dow { text-align: center; font-size: 9px; color: var(--gpa-sub); padding: 2px 0; letter-spacing: 1px; }
      .gpa-cal-day {
        position: relative; min-height: 34px; padding: 3px 4px; text-align: left;
        border: 1px solid var(--gpa-border); border-radius: calc(6px * var(--gpa-rs)); background: var(--gpa-field);
        color: var(--gpa-text); font-size: 10.5px; cursor: pointer; font-family: inherit;
      }
      .gpa-cal-day:hover { border-color: var(--gpa-accent); }
      .gpa-cal-day.pad { visibility: hidden; cursor: default; }
      .gpa-cal-day.thisweek { background: color-mix(in srgb, var(--gpa-accent) 8%, transparent); }
      .gpa-cal-day.today { border-color: var(--gpa-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--gpa-accent) 40%, transparent) inset; font-weight: 700; }
      .gpa-cal-day.sel { background: color-mix(in srgb, var(--gpa-accent) 20%, transparent); border-color: var(--gpa-accent); }
      .gpa-cal-day .dot { position: absolute; bottom: 2px; left: 0; right: 0; text-align: center; font-size: 7px; color: var(--gpa-accent); line-height: 1; }
      .gpa-cal-title { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-align: center; flex: 1; }
      .gpa-folder-tree { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
      .gpa-folder-chip {
        display: flex; align-items: center; gap: 6px; text-align: left; width: 100%;
        border: 1px solid var(--gpa-border); border-radius: calc(8px * var(--gpa-rs)); background: var(--gpa-field);
        color: var(--gpa-text); font-size: 11px; padding: 7px 9px; cursor: pointer; font-family: inherit;
      }
      .gpa-folder-chip:hover { border-color: var(--gpa-accent); }
      .gpa-folder-chip.sel { background: color-mix(in srgb, var(--gpa-accent) 15%, transparent); border-color: var(--gpa-accent); }
      .gpa-folder-chip .grow { flex: 1; text-align: left; }
      .gpa-folder-chip .mini { background: transparent; border: none; color: var(--gpa-sub); cursor: pointer; font-size: 10px; padding: 2px; font-family: inherit; }
      .gpa-folder-chip .mini:hover { color: var(--gpa-text); }
      .gpa-insight-card { position: relative; }
      .gpa-insight-time { font-size: 10px; font-weight: 700; color: var(--gpa-accent); letter-spacing: 0.5px; }
      .gpa-insight-label { display: inline-block; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--gpa-accent); color: var(--gpa-accent); margin-left: 6px; letter-spacing: 0.5px; }
      .gpa-insight-actions { display: flex; gap: 4px; margin-top: 6px; }
      .gpa-insight-actions .gpa-btn { font-size: 9px; padding: 4px 8px; flex: none; }
      .gpa-modal { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; }
      .gpa-modal-card {
        width: min(92vw, 330px); background: var(--gpa-panel); border: 1px solid var(--gpa-accent);
        border-radius: calc(12px * var(--gpa-rs)); padding: 14px; display: flex; flex-direction: column; gap: 7px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
      }
      .gpa-modal-title { font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 2px; }
      .gpa-modal-card label { font-size: 10px; color: var(--gpa-sub); letter-spacing: 0.5px; }
      .gpa-modal-card input, .gpa-modal-card select {
        background: var(--gpa-field); border: 1px solid var(--gpa-border); border-radius: calc(6px * var(--gpa-rs));
        color: var(--gpa-text); font-size: 12px; padding: 6px 8px; font-family: inherit; width: 100%;
      }
    ` + GPS_CSS;
  applyTheme(theme, { instant: true });

  // ---- Drag logic -----------------------------------------------------
  (function makeDraggable() {
    let dragging = null, offX = 0, offY = 0;

    function start(e) {
      // Full-page mode fills the viewport by design — there's nowhere
      // meaningful to drag it to, so dragging is disabled while expanded.
      if (!isMin && panelSizeKey === 'full') return;
      dragging = host;
      host.classList.remove('gpa-settling'); // grabbing mid-flight should feel instant, not laggy
      const rect = host.getBoundingClientRect();
      const p = 'touches' in e ? e.touches[0] : e;
      offX = p.clientX - rect.left;
      offY = p.clientY - rect.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const p = 'touches' in e ? e.touches[0] : e;
      let x = p.clientX - offX, y = p.clientY - offY;
      // Clamp against the panel's ACTUAL current size (mini dot, settled
      // panel, or whichever size preset is active) so it can never be
      // dragged past the edge of the visible window.
      const rect = host.getBoundingClientRect();
      x = Math.max(0, Math.min(window.innerWidth - rect.width, x));
      y = Math.max(0, Math.min(window.innerHeight - rect.height, y));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
    }
    function end() { dragging = null; }

    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('#gpa-drag') || e.target.closest('.gpa-mini') || (e.target.closest('.gpa-login-brand') && !e.target.closest('.gpa-login-logo') && !e.target.closest('.gpa-login-winbtns'))) start(e);
    });
    root.addEventListener('touchstart', (e) => {
      if (e.target.closest('#gpa-drag') || e.target.closest('.gpa-mini') || (e.target.closest('.gpa-login-brand') && !e.target.closest('.gpa-login-logo') && !e.target.closest('.gpa-login-winbtns'))) start(e);
    }, { passive: false });
    onWin('mousemove', move);
    onWin('touchmove', move, { passive: false });
    onWin('mouseup', end);
    onWin('touchend', end);
  })();

  // ---- Minimize / restore ---------------------------------------------
  const body = panel.querySelector('#gpa-body');
  const headerEl = panel.querySelector('.gpa-header');
  panel.querySelector('#gpa-min').addEventListener('click', () => setMinimized(true));
  minimized.addEventListener('click', () => setMinimized(false));
  host.addEventListener('gpa-toggle', () => setMinimized(!isMin));
  panel.querySelector('#gpa-close').addEventListener('click', () => host.remove());

  // ---- Fullscreen the whole console (header, sidebar, everything) --------
  const consoleFsBtn = panel.querySelector('#gpa-console-fullscreen');
  consoleFsBtn.addEventListener('click', () => {
    const isConsoleFs = document.fullscreenElement === panel || document.webkitFullscreenElement === panel;
    if (isConsoleFs) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = panel.requestFullscreen || panel.webkitRequestFullscreen;
      if (req) req.call(panel).catch(() => { /* page may block fullscreen */ });
    }
  });
  function syncConsoleFullscreenLabel() {
    const active = document.fullscreenElement === panel || document.webkitFullscreenElement === panel;
    consoleFsBtn.textContent = active ? '⤢' : '⛶';
    consoleFsBtn.title = active ? 'Exit fullscreen' : 'Fullscreen the whole console';
  }
  onDoc('fullscreenchange', syncConsoleFullscreenLabel);
  onDoc('webkitfullscreenchange', syncConsoleFullscreenLabel);

  let isMin = false;
  function setMinimized(v) {
    const prevRect = host.getBoundingClientRect(); // capture BEFORE resizing anything below
    isMin = v;
    if (v) stopActiveGame();
    body.style.display = v ? 'none' : 'flex';
    headerEl.style.display = v ? 'none' : 'flex';
    minimized.style.display = v ? 'flex' : 'none';
    // The login overlay sits at z-index 40 across the whole panel, so if it
    // stays mounted while collapsed it covers the mini button and eats every
    // click and drag. Hide it while minimized; restore it on expand if the
    // user still hasn't signed in. (Queried live rather than closed over,
    // since this function is defined before the overlay reference exists.)
    const loginEl = panel.querySelector('#gpa-login');
    const signedInNow = typeof currentUser !== 'undefined' && currentUser;
    if (loginEl) {
      loginEl.style.display = v ? 'none' : (signedInNow ? 'none' : 'flex');
    }
    // The locked-chrome rules use !important (rounded corners, panel shadow),
    // which would otherwise paint a panel-sized shadow around the collapsed
    // dot. Drop the class while minimized, restore it on expand if signed out.
    panel.classList.toggle('gpa-locked', !v && !signedInNow);
    panel.classList.toggle('gpa-minimized', v);
    panel.classList.toggle('gpa-fullpage', !v && panelSizeKey === 'full');
    panel.style.width = v ? 'auto' : sizeFor(panelSizeKey).w + 'px';
    panel.style.height = v ? 'auto' : sizeFor(panelSizeKey).h + 'px';
    panel.style.background = v ? 'transparent' : '';
    panel.style.boxShadow = v ? 'none' : '';
    panel.style.border = v ? 'none' : '';

    if (v) {
      // Animate to a resting spot in the bottom-right corner. Still fully
      // draggable afterward — grabbing it mid-flight (see `start()` above)
      // cancels the transition immediately so it never fights your cursor.
      const margin = 24, size = 40;
      const targetLeft = Math.max(0, window.innerWidth - size - margin);
      const targetTop = Math.max(0, window.innerHeight - size - margin);
      host.classList.add('gpa-settling');
      host.style.left = targetLeft + 'px';
      host.style.top = targetTop + 'px';
      host.addEventListener('transitionend', () => host.classList.remove('gpa-settling'), { once: true });
    } else if (panelSizeKey === 'full') {
      // Full-page mode always re-centers on the current viewport rather than
      // expanding from wherever the mini dot happened to be resting — there's
      // no meaningful "corner" to grow from when the target fills the screen.
      host.classList.remove('gpa-settling');
      host.style.left = FULL_MARGIN + 'px';
      host.style.top = FULL_MARGIN + 'px';
    } else {
      host.classList.remove('gpa-settling');
      // Expand from the SAME corner the mini dot was resting at (so it
      // grows up-and-left, away from the edge it was sitting against)
      // instead of keeping the old top-left pinned and letting the
      // now-much-bigger panel spill off the right/bottom of the screen.
      // Clamped afterward as a safety net for any resting position.
      const { w: newW, h: newH } = sizeFor(panelSizeKey);
      let newLeft = prevRect.right - newW;
      let newTop = prevRect.bottom - newH;
      newLeft = Math.max(0, Math.min(window.innerWidth - newW, newLeft));
      newTop = Math.max(0, Math.min(window.innerHeight - newH, newTop));
      host.style.left = newLeft + 'px';
      host.style.top = newTop + 'px';
    }

    // Signed out, particles stay off regardless of the stored preference.
    const signedIn = typeof currentUser !== 'undefined' && currentUser;
    const activeParticleStyle = signedIn ? (localStorage.getItem(PARTICLE_KEY) || 'off') : 'off';
    if (v) {
      particleCanvas.style.display = 'none';
      if (particleAnimId) { cancelAnimationFrame(particleAnimId); particleAnimId = null; }
    } else if (activeParticleStyle !== 'off') {
      particleCanvas.style.display = 'block';
      if (!particleAnimId) stepParticles();
    }

    // Expanding back onto an already-active Chat tab counts as reading it.
    if (!v) {
      const chatPane = panel.querySelector('.gpa-pane[data-pane="chat"]');
      if (chatPane && chatPane.classList.contains('active') && typeof clearChatUnread === 'function') clearChatUnread();
    }
  }

  // ---- Sidebar collapse ------------------------------------------------
  // Hides the tool list entirely so only the active tool's own content
  // shows, full width — the header button (always visible, never hidden
  // along with the sidebar) brings it back. Persisted like every other
  // layout preference.
  const SIDEBAR_HIDDEN_KEY = 'gpa_sidebar_hidden';
  const sidebarToggleBtn = panel.querySelector('#gpa-sidebar-toggle');
  function setSidebarHidden(hidden) {
    panel.classList.toggle('gpa-sidebar-hidden', hidden);
    sidebarToggleBtn.classList.toggle('active', hidden);
    sidebarToggleBtn.title = hidden ? 'Show the sidebar' : 'Hide the sidebar';
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0');
    if (typeof fitGameToStage === 'function') requestAnimationFrame(fitGameToStage);
  }
  setSidebarHidden(localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1');
  sidebarToggleBtn.addEventListener('click', () => setSidebarHidden(!panel.classList.contains('gpa-sidebar-hidden')));

  // Tracks the panel's actual rendered width (not the browser viewport's —
  // a windowed size preset can be narrow in an otherwise wide browser) so
  // layouts like Page Insights' two-column rail can stack instead of
  // squeezing themselves unreadable.
  if (typeof ResizeObserver !== 'undefined') {
    const narrowObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        panel.classList.toggle('gpa-narrow', entry.contentRect.width < 640);
      }
    });
    narrowObserver.observe(panel);
  }

  // ---- Dropdown section switcher -----------------------------------------
  const dropdown = panel.querySelector('#gpa-dropdown');
  const dropdownBtn = panel.querySelector('#gpa-dropdown-btn');
  const dropdownLabel = panel.querySelector('#gpa-dropdown-label');

  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  root.addEventListener('click', (e) => {
    if (!e.target.closest('#gpa-dropdown')) dropdown.classList.remove('open');
  });

  panel.querySelectorAll('.gpa-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      panel.querySelectorAll('.gpa-dropdown-item').forEach((b) => b.classList.remove('active'));
      panel.querySelectorAll('.gpa-pane').forEach((p) => p.classList.remove('active'));
      item.classList.add('active');
      panel.querySelector(`.gpa-pane[data-pane="${item.dataset.tab}"]`).classList.add('active');
      // item.textContent would also pull in the chat unread badge's digits.
      const badge = item.querySelector('.gpa-chat-badge');
      dropdownLabel.textContent = badge ? item.textContent.replace(badge.textContent, '').trim() : item.textContent;
      dropdown.classList.remove('open');
      // Picking a tab while the sidebar is open closes it right after —
      // matches tapping a destination in a mobile nav drawer: you chose
      // where to go, so the menu gets out of the way and the content gets
      // the room back. The toggle button itself isn't part of this list, so
      // this never fires from clicking it — only from an actual tab pick.
      if (!panel.classList.contains('gpa-sidebar-hidden')) setSidebarHidden(true);
      if (item.dataset.tab !== 'games') stopActiveGame();
      if (item.dataset.tab === 'chat') {
        if (typeof startChatPolling === 'function') startChatPolling();
        if (typeof clearChatUnread === 'function') clearChatUnread();
        if (window.Notification && Notification.permission === 'default') {
          try { Notification.requestPermission(); } catch (e) { /* optional */ }
        }
      }
      if (item.dataset.tab === 'saved') renderSavedInsights();
      if (item.dataset.tab === 'study') renderDeck();
      // Loads the proxy frontend + restores the last destination the FIRST
      // time this tab is opened, not on every script init — no reason to
      // hit any server (even the user's own localhost) before they've asked.
      if (item.dataset.tab === 'browser' && typeof activateProxyPane === 'function') activateProxyPane();
      // Re-fetch weather/news if the user navigates back later in the
      // session — the clock is already ticking continuously via its own
      // interval and doesn't need a refresh here.
      if (item.dataset.tab === 'welcome' && typeof refreshWelcomeData === 'function') refreshWelcomeData();
      if (item.dataset.tab === 'scan' && typeof updatePageSnapshot === 'function') updatePageSnapshot();
      // A hidden pane measures as zero, so games can only be sized once
      // the tab is actually visible.
      else requestAnimationFrame(() => { if (typeof fitGameToStage === 'function') fitGameToStage(); });
    });
  });

  // ---- Welcome pane (landing screen shown right after sign-in) -----------
  // Time-of-day greeting, a live NYC clock, real Lehigh Acres FL weather and
  // news, and a small ambient 3D accent. Weather calls Open-Meteo directly
  // (no worker involved — see worker.js's content-type-locked /read route);
  // news reuses the app's own "AI picks a real URL -> worker /read -> AI
  // summarizes only what's there" research pattern from the Proxy tab.
  function renderWelcomeGreeting() {
    const greetEl = panel.querySelector('#gpa-welcome-greeting');
    const subEl = panel.querySelector('#gpa-welcome-sub');
    if (!greetEl) return;
    const hour = new Date().getHours();
    const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const fullText = currentUser
      ? `${part}, ${currentUser}, welcome to the Agent Console`
      : `${part}, welcome to the Agent Console`;
    typeWelcomeGreeting(greetEl, fullText);
    if (subEl) {
      subEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }

  // Types the greeting out character by character, terminal-style, then
  // leaves a persistent blinking "_" at the end for as long as the pane
  // exists. Distinct from the app's existing .gpa-cursor (a solid bar shown
  // only WHILE an AI reply is streaming, then removed) -- this one is purely
  // decorative and never goes away, so it gets its own class and never
  // calls into typeText()'s remove-on-finish behavior.
  let welcomeGreetGen = 0;
  function typeWelcomeGreeting(el, fullText) {
    const gen = ++welcomeGreetGen; // supersedes any typing loop already in flight
    el.textContent = '';
    const textSpan = document.createElement('span');
    el.appendChild(textSpan);
    const cursor = document.createElement('span');
    cursor.className = 'gpa-welcome-cursor';
    cursor.textContent = '_';
    el.appendChild(cursor);

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      textSpan.textContent = fullText;
      return;
    }
    let i = 0;
    function step() {
      if (gen !== welcomeGreetGen) return; // a newer greeting took over
      if (i >= fullText.length) return;
      textSpan.textContent += fullText[i];
      i++;
      setTimeout(step, 32);
    }
    step();
  }

  function renderNycClock() {
    const el = panel.querySelector('#gpa-welcome-nyc-time');
    if (!el) return;
    try {
      el.textContent = new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { el.textContent = '--:--'; }
  }
  let nycClockInterval = null;
  function startNycClock() {
    renderNycClock();
    if (!nycClockInterval) nycClockInterval = setInterval(renderNycClock, 1000);
  }

  // Small "cool tech" touch: animates a stat number counting up to its real
  // value instead of just appearing, but only when motion is allowed —
  // checked directly since this runs as one immediate rAF burst, not a
  // continuing loop the global reduced-motion CSS override would catch.
  function countUpTo(el, target, opts) {
    if (!el) return;
    const suffix = (opts && opts.suffix) || '';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = target + suffix;
      return;
    }
    const start = 0;
    const duration = 700;
    const startTime = performance.now();
    function step(now) {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // WMO weather codes (Open-Meteo) -> short label + matching emoji, kept
  // consistent with the app's existing emoji-icon convention.
  const WMO_WEATHER = {
    0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
    51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Dense drizzle', '🌧️'],
    56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '❄️'], 73: ['Snow', '❄️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '❄️'],
    80: ['Rain showers', '🌦️'], 81: ['Rain showers', '🌧️'], 82: ['Violent showers', '⛈️'],
    85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
    95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️']
  };

  async function fetchLehighWeather() {
    const tempEl = panel.querySelector('#gpa-welcome-temp');
    const condEl = panel.querySelector('#gpa-welcome-condition');
    const metaEl = panel.querySelector('#gpa-welcome-weather-meta');
    const sunEl = panel.querySelector('#gpa-welcome-sun-meta');
    if (!tempEl) return;
    metaEl.textContent = 'Loading weather…';
    if (sunEl) sunEl.textContent = '';
    try {
      const res = await window.fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=26.6151&longitude=-81.6155&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=sunrise,sunset&temperature_unit=fahrenheit&timezone=America%2FNew_York'
      );
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      const cur = data && data.current;
      if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('no current data');
      const [label, emoji] = WMO_WEATHER[cur.weather_code] || ['Unknown', '🌡️'];
      countUpTo(tempEl, Math.round(cur.temperature_2m), { suffix: '°F' });
      condEl.textContent = `${emoji} ${label} · Lehigh Acres, FL`;
      const asOf = cur.time
        ? new Date(cur.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const wind = typeof cur.wind_speed_10m === 'number' ? ` · Wind ${Math.round(cur.wind_speed_10m)} mph` : '';
      const humidity = typeof cur.relative_humidity_2m === 'number' ? ` · Humidity ${cur.relative_humidity_2m}%` : '';
      metaEl.textContent = `Weather as of ${asOf}${wind}${humidity}`;
      const daily = data && data.daily;
      if (sunEl && daily && daily.sunrise && daily.sunrise[0] && daily.sunset && daily.sunset[0]) {
        const fmt = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        sunEl.textContent = `🌅 Sunrise ${fmt(daily.sunrise[0])} · 🌇 Sunset ${fmt(daily.sunset[0])}`;
      }
    } catch (e) {
      tempEl.textContent = '--°';
      condEl.textContent = 'Lehigh Acres, FL';
      metaEl.textContent = "Couldn't reach the weather service.";
    }
  }

  // Public, PII-free headcount from the worker's /active-count route (see
  // worker.js) — just a number, no usernames. Degrades to a dash (not a
  // fabricated number, not an error) if the worker hasn't been redeployed
  // with the route yet, or telemetry is off.
  async function fetchActiveUsers() {
    const numEl = panel.querySelector('#gpa-welcome-active-num');
    const dotEl = panel.querySelector('#gpa-welcome-active-dot');
    if (!numEl) return;
    if (!OPENAI_PROXY) { numEl.textContent = '--'; if (dotEl) dotEl.style.display = 'none'; return; }
    try {
      const res = await window.fetch(`${OPENAI_PROXY}/active-count`);
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      if (typeof data.count !== 'number') throw new Error('no count');
      countUpTo(numEl, data.count);
      if (dotEl) dotEl.style.display = '';
    } catch (e) {
      numEl.textContent = '--';
      if (dotEl) dotEl.style.display = 'none';
    }
  }

  // The caller's own all-time open count / member-since date rides along on
  // the next heartbeat response (see worker.js's /track yourStats field) —
  // requested immediately here rather than waiting for the 45s timer.
  function renderYourStats(stats) {
    const opensEl = panel.querySelector('#gpa-welcome-opens');
    const sinceEl = panel.querySelector('#gpa-welcome-member-since');
    if (!opensEl || !stats) return;
    if (typeof stats.opens === 'number') countUpTo(opensEl, stats.opens);
    if (sinceEl && stats.firstSeen) {
      sinceEl.textContent = new Date(stats.firstSeen).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
  }
  function fetchYourStats() {
    const opensEl = panel.querySelector('#gpa-welcome-opens');
    if (!opensEl) return;
    if (!currentUser || !telemetryOn()) { opensEl.textContent = '--'; return; }
    sendBeat('beat', currentUser);
  }

  // Live OpenAI status for the Welcome pane: "API key not set" (no
  // local key and no owner assignment — no network call at all, so this
  // never risks the blocking key prompt), "Currently down" (a key exists
  // but a real ping to it failed), or online. The ping is a models-list GET
  // — free/metadata-only, never a paid completion,
  // so checking this on every pane visit costs nothing.
  async function checkAiProviderStatus() {
    const dotEl = panel.querySelector('#gpa-welcome-ai-dot-openai');
    const textEl = panel.querySelector('#gpa-welcome-ai-text-openai');
    if (!dotEl || !textEl) return;

    const localKey = readStoredKey(OPENAI_STORAGE_KEY);
    const hasKey = !!(localKey || (OPENAI_PROXY && serverAssignedKeys.openai));

    if (!hasKey) {
      dotEl.className = 'gpa-status-dot unset';
      textEl.textContent = 'API key not set';
      return;
    }
    dotEl.className = 'gpa-status-dot checking';
    textEl.textContent = 'checking…';

    if (!OPENAI_PROXY) {
      // No proxy to safely verify through — a raw cross-origin ping from an
      // arbitrary host page is more likely to fail on CORS than say
      // anything real about the key, so just confirm one is set.
      dotEl.className = 'gpa-status-dot online';
      textEl.textContent = 'Key configured';
      return;
    }
    try {
      const headers = {};
      if (localKey) headers['Authorization'] = `Bearer ${localKey}`;
      if (currentUser) headers['X-GPA-User'] = currentUser;
      const res = await rawFetch(`${OPENAI_PROXY}/v1/models`, { headers });
      if (res.ok) {
        dotEl.className = 'gpa-status-dot online';
        textEl.textContent = 'Online';
      } else {
        dotEl.className = 'gpa-status-dot down';
        textEl.textContent = 'Currently down';
      }
    } catch (e) {
      dotEl.className = 'gpa-status-dot down';
      textEl.textContent = 'Currently down';
    }
  }
  function checkAllAiStatus() {
    checkAiProviderStatus();
  }
  // Steady-state refresh cadence for the status line — every 10 minutes
  // while the Welcome pane exists, via the file's shadowed setInterval so
  // it's auto-cleared on reload like the NYC clock. Separate from the
  // one-off checks on pane load/revisit and on an actual assigned-key
  // change, which cover the "just did something" cases immediately.
  let welcomeAiStatusInterval = null;
  function startWelcomeAiStatusPolling() {
    if (!welcomeAiStatusInterval) welcomeAiStatusInterval = setInterval(checkAllAiStatus, 10 * 60 * 1000);
  }

  // Non-prompting check: is there already a key this session could use
  // (saved, or owner-assigned server-side) without popping the "paste your
  // API key" dialog? Lets automatic calls (page load, tab revisit) skip AI
  // silently instead of interrupting the user before they've asked for
  // anything — the blocking prompt() is only acceptable as a *response* to
  // an explicit action like pressing Refresh or opening Ask AI/Chat.
  function hasUsableAiKey() {
    return !!(readStoredKey(OPENAI_STORAGE_KEY) || (OPENAI_PROXY && serverAssignedKeys.openai));
  }

  async function fetchLehighNews(auto) {
    const newsEl = panel.querySelector('#gpa-welcome-news');
    const metaEl = panel.querySelector('#gpa-welcome-news-meta');
    const refreshBtn = panel.querySelector('#gpa-welcome-news-refresh');
    if (!newsEl) return;
    // Auto-refresh (pane load / tab revisit) never interrupts with the API
    // key prompt — only an explicit Refresh click may trigger that.
    if (auto && !hasUsableAiKey()) {
      newsEl.textContent = 'Local news summarizes a real article with AI. Set up an OpenAI key in Ask AI, then tap Refresh here.';
      metaEl.textContent = '';
      return;
    }
    newsEl.textContent = 'Looking for local news…';
    metaEl.textContent = '';
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      if (!OPENAI_PROXY) throw new Error('no proxy');
      const urlOut = await callAI(
        'Name ONE real, specific, currently-live local news web page about Lehigh Acres, Florida (or Lee County, FL news covering Lehigh Acres). Respond ONLY with a JSON object: {"url":"..."} — NEVER invent, guess, or approximate a URL. Include "url" ONLY when you are certain that exact address currently exists and is reachable; otherwise respond with {"url":null}. A missing URL is far better than a broken or made-up one.',
        'You are a careful local-news researcher who never fabricates sources.'
      );
      let picked = null;
      try { picked = JSON.parse(urlOut.match(/\{[\s\S]*\}/)[0]); } catch (e) { picked = null; }
      const url = picked && typeof picked.url === 'string' ? picked.url.trim() : '';
      if (!url) throw new Error('no verified url');
      const r = await rawFetch(`${OPENAI_PROXY}/read?url=${encodeURIComponent(url)}`, {
        headers: currentUser ? { 'X-GPA-User': currentUser } : {}
      });
      if (!r.ok) throw new Error('fetch failed');
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((el) => el.remove());
      const txt = (doc.body.innerText || '').replace(/\s+\n/g, '\n').trim();
      if (txt.length < 200) throw new Error('page too thin');
      const summary = await callAI(
        `Here is the raw text of a news page about Lehigh Acres, FL:\n\n${txt.slice(0, 8000)}`,
        'Summarize ONLY what is actually stated in this text, in 2-3 plain sentences. Do not add any outside facts, dates, or claims not present in the text. No markdown symbols.'
      );
      newsEl.textContent = stripConfidence(summary);
      metaEl.textContent = `Source: ${url} · Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } catch (e) {
      newsEl.textContent = 'No verified local news source found right now. Try refreshing in a bit.';
      metaEl.textContent = '';
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function refreshWelcomeData() {
    fetchLehighWeather();
    fetchLehighNews(true); // auto: never prompts for an API key on its own
    fetchActiveUsers();
    fetchYourStats();
    checkAllAiStatus();
  }
  const welcomeRefreshBtn = panel.querySelector('#gpa-welcome-news-refresh');
  // Explicit click: the user asked for AI content, so a key prompt here (if
  // needed) is an expected response to that action, not an interruption.
  if (welcomeRefreshBtn) welcomeRefreshBtn.addEventListener('click', () => fetchLehighNews(false));

  // Quick actions: jump straight to another tab by replaying a click on its
  // real nav button, so every existing side effect that click already
  // triggers (badge clearing, sidebar auto-close, chat polling, etc.) fires
  // exactly as it would from the sidebar — no separate code path to drift.
  panel.querySelectorAll('.gpa-welcome-quick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = panel.querySelector(`.gpa-dropdown-item[data-tab="${btn.dataset.jump}"]`);
      if (target) target.click();
    });
  });

  // Small ambient 3D accent (Three.js, "Layered Separation" pattern): a
  // single low-poly icosahedron, rotating about once per 45s — deliberately
  // slow and small so it reads as ambient, never attention-grabbing.
  function stopWelcome3d() {
    if (gpaWelcome3d && gpaWelcome3d.raf) cancelAnimationFrame(gpaWelcome3d.raf);
  }

  function updateWelcome3dColor() {
    if (!gpaWelcome3d || !gpaWelcome3d.mesh) return;
    const accent = (THEMES[theme] || THEMES.matte).accent;
    gpaWelcome3d.mesh.material.color.set(accent);
    if (gpaWelcome3d.orbiters) gpaWelcome3d.orbiters.forEach((o) => o.material.color.set(accent));
  }

  function mountWelcome3d() {
    const canvas = panel.querySelector('#gpa-welcome-3d');
    if (!canvas || typeof THREE === 'undefined') return;
    if (gpaWelcome3d) { canvas.style.display = ''; return; } // already mounted
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(140, 140, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
      camera.position.z = 3.2;

      // Everything sits in one group so a pointer-driven tilt (below) can
      // move the whole little scene at once without fighting the mesh's own
      // independent spin.
      const group = new THREE.Group();
      scene.add(group);

      const accent = (THEMES[theme] || THEMES.matte).accent;
      const geo = new THREE.IcosahedronGeometry(1.15, 0);
      const mat = new THREE.MeshStandardMaterial({ color: accent, flatShading: true, roughness: 0.4, metalness: 0.1 });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      // A few tiny orbiters add a second, slower layer of ambient motion —
      // still small and unhurried, same "never attention-grabbing" rule as
      // the icosahedron's own spin.
      const orbiterGeo = new THREE.SphereGeometry(0.11, 12, 12);
      const orbiterMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
      const orbiters = [0, 1, 2].map((i) => {
        const m = new THREE.Mesh(orbiterGeo, orbiterMat);
        m.userData.angle = (i / 3) * Math.PI * 2;
        group.add(m);
        return m;
      });

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const light = new THREE.DirectionalLight(0xffffff, 0.8);
      light.position.set(2, 2, 3);
      scene.add(light);

      gpaWelcome3d = { renderer, scene, camera, mesh, group, orbiters, raf: null, tilt: { x: 0, y: 0 } };
      canvas.style.display = '';

      const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      const reduceMotion = () => !!(motionQuery && motionQuery.matches);

      // Subtle pointer-parallax: the whole group leans a few degrees toward
      // the cursor. Skipped entirely under reduced motion, same as the spin,
      // since it's still motion — just triggered by input instead of a timer.
      canvas.addEventListener('mousemove', (e) => {
        if (!gpaWelcome3d || reduceMotion()) return;
        const rect = canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        gpaWelcome3d.tilt.x = ny * 0.18;
        gpaWelcome3d.tilt.y = nx * 0.18;
      });
      canvas.addEventListener('mouseleave', () => {
        if (gpaWelcome3d) { gpaWelcome3d.tilt.x = 0; gpaWelcome3d.tilt.y = 0; }
      });

      // ~one full turn per 45s at 60fps.
      const perFrame = (Math.PI * 2) / (45 * 60);
      const orbitSpeed = perFrame * 2.2;
      const orbitRadius = 1.0; // stays inside the 45deg-fov frame at this camera distance
      const welcomePane = panel.querySelector('.gpa-pane[data-pane="welcome"]');
      function frame() {
        if (reduceMotion()) {
          renderer.render(scene, camera); // one static frame, then stop
          gpaWelcome3d.raf = null;
          return;
        }
        // Off screen (another pane, minimized, hidden tab): stop rendering.
        // resumeWelcome3d() restarts it when the Welcome pane is back.
        if (isMin || !welcomePane || !welcomePane.classList.contains('active') || document.visibilityState === 'hidden') {
          gpaWelcome3d.raf = null;
          return;
        }
        mesh.rotation.x += perFrame * 0.6;
        mesh.rotation.y += perFrame;
        orbiters.forEach((o) => {
          o.userData.angle += orbitSpeed;
          const a = o.userData.angle;
          o.position.set(Math.cos(a) * orbitRadius, Math.sin(a * 0.6) * 0.4, Math.sin(a) * orbitRadius);
        });
        group.rotation.x += (gpaWelcome3d.tilt.x - group.rotation.x) * 0.08;
        group.rotation.y += (gpaWelcome3d.tilt.y - group.rotation.y) * 0.08;
        renderer.render(scene, camera);
        gpaWelcome3d.raf = requestAnimationFrame(frame);
      }
      // The frame() loop only checks reduceMotion() on its own tick, so once
      // it stops there's nothing left running to notice the preference
      // turning back off — this listener is what restarts it.
      if (motionQuery) {
        const onMotionChange = () => { if (!reduceMotion() && gpaWelcome3d && gpaWelcome3d.raf === null) frame(); };
        if (motionQuery.addEventListener) {
          motionQuery.addEventListener('change', onMotionChange);
          gpaCleanups.push(() => motionQuery.removeEventListener('change', onMotionChange));
        } else if (motionQuery.addListener) motionQuery.addListener(onMotionChange); // older Safari
      }
      gpaWelcome3d.frame = frame;
      if (welcomePane) {
        const resume = () => { if (gpaWelcome3d && gpaWelcome3d.raf === null) frame(); };
        const obs = new MutationObserver(resume);
        obs.observe(welcomePane, { attributes: true, attributeFilter: ['class'] });
        obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
        onDoc('visibilitychange', resume);
        gpaCleanups.push(() => obs.disconnect());
      }
      frame();
    } catch (e) {
      canvas.style.display = 'none';
    }
  }

  let threeJsLoadState = 'idle'; // idle | loading | ready | failed
  function loadThreeJs() {
    const canvas = panel.querySelector('#gpa-welcome-3d');
    if (threeJsLoadState === 'ready') { mountWelcome3d(); return; }
    if (threeJsLoadState === 'loading' || threeJsLoadState === 'failed') return;
    if (typeof THREE !== 'undefined') { threeJsLoadState = 'ready'; mountWelcome3d(); return; }
    if (document.getElementById('gpa-threejs-script')) return; // another instance already injecting it
    threeJsLoadState = 'loading';
    const script = document.createElement('script');
    script.id = 'gpa-threejs-script';
    script.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
    script.onload = () => { threeJsLoadState = 'ready'; mountWelcome3d(); };
    script.onerror = () => {
      threeJsLoadState = 'failed';
      if (canvas) canvas.style.display = 'none';
    };
    document.head.appendChild(script);
  }

  function activateWelcomePane() {
    panel.querySelectorAll('.gpa-dropdown-item').forEach((b) => b.classList.remove('active'));
    panel.querySelectorAll('.gpa-pane').forEach((p) => p.classList.remove('active'));
    const navItem = panel.querySelector('.gpa-dropdown-item[data-tab="welcome"]');
    const pane = panel.querySelector('.gpa-pane[data-pane="welcome"]');
    if (navItem) navItem.classList.add('active');
    if (pane) pane.classList.add('active');
    if (navItem && dropdownLabel) {
      const badge = navItem.querySelector('.gpa-chat-badge');
      dropdownLabel.textContent = badge ? navItem.textContent.replace(badge.textContent, '').trim() : navItem.textContent;
    }
    renderWelcomeGreeting();
    startNycClock();
    refreshWelcomeData();
    startWelcomeAiStatusPolling();
    loadThreeJs();
  }

(function wireReasoning() {
  const btns = panel.querySelectorAll('.gpa-reason');
  const note = panel.querySelector('#gpa-reason-note');
  function refresh() {
    // Active when either model can use it: the base model directly, or the
    // smart model that hard tasks switch to when auto-upgrade is on.
    const active = modelSupportsReasoning(effectiveModel(OPENAI_MODEL, false))
      || (autoUpgradeOn() && modelSupportsReasoning(smartModel()));
    btns.forEach((b) => {
      b.classList.toggle('primary', b.dataset.reason === reasoningEffort);
      b.disabled = !active;
      b.style.opacity = active ? '' : '0.4';
    });
    if (note) note.textContent = active ? ''
      : "Neither model uses reasoning effort right now. It applies to the smart model (gpt-5) when auto-upgrade is on.";
  }
  btns.forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    reasoningEffort = b.dataset.reason;
    localStorage.setItem(REASON_KEY, reasoningEffort);
    refresh();
  }));
  setTimeout(refresh, 0);
})();
  // ---- Language ---------------------------------------------------------
  // Partial localization: covers the chrome a user sees before they've even
  // signed in or picked a tool (nav, header, login), not the whole app —
  // translating every one of the thousands of strings across all 10 panes
  // and the admin console is a much larger job than this covers today.
  const LANG_KEY = 'gpa_language';
  const NAV_LABELS_EN = {
    welcome: 'Welcome', scan: 'Page Insights', ask: 'Ask AI', chat: 'Chat', music: 'Music',
    browser: 'Proxy', games: 'Games', study: 'Study', notes: 'Notes',
    humanize: 'Humanize', grammar: 'Grammar', saved: 'Saved', theme: 'Settings'
  };
  const I18N = {
    es: {
      'Welcome': 'Bienvenida',
      'Page Insights': 'Información de la página', 'Ask AI': 'Preguntar a la IA',
      'Chat': 'Chat', 'Music': 'Música', 'Proxy': 'Proxy', 'Games': 'Juegos',
      'Study': 'Estudio', 'Notes': 'Notas', 'Humanize': 'Humanizar', 'Grammar': 'Gramática', 'Saved': 'Guardado', 'Settings': 'Ajustes',
      'Agent Console': 'Consola del Agente',
      'Sign in to continue': 'Inicia sesión para continuar',
      'Welcome back': 'Bienvenido de nuevo',
      'Username': 'Usuario', 'PIN': 'PIN', 'Sign in': 'Iniciar sesión',
      'Transfer access code': 'Transferir código de acceso'
    }
  };
  function currentLang() { return localStorage.getItem(LANG_KEY) || 'en'; }
  function t(text) {
    const dict = I18N[currentLang()];
    return (dict && dict[text]) || text;
  }
  function applyLanguage() {
    panel.querySelectorAll('.gpa-dropdown-item[data-tab]').forEach((item) => {
      const label = item.querySelector('.gpa-nav-label');
      const en = NAV_LABELS_EN[item.dataset.tab];
      if (label && en) label.textContent = t(en);
    });
    const titleEl = panel.querySelector('.gpa-title');
    // Only translate the built-in name — an owner-set brand name (see
    // applyBrandName) always wins and is left exactly as the owner typed it.
    if (titleEl && (titleEl.textContent === 'Agent Console' || titleEl.textContent === t('Agent Console'))) {
      titleEl.textContent = t('Agent Console');
    }
    const map = {
      '.gpa-login-heading': 'Welcome back',
      '.gpa-login-label[for="gpa-login-user"]': 'Username',
      '.gpa-login-label[for="gpa-login-pin"]': 'PIN',
      '#gpa-login-btn': 'Sign in',
      '#gpa-login-restore': 'Transfer access code',
      '.gpa-login-dept': 'Sign in to continue'
    };
    Object.keys(map).forEach((sel) => {
      const el = panel.querySelector(sel);
      if (el) el.textContent = t(map[sel]);
    });
  }
  function syncLangButtons() {
    const lang = currentLang();
    panel.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('primary', b.dataset.lang === lang));
  }
  function setLanguage(lang) {
    localStorage.setItem(LANG_KEY, lang);
    syncLangButtons();
    applyLanguage();
    // gpa_language rides along in the profile snapshot, so writing it back now
    // pins the choice to whoever is signed in rather than to this browser.
    if (typeof saveProgress === 'function') saveProgress();
  }
  panel.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  });
  (function initLangUI() {
    syncLangButtons();
    applyLanguage();
  })();

  // ---- Post-sign-in language prompt ---------------------------------------
  // An in-console dialog (not a browser notification) shown centered over the
  // panel the first time an account signs in. The "asked already" flag is a
  // gpa_ key, so like the language itself it lives in the profile snapshot —
  // each account gets the question once and keeps its own answer.
  const LANG_ASKED_KEY = 'gpa_language_asked';
  const langPick = panel.querySelector('#gpa-langpick');
  function closeLanguagePicker() {
    langPick.style.display = 'none';
  }
  function showLanguagePicker(user) {
    const who = panel.querySelector('#gpa-langpick-who');
    if (who) who.textContent = user ? `Applies to ${user}` : '';
    const lang = currentLang();
    langPick.querySelectorAll('.gpa-langpick-opt').forEach((b) => {
      b.classList.toggle('current', b.dataset.lang === lang);
    });
    langPick.style.display = 'flex';
  }
  langPick.querySelectorAll('.gpa-langpick-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLanguage(btn.dataset.lang);
      localStorage.setItem(LANG_ASKED_KEY, '1');
      if (typeof saveProgress === 'function') saveProgress();
      closeLanguagePicker();
    });
  });
  function maybePromptLanguage(user) {
    if (localStorage.getItem(LANG_ASKED_KEY) === '1') return;
    showLanguagePicker(user);
  }

  // ---- Theme swatches -----------------------------------------------------
  // Set once someone picks a theme themselves, so the owner's server-side
  // default theme never overrides a personal choice. Theme clicks are wired
  // in the settings module (the gallery is rendered there).
  const THEME_USER_SET_KEY = 'gpa_theme_user_set';

  panel.querySelector('#gpa-clear-openai-key').addEventListener('click', () => {
    localStorage.removeItem(OPENAI_STORAGE_KEY);
    localStorage.removeItem(OPENAI_KEY_SKIP);
    showToast('Saved OpenAI API key cleared. You\'ll be asked for one again next time (an owner-assigned key, if you have one, still works regardless).');
  });
  panel.querySelector('#gpa-clear-yt-key').addEventListener('click', () => {
    localStorage.removeItem(YT_STORAGE_KEY);
    showToast('Saved YouTube API key cleared for this site.');
  });

  // ---- Minimized-button icon toggle --------------------------------------
  const iconBtns = panel.querySelectorAll('.icon-btn');
  function setIconUI(i) {
    iconBtns.forEach((b) => b.classList.toggle('primary', b.dataset.icon === i));
  }
  setIconUI(localStorage.getItem(ICON_KEY) || 'dot');
  iconBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_KEY, btn.dataset.icon);
      setIconUI(btn.dataset.icon);
      renderMiniIcon();
    });
  });

  // ---- Minimized-button look (Futuristic / Minimal) ----------------------
  const lookBtns = panel.querySelectorAll('.look-btn');
  function setLookUI(l) {
    lookBtns.forEach((b) => b.classList.toggle('primary', b.dataset.look === l));
  }
  setLookUI(localStorage.getItem(ICON_LOOK_KEY) || 'minimal');
  lookBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_LOOK_KEY, btn.dataset.look);
      setLookUI(btn.dataset.look);
      applyMiniLook();
    });
  });

  // ---- Minimized-button color (Theme accent / Match this page) ----------
  const colorModeBtns = panel.querySelectorAll('.colormode-btn');
  function setColorModeUI(m) {
    colorModeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.colormode === m));
  }
  setColorModeUI(localStorage.getItem(ICON_COLOR_MODE_KEY) || 'page');
  colorModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_COLOR_MODE_KEY, btn.dataset.colormode);
      setColorModeUI(btn.dataset.colormode);
      applyMiniColorMode();
    });
  });

  // ---- Typing speed toggle ------------------------------------------------
  const speedBtns = panel.querySelectorAll('.speed-btn');
  function setSpeedUI(s) {
    speedBtns.forEach((b) => b.classList.toggle('primary', b.dataset.speed === s));
  }
  setSpeedUI(localStorage.getItem(SPEED_KEY) || 'normal');
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(SPEED_KEY, btn.dataset.speed);
      setSpeedUI(btn.dataset.speed);
    });
  });

  // ---- Response font toggle ------------------------------------------------
  const fontBtns = panel.querySelectorAll('.font-btn');
  function setFontUI(f) {
    fontBtns.forEach((b) => b.classList.toggle('primary', b.dataset.font === f));
    panel.classList.toggle('gpa-font-system', f === 'system');
  }
  setFontUI(localStorage.getItem(FONT_KEY) || 'mono');
  fontBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(FONT_KEY, btn.dataset.font);
      setFontUI(btn.dataset.font);
    });
  });

  // ---- Ambient particle background ---------------------------------------
  // A canvas that floats around the panel's edges (not on top of content,
  // so it never blocks a click) with several interactive styles. Particles
  // gently drift away from the cursor and are tinted with the current
  // theme's accent color, so switching themes re-colors them automatically.
  // The "play area" (how far the particle field extends past the panel's
  // edges) is adjustable via a slider in Settings.
  const particleCtx = particleCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let particleMargin = parseInt(localStorage.getItem(PARTICLE_SIZE_KEY), 10);
  if (isNaN(particleMargin)) particleMargin = 40;
  let PW = PARTICLE_PANEL_W + particleMargin * 2;
  let PH = PARTICLE_PANEL_H + particleMargin * 2;

  function resizeParticleCanvas() {
    PW = PARTICLE_PANEL_W + particleMargin * 2;
    PH = PARTICLE_PANEL_H + particleMargin * 2;
    particleCanvas.style.inset = `-${particleMargin}px`;
    particleCanvas.width = PW * dpr;
    particleCanvas.height = PH * dpr;
    particleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeParticleCanvas();

  // Particle tuning from Settings → Effects: multipliers on count, radius,
  // velocity and opacity. Applied when particles are created (count, size,
  // motion) and when they're drawn (intensity).
  const PARTICLE_FX_KEY = 'gpa_particle_fx';
  const PARTICLE_FX_DEFAULTS = { density: 1, size: 1, speed: 1, intensity: 1 };
  const PARTICLE_FX_LIMITS = { density: [0.3, 2], size: [0.5, 2.5], speed: [0.2, 2.5], intensity: [0.2, 1.5] };
  function loadParticleFx() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(PARTICLE_FX_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    const out = { ...PARTICLE_FX_DEFAULTS };
    Object.keys(PARTICLE_FX_LIMITS).forEach((k) => {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = Math.max(PARTICLE_FX_LIMITS[k][0], Math.min(PARTICLE_FX_LIMITS[k][1], v));
    });
    return out;
  }
  let particleFx = loadParticleFx();
  function setParticleFx(k, v) {
    if (!PARTICLE_FX_LIMITS[k] || !Number.isFinite(v)) return;
    particleFx = { ...particleFx, [k]: Math.max(PARTICLE_FX_LIMITS[k][0], Math.min(PARTICLE_FX_LIMITS[k][1], v)) };
    try { localStorage.setItem(PARTICLE_FX_KEY, JSON.stringify(particleFx)); } catch (e) { /* storage blocked */ }
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
  }
  const particleMotionQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let particles = [];
  let particleAnimId = null;
  let mouseX = -9999, mouseY = -9999;

  particleWrap.addEventListener('mousemove', (e) => {
    const rect = particleCanvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });
  particleWrap.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(full, 16);
    return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
  }

  function makeParticle(styleName, w = PW, h = PH) {
    const p = { style: styleName };
    if (styleName === 'snow') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.3; p.vy = 0.3 + Math.random() * 0.6;
      p.r = 1 + Math.random() * 2; p.alpha = 0.4 + Math.random() * 0.5; p.sway = Math.random() * Math.PI * 2;
    } else if (styleName === 'bubbles') {
      p.x = Math.random() * w; p.y = h + Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.2; p.vy = -(0.3 + Math.random() * 0.5);
      p.r = 2 + Math.random() * 4; p.alpha = 0.15 + Math.random() * 0.25; p.wobble = Math.random() * Math.PI * 2;
    } else if (styleName === 'stars') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = 0; p.vy = 0; p.r = 1 + Math.random() * 1.8;
      p.phase = Math.random() * Math.PI * 2; p.speed = 0.015 + Math.random() * 0.03;
    } else if (styleName === 'network') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.5; p.vy = (Math.random() - 0.5) * 0.5;
      p.r = 1.8; p.alpha = 0.85;
    } else if (styleName === 'fireflies') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.18; p.vy = (Math.random() - 0.5) * 0.18;
      p.r = 2 + Math.random() * 2.5; p.phase = Math.random() * Math.PI * 2; p.speed = 0.01 + Math.random() * 0.02;
    } else if (styleName === 'confetti') {
      p.x = Math.random() * w; p.y = Math.random() * h - h;
      p.vx = (Math.random() - 0.5) * 0.6; p.vy = 0.6 + Math.random() * 1.1;
      p.rw = 4 + Math.random() * 4; p.rh = 3 + Math.random() * 3;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 0.08;
      p.shade = Math.floor(Math.random() * 3);
    } else { // sparkles (default)
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.15; p.vy = (Math.random() - 0.5) * 0.15;
      p.r = 0.6 + Math.random() * 1.6; p.phase = Math.random() * Math.PI * 2; p.speed = 0.02 + Math.random() * 0.04;
    }
    // Settings → Effects multipliers.
    const sp = particleFx.speed, sz = particleFx.size;
    p.vx *= sp; p.vy *= sp;
    if (p.speed) p.speed *= sp;
    if (p.vr) p.vr *= sp;
    if (p.r) p.r *= sz;
    if (p.rw) { p.rw *= sz; p.rh *= sz; }
    return p;
  }

  // Density scales with the area so a bigger canvas doesn't look sparse,
  // then by the user's density multiplier.
  function buildParticles(styleName, w, h) {
    if (styleName === 'off') return [];
    const base = Math.max(16, Math.min(90, Math.round((w * h) / 4200)));
    const count = Math.max(6, Math.min(180, Math.round(base * particleFx.density)));
    const list = [];
    for (let i = 0; i < count; i++) list.push(makeParticle(styleName, w, h));
    return list;
  }
  function initParticles(styleName) {
    particles = buildParticles(styleName, PW, PH);
  }

  // Draws one frame of a particle field onto any 2D context. Shared by the
  // ambient field around the panel and the live preview in Settings.
  function drawParticleFrame(ctx, list, w, h, styleName, mx, my, rgb) {
    ctx.clearRect(0, 0, w, h);
    const k = particleFx.intensity;
    const R = rgb.r | 0, G = rgb.g | 0, B = rgb.b | 0;
    const col = (a) => `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a * k))})`;

    if (styleName === 'network') {
      list.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });
      const linkDist = Math.min(w, h) * 0.18;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < linkDist) {
            ctx.strokeStyle = col(0.22 * (1 - d / linkDist));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      list.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = col(p.alpha);
        ctx.fill();
      });
      return;
    }

    if (styleName === 'confetti') {
      const shades = [`rgb(${R},${G},${B})`, THEMES[theme].text, THEMES[theme].sub];
      list.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, 0.85 * k);
        ctx.fillStyle = shades[p.shade % shades.length];
        ctx.fillRect(-p.rw / 2, -p.rh / 2, p.rw, p.rh);
        ctx.restore();
      });
      return;
    }

    const sp = particleFx.speed;
    list.forEach((p) => {
      const dx = p.x - mx, dy = p.y - my;
      const dist = Math.hypot(dx, dy);
      if (dist < 60 && dist > 0.01) {
        const force = ((60 - dist) / 60) * 1.4;
        p.x += (dx / dist) * force;
        p.y += (dy / dist) * force;
      }
      let alpha = 0.6;
      if (p.style === 'snow') {
        p.sway += 0.02 * sp;
        p.x += p.vx + Math.sin(p.sway) * 0.3;
        p.y += p.vy;
        if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
        alpha = p.alpha;
      } else if (p.style === 'bubbles') {
        p.wobble += 0.03 * sp;
        p.x += p.vx + Math.sin(p.wobble) * 0.4;
        p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        alpha = p.alpha;
      } else if (p.style === 'stars') {
        p.phase += p.speed;
        alpha = 0.2 + Math.abs(Math.sin(p.phase)) * 0.8;
      } else if (p.style === 'fireflies') {
        p.x += p.vx; p.y += p.vy;
        p.phase += p.speed;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        alpha = 0.25 + Math.abs(Math.sin(p.phase)) * 0.6;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        glow.addColorStop(0, col(alpha));
        glow.addColorStop(1, `rgba(${R},${G},${B},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      } else { // sparkles
        p.x += p.vx; p.y += p.vy;
        p.phase += p.speed;
        alpha = 0.25 + Math.abs(Math.sin(p.phase)) * 0.75;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = col(alpha);
      ctx.fill();
    });
  }

  // The field's color eases toward the theme's particle token, so a theme
  // change fades the particles over ~half a second instead of snapping.
  let particleRGB = null;
  function particleColorStep() {
    const target = hexRgb(resolveTheme(theme).particle);
    if (!particleRGB || (particleMotionQ && particleMotionQ.matches)) { particleRGB = { ...target }; return particleRGB; }
    particleRGB.r += (target.r - particleRGB.r) * 0.1;
    particleRGB.g += (target.g - particleRGB.g) * 0.1;
    particleRGB.b += (target.b - particleRGB.b) * 0.1;
    return particleRGB;
  }

  function stepParticles() {
    const styleName = particlesSuppressed ? 'off' : (localStorage.getItem(PARTICLE_KEY) || 'off');
    if (styleName === 'off') {
      particleCtx.clearRect(0, 0, PW, PH);
      particleAnimId = null;
      return;
    }
    drawParticleFrame(particleCtx, particles, PW, PH, styleName, mouseX, mouseY, particleColorStep());
    // Ambient motion is decorative: with reduced motion on, draw one still
    // frame and stop. The change listener below restarts it if that flips.
    if (particleMotionQ && particleMotionQ.matches) { particleAnimId = null; return; }
    particleAnimId = requestAnimationFrame(stepParticles);
  }
  if (particleMotionQ && particleMotionQ.addEventListener) {
    const onParticleMotion = () => {
      if (!particleMotionQ.matches && !particleAnimId && !isMin && (localStorage.getItem(PARTICLE_KEY) || 'off') !== 'off') stepParticles();
    };
    particleMotionQ.addEventListener('change', onParticleMotion);
    gpaCleanups.push(() => particleMotionQ.removeEventListener('change', onParticleMotion));
  }

  // True while signed out: the field stays hidden without touching the saved
  // style. (Writing 'off' here used to erase the saved style on every page
  // load, so a restored session always came back with particles off.)
  let particlesSuppressed = false;
  function setParticleStyle(styleName, opts) {
    if (!(opts && opts.persist === false)) localStorage.setItem(PARTICLE_KEY, styleName);
    if (particlesSuppressed) styleName = 'off';
    particleCanvas.style.display = styleName === 'off' || isMin ? 'none' : 'block';
    initParticles(styleName);
    if (particleAnimId) cancelAnimationFrame(particleAnimId);
    particleAnimId = null;
    if (styleName !== 'off' && !isMin) stepParticles();
  }

  const particleBtns = panel.querySelectorAll('.particle-btn');
  function setParticleUI(s) {
    particleBtns.forEach((b) => b.classList.toggle('primary', b.dataset.particle === s));
  }
  setParticleUI(localStorage.getItem(PARTICLE_KEY) || 'off');
  // Particles stay off until someone signs in — before login we don't know
  // whose preference applies, and the login screen should look plain.
  particlesSuppressed = true;
  setParticleStyle('off', { persist: false });

  particleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setParticleUI(btn.dataset.particle);
      setParticleStyle(btn.dataset.particle);
    });
  });

  const particleSizeInput = panel.querySelector('#gpa-particle-size');
  particleSizeInput.value = particleMargin;
  particleSizeInput.addEventListener('input', (e) => {
    particleMargin = parseInt(e.target.value, 10);
    localStorage.setItem(PARTICLE_SIZE_KEY, String(particleMargin));
    resizeParticleCanvas();
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
  });

  // ---- Interface size presets ---------------------------------------------
  // Defaults to the full-page "app" surface now rather than the small
  // windowed panel — the windowed presets are still there for anyone who
  // wants the old floating-widget footprint back.
  let panelSizeKey = localStorage.getItem(PANEL_SIZE_KEY) || 'full';
  if (!PANEL_SIZES[panelSizeKey] && panelSizeKey !== 'full') panelSizeKey = 'full';
  const sizeBtns = panel.querySelectorAll('.size-btn');
  function setSizeUI(s) {
    sizeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.size === s));
  }
  function applyPanelSize(key) {
    panelSizeKey = (PANEL_SIZES[key] || key === 'full') ? key : 'full';
    localStorage.setItem(PANEL_SIZE_KEY, panelSizeKey);
    const { w, h } = sizeFor(panelSizeKey);
    if (!isMin) {
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      panel.classList.toggle('gpa-fullpage', panelSizeKey === 'full');
      if (panelSizeKey === 'full') {
        host.style.left = FULL_MARGIN + 'px';
        host.style.top = FULL_MARGIN + 'px';
      }
    }
    // Keep the ambient particle field sized to whatever the panel is now.
    PARTICLE_PANEL_W = w;
    PARTICLE_PANEL_H = h;
    resizeParticleCanvas();
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
    // The games stage just changed size too — rescale whatever is loaded.
    if (typeof fitGameToStage === 'function') requestAnimationFrame(fitGameToStage);
  }
  setSizeUI(panelSizeKey);
  applyPanelSize(panelSizeKey);
  // A page that injects this script before its own layout has settled (or an
  // embedding iframe still mid-resize) can report a too-small window size at
  // this exact instant, which "full" would otherwise floor to a cramped
  // fallback forever. One re-apply next frame — after layout has caught up —
  // self-corrects it; it's a harmless no-op if the size was already right.
  requestAnimationFrame(() => applyPanelSize(panelSizeKey));
  // Full-page mode is the one size that should actually track the window —
  // it's meant to fill it, not just have filled it once at some past moment.
  onWin('resize', () => { if (panelSizeKey === 'full' && !isMin) applyPanelSize('full'); });
  sizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSizeUI(btn.dataset.size);
      applyPanelSize(btn.dataset.size);
    });
  });

  // ---- API key hygiene ----------------------------------------------------
  // Keys get pasted out of web pages, PDFs, docs and chat apps, which is how
  // invisible characters end up inside them: zero-width spaces, non-breaking
  // spaces, soft hyphens, stray newlines. Every one of those is ILLEGAL in an
  // HTTP header value, so fetch() rejects the entire request with the famously
  // unhelpful "Failed to execute 'fetch' on 'Window': Invalid value" — thrown
  // locally, before a single byte reaches the API, and identical whether the
  // key is good or garbage. Worse, XMLHttpRequest silently declines to set the
  // bad header instead of throwing, so that transport sends an unauthenticated
  // request and the API answers 401 — which reads like a rejected key and
  // sends you off rotating a key that was fine all along.
  //
  // So: scrub on the way in and on the way out. A header value may only
  // contain printable ASCII (0x21-0x7E); anything else is removed.
  const HEADER_SAFE_RE = /^[\x21-\x7E]+$/;

  function sanitizeKey(raw) {
    if (!raw) return '';
    // One rule covers every case: keep printable ASCII, drop everything else.
    // That removes spaces, tabs and newlines (0x20 and below), and every
    // invisible troublemaker above 0x7E — zero-width space U+200B, zero-width
    // joiner U+200D, BOM U+FEFF, non-breaking space U+00A0, soft hyphen
    // U+00AD — none of which can legally appear in a header value anyway.
    return String(raw).replace(/[^\x21-\x7E]/g, '');
  }

  // Reads a stored key, scrubs it, and writes the clean version back so the
  // repair sticks instead of being redone on every request.
  function readStoredKey(storageKey) {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return '';
    const clean = sanitizeKey(raw);
    if (clean !== raw) {
      if (clean) localStorage.setItem(storageKey, clean);
      console.info('[Agent Console] removed ' + (raw.length - clean.length) + ' invisible/illegal character(s) from the saved key');
    }
    return clean;
  }

  // Last line of defence before a key goes into a header.
  function assertHeaderSafe(key, providerLabel) {
    if (!HEADER_SAFE_RE.test(key)) {
      throw new Error(
        `Your ${providerLabel} key contains characters that cannot be sent in a request header. ` +
        'Clear the key in Settings and paste it again — copying it from a plain text field avoids the hidden formatting that causes this.'
      );
    }
  }

  // ---- Admin overrides ------------------------------------------------------
  // The admin console (unlocked with a PIN, see far below) can override a few
  // engine settings. They live in their own localStorage keys, kept out of
  // profile snapshots so they're device-global and survive sign-in/sign-out.
  // Honest note: this PIN is a soft lock on a local UI, not access control.
  // It is in a public file, so treat it as "hides the panel", nothing more.
  // Everything that actually matters — reading telemetry, moderating users,
  // assigning keys, changing config — is enforced by the worker against the
  // ADMIN_TOKEN, which is never stored on this device (see sessionSecrets).
  // Someone who bypasses this PIN gets an admin panel that can't do anything.
  const ADMIN_PIN = '1029';
  const ADMIN_KEYS = {
    MODEL: 'gpa_admin_model',
    SMART_MODEL: 'gpa_admin_smart_model',   // stronger model for hard tasks
    AUTO_UPGRADE: 'gpa_admin_auto_upgrade', // 'on' -> use SMART_MODEL on hard tasks
    SYSPREFIX: 'gpa_admin_sysprefix',
    MAXCHARS: 'gpa_admin_maxchars',
    TEMP: 'gpa_admin_temp',
    LOGS: 'gpa_admin_logs',
    TELE_TOKEN: 'gpa_admin_tele_token',      // admin secret (owner's device only)
    TELE_ENDPOINT: 'gpa_admin_tele_endpoint', // worker base URL override
    TELE_NOTICE_SEEN: 'gpa_tele_notice_seen',
    OWNER_CODE: 'gpa_owner_code'              // proves this device is really the owner (see worker.js OWNER_CODE)
  };
  // ---- Session-only secrets -------------------------------------------------
  // The admin token and the owner code are credentials, and this script runs
  // inside whatever page it was opened on — localStorage there is shared with
  // that page's own JavaScript, so anything persisted is readable by the site
  // (and by every other script it loads). Both therefore live in memory for
  // the life of this session only, and any copy an older build left behind is
  // deleted on startup. The cost is re-entering the token after a reload; the
  // alternative is handing the owner's token to every page they visit.
  const sessionSecrets = { adminToken: '', ownerCode: '' };
  const SECRET_KEYS = ['gpa_admin_tele_token', 'gpa_owner_code'];
  (function purgePersistedSecrets() {
    SECRET_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  })();
  function admGet(k) {
    if (k === ADMIN_KEYS.TELE_TOKEN) return sessionSecrets.adminToken || null;
    if (k === ADMIN_KEYS.OWNER_CODE) return sessionSecrets.ownerCode || null;
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function admSetSecret(k, v) {
    if (k === ADMIN_KEYS.TELE_TOKEN) sessionSecrets.adminToken = v || '';
    else if (k === ADMIN_KEYS.OWNER_CODE) sessionSecrets.ownerCode = v || '';
  }
  // Admin calls carry the token in the Authorization header. It used to ride
  // in the query string, where it lands in the worker's request logs, in any
  // proxy or CDN in between, and in the browser's own history.
  function adminAuthHeaders(token, extra) {
    return { ...(extra || {}), Authorization: 'Bearer ' + String(token || '').trim() };
  }
  // Auto-upgrade defaults to ON until the owner explicitly turns it off.
  function autoUpgradeOn() { const v = admGet(ADMIN_KEYS.AUTO_UPGRADE); return v === null ? true : v === 'on'; }
  function smartModel() { return (admGet(ADMIN_KEYS.SMART_MODEL) || '').trim() || SMART_MODEL_DEFAULT; }
  // Writes the default base and smart models into storage. Runs once when the
  // script loads and again on every sign-in (see enterApp), so each session
  // starts on gpt-4.1-mini / gpt-5 no matter what was picked before.
  function enforceDefaultModels() {
    try {
      localStorage.setItem(ADMIN_KEYS.MODEL, OPENAI_MODEL);
      localStorage.setItem(ADMIN_KEYS.SMART_MODEL, SMART_MODEL_DEFAULT);
    } catch (e) { /* storage blocked — smartModel()/effectiveModel() fall back to the same defaults */ }
  }
  enforceDefaultModels();
  // The model for a request. On a task flagged `hard`, when auto-upgrade is on
  // and a smart model is set, escalate to it; otherwise use the base override,
  // else the default base model.
  function effectiveModel(dflt, hard) {
    if (hard && autoUpgradeOn() && smartModel()) return smartModel();
    const m = (admGet(ADMIN_KEYS.MODEL) || '').trim();
    return m || dflt;
  }
  // Cheap difficulty heuristic: long prompts, several numbered items, math or
  // logic vocabulary, symbols, or LaTeX mark a question as "hard" and worth a
  // stronger model. Deliberately generous — a false positive just spends a bit
  // more on a better answer.
  function isHardQuestion(text) {
    const t = String(text || '');
    if (t.length > 400) return true;
    if (/(?:\b\d+\s*[).][^\n]*\n?){3,}/.test(t)) return true;   // 3+ numbered items
    if (/[∫∑∏√≥≤≠∈∀∃πθλµ°]/.test(t)) return true;             // math symbols
    if (/\$\$?[^$]+\$\$?|\\[a-zA-Z]+\{/.test(t)) return true;    // LaTeX
    return /\b(prove|proof|derive|derivative|integral|integrate|matrix|eigen|theorem|asymptotic|complexity|big-?o|differential|logarith|factorial|permutation|combinator|probability|stoichiometr|equilibrium|vector|summation|quadratic|polynomial|calculus)\b/i.test(t);
  }
  function effectiveMaxPageChars() { const n = parseInt(admGet(ADMIN_KEYS.MAXCHARS), 10); return (n && n >= 1000) ? n : MAX_PAGE_CHARS; }
  function effectiveTemp() { const v = parseFloat(admGet(ADMIN_KEYS.TEMP)); return isNaN(v) ? null : Math.max(0, Math.min(2, v)); }
  function adminSysPrefix() { const p = (admGet(ADMIN_KEYS.SYSPREFIX) || '').trim(); return p ? p + '\n\n' : ''; }

  // ---- OpenAI API helpers -------------------------------------------------
  function getOpenAiKey() {
    let key = readStoredKey(OPENAI_STORAGE_KEY);
    // Already asked once and they had nothing of their own to give — an
    // owner-assigned key (if any) is applied server-side regardless, so
    // there's no reason to keep interrupting them with the same prompt.
    if (!key && localStorage.getItem(OPENAI_KEY_SKIP)) return null;
    // Same when the worker has already told us a key is assigned to this
    // account: the proxy attaches it, so there is nothing to ask for.
    if (!key && OPENAI_PROXY && serverAssignedKeys.openai) return null;
    if (!key) {
      const prompted = OPENAI_PROXY
        ? 'Paste your OpenAI API key (starts with "sk-") — or leave blank if your admin assigned you one:'
        : 'Paste your OpenAI API key (starts with "sk-"):';
      key = sanitizeKey(prompt(prompted));
      if (key) {
        if (!key.startsWith('sk-')) {
          showToast('That doesn\'t look like an OpenAI key — they normally start with "sk-". Saving it anyway; double-check if requests fail.', { type: 'danger' });
        }
        localStorage.setItem(OPENAI_STORAGE_KEY, key);
      } else if (OPENAI_PROXY) {
        localStorage.setItem(OPENAI_KEY_SKIP, '1');
      }
    }
    return key || null;
  }

  // Native fetch that bypasses the page's own monkey-patched window.fetch.
  // Some sites wrap window.fetch AND XMLHttpRequest (dropping our
  // Authorization header or throwing "Invalid value" on cross-origin calls).
  // We try transports in order until one works, then cache the winner:
  //   1. a Web Worker from a blob URL — its own global scope, the page
  //      cannot patch anything inside it (blocked only by strict CSP)
  //   2. a pristine fetch from a fresh about:blank iframe
  //   3. XMLHttpRequest (often still clean when fetch is patched)
  //   4. the page's own window.fetch (last resort)
  // Each failure is logged to the console so the cause is never hidden.
  const iframeKeepAlive = []; // hold references so the frames are never GC'd

  // The blob-worker transport: runs fetch inside a brand-new JS global.
  // If CSP forbids blob: workers, `new Worker` throws and we fall through.
  function makeWorkerFetch() {
    return function workerFetch(url, opts) {
      return new Promise((resolve, reject) => {
        let w;
        try {
          const code = 'self.onmessage = async (e) => { const { url, opts } = e.data; try { const res = await fetch(url, opts); const text = await res.text(); self.postMessage({ ok: true, status: res.status, text }); } catch (err) { self.postMessage({ ok: false, error: String((err && err.message) || err) }); } };';
          const blob = new Blob([code], { type: 'application/javascript' });
          w = new Worker(URL.createObjectURL(blob));
        } catch (e) {
          reject(e);
          return;
        }
        w.onmessage = (e) => {
          const d = e.data;
          w.terminate();
          if (!d.ok) { reject(new TypeError(d.error)); return; }
          const makeResponse = () => ({
            ok: d.status >= 200 && d.status < 300,
            status: d.status,
            text: () => Promise.resolve(d.text),
            json: () => Promise.resolve(JSON.parse(d.text)),
            clone: () => makeResponse()
          });
          resolve(makeResponse());
        };
        w.onerror = (e) => {
          w.terminate();
          reject(new Error('worker fetch failed: ' + (e.message || 'unknown error')));
        };
        w.postMessage({ url, opts });
      });
    };
  }

  function makeIframeFetch() {
    try {
      const ifr = document.createElement('iframe');
      ifr.style.display = 'none';
      ifr.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(ifr);
      const win = ifr.contentWindow;
      if (win && typeof win.fetch === 'function') {
        iframeKeepAlive.push(ifr);
        return win.fetch.bind(win);
      }
    } catch (e) { /* fall through to the next transport */ }
    return null;
  }

  function xhrFetch(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(opts.method || 'GET', url, true);
      const headers = opts.headers || {};
      // A header that can't be set must fail this transport, not be skipped.
      // Skipping it sends an unauthenticated request, which comes back as a
      // 401 that looks exactly like a rejected key — the single most
      // misleading failure this script can produce. Fail here instead, so the
      // real reason reaches the console and the next transport gets a turn.
      try {
        Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
      } catch (e) {
        xhr.abort();
        reject(new TypeError('XHR refused header: ' + ((e && e.message) || e)));
        return;
      }
      xhr.withCredentials = false;
      const makeResponse = () => ({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: () => Promise.resolve(xhr.responseText),
        json: () => Promise.resolve(JSON.parse(xhr.responseText)),
        clone: () => makeResponse()
      });
      xhr.onload = () => resolve(makeResponse());
      xhr.onerror = () => reject(new TypeError('Failed to fetch'));
      xhr.send(opts.body || null);
    });
  }

  let rawFetchCache = null; // the transport that last worked

  async function rawFetch(url, opts) {
    // Fast path: the transport that worked last time. If it has gone bad
    // (some pages patch things after we cached it), drop the cache and
    // fall through to the full chain below.
    if (rawFetchCache) {
      try {
        return await rawFetchCache.fn(url, opts);
      } catch (e) {
        console.warn('[Agent Console] fetch transport "' + rawFetchCache.name + '" stopped working:', e && e.message);
        rawFetchCache = null;
      }
    }
    const chain = [];
    try { chain.push({ name: 'worker', fn: makeWorkerFetch() }); } catch (e) { /* CSP or no Worker support */ }
    const iframeFetch = makeIframeFetch();
    if (iframeFetch) chain.push({ name: 'iframe', fn: iframeFetch });
    chain.push({ name: 'xhr', fn: xhrFetch });
    if (window.fetch) chain.push({ name: 'window', fn: window.fetch.bind(window) });

    let lastErr = null;
    for (const transport of chain) {
      try {
        const res = await transport.fn(url, opts);
        // Some anti-bot wrappers don't throw — they "work" but silently drop
        // the Authorization header. That shows up as OpenAI's 401 "You
        // didn't provide an API key". Treat that transport as broken too
        // and move on to the next one. (A genuinely wrong key returns a
        // different message — "Incorrect API key" — and is passed through.)
        if (res.status === 401) {
          const bodyText = await res.clone().text().catch(() => '');
          if (/didn'?t provide an API key|No API key provided|api key was not provided/i.test(bodyText)) {
            console.warn('[Agent Console] fetch transport "' + transport.name + '" strips the Authorization header — skipping it');
            lastErr = new Error('OpenAI API error (401): ' + bodyText.slice(0, 300));
            continue;
          }
        }
        rawFetchCache = transport;
        if (transport.name !== 'iframe') {
          console.info('[Agent Console] page fetch unavailable — using ' + transport.name + ' transport instead');
        }
        return res;
      } catch (e) {
        lastErr = e;
        console.warn('[Agent Console] fetch transport "' + transport.name + '" failed:', e && e.message);
      }
    }
    throw lastErr || new TypeError('Failed to fetch');
  }

  async function callOpenAI(userText, systemText, imageDataUrls, hard) {
    const key = getOpenAiKey();
    // Without the proxy there's no server in the middle to supply a key on
    // your behalf, so a local key is mandatory. With the proxy, a missing
    // key here just means "maybe the owner assigned me one" — let the
    // request go through and let the worker decide.
    if (!key && !OPENAI_PROXY) throw new Error('No OpenAI API key provided.');

    const content = [];
    if (userText) content.push({ type: 'text', text: userText });
    if (imageDataUrls && imageDataUrls.length) {
      imageDataUrls.forEach((dataUrl) => content.push({ type: 'image_url', image_url: { url: dataUrl } }));
    }
    if (!content.length) throw new Error('Nothing to send.');

    const messages = [];
    if (systemText) messages.push({ role: 'system', content: systemText });
    messages.push({ role: 'user', content });

    if (key) assertHeaderSafe(key, 'OpenAI');

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    const payload = { model: OPENAI_MODEL, messages };
    // Backup channels for pages whose wrappers strip the Authorization header
    // in transit: (1) the X-GPA-Key custom header, (2) a _gpa_key field in the
    // request body. The worker converts either back into a real Authorization
    // header before forwarding, and strips _gpa_key so it never reaches
    // OpenAI. Both only go through our own proxy — api.openai.com would reject
    // them in direct mode.
    //
    // The body is deliberately used here rather than a ?key= query parameter.
    // A key in a URL is a key in your browser history, in the Referer header
    // sent to third parties, in proxy and CDN access logs, and legible in any
    // screenshot of the network tab — a query-string key should be considered
    // burned the moment it is used. Request bodies are logged by none of that.
    if (OPENAI_PROXY) {
      if (key) { headers['X-GPA-Key'] = key; payload._gpa_key = key; }
      // Tells the worker who is asking, so it can refuse a blocked user and
      // apply an owner-assigned key (see /admin/assignkey) if this user has
      // one — that lookup happens purely server-side and needs nothing more
      // than this identifier. Only an identifier — never the key. Best-effort:
      // a modified client could omit it, which is why blocking is "soft";
      // see the admin console note.
      if (typeof currentUser !== 'undefined' && currentUser) headers['X-GPA-User'] = currentUser;
    }
    const endpoint = OPENAI_PROXY
      ? `${OPENAI_PROXY}/v1/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';

    payload.model = effectiveModel(OPENAI_MODEL, hard);
    if (modelSupportsReasoning(payload.model)) payload.reasoning_effort = reasoningEffort;
    noteModelUsed(payload.model, 'OpenAI', hard);
    // Reasoning models (gpt-5 and friends) reject any temperature but the
    // default, so the admin temperature only applies to the others.
    const temp = effectiveTemp();
    if (temp !== null && !modelSupportsReasoning(payload.model)) payload.temperature = temp;

    const res = await rawFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API error (${res.status}): ${redactSecrets(errText).slice(0, 300)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '(no response)';
  }

  // ---- Context memory -------------------------------------------------------
  // Any saved insight can be switched on as context (the 🧠 button on its card
  // in the Saved tab). Insights switched on are prepended to the system prompt
  // of every later AI call, so the assistant carries forward exactly what you
  // chose to keep and nothing else.
  //
  // Opt-in per insight, deliberately: a blanket "remember everything" turns
  // every unrelated note into a source of confusion three questions later, and
  // costs tokens on every single request. Off is the default for new insights.
  const CTX_CHAR_BUDGET = 6000;

  function contextInsights() {
    try { return savedAll().filter((it) => it.ctx); } catch (e) { return []; }
  }

  function buildContextMemory() {
    const picked = contextInsights().sort((a, b) => b.ts - a.ts);
    if (!picked.length) return '';
    const parts = [];
    let used = 0;
    for (const it of picked) {
      // Newest first, and stop at the budget rather than truncating mid-note:
      // half an explanation is worse than one fewer explanation.
      const entry = `- [${it.label || it.title || 'Saved note'}] ${it.text}`;
      if (used + entry.length > CTX_CHAR_BUDGET) break;
      parts.push(entry);
      used += entry.length;
    }
    if (!parts.length) return '';
    return 'SAVED CONTEXT THE USER CHOSE TO CARRY FORWARD (their own earlier notes and worked explanations). '
      + 'Treat it as background they already know and build on it — reuse its notation and conclusions instead of re-deriving them. '
      + 'It describes earlier material, so where it conflicts with what the CURRENT page says, the current page wins.\n'
      + parts.join('\n') + '\n\n';
  }

  // Every AI request goes through here to OpenAI.
  async function callAI(userText, systemText, imageDataUrls, hard) {
    if (aiBlocked) throw new Error('Access to this tool has been blocked by the owner.');
    // Order matters: admin standing instructions, then saved context, then the
    // caller's own system text LAST — the JSON-only rules several callers rely
    // on have to be the final word, or the model narrates instead of obeying.
    const sys = adminSysPrefix() + buildContextMemory() + (systemText || '');
    return callOpenAI(userText, sys, imageDataUrls, hard);
  }

  // Real second-pass check for quiz/answer-grid results: sends the draft
  // answers back to the AI alongside the original context and asks it to
  // re-verify each one, fixing anything wrong and returning a final,
  // calibrated confidence per item. Falls back to the draft if the
  // verification call fails or comes back unparsable, so a bad second
  // pass never wipes out a good first one.
  async function verifyGridAnswers(contextText, draftGrid, imageDataUrls) {
    const sys = 'You previously drafted answers to a set of questions. Re-check EACH answer against the original context on its own, independently — do not just assume the draft is correct. Fix anything wrong, then return a final JSON array in this exact shape and nothing else: [{"q":"1","a":"B","c":92}] — "c" is your honest confidence (0-100) that this specific final answer is correct. Do not include any text outside the JSON array.';
    const userText = `ORIGINAL CONTEXT:\n${contextText}\n\nDRAFT ANSWERS TO VERIFY:\n${JSON.stringify(draftGrid)}`;
    try {
      const out = await callAI(userText, sys, imageDataUrls, true);
      const verified = tryParseAnswerGrid(out);
      return verified || draftGrid;
    } catch (e) {
      return draftGrid;
    }
  }

  // ---- Friendly error display ---------------------------------------------
  // Turns raw API error text (status codes, JSON bodies) into one plain
  // sentence, and renders it in a small styled box instead of a code dump.
  function explainError(err, label) {
    const msg = (err && err.message) || String(err);
    const statusMatch = msg.match(/\((\d{3})\)/);
    const status = statusMatch ? statusMatch[1] : null;

    if (/blocked by the owner|blocked_by_owner/i.test(msg)) return 'Your access to this tool has been blocked by the owner.';
    if (/No .*API key provided/i.test(msg)) return 'No API key entered yet — try again and paste one when prompted.';
    if (/cannot be sent in a request header|Invalid value|refused header/i.test(msg)) {
      return 'Your saved API key has hidden characters in it — that happens when it is copied out of a styled page or document. Clear the key in Settings, then paste it again.';
    }
    if (status === '401' && /didn'?t provide an API key|No API key provided|api key was not provided/i.test(msg)) {
      return 'Your key never made it to the API. If you updated script.js recently, redeploy worker.js to Cloudflare as well — the two have to match.';
    }
    if (/Nothing to send|Nothing to analyze/i.test(msg)) return 'Nothing to work with yet — scan the page, capture the screen, or type something first.';
    if (status === '401' || /invalid.*key|unauthorized|API key not valid/i.test(msg)) {
      return `${label} rejected your API key. Double-check it (or clear and re-enter it) in the Theme tab.`;
    }
    if (status === '429' || /quota|credit|rate.?limit/i.test(msg)) {
      return `${label} says you're out of credits or hitting a rate limit. Check your billing/usage there.`;
    }
    if (status === '404' || /model.*(not found|no longer available)/i.test(msg)) {
      return `${label}'s model name may have changed on their end and needs updating in the script.`;
    }
    if (/network|failed to fetch/i.test(msg)) {
      return `Couldn't reach ${label} — check your connection and try again.`;
    }
    return `Something went wrong talking to ${label}${status ? ` (error ${status})` : ''}. Try again in a moment.`;
  }

  function showError(el, err, label) {
    // The panel shows a friendly sentence; the raw error lands in the DevTools
    // console so the real cause is never hidden behind it — with anything that
    // looks like a credential masked, since upstream errors echo the key that
    // failed and consoles get screenshotted and pasted into chats.
    console.error('[Agent Console] raw error from', label, ':', redactSecrets((err && err.message) || err));
    el.innerHTML = `<div class="gpa-error"><span class="gpa-error-icon">⚠</span><span>${explainError(err, label)}</span></div>`;
  }

  function currentProviderLabel() {
    return 'OpenAI';
  }

  // ---- Typewriter effect for AI responses ---------------------------------
  // Reveals text a few characters at a time with a blinking cursor. Speed
  // scales with length so long answers don't take forever to finish, and
  // is user-adjustable (Slow/Normal/Fast/Instant) in the Theme tab.
  function typeText(el, fullText, scrollContainer, onDone) {
    const speedSetting = localStorage.getItem(SPEED_KEY) || 'normal';
    if (speedSetting === 'instant') {
      el.classList.remove('gpa-typing');
      el.textContent = fullText;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      if (onDone) onDone();
      return;
    }
    const delayMs = { slow: 28, normal: 12, fast: 4 }[speedSetting] || 12;
    el.classList.add('gpa-typing');
    el.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'gpa-cursor';
    el.appendChild(cursor);
    const total = fullText.length;
    const chunk = Math.max(1, Math.ceil(total / 400));
    let i = 0;
    function step() {
      if (i >= total) {
        cursor.remove();
        el.classList.remove('gpa-typing');
        if (onDone) onDone();
        return;
      }
      cursor.insertAdjacentText('beforebegin', fullText.slice(i, i + chunk));
      i += chunk;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      setTimeout(step, delayMs);
    }
    step();
  }

  // ---- Structured answer grid (for "answers to questions 1-10" style asks) --
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Origin + path, never the query string or fragment. Used everywhere a page
  // address is recorded or sent anywhere.
  function scrubPageUrl(raw) {
    const s = String(raw == null ? '' : raw);
    try {
      const u = new URL(s);
      return (u.origin + u.pathname).slice(0, 200);
    } catch (e) {
      return s.split(/[?#]/)[0].slice(0, 200);
    }
  }

  // Anything that looks like an API key is masked before it can reach a toast,
  // the console, or the local log. Upstream error bodies sometimes echo the
  // credential that failed, and a screenshot of an error should never be worth
  // anything to whoever sees it.
  function redactSecrets(text) {
    return String(text == null ? '' : text)
      .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-…redacted…')
      .replace(/AIza[A-Za-z0-9_\-]{10,}/g, 'AIza…redacted…')
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1…redacted…')
      .replace(/([?&](?:key|token|api_?key)=)[^&\s]+/gi, '$1…redacted…');
  }

  function confidenceClass(pct) {
    return pct >= 85 ? 'gpa-conf-high' : pct >= 60 ? 'gpa-conf-mid' : 'gpa-conf-low';
  }

  function tryParseAnswerGrid(text) {
    const trimmed = text.trim();
    if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return null;
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length && arr.every((it) => it && typeof it === 'object' && 'q' in it && 'a' in it)) {
        return arr;
      }
    } catch (e) { /* not JSON — fall through to plain text */ }
    return null;
  }

  function renderAnswerGrid(el, arr) {
    el.classList.remove('gpa-typing');
    const cells = arr.map((it, idx) => {
      const hasConf = typeof it.c === 'number' && !isNaN(it.c);
      const pct = hasConf ? Math.max(0, Math.min(100, Math.round(it.c))) : null;
      const badge = pct === null ? '' : `<span class="gpa-grid-conf ${confidenceClass(pct)}">${pct}%</span>`;
      return `<div class="gpa-grid-cell" style="animation-delay:${idx * 35}ms">
         <span class="gpa-grid-q">${escapeHtml(it.q)}</span>
         <span class="gpa-grid-a">${escapeHtml(it.a)}</span>
         ${badge}
       </div>`;
    }).join('');
    el.innerHTML = `<div class="gpa-answer-grid">${cells}</div>`;
    el.appendChild(buildPracticeFooter(el, arr));
  }

  // ---- Practice mode: any answer grid can become Study flashcards ----------
  // Skips "Unclear" answers and questions already in the deck, then reports
  // how many new cards landed in the Study tab.
  function addFlashcards(items) {
    const cards = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
    let added = 0;
    (items || []).forEach((it) => {
      if (!it || !it.q || !it.a || String(it.a).trim().toLowerCase() === 'unclear') return;
      if (cards.some((c) => normalizeForMatch(c.q) === normalizeForMatch(String(it.q)))) return;
      cards.push({ q: String(it.q), a: String(it.a), box: 1 });
      added += 1;
    });
    localStorage.setItem(FC_KEY, JSON.stringify(cards));
    return added;
  }

  function buildPracticeFooter(el, arr) {
    const footer = document.createElement('div');
    footer.className = 'gpa-row';
    footer.style.marginTop = '8px';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn';
    btn.textContent = '📤 Send all to flashcards';
    btn.addEventListener('click', () => {
      const added = addFlashcards(arr);
      footer.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      btn.textContent = added ? `✓ Added ${added} card${added === 1 ? '' : 's'} — see the Study tab` : '✓ Already in your deck';
    });
    footer.appendChild(btn);
    return footer;
  }

  // ---- Tutor mode -----------------------------------------------------------
  // Same quiz reading as the solver, but the AI also explains WHY each answer
  // is right and walks through the solution. Results show as rich cards here,
  // and any card can float a themed popup right next to its question on the
  // page (with the question text highlighted). You still type and submit
  // every answer yourself — this is a tutor, not an auto-taker.
  // The model is asked for cite: [{label, url}], but models being models it
  // may send a bare string, a single object, or an entry with no label.
  // Normalize all of that, and drop any url that isn't a real http(s) link so
  // a malformed value can never be rendered as one.
  function citeList(item) {
    const raw = item && item.cite;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((c) => {
      if (typeof c === 'string') return { label: c.trim(), url: '' };
      if (!c || typeof c !== 'object') return null;
      const label = String(c.label || c.name || c.title || c.source || '').trim();
      let url = String(c.url || c.href || c.link || '').trim();
      if (!/^https?:\/\//i.test(url)) url = '';
      if (!label && !url) return null;
      return { label: label || url, url };
    }).filter(Boolean).slice(0, 3);
  }

  function citeHtml(item) {
    const list = citeList(item);
    if (!list.length) return '';
    const inner = list.map((c) => (c.url
      ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.label)}</a>`
      : `<span class="gpa-cite-plain">${escapeHtml(c.label)}</span>`)).join(', ');
    return `<div class="gpa-tutor-cite"><b>Sources:</b> ${inner}</div>`;
  }

  // Worked solutions come back as steps separated by ";". Split them onto
  // numbered lines — a single run-on line of semicolons is exactly the thing
  // people's eyes slide straight off.
  function formatSolution(sol) {
    const steps = String(sol || '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    return steps.length < 2 ? String(sol || '') : steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  }

  // One tutor answer as plain text: readable in the Saved tab, and ready to
  // drop straight back into a later prompt if it's switched on as context.
  function tutorInsightText(item) {
    if (!item) return '';
    const lines = [`Q${item.q} — answer: ${item.a}`];
    if (item.concept) lines.push(`Concept: ${item.concept}`);
    if (item.why) lines.push(`Why: ${item.why}`);
    if (item.sol) lines.push(`Solution:\n${formatSolution(item.sol)}`);
    if (item.pitfall) lines.push(`Common mistake: ${item.pitfall}`);
    const cites = citeList(item);
    if (cites.length) lines.push('Sources: ' + cites.map((c) => (c.url ? `${c.label} (${c.url})` : c.label)).join(' | '));
    if (item.h) lines.push(`From the page: "${item.h}"`);
    return lines.join('\n');
  }

  function renderTutorGrid(el, arr) {
    el.classList.remove('gpa-typing');
    const cells = arr.map((it, idx) => {
      const hasConf = typeof it.c === 'number' && !isNaN(it.c);
      const pct = hasConf ? Math.max(0, Math.min(100, Math.round(it.c))) : null;
      const badge = pct === null ? '' : `<span class="gpa-grid-conf ${confidenceClass(pct)}">${pct}%</span>`;
      const concept = it.concept ? `<div class="gpa-tutor-concept"><b>Concept:</b> ${escapeHtml(it.concept)}</div>` : '';
      const why = it.why ? `<div class="gpa-tutor-why"><b>Why:</b> ${escapeHtml(it.why)}</div>` : '';
      const sol = it.sol ? `<div class="gpa-tutor-sol"><b>Solution:</b>\n${escapeHtml(formatSolution(it.sol))}</div>` : '';
      const pitfall = it.pitfall ? `<div class="gpa-tutor-pitfall"><b>Watch out:</b> ${escapeHtml(it.pitfall)}</div>` : '';
      const pin = it.h ? `<button class="gpa-btn gpa-tutor-pin" data-idx="${idx}">📍 Show on page</button>` : '';
      const card = `<button class="gpa-btn gpa-tutor-card" data-idx="${idx}">➕ Flashcard</button>`;
      const save = `<button class="gpa-btn gpa-tutor-save" data-idx="${idx}">💾 Save</button>`;
      return `<div class="gpa-grid-cell" style="animation-delay:${idx * 35}ms">
         <span class="gpa-grid-q">${escapeHtml(it.q)}</span>
         <span class="gpa-grid-a">${escapeHtml(it.a)}</span>
         ${badge}${concept}${why}${sol}${pitfall}${citeHtml(it)}
         <div class="gpa-row" style="margin-top:6px;">${pin}${card}${save}</div>
       </div>`;
    }).join('');
    el.innerHTML = `<div class="gpa-answer-grid wide">${cells}</div>`;
    el.appendChild(buildPracticeFooter(el, arr));

    // onclick (not addEventListener): replaces the previous run's handler so
    // clicks always map to THIS run's question list.
    el.onclick = (e) => {
      const pinBtn = e.target.closest('.gpa-tutor-pin');
      if (pinBtn) {
        const item = arr[Number(pinBtn.dataset.idx)];
        tutorPopPos = null;   // an explicit pin means "put it back by the question"
        showTutorPopupFor(item);
        return;
      }
      const saveBtn = e.target.closest('.gpa-tutor-save');
      if (saveBtn) {
        saveInsight(tutorInsightText(arr[Number(saveBtn.dataset.idx)]));
        return;
      }
      const cardBtn = e.target.closest('.gpa-tutor-card');
      if (cardBtn) {
        const item = arr[Number(cardBtn.dataset.idx)];
        const added = addFlashcards([item]);
        cardBtn.textContent = added ? '✓ Added' : '✓ In deck';
        cardBtn.disabled = true;
      }
    };
  }

  // Floats the tutor card for one question next to its highlighted spot on
  // the page. Highlights the "h" quote first, then anchors the popup to the
  // span that was just injected (the last entry in injectedHighlights).
  function showTutorPopupFor(item) {
    if (!item) return;
    const span = item.h ? highlightSnippetOnPage(item.h) : false;
    let rect = null;
    if (span && span.getBoundingClientRect) rect = span.getBoundingClientRect();
    else if (injectedHighlights.length) rect = injectedHighlights[injectedHighlights.length - 1].getBoundingClientRect();
    showTutorPopup(rect, item);
  }

  // Where the user dragged the popup to, if they have. Deliberately remembered
  // across questions: drag it once into a clear corner and it stays there as
  // the quiz advances, rather than springing back beside each new question.
  let tutorPopPos = null;
  let tutorPopCleanup = null;

  function closeTutorPopup() {
    if (tutorPopCleanup) { tutorPopCleanup(); tutorPopCleanup = null; }
    document.querySelectorAll('.gpa-tutor-pop').forEach((p) => p.remove());
  }

  function showTutorPopup(rect, item) {
    closeTutorPopup();   // one popup at a time
    const t = THEMES[theme] || THEMES.dark;
    const pop = document.createElement('div');
    pop.className = 'gpa-tutor-pop';
    Object.assign(pop.style, {
      position: 'fixed', zIndex: '2147483647', width: '320px', maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
      background: t.panel, color: t.text, border: `1px solid ${t.accent}`, borderRadius: '12px',
      boxShadow: '0 10px 34px rgba(0,0,0,0.5)', padding: '12px 14px',
      font: '12px/1.5 "JetBrains Mono", ui-monospace, monospace'
    });

    const close = document.createElement('button');
    close.textContent = '✕';
    Object.assign(close.style, {
      position: 'absolute', top: '6px', right: '8px', background: 'transparent',
      border: 'none', color: t.sub, cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit'
    });
    close.addEventListener('click', () => {
      // Closing means "not this one" — remember it, or auto-explain simply
      // reopens the same popup on its next scan and the ✕ looks broken.
      autoFollowDismissed = autoFollowQ;
      closeTutorPopup();
    });
    pop.appendChild(close);

    const head = document.createElement('div');
    head.style.cssText = `font-weight:600;color:${t.accent};margin-bottom:6px;padding-right:18px;cursor:move;user-select:none;`;
    head.title = 'Drag to move';
    head.textContent = `⠿ ${item.q} → ${item.a}`;
    pop.appendChild(head);

    const section = (label, text) => {
      if (!text) return;
      const d = document.createElement('div');
      d.style.cssText = 'margin-bottom:6px;white-space:pre-wrap;';
      d.innerHTML = `<b style="color:${t.sub}">${label}:</b> `;
      d.appendChild(document.createTextNode(text));
      pop.appendChild(d);
    };
    section('Concept', item.concept);
    section('Why', item.why);
    section('Solution', item.sol ? '\n' + formatSolution(item.sol) : '');
    section('Watch out', item.pitfall);

    const cites = citeList(item);
    if (cites.length) {
      const c = document.createElement('div');
      c.style.cssText = 'margin-top:6px;font-size:10px;opacity:0.85;';
      c.innerHTML = `<b style="color:${t.sub}">Sources:</b> ` + cites.map((x) => (x.url
        ? `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer" style="color:${t.accent}">${escapeHtml(x.label)}</a>`
        : escapeHtml(x.label))).join(', ');
      pop.appendChild(c);
    }

    // Footer controls live on the popup itself, not just in the panel — the
    // panel is often minimized while this is the thing you are reading.
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;';
    const mkBtn = (text, title, fn) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title || '';
      b.style.cssText = `font:10px/1.4 inherit;padding:4px 8px;border-radius:7px;cursor:pointer;background:transparent;color:${t.text};border:1px solid ${t.accent};`;
      b.addEventListener('click', fn);
      foot.appendChild(b);
      return b;
    };
    mkBtn('💾 Save insight', 'Save this explanation — you can switch it on as AI context later', () => {
      saveInsight(tutorInsightText(item));
    });
    const autoBtn = mkBtn(autoFollowOn() ? '⏸ Auto: ON' : '▶ Auto: OFF', 'Follow whichever question is on screen', () => {
      setAutoFollow(!autoFollowOn());
      autoBtn.textContent = autoFollowOn() ? '⏸ Auto: ON' : '▶ Auto: OFF';
    });
    pop.appendChild(foot);

    document.body.appendChild(pop);

    const place = (px, py) => {
      pop.style.left = `${Math.round(Math.max(8, Math.min(px, window.innerWidth - pop.offsetWidth - 8)))}px`;
      pop.style.top = `${Math.round(Math.max(8, Math.min(py, window.innerHeight - 40)))}px`;
    };

    // Position: the user's own spot if they have dragged it, else beside the
    // question, else bottom-centre. Always clamped inside the viewport.
    if (tutorPopPos) {
      place(tutorPopPos.x, tutorPopPos.y);
    } else if (rect) {
      let x = rect.right + 12;
      let y = rect.top - 8;
      if (x + pop.offsetWidth > window.innerWidth - 8) x = Math.max(8, rect.left - pop.offsetWidth - 12);
      if (y + pop.offsetHeight > window.innerHeight - 8) y = Math.max(8, window.innerHeight - pop.offsetHeight - 8);
      place(x, Math.max(8, y));
    } else {
      place(window.innerWidth / 2 - pop.offsetWidth / 2, window.innerHeight - pop.offsetHeight - 20);
    }

    // ---- Drag, by the header ----
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      dragging = true;
      sx = p.clientX; sy = p.clientY;
      const r = pop.getBoundingClientRect();
      ox = r.left; oy = r.top;
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      place(ox + (p.clientX - sx), oy + (p.clientY - sy));
      e.preventDefault();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      const r = pop.getBoundingClientRect();
      tutorPopPos = { x: r.left, y: r.top };
    };
    head.addEventListener('mousedown', down);
    head.addEventListener('touchstart', down, { passive: false });
    onWin('mousemove', move, true);
    onWin('touchmove', move, { passive: false, capture: true });
    onWin('mouseup', up, true);
    onWin('touchend', up, true);
    // move/up live on window, so they have to come off with the popup or every
    // popup shown this session keeps listening to every mouse move.
    tutorPopCleanup = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('touchmove', move, { capture: true });
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('touchend', up, true);
    };
  }

  // ---- Auto-explain: follow whichever question is on screen -------------------
  // Pressing "Show on page" once per question gets old fast, and stepped
  // quizzes (one question at a time behind Next/Back) make it worse: the
  // question changes and the popup doesn't. Auto-explain watches what is
  // actually visible and swaps the popup to match, so pressing Next means
  // question 8's explanation is already sitting there.
  const AUTOFOLLOW_KEY = 'gpa_tutor_autofollow';
  let tutorRun = [];               // this run's questions
  let tutorAnchors = new Map();    // question label -> its highlight span
  let autoFollowQ = null;          // question the popup is showing
  let autoFollowDismissed = null;  // question the user closed by hand
  let autoFollowObserver = null;
  let autoFollowTimer = null;
  let autoFollowBusy = false;
  let autoFollowRaf = null;

  function autoFollowOn() { return localStorage.getItem(AUTOFOLLOW_KEY) !== 'off'; }

  function renderAutoFollowBtn() {
    const btn = panel.querySelector('#gpa-autofollow-btn');
    if (!btn) return;
    const on = autoFollowOn();
    // Short, fixed-length label — state is shown by the primary/highlighted
    // look (same convention as every other toggle button here), not by
    // appending "ON"/"OFF" text, which previously ran wider than the
    // button next to it in this two-up row and spilled past its own edge.
    btn.textContent = '📍 Auto-explain';
    btn.classList.toggle('primary', on);
    btn.title = on
      ? 'Auto-explain is ON. After Tutor mode runs, float the explanation for whichever question is on screen and follow along as the quiz advances. Click to turn off.'
      : 'Auto-explain is OFF. Click to turn on: after Tutor mode runs, float the explanation for whichever question is on screen and follow along as the quiz advances.';
  }

  function setAutoFollow(on) {
    localStorage.setItem(AUTOFOLLOW_KEY, on ? 'on' : 'off');
    renderAutoFollowBtn();
    if (on) startAutoFollow(tutorRun);
    else stopAutoFollow();
  }

  // The highlight span for one question, created on demand — stepped quizzes
  // only put a question in the DOM when you reach it.
  function anchorFor(item) {
    const key = String(item.q);
    const existing = tutorAnchors.get(key);
    if (existing && existing.isConnected) return existing;
    if (!item.h) return null;
    // Reuse a highlight that already covers this text (the tutor run
    // highlights everything up front) rather than wrapping it a second time.
    const target = normalizeForMatch(item.h);
    const already = injectedHighlights.find((s) => s.isConnected && normalizeForMatch(s.textContent) === target);
    if (already) { tutorAnchors.set(key, already); return already; }
    const span = highlightSnippetOnPage(item.h, { scroll: false });
    if (span && span.nodeType === 1) { tutorAnchors.set(key, span); return span; }
    return null;
  }

  function visibleTutorItem() {
    let best = null, bestScore = -Infinity;
    tutorRun.forEach((it) => {
      const el = anchorFor(it);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (visible <= 0) return;                          // off screen entirely
      const score = visible - Math.max(0, r.top) * 0.2;  // prefer nearer the top
      if (score > bestScore) { bestScore = score; best = it; }
    });
    return best;
  }

  function autoFollowScan() {
    if (!autoFollowOn() || !tutorRun.length || autoFollowBusy) return;
    autoFollowBusy = true;
    try {
      const item = visibleTutorItem();
      if (!item) return;
      const q = String(item.q);
      if (q === autoFollowDismissed) return;
      if (q === String(autoFollowQ) && document.querySelector('.gpa-tutor-pop')) return;
      autoFollowQ = q;
      autoFollowDismissed = null;
      const el = tutorAnchors.get(q);
      showTutorPopup(el && el.isConnected ? el.getBoundingClientRect() : null, item);
    } catch (e) {
      console.warn('[Agent Console] auto-explain scan failed:', e && e.message);
    } finally {
      // Highlighting and showing the popup are themselves DOM mutations. Let
      // them settle before the observer may queue another scan, or injecting
      // one highlight schedules the scan that injects the next one, forever.
      setTimeout(() => { autoFollowBusy = false; }, 150);
    }
  }

  function scheduleAutoFollow(delay) {
    clearTimeout(autoFollowTimer);
    autoFollowTimer = setTimeout(autoFollowScan, delay || 250);
  }

  function onAutoFollowScroll() {
    if (autoFollowRaf) return;
    autoFollowRaf = requestAnimationFrame(() => { autoFollowRaf = null; scheduleAutoFollow(180); });
  }

  function startAutoFollow(items) {
    stopAutoFollow();
    tutorRun = items || [];
    autoFollowQ = null;
    autoFollowDismissed = null;
    if (!autoFollowOn() || !tutorRun.length) return;
    autoFollowObserver = new MutationObserver((muts) => {
      const relevant = muts.some((m) => {
        const node = m.target;
        const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
        if (!el || !el.closest) return false;
        // Our own furniture changing doesn't count as the page changing.
        return !el.closest('#gpa-root-host, .gpa-tutor-pop, .gpa-page-highlight, .gpa-sel-pop, .gpa-sel-bubble');
      });
      if (relevant) scheduleAutoFollow(300);
    });
    try {
      autoFollowObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* nothing observable — scroll still drives it */ }
    onWin('scroll', onAutoFollowScroll, true);
    onWin('resize', onAutoFollowScroll);
    scheduleAutoFollow(150);
  }

  function stopAutoFollow() {
    clearTimeout(autoFollowTimer);
    if (autoFollowObserver) { autoFollowObserver.disconnect(); autoFollowObserver = null; }
    window.removeEventListener('scroll', onAutoFollowScroll, true);
    window.removeEventListener('resize', onAutoFollowScroll);
  }

  // The verification pass re-checks answers/confidence but doesn't carry
  // the "h" (highlight quote) field through — restore it from the original
  // draft by matching question labels, so highlighting still works after
  // verification.
  function mergeHighlightField(verified, draft) {
    const draftByQ = {};
    draft.forEach((d) => { draftByQ[String(d.q)] = d.h; });
    return verified.map((v) => ({ ...v, h: v.h || draftByQ[String(v.q)] }));
  }

  // For a single free-text answer, the model appends a trailing
  // "CONFIDENCE: NN" line — pull it out and show it as a small badge
  // instead of leaving it as literal text in the answer.
  function extractConfidenceLine(text) {
    const match = text.match(/\n?\s*CONFIDENCE:\s*(\d{1,3})\s*%?\s*$/i);
    if (!match) return { text, confidence: null };
    const confidence = Math.max(0, Math.min(100, parseInt(match[1], 10)));
    return { text: text.slice(0, match.index).trim(), confidence };
  }

  function appendConfidenceBadge(container, confidence) {
    if (confidence === null || typeof confidence !== 'number' || isNaN(confidence)) return;
    const badge = document.createElement('div');
    badge.className = 'gpa-confidence-line';
    badge.innerHTML = `<span class="gpa-grid-conf ${confidenceClass(confidence)}">${confidence}% confident this is correct</span>`;
    container.appendChild(badge);
  }

  // Generic "strip a LABEL: value trailing line" extractor, used for both
  // CONFIDENCE and HIGHLIGHT metadata lines the AI appends after its answer.
  function extractTrailingLine(text, label) {
    const re = new RegExp(`\\n?\\s*${label}:\\s*(.+?)\\s*$`, 'i');
    const m = text.match(re);
    if (!m) return { text, value: null };
    return { text: text.slice(0, m.index).trim(), value: m[1].trim() };
  }

  // ---- On-page highlighting -------------------------------------------------
  // Finds a verbatim snippet of page text (as quoted back by the AI) in the
  // LIVE page DOM and wraps it in a colored highlight span. The highlight
  // color is chosen per-element by checking what's actually behind that
  // spot on the page, so it stays visible on both light and dark sections
  // of the same page rather than using one fixed color everywhere.
  let injectedHighlights = [];

  function clearPageHighlights() {
    injectedHighlights.forEach((span) => {
      if (span && span.parentNode) {
        const text = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(text, span);
      }
    });
    injectedHighlights = [];
    // Clearing the highlights removes every anchor auto-explain was following,
    // so stop it rather than let it chase spans that are no longer in the DOM.
    try {
      stopAutoFollow();
      closeTutorPopup();
      tutorAnchors = new Map();
      tutorRun = [];
    } catch (e) { /* auto-explain not initialized yet */ }
    const clearBtn = panel.querySelector('#gpa-clear-highlights');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  function parseRgbString(str) {
    const m = str && str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }

  function relativeLuminance({ r, g, b }) {
    const conv = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
  }

  function getEffectiveBackground(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseRgbString(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.05) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function pickHighlightStyle(bgRgb) {
    // Dark backgrounds get a bright neon highlight; light backgrounds get a
    // bold saturated one — both chosen to stay visible either way, and to
    // still look intentional against the page's own color, not just
    // maximum-contrast ugly.
    const lum = relativeLuminance(bgRgb);
    return lum < 0.45
      ? { bg: 'rgba(230, 255, 60, 0.55)', glow: 'rgba(230, 255, 60, 0.9)' }
      : { bg: 'rgba(255, 87, 34, 0.45)', glow: 'rgba(255, 87, 34, 0.85)' };
  }

  function normalizeForMatch(s) {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Highlights the first occurrence of `snippet` found on the page. Returns
  // the highlight span (truthy) if something was found, false otherwise —
  // callers that only need a yes/no still work, and auto-explain uses the
  // span itself as the anchor to position the popup against.
  // opts.scroll === false suppresses the scroll-into-view, which auto-explain
  // needs: it highlights questions as they appear, and yanking the page
  // around while someone is reading is the opposite of helpful.
  function highlightSnippetOnPage(snippet, opts) {
    if (!snippet || snippet.length < 3) return false;
    const target = normalizeForMatch(snippet);
    if (!target) return false;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentTag = node.parentElement && node.parentElement.tagName;
        if (!parentTag || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('#gpa-root-host')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      const nodeText = node.nodeValue;
      const normalized = normalizeForMatch(nodeText);
      const idx = normalized.indexOf(target);
      if (idx === -1) continue;

      // Map the normalized-string index back to the original string as
      // closely as practical (whitespace collapsing can shift offsets
      // slightly) — good enough for highlighting purposes here.
      let start = idx, end = idx + target.length;
      if (start > nodeText.length) start = 0;
      if (end > nodeText.length) end = nodeText.length;

      const range = document.createRange();
      try {
        range.setStart(node, Math.min(start, nodeText.length));
        range.setEnd(node, Math.min(end, nodeText.length));
      } catch (e) { continue; }

      const span = document.createElement('span');
      span.className = 'gpa-page-highlight';
      const bg = getEffectiveBackground(node.parentElement);
      const style = pickHighlightStyle(bg);
      span.style.setProperty('--gpa-hl-bg', style.bg);
      span.style.setProperty('--gpa-hl-glow', style.glow);
      try {
        range.surroundContents(span);
      } catch (e) { continue; }

      injectedHighlights.push(span);
      if (!opts || opts.scroll !== false) span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const clearBtn = panel.querySelector('#gpa-clear-highlights');
      if (clearBtn) clearBtn.style.display = 'inline-block';
      return span;
    }
    return false;
  }

  function highlightSnippetsOnPage(snippets) {
    if (!snippets) return;
    const list = Array.isArray(snippets) ? snippets : [snippets];
    list.forEach((s) => { if (typeof s === 'string') highlightSnippetOnPage(s); });
  }

  // ---- Saved insights: calendar + folders -----------------------------------
  // Two ways in, no endless scroller: a themed month calendar (current week
  // tinted, dots on days with insights, click a day for its timestamped
  // cards) or a folder tree (folders → files/subfolders). Saving always asks
  // where via the modal: label + section + file. Data stays in
  // gpa_saved_insights (enriched with id/ts/folder/file/label on first load)
  // and gpa_saved_folders — both profile-synced like every other gpa_* key.
  const FOLDERS_KEY = 'gpa_saved_folders';
  let savedView = localStorage.getItem('gpa_saved_view') || 'calendar';
  let selFolder = '';
  let calBase = null;   // first day of the visible month
  let selDay = null;    // selected calendar day

  function savedAll() {
    const arr = JSON.parse(localStorage.getItem('gpa_saved_insights') || '[]');
    let changed = false;
    arr.forEach((it) => {
      // Enrich older insights (pre-calendar format) once.
      if (!it.id) { it.id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); changed = true; }
      if (!it.ts) { const d = it.date ? new Date(it.date) : null; it.ts = d && !isNaN(d.getTime()) ? d.getTime() : Date.now(); changed = true; }
      if (it.folder === undefined) { it.folder = ''; changed = true; }
      if (it.file === undefined) { it.file = ''; changed = true; }
      if (it.label === undefined) { it.label = ''; changed = true; }
    });
    if (changed) saveSavedAll(arr);
    return arr;
  }
  function saveSavedAll(arr) { localStorage.setItem('gpa_saved_insights', JSON.stringify(arr)); }
  function savedFoldersList() { try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]'); } catch (e) { return []; } }
  function saveFoldersList(list) { localStorage.setItem(FOLDERS_KEY, JSON.stringify(list)); }
  function folderName(id) {
    if (!id) return 'Unfiled';
    const f = savedFoldersList().find((x) => x.id === id);
    return f ? f.name : 'Unfiled';
  }
  function updateInsight(id, mut) {
    const arr = savedAll();
    const it = arr.find((x) => x.id === id);
    if (it) { mut(it); saveSavedAll(arr); }
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function newFolderId() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function saveInsight(text) {
    openSaveModal({ text });
  }

  // ---- Save / move modal -----------------------------------------------------
  let saveModalState = null; // {text} saves a new insight · {moveId} re-files one

  function openSaveModal(state) {
    saveModalState = state;
    const labelInput = panel.querySelector('#gpa-save-label');
    labelInput.value = '';
    if (state.text) {
      panel.querySelector('#gpa-save-modal-title').textContent = '💾 Save insight';
      panel.querySelector('#gpa-save-when').textContent = `Will be saved: ${new Date().toLocaleString()}`;
    } else {
      panel.querySelector('#gpa-save-modal-title').textContent = '📂 Move insight';
      const it = savedAll().find((x) => x.id === state.moveId);
      labelInput.value = it ? (it.label || '') : '';
      panel.querySelector('#gpa-save-when').textContent = it ? `Saved: ${new Date(it.ts).toLocaleString()}` : '';
    }
    panel.querySelector('#gpa-save-folder').value = '';
    refreshSaveSelects();
    if (!state.text) {
      const it = savedAll().find((x) => x.id === state.moveId);
      if (it) {
        panel.querySelector('#gpa-save-folder').value = it.folder || '';
        refreshSaveSelects();
        panel.querySelector('#gpa-save-file').value = it.file || '';
      }
    }
    panel.querySelector('#gpa-save-modal').style.display = 'flex';
  }
  function closeSaveModal() {
    panel.querySelector('#gpa-save-modal').style.display = 'none';
    saveModalState = null;
  }
  function refreshSaveSelects() {
    const folders = savedFoldersList();
    const folderSel = panel.querySelector('#gpa-save-folder');
    const fileSel = panel.querySelector('#gpa-save-file');
    const prev = folderSel.value;
    folderSel.innerHTML = '';
    let o = document.createElement('option');
    o.value = ''; o.textContent = '📥 Unfiled';
    folderSel.appendChild(o);
    folders.filter((f) => !f.parent).forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.id; opt.textContent = '📁 ' + f.name;
      folderSel.appendChild(opt);
    });
    if (prev && folders.some((f) => f.id === prev)) folderSel.value = prev;
    fileSel.innerHTML = '';
    o = document.createElement('option');
    o.value = ''; o.textContent = '(no file)';
    fileSel.appendChild(o);
    folders.filter((f) => f.parent === folderSel.value).forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.id; opt.textContent = '📄 ' + f.name;
      fileSel.appendChild(opt);
    });
    fileSel.closest('.gpa-row').style.display = folderSel.value ? 'flex' : 'none';
    panel.querySelector('#gpa-save-file-new').style.display = folderSel.value ? 'inline-block' : 'none';
  }
  (function wireSaveModal() {
    panel.querySelector('#gpa-save-folder').addEventListener('change', refreshSaveSelects);
    panel.querySelector('#gpa-save-cancel').addEventListener('click', closeSaveModal);
    panel.querySelector('#gpa-save-modal').addEventListener('click', (e) => {
      if (e.target.id === 'gpa-save-modal') closeSaveModal();
    });
    panel.querySelector('#gpa-save-folder-new').addEventListener('click', () => {
      const name = prompt('New folder name:');
      if (!name) return;
      const list = savedFoldersList();
      const id = newFolderId();
      list.push({ id, name: name.trim(), parent: '' });
      saveFoldersList(list);
      panel.querySelector('#gpa-save-folder').value = id;
      refreshSaveSelects();
    });
    panel.querySelector('#gpa-save-file-new').addEventListener('click', () => {
      const parent = panel.querySelector('#gpa-save-folder').value;
      if (!parent) return;
      const name = prompt(`New file name inside "${folderName(parent)}":`);
      if (!name) return;
      const list = savedFoldersList();
      const id = newFolderId();
      list.push({ id, name: name.trim(), parent });
      saveFoldersList(list);
      panel.querySelector('#gpa-save-file').value = id;
      refreshSaveSelects();
    });
    panel.querySelector('#gpa-save-ok').addEventListener('click', () => {
      const folder = panel.querySelector('#gpa-save-folder').value;
      const file = panel.querySelector('#gpa-save-file').value;
      const label = panel.querySelector('#gpa-save-label').value.trim();
      if (saveModalState && saveModalState.text) {
        const arr = savedAll();
        arr.push({
          id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text: saveModalState.text,
          url: window.location.href,
          title: document.title,
          date: new Date().toLocaleString(),
          ts: Date.now(),
          folder, file, label
        });
        saveSavedAll(arr);
      } else if (saveModalState && saveModalState.moveId) {
        updateInsight(saveModalState.moveId, (it) => { it.folder = folder; it.file = file; it.label = label; });
      }
      closeSaveModal();
      const pane = panel.querySelector('.gpa-pane[data-pane="saved"]');
      if (pane && pane.classList.contains('active')) renderSavedInsights();
    });
  })();

  // ---- Insight cards (shared by both views) ----------------------------------
  function renderInsightCards(listEl, items) {
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.innerHTML = '<div class="gpa-sub">Nothing here yet.</div>';
      return;
    }
    items.slice().sort((a, b) => b.ts - a.ts).forEach((it) => {
      const div = document.createElement('div');
      div.className = 'gpa-msg ai gpa-insight-card';
      div.style.marginBottom = '8px';
      const time = new Date(it.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const placeTxt = it.folder
        ? ` <span style="opacity:0.6;">(🗂 ${escapeHtml(folderName(it.folder))}${it.file ? ' › ' + escapeHtml(folderName(it.file)) : ''})</span>`
        : '';
      div.innerHTML = `
        <div class="gpa-row" style="justify-content:space-between; font-size:9px; opacity:0.9;">
          <span class="gpa-insight-time">🕒 ${escapeHtml(time)}${it.label ? '<span class="gpa-insight-label">' + escapeHtml(it.label) + '</span>' : ''}</span>
          <a href="${it.url}" target="_blank" style="color:${THEMES[theme].accent}; text-decoration:none; font-size:9px;">Visit Page</a>
        </div>
        <div class="gpa-sub" style="font-weight:700; margin:4px 0;">${escapeHtml(it.title)}${placeTxt}</div>
        <div style="font-size:11px; margin-bottom:2px;">${escapeHtml(it.text)}</div>
      `;
      const actions = document.createElement('div');
      actions.className = 'gpa-insight-actions';
      // Per-insight context switch. On = this note rides along with every
      // later AI request as background; off = it just sits here.
      const ctxBtn = document.createElement('button');
      ctxBtn.className = 'gpa-btn' + (it.ctx ? ' primary' : '');
      ctxBtn.textContent = it.ctx ? '🧠 Context: ON' : '🧠 Use as context';
      ctxBtn.title = it.ctx
        ? 'This insight is being sent with every AI request. Click to stop.'
        : 'Send this insight along with every later AI request as background context.';
      ctxBtn.addEventListener('click', () => {
        updateInsight(it.id, (x) => { x.ctx = !x.ctx; });
        renderSavedInsights();
      });
      const lab = document.createElement('button');
      lab.className = 'gpa-btn';
      lab.textContent = '🏷 Label';
      lab.addEventListener('click', () => {
        const v = prompt('Label for this insight:', it.label || '');
        if (v === null) return;
        updateInsight(it.id, (x) => { x.label = v.trim(); });
        renderSavedInsights();
      });
      const move = document.createElement('button');
      move.className = 'gpa-btn';
      move.textContent = '📂 Move';
      move.addEventListener('click', () => openSaveModal({ moveId: it.id }));
      const del = document.createElement('button');
      del.className = 'gpa-btn';
      del.textContent = '🗑';
      del.addEventListener('click', () => {
        if (!confirm('Delete this insight?')) return;
        const arr = savedAll().filter((x) => x.id !== it.id);
        saveSavedAll(arr);
        renderSavedInsights();
      });
      actions.appendChild(ctxBtn);
      actions.appendChild(lab);
      actions.appendChild(move);
      actions.appendChild(del);
      div.appendChild(actions);
      listEl.appendChild(div);
    });
  }

  // ---- Calendar view ----------------------------------------------------------
  function renderCalendar() {
    const grid = panel.querySelector('#gpa-cal-grid');
    const titleEl = panel.querySelector('#gpa-cal-title');
    const dayLabel = panel.querySelector('#gpa-saved-day-label');
    const listEl = panel.querySelector('#gpa-saved-list');
    if (!calBase) { const n = new Date(); calBase = new Date(n.getFullYear(), n.getMonth(), 1); }
    if (!selDay) selDay = new Date();
    const y = calBase.getFullYear(), m = calBase.getMonth();
    titleEl.textContent = calBase.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const items = savedAll();
    const today = new Date();
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    grid.innerHTML = '';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => {
      const h = document.createElement('div');
      h.className = 'gpa-cal-dow';
      h.textContent = d;
      grid.appendChild(h);
    });
    for (let p = 0; p < new Date(y, m, 1).getDay(); p++) {
      const pad = document.createElement('button');
      pad.className = 'gpa-cal-day pad';
      pad.disabled = true;
      grid.appendChild(pad);
    }
    const daysIn = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= daysIn; d++) {
      const day = new Date(y, m, d);
      const b = document.createElement('button');
      b.className = 'gpa-cal-day';
      b.textContent = d;
      if (day >= weekStart && day <= weekEnd) b.classList.add('thisweek');
      if (sameDay(day, today)) b.classList.add('today');
      if (selDay && sameDay(day, selDay)) b.classList.add('sel');
      const count = items.filter((it) => sameDay(new Date(it.ts), day)).length;
      if (count) {
        b.title = count + ' insight(s) on ' + (m + 1) + '/' + d;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = '●';
        b.appendChild(dot);
      }
      b.addEventListener('click', () => { selDay = day; renderCalendar(); });
      grid.appendChild(b);
    }
    const dayItems = items.filter((it) => sameDay(new Date(it.ts), selDay));
    dayLabel.textContent = `📅 ${selDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })} — ${dayItems.length} insight${dayItems.length === 1 ? '' : 's'}`;
    renderInsightCards(listEl, dayItems);
  }

  // ---- Folder tree view ---------------------------------------------------------
  function renderFolderTree() {
    const tree = panel.querySelector('#gpa-folder-tree');
    const dayLabel = panel.querySelector('#gpa-saved-day-label');
    const listEl = panel.querySelector('#gpa-saved-list');
    const items = savedAll();
    const folders = savedFoldersList();
    tree.innerHTML = '';

    function chip(label, id, isFile) {
      const row = document.createElement('div');
      row.className = 'gpa-folder-chip' + (selFolder === id ? ' sel' : '');
      const main = document.createElement('button');
      main.className = 'mini grow';
      main.style.fontSize = '11px';
      main.style.background = 'transparent';
      main.style.border = 'none';
      main.style.color = 'inherit';
      main.textContent = (isFile ? '　📄 ' : '📁 ') + label + '  (' + items.filter((it) => it.folder === id).length + ')';
      main.addEventListener('click', () => { selFolder = id; renderFolderTree(); });
      row.appendChild(main);
      if (id) {
        const del = document.createElement('button');
        del.className = 'mini';
        del.textContent = '🗑';
        del.title = 'Delete ' + (isFile ? 'file' : 'folder');
        del.addEventListener('click', () => {
          if (!confirm(`Delete "${label}"? Its insights move to Unfiled.`)) return;
          saveFoldersList(savedFoldersList().filter((f) => f.id !== id && f.parent !== id));
          updateInsightForAll(id);
          if (selFolder === id) selFolder = '';
          renderFolderTree();
        });
        row.appendChild(del);
        if (!isFile) {
          const add = document.createElement('button');
          add.className = 'mini';
          add.textContent = '＋ file';
          add.title = 'New file inside';
          add.addEventListener('click', () => {
            const name = prompt(`New file name inside "${label}":`);
            if (!name) return;
            const list = savedFoldersList();
            list.push({ id: newFolderId(), name: name.trim(), parent: id });
            saveFoldersList(list);
            renderFolderTree();
          });
          row.appendChild(add);
        }
      }
      return row;
    }
    function updateInsightForAll(id) {
      const arr = savedAll();
      arr.forEach((it) => { if (it.folder === id) it.folder = ''; });
      saveSavedAll(arr);
    }

    tree.appendChild(chip('Unfiled', '', false));
    folders.filter((f) => !f.parent).forEach((f) => {
      tree.appendChild(chip(f.name, f.id, false));
      folders.filter((s) => s.parent === f.id).forEach((s) => {
        const sub = chip(s.name, s.id, true);
        sub.style.marginLeft = '16px';
        tree.appendChild(sub);
      });
    });

    const labelTxt = selFolder ? folderName(selFolder) : 'Unfiled';
    const folderItems = items.filter((it) => it.folder === selFolder);
    dayLabel.textContent = `🗂 ${labelTxt} — ${folderItems.length} insight${folderItems.length === 1 ? '' : 's'}`;
    renderInsightCards(listEl, folderItems);
  }

  // ---- Saved tab master render ----------------------------------------------------
  function renderSavedInsights() {
    const calBtn = panel.querySelector('#gpa-saved-view-cal');
    const foldBtn = panel.querySelector('#gpa-saved-view-folders');
    const newBtn = panel.querySelector('#gpa-saved-new-folder');
    const calHead = panel.querySelector('#gpa-saved-cal-head');
    const grid = panel.querySelector('#gpa-cal-grid');
    const tree = panel.querySelector('#gpa-folder-tree');
    const isCal = savedView === 'calendar';
    calBtn.classList.toggle('primary', isCal);
    foldBtn.classList.toggle('primary', !isCal);
    grid.style.display = isCal ? 'grid' : 'none';
    calHead.style.display = isCal ? 'flex' : 'none';
    tree.style.display = isCal ? 'none' : 'flex';
    newBtn.style.display = isCal ? 'none' : 'inline-block';
    if (isCal) renderCalendar(); else renderFolderTree();
  }
  panel.querySelector('#gpa-saved-view-cal').addEventListener('click', () => {
    savedView = 'calendar';
    localStorage.setItem('gpa_saved_view', savedView);
    renderSavedInsights();
  });
  panel.querySelector('#gpa-saved-view-folders').addEventListener('click', () => {
    savedView = 'folders';
    localStorage.setItem('gpa_saved_view', savedView);
    renderSavedInsights();
  });
  panel.querySelector('#gpa-saved-new-folder').addEventListener('click', () => {
    const name = prompt('New folder name:');
    if (!name) return;
    const list = savedFoldersList();
    list.push({ id: newFolderId(), name: name.trim(), parent: '' });
    saveFoldersList(list);
    selFolder = '';
    renderFolderTree();
  });
  panel.querySelector('#gpa-cal-prev').addEventListener('click', () => {
    calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1);
    renderCalendar();
  });
  panel.querySelector('#gpa-cal-next').addEventListener('click', () => {
    calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1);
    renderCalendar();
  });

  async function autoFillForm() {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    if (!inputs.length) { showToast('No form fields found on this page.'); return; }

    const fieldInfo = inputs.map((el, i) => {
      const label = el.closest('label')?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || `Field ${i+1}`;
      return { id: i, label: label.trim(), type: el.type || 'text' };
    });

    scanOutput.textContent = 'AI is analyzing form fields...';
    try {
      const sys = 'You are a form-filling assistant. Based on the provided page content and the list of form fields, generate realistic but mock values for each field. Return ONLY a JSON array of objects: [{"id":0, "v":"Value"}, ...]. If a field is obviously not needed or can\'t be filled, omit it from the array.';
      const userText = `PAGE TEXT:\n${pageText}\n\nFIELDS TO FILL:\n${JSON.stringify(fieldInfo)}`;
      const out = await callAI(userText, sys);
      const mapping = JSON.parse(out);

      // Show what the AI intends to fill before touching the form — fill
      // only on confirm. Mock values only; nothing is submitted.
      const preview = mapping.map((item) => {
        const el = inputs[item.id];
        const field = el ? (el.name || el.placeholder || item.id) : item.id;
        return `  ${field} → ${item.v}`;
      }).join('\n');
      if (!confirm(`The AI suggests filling ${mapping.length} field(s):\n\n${preview.slice(0, 900)}\n\nFill them in?\n(Nothing is submitted — you can still edit or clear everything.)`)) {
        scanOutput.textContent = 'Cancelled — no fields were filled.';
        return;
      }

      mapping.forEach((item) => {
        const el = inputs[item.id];
        if (el) {
          if (el.tagName === 'SELECT') {
            const opt = Array.from(el.options).find(o => o.text.toLowerCase().includes(item.v.toLowerCase()));
            if (opt) el.value = opt.value;
          } else {
            el.value = item.v;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      scanOutput.textContent = 'Form fields filled with suggested values!';
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  }

  function addSaveButton(container, text) {
    const btn = document.createElement('button');
    btn.className = 'gpa-btn';
    btn.style.marginTop = '8px';
    btn.textContent = '💾 Save Insight';
    btn.addEventListener('click', () => saveInsight(text));
    container.appendChild(btn);
  }

  function extractPageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((el) => el.remove());
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    const cap = effectiveMaxPageChars();
    if (text.length > cap) text = text.slice(0, cap) + '\n\n[...truncated...]';
    return text;
  }

  // Reads answer choices the AI can't see from plain page text: closed
  // <select> dropdowns (only the currently-picked option renders as text)
  // and radio/checkbox groups (their option labels aren't always adjacent
  // to visible question text in a way innerText captures cleanly).
  function extractQuizChoices() {
    const lines = [];
    document.querySelectorAll('select').forEach((sel, idx) => {
      const opts = Array.from(sel.options).map((o) => o.text.trim()).filter(Boolean);
      if (opts.length) {
        const hint = sel.getAttribute('aria-label') || sel.name || sel.id || `dropdown ${idx + 1}`;
        lines.push(`Dropdown "${hint}" choices: ${opts.join(' | ')}`);
      }
    });
    function labelFor(input) {
      if (input.id) {
        try {
          const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
          if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
        } catch (e) { /* invalid id for CSS.escape — ignore */ }
      }
      const wrapLabel = input.closest('label');
      if (wrapLabel && wrapLabel.textContent.trim()) return wrapLabel.textContent.trim();
      return input.value || '';
    }
    const groups = {};
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
      const key = `${input.type}:${input.name || 'unnamed'}`;
      const text = labelFor(input);
      if (text) (groups[key] = groups[key] || []).push(text);
    });
    Object.entries(groups).forEach(([key, opts]) => {
      if (opts.length > 1) lines.push(`Multiple-choice options for "${key.split(':')[1]}": ${opts.join(' | ')}`);
    });
    return lines.join('\n');
  }

  // Opens the browser's native screen/window/tab picker, grabs ONE frame,
  // then immediately stops sharing. Requires a genuine user click and https.
  async function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen capture is not supported in this context (needs https).');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'never' },
      audio: false
    });
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const vw = video.videoWidth, vh = video.videoHeight;
      const scale = Math.min(1, MAX_IMAGE_WIDTH / vw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/png');
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  // ---- Upload / paste an image (for the AI to read text from or analyze) --
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function downscaleDataUrl(dataUrl, maxWidth) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = dataUrl;
    });
  }

  // ---- Scan & Analyze tab ------------------------------------------------
  let pageText = '';
  let screenshotDataUrl = '';

  const scanBtn = panel.querySelector('#gpa-scan-btn');
  const captureBtn = panel.querySelector('#gpa-capture-btn');
  const statusRow = panel.querySelector('#gpa-status-row');
  const scanStatus = panel.querySelector('#gpa-scan-status');
  const thumb = panel.querySelector('#gpa-thumb');
  const clearBtn = panel.querySelector('#gpa-clear-context');
  const scanActions = panel.querySelector('#gpa-scan-actions');
  const scanMoreActions = panel.querySelector('#gpa-scan-more-actions');
  const questionRow = panel.querySelector('#gpa-question-row');
  const scanOutput = panel.querySelector('#gpa-scan-output');
  const askEmptyHint = panel.querySelector('#gpa-ask-empty-hint');

  function refreshStatus() {
    const parts = [];
    if (pageText) parts.push(`${pageText.length.toLocaleString()} chars of page text`);
    if (screenshotDataUrl) parts.push('screenshot captured');
    const has = parts.length > 0;
    statusRow.style.display = has ? 'flex' : 'none';
    scanActions.style.display = has ? 'flex' : 'none';
    if (scanMoreActions) scanMoreActions.style.display = has ? 'flex' : 'none';
    questionRow.style.display = has ? 'flex' : 'none';
    if (askEmptyHint) askEmptyHint.style.display = has ? 'none' : 'block';
    scanStatus.textContent = has ? parts.join(' + ') : '';
    thumb.classList.toggle('show', !!screenshotDataUrl);
    thumb.src = screenshotDataUrl || '';
  }

  // Plain DOM stats, no AI call — populated the instant the tab is shown so
  // there's real, honest content here even before anything is scanned.
  function updatePageSnapshot() {
    const statsEl = panel.querySelector('#gpa-snapshot-stats');
    const metaEl = panel.querySelector('#gpa-snapshot-meta');
    if (!statsEl || !metaEl) return;
    const text = (document.body.innerText || '').trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const minutes = words ? Math.max(1, Math.round(words / 200)) : 0;
    const images = document.querySelectorAll('img').length;
    const links = document.querySelectorAll('a[href]').length;
    const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
    // Sentence count is a rough split, not a linguistic parser — good enough
    // for an at-a-glance "how dense is this" number, not meant to be exact.
    const sentenceCount = text ? (text.match(/[.!?]+(?=\s|$)/g) || []).length : 0;
    const avgSentenceLen = sentenceCount ? Math.round(words / sentenceCount) : 0;
    const stats = [
      [words.toLocaleString(), 'words'],
      [minutes ? minutes + ' min' : '—', 'read time'],
      [images.toLocaleString(), 'images'],
      [links.toLocaleString(), 'links'],
      [avgSentenceLen ? avgSentenceLen.toLocaleString() : '—', 'words/sentence'],
      [headings.toLocaleString(), 'headings']
    ];
    statsEl.innerHTML = '';
    stats.forEach(([num, label]) => {
      const cell = document.createElement('div');
      cell.className = 'gpa-snapshot-stat';
      const n = document.createElement('div');
      n.className = 'gpa-snapshot-num';
      n.textContent = num;
      const l = document.createElement('div');
      l.className = 'gpa-snapshot-label';
      l.textContent = label;
      cell.appendChild(n);
      cell.appendChild(l);
      statsEl.appendChild(cell);
    });
    const lang = (document.documentElement.lang || '').trim();
    metaEl.textContent = (lang ? lang + ' · ' : '') + location.hostname;
  }
  updatePageSnapshot();

  // ---- Quiz solver: reads page text + dropdown/radio/checkbox choices,
  // returns one answer per question (including multi-part like "2a"/"2b")
  // as the same structured grid used for plain answer-key questions.
  const quizBtn = panel.querySelector('#gpa-quiz-btn');
  quizBtn.addEventListener('click', async () => {
    if (!pageText) pageText = extractPageText();
    refreshStatus();
    const choices = extractQuizChoices();
    const combinedText = choices
      ? `${pageText}\n\nFORM CONTROLS ON THIS PAGE (dropdowns / multiple-choice / checkboxes):\n${choices}`
      : pageText;

    const prevLabel = quizBtn.textContent;
    quizBtn.textContent = 'Solving…';
    quizBtn.disabled = true;
    scanOutput.innerHTML = '';
    scanOutput.textContent = 'Reading the page…';
    try {
      const sys = 'You are analyzing a quiz, exam, or worksheet on this web page, including any dropdown menus and multiple-choice/checkbox options listed under FORM CONTROLS ON THIS PAGE. Identify every question — including multi-part questions like "2a"/"2b" — and give the single best correct answer for each, using the dropdown/multiple-choice options where relevant. Respond with ONLY a JSON array in this exact shape and nothing else: [{"q":"1","a":"B","c":85,"h":"exact verbatim phrase from PAGE TEXT for this question"}] — "q" is the question number/label as a string (use sub-labels for multi-part questions), "a" is the short correct answer, "c" is your confidence (0-100), "h" is a short exact quote (copied verbatim from PAGE TEXT, not paraphrased) that pinpoints where that question appears — so it can be found and highlighted on the page. If you genuinely cannot determine an answer for an item, use "a":"Unclear" and a low "c". Do not include any text outside the JSON array.';
      const out = await callAI(combinedText, sys, screenshotDataUrl ? [screenshotDataUrl] : null, true);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        quizBtn.textContent = 'Double-checking…';
        const verified = mergeHighlightField(
          await verifyGridAnswers(combinedText, grid, screenshotDataUrl ? [screenshotDataUrl] : null),
          grid
        );
        renderAnswerGrid(scanOutput, verified);
        appendModelBadge(scanOutput);
        maybeSuggestBetterModel(scanOutput);
        highlightSnippetsOnPage(verified.map((it) => it.h).filter(Boolean));
      } else {
        typeText(scanOutput, out, scanOutput, () => appendModelBadge(scanOutput));
      }
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    } finally {
      quizBtn.textContent = prevLabel;
      quizBtn.disabled = false;
    }
  });

  // Tutor mode: same page reading as the solver, but every answer comes with
  // a "why" and a step-by-step solution, and each question can float its
  // explanation right next to itself on the page. You enter/submit all
  // answers yourself — the tutor explains, it doesn't take the quiz.
  const tutorBtn = panel.querySelector('#gpa-tutor-btn');
  tutorBtn.addEventListener('click', async () => {
    if (!pageText) pageText = extractPageText();
    refreshStatus();
    const choices = extractQuizChoices();
    const combinedText = choices
      ? `${pageText}\n\nFORM CONTROLS ON THIS PAGE (dropdowns / multiple-choice / checkboxes):\n${choices}`
      : pageText;

    const prevLabel = tutorBtn.textContent;
    tutorBtn.textContent = 'Preparing your tutor…';
    tutorBtn.disabled = true;
    scanOutput.innerHTML = '';
    scanOutput.textContent = 'Reading the page and working out the explanations…';
    try {
      const sys = [
        'You are an expert tutor helping a student understand a quiz, exam, or worksheet on this web page, including any dropdown menus and multiple-choice/checkbox options listed under FORM CONTROLS ON THIS PAGE.',
        'Identify every question, including multi-part questions like "2a"/"2b". For EACH question, give an explanation thorough enough that the student could solve the next question like it unaided.',
        'Fields for each question:',
        '"q": the question number/label as a string. "a": the short correct answer. "c": your confidence 0-100 that the answer is correct.',
        '"concept": the single idea or rule being tested, under 10 words.',
        '"why": 3 to 6 sentences. Give the reasoning that reaches the answer, and say explicitly why each tempting wrong option is wrong, naming them (for example "A is wrong because it counts only the divisors of 2026 itself"). Do not restate the question.',
        '"sol": the complete worked solution, steps separated by " ; ". SHOW THE REAL WORK - actual numbers, actual arithmetic, actual substitutions at every step. "Factor the number ; use the formula ; compute the result" is useless and unacceptable. "2026 = 2 x 1013 ; 1013 is prime, since no prime up to 31 divides it ; so 2026^2 = 2^2 x 1013^2 ; divisor count = (2+1)(2+1) = 9" is the required level of detail.',
        '"pitfall": the single most common mistake a student makes on this question, one sentence.',
        '"cite": an array of 1 to 3 sources the explanation rests on, each {"label":"name of the rule, theorem, definition or section","url":"https://..."}.',
        'NEVER invent, guess, or approximate a URL. Include "url" ONLY when you are certain that exact address exists (Wikipedia article titles and official documentation are usually safe); otherwise give "label" alone and omit "url" entirely. A named rule with no link is far more useful than a link that 404s. When the answer rests only on information stated on the page, cite {"label":"Stated on this page"}.',
        '"h": a short exact quote copied verbatim from PAGE TEXT that pinpoints where that question appears.',
        'Respond with ONLY a JSON array and nothing else, in exactly this shape: [{"q":"7","a":"B","c":90,"concept":"...","why":"...","sol":"... ; ... ; ...","pitfall":"...","cite":[{"label":"...","url":"..."}],"h":"..."}].',
        'If you genuinely cannot determine an answer, use "a":"Unclear", a low "c", and say what is missing in "why". Do not include any text outside the JSON array.'
      ].join(' ');
      const out = await callAI(combinedText, sys, screenshotDataUrl ? [screenshotDataUrl] : null, true);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        renderTutorGrid(scanOutput, grid);
        appendModelBadge(scanOutput);
        maybeSuggestBetterModel(scanOutput);
        highlightSnippetsOnPage(grid.map((it) => it.h).filter(Boolean));
        startAutoFollow(grid);
        const hint = document.createElement('div');
        hint.className = 'gpa-sub';
        hint.style.marginTop = '6px';
        hint.textContent = autoFollowOn()
          ? 'Questions are highlighted on the page, and the explanation for whichever one is on screen floats next to it automatically — it follows along as you press Next. Drag the popup by its header to park it anywhere. 💾 saves an explanation you can switch on later as AI context. You type the answers; the tutor explains.'
          : 'Questions are highlighted on the page. Press 📍 on any card to float its explanation next to the question, or turn Auto-explain on to have it follow the question you are looking at. You type the answers; the tutor explains.';
        scanOutput.appendChild(hint);
      } else {
        typeText(scanOutput, out, scanOutput);
      }
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    } finally {
      tutorBtn.textContent = prevLabel;
      tutorBtn.disabled = false;
    }
  });

  panel.querySelector('#gpa-autofollow-btn').addEventListener('click', () => setAutoFollow(!autoFollowOn()));
  renderAutoFollowBtn();

  scanBtn.addEventListener('click', () => {
    pageText = extractPageText();
    scanOutput.textContent = '';
    refreshStatus();
  });

  // Translates the whole page's text, not just a selection — the
  // selection-assistant bubble already covers one passage at a time, this
  // covers the rest of a page written in another language.
  const translatePageBtn = panel.querySelector('#gpa-translate-page-btn');
  translatePageBtn.addEventListener('click', async () => {
    if (!pageText) pageText = extractPageText();
    refreshStatus();
    const prevLabel = translatePageBtn.textContent;
    translatePageBtn.textContent = 'Translating…';
    translatePageBtn.disabled = true;
    scanOutput.innerHTML = '';
    scanOutput.textContent = 'Reading and translating the page…';
    try {
      const sys = 'Translate the given page text into English. If it is already in English, translate it into Spanish. Keep paragraph breaks where they make sense. Reply in plain text only — no markdown symbols.';
      const out = await callAI(pageText, sys);
      typeText(scanOutput, stripConfidence(out), scanOutput, () => appendModelBadge(scanOutput));
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    } finally {
      translatePageBtn.textContent = prevLabel;
      translatePageBtn.disabled = false;
    }
  });

  // ---- Quick actions: plain browser APIs, no AI call needed --------------
  const quickActionStatus = panel.querySelector('#gpa-quick-action-status');
  function flashQuickAction(msg) {
    if (!quickActionStatus) return;
    quickActionStatus.textContent = msg;
    setTimeout(() => { if (quickActionStatus.textContent === msg) quickActionStatus.textContent = ''; }, 2500);
  }
  const copyTextBtn = panel.querySelector('#gpa-copy-text-btn');
  if (copyTextBtn) {
    copyTextBtn.addEventListener('click', async () => {
      try {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((el) => el.remove());
        const full = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        await navigator.clipboard.writeText(full);
        flashQuickAction('Copied ' + full.length.toLocaleString() + ' characters.');
      } catch (e) { flashQuickAction('Could not copy — clipboard access was blocked.'); }
    });
  }
  const copyUrlBtn = panel.querySelector('#gpa-copy-url-btn');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); flashQuickAction('Copied the page URL.'); }
      catch (e) { flashQuickAction('Could not copy — clipboard access was blocked.'); }
    });
  }
  const printBtn = panel.querySelector('#gpa-print-btn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // Jumps straight to Settings from Page Insights, same as clicking its nav
  // item — the two quick-access toggles above cover the ones relevant to
  // this tab; everything else still lives in one place, not duplicated.
  const moreSettingsBtn = panel.querySelector('#gpa-more-settings-btn');
  if (moreSettingsBtn) {
    moreSettingsBtn.addEventListener('click', () => {
      const item = panel.querySelector('.gpa-dropdown-item[data-tab="theme"]');
      if (item) item.click();
    });
  }

  // ---- Tone & insight analysis: an AI tool whose result is a small chart,
  // not more paragraphs — sentiment is a polarity (diverging: two hues +
  // a neutral midpoint), formality/complexity are magnitudes (sequential:
  // one hue, light-to-dark by proportion). Colors are the dataviz skill's
  // validated default diverging pair (blue/red) at the step for whichever
  // of the 8 UI themes' light/dark surface is active — not the user's
  // chosen accent color, same reasoning the reserved status palette uses:
  // sentiment should read the same way regardless of theme.
  function isLightSurface() { return theme === 'white' || theme === 'lightblue'; }
  function divergingColors() {
    return isLightSurface()
      ? { pos: '#2a78d6', neg: '#e34948', mid: '#f0efec' }
      : { pos: '#3987e5', neg: '#e66767', mid: '#383835' };
  }
  function renderSequentialGauge(container, label, value) {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    const wrap = document.createElement('div');
    wrap.className = 'gpa-gauge';
    const lab = document.createElement('div');
    lab.className = 'gpa-gauge-label';
    const labText = document.createElement('span');
    labText.textContent = label;
    const labVal = document.createElement('span');
    labVal.className = 'gpa-gauge-value';
    labVal.textContent = v + '/100';
    lab.appendChild(labText);
    lab.appendChild(labVal);
    const track = document.createElement('div');
    track.className = 'gpa-gauge-track';
    const fill = document.createElement('div');
    fill.className = 'gpa-gauge-fill';
    fill.style.left = '0'; fill.style.width = v + '%'; fill.style.background = THEMES[theme].accent;
    track.appendChild(fill);
    wrap.appendChild(lab); wrap.appendChild(track);
    container.appendChild(wrap);
  }
  function renderDivergingGauge(container, label, value) {
    const v = Math.max(-100, Math.min(100, Math.round(value)));
    const { pos, neg, mid } = divergingColors();
    const wrap = document.createElement('div');
    wrap.className = 'gpa-gauge';
    const lab = document.createElement('div');
    lab.className = 'gpa-gauge-label';
    const labText = document.createElement('span');
    labText.textContent = label;
    const labVal = document.createElement('span');
    labVal.className = 'gpa-gauge-value';
    labVal.textContent = (v > 0 ? '+' : '') + v;
    lab.appendChild(labText);
    lab.appendChild(labVal);
    const track = document.createElement('div');
    track.className = 'gpa-gauge-track';
    const midline = document.createElement('div');
    midline.className = 'gpa-gauge-mid';
    midline.style.background = mid;
    const fill = document.createElement('div');
    fill.className = 'gpa-gauge-fill';
    const half = Math.abs(v) / 2;
    fill.style.left = (v >= 0 ? 50 : 50 - half) + '%';
    fill.style.width = half + '%';
    fill.style.background = v >= 0 ? pos : neg;
    track.appendChild(midline); track.appendChild(fill);
    wrap.appendChild(lab); wrap.appendChild(track);
    container.appendChild(wrap);
  }

  const toneBtn = panel.querySelector('#gpa-tone-btn');
  const toneOutput = panel.querySelector('#gpa-tone-output');
  const toneGauges = panel.querySelector('#gpa-tone-gauges');
  const toneSummary = panel.querySelector('#gpa-tone-summary');
  if (toneBtn) {
    toneBtn.addEventListener('click', async () => {
      if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
      const prevLabel = toneBtn.textContent;
      toneBtn.textContent = 'Analyzing…';
      toneBtn.disabled = true;
      try {
        const sys = 'Analyze the tone of the given content. Respond with ONLY a JSON object in exactly this shape and nothing else: {"tone":"one or two words, e.g. Professional","sentiment":0,"formality":0,"complexity":0,"summary":"one short plain-language sentence about the overall tone and why"} — "sentiment" is -100 (very negative/critical) to 100 (very positive/upbeat), "formality" is 0 (very casual) to 100 (very formal), "complexity" is 0 (very simple/easy to read) to 100 (very dense/technical). No text outside the JSON object.';
        const textPart = pageText ? `PAGE TEXT:\n${pageText}` : '(no page text captured — use the screenshot)';
        const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
        const m = out.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('Could not read a tone analysis from that response.');
        const data = JSON.parse(m[0]);
        toneGauges.innerHTML = '';
        renderDivergingGauge(toneGauges, 'Sentiment', Number(data.sentiment) || 0);
        renderSequentialGauge(toneGauges, 'Formality', Number(data.formality) || 0);
        renderSequentialGauge(toneGauges, 'Complexity', Number(data.complexity) || 0);
        toneSummary.textContent = (data.tone ? data.tone + ' — ' : '') + (data.summary || '');
        toneOutput.style.display = 'block';
        appendModelBadge(toneOutput);
      } catch (e) {
        toneOutput.style.display = 'block';
        toneSummary.textContent = '';
        // showError replaces the innerHTML of whatever it's given — target
        // just the gauges area, not the whole card, so the "Tone & insight
        // analysis" title survives a failed request instead of disappearing
        // along with it.
        showError(toneGauges, e, currentProviderLabel());
      } finally {
        toneBtn.textContent = prevLabel;
        toneBtn.disabled = false;
      }
    });
  }

  // ---- Explore further: related-topic chips that feed the existing
  // question box, so this complements Ask-a-question instead of forking
  // off into its own separate Q&A flow.
  const exploreBtn = panel.querySelector('#gpa-explore-btn');
  const exploreOutput = panel.querySelector('#gpa-explore-output');
  const exploreChips = panel.querySelector('#gpa-explore-chips');
  if (exploreBtn) {
    exploreBtn.addEventListener('click', async () => {
      if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
      const prevLabel = exploreBtn.textContent;
      exploreBtn.textContent = 'Thinking…';
      exploreBtn.disabled = true;
      try {
        const sys = 'Suggest 5 short, specific follow-up questions or related topics a curious reader of this content would want to explore next. Respond with ONLY a JSON array of 5 short strings (each under 8 words) and nothing else, e.g. ["...", "...", "...", "...", "..."]';
        const textPart = pageText ? `PAGE TEXT:\n${pageText}` : '(no page text captured — use the screenshot)';
        const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
        const m = out.match(/\[[\s\S]*\]/);
        if (!m) throw new Error('Could not read suggestions from that response.');
        const topics = JSON.parse(m[0]).filter((s) => typeof s === 'string' && s.trim()).slice(0, 6);
        exploreChips.innerHTML = '';
        topics.forEach((topic) => {
          const chip = document.createElement('button');
          chip.className = 'gpa-chip';
          chip.type = 'button';
          chip.textContent = topic;
          chip.addEventListener('click', () => {
            const qInput = panel.querySelector('#gpa-question');
            if (qInput) { qInput.value = topic; askPageQuestion(); }
          });
          exploreChips.appendChild(chip);
        });
        exploreOutput.style.display = 'block';
      } catch (e) {
        exploreOutput.style.display = 'block';
        exploreChips.innerHTML = '';
        showError(exploreChips, e, currentProviderLabel());
      } finally {
        exploreBtn.textContent = prevLabel;
        exploreBtn.disabled = false;
      }
    });
  }

  captureBtn.addEventListener('click', async () => {
    const prevLabel = captureBtn.textContent;
    captureBtn.textContent = 'Choose a tab/window…';
    captureBtn.disabled = true;
    try {
      screenshotDataUrl = await captureScreen();
      scanOutput.textContent = '';
      refreshStatus();
    } catch (e) {
      scanOutput.textContent = 'Screen capture cancelled or failed: ' + e.message;
    } finally {
      captureBtn.textContent = prevLabel;
      captureBtn.disabled = false;
    }
  });

  // Upload an image file directly.
  const imageUploadInput = panel.querySelector('#gpa-image-upload');
  const uploadBtn = panel.querySelector('#gpa-upload-btn');
  uploadBtn.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', async () => {
    const file = imageUploadInput.files && imageUploadInput.files[0];
    imageUploadInput.value = '';
    if (!file) return;
    try {
      const raw = await blobToDataUrl(file);
      screenshotDataUrl = await downscaleDataUrl(raw, MAX_IMAGE_WIDTH);
      scanOutput.textContent = '';
      refreshStatus();
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  });

  // Paste an image (Ctrl+V) anywhere in the panel — e.g. a screenshot
  // copied from another app or the OS's own screenshot tool.
  root.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        try {
          const raw = await blobToDataUrl(blob);
          screenshotDataUrl = await downscaleDataUrl(raw, MAX_IMAGE_WIDTH);
          scanOutput.textContent = '';
          refreshStatus();
        } catch (err) {
          showError(scanOutput, err, currentProviderLabel());
        }
        break;
      }
    }
  });

  clearBtn.addEventListener('click', () => {
    pageText = '';
    screenshotDataUrl = '';
    scanOutput.textContent = '';
    clearPageHighlights();
    refreshStatus();
  });

  panel.querySelector('#gpa-clear-highlights').addEventListener('click', clearPageHighlights);

  panel.querySelectorAll('#gpa-scan-actions .gpa-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
      const action = btn.dataset.action;
      if (action === 'autofill') { autoFillForm(); return; }
      const highlightNote = ' Then, on its own final line, write "HIGHLIGHTS: " followed by a JSON array of 2-5 short exact verbatim quotes (a few words each, copied exactly from PAGE TEXT — not paraphrased) marking the most important clues/info, e.g. HIGHLIGHTS: ["exact phrase one", "exact phrase two"]. If nothing stands out or there is no page text, use an empty array.';
      const sys = (action === 'summarize'
        ? 'Summarize the provided content in plain, everyday sentences — the shortest version that still covers the essentials. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together. Then, on its own line, write exactly "CONFIDENCE: NN" where NN (0-100) is how confident you are that this summary faithfully and accurately represents the source content.'
        : 'Give a brief, plain-language read on the provided content: what it\'s about, the main point, and anything notable — a few sentences, not a breakdown. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together. Then, on its own line, write exactly "CONFIDENCE: NN" where NN (0-100) is how confident you are that this analysis is accurate.'
      ) + highlightNote;
      scanOutput.innerHTML = SKELETON_HTML;
      try {
        const textPart = pageText ? `PAGE TEXT:\n${pageText}` : '(no page text captured — use the screenshot)';
        const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
        const { text: t1, value: highlightsRaw } = extractTrailingLine(out, 'HIGHLIGHTS');
        const { text: cleanText, confidence } = extractConfidenceLine(t1);
        typeText(scanOutput, cleanText, scanOutput, () => {
          appendConfidenceBadge(scanOutput, confidence);
          appendModelBadge(scanOutput);
          addSaveButton(scanOutput, cleanText);
          if (highlightsRaw) {
            try {
              const snippets = JSON.parse(highlightsRaw);
              highlightSnippetsOnPage(snippets);
            } catch (e) { /* model didn't return valid JSON — skip highlighting silently */ }
          }
        });
      } catch (e) {
        showError(scanOutput, e, currentProviderLabel());
      }
    });
  });

  panel.querySelector('#gpa-question-btn').addEventListener('click', askPageQuestion);
  panel.querySelector('#gpa-question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askPageQuestion();
  });

  async function askPageQuestion() {
    const input = panel.querySelector('#gpa-question');
    const q = input.value.trim();
    if (!q) return;
    if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
    scanOutput.innerHTML = SKELETON_HTML;
    try {
      const sys = 'You are the AI inside the user\'s "Agent Console" panel, answering about the web page they are viewing. ' + CAPABILITIES_BRIEF + ' Answer the question using ONLY the provided context (page text and/or screenshot). Before finalizing, double-check your answer against the context. If — and only if — the question is asking for answers to multiple numbered items (like a quiz, worksheet, or multiple-choice list), respond with ONLY a JSON array and nothing else, in exactly this shape: [{"q":"1","a":"B","c":90,"h":"exact verbatim phrase from PAGE TEXT near this question"}] — "q" is the item number/label as a string, "a" is the short answer, "c" is your confidence (0-100), "h" is a short exact quote (copied verbatim from PAGE TEXT, not paraphrased) that pinpoints where that question/answer appears, one object per item, no extra commentary. For any other kind of question, answer in brief plain sentences with no markdown formatting (no asterisks, headers, or lists), then two more lines: first exactly "CONFIDENCE: NN" (0-100, your confidence the answer is correct), then exactly "HIGHLIGHT: " followed by a short exact verbatim quote from PAGE TEXT that contains or supports the answer (empty if none applies). If the answer is not in the content, say so in one short sentence and use a low confidence number.';
      const textPart = `${pageText ? `PAGE TEXT:\n${pageText}\n\n` : ''}QUESTION:\n${q}`;
      const images = screenshotDataUrl ? [screenshotDataUrl] : null;
      const hard = isHardQuestion(q) || !!screenshotDataUrl;
      const out = await callAI(textPart, sys, images, hard);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        const verified = mergeHighlightField(await verifyGridAnswers(textPart, grid, images), grid);
        renderAnswerGrid(scanOutput, verified);
        appendModelBadge(scanOutput);
        if (hard) maybeSuggestBetterModel(scanOutput);
        highlightSnippetsOnPage(verified.map((it) => it.h).filter(Boolean));
      } else {
        const { text: t1, value: highlightSnippet } = extractTrailingLine(out, 'HIGHLIGHT');
        const { text: cleanText, confidence } = extractConfidenceLine(t1);
        typeText(scanOutput, cleanText, scanOutput, () => {
          appendConfidenceBadge(scanOutput, confidence);
          appendModelBadge(scanOutput);
          addSaveButton(scanOutput, cleanText);
          if (highlightSnippet) highlightSnippetOnPage(highlightSnippet);
        });
      }
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  }

  function getYoutubeApiKey() {
    let key = localStorage.getItem(YT_STORAGE_KEY);
    if (!key) {
      key = prompt('Paste a YouTube Data API v3 key (free, from console.cloud.google.com — enable "YouTube Data API v3" then create an API key):');
      if (key) localStorage.setItem(YT_STORAGE_KEY, key.trim());
    }
    return key ? key.trim() : null;
  }

  async function searchYoutube(query) {
    const key = getYoutubeApiKey();
    if (!key) throw new Error('No YouTube API key provided.');
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=1&q=${encodeURIComponent(query)}&key=${key}`;
    const res = await rawFetch(url);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`YouTube API error (${res.status}): ${redactSecrets(errText).slice(0, 300)}`);
    }
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item) throw new Error('No matching song found.');
    return { id: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle };
  }

  // ---- SoundCloud tab (official embeddable player, no proxy) ------------
  const scInput = panel.querySelector('#gpa-sc-url');
  const scLoadBtn = panel.querySelector('#gpa-sc-load');
  const scWrap = panel.querySelector('#gpa-sc-wrap');

  function loadSoundCloud() {
    const url = scInput.value.trim();
    if (!/^https?:\/\/(www\.)?(soundcloud\.com|on\.soundcloud\.com)\//i.test(url)) {
      scWrap.textContent = 'Paste a valid soundcloud.com track or playlist link.';
      return;
    }
    const accentHex = THEMES[theme].accent.replace('#', '');
    const embedSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23${accentHex}&auto_play=false&show_user=true&show_reposts=false&visual=false`;
    scWrap.innerHTML = `<iframe class="gpa-sc-frame" scrolling="no" frameborder="no" allow="autoplay" src="${embedSrc}"></iframe>`;
  }
  scLoadBtn.addEventListener('click', loadSoundCloud);
  scInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSoundCloud(); });

  // ---- Music search & play (YouTube Data API + official embed player) ----
  const musicQuery = panel.querySelector('#gpa-music-query');
  const musicSearchBtn = panel.querySelector('#gpa-music-search');
  const musicStatus = panel.querySelector('#gpa-music-status');
  const musicWrap = panel.querySelector('#gpa-music-wrap');

  async function playMusicSearch() {
    const q = musicQuery.value.trim();
    if (!q) return;
    musicStatus.textContent = 'Searching…';
    musicWrap.innerHTML = '';
    musicSearchBtn.disabled = true;
    try {
      const match = await searchYoutube(q);
      musicStatus.textContent = `Playing closest match: "${match.title}" — ${match.channel}`;
      musicWrap.innerHTML = `<iframe class="gpa-sc-frame" allow="autoplay; encrypted-media" src="https://www.youtube.com/embed/${match.id}?autoplay=1"></iframe>`;
    } catch (e) {
      showError(musicStatus, e, 'YouTube');
    } finally {
      musicSearchBtn.disabled = false;
    }
  }
  musicSearchBtn.addEventListener('click', playMusicSearch);
  musicQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') playMusicSearch(); });

  // ---- Local file player (fully offline — no network, no website involved) --
  // Files are read straight from disk via the browser's File API and played
  // through a normal <audio> element using a blob: URL. Once a file is
  // loaded, playback needs no internet connection at all. The playlist is
  // for this browsing session only — it can't be saved to disk from here,
  // so it resets if you reload the page or reopen the panel later.
  // ---- Offline music storage (IndexedDB) ------------------------------------
  // Audio files you add are stored as Blobs in IndexedDB, so the library
  // survives reloads and re-injections and plays with the network completely
  // off — nothing is fetched, the bytes are already on the device.
  //
  // IndexedDB rather than localStorage because localStorage only holds strings
  // and caps around 5MB; one song would blow it. Like every other browser
  // store this is per-origin, so a library saved on one site isn't visible on
  // another, and it is not part of profile sync (syncing tens of MB of audio
  // through a JSON bin would be absurd) — it stays on this device.
  const MUSIC_DB = 'gpa_music';
  const MUSIC_STORE = 'tracks';
  let musicDbPromise = null;

  function idbOpen() {
    if (musicDbPromise) return musicDbPromise;
    musicDbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(MUSIC_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MUSIC_STORE)) {
          db.createObjectStore(MUSIC_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB blocked'));
    }).catch((e) => { musicDbPromise = null; throw e; });
    return musicDbPromise;
  }

  function idbTx(mode, fn) {
    return idbOpen().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MUSIC_STORE, mode);
      const store = tx.objectStore(MUSIC_STORE);
      let out;
      try { out = fn(store); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    }));
  }

  function idbAddTrack(file) {
    return idbTx('readwrite', (store) => store.add({
      name: file.name, type: file.type || 'audio/mpeg', size: file.size, addedAt: Date.now(), blob: file
    }));
  }
  function idbAllTracks() {
    return idbTx('readonly', (store) => store.getAll());
  }
  function idbDeleteTrack(id) {
    return idbTx('readwrite', (store) => store.delete(id));
  }
  function idbClearTracks() {
    return idbTx('readwrite', (store) => store.clear());
  }

  // Ask the browser to keep this data rather than evicting it under pressure.
  // Granted silently in many cases; a refusal is harmless, just less durable.
  function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
        navigator.storage.persisted().then((already) => { if (!already) navigator.storage.persist().catch(() => {}); }).catch(() => {});
      }
    } catch (e) { /* not supported — fine */ }
  }

  function formatBytes(n) {
    if (!n || n < 1024) return (n || 0) + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  const localAddBtn = panel.querySelector('#gpa-local-add-btn');
  const localFileInput = panel.querySelector('#gpa-local-file-input');
  const localPlaylistEl = panel.querySelector('#gpa-local-playlist');
  const localPlayerEl = panel.querySelector('#gpa-local-player');
  const localNowPlaying = panel.querySelector('#gpa-local-nowplaying');
  const localSeek = panel.querySelector('#gpa-local-seek');
  const localTimeEl = panel.querySelector('#gpa-local-time');
  const localPlayPauseBtn = panel.querySelector('#gpa-local-playpause');
  const localPrevBtn = panel.querySelector('#gpa-local-prev');
  const localNextBtn = panel.querySelector('#gpa-local-next');
  const localVolume = panel.querySelector('#gpa-local-volume');

  const localStatusEl = panel.querySelector('#gpa-local-status');
  const localClearBtn = panel.querySelector('#gpa-local-clear-btn');

  // Remote tracks need the network; saved ones don't. `offline: true` marks a
  // track as playable with no connection.
  let localPlaylist = PRELOADED_TRACKS.map((t) => ({ name: t.name, url: t.url, offline: false }));
  let localCurrentIndex = -1;
  let savedBytes = 0;
  const localAudio = new Audio();
  localAudio.volume = 0.8;
  renderLocalPlaylist(); // show the preloaded list immediately; nothing auto-plays (browsers block that without a click anyway)

  // Pull the saved library out of IndexedDB and make it playable. Each blob
  // becomes an object URL, so playback never touches the network.
  async function loadSavedTracks() {
    try {
      const rows = await idbAllTracks();
      (rows || []).sort((a, b) => a.addedAt - b.addedAt).forEach((row) => {
        if (!row || !row.blob) return;
        savedBytes += row.size || 0;
        localPlaylist.push({ id: row.id, name: row.name, url: URL.createObjectURL(row.blob), offline: true });
      });
      renderLocalPlaylist();
      refreshLocalStatus();
      if (rows && rows.length) requestPersistentStorage();
    } catch (e) {
      refreshLocalStatus('Saved library unavailable in this browser (' + ((e && e.message) || e) + ') — added files will play for this session only.');
    }
  }
  loadSavedTracks();

  function isOffline() { return navigator.onLine === false; }

  function refreshLocalStatus(msg) {
    if (!localStatusEl) return;
    if (msg) { localStatusEl.textContent = msg; return; }
    const savedCount = localPlaylist.filter((t) => t.offline).length;
    const parts = [];
    parts.push(isOffline() ? '📴 Offline — saved songs still play' : '🌐 Online');
    parts.push(`${savedCount} saved${savedBytes ? ' · ' + formatBytes(savedBytes) : ''}`);
    localStatusEl.textContent = parts.join(' · ');
  }

  // Online/offline changes: restyle the playlist and gate the streaming paths.
  function applyConnectivity() {
    refreshLocalStatus();
    renderLocalPlaylist();
    const off = isOffline();
    const musicSearchBtn = panel.querySelector('#gpa-music-search');
    const scLoadBtn = panel.querySelector('#gpa-sc-load');
    [musicSearchBtn, scLoadBtn].forEach((b) => {
      if (!b) return;
      b.disabled = off;
      b.title = off ? 'Needs an internet connection' : '';
      b.style.opacity = off ? '0.5' : '';
    });
    const musicStatus = panel.querySelector('#gpa-music-status');
    if (musicStatus && off) musicStatus.textContent = 'Offline — YouTube search and SoundCloud need a connection. Your saved library below still works.';
  }
  onWin('online', applyConnectivity);
  onWin('offline', applyConnectivity);
  applyConnectivity();

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function renderLocalPlaylist() {
    localPlaylistEl.innerHTML = '';
    const off = isOffline();
    localPlaylist.forEach((track, i) => {
      const row = document.createElement('div');
      const unavailable = off && !track.offline;   // remote track, no connection
      row.className = 'gpa-local-track' + (i === localCurrentIndex ? ' playing' : '') + (unavailable ? ' gpa-track-unavailable' : '');
      const badge = document.createElement('span');
      badge.className = 'gpa-local-track-badge';
      badge.textContent = track.offline ? '💾' : '☁';
      badge.title = track.offline ? 'Saved on this device — plays offline' : 'Streamed from the web — needs a connection';
      const name = document.createElement('span');
      name.className = 'gpa-local-track-name';
      name.textContent = track.name;
      const remove = document.createElement('span');
      remove.className = 'gpa-local-track-remove';
      remove.textContent = '✕';
      remove.title = track.offline ? 'Delete from this device' : 'Remove from the list';
      remove.addEventListener('click', (e) => { e.stopPropagation(); removeLocalTrack(i); });
      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(remove);
      row.title = unavailable ? 'Needs an internet connection' : '';
      row.addEventListener('click', () => {
        if (unavailable) { refreshLocalStatus('That track streams from the web and needs a connection.'); return; }
        playLocalTrack(i);
      });
      localPlaylistEl.appendChild(row);
    });
  }

  function playLocalTrack(i) {
    if (i < 0 || i >= localPlaylist.length) return;
    if (isOffline() && !localPlaylist[i].offline) return;   // can't stream right now
    localCurrentIndex = i;
    localAudio.src = localPlaylist[i].url;
    localAudio.play().catch(() => { /* autoplay/decoding refusal — the UI still reflects the selection */ });
    localPlayerEl.style.display = 'block';
    localNowPlaying.textContent = localPlaylist[i].name;
    renderLocalPlaylist();
  }

  function removeLocalTrack(i) {
    const track = localPlaylist[i];
    if (!track) return;
    if (track.offline && !confirm(`Delete "${track.name}" from this device?`)) return;
    const wasPlaying = i === localCurrentIndex;
    // Only object URLs we created need revoking; remote https: urls don't.
    if (String(track.url).startsWith('blob:')) URL.revokeObjectURL(track.url);
    if (track.id !== undefined) {
      savedBytes = Math.max(0, savedBytes - (track.size || 0));
      idbDeleteTrack(track.id).catch(() => { /* already gone */ });
    }
    localPlaylist.splice(i, 1);
    if (wasPlaying) {
      localAudio.pause();
      localAudio.removeAttribute('src');
      localCurrentIndex = -1;
      localPlayerEl.style.display = 'none';
    } else if (i < localCurrentIndex) {
      localCurrentIndex--;
    }
    renderLocalPlaylist();
    refreshLocalStatus();
  }

  localAddBtn.addEventListener('click', () => localFileInput.click());
  localFileInput.addEventListener('change', async () => {
    const files = Array.from(localFileInput.files || []);
    localFileInput.value = '';
    if (!files.length) return;
    requestPersistentStorage();
    let savedCount = 0, sessionOnly = 0, lastError = '';
    for (const file of files) {
      const url = URL.createObjectURL(file);
      try {
        // Store the bytes so the track is still here next time, offline.
        const id = await idbAddTrack(file);
        savedBytes += file.size || 0;
        savedCount++;
        localPlaylist.push({ id, name: file.name, url, size: file.size, offline: true });
      } catch (e) {
        // Out of quota, private mode, or IndexedDB blocked: still playable now,
        // just not remembered. Say so rather than pretending it was saved.
        sessionOnly++;
        lastError = (e && e.message) || String(e);
        localPlaylist.push({ name: file.name, url, offline: true, session: true });
      }
    }
    renderLocalPlaylist();
    if (sessionOnly) {
      refreshLocalStatus(`${savedCount} saved for offline · ${sessionOnly} could not be saved (${lastError}) — those play this session only.`);
    } else {
      refreshLocalStatus();
    }
    if (localCurrentIndex === -1 && localPlaylist.length) playLocalTrack(localPlaylist.length - files.length);
  });

  localClearBtn.addEventListener('click', async () => {
    const saved = localPlaylist.filter((t) => t.id !== undefined);
    if (!saved.length) { refreshLocalStatus('Nothing saved on this device yet.'); return; }
    if (!confirm(`Delete all ${saved.length} saved song${saved.length === 1 ? '' : 's'} from this device?`)) return;
    try { await idbClearTracks(); } catch (e) { /* report below */ }
    localAudio.pause();
    localAudio.removeAttribute('src');
    localCurrentIndex = -1;
    localPlayerEl.style.display = 'none';
    // Only the saved ones go — session-only adds and remote tracks stay put.
    localPlaylist.forEach((t) => { if (t.id !== undefined && String(t.url).startsWith('blob:')) URL.revokeObjectURL(t.url); });
    localPlaylist = localPlaylist.filter((t) => t.id === undefined);
    savedBytes = 0;
    renderLocalPlaylist();
    refreshLocalStatus();
  });

  localPlayPauseBtn.addEventListener('click', () => {
    if (localCurrentIndex === -1) return;
    if (localAudio.paused) localAudio.play(); else localAudio.pause();
  });
  localPrevBtn.addEventListener('click', () => {
    if (!localPlaylist.length) return;
    playLocalTrack((localCurrentIndex - 1 + localPlaylist.length) % localPlaylist.length);
  });
  localNextBtn.addEventListener('click', () => {
    if (!localPlaylist.length) return;
    playLocalTrack((localCurrentIndex + 1) % localPlaylist.length);
  });
  localAudio.addEventListener('ended', () => {
    if (localPlaylist.length) playLocalTrack((localCurrentIndex + 1) % localPlaylist.length);
  });
  localAudio.addEventListener('play', () => { localPlayPauseBtn.textContent = '⏸'; });
  localAudio.addEventListener('pause', () => { localPlayPauseBtn.textContent = '▶'; });
  localAudio.addEventListener('timeupdate', () => {
    if (localAudio.duration) localSeek.value = String((localAudio.currentTime / localAudio.duration) * 100);
    localTimeEl.textContent = `${formatTime(localAudio.currentTime)} / ${formatTime(localAudio.duration)}`;
  });
  localSeek.addEventListener('input', () => {
    if (localAudio.duration) localAudio.currentTime = (parseFloat(localSeek.value) / 100) * localAudio.duration;
  });
  localVolume.addEventListener('input', () => { localAudio.volume = parseFloat(localVolume.value) / 100; });

  // ---- Proxy tab (Scramjet-powered) ---------------------------------------
  // Loads pages through Scramjet (github.com/MercuryWorkshop/scramjet), a
  // proxy engine the user runs on their own device — the internal data-tab/
  // data-pane key stays "browser" (other code keys off it), only the
  // user-facing label changed to "Proxy".
  //
  // The iframe always loads the proxy SERVER's own frontend first; a
  // destination is never written straight into the iframe's src (that would
  // bypass the proxy entirely). Instead it's handed to the frontend's real,
  // already-existing navigation entrypoint — its own demo app reads a
  // "?goto=" query param on load and passes it to its controller's
  // frame.go() internally (see packages/demo/src/pages/BrowserView.tsx in
  // the scramjet repo) — so this always uses Scramjet's actual supported
  // mechanism, never an invented one.
  //
  // The proxy server address is a small, user-editable setting that
  // defaults to this device's OWN localhost — never a shared or public
  // default. Whatever the user types there is saved only in their own
  // browser's storage; it is not baked into this script for anyone else,
  // and by default (nothing configured, nothing running) the tab simply
  // shows the same honest "couldn't load" state as a broken address, same
  // as the rest of this app does when something isn't reachable.
  const PROXY_SERVER_KEY = 'gpa_proxy_server_url';
  const PROXY_LAST_DEST_KEY = 'gpa_proxy_last_destination';
  // https, not http: pages with a strict Content-Security-Policy
  // (default-src 'self' https:, no frame-src set) refuse to frame a plain
  // http: origin outright, no matter what this script does — the proxy
  // server itself has to actually serve HTTPS for embedding to work there.
  const DEFAULT_PROXY_SERVER = 'https://localhost:4141';

  const proxyUrlInput = panel.querySelector('#gpa-proxy-url');
  const proxyGoBtn = panel.querySelector('#gpa-proxy-go');
  const proxyFrame = panel.querySelector('#gpa-proxy-frame');
  const proxyReloadBtn = panel.querySelector('#gpa-proxy-reload');
  const proxyHomeBtn = panel.querySelector('#gpa-proxy-home');
  const proxyPopoutBtn = panel.querySelector('#gpa-proxy-popout');
  const proxyStatusEl = panel.querySelector('#gpa-proxy-status');
  const proxyServerInput = panel.querySelector('#gpa-proxy-server');
  const proxyErrorEl = panel.querySelector('#gpa-proxy-error');

  function proxyServerUrl() {
    let v = '';
    try { v = localStorage.getItem(PROXY_SERVER_KEY) || ''; } catch (e) { /* storage unavailable */ }
    return (v || DEFAULT_PROXY_SERVER).replace(/\/+$/, '');
  }
  try { proxyServerInput.value = proxyServerUrl(); } catch (e) { /* ignore */ }
  proxyServerInput.addEventListener('change', () => {
    const v = proxyServerInput.value.trim();
    try { localStorage.setItem(PROXY_SERVER_KEY, v || DEFAULT_PROXY_SERVER); } catch (e) { /* best-effort */ }
  });

  function setProxyStatus(text, isError) {
    proxyStatusEl.textContent = text;
    proxyStatusEl.style.color = isError ? '#e5453a' : '';
  }
  function normalizeDestination(raw) {
    let url = (raw || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }
  function proxyGoto(destination) {
    const base = proxyServerUrl();
    proxyErrorEl.style.display = 'none';
    setProxyStatus('Connecting…');
    if (destination) {
      try { localStorage.setItem(PROXY_LAST_DEST_KEY, destination); } catch (e) { /* best-effort */ }
      proxyFrame.src = `${base}/?goto=${encodeURIComponent(destination)}`;
    } else {
      proxyFrame.src = `${base}/`;
    }
  }
  function loadProxyUrl() {
    const dest = normalizeDestination(proxyUrlInput.value);
    if (!dest) return;
    proxyUrlInput.value = dest; // .value, never innerHTML — nothing here is ever parsed as markup
    proxyGoto(dest);
  }
  proxyGoBtn.addEventListener('click', loadProxyUrl);
  proxyUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadProxyUrl(); });

  proxyReloadBtn.addEventListener('click', () => {
    // The frame is cross-origin to this page (it points at whatever proxy
    // server is configured), so contentWindow.location.reload() would throw
    // a SecurityError. Re-assigning the same src is the reliable
    // cross-origin-safe way to force a reload.
    const current = proxyFrame.src || `${proxyServerUrl()}/`;
    setProxyStatus('Connecting…');
    proxyFrame.src = 'about:blank';
    requestAnimationFrame(() => { proxyFrame.src = current; });
  });
  proxyHomeBtn.addEventListener('click', () => {
    proxyUrlInput.value = '';
    proxyGoto('');
  });
  proxyPopoutBtn.addEventListener('click', () => {
    window.open(proxyServerUrl() + '/', '_blank', 'noopener,noreferrer');
  });
  proxyFrame.addEventListener('load', () => {
    // This only confirms the proxy server's OWN frontend reached this
    // browser — the destination site loaded inside it is a separate,
    // cross-origin document this iframe can't inspect, so "Connected" means
    // "the proxy responded," not "the destination site is healthy."
    setProxyStatus('Connected');
  });
  proxyFrame.addEventListener('error', () => {
    setProxyStatus('Load failed', true);
    proxyErrorEl.textContent = 'Unable to load the proxy. Check that the proxy server address above is correct and running, then try Reload.';
    proxyErrorEl.style.display = '';
  });

  let proxyPaneInitialized = false;
  function activateProxyPane() {
    if (proxyPaneInitialized) return;
    proxyPaneInitialized = true;
    let lastDest = '';
    try { lastDest = localStorage.getItem(PROXY_LAST_DEST_KEY) || ''; } catch (e) { /* ignore */ }
    if (lastDest) proxyUrlInput.value = lastDest;
    proxyGoto(lastDest);
  }

  // ---- Ask AI tab (general chat) -----------------------------------------
  const chatEl = panel.querySelector('#gpa-chat');
  const askInput = panel.querySelector('#gpa-ask-input');
  const askBtn = panel.querySelector('#gpa-ask-btn');

  // ---- Ask AI: pasted / attached images (multimodal input) ----
  // Images pasted or attached ride along with the next question so the AI can
  // read and interpret them as context. OpenAI accepts data: URLs.
  let pendingImages = [];
  const MAX_ASK_IMAGES = 6;
  const imageStrip = panel.querySelector('#gpa-ask-images');

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('Could not read image.'));
      fr.readAsDataURL(blob);
    });
  }

  function renderImageStrip() {
    imageStrip.innerHTML = '';
    if (!pendingImages.length) { imageStrip.style.display = 'none'; return; }
    imageStrip.style.display = 'flex';
    pendingImages.forEach((url, i) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative; width:56px; height:56px;';
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'width:56px; height:56px; object-fit:cover; border-radius:6px; border:1px solid var(--gpa-accent,#888);';
      const x = document.createElement('button');
      x.type = 'button'; x.textContent = '×'; x.title = 'Remove';
      x.style.cssText = 'position:absolute; top:-6px; right:-6px; width:18px; height:18px; line-height:16px; '
        + 'padding:0; border-radius:50%; border:none; background:#000; color:#fff; cursor:pointer; font-weight:700;';
      x.addEventListener('click', () => { pendingImages.splice(i, 1); renderImageStrip(); });
      wrap.appendChild(img); wrap.appendChild(x);
      imageStrip.appendChild(wrap);
    });
  }

  async function addImageBlobs(blobs) {
    for (const b of blobs) {
      if (!b || !/^image\//.test(b.type)) continue;
      if (pendingImages.length >= MAX_ASK_IMAGES) break;
      try { pendingImages.push(await blobToDataUrl(b)); } catch (_) {}
    }
    renderImageStrip();
  }

  // Paste: pull any images out of the clipboard; let text paste normally.
  askInput.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) ? [...e.clipboardData.items] : [];
    const blobs = items.filter((it) => it.kind === 'file' && /^image\//.test(it.type))
                       .map((it) => it.getAsFile())
                       .filter(Boolean);
    if (blobs.length) { e.preventDefault(); addImageBlobs(blobs); }
  });

  // Attach button + hidden file input as a fallback to pasting.
  const askFile = panel.querySelector('#gpa-ask-file');
  panel.querySelector('#gpa-ask-attach').addEventListener('click', () => askFile.click());
  askFile.addEventListener('change', () => { addImageBlobs([...askFile.files]); askFile.value = ''; });

  // ---- Ask AI: study settings (per user, saved on this device) ----
  const ASK_KEYS = { subject: 'gpa_ask_subject', level: 'gpa_ask_level', context: 'gpa_ask_context' };
  const LEVEL_HINT = {
    simple: 'Explain as simply as possible, for a beginner — short words and plain examples.',
    standard: 'Explain at a normal level.',
    advanced: 'Give an advanced, in-depth explanation; assume a strong background.',
    exam: 'This is exam preparation: show the full working and reasoning, not just the result.'
  };
  function askSettings() {
    return {
      subject: (localStorage.getItem(ASK_KEYS.subject) || '').trim(),
      level: localStorage.getItem(ASK_KEYS.level) || 'standard',
      context: (localStorage.getItem(ASK_KEYS.context) || '').trim()
    };
  }
  (function wireAskSettings() {
    const box = panel.querySelector('#gpa-ask-settings');
    const subj = panel.querySelector('#gpa-ask-subject');
    const lvl = panel.querySelector('#gpa-ask-level');
    const ctx = panel.querySelector('#gpa-ask-context');
    const s = askSettings();
    subj.value = s.subject; lvl.value = s.level; ctx.value = s.context;
    panel.querySelector('#gpa-ask-settings-btn').addEventListener('click', () => {
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    panel.querySelector('#gpa-ask-settings-save').addEventListener('click', () => {
      localStorage.setItem(ASK_KEYS.subject, subj.value.trim());
      localStorage.setItem(ASK_KEYS.level, lvl.value);
      localStorage.setItem(ASK_KEYS.context, ctx.value.trim());
      box.style.display = 'none';
    });
  })();

  // ---- Ask AI: conversation memory (this session) ----
  let askHistory = [];              // [{ role:'user'|'assistant', content }]
  const ASK_MEMORY_TURNS = 12;      // how many past messages to send back each time

  function addMsg(role, text, images) {
    const div = document.createElement('div');
    div.className = 'gpa-msg ' + role;
    div.textContent = text;
    if (images && images.length) {
      const strip = document.createElement('div');
      strip.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;';
      images.forEach((url) => {
        const im = document.createElement('img');
        im.src = url;
        im.style.cssText = 'width:48px; height:48px; object-fit:cover; border-radius:4px;';
        strip.appendChild(im);
      });
      div.appendChild(strip);
    }
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  panel.querySelector('#gpa-ask-new').addEventListener('click', () => {
    askHistory = [];
    chatEl.innerHTML = '';
    pendingImages = [];
    renderImageStrip();
  });


  // Renders an AI reply with the first line lifted out as a highlighted
  // key-answer chip so it is easy to spot; the rest types in below it.
  function renderAskReply(bubble, fullText, confidence, onDone) {
    const t = THEMES[theme] || THEMES.dark;
    const nl = fullText.indexOf('\n');
    let answer, rest;
    if (nl > -1) { answer = fullText.slice(0, nl).trim(); rest = fullText.slice(nl + 1).trim(); }
    else { answer = fullText.trim(); rest = ''; }
    bubble.textContent = '';
    if (answer) {
      const chip = document.createElement('div');
      chip.textContent = answer;
      chip.style.cssText = 'background:' + t.accent + '22;border:1px solid ' + t.accent + ';'
        + 'border-left:3px solid ' + t.accent + ';border-radius:6px;padding:6px 8px;margin-bottom:6px;'
        + 'font-weight:700;color:' + t.text + ';';
      bubble.appendChild(chip);
    }
    const body = document.createElement('div');
    bubble.appendChild(body);
    typeText(body, rest, chatEl, () => {
      appendConfidenceBadge(bubble, confidence);
      appendModelBadge(bubble);
      if (onDone) onDone();
    });
  }

  async function sendChat() {
    const q = askInput.value.trim();
    const imgs = pendingImages.slice();
    if (!q && !imgs.length) return;
    addMsg('user', q || '🖼 (image)', imgs);
    askInput.value = '';
    pendingImages = [];
    renderImageStrip();
    const thinking = addMsg('ai', 'Thinking…');
    const s = askSettings();

    const steer = [];
    if (s.subject) steer.push('The user is asking about: ' + s.subject + '.');
    steer.push(LEVEL_HINT[s.level] || LEVEL_HINT.standard);
    if (s.context) steer.push('User context: ' + s.context);

    const sys = 'You are a helpful study assistant. ' + CAPABILITIES_BRIEF + ' '
      + steer.join(' ') + ' '
      + 'You are given the conversation so far — use it as memory and build on it; do not ask the user to repeat things they have already told you. '
      + 'Format every reply like this: the FIRST line is the direct answer or key takeaway in one short sentence, then a blank line, then the explanation or working. '
      + 'Reply in plain text only — no markdown symbols (no asterisks, headers, or lists). '
      + 'Then, on its own final line, write exactly "CONFIDENCE: NN" where NN (0-100) is your confidence that the answer is accurate.';

    // Fold the running conversation into the message so the model gets memory.
    const transcript = askHistory.slice(-ASK_MEMORY_TURNS)
      .map((m) => (m.role === 'user' ? 'USER: ' : 'ASSISTANT: ') + m.content)
      .join('\n');
    const qForModel = q || 'Please read and interpret the attached image(s) and help me with what they show.';
    const userText = (transcript ? 'CONVERSATION SO FAR:\n' + transcript + '\n\n' : '')
      + 'NEW MESSAGE:\n' + qForModel
      + (imgs.length ? '\n\n(' + imgs.length + ' image' + (imgs.length > 1 ? 's' : '') + ' attached below — read them as part of this question.)' : '');

    try {
      const out = await callAI(userText, sys, imgs.length ? imgs : null, isHardQuestion(q));
      const { text: cleanText, confidence } = extractConfidenceLine(out);
    askHistory.push({ role: 'user', content: qForModel }, { role: 'assistant', content: cleanText });
    if (askHistory.length > 40) askHistory = askHistory.slice(-40);
    renderAskReply(thinking, cleanText, confidence, () => {
      speak(cleanText);
      if (isHardQuestion(q)) maybeSuggestBetterModel(chatEl);
    });
    } catch (e) {
      showError(thinking, e, currentProviderLabel());
    }
  }
  askBtn.addEventListener('click', sendChat);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  // ---- Chat -----------------------------------------------------------------
  // A public room everyone shares, plus private rooms you join with a code the
  // owner hands out. Codes are kept locally per room so you only enter one
  // once. Polling only runs while the Chat tab is actually open — no point
  // spending requests on a tab nobody is looking at.
  const CHAT_ROOMS_KEY = 'gpa_chat_rooms';      // { id: {name, code} } joined privately
  const chatRoomSel = panel.querySelector('#gpa-chat-room');
  const chatLog = panel.querySelector('#gpa-chat-log');
  const chatInput = panel.querySelector('#gpa-chat-input');
  const chatNote = panel.querySelector('#gpa-chat-note');
  const chatBadge = panel.querySelector('#gpa-chat-badge');
  let chatRoom = 'public';
  let chatSince = 0;
  let chatTimer = null;
  let chatSeen = new Set();
  let chatUnread = 0;
  // Consecutive failed polls. When the worker is down or out of quota there is
  // nothing to be gained by asking twenty times a minute, so each failure
  // doubles the wait until one succeeds — which also lets chat recover on its
  // own, without the user reloading the page.
  let chatPollFailures = 0;
  // True for the poll right after (re)joining a room, so loading its history
  // doesn't get counted as a pile of new unread messages / mentions.
  let chatBootstrap = true;

  function updateChatBadge() {
    if (!chatBadge) return;
    chatBadge.textContent = chatUnread > 99 ? '99+' : String(chatUnread);
    chatBadge.style.display = chatUnread > 0 ? 'inline-flex' : 'none';
  }
  function clearChatUnread() {
    if (!chatUnread) return;
    chatUnread = 0;
    updateChatBadge();
  }
  // "Open" means the Chat tab is the active pane, the panel isn't minimized,
  // and the browser tab itself is actually in front — matches what a user
  // means by "I have chat open".
  function chatIsOpenAndVisible() {
    if (isMin) return false;
    const pane = panel.querySelector('.gpa-pane[data-pane="chat"]');
    if (!pane || !pane.classList.contains('active')) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return true;
  }
  function mentionsUser(text, user) {
    if (!text || !user) return false;
    const escaped = String(user).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|\\s)@' + escaped + '(?![\\w-])', 'i').test(text);
  }
  function notifyMention(m) {
    try {
      if (!window.Notification || Notification.permission !== 'granted') return;
      const n = new Notification(`${m.u} mentioned you in #${chatRoom}`, { body: String(m.t || '').slice(0, 140) });
      n.onclick = () => { try { window.focus(); } catch (e) {} };
    } catch (e) { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && chatIsOpenAndVisible()) clearChatUnread();
  });

  function joinedRooms() {
    try { return JSON.parse(localStorage.getItem(CHAT_ROOMS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveJoinedRooms(r) { try { localStorage.setItem(CHAT_ROOMS_KEY, JSON.stringify(r)); } catch (e) { /* quota */ } }
  function chatCodeFor(id) { return id === 'public' ? '' : (joinedRooms()[id] || {}).code || ''; }

  function renderRoomOptions() {
    const rooms = joinedRooms();
    chatRoomSel.innerHTML = '<option value="public"># public</option>'
      + Object.keys(rooms).map((id) => `<option value="${escapeHtml(id)}">🔒 ${escapeHtml(rooms[id].name || id)}</option>`).join('');
    chatRoomSel.value = chatRoom;
    if (chatRoomSel.value !== chatRoom) { chatRoom = 'public'; chatRoomSel.value = 'public'; }
  }

  // A deterministic color per username (same idea as Discord/Slack's
  // per-user avatar tint) so people are visually distinguishable at a
  // glance in a busy room, without needing real uploaded avatars.
  function avatarColor(name) {
    let hash = 0;
    const s = String(name || '?');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 55%, 45%)`;
  }
  function chatMsgEl(m) {
    const div = document.createElement('div');
    div.className = 'gpa-chat-msg'
      + (currentUser && m.u === currentUser ? ' mine' : '')
      + (m.owner ? ' owner' : '');
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = String(m.u || '?').trim().charAt(0).toUpperCase();
    avatar.style.background = avatarColor(m.u);
    const col = document.createElement('div');
    col.className = 'col';
    const head = document.createElement('div');
    head.className = 'head';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = m.u;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    head.appendChild(who); head.appendChild(when);
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = m.t;
    col.appendChild(head); col.appendChild(body);
    div.appendChild(avatar); div.appendChild(col);
    return div;
  }

  async function chatPoll() {
    if (!telemetryOn()) { chatNote.textContent = 'Chat needs the worker to be set up.'; return; }
    const base = telemetryEndpoint();
    const params = new URLSearchParams({ room: chatRoom, since: String(chatSince) });
    const code = chatCodeFor(chatRoom);
    if (code) params.set('code', code);
    // Snapshot before the request: this poll's messages should only count
    // toward unread/mentions if the room was already loaded when it started.
    const wasBootstrap = chatBootstrap;
    chatBootstrap = false;
    try {
      const res = await fetch(base + '/chat/poll?' + params.toString(), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      // A 5xx means the worker itself fell over. Say so plainly rather than
      // leaving an empty pane, and count it so the retry backs off.
      if (!res.ok) {
        chatPollFailures++;
        const why = (data && data.error && (data.error.detail || data.error.message)) || ('HTTP ' + res.status);
        chatNote.textContent = `Chat is unavailable (${String(why).slice(0, 120)}). Retrying…`;
        return;
      }
      if (!data.ok) {
        chatPollFailures++;
        chatNote.textContent = data.error || 'Could not load messages.';
        return;
      }
      chatPollFailures = 0;
      chatNote.textContent = '';
      const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
      const visible = chatIsOpenAndVisible();
      let added = 0;
      (data.messages || []).forEach((m) => {
        const id = m.ts + '|' + m.u + '|' + m.t;
        if (chatSeen.has(id)) return;
        chatSeen.add(id);
        chatLog.appendChild(chatMsgEl(m));
        chatSince = Math.max(chatSince, m.ts);
        added++;
        const isMine = currentUser && m.u === currentUser;
        if (!wasBootstrap && !isMine && !visible) {
          chatUnread++;
          if (currentUser && mentionsUser(m.t, currentUser)) notifyMention(m);
        }
      });
      const empty = chatLog.querySelector('.gpa-chat-empty');
      if (chatLog.children.length && empty) empty.remove();
      if (!chatLog.children.length) chatLog.innerHTML = '<div class="gpa-chat-empty">No messages yet — say something.</div>';
      // Only auto-scroll if they were already at the bottom, so reading back
      // through history isn't yanked away by an incoming message.
      if (added && atBottom && visible) chatLog.scrollTop = chatLog.scrollHeight;
      if (added) updateChatBadge();
    } catch (e) {
      chatPollFailures++;
      chatNote.textContent = 'Offline — messages will load when you reconnect.';
    }
  }

  function switchChatRoom(id) {
    chatRoom = id;
    chatSince = 0;
    chatSeen = new Set();
    chatBootstrap = true;
    chatLog.innerHTML = '<div class="gpa-chat-empty">Loading…</div>';
    chatPoll();
  }

  // Keeps polling regardless of which tab is open or whether the panel is
  // minimized, so unread counts and @mention notifications stay live even
  // while the user isn't looking at Chat. Polls fast (near-instant) while
  // Chat is actually the thing on screen, and backs off while it's just
  // running in the background so it isn't hammering the worker all day.
  //
  // The intervals are a budget decision as much as a feel decision: every poll
  // is a read against the worker's KV allowance, so polling every 1.5s all day
  // spends most of a day's reads on one signed-in person staring at something
  // else. Three seconds still reads as instant in conversation.
  const CHAT_POLL_ACTIVE_MS = 3000;
  const CHAT_POLL_BACKGROUND_MS = 15000;
  const CHAT_POLL_MAX_BACKOFF_MS = 120000;
  function scheduleChatPoll() {
    let delay = chatIsOpenAndVisible() ? CHAT_POLL_ACTIVE_MS : CHAT_POLL_BACKGROUND_MS;
    if (chatPollFailures > 0) {
      delay = Math.min(delay * Math.pow(2, chatPollFailures), CHAT_POLL_MAX_BACKOFF_MS);
    }
    chatTimer = setTimeout(async () => {
      await chatPoll();
      scheduleChatPoll();
    }, delay);
  }
  function startChatPolling() {
    if (chatTimer) return;
    chatPoll();
    scheduleChatPoll();
  }

  async function chatSend() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!currentUser) { chatNote.textContent = 'Sign in first.'; return; }
    if (!telemetryOn()) { chatNote.textContent = 'Chat needs the worker to be set up.'; return; }
    chatInput.value = '';
    try {
      // See sendBeat() for why this header is conditional: only present at
      // all on the owner's own device, so nobody else's request shape changes.
      const ownerCode = admGet(ADMIN_KEYS.OWNER_CODE);
      const sendHeaders = { 'Content-Type': 'text/plain' };
      if (ownerCode) sendHeaders['X-GPA-Owner'] = ownerCode;
      const res = await fetch(telemetryEndpoint() + '/chat/send', {
        method: 'POST', headers: sendHeaders,
        body: JSON.stringify({ room: chatRoom, user: currentUser, text, code: chatCodeFor(chatRoom) })
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { chatNote.textContent = data.error || 'Message not sent.'; chatInput.value = text; return; }
      chatPoll();
    } catch (e) {
      chatNote.textContent = 'Could not send — check your connection.';
      chatInput.value = text;
    }
  }

  chatRoomSel.addEventListener('change', () => switchChatRoom(chatRoomSel.value));
  panel.querySelector('#gpa-chat-send').addEventListener('click', chatSend);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSend(); });
  panel.querySelector('#gpa-chat-join').addEventListener('click', async () => {
    const code = (prompt('Room code from the owner:') || '').trim().toUpperCase();
    if (!code) return;
    const id = (prompt('Room name or id (as the owner gave it):') || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return;
    chatNote.textContent = 'Checking…';
    try {
      const res = await fetch(telemetryEndpoint() + `/chat/poll?room=${encodeURIComponent(id)}&since=0&code=${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { chatNote.textContent = data.error || 'Could not join.'; return; }
      const rooms = joinedRooms();
      rooms[id] = { name: id, code };
      saveJoinedRooms(rooms);
      renderRoomOptions();
      chatRoomSel.value = id;
      switchChatRoom(id);
      chatNote.textContent = 'Joined 🔒 ' + id;
    } catch (e) {
      chatNote.textContent = 'Could not reach the server.';
    }
  });
  renderRoomOptions();

  // ---- Extended tools -------------------------------------------------------
  // Voice input, read-aloud, text-selection assistant, table extractor, page
  // watcher, natural-language page commands, flashcards, scratchpad, pomodoro
  // and research mode. All persistent state uses gpa_* localStorage keys, so
  // profiles and cloud sync pick them up automatically (collectState grabs
  // every gpa_* key).

  const TTS_KEY = 'gpa_tts_enabled';
  const AUTOCONFIRM_KEY = 'gpa_autoconfirm';
  const SCRATCH_KEY = 'gpa_scratchpad';
  const FC_KEY = 'gpa_flashcards';

  function stripConfidence(text) {
    return String(text || '').replace(/\n?\s*CONFIDENCE:\s*\d{1,3}\s*%?\s*$/i, '').trim();
  }

  // Read-aloud (browser speech synthesis — free, local, no key needed).
  function speak(text) {
    if (localStorage.getItem(TTS_KEY) !== 'on' || !('speechSynthesis' in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch (e) { /* speech is a nice-to-have — never let it break a reply */ }
  }

  const ttsBtn = panel.querySelector('#gpa-tts-toggle');
  function renderTtsBtn() {
    const on = localStorage.getItem(TTS_KEY) === 'on';
    ttsBtn.textContent = on ? '🔊 Read answers aloud: ON' : '🔇 Read answers aloud: OFF';
    ttsBtn.classList.toggle('primary', on);
  }
  ttsBtn.addEventListener('click', () => {
    const on = localStorage.getItem(TTS_KEY) !== 'on';
    localStorage.setItem(TTS_KEY, on ? 'on' : 'off');
    if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
    renderTtsBtn();
  });
  renderTtsBtn();

  // Auto-confirm for the "Do it" bar: when ON, harmless page clicks run
  // without asking. Risky verbs (submit, send, delete, pay…) always keep
  // their confirmation no matter what — that guard is not bypassable.
  // Class-based rather than a single id, so the same toggle can appear a
  // second time as a quick-access shortcut on Page Insights (right next to
  // the "Do it" bar it actually governs) without the two copies drifting
  // out of sync — both are just every element with this class.
  const autoConfirmBtns = panel.querySelectorAll('.autoconfirm-btn');
  function renderAutoConfirmBtn() {
    const on = localStorage.getItem(AUTOCONFIRM_KEY) === 'on';
    autoConfirmBtns.forEach((btn) => {
      btn.textContent = on ? '⚡ Confirm page clicks: OFF (auto)' : '✋ Confirm page clicks: ON';
      btn.classList.toggle('primary', on);
    });
  }
  autoConfirmBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = localStorage.getItem(AUTOCONFIRM_KEY) !== 'on';
      localStorage.setItem(AUTOCONFIRM_KEY, on ? 'on' : 'off');
      renderAutoConfirmBtn();
    });
  });
  renderAutoConfirmBtn();

  // Voice input for Ask AI (browser speech recognition).
  (function voiceInput() {
    const voiceBtn = panel.querySelector('#gpa-voice-btn');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      voiceBtn.title = 'Speech recognition not supported in this browser';
      voiceBtn.disabled = true;
      return;
    }
    let rec = null, listening = false;
    voiceBtn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'en-US';
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        askInput.value = e.results[0][0].transcript;
        sendChat();
      };
      const done = () => { listening = false; voiceBtn.classList.remove('primary'); voiceBtn.textContent = '🎙'; };
      rec.onend = done;
      rec.onerror = done;
      listening = true;
      voiceBtn.classList.add('primary');
      voiceBtn.textContent = '🔴';
      rec.start();
    });
  })();

  // Shared by the selection-assistant bubble AND the standalone Humanize tab
  // below, so both surfaces rewrite text the exact same way. A writing-
  // quality aid, not a tool for disguising text's origin — meaning, facts,
  // and length must stay intact. The specific tics it targets are drawn from
  // documented research on what actually reads as AI-generated: overused
  // "AI vocabulary" and stock transitions catalogued by Wikipedia's
  // WikiProject AI Cleanup (en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
  // the "it's not X, it's Y" contrastive-antithesis pattern and rule-of-three
  // overuse documented by GPTZero and others, and the perplexity/burstiness
  // research showing AI text defaults to uniform sentence length and
  // predictable word choice rather than the natural variation in human prose.
  // VOICE targets a high-school-sophomore register (simpler vocabulary and
  // sentence complexity) at the user's request — still bound by the same
  // meaning/facts/length guardrail as everything else here.
  const HUMANIZE_PROMPT = 'Rewrite the given text so it reads the way an actual person would write it — fix the specific habits that make AI-generated text sound artificial, not just swap in synonyms. '
    + 'VOCABULARY: cut inflated, overused words like delve, tapestry, landscape, realm, boasts, showcase, underscore, testament, vibrant, intricate, pivotal, crucial, meticulous, robust, comprehensive, multifaceted, leverage, utilize, harness, foster, elevate, unlock, navigate, embark, garner, bolster, cultivate, seamless, cutting-edge, game-changer, groundbreaking, ever-evolving — use plainer, more specific words instead. '
    + 'STOCK PHRASES: drop filler like "it\'s important to note", "it\'s worth noting", "in today\'s fast-paced world", "when it comes to X", "at the end of the day", "moreover", "furthermore", "in conclusion", "overall" — say the thing directly instead of announcing that you\'re about to say it. '
    + 'STRUCTURE: break up the "it\'s not just X, it\'s Y" / "not only X but also Y" contrast pattern, forcing lists into exactly three items, and tacking a vague "-ing" clause onto sentence endings for false significance (e.g. "...further underscoring its importance"). Vary how sentences open and close. '
    + 'RHYTHM: AI text defaults to uniform sentence length and safe, predictable phrasing — deliberately mix short, punchy sentences with longer ones, the way people actually write. '
    + 'PUNCTUATION: don\'t use em dashes as an all-purpose connector; use commas, periods, or parentheses where a person actually would. '
    + 'TONE: cut indiscriminate flattering adjectives (fascinating, remarkable, vibrant) applied to things that don\'t warrant them, and don\'t downplay something\'s importance right before asserting how important it is. '
    + 'VOICE: write at the level of a high school sophomore — everyday vocabulary instead of advanced or academic-sounding words, simpler and more direct sentence structure instead of dense multi-clause sentences, and straightforward reasoning instead of elaborate, layered argumentation. If the original text uses a technical term the meaning depends on, keep the term but explain it plainly rather than swapping it for an even fancier synonym. '
    + 'Keep the exact same meaning, facts, and length throughout — do not add, remove, or invent information.';

  // Shared by the selection-assistant bubble AND the standalone Grammar tab
  // below, same reasoning as HUMANIZE_PROMPT above. Deliberately narrower in
  // scope than Humanize: fixes actual errors only, and explicitly leaves
  // style/tone/word choice alone so the two tools stay clearly distinct.
  const GRAMMAR_PROMPT = 'Proofread the given text for grammar, spelling, and punctuation errors only — do not change the writer\'s style, tone, word choice, or length beyond what is needed to fix an actual error. Reply with the corrected version first, then a blank line, then "Fixed:" followed by one short line per correction naming what was wrong and the fix. If there are no errors, reply with the text unchanged, then a blank line, then "No errors found."';

  // Text-selection assistant: select any text on the page → floating bubble
  // with Explain / Simplify / Translate / Define / Humanize / Grammar / clean-copy / save.
  (function selectionAssistant() {
    const ACTIONS = [
      ['Explain', 'Explain the selected text clearly and concisely.'],
      ['Simplify', 'Rewrite the selected text in much simpler words anyone can understand. Keep it short.'],
      ['Translate', 'Translate the selected text to English. If it is already in English, translate it to Spanish.'],
      ['Define', 'Define the key terms, jargon, or names in the selected text — one per line, term first.'],
      ['Humanize', HUMANIZE_PROMPT, true],
      ['Grammar', GRAMMAR_PROMPT],
      ['📋 Clean', null],
      ['💾', 'save']
    ];
    let bubble = null, pop = null;

    function removeBubble() { if (bubble) { bubble.remove(); bubble = null; } }
    function removePop() { if (pop) { pop.remove(); pop = null; } }

    function showPop(x, y, selectedText, sys, allowRetry) {
      removePop();
      pop = document.createElement('div');
      pop.className = 'gpa-sel-pop';
      pop.textContent = 'Thinking…';
      pop.style.left = Math.max(8, Math.min(x, window.innerWidth - 356)) + 'px';
      pop.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - 280)) + 'px';
      document.body.appendChild(pop);

      function renderResult(out) {
        pop.textContent = stripConfidence(out);
        speak(out);
        const src = document.createElement('span');
        src.className = 'gpa-sel-pop-src';
        src.textContent = selectedText.slice(0, 120) + (selectedText.length > 120 ? '…' : '');
        pop.appendChild(src);
        appendModelBadge(pop);
        if (allowRetry) {
          const retryBtn = document.createElement('button');
          retryBtn.className = 'gpa-sel-pop-retry';
          retryBtn.textContent = '🔄 Try again';
          retryBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            retryBtn.textContent = 'Thinking…';
            retryBtn.disabled = true;
            callAI(
              `Selected text:\n"""\n${selectedText}\n"""\n\nYour previous rewrite was:\n"""\n${out}\n"""\nWrite a different rewrite this time — vary the wording and sentence structure from that previous version while still following the instructions.`,
              sys
            )
              .then((out2) => renderResult(out2))
              .catch((e) => { pop.textContent = 'AI error: ' + (e && e.message || e); });
          });
          pop.appendChild(retryBtn);
        }
      }

      callAI(`Selected text:\n"""\n${selectedText}\n"""`, sys)
        .then((out) => renderResult(out))
        .catch((e) => { pop.textContent = 'AI error: ' + (e && e.message || e); });
      pop.addEventListener('click', removePop);
    }

    // Capture phase, not bubble: some sites (custom highlight tooltips,
    // anti-copy/paywall scripts, rich editors) call stopPropagation() on
    // their own mouseup handler, which would otherwise stop a bubble-phase
    // listener on document from ever seeing the event. A capturing listener
    // on document runs before the event reaches the page's own handlers, so
    // it fires regardless of what they do with it afterward.
    onDoc('mouseup', (e) => {
      if (e.target.closest && (e.target.closest('#gpa-root-host') || e.target.closest('.gpa-sel-bubble') || e.target.closest('.gpa-sel-pop'))) return;
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? String(sel).trim() : '';
        if (!text || text.length < 2 || !sel.rangeCount || sel.isCollapsed) { removeBubble(); return; }
        removeBubble();
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        bubble = document.createElement('div');
        bubble.className = 'gpa-sel-bubble';
        ACTIONS.forEach(([label, sys, retry]) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (sys === null) {
              navigator.clipboard.writeText(text.replace(/\s+/g, ' ').trim()).then(() => {
                b.textContent = '✓ Copied';
                setTimeout(removeBubble, 600);
              });
            } else if (sys === 'save') {
              saveInsight(text);
              removeBubble();
            } else {
              showPop(rect.left, rect.bottom, text, sys + ' Reply in plain text only — no markdown symbols.', retry === true);
            }
          });
          bubble.appendChild(b);
        });
        document.body.appendChild(bubble);
        bubble.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - bubble.offsetWidth - 12)) + 'px';
        bubble.style.top = Math.max(8, rect.top - bubble.offsetHeight - 6) + 'px';
      }, 10);
    }, true);
    onWin('scroll', removeBubble, true);
    onWin('keydown', (e) => { if (e.key === 'Escape') { removeBubble(); removePop(); } });
  })();

  // Standalone Humanize tab: same rewrite as the selection-assistant bubble
  // (shares HUMANIZE_PROMPT above), but works on pasted text from anywhere —
  // doesn't depend on the current page's own JS letting a selection/mouseup
  // event through, which some sites intercept.
  (function humanizeTool() {
    const input = panel.querySelector('#gpa-hum-input');
    const goBtn = panel.querySelector('#gpa-hum-go');
    const retryBtn = panel.querySelector('#gpa-hum-retry');
    const status = panel.querySelector('#gpa-hum-status');
    const out = panel.querySelector('#gpa-hum-out');
    let lastInput = '', lastOutput = '';

    function renderOut(text) {
      out.innerHTML = '';
      const rep = document.createElement('div');
      rep.className = 'gpa-msg ai';
      out.appendChild(rep);
      typeText(rep, text, out, () => {
        appendModelBadge(rep);
        addSaveButton(rep, text);
      });
    }

    async function run(sourceText, isRetry) {
      const btn = isRetry ? retryBtn : goBtn;
      btn.disabled = true;
      status.textContent = isRetry ? 'Rewriting a different way…' : 'Rewriting…';
      try {
        const userText = isRetry
          ? `Text to rewrite:\n"""\n${sourceText}\n"""\n\nYour previous rewrite was:\n"""\n${lastOutput}\n"""\nWrite a different rewrite this time — vary the wording and sentence structure from that previous version while still following the instructions.`
          : `Text to rewrite:\n"""\n${sourceText}\n"""`;
        const sys = HUMANIZE_PROMPT + ' Reply in plain text only — no markdown symbols.';
        const result = await callAI(userText, sys);
        lastInput = sourceText;
        lastOutput = result;
        renderOut(stripConfidence(result));
        retryBtn.style.display = 'inline-block';
        status.textContent = 'Done. Meaning, facts, and length should match the original — check it over before using it.';
      } catch (e) {
        showError(out, e, currentProviderLabel());
        status.textContent = '';
      }
      btn.disabled = false;
    }

    goBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (text.length < 2) { status.textContent = 'Paste some text first.'; return; }
      retryBtn.style.display = 'none';
      run(text, false);
    });
    retryBtn.addEventListener('click', () => { if (lastInput) run(lastInput, true); });
  })();

  // Standalone Grammar tab: same proofread as the selection-assistant bubble
  // (shares GRAMMAR_PROMPT above), but works on pasted text from anywhere,
  // same reasoning as the standalone Humanize tab.
  (function grammarTool() {
    const input = panel.querySelector('#gpa-gram-input');
    const goBtn = panel.querySelector('#gpa-gram-go');
    const status = panel.querySelector('#gpa-gram-status');
    const out = panel.querySelector('#gpa-gram-out');

    goBtn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (text.length < 2) { status.textContent = 'Paste some text first.'; return; }
      goBtn.disabled = true;
      status.textContent = 'Checking…';
      try {
        const sys = GRAMMAR_PROMPT + ' Reply in plain text only — no markdown symbols.';
        const result = await callAI(`Text to proofread:\n"""\n${text}\n"""`, sys);
        out.innerHTML = '';
        const rep = document.createElement('div');
        rep.className = 'gpa-msg ai';
        out.appendChild(rep);
        typeText(rep, stripConfidence(result), out, () => {
          appendModelBadge(rep);
          addSaveButton(rep, result);
        });
        status.textContent = 'Style, tone, and word choice were left alone — only actual errors were touched.';
      } catch (e) {
        showError(out, e, currentProviderLabel());
        status.textContent = '';
      }
      goBtn.disabled = false;
    });
  })();

  // Table extractor: list every table on the page with CSV copy + Ask AI.
  panel.querySelector('#gpa-tables-btn').addEventListener('click', () => {
    const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.rows.length > 1);
    if (!tables.length) { scanOutput.textContent = 'No tables found on this page.'; return; }
    scanOutput.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'gpa-sub';
    head.textContent = `Found ${tables.length} table${tables.length > 1 ? 's' : ''}:`;
    scanOutput.appendChild(head);
    tables.slice(0, 10).forEach((tb, i) => {
      const rows = Array.from(tb.rows).map((tr) => Array.from(tr.cells).map((td) => (td.innerText || '').trim().replace(/\s+/g, ' ')));
      if (!rows[0].length) return;
      const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\n');
      const div = document.createElement('div');
      div.className = 'gpa-msg ai';
      const label = document.createElement('div');
      label.textContent = `Table ${i + 1} — ${rows.length} rows × ${rows[0].length} cols`;
      label.style.fontWeight = '700';
      label.style.marginBottom = '4px';
      div.appendChild(label);
      const row = document.createElement('div');
      row.className = 'gpa-row';
      const cp = document.createElement('button');
      cp.className = 'gpa-btn';
      cp.textContent = '📋 Copy CSV';
      cp.addEventListener('click', () => navigator.clipboard.writeText(csv).then(() => {
        cp.textContent = '✓ Copied';
        setTimeout(() => { cp.textContent = '📋 Copy CSV'; }, 900);
      }));
      const ask = document.createElement('button');
      ask.className = 'gpa-btn primary';
      ask.textContent = '🤖 Ask AI about it';
      ask.addEventListener('click', async () => {
        ask.disabled = true;
        ask.textContent = 'Thinking…';
        try {
          const out = await callAI(`Here is a table as CSV:\n${csv.slice(0, 8000)}\n\nSummarize the key takeaways in a few short plain-text lines.`, 'You are a concise data analyst. Plain text only.');
          const res = document.createElement('div');
          res.className = 'gpa-msg ai';
          res.style.marginTop = '6px';
          div.appendChild(res);
          typeText(res, stripConfidence(out), scanOutput, () => { appendModelBadge(res); addSaveButton(res, stripConfidence(out)); });
        } catch (e) {
          showError(div, e, currentProviderLabel());
        }
        ask.disabled = false;
        ask.textContent = '🤖 Ask AI about it';
      });
      row.appendChild(cp);
      row.appendChild(ask);
      div.appendChild(row);
      scanOutput.appendChild(div);
    });
  });

  // Page watcher: poll the page text every 30s and let the AI judge whether
  // the user's condition has been met. In-memory only (a reload ends it) —
  // the condition is remembered so it's one click to re-arm.
  (function pageWatcher() {
    const watch = { timer: null, last: '', cond: '' };
    const watchBtn = panel.querySelector('#gpa-watch-btn');
    const watchRow = panel.querySelector('#gpa-watch-row');
    const watchCond = panel.querySelector('#gpa-watch-cond');
    watchCond.value = localStorage.getItem('gpa_watch_last_cond') || '';

    function setUi(watching) {
      watchBtn.textContent = watching ? '⏹ Stop watching' : '👀 Watch page';
      watchBtn.classList.toggle('primary', watching);
    }
    function stop(msg) {
      if (watch.timer) { clearInterval(watch.timer); watch.timer = null; }
      setUi(false);
      if (msg) scanOutput.textContent = msg;
    }
    watchBtn.addEventListener('click', () => {
      if (watch.timer) { stop('Stopped watching.'); return; }
      watchRow.style.display = watchRow.style.display === 'none' ? 'flex' : 'none';
    });
    panel.querySelector('#gpa-watch-start').addEventListener('click', () => {
      const cond = watchCond.value.trim();
      if (!cond) { scanOutput.textContent = 'Type what you want to watch for first.'; return; }
      watch.cond = cond;
      watch.last = extractPageText();
      localStorage.setItem('gpa_watch_last_cond', cond);
      if (window.Notification && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) { /* optional */ }
      }
      scanOutput.textContent = `👀 Watching every 30s for: "${cond}". Keep this tab open — reloading the page ends the watch.`;
      setUi(true);
      watch.timer = setInterval(check, 30000);
    });
    async function check() {
      try {
        const now = extractPageText();
        if (now === watch.last) return;
        watch.last = now;
        const sys = 'You are a page-change monitor. Answer with exactly one line: either "YES: <one short sentence>" or just "NO".';
        const out = await callAI(`The user is watching a page for this condition: "${watch.cond}"\n\nCURRENT PAGE TEXT (truncated):\n${now.slice(0, 9000)}\n\nDoes the page now satisfy the condition?`, sys);
        if (/^YES/i.test(out.trim())) {
          const why = out.replace(/^YES:\s*/i, '').trim();
          stop(`🔔 ${why}`);
          speak('Watch triggered. ' + why);
          try { if (window.Notification && Notification.permission === 'granted') new Notification('Agent Console', { body: why }); } catch (e) { /* optional */ }
        }
      } catch (e) { /* transient errors: keep watching */ }
    }
    setUi(false);
  })();

  // Natural-language page commands: AI maps the request to a concrete action.
  panel.querySelector('#gpa-cmd-btn').addEventListener('click', async () => {
    const cmdInput = panel.querySelector('#gpa-cmd-input');
    const cmd = cmdInput.value.trim();
    if (!cmd) return;
    scanOutput.textContent = '⚡ Working out what to do…';
    try {
      const sys = 'You convert user commands into page actions. Available actions: click (an element whose visible text matches), scroll (scroll to the first element containing the text), highlight (mark the text on the page). Respond ONLY with JSON: {"action":"click|scroll|highlight","target":"exact visible text to find"}. If impossible, respond {"action":"none"}.';
      const out = await callAI(`Command: ${cmd}\n\nPage text (truncated):\n${extractPageText().slice(0, 6000)}`, sys);
      const m = out.match(/\{[\s\S]*\}/);
      const plan = m ? JSON.parse(m[0]) : { action: 'none' };
      if (!plan.action || plan.action === 'none' || !plan.target) {
        scanOutput.textContent = "Couldn't map that to a page action — try naming the exact link or button text.";
        return;
      }
      const target = normalizeForMatch(String(plan.target));
      const candidates = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],li,td,th,h1,h2,h3,h4,p,span,div,label')).filter((el) => {
        if (el.closest('#gpa-root-host')) return false;
        const t = normalizeForMatch(el.innerText || el.value || '');
        if (!t || !t.includes(target)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!candidates.length) {
        scanOutput.textContent = `Nothing on the page matches "${plan.target}".`;
        return;
      }
      candidates.sort((a, b) => normalizeForMatch(a.innerText || a.value || '').length - normalizeForMatch(b.innerText || b.value || '').length);
      const el = candidates[0];
      if (plan.action === 'click') {
        const clickLabel = (el.innerText || el.value || '').trim();
        // Risky actions always ask, even with auto-confirm on.
        const RISKY_CLICK_RE = /\b(submit|post|send|delete|remove|purchase|pay|payment|checkout|order|confirm|enroll|register|sign\s?in|sign\s?out|sign\s?up)\b/i;
        const risky = RISKY_CLICK_RE.test(clickLabel);
        const autoOk = localStorage.getItem(AUTOCONFIRM_KEY) === 'on' && !risky;
        if (!autoOk && !confirm(`About to click: "${clickLabel.slice(0, 120)}"${risky ? '\n\n(This looks like a submit/delete/pay-type action, so it always asks first.)' : ''}\n\nProceed?`)) {
          scanOutput.textContent = 'Cancelled — nothing was clicked.';
          return;
        }
        el.click();
        scanOutput.textContent = `⚡ Clicked: ${(el.innerText || el.value || '').trim().slice(0, 80)}`;
      } else if (plan.action === 'highlight') {
        const ok = highlightSnippetOnPage(String(plan.target));
        scanOutput.textContent = ok ? '⚡ Highlighted on the page.' : `Couldn't find "${plan.target}" to highlight.`;
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('gpa-flash-once');
        setTimeout(() => el.classList.remove('gpa-flash-once'), 4000);
        scanOutput.textContent = `⚡ Scrolled to: ${(el.innerText || el.value || '').trim().slice(0, 80)}`;
      }
      cmdInput.value = '';
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  });

  // Flashcards (Study tab): generate a deck from the page, spaced-ish
  // repetition via a simple 3-box ladder — "knew it" moves a card up, three
  // boxes retires it; "again" sends it back to box 1.
  function renderDeck() {
    const fcStudy = panel.querySelector('#gpa-fc-study');
    const fcStatus = panel.querySelector('#gpa-fc-status');
    if (!fcStudy) return;
    const cards = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
    fcStudy.innerHTML = '';
    if (!cards.length) {
      fcStudy.innerHTML = '<div class="gpa-sub">No deck yet. Find a page with material on it, then press "Make flashcards".</div>';
      return;
    }
    const mastered = cards.filter((c) => c.box >= 3).length;
    const head = document.createElement('div');
    head.className = 'gpa-row';
    head.style.justifyContent = 'space-between';
    const prog = document.createElement('span');
    prog.className = 'gpa-sub';
    prog.textContent = `${mastered}/${cards.length} mastered`;
    const ctrls = document.createElement('div');
    const reset = document.createElement('button');
    reset.className = 'gpa-btn';
    reset.textContent = '🔄 Reset progress';
    reset.addEventListener('click', () => {
      const c = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
      c.forEach((x) => { x.box = 1; });
      localStorage.setItem(FC_KEY, JSON.stringify(c));
      renderDeck();
    });
    const del = document.createElement('button');
    del.className = 'gpa-btn';
    del.textContent = '🗑 Delete deck';
    del.addEventListener('click', () => {
      if (confirm('Delete the whole deck?')) { localStorage.removeItem(FC_KEY); renderDeck(); }
    });
    ctrls.appendChild(reset);
    ctrls.appendChild(del);
    head.appendChild(prog);
    head.appendChild(ctrls);
    fcStudy.appendChild(head);

    const due = cards.map((c, i) => ({ c, i })).filter((x) => x.c.box < 3);
    if (!due.length) {
      const done = document.createElement('div');
      done.className = 'gpa-sub';
      done.style.marginTop = '10px';
      done.textContent = '🎉 Deck mastered! Reset progress to study it again.';
      fcStudy.appendChild(done);
      return;
    }
    const pick = due[Math.floor(Math.random() * due.length)];
    const flip = document.createElement('div');
    flip.className = 'gpa-flip';
    flip.innerHTML = `<div class="gpa-flip-inner"><div class="gpa-flip-face">${escapeHtml(pick.c.q)}</div><div class="gpa-flip-face gpa-flip-back">${escapeHtml(pick.c.a)}</div></div>`;
    flip.addEventListener('click', () => flip.classList.toggle('flipped'));
    fcStudy.appendChild(flip);
    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.style.textAlign = 'center';
    hint.style.marginTop = '4px';
    hint.textContent = 'Tap the card to flip it';
    fcStudy.appendChild(hint);
    const row = document.createElement('div');
    row.className = 'gpa-row';
    row.style.marginTop = '6px';
    const again = document.createElement('button');
    again.className = 'gpa-btn';
    again.textContent = '🔁 Again';
    const know = document.createElement('button');
    know.className = 'gpa-btn primary';
    know.textContent = '✓ Knew it';
    function grade(box) {
      const c = JSON.parse(localStorage.getItem(FC_KEY) || '[]');
      c[pick.i].box = box === 3 ? Math.min(3, (c[pick.i].box || 1) + 1) : 1;
      localStorage.setItem(FC_KEY, JSON.stringify(c));
      renderDeck();
    }
    again.addEventListener('click', () => grade(1));
    know.addEventListener('click', () => grade(3));
    row.appendChild(again);
    row.appendChild(know);
    fcStudy.appendChild(row);
  }

  panel.querySelector('#gpa-fc-gen').addEventListener('click', async () => {
    const fcStatus = panel.querySelector('#gpa-fc-status');
    const fcStudy = panel.querySelector('#gpa-fc-study');
    const text = extractPageText().slice(0, 12000);
    if (text.trim().length < 80) { fcStatus.textContent = 'Not enough page text here to build cards — open a page with real content first.'; return; }
    fcStatus.textContent = '✨ Building your deck…';
    try {
      const sys = 'Create flashcards from the provided material. Return ONLY a JSON array of 8-15 objects: [{"q":"question","a":"short answer"}]. Cover the most important facts and concepts. No text outside the JSON array.';
      const out = await callAI(`MATERIAL:\n${text}`, sys);
      const m = out.match(/\[[\s\S]*\]/);
      const cards = JSON.parse(m[0]).map((c) => ({ q: String(c.q), a: String(c.a), box: 1 }));
      localStorage.setItem(FC_KEY, JSON.stringify(cards));
      fcStatus.textContent = `Deck created with ${cards.length} cards. Tap a card to flip it.`;
      renderDeck();
    } catch (e) {
      fcStatus.textContent = '';
      showError(fcStudy, e, currentProviderLabel());
    }
  });

  // Scratchpad (Saved tab): autosaved textarea + AI tidier.
  (function scratchpad() {
    const scratch = panel.querySelector('#gpa-scratch');
    const tidyBtn = panel.querySelector('#gpa-scratch-tidy');
    scratch.value = localStorage.getItem(SCRATCH_KEY) || '';
    let t = null;
    scratch.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => localStorage.setItem(SCRATCH_KEY, scratch.value), 300);
    });
    tidyBtn.addEventListener('click', async () => {
      const raw = scratch.value.trim();
      if (!raw) return;
      tidyBtn.disabled = true;
      tidyBtn.textContent = 'Tidying…';
      try {
        const out = await callAI(`Here are my raw notes. Rewrite them as a clean, organized plain-text list: group related items under short headings, fix typos, remove repetition. Keep every fact — do not invent new ones.\n\nNOTES:\n${raw.slice(0, 8000)}`, 'You are a tidy note-taker. Plain text only, no markdown symbols.');
        if (confirm('Replace your scratchpad with the tidied version?\n\n(OK = replace · Cancel = keep your notes)')) {
          scratch.value = stripConfidence(out);
          localStorage.setItem(SCRATCH_KEY, scratch.value);
        }
      } catch (e) {
        showToast('AI error: ' + (e && e.message || e), { type: 'danger' });
      }
      tidyBtn.disabled = false;
      tidyBtn.textContent = '✨ Tidy notes with AI';
    });
  })();

  // Pomodoro (Saved tab): 25/5 cycles, count persisted to the profile.
  (function pomodoro() {
    let left = 25 * 60, running = null, mode = 'focus';
    let cycles = parseInt(localStorage.getItem('gpa_pomo_cycles') || '0', 10) || 0;
    const timeEl = panel.querySelector('#gpa-pomo-time');
    const startBtn = panel.querySelector('#gpa-pomo-start');
    const countEl = panel.querySelector('#gpa-pomo-count');
    function render() {
      const m = String(Math.floor(left / 60)).padStart(2, '0');
      const s = String(left % 60).padStart(2, '0');
      timeEl.textContent = `${m}:${s}`;
      countEl.textContent = cycles ? `🍅 ${cycles} done` : '';
    }
    function stopTicking() {
      if (running) { clearInterval(running); running = null; }
      startBtn.textContent = '▶ Start';
    }
    function tick() {
      left--;
      if (left <= 0) {
        stopTicking();
        if (mode === 'focus') {
          cycles++;
          localStorage.setItem('gpa_pomo_cycles', String(cycles));
          mode = 'break';
          left = 5 * 60;
          speak('Focus session done. Take a five minute break.');
        } else {
          mode = 'focus';
          left = 25 * 60;
          speak('Break is over. Back to focus.');
        }
      }
      render();
    }
    startBtn.addEventListener('click', () => {
      if (running) { stopTicking(); return; }
      running = setInterval(tick, 1000);
      startBtn.textContent = '⏸ Pause';
    });
    panel.querySelector('#gpa-pomo-reset').addEventListener('click', () => {
      stopTicking();
      mode = 'focus';
      left = 25 * 60;
      render();
    });
    render();
  })();

  // Research mode (Proxy tab): the AI picks 3 authoritative sources, the
  // worker fetches them (pages block browser-side fetches with CORS), and
  // the AI writes a brief with sources. Needs OPENAI_PROXY to be set.
  panel.querySelector('#gpa-research-btn').addEventListener('click', async () => {
    const q = panel.querySelector('#gpa-research-input').value.trim();
    const out = panel.querySelector('#gpa-research-out');
    if (!q) { out.textContent = 'Type a topic or question first.'; return; }
    if (!OPENAI_PROXY) { out.textContent = 'Research mode needs the worker proxy (OPENAI_PROXY) to fetch pages.'; return; }
    out.textContent = '🔎 Planning sources…';
    try {
      const planOut = await callAI(`I need to research: "${q}". Suggest 3 specific, authoritative web page URLs (direct articles or docs, not search result pages) that would contain good information about it. Respond ONLY with a JSON array of 3 URL strings.`, 'You are a research librarian.');
      const urls = JSON.parse(planOut.match(/\[[\s\S]*\]/)[0]).slice(0, 3);
      const srcs = [];
      for (const u of urls) {
        out.textContent = `🔎 Reading ${srcs.length + 1}/${urls.length}: ${u.slice(0, 60)}…`;
        try {
          const r = await rawFetch(`${OPENAI_PROXY}/read?url=${encodeURIComponent(u)}`, {
            headers: currentUser ? { 'X-GPA-User': currentUser } : {}
          });
          if (!r.ok) continue;
          const html = await r.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((el) => el.remove());
          const txt = (doc.body.innerText || '').replace(/\s+\n/g, '\n').trim();
          if (txt.length > 200) srcs.push({ url: u, text: txt.slice(0, 8000) });
        } catch (e) { /* skip unreadable sources */ }
      }
      if (!srcs.length) { out.textContent = 'Could not read any of the suggested sources. Try rephrasing the topic.'; return; }
      out.textContent = '✍️ Writing the report…';
      const sys = 'You write tight research briefs. Plain text with short sections: SUMMARY (2-3 sentences), KEY POINTS (lines starting with "-"), then SOURCES (list the URLs). No markdown symbols.';
      const body = srcs.map((s) => `SOURCE ${s.url}:\n${s.text}`).join('\n\n');
      const report = await callAI(`TOPIC: ${q}\n\n${body.slice(0, 24000)}`, sys);
      const clean = stripConfidence(report);
      out.innerHTML = '';
      const rep = document.createElement('div');
      rep.className = 'gpa-msg ai';
      out.appendChild(rep);
      typeText(rep, clean, out, () => { appendModelBadge(rep); addSaveButton(rep, clean); speak(clean); });
    } catch (e) {
      showError(out, e, currentProviderLabel());
    }
  });

  // ---- Notes maker (Notes tab) ----------------------------------------------
  // Paste a passage → the AI reads it (title included), extracts structure,
  // researches it across the web through the worker, and writes neat
  // organized notes. The passage, notes, research excerpts and follow-up
  // chat are all kept in gpa_notes_state, so follow-up questions have full
  // context until you clear it — and it syncs with your profile.
  const NOTES_KEY = 'gpa_notes_state';
  let notesState = null;
  try { notesState = JSON.parse(localStorage.getItem(NOTES_KEY) || 'null'); } catch (e) { notesState = null; }

  function saveNotesState() {
    if (notesState) localStorage.setItem(NOTES_KEY, JSON.stringify(notesState));
  }

  function notesMsg(role, text) {
    const chat = panel.querySelector('#gpa-notes-chat');
    const div = document.createElement('div');
    div.className = 'gpa-msg ' + role;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function restoreNotesView() {
    if (!notesState || !notesState.notes) return;
    const out = panel.querySelector('#gpa-notes-out');
    const qRow = panel.querySelector('#gpa-notes-q-row');
    const newBtn = panel.querySelector('#gpa-notes-new');
    out.textContent = notesState.notes;
    qRow.style.display = 'flex';
    newBtn.style.display = 'inline-block';
    (notesState.chat || []).forEach((m) => notesMsg(m.role, m.text));
  }
  restoreNotesView();

  panel.querySelector('#gpa-notes-new').addEventListener('click', () => {
    notesState = null;
    localStorage.removeItem(NOTES_KEY);
    panel.querySelector('#gpa-notes-out').innerHTML = '';
    panel.querySelector('#gpa-notes-chat').innerHTML = '';
    panel.querySelector('#gpa-notes-q-row').style.display = 'none';
    panel.querySelector('#gpa-notes-new').style.display = 'none';
    panel.querySelector('#gpa-notes-status').textContent = 'Cleared. Paste a new passage whenever you\'re ready.';
  });

  async function makeNotes() {
    const input = panel.querySelector('#gpa-notes-input');
    const status = panel.querySelector('#gpa-notes-status');
    const out = panel.querySelector('#gpa-notes-out');
    const raw = input.value.trim();
    if (raw.length < 200) { status.textContent = 'Paste a longer passage first — a paragraph or more.'; return; }
    if (!OPENAI_PROXY) { status.textContent = 'Research-backed notes need the worker proxy (OPENAI_PROXY) to be set.'; return; }
    const passage = raw.slice(0, 16000);
    const goBtn = panel.querySelector('#gpa-notes-go');
    goBtn.disabled = true;
    try {
      // Pass 1 — read and structure the passage itself.
      status.textContent = '📖 Reading and analyzing the passage…';
      const sys1 = 'You analyze a passage for note-taking. Return ONLY JSON: {"title":"best title for the passage","summary":"3-4 sentence overview","key_events":["..."],"important_parts":["short verbatim or near-verbatim quotes that matter most"],"key_terms":["term — plain definition"],"research_queries":["3 web search queries that would find reliable background context about the passage\'s subject"]} — key_events ordered as they happen; if the passage has no events, use main points instead. No text outside the JSON.';
      const out1 = await callAI(`PASSAGE:\n${passage}`, sys1);
      const m1 = out1.match(/\{[\s\S]*\}/);
      const info = JSON.parse(m1[0]);

      // Pass 2 — research: AI already suggested queries; pick a page URL per
      // query and read it through the worker (pages block browser fetches).
      status.textContent = '🌐 Researching sources…';
      const research = [];
      const queries = (info.research_queries || []).slice(0, 3);
      for (const qy of queries) {
        try {
          const pick = await callAI(`Suggest ONE specific, authoritative web page URL (direct article, docs or encyclopedia entry — not a search page) that best answers this research need: "${qy}". Respond ONLY with the URL string.`, 'You are a research librarian.');
          const u = pick.trim().replace(/^["'\[\]]+|["'\[\]]+$/g, '');
          if (!/^https?:\/\//i.test(u)) continue;
          status.textContent = `🌐 Reading: ${u.slice(0, 70)}…`;
          const r = await rawFetch(`${OPENAI_PROXY}/read?url=${encodeURIComponent(u)}`, {
            headers: currentUser ? { 'X-GPA-User': currentUser } : {}
          });
          if (!r.ok) continue;
          const html = await r.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((el) => el.remove());
          const txt = (doc.body.innerText || '').replace(/\s+\n/g, '\n').trim();
          if (txt.length > 200) research.push({ url: u, text: txt.slice(0, 6000) });
        } catch (e) { /* skip unreadable sources */ }
      }

      // Pass 3 — write the notes, passage first, research as background.
      status.textContent = research.length ? `✍️ Writing notes (passage + ${research.length} source${research.length > 1 ? 's' : ''})…` : '✍️ Writing notes…';
      const sys2 = 'You write study notes. Plain text only — no markdown symbols (no asterisks, #, or backticks). Use exactly these sections, each heading in CAPS on its own line:\nTITLE:\nOVERVIEW:\nKEY EVENTS:\nIMPORTANT PARTS:\nCONTEXT & BACKGROUND:\nKEY TERMS:\nQUICK FACTS:\nUnder KEY EVENTS use numbered lines. Under the other sections use "- " lines. IMPORTANT PARTS quotes the passage\'s own words where it matters and says briefly why each matters. CONTEXT & BACKGROUND uses the provided research (cite the source URL in parentheses at the end of each line you took from research) and notes where research contradicts or extends the passage. Keep every line tight and factual — notes, not an essay.';
      const researchBody = research.map((s) => `SOURCE ${s.url}:\n${s.text}`).join('\n\n');
      const out2 = await callAI(`PASSAGE:\n${passage}\n\nANALYSIS:\n${JSON.stringify(info)}\n\n${researchBody || 'RESEARCH: none available — base CONTEXT & BACKGROUND only on the passage and say research was unavailable.'}`, sys2);
      const notes = stripConfidence(out2).trim();

      notesState = {
        title: info.title || 'Untitled passage',
        passage,
        notes,
        research,
        chat: [],
        date: new Date().toLocaleString()
      };
      saveNotesState();
      out.innerHTML = '';
      const rep = document.createElement('div');
      rep.className = 'gpa-msg ai';
      out.appendChild(rep);
      typeText(rep, notes, out, () => {
        appendModelBadge(rep);
        addSaveButton(rep, notes);
        const qRow = panel.querySelector('#gpa-notes-q-row');
        qRow.style.display = 'flex';
        panel.querySelector('#gpa-notes-new').style.display = 'inline-block';
        panel.querySelector('#gpa-notes-status').textContent = `Working with: "${notesState.title}" — ask follow-ups below, it has the whole passage in memory.`;
        speak('Notes ready.');
      });
    } catch (e) {
      showError(out, e, currentProviderLabel());
      status.textContent = '';
    }
    goBtn.disabled = false;
  }
  panel.querySelector('#gpa-notes-go').addEventListener('click', makeNotes);
  panel.querySelector('#gpa-notes-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); makeNotes(); }
  });

  // Follow-up questions — the AI answers from the stored passage, notes,
  // research excerpts and recent chat history.
  async function askNotesQuestion() {
    const qInput = panel.querySelector('#gpa-notes-q');
    const chat = panel.querySelector('#gpa-notes-chat');
    const q = qInput.value.trim();
    if (!q || !notesState || !notesState.notes) { if (!notesState) qInput.value = ''; return; }
    notesMsg('user', q);
    qInput.value = '';
    const aiMsg = notesMsg('ai', 'Thinking…');
    const history = (notesState.chat || []).slice(-8)
      .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.text}`)
      .join('\n');
    const researchText = (notesState.research || []).map((s) => `${s.url}:\n${s.text}`).join('\n\n').slice(0, 12000);
    const sys = 'You answer questions about a passage the user is studying. For anything about the passage, rely on the PASSAGE, NOTES, RESEARCH and chat history — quote or paraphrase it accurately; if something is not covered there, say so plainly and answer generally if you can. Otherwise you are a helpful, concise assistant. Plain text only — no markdown symbols. End with a final line "CONFIDENCE: NN" (0-100).';
    const userText = `PASSAGE (titled "${notesState.title}"):\n${notesState.passage}\n\nNOTES ALREADY WRITTEN:\n${notesState.notes}\n\nRESEARCH EXCERPTS:\n${researchText || '(none)'}\n\nRECENT CHAT:\n${history || '(none)'}\n\nNEW QUESTION: ${q}`;
    try {
      const out = await callAI(userText, sys, null, isHardQuestion(q));
      const { text: cleanText, confidence } = extractConfidenceLine(out);
      typeText(aiMsg, cleanText, chat, () => {
        appendConfidenceBadge(aiMsg, confidence);
        appendModelBadge(aiMsg);
        notesState.chat.push({ role: 'user', text: q }, { role: 'ai', text: cleanText });
        if (notesState.chat.length > 24) notesState.chat = notesState.chat.slice(-16);
        saveNotesState();
      });
    } catch (e) {
      showError(aiMsg, e, currentProviderLabel());
    }
  }
  panel.querySelector('#gpa-notes-q-btn').addEventListener('click', askNotesQuestion);
  panel.querySelector('#gpa-notes-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askNotesQuestion();
  });

  // ---- Profiles, save state & cross-device sync -----------------------------
  // HOW THIS WORKS (and what it is not):
  //  * All of this script's settings/progress live in localStorage under
  //    "gpa_" keys. A profile is just a snapshot of every one of those keys.
  //  * Signing in restores that snapshot; signing out / auto-save captures it.
  //  * The PIN separates profiles and stops casual snooping. It is NOT
  //    encryption — the data sits in plain localStorage and this script is
  //    readable by anyone with the URL. Never reuse an important password.
  //  * Cross-device transfer works two ways: a portable "sync code" (a
  //    base64 blob you copy between machines, no server needed), or optional
  //    cloud auto-sync using credentials YOU enter at runtime — deliberately
  //    never hard-coded, so nothing secret ends up in a public repo.
  const PROFILE_PREFIX = 'gpa_profile_';
  const SESSION_KEY = 'gpa_session_user';
  const CLOUD_BIN_KEY = 'gpa_cloud_bin';
  const CLOUD_SECRET_KEY = 'gpa_cloud_key';
  // Keys that identify the session/profiles themselves must never be swept
  // into a profile snapshot, or restoring one would clobber the login system.
  // The admin keys and the usage log are device-global on purpose: they belong
  // to this browser/owner, not to whichever profile happens to be signed in,
  // so restoring a profile must leave them untouched.
  const NON_PROFILE_KEYS = [
    SESSION_KEY, CLOUD_BIN_KEY, CLOUD_SECRET_KEY,
    ADMIN_KEYS.MODEL, ADMIN_KEYS.SMART_MODEL, ADMIN_KEYS.AUTO_UPGRADE,
    ADMIN_KEYS.SYSPREFIX, ADMIN_KEYS.MAXCHARS, ADMIN_KEYS.TEMP,
    ADMIN_KEYS.LOGS, ADMIN_KEYS.TELE_TOKEN, ADMIN_KEYS.TELE_ENDPOINT,
    ADMIN_KEYS.TELE_NOTICE_SEEN, 'gpa_script_src', 'gpa_chat_rooms', 'gpa_ann_seen'
  ];

  const loginOverlay = panel.querySelector('#gpa-login');
  const loginUserInput = panel.querySelector('#gpa-login-user');
  const loginPinInput = panel.querySelector('#gpa-login-pin');
  const loginMsg = panel.querySelector('#gpa-login-msg');
  let currentUser = null;

  // ---- PIN hashing ----------------------------------------------------------
  // A profile's PIN is short and the hash sits in localStorage, so the only
  // thing standing between a copied profile and the PIN is how expensive one
  // guess is. A plain SHA-256 (what this used to do, unsalted) is billions of
  // guesses a second on a GPU and identical across users, so one rainbow table
  // cracks every profile at once. PBKDF2 with a per-profile random salt and a
  // high iteration count makes each guess cost real time and makes every
  // profile its own problem.
  //
  // Records are stored as { v, alg, salt, iter, hash }. Older profiles hold a
  // bare hex string; those still verify, and are rewritten to the new format
  // the moment their owner signs in successfully (see verifyPin).
  const PIN_ITERATIONS = 210000;      // OWASP's PBKDF2-HMAC-SHA256 guidance
  const PIN_ITERATIONS_JS = 20000;    // pure-JS fallback: slower per round
  const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const subtleCrypto = () => (window.crypto && window.crypto.subtle) || null;

  function randomSaltHex() {
    const a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return toHex(a);
  }
  // Compares two hex digests without letting the loop exit early — an early
  // return leaks how many leading characters were right.
  function constantTimeEqualHex(a, b) {
    const x = String(a || ''), y = String(b || '');
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
  }

  async function pbkdf2Hex(pin, saltHex, iterations) {
    const subtle = subtleCrypto();
    const enc = new TextEncoder();
    if (subtle) {
      const keyMaterial = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations },
        keyMaterial, 256
      );
      return toHex(new Uint8Array(bits));
    }
    return jsPbkdf2Hex(pin, saltHex, iterations);
  }

  // Makes a stored record for a fresh PIN.
  async function makePinRecord(user, pin) {
    const salt = randomSaltHex();
    const subtle = subtleCrypto();
    const iter = subtle ? PIN_ITERATIONS : PIN_ITERATIONS_JS;
    const material = `gpa|${user}|${pin}`;
    return {
      v: 2,
      alg: subtle ? 'PBKDF2-SHA256' : 'PBKDF2-SHA256-js',
      salt, iter,
      hash: await pbkdf2Hex(material, salt, iter)
    };
  }

  // Verifies a PIN against either format. `upgrade` is true when the stored
  // record is an old unsalted hash (or a weaker fallback) that should be
  // rewritten now that we have the plaintext PIN in hand.
  async function verifyPin(user, pin, stored) {
    if (stored && typeof stored === 'object' && stored.v === 2) {
      const h = await pbkdf2Hex(`gpa|${user}|${pin}`, stored.salt, stored.iter);
      const ok = constantTimeEqualHex(h, stored.hash);
      // A record written without SubtleCrypto used fewer rounds; once we're in
      // a secure context again, re-stretch it.
      const upgrade = ok && stored.alg === 'PBKDF2-SHA256-js' && !!subtleCrypto();
      return { ok, upgrade };
    }
    // Legacy: bare SHA-256 hex, or the old 32-bit fallback.
    const text = `gpa|${user}|${pin}`;
    let legacy = null;
    const subtle = subtleCrypto();
    if (subtle) {
      try {
        const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
        legacy = toHex(new Uint8Array(buf));
      } catch (e) { /* fall through */ }
    }
    if (legacy === null) {
      let h = 0;
      for (let i = 0; i < text.length; i++) { h = ((h << 5) - h + text.charCodeAt(i)) | 0; }
      legacy = 'fb' + (h >>> 0).toString(16);
    }
    const ok = constantTimeEqualHex(legacy, String(stored || ''));
    return { ok, upgrade: ok };
  }

  // PBKDF2-HMAC-SHA256 in plain JavaScript, for pages served over plain HTTP
  // where SubtleCrypto does not exist. Slower per round than the native one,
  // hence the lower iteration count, but still salted and still thousands of
  // times harder than a single unsalted digest.
  function jsPbkdf2Hex(password, saltHex, iterations) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    function sha256Bytes(bytes) {
      const len = bytes.length;
      const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
      withPad.set(bytes);
      withPad[len] = 0x80;
      const bitLenHi = Math.floor(len / 536870912);
      const bitLen = len * 8;
      const dv = new DataView(withPad.buffer);
      dv.setUint32(withPad.length - 8, bitLenHi, false);
      dv.setUint32(withPad.length - 4, bitLen >>> 0, false);
      const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
      const w = new Uint32Array(64);
      for (let off = 0; off < withPad.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          const ch = (e & f) ^ (~e & g);
          const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (S0 + maj) >>> 0;
          h = g; g = f; f = e; e = (d + t1) >>> 0;
          d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
      }
      const out = new Uint8Array(32);
      const outView = new DataView(out.buffer);
      for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i], false);
      return out;
    }
    function hmacSha256(keyBytes, msgBytes) {
      let key = keyBytes;
      if (key.length > 64) key = sha256Bytes(key);
      const pad = new Uint8Array(64);
      pad.set(key);
      const inner = new Uint8Array(64 + msgBytes.length);
      const outer = new Uint8Array(64 + 32);
      for (let i = 0; i < 64; i++) { inner[i] = pad[i] ^ 0x36; outer[i] = pad[i] ^ 0x5c; }
      inner.set(msgBytes, 64);
      outer.set(sha256Bytes(inner), 64);
      return sha256Bytes(outer);
    }
    const enc = new TextEncoder();
    const pw = enc.encode(password);
    const salt = enc.encode(saltHex);
    // One 32-byte block is all we need, so this is PBKDF2 with dkLen = hLen.
    const block1 = new Uint8Array(salt.length + 4);
    block1.set(salt);
    block1[salt.length + 3] = 1;
    let u = hmacSha256(pw, block1);
    const out = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = hmacSha256(pw, u);
      for (let j = 0; j < out.length; j++) out[j] ^= u[j];
    }
    return toHex(out);
  }

  function profileKey(user) { return PROFILE_PREFIX + user.toLowerCase(); }
  function readProfile(user) {
    try { return JSON.parse(localStorage.getItem(profileKey(user)) || 'null'); }
    catch (e) { return null; }
  }
  function writeProfile(user, profile) {
    localStorage.setItem(profileKey(user), JSON.stringify(profile));
  }

  // Snapshot every gpa_* key except the auth/profile plumbing itself.
  function collectState() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('gpa_')) continue;
      if (k.startsWith(PROFILE_PREFIX)) continue;
      if (NON_PROFILE_KEYS.includes(k)) continue;
      data[k] = localStorage.getItem(k);
    }
    return data;
  }

  function applyState(data) {
    if (!data || typeof data !== 'object') return;
    // Clear existing app keys first so a restored profile doesn't inherit
    // leftovers from whoever was signed in before.
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('gpa_')) continue;
      if (k.startsWith(PROFILE_PREFIX)) continue;
      if (NON_PROFILE_KEYS.includes(k)) continue;
      toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    Object.keys(data).forEach((k) => {
      if (k.startsWith('gpa_') && !k.startsWith(PROFILE_PREFIX) && !NON_PROFILE_KEYS.includes(k)) {
        localStorage.setItem(k, String(data[k]));
      }
    });
  }

  function saveProgress() {
    if (!currentUser) return;
    const profile = readProfile(currentUser);
    if (!profile) return;
    profile.data = collectState();
    profile.updatedAt = Date.now();
    writeProfile(currentUser, profile);
  }

  function showLoginMsg(text, isError) {
    loginMsg.textContent = text;
    loginMsg.classList.toggle('error', !!isError);
  }

  function refreshAccountUI() {
    const who = panel.querySelector('#gpa-account-who');
    if (who) who.textContent = currentUser ? `Signed in as ${currentUser}` : 'Not signed in';
  }

  // Re-applies everything a restored profile affects, so a sign-in takes
  // effect immediately instead of needing a reload.
  function reapplyAllSettings() {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY) || 'matte';
      THEMES.custom = loadCustomTheme();
      appearance = loadAppearance();
      particleFx = loadParticleFx();
      applyTheme(THEMES[savedTheme] ? savedTheme : 'matte', { instant: true });
      if (typeof setSpeedUI === 'function') setSpeedUI(localStorage.getItem(SPEED_KEY) || 'normal');
      if (typeof setFontUI === 'function') setFontUI(localStorage.getItem(FONT_KEY) || 'mono');
      if (typeof setIconUI === 'function') setIconUI(localStorage.getItem(ICON_KEY) || 'dot');
      if (typeof setLookUI === 'function') setLookUI(localStorage.getItem(ICON_LOOK_KEY) || 'minimal');
      if (typeof setColorModeUI === 'function') setColorModeUI(localStorage.getItem(ICON_COLOR_MODE_KEY) || 'page');
      if (typeof renderMiniIcon === 'function') renderMiniIcon();
      if (typeof applyMiniLook === 'function') applyMiniLook();
      if (typeof applyMiniColorMode === 'function') applyMiniColorMode();
      if (typeof setParticleUI === 'function') setParticleUI(localStorage.getItem(PARTICLE_KEY) || 'off');
      if (typeof setParticleStyle === 'function') setParticleStyle(localStorage.getItem(PARTICLE_KEY) || 'off');
      if (typeof setSizeUI === 'function' && typeof applyPanelSize === 'function') {
        const sz = localStorage.getItem(PANEL_SIZE_KEY) || 'full';
        setSizeUI((PANEL_SIZES[sz] || sz === 'full') ? sz : 'full');
        applyPanelSize(sz);
      }
      if (typeof gpsRefreshAll === 'function') gpsRefreshAll();
    } catch (e) { /* a restored-but-odd value shouldn't block sign-in */ }
  }

  // Toggles every "signed out" visual: plain rounded window, no HUD chrome,
  // no particles, neutral minimized button.
  function setLockedChrome(locked) {
    panel.classList.toggle('gpa-locked', locked);
    minimized.classList.toggle('gpa-mini-locked', locked);
    if (locked) {
      minimized.textContent = '';
      particlesSuppressed = true;
      if (typeof setParticleStyle === 'function') setParticleStyle('off', { persist: false });
    } else {
      particlesSuppressed = false;
      if (typeof renderMiniIcon === 'function') renderMiniIcon();
    }
  }

  function enterApp(user) {
    currentUser = user;
    localStorage.setItem(SESSION_KEY, user);
    // Every sign-in, fresh or restored, starts on the default models.
    enforceDefaultModels();
    // Record the open in the local usage log, and mirror it to the shared
    // telemetry bin if the owner turned that on. Wrapped so a logging hiccup
    // can never block a sign-in.
    try { logUsageEvent('open', user); startHeartbeat(); } catch (e) { /* logging is best-effort */ }
    try { if (typeof startChatPolling === 'function') startChatPolling(); } catch (e) { /* chat is best-effort */ }
    loginOverlay.style.display = 'none';
    setLockedChrome(false);
    // Every sign-in — fresh or restored — lands on the Welcome pane first,
    // not whichever pane happened to be marked active in the static HTML.
    if (typeof activateWelcomePane === 'function') activateWelcomePane();
    refreshAccountUI();
    reapplyAllSettings();
    // The restored profile brought its own language with it, so re-translate
    // before asking — an account that already chose never sees the prompt.
    if (typeof applyLanguage === 'function') applyLanguage();
    if (typeof syncLangButtons === 'function') syncLangButtons();
    if (typeof maybePromptLanguage === 'function') maybePromptLanguage(user);
    // Particles were held off until now so the login screen stays plain and
    // doesn't leak the previous user's preference.
    if (typeof setParticleStyle === 'function') {
      setParticleStyle(localStorage.getItem(PARTICLE_KEY) || 'off');
    }
    const cloudBin = panel.querySelector('#gpa-cloud-bin');
    const cloudKey = panel.querySelector('#gpa-cloud-key');
    if (cloudBin) cloudBin.value = localStorage.getItem(CLOUD_BIN_KEY) || '';
    if (cloudKey) cloudKey.value = localStorage.getItem(CLOUD_SECRET_KEY) || '';
  }

  // Login-screen window controls (the panel header is covered while locked).
  panel.querySelector('#gpa-login-min').addEventListener('click', () => setMinimized(true));
  panel.querySelector('#gpa-login-close').addEventListener('click', () => host.remove());

  async function doSignIn() {
    const user = loginUserInput.value.trim();
    const pin = loginPinInput.value;
    if (!user || !pin) { showLoginMsg('Enter both a profile name and a PIN.', true); return; }
    const profile = readProfile(user);
    if (!profile) { showLoginMsg('No profile by that name here. Use Create, or restore a sync code.', true); return; }
    showLoginMsg('Checking…');
    const { ok, upgrade } = await verifyPin(user.toLowerCase(), pin, profile.pinHash);
    if (!ok) { showLoginMsg('Wrong PIN.', true); return; }
    // Re-hash a profile still carrying the old unsalted digest. This is the
    // only moment the plaintext PIN exists, so it is the only chance to do it.
    if (upgrade) {
      try {
        profile.pinHash = await makePinRecord(user.toLowerCase(), pin);
        writeProfile(user, profile);
      } catch (e) { /* signing in matters more than the re-hash */ }
    }
    applyState(profile.data || {});
    showLoginMsg('');
    enterApp(user);
  }

  async function doSignUp() {
    const user = loginUserInput.value.trim();
    const pin = loginPinInput.value;
    if (!user || !pin) { showLoginMsg('Enter both a profile name and a PIN.', true); return; }
    if (readProfile(user)) { showLoginMsg('That profile already exists here — sign in instead.', true); return; }
    if (String(pin).length < 4) { showLoginMsg('Use a PIN of at least 4 characters.', true); return; }
    showLoginMsg('Securing your PIN…');
    const pinHash = await makePinRecord(user.toLowerCase(), pin);
    // A brand-new profile starts from whatever is currently set up, so you
    // don't lose settings you'd already configured before making a profile.
    // The one thing it must not inherit is a previous profile's answer to the
    // language prompt — every new account picks its own.
    localStorage.removeItem(LANG_ASKED_KEY);
    writeProfile(user, { user, pinHash, data: collectState(), updatedAt: Date.now() });
    showLoginMsg('');
    enterApp(user);
  }

  panel.querySelector('#gpa-login-btn').addEventListener('click', doSignIn);
  panel.querySelector('#gpa-signup-btn').addEventListener('click', doSignUp);
  loginPinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSignIn(); });
  loginUserInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPinInput.focus(); });

  // ---- Sync codes (portable, no server involved) ----
  function encodeSyncCode(payload) {
    // encodeURIComponent first so non-ASCII (song names, emoji) survives btoa.
    return btoa(encodeURIComponent(JSON.stringify(payload)));
  }
  function decodeSyncCode(code) {
    return JSON.parse(decodeURIComponent(atob(code.trim())));
  }
  function buildSyncPayload() {
    return { v: 1, user: currentUser || 'export', updatedAt: Date.now(), data: collectState() };
  }

  panel.querySelector('#gpa-login-restore').addEventListener('click', async () => {
    const code = prompt('Paste the sync code copied from your other device:');
    if (!code) return;
    try {
      const payload = decodeSyncCode(code);
      if (!payload || !payload.data) throw new Error('bad payload');
      const user = loginUserInput.value.trim() || payload.user || 'restored';
      const pin = loginPinInput.value;
      // A restored profile used to fall back to the PIN "0000" when the field
      // was left empty, which is no PIN at all for anyone who knows the
      // default. Make the person choose one.
      if (!pin || pin.length < 4) {
        showLoginMsg('Enter the PIN you want this restored profile to use (4+ characters), then press Transfer again.', true);
        loginPinInput.focus();
        return;
      }
      const pinHash = await makePinRecord(user.toLowerCase(), pin);
      applyState(payload.data);
      writeProfile(user, { user, pinHash, data: payload.data, updatedAt: Date.now() });
      showLoginMsg('');
      enterApp(user);
    } catch (e) {
      showLoginMsg("That doesn't look like a valid sync code.", true);
    }
  });

  // Auto-save so progress survives a crash or a closed tab, not just a
  // clean sign-out.
  setInterval(saveProgress, 5000);
  onWin('beforeunload', saveProgress);

  // ---- Games tab -----------------------------------------------------------
  // Game loaders may return either a plain cleanup function (older/simple
  // games) or a controls object: { cleanup, pause, resume, stats }. `stats`
  // returns an array of {label, value} shown in the pause menu, so each game
  // can surface whatever actually matters for it (score, rounds, lives…).
  const gameViewport = panel.querySelector('#gpa-game-viewport');
  const gameFit = panel.querySelector('#gpa-game-fit');

  // Scales the whole game uniformly so it always fits the available stage
  // area — whatever interface size preset is active, and in fullscreen.
  // Scaling the wrapper (rather than each game) keeps every game's internal
  // coordinate math untouched; pointer-based games read the scale back off
  // getBoundingClientRect(), so clicks stay accurate at any zoom.
  function fitGameToStage() {
    if (!gameFit) return;
    gameFit.style.transform = 'none';
    const availW = Math.max(40, gameViewport.clientWidth - 4);
    const availH = Math.max(40, gameViewport.clientHeight - 4);
    const natW = gameFit.scrollWidth;
    const natH = gameFit.scrollHeight;
    if (!natW || !natH) return;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    // Shrink to fit always; only grow when fullscreen (so a small game in a
    // small panel doesn't get blown up into a blurry mess).
    const maxScale = isFs ? 3.2 : 1;
    const scale = Math.min(maxScale, availW / natW, availH / natH);
    gameFit.style.transform = scale < 0.999 || scale > 1.001 ? `scale(${scale})` : 'none';
  }
  // A ResizeObserver reacts the instant the viewport's real size settles —
  // fullscreen transitions, sidebar collapse/expand, and window resizes all
  // land here without guessing how long the browser needs to finish
  // laying out. This is the primary trigger; the setTimeout retries in
  // syncFullscreenLabel() remain as a fallback for browsers where the
  // observer fires a frame late.
  let gameResizeRAF = null;
  const gameResizeObserver = (typeof ResizeObserver !== 'undefined' && gameViewport) ? new ResizeObserver(() => {
    if (gameResizeRAF) return;
    gameResizeRAF = requestAnimationFrame(() => {
      gameResizeRAF = null;
      fitGameToStage();
      if (activeGameControls && typeof activeGameControls.redraw === 'function') {
        try { activeGameControls.redraw(); } catch (e) { /* ignore */ }
      }
    });
  }) : null;
  if (gameResizeObserver) gameResizeObserver.observe(gameViewport);
  const gameBtns = panel.querySelectorAll('.game-btn');
  let activeGameControls = null;
  let gameStartedAt = 0;
  let gamePausedTotal = 0;
  let gamePausedAt = 0;
  let isGamePaused = false;

  // ---- Per-game options -----------------------------------------------------
  // Each game can expose an `options` array; these render as dropdowns in the
  // pause menu and persist under gpa_gameopt_<game>_<key>, so they ride along
  // with profile save/sync like everything else.
  function gameOptKey(game, key) { return `gpa_gameopt_${game}_${key}`; }
  function getGameOpt(game, key, fallback) {
    const v = localStorage.getItem(gameOptKey(game, key));
    return v === null ? fallback : v;
  }
  function setGameOpt(game, key, value) {
    localStorage.setItem(gameOptKey(game, key), String(value));
  }

  function gameBestKey(id) { return `gpa_game_best_${id}`; }
  function getBest(id) { return parseInt(localStorage.getItem(gameBestKey(id)), 10) || 0; }
  function setBestIfHigher(id, score) {
    const best = getBest(id);
    if (score > best) { localStorage.setItem(gameBestKey(id), String(score)); return score; }
    return best;
  }
  function gameElapsedSeconds() {
    if (!gameStartedAt) return 0;
    const end = isGamePaused ? gamePausedAt : Date.now();
    return Math.max(0, Math.floor((end - gameStartedAt - gamePausedTotal) / 1000));
  }
  function formatElapsed(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function stopActiveGame() {
    if (activeGameControls && typeof activeGameControls.cleanup === 'function') {
      try { activeGameControls.cleanup(); } catch (e) { /* ignore cleanup errors */ }
    }
    activeGameControls = null;
  }

  // --- Tic-Tac-Toe (vs a simple heuristic AI) ---
  function initTTT(root) {
    let board = Array(9).fill(null);
    let over = false;
    const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const boardEl = document.createElement('div');
    boardEl.className = 'ttt-board';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'Restart';
    resetBtn.style.marginTop = '4px';

    function checkWinner(b) {
      for (const [a, c, d] of WINS) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
      return b.every(Boolean) ? 'draw' : null;
    }
    function aiMove() {
      const empties = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
      for (const i of empties) { const t = [...board]; t[i] = 'O'; if (checkWinner(t) === 'O') return i; }
      for (const i of empties) { const t = [...board]; t[i] = 'X'; if (checkWinner(t) === 'X') return i; }
      if (board[4] === null) return 4;
      const corners = [0, 2, 6, 8].filter((i) => board[i] === null);
      if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
      return empties[Math.floor(Math.random() * empties.length)];
    }
    function render() {
      boardEl.innerHTML = '';
      board.forEach((v, i) => {
        const cell = document.createElement('div');
        cell.className = 'ttt-cell';
        cell.textContent = v || '';
        if (!v && !over) cell.addEventListener('click', () => play(i));
        boardEl.appendChild(cell);
      });
    }
    function play(i) {
      if (board[i] || over) return;
      board[i] = 'X';
      let w = checkWinner(board);
      if (!w) {
        const ai = aiMove();
        if (ai !== undefined) board[ai] = 'O';
        w = checkWinner(board);
      }
      render();
      if (w) {
        over = true;
        status.textContent = w === 'draw' ? "It's a draw!" : w === 'X' ? 'You win! 🎉' : 'AI wins!';
      } else {
        status.textContent = 'Your move (X)';
      }
    }
    resetBtn.addEventListener('click', () => {
      board = Array(9).fill(null);
      over = false;
      status.textContent = 'Your move (X)';
      render();
    });

    status.textContent = 'Your move (X)';
    root.appendChild(status);
    root.appendChild(boardEl);
    root.appendChild(resetBtn);
    render();

    return {
      stats: () => [
        { label: 'Moves made', value: board.filter(Boolean).length },
        { label: 'Status', value: over ? 'Finished' : 'Your move' }
      ]
    };
  }

  // --- Rock Paper Scissors ---
  function initRPS(root) {
    const choices = { rock: '✊', paper: '✋', scissors: '✌️' };
    let wins = 0, losses = 0, ties = 0;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const scoreEl = document.createElement('div');
    scoreEl.className = 'gpa-sub';
    const row = document.createElement('div');
    row.className = 'rps-row';

    function updateScore() { scoreEl.textContent = `Wins: ${wins}   Losses: ${losses}   Ties: ${ties}`; }
    function play(choice) {
      const keys = Object.keys(choices);
      const ai = keys[Math.floor(Math.random() * keys.length)];
      let result;
      if (choice === ai) { result = 'tie'; ties++; }
      else if (
        (choice === 'rock' && ai === 'scissors') ||
        (choice === 'paper' && ai === 'rock') ||
        (choice === 'scissors' && ai === 'paper')
      ) { result = 'win'; wins++; }
      else { result = 'lose'; losses++; }
      status.textContent = `You: ${choices[choice]}  AI: ${choices[ai]} — ${result === 'tie' ? 'Tie!' : result === 'win' ? 'You win!' : 'AI wins!'}`;
      updateScore();
    }
    Object.keys(choices).forEach((key) => {
      const btn = document.createElement('button');
      btn.className = 'rps-btn';
      btn.textContent = choices[key];
      btn.addEventListener('click', () => play(key));
      row.appendChild(btn);
    });

    status.textContent = 'Pick one!';
    updateScore();
    root.appendChild(status);
    root.appendChild(row);
    root.appendChild(scoreEl);

    return {
      stats: () => [
        { label: 'Wins', value: wins },
        { label: 'Losses', value: losses },
        { label: 'Ties', value: ties }
      ]
    };
  }

  // --- Memory Match ---
  function initMemory(root) {
    const emojis = ['🐱', '🐶', '🦊', '🐼', '🐸', '🦁'];
    let cards = [...emojis, ...emojis].sort(() => Math.random() - 0.5);
    let flipped = [];
    let matched = new Set();
    let moves = 0;
    let lock = false;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'memory-grid';

    function render() {
      grid.innerHTML = '';
      cards.forEach((emoji, i) => {
        const cell = document.createElement('div');
        cell.className = 'memory-card' + (matched.has(i) ? ' matched' : flipped.includes(i) ? ' flipped' : '');
        cell.textContent = matched.has(i) || flipped.includes(i) ? emoji : '❔';
        if (!matched.has(i) && !flipped.includes(i) && !lock) cell.addEventListener('click', () => flip(i));
        grid.appendChild(cell);
      });
    }
    function flip(i) {
      if (flipped.length === 2 || flipped.includes(i)) return;
      flipped.push(i);
      render();
      if (flipped.length === 2) {
        moves++;
        lock = true;
        const [a, b] = flipped;
        if (cards[a] === cards[b]) {
          matched.add(a); matched.add(b);
          flipped = [];
          lock = false;
          status.textContent = matched.size === cards.length ? `You win! Moves: ${moves}` : `Moves: ${moves}`;
          render();
        } else {
          setTimeout(() => { flipped = []; lock = false; status.textContent = `Moves: ${moves}`; render(); }, 700);
        }
      }
    }

    status.textContent = 'Find the pairs!';
    root.appendChild(status);
    root.appendChild(grid);
    render();

    return {
      stats: () => [
        { label: 'Moves', value: moves },
        { label: 'Pairs found', value: `${matched.size / 2} / ${emojis.length}` }
      ]
    };
  }

  // --- Snake (canvas) ---
  function initSnake(root) {
    const size = 13, cell = 16;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = size * cell;
    canvas.height = size * cell;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    // Smooth movement: the snake still thinks in whole grid cells, but
    // rendering interpolates between each segment's previous and current
    // cell every animation frame, so it glides instead of teleporting.
    const SKINS = {
      accent: { name: 'Theme accent', body: () => THEMES[theme].accent, head: '#ffffff' },
      emerald: { name: 'Emerald', body: () => '#22c55e', head: '#d1fae5' },
      cyan: { name: 'Cyan', body: () => '#06b6d4', head: '#cffafe' },
      magenta: { name: 'Magenta', body: () => '#ec4899', head: '#fce7f3' },
      amber: { name: 'Amber', body: () => '#f59e0b', head: '#fef3c7' },
      violet: { name: 'Violet', body: () => '#8b5cf6', head: '#ede9fe' },
      mono: { name: 'Mono', body: () => '#e5e7eb', head: '#ffffff' }
    };
    const SPEEDS = { relaxed: 210, normal: 150, fast: 105, insane: 70 };

    const skinKey = getGameOpt('snake', 'skin', 'accent');
    const skin = SKINS[skinKey] || SKINS.accent;
    const shape = getGameOpt('snake', 'shape', 'rounded');   // rounded | square | circle
    const wrapMode = getGameOpt('snake', 'wrap', 'walls');   // walls | wrap
    const showGrid = getGameOpt('snake', 'grid', 'off') === 'on';
    const trailFade = getGameOpt('snake', 'fade', 'on') === 'on';
    const STEP_MS = SPEEDS[getGameOpt('snake', 'speed', 'normal')] || 150;

    let snake, prevSnake, dir, nextDir, food, score, over, paused = false;
    let raf = null, lastStep = 0;

    function placeFood() {
      do { food = { x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size) }; }
      while (snake.some((s) => s.x === food.x && s.y === food.y));
    }
    function reset() {
      snake = [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }];
      prevSnake = snake.map((s) => ({ ...s }));
      dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
      placeFood();
      score = 0; over = false;
      lastStep = performance.now();
      status.textContent = `Score: 0   Best: ${getBest('snake')}`;
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
    }
    function paintCell(x, y, w, h) {
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === 'square') {
        ctx.fillRect(x, y, w, h);
      } else {
        roundRect(x, y, w, h, 3);
      }
    }
    function draw(progress) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (showGrid) {
        ctx.strokeStyle = THEMES[theme].border;
        ctx.lineWidth = 1;
        for (let i = 1; i < size; i++) {
          ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, canvas.height); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(canvas.width, i * cell); ctx.stroke();
        }
      }
      // Food gets a subtle pulse so the board feels alive between steps.
      const pulse = 1 + Math.sin(performance.now() / 220) * 0.08;
      const fs = (cell - 4) * pulse;
      ctx.fillStyle = '#ff5252';
      paintCell(food.x * cell + (cell - fs) / 2, food.y * cell + (cell - fs) / 2, fs, fs);

      const bodyColor = skin.body();
      for (let i = snake.length - 1; i >= 0; i--) {
        const target = snake[i];
        const source = prevSnake[i] || target;
        // Don't interpolate across a wrap/teleport-sized jump.
        const dx = target.x - source.x, dy = target.y - source.y;
        const jumped = Math.abs(dx) > 1 || Math.abs(dy) > 1;
        const t = over ? 1 : (jumped ? 1 : progress);
        const px = (source.x + dx * t) * cell;
        const py = (source.y + dy * t) * cell;
        ctx.fillStyle = i === 0 ? skin.head : bodyColor;
        ctx.globalAlpha = (i === 0 || !trailFade) ? 1 : Math.max(0.45, 1 - i / (snake.length + 4));
        paintCell(px + 1, py + 1, cell - 2, cell - 2);
      }
      ctx.globalAlpha = 1;
    }
    function step() {
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (wrapMode === 'wrap') {
        // Pass through walls and come out the other side.
        head.x = (head.x + size) % size;
        head.y = (head.y + size) % size;
      }
      const hitWall = wrapMode !== 'wrap' &&
        (head.x < 0 || head.x >= size || head.y < 0 || head.y >= size);
      if (hitWall || snake.some((s) => s.x === head.x && s.y === head.y)) {
        over = true;
        const best = setBestIfHigher('snake', score);
        status.textContent = `Game over! Score: ${score}   Best: ${best}`;
        return;
      }
      prevSnake = snake.map((s) => ({ ...s }));
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score++;
        placeFood();
        status.textContent = `Score: ${score}   Best: ${getBest('snake')}`;
      } else {
        snake.pop();
      }
    }
    function loop(now) {
      if (over || paused) return;
      const elapsed = now - lastStep;
      if (elapsed >= STEP_MS) {
        lastStep = now - (elapsed % STEP_MS);
        step();
      }
      draw(Math.min(1, (now - lastStep) / STEP_MS));
      if (!over) raf = requestAnimationFrame(loop);
    }
    function onKey(e) {
      const map = {
        ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
        w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 }
      };
      const nd = map[e.key];
      if (!nd || paused) return;
      e.preventDefault();
      if (nd.x === -dir.x && nd.y === -dir.y) return;
      nextDir = nd;
    }

    onWin('keydown', onKey);
    reset();
    draw(0);
    raf = requestAnimationFrame(loop);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrow keys or WASD to steer.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); },
      pause: () => { paused = true; cancelAnimationFrame(raf); },
      resume: () => {
        if (over) return;
        paused = false;
        lastStep = performance.now(); // don't let paused time cause a jump
        raf = requestAnimationFrame(loop);
      },
      redraw: () => draw(1),
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Length', value: snake.length },
        { label: 'Mode', value: wrapMode === 'wrap' ? 'Wrap walls' : 'Solid walls' },
        { label: 'Status', value: over ? 'Game over' : 'Alive' }
      ],
      options: () => [
        { key: 'skin', label: 'Color', value: skinKey, restart: true,
          choices: Object.keys(SKINS).map((k) => ({ value: k, label: SKINS[k].name })) },
        { key: 'shape', label: 'Style', value: shape, restart: true,
          choices: [
            { value: 'rounded', label: 'Rounded' },
            { value: 'square', label: 'Blocky' },
            { value: 'circle', label: 'Beads' }
          ] },
        { key: 'speed', label: 'Speed', value: getGameOpt('snake', 'speed', 'normal'), restart: true,
          choices: [
            { value: 'relaxed', label: 'Relaxed' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
            { value: 'insane', label: 'Insane' }
          ] },
        { key: 'wrap', label: 'Walls', value: wrapMode, restart: true,
          choices: [
            { value: 'walls', label: 'Solid' },
            { value: 'wrap', label: 'Wrap around' }
          ] },
        { key: 'grid', label: 'Grid', value: showGrid ? 'on' : 'off', restart: true,
          choices: [{ value: 'off', label: 'Hidden' }, { value: 'on', label: 'Shown' }] },
        { key: 'fade', label: 'Tail fade', value: trailFade ? 'on' : 'off', restart: true,
          choices: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] }
      ]
    };
  }

  // --- 2048 ---
  function init2048(root) {
    const N = 4;
    let grid, score, over, paused = false;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const gridEl = document.createElement('div');
    gridEl.className = 'g2048-grid';

    function emptyGrid() { return Array.from({ length: N }, () => Array(N).fill(0)); }
    function addTile() {
      const empties = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empties.push([r, c]);
      if (!empties.length) return;
      const [r, c] = empties[Math.floor(Math.random() * empties.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }
    function tileColor(v) {
      const colors = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
      return colors[v] || '#3c3a32';
    }
    function render() {
      gridEl.innerHTML = '';
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const cell = document.createElement('div');
        cell.className = 'g2048-cell';
        const v = grid[r][c];
        if (v) { cell.textContent = v; cell.style.background = tileColor(v); cell.style.color = v <= 4 ? '#5c5347' : '#fff'; }
        gridEl.appendChild(cell);
      }
    }
    function slideRow(row) {
      const nums = row.filter((v) => v);
      const merged = [];
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] === nums[i + 1]) { merged.push(nums[i] * 2); score += nums[i] * 2; i++; }
        else merged.push(nums[i]);
      }
      while (merged.length < N) merged.push(0);
      return merged;
    }
    function transpose(g) {
      const res = emptyGrid();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) res[c][r] = g[r][c];
      return res;
    }
    function reverseRows(g) { return g.map((row) => [...row].reverse()); }
    function isGameOver() {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (!grid[r][c]) return false;
        if (c < N - 1 && grid[r][c] === grid[r][c + 1]) return false;
        if (r < N - 1 && grid[r][c] === grid[r + 1][c]) return false;
      }
      return true;
    }
    function move(dir) {
      if (over || paused) return;
      const g = grid.map((row) => [...row]);
      let transformed = g;
      if (dir === 'up' || dir === 'down') transformed = transpose(transformed);
      if (dir === 'right' || dir === 'down') transformed = reverseRows(transformed);
      let result = transformed.map(slideRow);
      if (dir === 'right' || dir === 'down') result = reverseRows(result);
      if (dir === 'up' || dir === 'down') result = transpose(result);

      const moved = JSON.stringify(result) !== JSON.stringify(g);
      if (moved) {
        grid = result;
        addTile();
        render();
        status.textContent = `Score: ${score}   Best: ${getBest('2048')}`;
        if (isGameOver()) {
          over = true;
          const best = setBestIfHigher('2048', score);
          status.textContent = `Game over! Score: ${score}   Best: ${best}`;
        }
      }
    }
    function reset() {
      grid = emptyGrid(); score = 0; over = false;
      addTile(); addTile();
      status.textContent = `Score: 0   Best: ${getBest('2048')}`;
      render();
    }
    function onKey(e) {
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
      if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
    }

    onWin('keydown', onKey);
    reset();

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrow keys or WASD to slide tiles.';
    root.appendChild(status);
    root.appendChild(gridEl);
    root.appendChild(hint);

    return {
      cleanup: () => window.removeEventListener('keydown', onKey),
      pause: () => { paused = true; },
      resume: () => { paused = false; },
      stats: () => {
        const highestTile = Math.max(...grid.flat());
        return [
          { label: 'Score', value: score },
          { label: 'Highest tile', value: highestTile },
          { label: 'Status', value: over ? 'Game over' : 'In play' }
        ];
      }
    };
  }

  // --- Whack-a-Mole ---
  function initWhack(root) {
    const size = 9;
    let score = 0, timeLeft = 20, activeHole = -1, moleTimer = null, countdown = null, over = false;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'whack-grid';
    const holes = [];

    function render() {
      holes.forEach((h, i) => {
        h.classList.toggle('up', i === activeHole);
        h.textContent = i === activeHole ? '🐹' : '';
      });
    }
    for (let i = 0; i < size; i++) {
      const hole = document.createElement('div');
      hole.className = 'whack-hole';
      hole.addEventListener('click', () => {
        if (over || i !== activeHole) return;
        score++;
        activeHole = -1;
        render();
        status.textContent = `Score: ${score}   Time: ${timeLeft}s`;
      });
      holes.push(hole);
      grid.appendChild(hole);
    }
    function popMole() {
      if (over) return;
      activeHole = Math.floor(Math.random() * size);
      render();
      moleTimer = setTimeout(() => { activeHole = -1; render(); if (!over) popMole(); }, 550 + Math.random() * 450);
    }
    function tickCountdown() {
      timeLeft--;
      if (timeLeft <= 0) {
        over = true;
        clearTimeout(moleTimer);
        clearInterval(countdown);
        activeHole = -1; render();
        const best = setBestIfHigher('whack', score);
        status.textContent = `Time's up! Score: ${score}   Best: ${best}`;
      } else {
        status.textContent = `Score: ${score}   Time: ${timeLeft}s`;
      }
    }

    status.textContent = `Score: 0   Time: ${timeLeft}s   Best: ${getBest('whack')}`;
    root.appendChild(status);
    root.appendChild(grid);
    popMole();
    countdown = setInterval(tickCountdown, 1000);

    return {
      cleanup: () => { clearTimeout(moleTimer); clearInterval(countdown); },
      pause: () => { clearTimeout(moleTimer); clearInterval(countdown); moleTimer = null; countdown = null; },
      resume: () => {
        if (over) return;
        if (!moleTimer) popMole();
        if (!countdown) countdown = setInterval(tickCountdown, 1000);
      },
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Time left', value: `${timeLeft}s` },
        { label: 'Status', value: over ? "Time's up" : 'In play' }
      ]
    };
  }

  // --- Guess the Number ---
  function initGuess(root) {
    let target = Math.floor(Math.random() * 100) + 1;
    let tries = 0, over = false;
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = "I'm thinking of a number between 1 and 100.";
    const row = document.createElement('div');
    row.className = 'gpa-row';
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.type = 'number'; input.min = '1'; input.max = '100';
    input.placeholder = 'Your guess…';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn primary';
    btn.textContent = 'Guess';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New number';
    resetBtn.style.marginTop = '6px';

    function guess() {
      if (over) return;
      const val = parseInt(input.value, 10);
      if (isNaN(val)) return;
      tries++;
      if (val === target) {
        over = true;
        const key = 'gpa_game_best_guess_tries';
        const prevBest = parseInt(localStorage.getItem(key), 10);
        const newBest = isNaN(prevBest) || tries < prevBest ? tries : prevBest;
        localStorage.setItem(key, String(newBest));
        status.textContent = `🎉 Correct! It was ${target}. Tries: ${tries}   Best: ${newBest}`;
      } else if (val < target) {
        status.textContent = `Higher than ${val}. Try again. (Tries: ${tries})`;
      } else {
        status.textContent = `Lower than ${val}. Try again. (Tries: ${tries})`;
      }
      input.value = '';
      input.focus();
    }
    btn.addEventListener('click', guess);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') guess(); });
    resetBtn.addEventListener('click', () => {
      target = Math.floor(Math.random() * 100) + 1;
      tries = 0; over = false;
      status.textContent = 'New number picked — guess away!';
    });

    row.appendChild(input);
    row.appendChild(btn);
    status.textContent = 'Make your first guess!';
    root.appendChild(hint);
    root.appendChild(status);
    root.appendChild(row);
    root.appendChild(resetBtn);

    return {
      stats: () => {
        const bestTries = parseInt(localStorage.getItem('gpa_game_best_guess_tries'), 10);
        return [
          { label: 'Tries this round', value: tries },
          { label: 'Fewest ever', value: isNaN(bestTries) ? '—' : bestTries },
          { label: 'Status', value: over ? 'Solved' : 'Guessing' }
        ];
      }
    };
  }

  // --- Hangman ---
  function initHangman(root) {
    const words = ['JAVASCRIPT', 'PYTHON', 'KEYBOARD', 'BROWSER', 'ROBOT', 'PUZZLE', 'GALAXY', 'WIZARD', 'PENGUIN', 'CANDLE'];
    const maxWrong = 6;
    let word, guessedLetters, wrongCount, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const wordEl = document.createElement('div');
    wordEl.className = 'hangman-word';
    const lettersEl = document.createElement('div');
    lettersEl.className = 'hangman-letters';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New word';
    resetBtn.style.marginTop = '6px';

    function renderWord() {
      wordEl.textContent = word.split('').map((l) => (guessedLetters.has(l) ? l : '_')).join(' ');
    }
    function renderLetters() {
      lettersEl.innerHTML = '';
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l) => {
        const b = document.createElement('button');
        b.className = 'hangman-letter';
        b.textContent = l;
        b.disabled = guessedLetters.has(l) || over;
        b.addEventListener('click', () => guessLetter(l));
        lettersEl.appendChild(b);
      });
    }
    function guessLetter(l) {
      if (over || guessedLetters.has(l)) return;
      guessedLetters.add(l);
      if (!word.includes(l)) wrongCount++;
      renderWord();
      if (word.split('').every((ch) => guessedLetters.has(ch))) {
        over = true;
        status.textContent = '🎉 You saved the day! You win!';
      } else if (wrongCount >= maxWrong) {
        over = true;
        status.textContent = `💀 Out of guesses! The word was ${word}.`;
      } else {
        status.textContent = `Guesses left: ${maxWrong - wrongCount}`;
      }
      renderLetters();
    }
    function reset() {
      word = words[Math.floor(Math.random() * words.length)];
      guessedLetters = new Set();
      wrongCount = 0; over = false;
      status.textContent = `Guesses left: ${maxWrong}`;
      renderWord();
      renderLetters();
    }

    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(wordEl);
    root.appendChild(lettersEl);
    root.appendChild(resetBtn);

    return {
      stats: () => [
        { label: 'Guesses left', value: maxWrong - wrongCount },
        { label: 'Letters tried', value: guessedLetters.size },
        { label: 'Status', value: over ? 'Finished' : 'In play' }
      ]
    };
  }

  // --- Wordle ---
  function initWordle(root) {
    const WORDS = ['REACT', 'BRAVE', 'STONE', 'PLANE', 'GRAPE', 'SHINE', 'CLOUD', 'FLAME', 'TRAIN', 'SWEET', 'BLEND', 'CRISP', 'FLUTE', 'GLOBE', 'HOUSE', 'JUICE', 'KNIFE', 'LEMON', 'MONEY', 'NURSE'];
    const target = WORDS[Math.floor(Math.random() * WORDS.length)];
    let guesses = [];
    let over = false;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'wordle-grid';
    const row = document.createElement('div');
    row.className = 'gpa-row';
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.maxLength = 5;
    input.placeholder = '5-letter word…';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn primary';
    btn.textContent = 'Guess';

    function evaluate(guess) {
      const result = Array(5).fill('absent');
      const targetArr = target.split('');
      const guessArr = guess.split('');
      const counts = {};
      targetArr.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
      for (let i = 0; i < 5; i++) {
        if (guessArr[i] === targetArr[i]) { result[i] = 'correct'; counts[guessArr[i]]--; }
      }
      for (let i = 0; i < 5; i++) {
        if (result[i] === 'correct') continue;
        if (counts[guessArr[i]] > 0) { result[i] = 'present'; counts[guessArr[i]]--; }
      }
      return result;
    }
    function render() {
      grid.innerHTML = '';
      for (let r = 0; r < 6; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'wordle-row';
        const g = guesses[r];
        for (let c = 0; c < 5; c++) {
          const tile = document.createElement('div');
          tile.className = 'wordle-tile';
          if (g) { tile.textContent = g.word[c]; tile.classList.add(g.result[c]); }
          rowEl.appendChild(tile);
        }
        grid.appendChild(rowEl);
      }
    }
    function submitGuess() {
      if (over) return;
      const val = input.value.trim().toUpperCase();
      if (val.length !== 5) { status.textContent = 'Enter a 5-letter word.'; return; }
      const result = evaluate(val);
      guesses.push({ word: val, result });
      input.value = '';
      render();
      if (val === target) { over = true; status.textContent = `🎉 Solved in ${guesses.length}/6!`; }
      else if (guesses.length >= 6) { over = true; status.textContent = `Out of guesses! The word was ${target}.`; }
      else { status.textContent = `${6 - guesses.length} guesses left.`; }
    }
    btn.addEventListener('click', submitGuess);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });

    status.textContent = 'Guess the 5-letter word! Green = right spot, yellow = wrong spot.';
    row.appendChild(input);
    row.appendChild(btn);
    root.appendChild(status);
    root.appendChild(grid);
    root.appendChild(row);
    render();

    return {
      stats: () => [
        { label: 'Guesses used', value: `${guesses.length} / 6` },
        { label: 'Status', value: over ? 'Finished' : 'In play' }
      ]
    };
  }

  // --- Connect Four (vs a simple AI) ---
  function initConnect4(root) {
    const COLS = 7, ROWS = 6;
    let board, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const boardEl = document.createElement('div');
    boardEl.className = 'c4-board';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'Restart';
    resetBtn.style.marginTop = '6px';

    function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
    function lowestEmptyRow(b, col) {
      for (let r = ROWS - 1; r >= 0; r--) if (!b[r][col]) return r;
      return -1;
    }
    function checkWin(b, player) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (b[r][c] !== player) continue;
        if (c + 3 < COLS && b[r][c + 1] === player && b[r][c + 2] === player && b[r][c + 3] === player) return true;
        if (r + 3 < ROWS && b[r + 1][c] === player && b[r + 2][c] === player && b[r + 3][c] === player) return true;
        if (r + 3 < ROWS && c + 3 < COLS && b[r + 1][c + 1] === player && b[r + 2][c + 2] === player && b[r + 3][c + 3] === player) return true;
        if (r - 3 >= 0 && c + 3 < COLS && b[r - 1][c + 1] === player && b[r - 2][c + 2] === player && b[r - 3][c + 3] === player) return true;
      }
      return false;
    }
    function isFull(b) { return b.every((row) => row.every((cell) => cell)); }
    function aiMove() {
      const validCols = [];
      for (let c = 0; c < COLS; c++) if (lowestEmptyRow(board, c) !== -1) validCols.push(c);
      for (const c of validCols) { const r = lowestEmptyRow(board, c); const t = board.map((row) => [...row]); t[r][c] = 'Y'; if (checkWin(t, 'Y')) return c; }
      for (const c of validCols) { const r = lowestEmptyRow(board, c); const t = board.map((row) => [...row]); t[r][c] = 'R'; if (checkWin(t, 'R')) return c; }
      const centerOrder = [3, 2, 4, 1, 5, 0, 6].filter((c) => validCols.includes(c));
      return centerOrder[0];
    }
    function render() {
      boardEl.innerHTML = '';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'c4-cell';
        if (board[r][c] === 'R') cell.classList.add('c4-red');
        if (board[r][c] === 'Y') cell.classList.add('c4-yellow');
        cell.addEventListener('click', () => drop(c));
        boardEl.appendChild(cell);
      }
    }
    function drop(col) {
      if (over) return;
      const r = lowestEmptyRow(board, col);
      if (r === -1) return;
      board[r][col] = 'R';
      if (checkWin(board, 'R')) { over = true; render(); status.textContent = '🎉 You win!'; return; }
      if (isFull(board)) { over = true; render(); status.textContent = "It's a draw!"; return; }
      render();
      setTimeout(() => {
        const aiCol = aiMove();
        if (aiCol === undefined) return;
        const ar = lowestEmptyRow(board, aiCol);
        board[ar][aiCol] = 'Y';
        if (checkWin(board, 'Y')) { over = true; render(); status.textContent = 'AI wins!'; return; }
        if (isFull(board)) { over = true; render(); status.textContent = "It's a draw!"; return; }
        render();
      }, 300);
    }
    function reset() {
      board = emptyBoard(); over = false;
      status.textContent = 'Your turn (Red) — click a column';
      render();
    }
    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(boardEl);
    root.appendChild(resetBtn);

    return {
      stats: () => {
        let pieces = 0;
        board.forEach((row) => row.forEach((cell) => { if (cell) pieces++; }));
        return [
          { label: 'Pieces played', value: pieces },
          { label: 'Turn', value: over ? 'Finished' : (turn === 'red' ? 'Yours' : 'AI') }
        ];
      }
    };
  }

  // --- Minesweeper ---
  function initMinesweeper(root) {
    const MINE_DIFF = { easy: 8, normal: 10, hard: 14, brutal: 18 };
    const mineDiff = getGameOpt('minesweeper', 'difficulty', 'normal');
    const SIZE = 8, MINES = MINE_DIFF[mineDiff] || 10;
    let board, revealed, flagged, over, firstClick;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'mine-grid';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New game';
    resetBtn.style.marginTop = '6px';

    function idx(r, c) { return r * SIZE + c; }
    function neighbors(r, c) {
      const res = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) res.push([nr, nc]);
      }
      return res;
    }
    function setup(avoidR, avoidC) {
      board = Array(SIZE * SIZE).fill(0);
      let placed = 0;
      while (placed < MINES) {
        const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
        if ((r === avoidR && c === avoidC) || board[idx(r, c)] === -1) continue;
        board[idx(r, c)] = -1;
        placed++;
      }
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (board[idx(r, c)] === -1) continue;
        let count = 0;
        neighbors(r, c).forEach(([nr, nc]) => { if (board[idx(nr, nc)] === -1) count++; });
        board[idx(r, c)] = count;
      }
    }
    function floodReveal(r, c) {
      const stack = [[r, c]];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        const i = idx(cr, cc);
        if (revealed[i] || flagged[i]) continue;
        revealed[i] = true;
        if (board[i] === 0) neighbors(cr, cc).forEach(([nr, nc]) => { if (!revealed[idx(nr, nc)]) stack.push([nr, nc]); });
      }
    }
    function render() {
      grid.innerHTML = '';
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const i = idx(r, c);
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        if (flagged[i] && !revealed[i]) cell.textContent = '🚩';
        else if (revealed[i]) {
          cell.classList.add('revealed');
          if (board[i] === -1) { cell.textContent = '💣'; cell.classList.add('mine'); }
          else if (board[i] > 0) { cell.textContent = board[i]; cell.classList.add('n' + board[i]); }
        }
        cell.addEventListener('click', () => reveal(r, c));
        cell.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleFlag(r, c); });
        grid.appendChild(cell);
      }
    }
    function reveal(r, c) {
      if (over) return;
      const i = idx(r, c);
      if (flagged[i] || revealed[i]) return;
      if (firstClick) { setup(r, c); firstClick = false; }
      if (board[i] === -1) {
        over = true;
        for (let k = 0; k < board.length; k++) if (board[k] === -1) revealed[k] = true;
        render();
        status.textContent = '💥 Boom! Game over.';
        return;
      }
      floodReveal(r, c);
      render();
      checkWin();
    }
    function toggleFlag(r, c) {
      if (over) return;
      const i = idx(r, c);
      if (revealed[i]) return;
      flagged[i] = !flagged[i];
      render();
    }
    function checkWin() {
      const safeCells = SIZE * SIZE - MINES;
      const revealedCount = revealed.filter(Boolean).length;
      if (revealedCount === safeCells) { over = true; status.textContent = '🎉 You cleared the field!'; }
      else status.textContent = `Mines: ${MINES}   Flags: ${flagged.filter(Boolean).length}`;
    }
    function reset() {
      board = Array(SIZE * SIZE).fill(0);
      revealed = Array(SIZE * SIZE).fill(false);
      flagged = Array(SIZE * SIZE).fill(false);
      over = false; firstClick = true;
      status.textContent = `Mines: ${MINES}   Left-click reveal, right-click flag`;
      render();
    }
    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(grid);
    root.appendChild(resetBtn);

    return {
      stats: () => [
        { label: 'Revealed', value: `${revealed.filter(Boolean).length} / ${SIZE * SIZE - MINES}` },
        { label: 'Flags placed', value: flagged.filter(Boolean).length },
        { label: 'Mines', value: MINES },
        { label: 'Status', value: over ? 'Finished' : 'In play' }
      ],
      options: () => [
        { key: 'difficulty', label: 'Mine count', value: mineDiff, restart: true,
          choices: [
            { value: 'easy', label: 'Easy (8)' },
            { value: 'normal', label: 'Normal (10)' },
            { value: 'hard', label: 'Hard (14)' },
            { value: 'brutal', label: 'Brutal (18)' }
          ] }
      ]
    };
  }

  // --- Simon ---
  function initSimon(root) {
    const colors = ['red', 'blue', 'green', 'yellow'];
    let sequence = [], playerIndex = 0, over = true, accepting = false;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const pad = document.createElement('div');
    pad.className = 'simon-pad';
    const startBtn = document.createElement('button');
    startBtn.className = 'gpa-btn primary';
    startBtn.textContent = 'Start';
    startBtn.style.marginTop = '6px';

    const btns = {};
    colors.forEach((color) => {
      const b = document.createElement('div');
      b.className = `simon-btn simon-${color}`;
      b.addEventListener('click', () => handleClick(color));
      btns[color] = b;
      pad.appendChild(b);
    });

    function flash(color, duration = 350) {
      return new Promise((resolve) => {
        btns[color].classList.add('active');
        setTimeout(() => { btns[color].classList.remove('active'); resolve(); }, duration);
      });
    }
    async function playSequence() {
      accepting = false;
      status.textContent = `Watch closely… (Round ${sequence.length})`;
      await new Promise((r) => setTimeout(r, 400));
      for (const color of sequence) {
        await flash(color);
        await new Promise((r) => setTimeout(r, 150));
      }
      accepting = true;
      playerIndex = 0;
      status.textContent = 'Your turn — repeat the sequence!';
    }
    function nextRound() {
      sequence.push(colors[Math.floor(Math.random() * 4)]);
      playSequence();
    }
    function handleClick(color) {
      if (!accepting || over) return;
      flash(color, 200);
      if (color === sequence[playerIndex]) {
        playerIndex++;
        if (playerIndex === sequence.length) { accepting = false; setTimeout(nextRound, 600); }
      } else {
        over = true; accepting = false;
        const best = setBestIfHigher('simon', sequence.length - 1);
        status.textContent = `Game over! You reached round ${sequence.length}. Best: ${best}`;
      }
    }
    startBtn.addEventListener('click', () => { sequence = []; over = false; nextRound(); });

    status.textContent = `Best: ${getBest('simon')} — press Start`;
    root.appendChild(status);
    root.appendChild(pad);
    root.appendChild(startBtn);

    return {
      // Pausing mid-sequence would desync the playback, so it just stops
      // accepting input; resuming replays the current sequence from the top.
      pause: () => { accepting = false; },
      resume: () => { if (!over && sequence.length) playSequence(); },
      stats: () => [
        { label: 'Round', value: sequence.length || '—' },
        { label: 'Status', value: over ? 'Game over' : (sequence.length ? 'In play' : 'Not started') }
      ]
    };
  }

  // --- Breakout ---
  function initBreakout(root) {
    const W = 220, H = 260;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    const PADDLE_W = { wide: 60, normal: 44, narrow: 30 };
    const breakoutPaddle = getGameOpt('breakout', 'paddle', 'normal');
    const paddleW = PADDLE_W[breakoutPaddle] || 44, paddleH = 6;
    let paddleX = W / 2 - paddleW / 2;
    let ballX, ballY, ballVX, ballVY, bricks, lives, score, over, raf, paused = false;
    const rows = 4, cols = 7, brickW = W / cols, brickH = 10, brickTop = 20;

    function resetBall() { ballX = W / 2; ballY = H - 30; ballVX = 1.6 * (Math.random() < 0.5 ? -1 : 1); ballVY = -2; }
    function reset() {
      bricks = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) bricks.push({ r, c, alive: true });
      lives = 3; score = 0; over = false;
      paddleX = W / 2 - paddleW / 2;
      resetBall();
      status.textContent = `Lives: ${lives}   Score: ${score}`;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      bricks.forEach((b) => {
        if (!b.alive) return;
        ctx.fillStyle = ['#e5453a', '#f5c518', '#4da3ff', '#22c55e'][b.r % 4];
        ctx.fillRect(b.c * brickW + 1, brickTop + b.r * brickH + 1, brickW - 2, brickH - 2);
      });
      ctx.fillStyle = THEMES[theme].accent;
      ctx.fillRect(paddleX, H - 12, paddleW, paddleH);
      ctx.beginPath();
      ctx.arc(ballX, ballY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    function step() {
      if (over || paused) return;
      ballX += ballVX; ballY += ballVY;
      if (ballX < 4 || ballX > W - 4) ballVX *= -1;
      if (ballY < 4) ballVY *= -1;
      if (ballY > H - 16 && ballY < H - 8 && ballX > paddleX && ballX < paddleX + paddleW) {
        ballVY = -Math.abs(ballVY);
        const hitPos = (ballX - (paddleX + paddleW / 2)) / (paddleW / 2);
        ballVX = hitPos * 3;
      }
      if (ballY > H) {
        lives--;
        if (lives <= 0) {
          over = true;
          const best = setBestIfHigher('breakout', score);
          status.textContent = `Game over! Score: ${score}   Best: ${best}`;
        } else {
          resetBall();
          status.textContent = `Lives: ${lives}   Score: ${score}`;
        }
      }
      const bcol = Math.floor(ballX / brickW);
      const brow = Math.floor((ballY - brickTop) / brickH);
      if (brow >= 0 && brow < rows && bcol >= 0 && bcol < cols) {
        const brick = bricks.find((b) => b.r === brow && b.c === bcol && b.alive);
        if (brick) {
          brick.alive = false;
          ballVY *= -1;
          score += 10;
          status.textContent = `Lives: ${lives}   Score: ${score}`;
          if (bricks.every((b) => !b.alive)) {
            over = true;
            const best = setBestIfHigher('breakout', score);
            status.textContent = `🎉 Cleared! Score: ${score}   Best: ${best}`;
          }
        }
      }
      draw();
      if (!over) raf = requestAnimationFrame(step);
    }
    function onMove(e) {
      const rect = canvas.getBoundingClientRect();
      // rect.width reflects any CSS scaling applied by fitGameToStage(), so
      // divide it back out to get true canvas coordinates.
      const scale = rect.width / W || 1;
      const x = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / scale;
      paddleX = Math.max(0, Math.min(W - paddleW, x - paddleW / 2));
    }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('touchmove', onMove, { passive: true });

    reset();
    draw();
    raf = requestAnimationFrame(step);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Move your mouse over the canvas to steer the paddle.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('touchmove', onMove); },
      pause: () => { cancelAnimationFrame(raf); paused = true; },
      resume: () => { paused = false; if (!over) raf = requestAnimationFrame(step); },
      redraw: draw,
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Lives', value: lives },
        { label: 'Bricks left', value: bricks.filter((b) => b.alive).length }
      ],
      options: () => [
        { key: 'paddle', label: 'Paddle size', value: breakoutPaddle, restart: true,
          choices: [
            { value: 'wide', label: 'Wide' },
            { value: 'normal', label: 'Normal' },
            { value: 'narrow', label: 'Narrow' }
          ] }
      ]
    };
  }

  // --- Flappy ---
  function initFlappy(root) {
    const W = 220, H = 260;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    let birdY, birdV, pipes, score, over, started, raf, paused = false;
    // Tuned to be actually playable: gentler gravity, a softer flap, a wider
    // gap, and a terminal-velocity cap so the bird never plummets faster
    // than you can react to.
    const FLAPPY_DIFF = {
      easy:   { gravity: 0.13, flapV: -3.7, pipeGap: 112, pipeSpeed: 1.05 },
      normal: { gravity: 0.16, flapV: -4.0, pipeGap: 96,  pipeSpeed: 1.25 },
      hard:   { gravity: 0.20, flapV: -4.4, pipeGap: 82,  pipeSpeed: 1.6 }
    };
    const flappyDiff = getGameOpt('flappy', 'difficulty', 'normal');
    const fd = FLAPPY_DIFF[flappyDiff] || FLAPPY_DIFF.normal;
    const flappyBird = getGameOpt('flappy', 'bird', 'white');
    const BIRD_COLORS = { white: '#ffffff', gold: '#f5c518', mint: '#34d399', rose: '#fb7185' };
    const gravity = fd.gravity, flapV = fd.flapV, pipeGap = fd.pipeGap, pipeW = 30, pipeSpeed = fd.pipeSpeed;
    const maxFallV = 4.0;

    function spawnPipe() {
      const gapY = 40 + Math.random() * (H - 80 - pipeGap);
      pipes.push({ x: W, gapY, passed: false });
    }
    // The bird just hovers in place with no gravity and no pipes until the
    // first click — that first click both starts the game AND does the
    // first flap, so you're never falling before you've even had a chance
    // to react.
    function reset() {
      birdY = H / 2; birdV = 0; pipes = []; score = 0; over = false; started = false;
      status.textContent = `Click the canvas to start — Best: ${getBest('flappy')}`;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEMES[theme].accent;
      pipes.forEach((p) => {
        ctx.fillRect(p.x, 0, pipeW, p.gapY);
        ctx.fillRect(p.x, p.gapY + pipeGap, pipeW, H - (p.gapY + pipeGap));
      });
      ctx.fillStyle = BIRD_COLORS[flappyBird] || '#ffffff';
      ctx.beginPath();
      ctx.arc(40, birdY, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    function endGame() {
      over = true;
      const best = setBestIfHigher('flappy', score);
      status.textContent = `Game over! Score: ${score}   Best: ${best}   (click to retry)`;
    }
    function step() {
      if (over || !started || paused) return;
      birdV += gravity;
      if (birdV > maxFallV) birdV = maxFallV;
      birdY += birdV;
      pipes.forEach((p) => { p.x -= pipeSpeed; });
      if (pipes.length && pipes[0].x < -pipeW) pipes.shift();
      if (pipes.length && pipes[pipes.length - 1].x < W - 130) spawnPipe();
      pipes.forEach((p) => {
        if (!p.passed && p.x + pipeW < 40) { p.passed = true; score++; status.textContent = `Score: ${score}   Best: ${getBest('flappy')}`; }
        const inX = 40 + 6 > p.x && 40 - 6 < p.x + pipeW;
        if (inX && (birdY - 6 < p.gapY || birdY + 6 > p.gapY + pipeGap)) endGame();
      });
      if (birdY - 6 < 0 || birdY + 6 > H) endGame();
      draw();
      if (!over) raf = requestAnimationFrame(step);
    }
    function flap() {
      if (over) { reset(); draw(); return; }
      if (!started) {
        started = true;
        spawnPipe();
        raf = requestAnimationFrame(step);
      }
      birdV = flapV;
    }

    canvas.addEventListener('click', flap);
    reset();
    draw();

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Click the canvas to flap. First click starts the game.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); canvas.removeEventListener('click', flap); },
      pause: () => { cancelAnimationFrame(raf); paused = true; },
      resume: () => { paused = false; if (!over && started) raf = requestAnimationFrame(step); },
      redraw: draw,
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Pipes passed', value: pipes.filter((p) => p.passed).length },
        { label: 'Difficulty', value: flappyDiff },
        { label: 'Status', value: over ? 'Game over' : (started ? 'Flying' : 'Not started') }
      ],
      options: () => [
        { key: 'difficulty', label: 'Difficulty', value: flappyDiff, restart: true,
          choices: [
            { value: 'easy', label: 'Easy' },
            { value: 'normal', label: 'Normal' },
            { value: 'hard', label: 'Hard' }
          ] },
        { key: 'bird', label: 'Bird color', value: flappyBird, restart: true,
          choices: [
            { value: 'white', label: 'White' },
            { value: 'gold', label: 'Gold' },
            { value: 'mint', label: 'Mint' },
            { value: 'rose', label: 'Rose' }
          ] }
      ]
    };
  }

  // --- Word Scramble ---
  function initScramble(root) {
    const words = ['PLANET', 'GUITAR', 'WHISPER', 'JUNGLE', 'PYTHON', 'CANDLE', 'GALAXY', 'MARBLE', 'SILVER', 'WINTER'];
    let word, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const scrambledEl = document.createElement('div');
    scrambledEl.className = 'hangman-word';
    const row = document.createElement('div');
    row.className = 'gpa-row';
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.placeholder = 'Unscramble it…';
    const btn = document.createElement('button');
    btn.className = 'gpa-btn primary';
    btn.textContent = 'Submit';
    const row2 = document.createElement('div');
    row2.className = 'gpa-row';
    row2.style.marginTop = '6px';
    const hintBtn = document.createElement('button');
    hintBtn.className = 'gpa-btn';
    hintBtn.textContent = 'Hint';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'gpa-btn';
    nextBtn.textContent = 'New word';

    function scramble(w) {
      const arr = w.split('');
      let attempt;
      do { attempt = [...arr].sort(() => Math.random() - 0.5).join(''); } while (attempt === w);
      return attempt;
    }
    function reset() {
      word = words[Math.floor(Math.random() * words.length)];
      over = false;
      scrambledEl.textContent = scramble(word);
      status.textContent = 'Unscramble the word!';
      input.value = '';
    }
    function submit() {
      if (over) return;
      if (input.value.trim().toUpperCase() === word) { over = true; status.textContent = '🎉 Correct!'; }
      else status.textContent = 'Not quite — try again.';
    }
    hintBtn.addEventListener('click', () => { if (!over) status.textContent = `Hint: starts with "${word[0]}"`; });
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    nextBtn.addEventListener('click', reset);

    reset();
    row.appendChild(input);
    row.appendChild(btn);
    row2.appendChild(hintBtn);
    row2.appendChild(nextBtn);
    root.appendChild(status);
    root.appendChild(scrambledEl);
    root.appendChild(row);
    root.appendChild(row2);

    return {
      stats: () => [
        { label: 'Word length', value: word.length },
        { label: 'Status', value: over ? 'Solved' : 'Unsolved' }
      ]
    };
  }

  // --- Reaction Time Test ---
  function initReaction(root) {
    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const box = document.createElement('div');
    box.className = 'reaction-box waiting';
    box.textContent = 'Click to start';
    let state = 'idle', startTime, timeout;

    function startRound() {
      state = 'waiting';
      box.className = 'reaction-box waiting';
      box.textContent = 'Wait for green…';
      const delay = 1000 + Math.random() * 2500;
      timeout = setTimeout(() => {
        state = 'ready';
        startTime = performance.now();
        box.className = 'reaction-box ready';
        box.textContent = 'CLICK NOW!';
      }, delay);
    }
    box.addEventListener('click', () => {
      if (state === 'idle') { startRound(); return; }
      if (state === 'waiting') {
        clearTimeout(timeout);
        state = 'idle';
        box.className = 'reaction-box waiting';
        box.textContent = 'Too soon! Click to try again.';
        return;
      }
      if (state === 'ready') {
        const reactionMs = Math.round(performance.now() - startTime);
        const key = 'gpa_game_best_reaction_ms';
        const prevBest = parseInt(localStorage.getItem(key), 10);
        const newBest = isNaN(prevBest) || reactionMs < prevBest ? reactionMs : prevBest;
        localStorage.setItem(key, String(newBest));
        state = 'idle';
        box.className = 'reaction-box waiting';
        box.textContent = `${reactionMs}ms — Best: ${newBest}ms. Click to try again.`;
      }
    });

    status.textContent = 'Test your reflexes!';
    root.appendChild(status);
    root.appendChild(box);

    return {
      cleanup: () => clearTimeout(timeout),
      // Pausing mid-round would make the measurement meaningless, so
      // pausing just resets to idle and the next click starts fresh.
      pause: () => {
        clearTimeout(timeout);
        state = 'idle';
        box.className = 'reaction-box waiting';
        box.textContent = 'Click to start';
      },
      stats: () => {
        const best = parseInt(localStorage.getItem('gpa_game_best_reaction_ms'), 10);
        return [{ label: 'Best reaction', value: isNaN(best) ? '—' : `${best}ms` }];
      }
    };
  }

  // --- Tetris ---
  function initTetris(root) {
    const COLS = 10, ROWS = 18, CELL = 14;
    const SHAPES = {
      I: [[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]], [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]], [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]],
      J: [[[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]], [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]]],
      L: [[[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]], [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]]],
      O: [[[1,1],[1,1]]],
      S: [[[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]]],
      T: [[[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]], [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]]],
      Z: [[[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]]]
    };
    const PALETTES = {
      classic: { I: '#4da3ff', J: '#3b5bdb', L: '#f59f00', O: '#f5c518', S: '#22c55e', T: '#8b5cf6', Z: '#e5453a' },
      pastel: { I: '#a5d8ff', J: '#bac8ff', L: '#ffd8a8', O: '#ffec99', S: '#b2f2bb', T: '#d0bfff', Z: '#ffc9c9' },
      neon: { I: '#00e5ff', J: '#2979ff', L: '#ff9100', O: '#ffea00', S: '#00e676', T: '#d500f9', Z: '#ff1744' },
      mono: { I: '#e5e7eb', J: '#cbd5e1', L: '#94a3b8', O: '#f1f5f9', S: '#b0bec5', T: '#cfd8dc', Z: '#9aa5b1' }
    };
    const TYPES = Object.keys(SHAPES);

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    const TETRIS_START = { chill: 800, normal: 600, brisk: 420, turbo: 260 };
    const tetrisPace = getGameOpt('tetris', 'pace', 'normal');
    const tetrisPalette = getGameOpt('tetris', 'palette', 'classic');
    let board, current, score, level, linesCleared, over, dropTimer, dropInterval, paused = false;

    function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
    function randomPiece() {
      const type = TYPES[Math.floor(Math.random() * TYPES.length)];
      const rotations = SHAPES[type];
      const shape = rotations[0];
      return { type, rot: 0, shape, x: Math.floor(COLS / 2) - Math.ceil(shape[0].length / 2), y: 0 };
    }
    function collides(shape, px, py) {
      for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const bx = px + c, by = py + r;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && board[by][bx]) return true;
      }
      return false;
    }
    function merge() {
      current.shape.forEach((row, r) => row.forEach((v, c) => {
        if (v) { const by = current.y + r, bx = current.x + c; if (by >= 0) board[by][bx] = current.type; }
      }));
    }
    function clearLines() {
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r].every((cell) => cell)) {
          board.splice(r, 1);
          board.unshift(Array(COLS).fill(null));
          cleared++;
          r++;
        }
      }
      if (cleared) {
        const points = [0, 100, 300, 500, 800][cleared] || 1000;
        score += points * level;
        linesCleared += cleared;
        level = 1 + Math.floor(linesCleared / 10);
        dropInterval = Math.max(120, 600 - (level - 1) * 50);
        status.textContent = `Score: ${score}   Level: ${level}   Best: ${getBest('tetris')}`;
      }
    }
    function spawn() {
      current = randomPiece();
      if (collides(current.shape, current.x, current.y)) {
        over = true;
        const best = setBestIfHigher('tetris', score);
        status.textContent = `Game over! Score: ${score}   Best: ${best}`;
      }
    }
    function rotate() {
      const rotations = SHAPES[current.type];
      const nextRot = (current.rot + 1) % rotations.length;
      const nextShape = rotations[nextRot];
      if (!collides(nextShape, current.x, current.y)) { current.rot = nextRot; current.shape = nextShape; }
      else if (!collides(nextShape, current.x - 1, current.y)) { current.rot = nextRot; current.shape = nextShape; current.x -= 1; }
      else if (!collides(nextShape, current.x + 1, current.y)) { current.rot = nextRot; current.shape = nextShape; current.x += 1; }
    }
    function move(dx) { if (!collides(current.shape, current.x + dx, current.y)) current.x += dx; }
    function lockPiece() { merge(); clearLines(); spawn(); }
    function softDrop() {
      if (!collides(current.shape, current.x, current.y + 1)) { current.y++; score += 1; }
      else lockPiece();
    }
    function hardDrop() {
      while (!collides(current.shape, current.x, current.y + 1)) { current.y++; score += 2; }
      lockPiece();
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c]) { ctx.fillStyle = (PALETTES[tetrisPalette] || PALETTES.classic)[board[r][c]]; ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2); }
      }
      if (current && !over) {
        ctx.fillStyle = (PALETTES[tetrisPalette] || PALETTES.classic)[current.type];
        current.shape.forEach((row, r) => row.forEach((v, c) => {
          if (v) { const by = current.y + r; if (by >= 0) ctx.fillRect((current.x + c) * CELL + 1, by * CELL + 1, CELL - 2, CELL - 2); }
        }));
      }
    }
    function tick() {
      if (over) return;
      if (!collides(current.shape, current.x, current.y + 1)) current.y++;
      else lockPiece();
      draw();
    }
    function scheduleTick() {
      dropTimer = setTimeout(() => { tick(); if (!over) scheduleTick(); }, dropInterval);
    }
    function onKey(e) {
      if (over || paused) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowUp') rotate();
      else if (e.key === 'ArrowDown') softDrop();
      else if (e.key === ' ') hardDrop();
      draw();
    }
    function reset() {
      board = emptyBoard(); score = 0; level = 1; linesCleared = 0; over = false;
      dropInterval = TETRIS_START[tetrisPace] || 600;
      spawn();
      status.textContent = `Score: 0   Level: 1   Best: ${getBest('tetris')}`;
      draw();
    }

    onWin('keydown', onKey);
    reset();
    scheduleTick();

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrows to move/rotate/soft-drop, Space to hard-drop.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { clearTimeout(dropTimer); window.removeEventListener('keydown', onKey); },
      pause: () => { clearTimeout(dropTimer); dropTimer = null; paused = true; },
      resume: () => { paused = false; if (!over) scheduleTick(); },
      redraw: draw,
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Level', value: level },
        { label: 'Lines cleared', value: linesCleared },
        { label: 'Status', value: over ? 'Game over' : 'In play' }
      ],
      options: () => [
        { key: 'palette', label: 'Colors', value: tetrisPalette, restart: true,
          choices: [
            { value: 'classic', label: 'Classic' },
            { value: 'pastel', label: 'Pastel' },
            { value: 'neon', label: 'Neon' },
            { value: 'mono', label: 'Mono' }
          ] },
        { key: 'pace', label: 'Start pace', value: tetrisPace, restart: true,
          choices: [
            { value: 'chill', label: 'Chill' },
            { value: 'normal', label: 'Normal' },
            { value: 'brisk', label: 'Brisk' },
            { value: 'turbo', label: 'Turbo' }
          ] }
      ]
    };
  }

  // --- Checkers (vs a simple AI) ---
  function initCheckers(root) {
    const SIZE = 8;
    let board, turn, selected, over, validDestinations;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const boardEl = document.createElement('div');
    boardEl.className = 'checkers-board';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'Restart';
    resetBtn.style.marginTop = '6px';

    function isDark(r, c) { return (r + c) % 2 === 1; }
    function setup() {
      board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      for (let r = 0; r < 3; r++) for (let c = 0; c < SIZE; c++) if (isDark(r, c)) board[r][c] = { color: 'black', king: false };
      for (let r = 5; r < 8; r++) for (let c = 0; c < SIZE; c++) if (isDark(r, c)) board[r][c] = { color: 'red', king: false };
    }
    function pieceMoves(r, c) {
      const piece = board[r][c];
      if (!piece) return [];
      const dirs = piece.king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : (piece.color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
      const moves = [];
      dirs.forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
          if (!board[nr][nc]) moves.push({ toR: nr, toC: nc, capture: null });
          else if (board[nr][nc].color !== piece.color) {
            const jr = nr + dr, jc = nc + dc;
            if (jr >= 0 && jr < SIZE && jc >= 0 && jc < SIZE && !board[jr][jc]) moves.push({ toR: jr, toC: jc, capture: { r: nr, c: nc } });
          }
        }
      });
      return moves;
    }
    function allMoves(color) {
      const all = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (board[r][c] && board[r][c].color === color) pieceMoves(r, c).forEach((m) => all.push({ from: { r, c }, ...m }));
      }
      return all;
    }
    function applyMove(from, move) {
      const piece = board[from.r][from.c];
      board[from.r][from.c] = null;
      if (move.capture) board[move.capture.r][move.capture.c] = null;
      board[move.toR][move.toC] = piece;
      if (!piece.king && ((piece.color === 'red' && move.toR === 0) || (piece.color === 'black' && move.toR === SIZE - 1))) piece.king = true;
    }
    function countPieces(color) {
      let n = 0;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] && board[r][c].color === color) n++;
      return n;
    }
    function render() {
      boardEl.innerHTML = '';
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'checkers-cell ' + (isDark(r, c) ? 'dark' : 'light');
        if (selected && selected.r === r && selected.c === c) cell.classList.add('selected');
        if (validDestinations && validDestinations.some((m) => m.toR === r && m.toC === c)) cell.classList.add('valid-move');
        const piece = board[r][c];
        if (piece) {
          const p = document.createElement('div');
          p.className = 'checkers-piece ' + piece.color;
          if (piece.king) { p.textContent = '♛'; p.style.color = piece.color === 'red' ? '#fff' : '#f5c518'; }
          cell.appendChild(p);
        }
        cell.addEventListener('click', () => handleClick(r, c));
        boardEl.appendChild(cell);
      }
    }
    function checkGameOver() {
      if (countPieces('black') === 0) { over = true; status.textContent = '🎉 You win! All black pieces captured.'; return; }
      if (countPieces('red') === 0) { over = true; status.textContent = 'AI wins! All your pieces are gone.'; return; }
    }
    function handleClick(r, c) {
      if (over || turn !== 'red') return;
      const piece = board[r][c];
      if (piece && piece.color === 'red') {
        selected = { r, c };
        validDestinations = pieceMoves(r, c);
        render();
        return;
      }
      if (selected && validDestinations) {
        const move = validDestinations.find((m) => m.toR === r && m.toC === c);
        if (move) {
          applyMove(selected, move);
          selected = null; validDestinations = null;
          render();
          checkGameOver();
          if (!over) { turn = 'black'; status.textContent = "AI's turn…"; setTimeout(aiTurn, 400); }
          return;
        }
      }
      selected = null; validDestinations = null;
      render();
    }
    function aiTurn() {
      const moves = allMoves('black');
      if (!moves.length) { over = true; status.textContent = '🎉 You win! AI has no moves left.'; return; }
      const captures = moves.filter((m) => m.capture);
      const pool = captures.length ? captures : moves;
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      applyMove(chosen.from, chosen);
      render();
      checkGameOver();
      if (!over) { turn = 'red'; status.textContent = 'Your turn (Red) — pick a piece'; }
    }
    function reset() {
      setup();
      turn = 'red'; selected = null; validDestinations = null; over = false;
      status.textContent = 'Your turn (Red) — pick a piece';
      render();
    }

    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(boardEl);
    root.appendChild(resetBtn);

    return {
      stats: () => [
        { label: 'Your pieces', value: countPieces('red') },
        { label: 'AI pieces', value: countPieces('black') },
        { label: 'Turn', value: over ? 'Finished' : (turn === 'red' ? 'Yours' : 'AI') }
      ]
    };
  }

  // --- Sudoku ---
  function initSudoku(root) {
    let solved, puzzle, given, selected, over;

    const status = document.createElement('div');
    status.className = 'gpa-game-status';
    const grid = document.createElement('div');
    grid.className = 'sudoku-grid';
    const numRow = document.createElement('div');
    numRow.className = 'sudoku-numrow';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gpa-btn';
    resetBtn.textContent = 'New puzzle';
    resetBtn.style.marginTop = '6px';

    function generateSolvedGrid() {
      const g = Array.from({ length: 9 }, () => Array(9).fill(0));
      function isValid(gr, r, c, val) {
        for (let i = 0; i < 9; i++) if (gr[r][i] === val || gr[i][c] === val) return false;
        const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (gr[br + dr][bc + dc] === val) return false;
        return true;
      }
      function fill(pos) {
        if (pos === 81) return true;
        const r = Math.floor(pos / 9), c = pos % 9;
        const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
        for (const n of nums) {
          if (isValid(g, r, c, n)) {
            g[r][c] = n;
            if (fill(pos + 1)) return true;
            g[r][c] = 0;
          }
        }
        return false;
      }
      fill(0);
      return g;
    }
    function makePuzzle(solvedGrid, removeCount) {
      const p = solvedGrid.map((row) => [...row]);
      let removed = 0;
      while (removed < removeCount) {
        const r = Math.floor(Math.random() * 9), c = Math.floor(Math.random() * 9);
        if (p[r][c] !== 0) { p[r][c] = 0; removed++; }
      }
      return p;
    }
    function conflicts(g, r, c, val) {
      if (!val) return false;
      for (let i = 0; i < 9; i++) {
        if (i !== c && g[r][i] === val) return true;
        if (i !== r && g[i][c] === val) return true;
      }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
        const rr = br + dr, cc = bc + dc;
        if ((rr !== r || cc !== c) && g[rr][cc] === val) return true;
      }
      return false;
    }
    function render() {
      grid.innerHTML = '';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'sudoku-cell';
        if (given[r][c]) cell.classList.add('given');
        if (selected && selected.r === r && selected.c === c) cell.classList.add('selected');
        if ((c + 1) % 3 === 0 && c !== 8) cell.classList.add('border-right');
        if ((r + 1) % 3 === 0 && r !== 8) cell.classList.add('border-bottom');
        const val = puzzle[r][c];
        if (val) {
          cell.textContent = val;
          if (!given[r][c] && conflicts(puzzle, r, c, val)) cell.classList.add('conflict');
        }
        cell.addEventListener('click', () => {
          if (given[r][c] || over) return;
          selected = { r, c };
          render();
        });
        grid.appendChild(cell);
      }
    }
    function checkWin() {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (!puzzle[r][c]) return false;
        if (conflicts(puzzle, r, c, puzzle[r][c])) return false;
      }
      return true;
    }
    function placeNumber(n) {
      if (!selected || over) return;
      const { r, c } = selected;
      if (given[r][c]) return;
      puzzle[r][c] = n;
      render();
      if (checkWin()) { over = true; status.textContent = '🎉 Solved! Great job.'; }
      else status.textContent = 'Fill in the grid — tap a cell, then a number.';
    }
    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.className = 'gpa-btn sudoku-num';
      btn.textContent = String(n);
      btn.addEventListener('click', () => placeNumber(n));
      numRow.appendChild(btn);
    }
    const clearBtn = document.createElement('button');
    clearBtn.className = 'gpa-btn sudoku-num';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', () => placeNumber(0));
    numRow.appendChild(clearBtn);

    function reset() {
      solved = generateSolvedGrid();
      puzzle = makePuzzle(solved, 44);
      given = puzzle.map((row) => row.map((v) => v !== 0));
      selected = null; over = false;
      status.textContent = 'Fill in the grid — tap a cell, then a number.';
      render();
    }

    resetBtn.addEventListener('click', reset);
    reset();
    root.appendChild(status);
    root.appendChild(grid);
    root.appendChild(numRow);
    root.appendChild(resetBtn);

    return {
      stats: () => {
        let filled = 0, blanks = 0, conflictCount = 0;
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
          if (puzzle[r][c]) {
            filled++;
            if (!given[r][c] && conflicts(puzzle, r, c, puzzle[r][c])) conflictCount++;
          } else blanks++;
        }
        return [
          { label: 'Filled', value: `${filled} / 81` },
          { label: 'Blanks left', value: blanks },
          { label: 'Conflicts', value: conflictCount },
          { label: 'Status', value: over ? 'Solved' : 'In progress' }
        ];
      }
    };
  }

  // ===== Additional games ====================================================
  // Same contract as the others: build into `root`, return either a cleanup
  // function or { cleanup, stats, options, pause, resume }.

  // ---- Pong (vs CPU) ----
  function initPong(root) {
    const W = 260, H = 170, PAD_H = 38, PAD_W = 5, BALL = 5;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const t = THEMES[theme] || THEMES.dark;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const speedOpt = getGameOpt('pong', 'speed', 'normal');
    const SPEEDS = { slow: 2.2, normal: 3.2, fast: 4.4 };
    let py = H / 2 - PAD_H / 2, ay = py, bx = W / 2, by = H / 2, vx = SPEEDS[speedOpt] || 3.2, vy = 1.8;
    let you = 0, cpu = 0, raf = null, over = false, paused = false;

    function reset(dir) {
      bx = W / 2; by = H / 2;
      const s = SPEEDS[getGameOpt('pong', 'speed', 'normal')] || 3.2;
      vx = s * (dir || 1); vy = (Math.random() * 2 - 1) * s * 0.6;
    }
    function draw() {
      ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = t.border; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = t.accent; ctx.fillRect(6, py, PAD_W, PAD_H);
      ctx.fillStyle = t.sub; ctx.fillRect(W - 6 - PAD_W, ay, PAD_W, PAD_H);
      ctx.fillStyle = t.text; ctx.fillRect(bx - BALL / 2, by - BALL / 2, BALL, BALL);
      ctx.font = '12px monospace'; ctx.fillStyle = t.sub;
      ctx.fillText(String(you), W / 2 - 22, 14); ctx.fillText(String(cpu), W / 2 + 14, 14);
    }
    function step() {
      if (!paused && !over) {
        bx += vx; by += vy;
        if (by < BALL / 2 || by > H - BALL / 2) vy = -vy;
        // player paddle
        if (bx - BALL / 2 < 6 + PAD_W && bx > 6 && by > py && by < py + PAD_H && vx < 0) {
          vx = -vx; vy += ((by - (py + PAD_H / 2)) / PAD_H) * 2;
        }
        // cpu paddle
        if (bx + BALL / 2 > W - 6 - PAD_W && bx < W - 6 && by > ay && by < ay + PAD_H && vx > 0) {
          vx = -vx; vy += ((by - (ay + PAD_H / 2)) / PAD_H) * 2;
        }
        // cpu tracks the ball with a deliberate lag so it is beatable
        const target = by - PAD_H / 2;
        ay += Math.max(-2.6, Math.min(2.6, (target - ay) * 0.09));
        ay = Math.max(0, Math.min(H - PAD_H, ay));
        if (bx < 0) { cpu++; reset(1); }
        if (bx > W) { you++; reset(-1); }
        if (you >= 7 || cpu >= 7) {
          over = true;
          status.textContent = you > cpu ? '🏆 You win the match!' : 'CPU takes it — press Restart.';
          if (you > cpu) setBestIfHigher('pong', you * 10 + (7 - cpu));
        } else {
          status.textContent = `You ${you} — ${cpu} CPU · move the mouse or use ↑ ↓`;
        }
      }
      draw();
      raf = requestAnimationFrame(step);
    }
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      const scale = H / r.height;
      py = Math.max(0, Math.min(H - PAD_H, (e.clientY - r.top) * scale - PAD_H / 2));
    };
    canvas.addEventListener('mousemove', onMove);
    const onKey = (e) => {
      if (e.key === 'ArrowUp') { py = Math.max(0, py - 14); e.preventDefault(); }
      if (e.key === 'ArrowDown') { py = Math.min(H - PAD_H, py + 14); e.preventDefault(); }
    };
    onWin('keydown', onKey);
    root.appendChild(status); root.appendChild(canvas);
    reset(Math.random() > 0.5 ? 1 : -1);
    raf = requestAnimationFrame(step);
    return {
      cleanup: () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); },
      pause: () => { paused = true; }, resume: () => { paused = false; },
      redraw: draw,
      stats: () => [{ label: 'You', value: you }, { label: 'CPU', value: cpu }],
      options: () => [{
        key: 'speed', label: 'Ball speed', value: getGameOpt('pong', 'speed', 'normal'), restart: true,
        choices: [{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]
      }]
    };
  }

  // ---- Lights Out ----
  function initLightsOut(root) {
    const N = 5;
    let grid = [], moves = 0, won = false;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const board = document.createElement('div');
    board.style.cssText = `display:grid;grid-template-columns:repeat(${N},1fr);gap:4px;width:190px;`;
    const t = THEMES[theme] || THEMES.dark;

    function toggle(g, r, c) { if (r >= 0 && r < N && c >= 0 && c < N) g[r][c] = !g[r][c]; }
    function scramble() {
      grid = Array.from({ length: N }, () => Array(N).fill(false));
      // Random *moves* rather than random lights, so it's always solvable.
      for (let i = 0; i < 12; i++) {
        const r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N);
        toggle(grid, r, c); toggle(grid, r - 1, c); toggle(grid, r + 1, c); toggle(grid, r, c - 1); toggle(grid, r, c + 1);
      }
      moves = 0; won = false;
    }
    function render() {
      board.innerHTML = '';
      grid.forEach((row, r) => row.forEach((on, c) => {
        const b = document.createElement('button');
        b.style.cssText = `aspect-ratio:1;border-radius:6px;cursor:pointer;border:1px solid ${on ? t.accent : t.border};`
          + `background:${on ? t.accent : t.field};box-shadow:${on ? '0 0 10px ' + t.accent + '88' : 'none'};`;
        b.addEventListener('click', () => {
          if (won) return;
          toggle(grid, r, c); toggle(grid, r - 1, c); toggle(grid, r + 1, c); toggle(grid, r, c - 1); toggle(grid, r, c + 1);
          moves++;
          if (grid.every((rw) => rw.every((x) => !x))) {
            won = true;
            setBestIfHigher('lightsout', Math.max(0, 100 - moves));
            status.textContent = `💡 All out in ${moves} moves!`;
          } else status.textContent = `Turn every light off — ${moves} moves`;
          render();
        });
        board.appendChild(b);
      }));
    }
    scramble();
    status.textContent = 'Turn every light off — clicking flips a cross';
    render();
    root.appendChild(status); root.appendChild(board);
    return {
      stats: () => [{ label: 'Moves', value: moves }, { label: 'Lights on', value: grid.flat().filter(Boolean).length }],
      cleanup: () => {}
    };
  }

  // ---- 15-Puzzle ----
  function initFifteen(root) {
    const N = 4;
    let tiles = [], moves = 0, won = false;
    const t = THEMES[theme] || THEMES.dark;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const board = document.createElement('div');
    board.style.cssText = `display:grid;grid-template-columns:repeat(${N},1fr);gap:4px;width:200px;`;

    const solved = () => tiles.every((v, i) => (i === N * N - 1 ? v === 0 : v === i + 1));
    function scramble() {
      tiles = [...Array(N * N - 1).keys()].map((i) => i + 1).concat(0);
      // Shuffle by legal moves so the board is always solvable.
      let blank = N * N - 1;
      for (let i = 0; i < 300; i++) {
        const opts = [];
        const r = Math.floor(blank / N), c = blank % N;
        if (r > 0) opts.push(blank - N);
        if (r < N - 1) opts.push(blank + N);
        if (c > 0) opts.push(blank - 1);
        if (c < N - 1) opts.push(blank + 1);
        const pick = opts[Math.floor(Math.random() * opts.length)];
        tiles[blank] = tiles[pick]; tiles[pick] = 0; blank = pick;
      }
      moves = 0; won = false;
    }
    function render() {
      board.innerHTML = '';
      tiles.forEach((v, i) => {
        const cell = document.createElement('button');
        cell.textContent = v || '';
        cell.style.cssText = `aspect-ratio:1;font:700 16px monospace;border-radius:6px;cursor:${v ? 'pointer' : 'default'};`
          + `border:1px solid ${v ? t.accent + '70' : 'transparent'};background:${v ? t.field : 'transparent'};color:${t.text};`;
        if (v) cell.addEventListener('click', () => move(i));
        board.appendChild(cell);
      });
    }
    function move(i) {
      if (won) return;
      const blank = tiles.indexOf(0);
      const r = Math.floor(i / N), c = i % N, br = Math.floor(blank / N), bc = blank % N;
      if (Math.abs(r - br) + Math.abs(c - bc) !== 1) return;
      tiles[blank] = tiles[i]; tiles[i] = 0; moves++;
      if (solved()) { won = true; setBestIfHigher('fifteen', Math.max(0, 500 - moves)); status.textContent = `🎉 Solved in ${moves} moves!`; }
      else status.textContent = `Get 1–15 in order — ${moves} moves`;
      render();
    }
    scramble();
    status.textContent = 'Get 1–15 in order — click a tile beside the gap';
    render();
    root.appendChild(status); root.appendChild(board);
    return { stats: () => [{ label: 'Moves', value: moves }, { label: 'Solved', value: won ? 'Yes' : 'No' }], cleanup: () => {} };
  }

  // ---- Tower of Hanoi ----
  function initHanoi(root) {
    const t = THEMES[theme] || THEMES.dark;
    let discCount = parseInt(getGameOpt('hanoi', 'discs', '4'), 10) || 4;
    let pegs = [[], [], []], sel = null, moves = 0, won = false;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;justify-content:center;align-items:flex-end;height:130px;';

    function reset() {
      discCount = parseInt(getGameOpt('hanoi', 'discs', '4'), 10) || 4;
      pegs = [[...Array(discCount).keys()].map((i) => discCount - i), [], []];
      sel = null; moves = 0; won = false;
    }
    function render() {
      wrap.innerHTML = '';
      pegs.forEach((peg, pi) => {
        const col = document.createElement('div');
        col.style.cssText = `flex:1;display:flex;flex-direction:column-reverse;align-items:center;gap:3px;height:100%;`
          + `border-bottom:3px solid ${t.accent};padding-bottom:2px;cursor:pointer;`
          + (sel === pi ? `background:${t.accent}18;` : '');
        peg.forEach((d) => {
          const disc = document.createElement('div');
          const w = 18 + (d / discCount) * 52;
          disc.style.cssText = `width:${w}px;height:12px;border-radius:6px;background:${t.accent};opacity:${0.45 + (d / discCount) * 0.55};`;
          col.appendChild(disc);
        });
        col.addEventListener('click', () => click(pi));
        wrap.appendChild(col);
      });
    }
    function click(pi) {
      if (won) return;
      if (sel === null) { if (pegs[pi].length) sel = pi; }
      else if (sel === pi) sel = null;
      else {
        const from = pegs[sel], to = pegs[pi];
        const d = from[from.length - 1];
        if (!to.length || to[to.length - 1] > d) { to.push(from.pop()); moves++; }
        sel = null;
      }
      const min = Math.pow(2, discCount) - 1;
      if (pegs[2].length === discCount) {
        won = true;
        setBestIfHigher('hanoi', Math.max(0, 1000 - moves));
        status.textContent = `🏗 Done in ${moves} moves (perfect is ${min})`;
      } else status.textContent = `Move the stack to the right peg — ${moves} moves (best possible ${min})`;
      render();
    }
    reset();
    status.textContent = 'Move the stack to the right peg — click a peg to pick up, another to drop';
    render();
    root.appendChild(status); root.appendChild(wrap);
    return {
      stats: () => [{ label: 'Moves', value: moves }, { label: 'Perfect', value: Math.pow(2, discCount) - 1 }],
      options: () => [{
        key: 'discs', label: 'Discs', value: String(discCount), restart: true,
        choices: [{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' }]
      }],
      cleanup: () => {}
    };
  }

  // ---- Mastermind ----
  function initMastermind(root) {
    const COLORS = ['#e5453a', '#4da3ff', '#22c55e', '#eab308', '#8b5cf6', '#ec4899'];
    const LEN = 4, MAX = 10;
    const t = THEMES[theme] || THEMES.dark;
    let secret = [], guess = [], rows = [], over = false;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const history = document.createElement('div');
    history.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:8px;max-height:140px;overflow-y:auto;';
    const picker = document.createElement('div');
    picker.style.cssText = 'display:flex;gap:5px;justify-content:center;flex-wrap:wrap;';
    const current = document.createElement('div');
    current.style.cssText = 'display:flex;gap:4px;justify-content:center;margin:6px 0;';

    const dot = (c, size) => {
      const d = document.createElement('span');
      d.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;display:inline-block;background:${c || 'transparent'};border:1px solid ${c ? c : t.border};`;
      return d;
    };
    function score(g) {
      let exact = 0, close = 0;
      const s = [...secret], gg = [...g];
      for (let i = 0; i < LEN; i++) if (gg[i] === s[i]) { exact++; s[i] = gg[i] = null; }
      for (let i = 0; i < LEN; i++) {
        if (gg[i] === null) continue;
        const j = s.indexOf(gg[i]);
        if (j > -1) { close++; s[j] = null; }
      }
      return { exact, close };
    }
    function renderCurrent() {
      current.innerHTML = '';
      for (let i = 0; i < LEN; i++) current.appendChild(dot(guess[i], 16));
    }
    function submit() {
      if (over || guess.length < LEN) return;
      const sc = score(guess);
      rows.push({ g: [...guess], ...sc });
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center;justify-content:center;';
      guess.forEach((c) => row.appendChild(dot(c, 13)));
      const info = document.createElement('span');
      info.style.cssText = `font:10px monospace;color:${t.sub};margin-left:6px;`;
      info.textContent = `${sc.exact}● ${sc.close}○`;
      row.appendChild(info);
      history.appendChild(row);
      history.scrollTop = history.scrollHeight;
      guess = []; renderCurrent();
      if (sc.exact === LEN) {
        over = true;
        setBestIfHigher('mastermind', Math.max(0, (MAX - rows.length + 1) * 10));
        status.textContent = `🎯 Cracked it in ${rows.length} guesses!`;
      } else if (rows.length >= MAX) {
        over = true;
        const reveal = document.createElement('div');
        reveal.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-top:4px;';
        secret.forEach((c) => reveal.appendChild(dot(c, 13)));
        history.appendChild(reveal);
        status.textContent = 'Out of guesses — the code is shown above.';
      } else status.textContent = `${MAX - rows.length} guesses left · ● right spot, ○ right colour`;
    }
    secret = Array.from({ length: LEN }, () => COLORS[Math.floor(Math.random() * COLORS.length)]);
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.style.cssText = `width:22px;height:22px;border-radius:50%;background:${c};border:1px solid ${t.border};cursor:pointer;`;
      b.addEventListener('click', () => { if (!over && guess.length < LEN) { guess.push(c); renderCurrent(); if (guess.length === LEN) submit(); } });
      picker.appendChild(b);
    });
    const undo = document.createElement('button');
    undo.className = 'gpa-btn';
    undo.textContent = '⌫';
    undo.addEventListener('click', () => { if (!over) { guess.pop(); renderCurrent(); } });
    picker.appendChild(undo);
    status.textContent = `Crack the 4-colour code · ● right spot, ○ right colour`;
    renderCurrent();
    root.appendChild(status); root.appendChild(history); root.appendChild(current); root.appendChild(picker);
    return { stats: () => [{ label: 'Guesses', value: rows.length }, { label: 'Left', value: Math.max(0, MAX - rows.length) }], cleanup: () => {} };
  }

  // ---- Blackjack ----
  function initBlackjack(root) {
    const t = THEMES[theme] || THEMES.dark;
    let deck = [], you = [], dealer = [], done = false, wins = 0, losses = 0, pushes = 0;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;min-height:16px;';
    const table = document.createElement('div');
    table.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:center;margin-bottom:8px;';
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:6px;justify-content:center;';
    const tally = document.createElement('div');
    tally.className = 'gpa-sub';
    tally.style.cssText = 'text-align:center;margin-top:6px;';

    function newDeck() {
      const suits = ['♠', '♥', '♦', '♣'], ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      deck = [];
      suits.forEach((s) => ranks.forEach((r) => deck.push({ r, s })));
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    function total(hand) {
      let sum = 0, aces = 0;
      hand.forEach((c) => {
        if (c.r === 'A') { aces++; sum += 11; }
        else if (['J', 'Q', 'K'].includes(c.r)) sum += 10;
        else sum += parseInt(c.r, 10);
      });
      while (sum > 21 && aces) { sum -= 10; aces--; }
      return sum;
    }
    function cardEl(c, hidden) {
      const d = document.createElement('div');
      const red = c && (c.s === '♥' || c.s === '♦');
      d.textContent = hidden ? '🂠' : c.r + c.s;
      d.style.cssText = `min-width:30px;padding:6px 5px;border-radius:5px;text-align:center;font:700 12px monospace;`
        + `background:${hidden ? t.field : '#f6f6f8'};color:${hidden ? t.sub : (red ? '#d33' : '#111')};border:1px solid ${t.border};`;
      return d;
    }
    function render() {
      table.innerHTML = '';
      const mk = (label, hand, hideSecond) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:5px;align-items:center;justify-content:center;flex-wrap:wrap;';
        const lab = document.createElement('span');
        lab.style.cssText = `font:10px monospace;color:${t.sub};width:52px;`;
        lab.textContent = label + (hideSecond ? '' : ' ' + total(hand));
        row.appendChild(lab);
        hand.forEach((c, i) => row.appendChild(cardEl(c, hideSecond && i === 1)));
        table.appendChild(row);
      };
      mk('Dealer', dealer, !done);
      mk('You', you, false);
    }
    function finish() {
      done = true;
      while (total(dealer) < 17) dealer.push(deck.pop());
      const y = total(you), dtot = total(dealer);
      let msg;
      if (y > 21) { msg = 'Bust — dealer wins.'; losses++; }
      else if (dtot > 21) { msg = '🎉 Dealer busts — you win!'; wins++; }
      else if (y > dtot) { msg = '🎉 You win!'; wins++; }
      else if (y < dtot) { msg = 'Dealer wins.'; losses++; }
      else { msg = 'Push — nobody wins.'; pushes++; }
      setBestIfHigher('blackjack', wins);
      status.textContent = msg;
      tally.textContent = `W ${wins} · L ${losses} · P ${pushes}`;
      render();
    }
    function deal() {
      if (deck.length < 12) newDeck();
      you = [deck.pop(), deck.pop()]; dealer = [deck.pop(), deck.pop()];
      done = false;
      status.textContent = total(you) === 21 ? 'Blackjack! Stand to collect.' : 'Hit or stand?';
      render();
    }
    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'gpa-btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      controls.appendChild(b);
      return b;
    };
    mkBtn('Hit', () => { if (done) return; you.push(deck.pop()); if (total(you) >= 21) finish(); else render(); });
    mkBtn('Stand', () => { if (!done) finish(); });
    mkBtn('Deal', () => deal());
    newDeck(); deal();
    tally.textContent = 'W 0 · L 0 · P 0';
    root.appendChild(status); root.appendChild(table); root.appendChild(controls); root.appendChild(tally);
    return {
      stats: () => [{ label: 'Wins', value: wins }, { label: 'Losses', value: losses }, { label: 'Pushes', value: pushes }],
      cleanup: () => {}
    };
  }

  // ---- Typing test ----
  function initTyping(root) {
    const SENTENCES = [
      'the quick brown fox jumps over the lazy dog',
      'practice makes progress not perfection',
      'a journey of a thousand miles begins with one step',
      'simple code is easier to fix than clever code',
      'every expert was once a complete beginner',
      'read the question twice before you answer it'
    ];
    const t = THEMES[theme] || THEMES.dark;
    let target = '', startedAt = 0, finished = false, wpm = 0, acc = 100;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const display = document.createElement('div');
    display.style.cssText = `font:13px/1.7 monospace;padding:8px;border-radius:6px;background:${t.field};border:1px solid ${t.border};margin-bottom:8px;min-height:52px;`;
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.placeholder = 'Start typing…';
    input.autocomplete = 'off';

    function render() {
      display.innerHTML = '';
      const typed = input.value;
      let wrong = 0;
      target.split('').forEach((ch, i) => {
        const s = document.createElement('span');
        s.textContent = ch;
        if (i < typed.length) {
          const good = typed[i] === ch;
          if (!good) wrong++;
          s.style.color = good ? '#22c55e' : '#ff6b6b';
          if (!good) s.style.background = '#ff6b6b22';
        } else s.style.color = t.sub;
        display.appendChild(s);
      });
      acc = typed.length ? Math.max(0, Math.round(((typed.length - wrong) / typed.length) * 100)) : 100;
      const secs = startedAt ? (Date.now() - startedAt) / 1000 : 0;
      wpm = secs > 0 ? Math.round((typed.length / 5) / (secs / 60)) : 0;
      if (!finished) status.textContent = `${wpm} wpm · ${acc}% accurate`;
    }
    function reset() {
      target = SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
      input.value = ''; startedAt = 0; finished = false;
      status.textContent = 'Type the sentence as fast as you can';
      render(); input.focus();
    }
    input.addEventListener('input', () => {
      if (!startedAt) startedAt = Date.now();
      render();
      if (input.value === target && !finished) {
        finished = true;
        setBestIfHigher('typing', wpm);
        status.textContent = `✅ ${wpm} wpm at ${acc}% accuracy — press Restart for a new one`;
      }
    });
    reset();
    root.appendChild(status); root.appendChild(display); root.appendChild(input);
    setTimeout(() => input.focus(), 50);
    return { stats: () => [{ label: 'WPM', value: wpm }, { label: 'Accuracy', value: acc + '%' }], cleanup: () => {} };
  }

  // ---- Math sprint ----
  function initMathSprint(root) {
    const t = THEMES[theme] || THEMES.dark;
    const level = getGameOpt('mathsprint', 'level', 'normal');
    let score = 0, streak = 0, best = 0, left = 60, a = 0, b = 0, op = '+', timer = null, over = false;
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    const q = document.createElement('div');
    q.style.cssText = `font:700 26px monospace;text-align:center;color:${t.accent};margin:10px 0;`;
    const input = document.createElement('input');
    input.className = 'gpa-input';
    input.inputMode = 'numeric';
    input.placeholder = 'Answer + Enter';
    input.autocomplete = 'off';

    function range() {
      const lv = getGameOpt('mathsprint', 'level', 'normal');
      return lv === 'easy' ? 10 : lv === 'hard' ? 50 : 20;
    }
    function next() {
      const R = range();
      const ops = getGameOpt('mathsprint', 'level', 'normal') === 'easy' ? ['+', '-'] : ['+', '-', '×'];
      op = ops[Math.floor(Math.random() * ops.length)];
      a = Math.floor(Math.random() * R) + 1;
      b = Math.floor(Math.random() * (op === '×' ? Math.min(12, R) : R)) + 1;
      if (op === '-' && b > a) [a, b] = [b, a];
      q.textContent = `${a} ${op} ${b} = ?`;
    }
    const answer = () => (op === '+' ? a + b : op === '-' ? a - b : a * b);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || over) return;
      const v = parseInt(input.value, 10);
      input.value = '';
      if (v === answer()) { score++; streak++; best = Math.max(best, streak); status.textContent = `✅ correct · streak ${streak}`; }
      else { streak = 0; status.textContent = `✗ it was ${answer()}`; }
      next();
    });
    timer = setInterval(() => {
      left--;
      if (left <= 0) {
        over = true;
        clearInterval(timer); timer = null;
        setBestIfHigher('mathsprint', score);
        q.textContent = `${score} correct`;
        status.textContent = `⏱ Time! ${score} correct, best streak ${best}. Press Restart.`;
        input.disabled = true;
      } else if (!over) status.textContent = `${left}s left · score ${score} · streak ${streak}`;
    }, 1000);
    next();
    status.textContent = '60 seconds — how many can you get?';
    root.appendChild(status); root.appendChild(q); root.appendChild(input);
    setTimeout(() => input.focus(), 50);
    return {
      cleanup: () => { if (timer) clearInterval(timer); },
      pause: () => { if (timer) { clearInterval(timer); timer = null; } },
      stats: () => [{ label: 'Score', value: score }, { label: 'Best streak', value: best }, { label: 'Time left', value: left + 's' }],
      options: () => [{
        key: 'level', label: 'Difficulty', value: getGameOpt('mathsprint', 'level', 'normal'), restart: true,
        choices: [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]
      }]
    };
  }

  // ---- Maze ----
  function initMaze(root) {
    const t = THEMES[theme] || THEMES.dark;
    const N = parseInt(getGameOpt('maze', 'size', '11'), 10) || 11;
    const cell = Math.max(10, Math.floor(200 / N));
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = N * cell; canvas.height = N * cell;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    let grid = [], px = 1, py = 1, steps = 0, won = false;

    function carve() {
      // Recursive-backtracker on odd cells; 1 = wall, 0 = open.
      grid = Array.from({ length: N }, () => Array(N).fill(1));
      const stack = [[1, 1]];
      grid[1][1] = 0;
      while (stack.length) {
        const [r, c] = stack[stack.length - 1];
        const dirs = [[-2, 0], [2, 0], [0, -2], [0, 2]].sort(() => Math.random() - 0.5);
        let moved = false;
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr > 0 && nr < N - 1 && nc > 0 && nc < N - 1 && grid[nr][nc] === 1) {
            grid[r + dr / 2][c + dc / 2] = 0; grid[nr][nc] = 0;
            stack.push([nr, nc]); moved = true; break;
          }
        }
        if (!moved) stack.pop();
      }
      grid[N - 2][N - 2] = 0;
      px = 1; py = 1; steps = 0; won = false;
    }
    function draw() {
      ctx.fillStyle = t.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (grid[r][c] === 1) { ctx.fillStyle = t.border; ctx.fillRect(c * cell, r * cell, cell, cell); }
      }
      ctx.fillStyle = '#22c55e';
      ctx.fillRect((N - 2) * cell + 2, (N - 2) * cell + 2, cell - 4, cell - 4);
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.arc(px * cell + cell / 2, py * cell + cell / 2, cell / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    }
    function move(dx, dy) {
      if (won) return;
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || grid[ny][nx] === 1) return;
      px = nx; py = ny; steps++;
      if (px === N - 2 && py === N - 2) {
        won = true;
        setBestIfHigher('maze', Math.max(0, 1000 - steps));
        status.textContent = `🏁 Out in ${steps} steps!`;
      } else status.textContent = `Reach the green square — ${steps} steps`;
      draw();
    }
    const onKey = (e) => {
      const k = e.key;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
      e.preventDefault();
      if (k === 'ArrowUp') move(0, -1);
      if (k === 'ArrowDown') move(0, 1);
      if (k === 'ArrowLeft') move(-1, 0);
      if (k === 'ArrowRight') move(1, 0);
    };
    onWin('keydown', onKey);
    carve(); draw();
    status.textContent = 'Reach the green square — arrow keys';
    root.appendChild(status); root.appendChild(canvas);
    return {
      cleanup: () => window.removeEventListener('keydown', onKey),
      redraw: draw,
      stats: () => [{ label: 'Steps', value: steps }, { label: 'Escaped', value: won ? 'Yes' : 'No' }],
      options: () => [{
        key: 'size', label: 'Maze size', value: String(N), restart: true,
        choices: [{ value: '9', label: 'Small' }, { value: '11', label: 'Medium' }, { value: '15', label: 'Large' }, { value: '21', label: 'Huge' }]
      }]
    };
  }

  // ---- Space Invaders ----
  function initInvaders(root) {
    const W = 220, H = 190;
    const t = THEMES[theme] || THEMES.dark;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';
    let ship = W / 2, bullets = [], bombs = [], aliens = [], dir = 1, score = 0, lives = 3;
    let raf = null, paused = false, over = false, tick = 0, wave = 1;
    const keys = {};

    function spawnWave() {
      aliens = [];
      const cols = 7, rows = 3;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        aliens.push({ x: 18 + c * 27, y: 22 + r * 20, alive: true });
      }
      dir = 1;
    }
    function draw() {
      ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = t.accent;
      aliens.forEach((a) => { if (a.alive) ctx.fillRect(a.x - 7, a.y - 5, 14, 10); });
      ctx.fillStyle = t.text;
      ctx.fillRect(ship - 10, H - 14, 20, 6);
      ctx.fillRect(ship - 2, H - 19, 4, 5);
      ctx.fillStyle = '#22c55e';
      bullets.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 6));
      ctx.fillStyle = '#ff6b6b';
      bombs.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 6));
      ctx.font = '10px monospace'; ctx.fillStyle = t.sub;
      ctx.fillText('Score ' + score, 4, 11);
      ctx.fillText('♥'.repeat(Math.max(0, lives)), W - 34, 11);
    }
    function step() {
      if (!paused && !over) {
        tick++;
        if (keys.ArrowLeft) ship = Math.max(12, ship - 3);
        if (keys.ArrowRight) ship = Math.min(W - 12, ship + 3);
        bullets = bullets.filter((b) => (b.y -= 5) > -6);
        bombs = bombs.filter((b) => (b.y += 2.2) < H);
        // march the formation
        const speed = 8 + wave * 2;
        if (tick % Math.max(6, 26 - wave * 3) === 0) {
          const live = aliens.filter((a) => a.alive);
          const hitEdge = live.some((a) => (dir > 0 && a.x > W - 16) || (dir < 0 && a.x < 16));
          if (hitEdge) { dir = -dir; live.forEach((a) => { a.y += 9; }); }
          else live.forEach((a) => { a.x += dir * 5; });
          if (live.some((a) => a.y > H - 26)) { over = true; status.textContent = 'They landed — game over. Press Restart.'; }
          // occasional return fire
          if (live.length && Math.random() < 0.55) {
            const shooter = live[Math.floor(Math.random() * live.length)];
            bombs.push({ x: shooter.x, y: shooter.y + 6 });
          }
        }
        bullets.forEach((b) => aliens.forEach((a) => {
          if (a.alive && Math.abs(a.x - b.x) < 9 && Math.abs(a.y - b.y) < 8) { a.alive = false; b.y = -99; score += 10; }
        }));
        bombs.forEach((b) => {
          if (b.y > H - 18 && Math.abs(b.x - ship) < 12) { b.y = H + 99; lives--; if (lives <= 0) { over = true; setBestIfHigher('invaders', score); status.textContent = `Game over — ${score} points. Press Restart.`; } }
        });
        if (aliens.every((a) => !a.alive)) { wave++; score += 50; spawnWave(); status.textContent = `Wave ${wave}! · ← → move, space to fire`; }
      }
      draw();
      raf = requestAnimationFrame(step);
    }
    const onKey = (e) => {
      if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      keys[e.key] = true;
      if (e.key === ' ' && !over && !paused && bullets.length < 3) bullets.push({ x: ship, y: H - 20 });
    };
    const onUp = (e) => { keys[e.key] = false; };
    onWin('keydown', onKey); onWin('keyup', onUp);
    spawnWave();
    status.textContent = '← → move · space to fire';
    root.appendChild(status); root.appendChild(canvas);
    raf = requestAnimationFrame(step);
    return {
      cleanup: () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); },
      pause: () => { paused = true; }, resume: () => { paused = false; },
      redraw: draw,
      stats: () => [{ label: 'Score', value: score }, { label: 'Wave', value: wave }, { label: 'Lives', value: Math.max(0, lives) }]
    };
  }

  // ---- Crusade (original vertical shmup: waves, a shield pickup, boss fights) ----
  function initCrusade(root) {
    const W = 200, H = 260;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';

    let ship, bullets, ebullets, drones, boss, shieldPickup, shieldTime, lives, score, wave, over, paused = false, raf, tick;
    const keys = {};

    function reset() {
      ship = { x: W / 2, y: H - 20 };
      bullets = []; ebullets = []; drones = []; boss = null; shieldPickup = null; shieldTime = 0;
      lives = 3; score = 0; wave = 0; over = false; tick = 0;
      spawnWave();
      status.textContent = `Wave ${wave} · Score ${score} · Lives ${lives}`;
    }
    function spawnWave() {
      wave++;
      if (wave % 5 === 0) {
        boss = { x: W / 2, y: 34, hp: 24 + wave * 2, maxHp: 24 + wave * 2, dir: 1, fireCd: 0 };
        drones = [];
        return;
      }
      const cols = 5, rows = Math.min(3, 1 + Math.floor(wave / 3));
      drones = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        drones.push({ x: 22 + c * 38, y: 20 + r * 22, baseY: 20 + r * 22, alive: true, fireCd: 60 + Math.random() * 120, drift: Math.random() * Math.PI * 2 });
      }
    }
    function draw() {
      const t = THEMES[theme] || THEMES.dark;
      ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
      // starfield
      ctx.fillStyle = t.border;
      for (let i = 0; i < 30; i++) ctx.fillRect((i * 53 + tick * 0.4) % W, (i * 97) % H, 1, 1);
      // shield pickup
      if (shieldPickup) {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(shieldPickup.x, shieldPickup.y, 5, 0, Math.PI * 2); ctx.fill();
      }
      // drones
      drones.forEach((d) => {
        if (!d.alive) return;
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - 7); ctx.lineTo(d.x + 7, d.y); ctx.lineTo(d.x, d.y + 7); ctx.lineTo(d.x - 7, d.y);
        ctx.closePath(); ctx.fill();
      });
      // boss
      if (boss) {
        ctx.fillStyle = '#e5453a';
        ctx.fillRect(boss.x - 22, boss.y - 12, 44, 24);
        ctx.fillStyle = t.sub;
        ctx.fillRect(W / 2 - 30, 6, 60, 4);
        ctx.fillStyle = '#e5453a';
        ctx.fillRect(W / 2 - 30, 6, 60 * (boss.hp / boss.maxHp), 4);
      }
      // bullets
      ctx.fillStyle = '#22c55e';
      bullets.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 7));
      ctx.fillStyle = '#f97316';
      ebullets.forEach((b) => ctx.fillRect(b.x - 1, b.y, 2, 7));
      // ship
      ctx.fillStyle = shieldTime > 0 ? '#38bdf8' : (THEMES[theme] || THEMES.dark).accent;
      ctx.beginPath();
      ctx.moveTo(ship.x, ship.y - 9); ctx.lineTo(ship.x + 8, ship.y + 8); ctx.lineTo(ship.x - 8, ship.y + 8);
      ctx.closePath(); ctx.fill();
      if (shieldTime > 0) {
        ctx.strokeStyle = '#38bdf8aa';
        ctx.beginPath(); ctx.arc(ship.x, ship.y, 13, 0, Math.PI * 2); ctx.stroke();
      }
    }
    function hurtPlayer() {
      if (shieldTime > 0) return;
      lives--;
      if (lives <= 0) {
        over = true;
        const best = setBestIfHigher('crusade', score);
        status.textContent = `Game over! Score ${score}   Best: ${best}   (Space to retry)`;
      } else status.textContent = `Hit! Lives ${lives} · Score ${score}`;
    }
    function step() {
      if (over || paused) { draw(); raf = requestAnimationFrame(step); return; }
      tick++;
      if (keys.ArrowLeft) ship.x = Math.max(10, ship.x - 2.4);
      if (keys.ArrowRight) ship.x = Math.min(W - 10, ship.x + 2.4);
      if (keys.Fire && tick % 9 === 0) bullets.push({ x: ship.x, y: ship.y - 10 });
      bullets = bullets.filter((b) => (b.y -= 4.2) > -8);
      ebullets = ebullets.filter((b) => (b.y += 2.6) < H + 8);
      if (shieldTime > 0) shieldTime--;
      // shield pickup spawn/collect
      if (!shieldPickup && Math.random() < 0.0025) shieldPickup = { x: 20 + Math.random() * (W - 40), y: -10 };
      if (shieldPickup) {
        shieldPickup.y += 1.2;
        if (shieldPickup.y > H + 10) shieldPickup = null;
        else if (Math.abs(shieldPickup.x - ship.x) < 10 && Math.abs(shieldPickup.y - ship.y) < 12) {
          shieldTime = 360; shieldPickup = null;
          status.textContent = `🛡 Shield up! Score ${score} · Lives ${lives}`;
        }
      }
      // drones
      let anyAlive = false;
      drones.forEach((d) => {
        if (!d.alive) return;
        anyAlive = true;
        d.drift += 0.03;
        d.x += Math.sin(d.drift) * 0.5;
        d.y = d.baseY + Math.sin(tick / 40 + d.baseY) * 4 + Math.min(40, wave * 1.5);
        d.fireCd--;
        if (d.fireCd <= 0 && Math.random() < 0.02) { ebullets.push({ x: d.x, y: d.y }); d.fireCd = 90; }
        if (Math.abs(d.x - ship.x) < 9 && Math.abs(d.y - ship.y) < 9) { d.alive = false; hurtPlayer(); }
      });
      bullets.forEach((b) => drones.forEach((d) => {
        if (d.alive && Math.abs(d.x - b.x) < 8 && Math.abs(d.y - b.y) < 8) { d.alive = false; b.y = -99; score += 10; status.textContent = `Score ${score} · Lives ${lives}`; }
      }));
      // boss
      if (boss) {
        boss.x += boss.dir * (1 + wave * 0.05);
        if (boss.x < 30 || boss.x > W - 30) boss.dir *= -1;
        boss.fireCd--;
        if (boss.fireCd <= 0) {
          ebullets.push({ x: boss.x - 12, y: boss.y + 12 }, { x: boss.x, y: boss.y + 12 }, { x: boss.x + 12, y: boss.y + 12 });
          boss.fireCd = 55;
        }
        bullets.forEach((b) => {
          if (Math.abs(b.x - boss.x) < 22 && Math.abs(b.y - boss.y) < 12) {
            boss.hp--; b.y = -99; score += 3;
            if (boss.hp <= 0) { score += 100; boss = null; status.textContent = `Boss down! Score ${score} · Lives ${lives}`; spawnWave(); }
          }
        });
        if (boss && Math.abs(boss.x - ship.x) < 20 && Math.abs(boss.y - ship.y) < 16) hurtPlayer();
      }
      ebullets.forEach((b) => {
        if (Math.abs(b.x - ship.x) < 7 && Math.abs(b.y - ship.y) < 9) { b.y = H + 99; hurtPlayer(); }
      });
      if (!boss && !anyAlive && drones.length) { score += 20; spawnWave(); status.textContent = `Wave ${wave} · Score ${score} · Lives ${lives}`; }
      draw();
      if (!over) raf = requestAnimationFrame(step);
      else raf = requestAnimationFrame(step);
    }
    function onKey(e) {
      if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft') keys.ArrowLeft = true;
      if (e.key === 'ArrowRight') keys.ArrowRight = true;
      if (e.key === ' ') keys.Fire = true;
      if (over && e.key === ' ') reset();
    }
    function onUp(e) {
      if (e.key === 'ArrowLeft') keys.ArrowLeft = false;
      if (e.key === 'ArrowRight') keys.ArrowRight = false;
      if (e.key === ' ') keys.Fire = false;
    }
    onWin('keydown', onKey); onWin('keyup', onUp);

    reset();
    draw();
    raf = requestAnimationFrame(step);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrows to move, hold Space to fire — grab the blue orb for a temporary shield, watch for the boss every 5th wave.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); },
      pause: () => { paused = true; }, resume: () => { paused = false; },
      redraw: draw,
      stats: () => [
        { label: 'Score', value: score }, { label: 'Wave', value: wave },
        { label: 'Lives', value: Math.max(0, lives) }, { label: 'Shield', value: shieldTime > 0 ? 'Up' : 'Down' }
      ]
    };
  }

  // ---- Racer (original neon anti-gravity lane-dodger) ----
  function initRacer(root) {
    const W = 200, H = 260;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-sub';
    status.style.cssText = 'text-align:center;margin-bottom:6px;';

    const TRACK_L = 30, TRACK_R = W - 30;
    let shipX, obstacles, boosts, speed, dist, lives, invuln, over, paused = false, raf, tick, stripeOffset;
    const keys = {};

    function reset() {
      shipX = W / 2; obstacles = []; boosts = []; speed = 1.6; dist = 0; lives = 3; invuln = 0; over = false; tick = 0; stripeOffset = 0;
      status.textContent = `Distance 0m · Lives ${lives}`;
    }
    function spawnStuff() {
      if (Math.random() < 0.035 + Math.min(0.05, speed * 0.006)) {
        obstacles.push({ x: TRACK_L + 10 + Math.random() * (TRACK_R - TRACK_L - 20), y: -10, w: 14 });
      }
      if (Math.random() < 0.006) {
        boosts.push({ x: TRACK_L + 10 + Math.random() * (TRACK_R - TRACK_L - 20), y: -10 });
      }
    }
    function draw() {
      const t = THEMES[theme] || THEMES.dark;
      ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
      // track edges (neon)
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(TRACK_L, 0); ctx.lineTo(TRACK_L, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(TRACK_R, 0); ctx.lineTo(TRACK_R, H); ctx.stroke();
      // scrolling lane stripes
      ctx.strokeStyle = t.border; ctx.lineWidth = 1; ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = -stripeOffset;
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.setLineDash([]);
      // obstacles
      ctx.fillStyle = '#f97316';
      obstacles.forEach((o) => ctx.fillRect(o.x - o.w / 2, o.y - 6, o.w, 12));
      // boosts
      ctx.fillStyle = '#22c55e';
      boosts.forEach((b) => { ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fill(); });
      // ship
      const flash = invuln > 0 && Math.floor(tick / 4) % 2 === 0;
      ctx.fillStyle = flash ? '#ffffff88' : t.accent;
      ctx.beginPath();
      ctx.moveTo(shipX, H - 30); ctx.lineTo(shipX - 8, H - 14); ctx.lineTo(shipX, H - 19); ctx.lineTo(shipX + 8, H - 14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(shipX - 2, H - 14, 4, 6 + Math.min(10, speed * 2));
    }
    function step() {
      if (over || paused) { draw(); raf = requestAnimationFrame(step); return; }
      tick++;
      if (keys.ArrowLeft) shipX = Math.max(TRACK_L + 8, shipX - 2.6);
      if (keys.ArrowRight) shipX = Math.min(TRACK_R - 8, shipX + 2.6);
      speed = Math.min(6, speed + 0.0015);
      dist += speed;
      stripeOffset += speed * 2;
      if (invuln > 0) invuln--;
      spawnStuff();
      obstacles.forEach((o) => { o.y += speed * 2.2; });
      boosts.forEach((b) => { b.y += speed * 2.2; });
      obstacles = obstacles.filter((o) => {
        if (o.y > H + 10) return false;
        if (invuln <= 0 && Math.abs(o.y - (H - 20)) < 10 && Math.abs(o.x - shipX) < o.w / 2 + 7) {
          lives--; invuln = 70; speed = Math.max(1.4, speed - 1.2);
          if (lives <= 0) {
            over = true;
            const best = setBestIfHigher('racer', Math.floor(dist));
            status.textContent = `Crashed! Distance ${Math.floor(dist)}m   Best: ${best}m   (Space to retry)`;
          } else status.textContent = `Crashed! Lives ${lives} · Distance ${Math.floor(dist)}m`;
          return false;
        }
        return true;
      });
      boosts = boosts.filter((b) => {
        if (b.y > H + 10) return false;
        if (Math.abs(b.y - (H - 20)) < 10 && Math.abs(b.x - shipX) < 12) {
          speed = Math.min(7, speed + 1.4);
          status.textContent = `Boost! Distance ${Math.floor(dist)}m · Lives ${lives}`;
          return false;
        }
        return true;
      });
      if (!over && tick % 30 === 0) status.textContent = `Distance ${Math.floor(dist)}m · Lives ${lives}`;
      draw();
      raf = requestAnimationFrame(step);
    }
    function onKey(e) {
      if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft') keys.ArrowLeft = true;
      if (e.key === 'ArrowRight') keys.ArrowRight = true;
      if (over && e.key === ' ') reset();
    }
    function onUp(e) {
      if (e.key === 'ArrowLeft') keys.ArrowLeft = false;
      if (e.key === 'ArrowRight') keys.ArrowRight = false;
    }
    onWin('keydown', onKey); onWin('keyup', onUp);

    reset();
    draw();
    raf = requestAnimationFrame(step);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrows to steer — dodge the orange barriers, grab green orbs to boost. Speed climbs the longer you survive.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); },
      pause: () => { paused = true; }, resume: () => { paused = false; },
      redraw: draw,
      stats: () => [
        { label: 'Distance', value: Math.floor(dist) + 'm' }, { label: 'Speed', value: speed.toFixed(1) },
        { label: 'Lives', value: Math.max(0, lives) }
      ]
    };
  }

  // ---- Platformer (original run/jump/stomp arcade platformer) ----
  function initPlatformer(root) {
    const W = 260, H = 150, GROUND_Y = H - 18;
    const GRAVITY = 0.5, JUMP_V = -8.4, MOVE_SPEED = 2.2, STOMP_BOUNCE = -5.5;
    const LEVEL_LENS = [1300, 1800, 2300];
    const SKINS = { teal: '#14b8a6', coral: '#fb7185', amber: '#f59e0b', violet: '#8b5cf6' };
    const skinKey = getGameOpt('platformer', 'skin', 'teal');

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const status = document.createElement('div');
    status.className = 'gpa-game-status';

    let levelIndex, levelLen, grounds, platforms, coins, enemies, flagX;
    let px, py, pvx, pvy, onGround, facing, lives, score, over, won, paused = false, raf, checkpointX;
    const keys = {};

    function buildLevel(len) {
      grounds = []; platforms = []; coins = []; enemies = [];
      let x = 0;
      while (x < len) {
        const runLen = 120 + Math.random() * 160;
        grounds.push({ x1: x, x2: Math.min(len, x + runLen) });
        x += runLen;
        if (x < len - 200 && Math.random() < 0.45) x += 30 + Math.random() * 40;
      }
      for (let gx = 80; gx < len - 100; gx += 90 + Math.random() * 60) {
        const py2 = GROUND_Y - (30 + Math.random() * 50);
        const pw = 40 + Math.random() * 30;
        platforms.push({ x: gx, y: py2, w: pw });
        if (Math.random() < 0.8) coins.push({ x: gx + pw / 2, y: py2 - 10, taken: false });
      }
      for (let gx = 60; gx < len - 60; gx += 70 + Math.random() * 90) {
        if (Math.random() < 0.5) coins.push({ x: gx, y: GROUND_Y - 14, taken: false });
      }
      grounds.forEach((g) => {
        if (g.x2 - g.x1 > 140 && Math.random() < 0.7) {
          enemies.push({
            x: g.x1 + (g.x2 - g.x1) / 2, y: GROUND_Y - 10,
            x1: g.x1 + 20, x2: g.x2 - 20, dir: 1, alive: true,
            speed: 0.6 + levelIndex * 0.25
          });
        }
      });
      flagX = len - 30;
    }
    function isOverGround(x) { return grounds.some((g) => x >= g.x1 && x <= g.x2); }
    function loadLevel(i) {
      levelIndex = i;
      levelLen = LEVEL_LENS[i] || LEVEL_LENS[LEVEL_LENS.length - 1];
      buildLevel(levelLen);
      px = 20; py = GROUND_Y - 10; pvx = 0; pvy = 0; onGround = true; facing = 1; checkpointX = 20;
      status.textContent = `Level ${i + 1}/${LEVEL_LENS.length} · Score ${score} · Lives ${lives}`;
    }
    function reset() { lives = 3; score = 0; over = false; won = false; loadLevel(0); }
    function respawn() { px = checkpointX; py = GROUND_Y - 10; pvx = 0; pvy = 0; }
    function loseLife() {
      lives--;
      if (lives <= 0) {
        over = true;
        const best = setBestIfHigher('platformer', score);
        status.textContent = `Game over! Score ${score}   Best: ${best}   (Space to retry)`;
      } else {
        respawn();
        status.textContent = `Ouch! Lives ${lives} · Score ${score}`;
      }
    }
    function update() {
      if (over || paused) return;
      pvx = 0;
      if (keys.ArrowLeft) { pvx = -MOVE_SPEED; facing = -1; }
      if (keys.ArrowRight) { pvx = MOVE_SPEED; facing = 1; }
      pvy = Math.min(10, pvy + GRAVITY);
      let nx = px + pvx, ny = py + pvy;
      let landedY = isOverGround(nx) && ny + 10 >= GROUND_Y ? GROUND_Y - 10 : null;
      platforms.forEach((p) => {
        if (nx + 6 > p.x && nx - 6 < p.x + p.w && py + 10 <= p.y && ny + 10 >= p.y) {
          if (landedY === null || p.y - 10 < landedY) landedY = p.y - 10;
        }
      });
      onGround = false;
      if (landedY !== null && pvy >= 0) { ny = landedY; pvy = 0; onGround = true; }
      if (keys.Jump && onGround) { pvy = JUMP_V; onGround = false; keys.Jump = false; }
      px = Math.max(6, Math.min(levelLen - 6, nx));
      py = ny;
      if (py > H + 30) { loseLife(); return; }
      if (onGround && px > checkpointX + 40) checkpointX = px - 20;
      coins.forEach((c) => {
        if (!c.taken && Math.abs(c.x - px) < 10 && Math.abs(c.y - py) < 10) {
          c.taken = true; score += 10;
          status.textContent = `Score ${score} · Lives ${lives}`;
        }
      });
      enemies.forEach((e) => {
        if (!e.alive) return;
        e.x += e.dir * e.speed;
        if (e.x < e.x1 || e.x > e.x2) e.dir *= -1;
        const dx = Math.abs(e.x - px), dy = e.y - py;
        if (dx < 10 && dy > -4 && dy < 12) {
          if (pvy > 0 && py < e.y - 4) {
            e.alive = false; pvy = STOMP_BOUNCE; score += 20;
            status.textContent = `Score ${score} · Lives ${lives}`;
          } else loseLife();
        }
      });
      if (over) return;
      if (px >= flagX) {
        if (levelIndex + 1 < LEVEL_LENS.length) { score += 50; loadLevel(levelIndex + 1); }
        else {
          won = true; over = true;
          score += 100;
          const best = setBestIfHigher('platformer', score);
          status.textContent = `🎉 You made it! Score ${score}   Best: ${best}`;
        }
      }
    }
    function draw() {
      const t = THEMES[theme] || THEMES.dark;
      const cam = Math.max(0, Math.min(levelLen - W, px - W / 2));
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = t.border;
      grounds.forEach((g) => {
        const x1 = g.x1 - cam, x2 = g.x2 - cam;
        if (x2 < 0 || x1 > W) return;
        ctx.fillRect(x1, GROUND_Y, x2 - x1, H - GROUND_Y);
      });
      ctx.fillStyle = t.sub;
      platforms.forEach((p) => {
        const x = p.x - cam;
        if (x + p.w < 0 || x > W) return;
        ctx.fillRect(x, p.y, p.w, 8);
      });
      ctx.fillStyle = '#fbbf24';
      coins.forEach((c) => {
        if (c.taken) return;
        const x = c.x - cam;
        if (x < -10 || x > W + 10) return;
        ctx.beginPath(); ctx.arc(x, c.y, 4, 0, Math.PI * 2); ctx.fill();
      });
      enemies.forEach((e) => {
        if (!e.alive) return;
        const x = e.x - cam;
        if (x < -14 || x > W + 14) return;
        ctx.fillStyle = '#e5453a';
        ctx.fillRect(x - 6, e.y - 8, 12, 10);
      });
      const fx = flagX - cam;
      if (fx > -20 && fx < W + 20) {
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(fx, GROUND_Y - 50, 3, 50);
        ctx.beginPath(); ctx.moveTo(fx + 3, GROUND_Y - 50); ctx.lineTo(fx + 18, GROUND_Y - 44); ctx.lineTo(fx + 3, GROUND_Y - 38); ctx.fill();
      }
      const psx = px - cam;
      ctx.fillStyle = SKINS[skinKey] || SKINS.teal;
      ctx.beginPath(); ctx.ellipse(psx, py, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(psx + facing * 3, py - 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(psx + facing * 4, py - 2, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    function loop() { update(); draw(); raf = requestAnimationFrame(loop); }
    function onKey(e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
      if (e.key === 'ArrowLeft') keys.ArrowLeft = true;
      if (e.key === 'ArrowRight') keys.ArrowRight = true;
      if (e.key === 'ArrowUp' || e.key === ' ') keys.Jump = true;
      if (over && (e.key === ' ' || e.key === 'Enter')) reset();
    }
    function onKeyUp(e) {
      if (e.key === 'ArrowLeft') keys.ArrowLeft = false;
      if (e.key === 'ArrowRight') keys.ArrowRight = false;
    }
    onWin('keydown', onKey); onWin('keyup', onKeyUp);

    reset();
    draw();
    raf = requestAnimationFrame(loop);

    const hint = document.createElement('div');
    hint.className = 'gpa-sub';
    hint.textContent = 'Arrows to move, Up/Space to jump — stomp enemies from above, grab coins, reach the flag.';
    root.appendChild(status);
    root.appendChild(canvas);
    root.appendChild(hint);

    return {
      cleanup: () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); },
      pause: () => { paused = true; },
      resume: () => { paused = false; },
      redraw: draw,
      stats: () => [
        { label: 'Score', value: score },
        { label: 'Lives', value: Math.max(0, lives) },
        { label: 'Level', value: levelIndex + 1 },
        { label: 'Status', value: over ? (won ? 'Cleared!' : 'Game over') : 'Playing' }
      ],
      options: () => [
        { key: 'skin', label: 'Color', value: skinKey, restart: true,
          choices: Object.keys(SKINS).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })) }
      ]
    };
  }

  const GAME_LOADERS = {
    ttt: initTTT, rps: initRPS, memory: initMemory, snake: initSnake,
    '2048': init2048, whack: initWhack, guess: initGuess, hangman: initHangman,
    wordle: initWordle, connect4: initConnect4, minesweeper: initMinesweeper,
    simon: initSimon, breakout: initBreakout, flappy: initFlappy,
    scramble: initScramble, reaction: initReaction,
    tetris: initTetris, checkers: initCheckers, sudoku: initSudoku,
    pong: initPong, lightsout: initLightsOut, fifteen: initFifteen,
    hanoi: initHanoi, mastermind: initMastermind, blackjack: initBlackjack,
    typing: initTyping, mathsprint: initMathSprint, maze: initMaze,
    invaders: initInvaders, platformer: initPlatformer, crusade: initCrusade, racer: initRacer
  };

  const GAME_LABELS = {
    ttt: 'Tic-Tac-Toe', rps: 'Rock Paper Scissors', memory: 'Memory Match', snake: 'Snake',
    '2048': '2048', whack: 'Whack-a-Mole', guess: 'Guess the Number', hangman: 'Hangman',
    wordle: 'Wordle', connect4: 'Connect 4', minesweeper: 'Minesweeper', simon: 'Simon',
    breakout: 'Breakout', flappy: 'Flappy', scramble: 'Word Scramble', reaction: 'Reaction Test',
    tetris: 'Tetris', checkers: 'Checkers', sudoku: 'Sudoku',
    pong: 'Pong', lightsout: 'Lights Out', fifteen: '15-Puzzle', hanoi: 'Tower of Hanoi',
    mastermind: 'Mastermind', blackjack: 'Blackjack', typing: 'Typing Test',
    mathsprint: 'Math Sprint', maze: 'Maze', invaders: 'Space Invaders', platformer: 'Platformer',
    crusade: 'Crusade', racer: 'Racer'
  };

  const gameStage = panel.querySelector('#gpa-game-stage');
  const pauseMenu = panel.querySelector('#gpa-game-pausemenu');
  const pauseStatsEl = panel.querySelector('#gpa-pause-stats');
  const pauseBtn = panel.querySelector('#gpa-game-pause');
  const fullscreenBtn = panel.querySelector('#gpa-game-fullscreen');

  let currentGameId = 'ttt';

  function renderPauseStats() {
    const rows = [];
    rows.push({ label: 'Game', value: GAME_LABELS[currentGameId] || currentGameId });
    rows.push({ label: 'Time played', value: formatElapsed(gameElapsedSeconds()) });
    // Per-game stats, if the game exposes them.
    if (activeGameControls && typeof activeGameControls.stats === 'function') {
      try {
        const custom = activeGameControls.stats() || [];
        custom.forEach((s) => rows.push(s));
      } catch (e) { /* a broken stats fn shouldn't break the pause menu */ }
    }
    const best = getBest(currentGameId);
    if (best) rows.push({ label: 'Best score', value: String(best) });

    pauseStatsEl.innerHTML = rows.map((r) =>
      `<div class="gpa-pause-stat"><span class="gpa-pause-stat-label">${escapeHtml(r.label)}</span><span class="gpa-pause-stat-value">${escapeHtml(String(r.value))}</span></div>`
    ).join('');
    renderGameOptions();
  }

  // Renders whatever options the active game exposes. Changing one applies
  // live where the game supports it, or on the next restart otherwise.
  function renderGameOptions() {
    const optsEl = panel.querySelector('#gpa-pause-options');
    if (!optsEl) return;
    optsEl.innerHTML = '';
    const defs = (activeGameControls && typeof activeGameControls.options === 'function')
      ? (activeGameControls.options() || [])
      : [];
    if (!defs.length) return;

    defs.forEach((def) => {
      const row = document.createElement('div');
      row.className = 'gpa-pause-optrow';
      const label = document.createElement('span');
      label.className = 'gpa-pause-optlabel';
      label.textContent = def.label;
      row.appendChild(label);

      const select = document.createElement('select');
      select.className = 'gpa-pause-optselect';
      def.choices.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        if (String(c.value) === String(def.value)) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        setGameOpt(currentGameId, def.key, select.value);
        if (typeof def.onChange === 'function') def.onChange(select.value);
        if (def.restart) loadGame(currentGameId);
      });
      row.appendChild(select);
      optsEl.appendChild(row);
    });

    const applyRow = document.createElement('div');
    applyRow.className = 'gpa-pause-optrow';
    const note = document.createElement('span');
    note.className = 'gpa-pause-optlabel';
    note.textContent = 'Apply options';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'gpa-pause-optbtn';
    applyBtn.textContent = 'Restart now';
    applyBtn.addEventListener('click', () => loadGame(currentGameId));
    applyRow.appendChild(note);
    applyRow.appendChild(applyBtn);
    optsEl.appendChild(applyRow);
  }

  function pauseGame() {
    if (isGamePaused) return;
    isGamePaused = true;
    gamePausedAt = Date.now();
    if (activeGameControls && typeof activeGameControls.pause === 'function') {
      try { activeGameControls.pause(); } catch (e) { /* ignore */ }
    }
    renderPauseStats();
    pauseMenu.style.display = 'flex';
    pauseBtn.textContent = '▶ Resume';
  }

  function resumeGame() {
    if (!isGamePaused) return;
    isGamePaused = false;
    gamePausedTotal += Date.now() - gamePausedAt;
    gamePausedAt = 0;
    if (activeGameControls && typeof activeGameControls.resume === 'function') {
      try { activeGameControls.resume(); } catch (e) { /* ignore */ }
    }
    pauseMenu.style.display = 'none';
    pauseBtn.textContent = '⏸ Pause';
  }

  function togglePause() { isGamePaused ? resumeGame() : pauseGame(); }

  function loadGame(id) {
    currentGameId = id;
    stopActiveGame();
    // Reset pause state for the new game.
    isGamePaused = false;
    gamePausedTotal = 0;
    gamePausedAt = 0;
    pauseMenu.style.display = 'none';
    pauseBtn.textContent = '⏸ Pause';
    gameStartedAt = Date.now();

    gameFit.innerHTML = '';
    gameFit.style.transform = 'none';
    gameBtns.forEach((b) => b.classList.toggle('primary', b.dataset.game === id));
    const loader = GAME_LOADERS[id];
    if (!loader) return;
    const returned = loader(gameFit);
    // Normalize both possible return shapes into one controls object.
    activeGameControls = typeof returned === 'function'
      ? { cleanup: returned }
      : (returned && typeof returned === 'object' ? returned : {});
    // Let layout settle before measuring, then scale to fit.
    requestAnimationFrame(fitGameToStage);
  }

  gameBtns.forEach((btn) => btn.addEventListener('click', () => loadGame(btn.dataset.game)));
  panel.querySelector('#gpa-game-restart').addEventListener('click', () => loadGame(currentGameId));
  panel.querySelector('#gpa-pause-restart').addEventListener('click', () => loadGame(currentGameId));
  panel.querySelector('#gpa-pause-resume').addEventListener('click', resumeGame);
  pauseBtn.addEventListener('click', togglePause);

  // ---- Match timer (toggled with "T") ----
  const gameTimerEl = panel.querySelector('#gpa-game-timer');
  let timerVisible = false;
  let timerTick = null;

  function refreshGameTimer() {
    if (!timerVisible) return;
    gameTimerEl.textContent = formatElapsed(gameElapsedSeconds());
  }
  function toggleGameTimer() {
    timerVisible = !timerVisible;
    gameTimerEl.style.display = timerVisible ? 'block' : 'none';
    if (timerVisible) {
      refreshGameTimer();
      if (!timerTick) timerTick = setInterval(refreshGameTimer, 500);
    } else if (timerTick) {
      clearInterval(timerTick);
      timerTick = null;
    }
  }

  // Keyboard shortcuts for the Games tab: P = pause/resume, R = restart,
  // T = show/hide the match timer. All share the same guards — ignored while
  // typing, ignored with modifier keys, and only while the Games tab is open.
  // They work in fullscreen too, since the listener is on window.
  onWin('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k !== 'p' && k !== 'r' && k !== 't') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const gamesPane = panel.querySelector('.gpa-pane[data-pane="games"]');
    if (!gamesPane || !gamesPane.classList.contains('active')) return;
    // Don't steal the key from a text field (inside the panel or on the page).
    const activeEl = root.activeElement || document.activeElement;
    if (activeEl) {
      const tag = (activeEl.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || activeEl.isContentEditable) return;
    }
    e.preventDefault();
    if (k === 'p') togglePause();
    else if (k === 'r') loadGame(currentGameId);
    else if (k === 't') toggleGameTimer();
  });

  // Fullscreen the game stage (works from inside the shadow DOM).
  fullscreenBtn.addEventListener('click', () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = gameStage.requestFullscreen || gameStage.webkitRequestFullscreen;
      if (req) req.call(gameStage).catch(() => { /* page may block fullscreen */ });
    }
  });
  // Some canvas games only repaint on their own tick/interval or on user
  // input (Tetris ticks every 600ms+, Maze/Flappy-before-first-click don't
  // redraw at all until moved). Chrome can blank a canvas's backing store
  // when its containing element is promoted into the fullscreen "top
  // layer" (a real, documented compositor quirk on some GPU/driver
  // combos) — those idle games would then sit blank until their next
  // tick/keypress, which for Maze or a paused game may never come. Force
  // an explicit repaint on every fullscreen transition so this can't
  // leave the canvas looking empty.
  function forceRedrawActiveGame() {
    if (activeGameControls && typeof activeGameControls.redraw === 'function') {
      try { activeGameControls.redraw(); } catch (e) { /* ignore */ }
    }
  }
  function syncFullscreenLabel() {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.textContent = active ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
    // Entering/leaving fullscreen changes the available area — refit. Chrome
    // doesn't always finish laying out the fullscreen element within a single
    // frame, so one rAF could measure a stale (pre-transition) size and scale
    // the game too large, cutting off the bottom. Retry a few times over the
    // next ~300ms so it settles on the real, final dimensions regardless of
    // how long that particular transition takes.
    let tries = 0;
    (function refit() {
      fitGameToStage();
      forceRedrawActiveGame();
      if (++tries < 6) setTimeout(() => requestAnimationFrame(refit), 60);
    })();
  }
  onWin('resize', () => requestAnimationFrame(() => { fitGameToStage(); forceRedrawActiveGame(); }));
  onDoc('fullscreenchange', syncFullscreenLabel);
  onDoc('webkitfullscreenchange', syncFullscreenLabel);

  loadGame('ttt');

  // ---- Account / sync controls in Settings ---------------------------------
  const syncBox = panel.querySelector('#gpa-sync-box');
  const cloudMsg = panel.querySelector('#gpa-cloud-msg');
  const cloudBinInput = panel.querySelector('#gpa-cloud-bin');
  const cloudKeyInput = panel.querySelector('#gpa-cloud-key');

  panel.querySelector('#gpa-logout-btn').addEventListener('click', () => {
    saveProgress();
    closeLanguagePicker();
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    refreshAccountUI();
    loginUserInput.value = '';
    loginPinInput.value = '';
    showLoginMsg('Signed out — your progress is saved.');
    loginOverlay.style.display = 'flex';
    setLockedChrome(true);
  });

  panel.querySelector('#gpa-sync-export').addEventListener('click', () => {
    saveProgress();
    const code = encodeSyncCode(buildSyncPayload());
    syncBox.value = code;
    syncBox.focus();
    syncBox.select();
    try {
      navigator.clipboard.writeText(code);
      cloudMsg.textContent = 'Sync code copied — paste it on your other device.';
    } catch (e) {
      cloudMsg.textContent = 'Sync code ready above — copy it manually.';
    }
  });

  panel.querySelector('#gpa-sync-import').addEventListener('click', () => {
    const code = syncBox.value.trim();
    if (!code) { cloudMsg.textContent = 'Paste a sync code into the box first.'; return; }
    try {
      const payload = decodeSyncCode(code);
      if (!payload || !payload.data) throw new Error('bad payload');
      applyState(payload.data);
      saveProgress();
      reapplyAllSettings();
      cloudMsg.textContent = 'Progress loaded from sync code.';
    } catch (e) {
      cloudMsg.textContent = "That doesn't look like a valid sync code.";
    }
  });

  // ---- Optional cloud auto-sync (JSONBin) ----
  // Credentials are entered here at runtime and kept in localStorage on this
  // device only — deliberately never hard-coded, so a public repo copy of
  // this script carries no secrets.
  function cloudCreds() {
    const bin = (cloudBinInput.value || '').trim();
    const key = (cloudKeyInput.value || '').trim();
    if (bin) localStorage.setItem(CLOUD_BIN_KEY, bin);
    if (key) localStorage.setItem(CLOUD_SECRET_KEY, key);
    return { bin, key };
  }

  panel.querySelector('#gpa-cloud-push').addEventListener('click', async () => {
    const { bin, key } = cloudCreds();
    if (!bin || !key) { cloudMsg.textContent = 'Enter both a Bin ID and an X-Master-Key.'; return; }
    saveProgress();
    cloudMsg.textContent = 'Uploading…';
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${encodeURIComponent(bin)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': key },
        body: JSON.stringify(buildSyncPayload())
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cloudMsg.textContent = `Uploaded at ${new Date().toLocaleTimeString()}.`;
    } catch (e) {
      cloudMsg.textContent = 'Upload failed: ' + e.message;
    }
  });

  panel.querySelector('#gpa-cloud-pull').addEventListener('click', async () => {
    const { bin, key } = cloudCreds();
    if (!bin || !key) { cloudMsg.textContent = 'Enter both a Bin ID and an X-Master-Key.'; return; }
    cloudMsg.textContent = 'Downloading…';
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${encodeURIComponent(bin)}/latest`, {
        headers: { 'X-Master-Key': key }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const payload = json && (json.record || json);
      if (!payload || !payload.data) throw new Error('no saved data in that bin');
      applyState(payload.data);
      saveProgress();
      reapplyAllSettings();
      cloudMsg.textContent = 'Progress downloaded and applied.';
    } catch (e) {
      cloudMsg.textContent = 'Download failed: ' + e.message;
    }
  });

  // ---- Usage logging --------------------------------------------------------
  // A record of who opened the tool and when. Local by default: it only ever
  // sees THIS browser, because localStorage is per-origin per-device and no
  // other instance can reach it. Cross-device visibility needs the telemetry
  // bin below. Entries: u=username, ev=event, ts=time, url, host, ua.
  const LOG_CAP = 400; // keep the newest N; the log is not an archive

  function readLogs() {
    try { const a = JSON.parse(localStorage.getItem(ADMIN_KEYS.LOGS) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function writeLogs(arr) {
    try { localStorage.setItem(ADMIN_KEYS.LOGS, JSON.stringify(arr.slice(-LOG_CAP))); } catch (e) { /* quota */ }
  }
  function logUsageEvent(ev, user) {
    const entry = {
      u: user || currentUser || '(anonymous)',
      ev,
      ts: Date.now(),
      // Origin + path only: a full URL routinely carries session tokens,
      // reset codes and search terms, and this log is readable by anyone who
      // opens the admin console on this device.
      url: scrubPageUrl(location.href),
      host: location.hostname,
      ua: (navigator.userAgent || '').slice(0, 160)
    };
    const arr = readLogs();
    arr.push(entry);
    writeLogs(arr);
    sendBeat(ev, entry.u);
    maybeShowTelemetryNotice();
  }

  // ---- Cross-device telemetry (worker-backed) -------------------------------
  // Each instance heartbeats to the worker's /track endpoint. The worker stores
  // it in KV and only hands it back to a request bearing the ADMIN_TOKEN, so —
  // unlike the old shared-key approach — the logs are genuinely owner-only and
  // no secret ships in this public script. A per-load session id lets the
  // worker show who is active right now. text/plain keeps the POST preflight-
  // free. Fire-and-forget: a failed beat never surfaces to the user.
  const TELE_SID = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  let heartbeatTimer = null;
  // Set true while this user is blocked, so callAI refuses locally too — the
  // worker already refuses the proxy, and this also covers direct calls.
  let aiBlocked = false;
  // True once the owner unlocks the admin console this session. Gates the
  // "use a better model" suggestion so it only reaches whoever can act on it.
  let ownerMode = false;
  let modelHintShown = false;

  // ---- "Answered by" attribution -------------------------------------------
  // Records which model and provider actually served the most recent request,
  // so every rendered answer can say where it came from. Set at request time
  // by callOpenAI, read by appendModelBadge right after the answer
  // renders. Calls are sequential per user action, so one slot is enough.
  let lastAIModel = '';
  let lastAIProvider = '';
  let lastAIUpgraded = false;

  function noteModelUsed(model, provider, hard) {
    lastAIModel = model || '';
    lastAIProvider = provider || '';
    // True when auto-upgrade actually swapped in the smart model for this call.
    lastAIUpgraded = !!(hard && autoUpgradeOn() && smartModel() && model === smartModel());
  }

  // Appends "🤖 <model> · <provider>" under an answer. Safe to call anywhere;
  // does nothing if no request has been made yet, and never appends twice to
  // the same container.
  function appendModelBadge(el) {
    if (!el || !lastAIModel) return;
    if (el.querySelector && el.querySelector(':scope > .gpa-model-badge')) {
      el.querySelector(':scope > .gpa-model-badge').remove();
    }
    const badge = document.createElement('div');
    badge.className = 'gpa-model-badge';
    badge.textContent = `🤖 ${lastAIModel} · ${lastAIProvider}${lastAIUpgraded ? ' · auto-upgraded for a hard task' : ''}`;
    el.appendChild(badge);
  }

  // After a hard task, nudge the owner (once) to enable auto-upgrade if it's
  // off. Only shows in owner mode — a regular user can't change the model, so
  // suggesting it to them would be noise.
  function maybeSuggestBetterModel(el) {
    if (!ownerMode || autoUpgradeOn() || modelHintShown || !el) return;
    modelHintShown = true;
    const t = THEMES[theme] || THEMES.dark;
    const note = document.createElement('div');
    note.className = 'gpa-sub';
    note.style.cssText = `margin-top:6px;font-size:10px;color:${t.sub};`;
    note.textContent = '⚡ That was a hard one. In the admin console → Power tools, turn on "Auto-upgrade on hard tasks" and set a stronger Smart model — the tool will switch to it automatically for questions like this.';
    el.appendChild(note);
  }

  function telemetryEndpoint() {
    return ((admGet(ADMIN_KEYS.TELE_ENDPOINT) || '').trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, '');
  }
  function telemetryOn() { return !!(TELEMETRY_ENABLED && telemetryEndpoint()); }

  function sendBeat(event, user) {
    if (!telemetryOn()) return;
    const payload = JSON.stringify({
      sid: TELE_SID,
      user: user || currentUser || 'anonymous',
      host: location.hostname,
      // Query strings and fragments are stripped before this leaves the
      // browser — the worker scrubs them again on arrival.
      url: scrubPageUrl(location.href),
      event: event === 'open' ? 'open' : 'beat'
    });
    try {
      // text/plain = CORS-safelisted = no preflight. keepalive lets a beat
      // sent as the tab closes still go out. X-GPA-Owner is only added when
      // an owner code is actually configured (Data tab) — for everyone else
      // this stays header-free so the no-preflight fast path is untouched;
      // only the owner's own device pays a preflight, to prove nobody else
      // can post beats/messages under the owner's username (see worker.js).
      const ownerCode = admGet(ADMIN_KEYS.OWNER_CODE);
      const beatHeaders = { 'Content-Type': 'text/plain' };
      if (ownerCode) beatHeaders['X-GPA-Owner'] = ownerCode;
      fetch(telemetryEndpoint() + '/track', {
        method: 'POST',
        headers: beatHeaders,
        body: payload,
        keepalive: true,
        mode: 'cors'
      }).then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) applyModeration(s); }).catch(() => {});
    } catch (e) { /* best-effort */ }
  }

  // While the tool is open and someone is signed in, refresh presence so the
  // owner's "active now" list is live, and poll moderation status so a
  // block/lock/kick reaches them quickly. Cleared if telemetry is off.
  function startHeartbeat() {
    if (heartbeatTimer || !telemetryOn()) return;
    heartbeatTimer = setInterval(() => { if (currentUser) sendBeat('beat'); }, 45000);
    startStatusPolling();
  }

  // ---- Owner moderation (block / lock / kick) enforcement -------------------
  // The owner sets a user's state from the admin console; every client polls
  // its own status and applies it. Honest limitation: this runs in the user's
  // own browser, so a determined user could edit it out. The real, un-editable
  // lever is the worker refusing to proxy AI for a blocked user (see worker).
  let statusTimer = null;
  let modBaselineKick = null;   // kick counter we've already acted on this load
  let reloadBaseline = null;    // owner reload counter we've already acted on
  let modOverlayEl = null;

  function startStatusPolling() {
    if (statusTimer || !telemetryOn()) return;
    statusTimer = setInterval(pollStatus, 15000);
    pollStatus();
  }
  async function pollStatus() {
    if (!telemetryOn() || !currentUser) return;
    try {
      const res = await fetch(telemetryEndpoint() + '/status?user=' + encodeURIComponent(currentUser));
      if (!res.ok) return;
      applyModeration(await res.json());
    } catch (e) { /* best-effort */ }
  }

  // /track and /status report whether the owner has assigned this account a
  // key (admin console → Control → Assign API key) — a boolean per provider,
  // never the key itself.
  //
  // An earlier version had the worker send the actual key and wrote it into
  // this browser's localStorage. That put a live API key inside whatever page
  // the console was opened on, readable by that page's own scripts, and made
  // /status?user=<name> an unauthenticated way for anyone to fetch somebody
  // else's key. Assigned keys now stay on the worker and are attached to the
  // upstream request there; all this flag does is tell the user they have
  // nothing to paste.
  function applyAssignedKeys(flags) {
    const prevOpenai = serverAssignedKeys.openai;
    serverAssignedKeys.openai = !!(flags && flags.openai);
    // Nothing to prompt for while the server is covering this user.
    if (serverAssignedKeys.openai) { try { localStorage.removeItem(OPENAI_KEY_SKIP); } catch (e) { /* ignore */ } }
    // This runs on every heartbeat/status poll (as often as every 15s), so
    // only re-check the Welcome pane's status line on an actual change —
    // otherwise that ping would run far more often than its own 10-minute
    // timer intends. A real, brand-new assignment still shows up right away.
    if (typeof checkAllAiStatus === 'function'
      && prevOpenai !== serverAssignedKeys.openai) {
      checkAllAiStatus();
    }
  }
  // Owner-set brand name (admin console → Control → Branding) replaces the
  // built-in "Agent Console" name in the header and login screen. Not
  // persisted locally — like the broadcast banner, it just reapplies from
  // the next poll, so clearing it on the owner's end reverts everyone.
  function applyBrandName(name) {
    const n = (name || '').trim() || (typeof t === 'function' ? t('Agent Console') : 'Agent Console');
    const title = panel.querySelector('.gpa-title');
    const loginCompany = panel.querySelector('.gpa-login-company');
    if (title) title.textContent = n;
    if (loginCompany) loginCompany.textContent = n;
  }
  // Owner-set default theme (same admin section) applies once for anyone who
  // has never actually picked a theme themselves — it never overrides a
  // theme the user chose, even if the owner sets a different default later.
  let appliedServerTheme = null;
  function maybeApplyServerDefaultTheme(defaultTheme) {
    if (!defaultTheme || !THEMES[defaultTheme]) return;
    if (localStorage.getItem(THEME_USER_SET_KEY) === '1') return;
    if (appliedServerTheme === defaultTheme) return;
    appliedServerTheme = defaultTheme;
    applyTheme(defaultTheme);
  }
  function applyModeration(s) {
    if (!s || typeof s !== 'object') return;
    if (s.yourStats && typeof renderYourStats === 'function') renderYourStats(s.yourStats);
    if (s.assignedKeys && typeof s.assignedKeys === 'object') applyAssignedKeys(s.assignedKeys);
    if (typeof s.brandName === 'string') applyBrandName(s.brandName);
    if (typeof s.defaultTheme === 'string') maybeApplyServerDefaultTheme(s.defaultTheme);
    if (typeof s.kickNonce === 'number') {
      // Baseline on the first status we see, so an old kick doesn't fire on
      // load — only a kick issued while this session is live boots them.
      if (modBaselineKick === null) modBaselineKick = s.kickNonce;
      else if (s.kickNonce > modBaselineKick) {
        modBaselineKick = s.kickNonce;
        doKick(s.reason);
        return;
      }
    }
    // Owner broadcast, remote reload and feature flags ride along on the same
    // status payload, so they land within one poll like moderation does.
    if (typeof s.broadcast === 'string') showBroadcast(s.broadcast);
    if (s.announcement) showAnnouncement(s.announcement);
    if (s.features && typeof s.features === 'object') applyFeatureFlags(s.features);
    if (typeof s.reloadVersion === 'number') {
      if (reloadBaseline === null) reloadBaseline = s.reloadVersion;
      else if (s.reloadVersion > reloadBaseline) {
        reloadBaseline = s.reloadVersion;
        showBroadcast('Updating to the latest version…');
        reloadInterface(panel.querySelector('#gpa-reload'));
        return;
      }
    }
    if (s.state === 'blocked') showModOverlay('blocked', s.reason);
    else if (s.state === 'locked') showModOverlay('locked', s.reason);
    else hideModOverlay();
  }

  // ---- Owner broadcast banner ----
  let broadcastText = null;   // null = never set, '' = explicitly cleared
  let broadcastEl = null;
  function showBroadcast(text) {
    if (text === broadcastText) return;   // don't rebuild on every poll
    broadcastText = text;
    if (!text) { if (broadcastEl) { broadcastEl.remove(); broadcastEl = null; } return; }
    const t = THEMES[theme] || THEMES.dark;
    if (!broadcastEl) {
      broadcastEl = document.createElement('div');
      broadcastEl.className = 'gpa-broadcast';
      panel.insertBefore(broadcastEl, panel.firstChild ? panel.firstChild.nextSibling : null);
    }
    broadcastEl.innerHTML = '';
    broadcastEl.style.cssText = `padding:7px 10px;margin:0;font:11px/1.45 ui-monospace,monospace;`
      + `background:${t.accent}1f;border-bottom:1px solid ${t.accent}66;color:${t.text};display:flex;gap:8px;align-items:flex-start;`;
    const icon = document.createElement('span'); icon.textContent = '📢';
    const msg = document.createElement('span'); msg.style.flex = '1'; msg.textContent = text;
    const x = document.createElement('span');
    x.textContent = '✕';
    x.style.cssText = `cursor:pointer;opacity:0.7;`;
    x.addEventListener('click', () => { if (broadcastEl) { broadcastEl.remove(); broadcastEl = null; } });
    broadcastEl.appendChild(icon); broadcastEl.appendChild(msg); broadcastEl.appendChild(x);
  }

  // ---- Announcement modal ----
  // Distinct from the broadcast banner: this one is a modal the user has to
  // acknowledge, for things they must not miss. Each send gets a fresh id, and
  // we remember the last id acknowledged so it shows exactly once per
  // announcement rather than on every poll.
  const ANN_SEEN_KEY = 'gpa_ann_seen';
  function showAnnouncement(ann) {
    if (!ann || !ann.id) return;
    if (localStorage.getItem(ANN_SEEN_KEY) === ann.id) return;
    if (panel.querySelector('.gpa-ann-backdrop')) return;   // one at a time
    const back = document.createElement('div');
    back.className = 'gpa-ann-backdrop';
    const card = document.createElement('div');
    card.className = 'gpa-ann-card';
    const title = document.createElement('div');
    title.className = 'gpa-ann-title';
    title.textContent = '📣 ' + (ann.title || 'Announcement');
    const text = document.createElement('div');
    text.className = 'gpa-ann-text';
    text.textContent = ann.text || '';
    const ok = document.createElement('button');
    ok.className = 'gpa-btn primary gpa-ann-ok';
    ok.textContent = 'Got it';
    ok.addEventListener('click', () => {
      try { localStorage.setItem(ANN_SEEN_KEY, ann.id); } catch (e) { /* ignore */ }
      back.remove();
    });
    card.appendChild(title); card.appendChild(text); card.appendChild(ok);
    back.appendChild(card);
    panel.appendChild(back);
  }

  // ---- Owner feature flags ----
  // A flag set to false hides that section for everyone. The owner's own panel
  // is left alone so a mistake can always be undone from the admin console.
  let featureFlags = {};
  function featureOn(name) { return featureFlags[name] !== false; }
  function applyFeatureFlags(flags) {
    if (JSON.stringify(flags) !== JSON.stringify(featureFlags)) {
      featureFlags = flags || {};
    } else if (!applyFeatureFlags.everRun) {
      // First call still has to run even if flags happen to already match
      // the initial {} default (an owner with no config set yet).
    } else {
      return;
    }
    applyFeatureFlags.everRun = true;
    refreshTabVisibility();
  }
  // Split out so unlocking the local admin panel (which flips ownerMode,
  // not the server's flags) can re-run the same show/hide pass on demand —
  // applyFeatureFlags on its own only re-runs when the SERVER'S flags
  // object actually changes, so without this an owner who unlocks admin
  // after a tab was already hidden would stay stuck looking at a hidden
  // tab until the next differing poll happened to arrive.
  function refreshTabVisibility() {
    ['games', 'music', 'browser', 'notes', 'study', 'humanize', 'grammar'].forEach((tab) => {
      const on = ownerMode || featureOn(tab);
      const item = panel.querySelector(`.gpa-dropdown-item[data-tab="${tab}"]`);
      if (item) item.style.display = on ? '' : 'none';
      const pane = panel.querySelector(`.gpa-pane[data-pane="${tab}"]`);
      // If they're sitting on a tab that just got switched off, move them back
      // to Page Insights rather than leaving a dead pane on screen.
      if (pane && !on && pane.classList.contains('active')) {
        pane.classList.remove('active');
        const scan = panel.querySelector('.gpa-pane[data-pane="scan"]');
        const scanItem = panel.querySelector('.gpa-dropdown-item[data-tab="scan"]');
        if (scan) scan.classList.add('active');
        panel.querySelectorAll('.gpa-dropdown-item').forEach((b) => b.classList.remove('active'));
        if (scanItem) {
          scanItem.classList.add('active');
          const lbl = panel.querySelector('#gpa-dropdown-label');
          if (lbl) lbl.textContent = scanItem.textContent;
        }
        if (tab === 'games') { try { stopActiveGame(); } catch (e) { /* none running */ } }
      }
    });
    // Quiz/tutor can be switched off without hiding the whole tab.
    [
      ['quiz', '#gpa-quiz-btn'], ['tutor', '#gpa-tutor-btn'],
      ['watch', '#gpa-watch-btn'], ['autofill', '[data-action="autofill"]'],
      ['research', '#gpa-research-btn']
    ].forEach(([flag, sel]) => {
      const btn = panel.querySelector(sel);
      if (!btn) return;
      const on = ownerMode || featureOn(flag);
      btn.disabled = !on;
      btn.style.opacity = on ? '' : '0.45';
      btn.title = on ? '' : 'Turned off by the owner';
    });
  }

  function showModOverlay(kind, reason) {
    const t = THEMES[theme] || THEMES.dark;
    if (getComputedStyle(panel).position === 'static') panel.style.position = 'relative';
    if (!modOverlayEl) {
      modOverlayEl = document.createElement('div');
      modOverlayEl.style.cssText = 'position:absolute;inset:0;z-index:2147483000;display:flex;'
        + 'flex-direction:column;align-items:center;justify-content:center;text-align:center;'
        + 'padding:24px;gap:10px;backdrop-filter:blur(3px);';
      panel.appendChild(modOverlayEl);
    }
    const blocked = kind === 'blocked';
    // Blocking should also cut AI use immediately, not just cover the panel.
    aiBlocked = blocked;
    modOverlayEl.style.display = 'flex';
    // Don't rebuild the DOM if nothing changed — the 15s status poll calls this
    // repeatedly, and rebuilding would wipe whatever the user is typing into
    // the unlock field and steal focus.
    const sig = kind + '|' + (reason || '');
    if (modOverlayEl._sig === sig) return;
    modOverlayEl._sig = sig;

    modOverlayEl.style.background = blocked ? 'rgba(20,4,4,0.94)' : 'rgba(10,10,16,0.92)';
    modOverlayEl.style.border = `2px solid ${blocked ? '#e5453a' : t.accent}`;
    modOverlayEl.innerHTML =
      `<div style="font-size:40px;">${blocked ? '⛔' : '🔒'}</div>`
      + `<div style="font:700 15px/1.3 ui-monospace,monospace;color:${blocked ? '#ff6b6b' : t.accent};">`
      + `${blocked ? 'Blocked by the owner' : 'Locked by the owner'}</div>`
      + `<div style="font:12px/1.5 ui-monospace,monospace;color:#e8e8ea;max-width:280px;">`
      + `${reason ? escapeHtml(reason) : (blocked ? 'Your access to this tool has been turned off.' : 'This tool is temporarily locked. Check back later.')}</div>`;

    // Only a full block offers the self-service unlock code (a lock is meant to
    // be brief and lifted by the owner).
    if (blocked) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:center;margin-top:6px;';
      const label = document.createElement('div');
      label.style.cssText = 'font:10px/1.4 ui-monospace,monospace;color:#b8b8bc;';
      label.textContent = 'Have an unlock code from the owner?';
      const inp = document.createElement('input');
      inp.placeholder = 'Unlock code';
      inp.autocomplete = 'off';
      inp.style.cssText = `text-align:center;text-transform:uppercase;letter-spacing:2px;font:13px/1 ui-monospace,monospace;`
        + `padding:7px 10px;border-radius:7px;border:1px solid ${t.accent};background:${t.field};color:${t.text};width:150px;`;
      const btn = document.createElement('button');
      btn.textContent = 'Unlock';
      btn.style.cssText = `font:11px/1 ui-monospace,monospace;padding:7px 14px;border-radius:7px;cursor:pointer;`
        + `background:${t.accent};color:#000;border:none;`;
      const msg = document.createElement('div');
      msg.style.cssText = 'font:10px/1.4 ui-monospace,monospace;color:#ff9a9a;min-height:12px;';
      const redeem = () => redeemUnlock(inp.value, msg, btn);
      btn.addEventListener('click', redeem);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
      wrap.appendChild(label); wrap.appendChild(inp); wrap.appendChild(btn); wrap.appendChild(msg);
      modOverlayEl.appendChild(wrap);
    }
  }

  async function redeemUnlock(code, msgEl, btn) {
    code = (code || '').trim();
    if (!code) { if (msgEl) msgEl.textContent = 'Enter the code first.'; return; }
    if (!currentUser) { if (msgEl) msgEl.textContent = 'Sign in first.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    try {
      const res = await fetch(telemetryEndpoint() + '/unlock', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ user: currentUser, code })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) {
        // Released. Clear the overlay immediately; the next poll confirms.
        modBaselineKick = null;
        modOverlayEl._sig = '';
        hideModOverlay();
      } else if (msgEl) {
        msgEl.style.color = '#ff9a9a';
        msgEl.textContent = (data && data.error) === 'invalid code' ? 'That code is not valid.'
          : (data && data.error) || 'Could not unlock.';
      }
    } catch (e) {
      if (msgEl) msgEl.textContent = 'Network error — try again.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
    }
  }
  function hideModOverlay() {
    aiBlocked = false;
    if (modOverlayEl) modOverlayEl.style.display = 'none';
  }
  function doKick(reason) {
    hideModOverlay();
    if (typeof closeLanguagePicker === 'function') closeLanguagePicker();
    try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) { /* ignore */ }
    currentUser = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (typeof refreshAccountUI === 'function') refreshAccountUI();
    if (loginOverlay) loginOverlay.style.display = 'flex';
    if (typeof setLockedChrome === 'function') setLockedChrome(true);
    if (typeof showLoginMsg === 'function') {
      showLoginMsg('You were signed out by the owner.' + (reason ? ' ' + reason : ''), true);
    }
  }

  // The disclosure the end user sees. Shown once per browser when telemetry is
  // active — the difference between analytics and covert tracking is that the
  // people being logged are told. Deliberately not removable by config.
  function maybeShowTelemetryNotice() {
    if (!telemetryOn()) return;
    if (admGet(ADMIN_KEYS.TELE_NOTICE_SEEN) === 'yes') return;
    try { localStorage.setItem(ADMIN_KEYS.TELE_NOTICE_SEEN, 'yes'); } catch (e) { /* ignore */ }
    const t = THEMES[theme] || THEMES.dark;
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:320px;
      background:${t.panel};color:${t.text};border:1px solid ${t.accent};border-radius:10px;
      padding:11px 13px;font:11px/1.5 ui-monospace,monospace;box-shadow:0 8px 26px rgba(0,0,0,0.5);`;
    toast.textContent = 'Heads up: this assistant records basic usage (the profile name you sign in with and when you open it) for its owner. Nothing you type is sent.';
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.style.cssText = `display:block;margin-top:8px;margin-left:auto;font:11px/1 inherit;
      padding:4px 12px;border-radius:6px;cursor:pointer;background:transparent;color:${t.text};border:1px solid ${t.accent};`;
    ok.addEventListener('click', () => toast.remove());
    toast.appendChild(ok);
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
  }

  // ---- Admin console --------------------------------------------------------
  (function adminConsole() {
    const adminBox = panel.querySelector('#gpa-admin');
    const heading = panel.querySelector('#gpa-account-heading');
    if (!adminBox || !heading) return;
    let adminUnlocked = false;   // resets every injection — PIN is required each session

    // Reality check shown inside the panel, so the owner is never misled about
    // what this actually protects.
    const reality = panel.querySelector('#gpa-admin-reality');
    if (reality) {
      reality.className = 'gpa-admin-note';
      reality.textContent = 'Reality check: this PIN and every setting here live in your browser. '
        + 'Anyone who reads the script source can see the PIN, and anyone with DevTools can open this. '
        + 'Treat it as a personal dashboard and a soft lock — not real security. Do not put anything truly sensitive behind it.';
    }

    // ---- Hidden trigger: five quick clicks on the "Account & sync" heading ----
    let clicks = 0, clickTimer = null;
    heading.addEventListener('click', () => {
      if (adminUnlocked) return;
      clicks++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { clicks = 0; }, 1200);
      if (clicks >= 5) {
        clicks = 0;
        const pin = prompt('Enter admin PIN:');
        if (pin === null) return;
        if (pin.trim() === ADMIN_PIN) { adminUnlocked = true; openAdmin(); }
        else showToast('Incorrect PIN.', { type: 'danger' });
      }
    });

    function openAdmin() {
      adminBox.style.display = 'block';
      ownerMode = true;
      // A tab the owner's own feature flags hid earlier in this session
      // needs to reappear now, not wait for the next status poll.
      if (typeof refreshTabVisibility === 'function') refreshTabVisibility();
      loadPowerToolFields();
      loadTelemetryFields();
      renderUsage();
      adminBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    panel.querySelector('#gpa-admin-lock').addEventListener('click', () => {
      adminUnlocked = false;
      adminBox.style.display = 'none';
    });

    // ---- Admin tab switching ----
    adminBox.querySelectorAll('.gpa-admin-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        adminBox.querySelectorAll('.gpa-admin-tab').forEach((x) => x.classList.toggle('primary', x === tab));
        const name = tab.dataset.atab;
        adminBox.querySelectorAll('.gpa-admin-pane').forEach((p) => p.classList.toggle('active', p.dataset.apane === name));
        if (name === 'usage') renderUsage();
        if (name === 'data') { renderLsEditor(); renderKeyManager(); }
        if (name === 'diag') runDiagnostics();
        if (name === 'control') renderRooms();
      });
    });

    // ---- Usage pane ----
    function fmtTime(ts) { return new Date(ts).toLocaleString(); }
    function renderUsage() {
      const logs = readLogs();
      const opens = logs.filter((l) => l.ev === 'open');
      const users = {};
      opens.forEach((l) => {
        const u = l.u || '(anonymous)';
        if (!users[u]) users[u] = { count: 0, first: l.ts, last: l.ts };
        users[u].count++;
        users[u].first = Math.min(users[u].first, l.ts);
        users[u].last = Math.max(users[u].last, l.ts);
      });
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todayOpens = opens.filter((l) => l.ts >= startOfDay.getTime()).length;

      const stats = [
        { n: opens.length, l: 'Total opens' },
        { n: Object.keys(users).length, l: 'Unique users' },
        { n: todayOpens, l: 'Opens today' },
        { n: logs.length, l: 'Log entries' }
      ];
      panel.querySelector('#gpa-admin-stats').innerHTML = stats.map((s) =>
        `<div class="gpa-admin-statcard"><span class="n">${s.n}</span><div class="l">${escapeHtml(s.l)}</div></div>`).join('');

      const userRows = Object.keys(users).sort((a, b) => users[b].last - users[a].last).map((u) => {
        const info = users[u];
        return `<div class="gpa-admin-userrow"><b>${escapeHtml(u)}</b>`
          + `<span>${info.count}× · last ${escapeHtml(fmtTime(info.last))}</span></div>`;
      }).join('');
      panel.querySelector('#gpa-admin-users').innerHTML = userRows || '<div class="gpa-sub">No sign-ins recorded on this browser yet.</div>';

      const logRows = logs.slice().reverse().slice(0, 120).map((l) =>
        `<div class="gpa-admin-logrow"><span class="ev"><b>${escapeHtml(l.u || '?')}</b> · ${escapeHtml(l.ev)} · ${escapeHtml(l.host || '')}</span>`
        + `<span class="t">${escapeHtml(fmtTime(l.ts))}</span></div>`).join('');
      panel.querySelector('#gpa-admin-log').innerHTML = logRows || '<div class="gpa-sub">Nothing logged yet.</div>';
    }
    panel.querySelector('#gpa-admin-refresh').addEventListener('click', renderUsage);
    panel.querySelector('#gpa-admin-clear-logs').addEventListener('click', () => {
      if (!confirm('Clear the local usage log on this browser? (Remote telemetry logs are not affected.)')) return;
      writeLogs([]);
      renderUsage();
    });
    panel.querySelector('#gpa-admin-export-logs').addEventListener('click', () => {
      const blob = JSON.stringify(readLogs(), null, 2);
      navigator.clipboard.writeText(blob).then(
        () => showToast('Usage log copied to clipboard as JSON.'),
        () => { const w = window.open('', '_blank'); if (w) w.document.write('<pre>' + escapeHtml(blob) + '</pre>'); }
      );
    });

    // ---- Live users (worker telemetry) ----
    const teleToken = panel.querySelector('#gpa-tele-token');
    const teleEndpoint = panel.querySelector('#gpa-tele-endpoint');
    const teleMsg = panel.querySelector('#gpa-tele-msg');
    const teleLive = panel.querySelector('#gpa-tele-live');
    const teleAutoBtn = panel.querySelector('#gpa-tele-auto');
    let teleAutoTimer = null;

    function loadTelemetryFields() {
      // Deliberately session-only: the token is never written to disk, so it
      // comes back blank after a reload (see sessionSecrets).
      teleToken.value = sessionSecrets.adminToken || '';
      teleEndpoint.value = admGet(ADMIN_KEYS.TELE_ENDPOINT) || '';
      teleEndpoint.placeholder = 'Worker URL (blank = ' + (TELEMETRY_ENDPOINT || 'none') + ')';
    }
    function saveTeleFields() {
      admSetSecret(ADMIN_KEYS.TELE_TOKEN, teleToken.value.trim());
      localStorage.setItem(ADMIN_KEYS.TELE_ENDPOINT, teleEndpoint.value.trim());
    }
    teleToken.addEventListener('change', saveTeleFields);
    teleEndpoint.addEventListener('change', saveTeleFields);

    function ago(ms) {
      const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
      if (s < 60) return s + 's ago';
      const m = Math.round(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.round(m / 60);
      return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
    }
    function timeLeft(untilMs) {
      const s = Math.max(0, Math.round((untilMs - Date.now()) / 1000));
      if (s < 60) return s + 's left';
      const m = Math.round(s / 60);
      if (m < 60) return m + 'm left';
      const h = Math.round(m / 60);
      return h < 24 ? h + 'h left' : Math.round(h / 24) + 'd left';
    }
    function stateBadge(state, owner) {
      if (owner) return '<span style="color:#22c55e;font-weight:700;">👑 OWNER · immune</span>';
      if (state === 'blocked') return '<span style="color:#ff6b6b;font-weight:700;">⛔ blocked</span>';
      if (state === 'locked') return '<span style="color:#eab308;font-weight:700;">🔒 locked</span>';
      return '';
    }
    // The moderation buttons for one user, keyed by username via data-attrs.
    function modButtons(user, state, owner, hasKey, extra) {
      if (owner) return '';   // the owner can't be moderated
      extra = extra || {};
      const b = (action, label, title) =>
        `<button class="gpa-btn gpa-mod-btn" data-mod-user="${escapeHtml(user)}" data-mod-action="${action}" title="${title}"`
        + ` style="font-size:9px;padding:2px 6px;">${label}</button>`;
      const parts = [];
      if (state === 'blocked') {
        parts.push(b('unblock', '✅ Unblock', 'Restore access'));
        parts.push(b('code', '🔑 Code', 'Generate a one-time code this user can enter to unlock themselves'));
      } else {
        parts.push(b('block', '⛔ Block', 'Blocked-by-owner page + cut off AI'));
      }
      if (state === 'locked') parts.push(b('unlock', '🔓 Unlock', 'Remove the lock'));
      else if (state !== 'blocked') parts.push(b('lock', '🔒 Lock', 'Temporarily freeze their panel'));
      parts.push(b('assignkey', hasKey ? '🔑 Change key' : '🔑 Assign key', 'Give this OpenAI key to this user only — applied server-side, they never see it. Leave blank to remove it.'));
      parts.push(b('kick', '👢 Kick', 'Force a one-time sign-out'));
      // Timed mute / strikes
      parts.push(b('mute', extra.muted ? '🔇 Mute again' : '🔇 Mute', 'Block them for N hours, then auto-restore — no manual unblock needed'));
      if (extra.muted) parts.push(b('unmute', '🔈 Unmute', 'Lift the timed mute early'));
      parts.push(b('warn', `⚠️ Warn${extra.strikes ? ` (${extra.strikes}/3)` : ''}`, '3 warnings auto-applies a 24h mute and resets the count'));
      if (extra.strikes) parts.push(b('clearstrikes', '🧹 Clear strikes', 'Reset their warning count to 0'));
      // Approval queue
      if (extra.pending) parts.push(b('approve', '✅ Approve', 'Let them use AI features — they were held for approval'));
      else parts.push(b('unapprove', '⏸ Hold for approval', 'Re-flag them as pending — cuts off AI until approved again'));
      // AI freeze (chat/read still work)
      parts.push(b(extra.aiFrozen ? 'unfreezeai' : 'freezeai', extra.aiFrozen ? '🧊 Unfreeze AI' : '🧊 Freeze AI', 'Cuts off only AI features — chat and page-reading keep working'));
      // Shadow mute
      parts.push(b(extra.shadowMuted ? 'unshadowmute' : 'shadowmute', extra.shadowMuted ? '👻 Unshadow' : '👻 Shadow-mute', 'Their chat messages appear to send but nobody (including them, on another device) ever sees them'));
      parts.push(b('setfeatures', '🎛 Features…', 'Per-user feature overrides — turn a specific tool on/off for just this person'));
      return `<div class="gpa-row" style="gap:4px;margin-top:4px;flex-wrap:wrap;">${parts.join('')}</div>`;
    }
    function updatePrivateBtn(on) {
      const btn = panel.querySelector('#gpa-tele-private');
      btn.textContent = on ? '🔒 Private mode: ON (only the owner)' : '🌍 Private mode: OFF (everyone allowed)';
      btn.classList.toggle('primary', on);
      btn.dataset.on = on ? '1' : '0';
    }
    function renderLive(data) {
      const active = data.active || [];
      const users = data.users || [];
      updatePrivateBtn(!!data.privateMode);
      const dot = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:5px;box-shadow:0 0 6px #22c55e;"></span>';
      const extraBadges = (x) => {
        const bits = [];
        if (x.pending) bits.push('<span title="Awaiting approval" style="color:#eab308;">⏸ pending</span>');
        if (x.muted) bits.push(`<span title="Timed mute">🔇 muted${x.mutedUntil ? ' (' + timeLeft(x.mutedUntil) + ')' : ''}</span>`);
        if (x.strikes) bits.push(`<span title="Warning strikes">⚠️ ${x.strikes}/3</span>`);
        if (x.aiFrozen) bits.push('<span title="AI access frozen">🧊 AI frozen</span>');
        if (x.shadowMuted) bits.push('<span title="Shadow muted">👻 shadow</span>');
        return bits.length ? ' ' + bits.join(' ') : '';
      };
      const row = (name, meta, state, owner, hasKey, extra) =>
        `<div class="gpa-admin-userrow" style="flex-direction:column;align-items:stretch;">`
        + `<div class="gpa-row" style="justify-content:space-between;gap:8px;">`
        + `<span>${dot}<b>${escapeHtml(name)}</b> ${stateBadge(state, owner)}${hasKey ? ' <span title="Has an owner-assigned OpenAI key" style="opacity:0.85;">🔑</span>' : ''}${extraBadges(extra || {})}</span>`
        + `<span style="opacity:0.8;">${escapeHtml(meta)}</span></div>`
        + modButtons(name, state, owner, hasKey, extra) + `</div>`;
      const quotaSuffix = (n, cap) => cap ? ` · ${n || 0}/${cap} today` : (n ? ` · ${n} today` : '');
      const activeRows = active.map((s) =>
        row(s.user, [s.host, s.region, s.country].filter(Boolean).join(' · ') + ' · ' + ago(s.lastSeen) + quotaSuffix(s.requestsToday, data.dailyQuota), s.state, s.owner, s.hasOpenAiKey, s)).join('');
      const userRows = users.map((u) =>
        row(u.user, (u.opens || 0) + '× · ' + [u.country, u.region].filter(Boolean).join(' · ') + ' · last ' + ago(u.lastSeen) + quotaSuffix(u.requestsToday, data.dailyQuota), u.state, u.owner, u.hasOpenAiKey, u)).join('');
      teleLive.innerHTML =
        `<div class="gpa-admin-statcard" style="margin-bottom:8px;"><span class="n">${data.activeCount || 0}</span><div class="l">active right now</div></div>`
        + (data.dailyQuota ? `<div class="gpa-sub" style="margin:4px 0;">Daily request cap: ${data.dailyQuota}/user${data.allOpenaiKeyed ? ' · 🔑 OpenAI key assigned to everyone' : ''}</div>` : (data.allOpenaiKeyed ? `<div class="gpa-sub" style="margin:4px 0;">🔑 OpenAI key assigned to everyone</div>` : ''))
        + `<div class="gpa-sub" style="margin:4px 0;">Active now</div>`
        + `<div class="gpa-admin-users">${activeRows || '<div class="gpa-sub">Nobody active in the last few minutes.</div>'}</div>`
        + `<div class="gpa-sub" style="margin:10px 0 4px;">Everyone who has ever opened it (${users.length})</div>`
        + `<div class="gpa-admin-users">${userRows || '<div class="gpa-sub">No users recorded yet.</div>'}</div>`;
    }

    // Mints a one-time unlock code the owner can hand to one blocked user.
    async function genUnlockCode(user) {
      const token = teleToken.value.trim();
      const base = (teleEndpoint.value.trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, '');
      if (!token || !base) { teleMsg.textContent = 'Set the worker URL and admin token first.'; return; }
      teleMsg.textContent = 'Generating code for ' + user + '…';
      try {
        const res = await fetch(base + '/admin/setunlock', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }), body: JSON.stringify({ user })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.code) throw new Error(data.error || ('HTTP ' + res.status));
        try { await navigator.clipboard.writeText(data.code); } catch (e) { /* clipboard optional */ }
        teleMsg.innerHTML = `Unlock code for <b>${escapeHtml(user)}</b>: `
          + `<span style="font-family:ui-monospace,monospace;letter-spacing:2px;color:${(THEMES[theme] || THEMES.dark).accent};">${escapeHtml(data.code)}</span>`
          + ` — copied. Give it to them; it works once and unlocks only them.`;
      } catch (e) {
        teleMsg.textContent = 'Could not make a code: ' + e.message;
      }
    }

    // Assigns (or clears, on a blank entry) a specific OpenAI key to one
    // user. Stored server-side only — it's applied to that user's proxied
    // OpenAI calls regardless of what key (if any) their own browser has,
    // and their browser never receives or stores the value itself.
    async function assignKey(user) {
      const token = teleToken.value.trim();
      const base = (teleEndpoint.value.trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, '');
      if (!token || !base) { teleMsg.textContent = 'Set the worker URL and admin token first.'; return; }
      const key = (prompt(`Paste the OpenAI API key to assign to ${user} (leave blank to remove their assigned key):`, '') || '').trim();
      teleMsg.textContent = (key ? 'Assigning key to ' : 'Removing key from ') + user + '…';
      try {
        const res = await fetch(base + '/admin/assignkey', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }),
          body: JSON.stringify({ user, key })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        teleMsg.textContent = data.assigned ? `${user} now has an assigned OpenAI key.` : `Removed ${user}'s assigned OpenAI key.`;
        loadLive();
      } catch (e) {
        teleMsg.textContent = 'Could not assign key: ' + e.message;
      }
    }

    // One delegated handler for every moderation button.
    async function moderate(user, action) {
      if (action === 'code') { genUnlockCode(user); return; }
      if (action === 'assignkey') { assignKey(user); return; }
      const token = teleToken.value.trim();
      const base = (teleEndpoint.value.trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, '');
      if (!token || !base) { teleMsg.textContent = 'Set the worker URL and admin token first.'; return; }
      let reason = '';
      if (action === 'block' || action === 'lock' || action === 'kick') {
        reason = prompt(`Message to show ${user} (optional):`, '') || '';
      }
      let extraBody = {};
      if (action === 'mute') {
        const hoursStr = prompt(`Mute ${user} for how many hours? (e.g. 1, 0.5, 24)`, '1');
        if (hoursStr === null) return;
        const hours = parseFloat(hoursStr);
        if (!(hours > 0)) { teleMsg.textContent = 'Enter a positive number of hours.'; return; }
        extraBody.hours = hours;
        reason = prompt(`Reason to show ${user} (optional):`, '') || '';
      } else if (action === 'setfeatures') {
        const raw = prompt(
          `Per-user feature overrides for ${user}, as JSON (true/false per key — quiz, tutor, games, music, browser, notes, study, watch, autofill, research). Example: {"quiz":false,"games":false}`,
          '{}'
        );
        if (raw === null) return;
        let features;
        try { features = JSON.parse(raw); } catch (e) { teleMsg.textContent = 'That was not valid JSON.'; return; }
        if (!features || typeof features !== 'object' || Array.isArray(features)) { teleMsg.textContent = 'Expected a JSON object like {"quiz":false}.'; return; }
        extraBody.features = features;
      }
      teleMsg.textContent = `${action} ${user}…`;
      try {
        const res = await fetch(base + '/admin/moderate', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }),
          body: JSON.stringify({ user, action, reason, ...extraBody })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        teleMsg.textContent = `${user}: ${action} done.`;
        loadLive();
      } catch (e) {
        teleMsg.textContent = 'Action failed: ' + e.message;
      }
    }
    teleLive.addEventListener('click', (e) => {
      const btn = e.target.closest('.gpa-mod-btn');
      if (!btn) return;
      moderate(btn.dataset.modUser, btn.dataset.modAction);
    });
    async function loadLive() {
      saveTeleFields();
      const token = teleToken.value.trim();
      const base = (teleEndpoint.value.trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, '');
      if (!base) { teleMsg.textContent = 'No worker URL configured.'; return; }
      if (!token) { teleMsg.textContent = 'Enter your admin token (the worker\'s ADMIN_TOKEN).'; return; }
      teleMsg.textContent = 'Loading…';
      try {
        const res = await fetch(base + '/admin/summary', { headers: adminAuthHeaders(token) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        renderLive(data);
        teleMsg.textContent = `Updated ${new Date().toLocaleTimeString()} · ${data.activeCount || 0} active, ${(data.users || []).length} total.`;
      } catch (e) {
        teleMsg.textContent = 'Could not load: ' + e.message
          + (/unauthorized/i.test(e.message) ? ' (token doesn\'t match the worker\'s ADMIN_TOKEN)' : '')
          + (/not set|not bound/i.test(e.message) ? ' — finish the worker setup in the README.' : '');
      }
    }
    panel.querySelector('#gpa-tele-refresh').addEventListener('click', loadLive);
    panel.querySelector('#gpa-tele-private').addEventListener('click', async () => {
      const token = teleToken.value.trim();
      const base = (teleEndpoint.value.trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, '');
      if (!token || !base) { teleMsg.textContent = 'Set the worker URL and admin token first.'; return; }
      const turningOn = panel.querySelector('#gpa-tele-private').dataset.on !== '1';
      if (turningOn && !confirm('Turn on private mode? Everyone except the owner will be blocked from using the tool.')) return;
      teleMsg.textContent = turningOn ? 'Enabling private mode…' : 'Disabling private mode…';
      try {
        const res = await fetch(base + '/admin/config', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }), body: JSON.stringify({ privateMode: turningOn })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        updatePrivateBtn(!!(data.config && data.config.privateMode));
        teleMsg.textContent = (data.config && data.config.privateMode)
          ? `Private mode ON. Only "${(data.owner || 'the owner')}" can use the tool now; everyone else sees the blocked page within ~15s.`
          : 'Private mode OFF. Everyone can use the tool again (except anyone individually blocked).';
        loadLive();
      } catch (e) {
        teleMsg.textContent = 'Could not change private mode: ' + e.message;
      }
    });
    teleAutoBtn.addEventListener('click', () => {
      if (teleAutoTimer) {
        clearInterval(teleAutoTimer); teleAutoTimer = null;
        teleAutoBtn.textContent = '▶ Auto-refresh: OFF';
        teleAutoBtn.classList.remove('primary');
      } else {
        loadLive();
        teleAutoTimer = setInterval(loadLive, 15000);
        teleAutoBtn.textContent = '⏸ Auto-refresh: ON';
        teleAutoBtn.classList.add('primary');
      }
    });
    // Stop auto-refresh when the admin panel is locked, so it doesn't poll
    // forever in the background.
    panel.querySelector('#gpa-admin-lock').addEventListener('click', () => {
      if (teleAutoTimer) { clearInterval(teleAutoTimer); teleAutoTimer = null; teleAutoBtn.textContent = '▶ Auto-refresh: OFF'; teleAutoBtn.classList.remove('primary'); }
    });

    // ---- Control tab: things pushed to every client ----
    const controlMsg = panel.querySelector('#gpa-adm-control-msg');
    function adminBase() { return (teleEndpoint.value.trim() || TELEMETRY_ENDPOINT || '').replace(/\/+$/, ''); }
    async function postConfig(body, okMsg) {
      const token = teleToken.value.trim();
      const base = adminBase();
      if (!token || !base) { controlMsg.textContent = 'Set the worker URL and admin token on the Usage tab first.'; return null; }
      controlMsg.textContent = 'Sending…';
      try {
        const res = await fetch(base + '/admin/config', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }), body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        controlMsg.textContent = okMsg || 'Done.';
        return data.config || {};
      } catch (e) {
        controlMsg.textContent = 'Failed: ' + e.message;
        return null;
      }
    }
    const FLAGS = [
      ['quiz', 'Quiz solver'], ['tutor', 'Tutor mode'], ['games', 'Games'],
      ['music', 'Music'], ['browser', 'Proxy'], ['notes', 'Notes'], ['study', 'Study'],
      ['watch', 'Page watcher'], ['autofill', 'Form auto-fill'], ['research', 'Research mode']
    ];
    let knownFlags = {};
    function renderFlags() {
      const wrap = panel.querySelector('#gpa-adm-flags');
      wrap.innerHTML = '';
      FLAGS.forEach(([key, label]) => {
        const on = knownFlags[key] !== false;
        const b = document.createElement('button');
        b.className = 'gpa-btn' + (on ? ' primary' : '');
        b.style.fontSize = '10px';
        b.textContent = (on ? '✓ ' : '✕ ') + label;
        b.addEventListener('click', async () => {
          const cfg = await postConfig({ features: { [key]: !on } }, `${label} ${on ? 'turned off' : 'turned back on'} for everyone.`);
          if (cfg) { knownFlags = cfg.features || {}; renderFlags(); }
        });
        wrap.appendChild(b);
      });
    }
    renderFlags();
    panel.querySelector('#gpa-adm-broadcast-send').addEventListener('click', async () => {
      const text = panel.querySelector('#gpa-adm-broadcast').value.trim();
      if (!text) { controlMsg.textContent = 'Type a message first.'; return; }
      await postConfig({ broadcast: text }, 'Broadcast sent — everyone sees it within ~15s.');
    });
    panel.querySelector('#gpa-adm-broadcast-clear').addEventListener('click', async () => {
      panel.querySelector('#gpa-adm-broadcast').value = '';
      await postConfig({ broadcast: '' }, 'Banner cleared.');
    });
    // ---- Announcement popup ----
    panel.querySelector('#gpa-adm-ann-send').addEventListener('click', async () => {
      const title = panel.querySelector('#gpa-adm-ann-title').value.trim() || 'Announcement';
      const text = panel.querySelector('#gpa-adm-ann-text').value.trim();
      if (!text) { controlMsg.textContent = 'Write the announcement first.'; return; }
      await postConfig({ announcement: { title, text } }, 'Popup sent — everyone sees it within ~15s and has to dismiss it.');
    });
    panel.querySelector('#gpa-adm-ann-clear').addEventListener('click', async () => {
      panel.querySelector('#gpa-adm-ann-text').value = '';
      await postConfig({ announcement: null }, 'Announcement cleared.');
    });

    panel.querySelector('#gpa-adm-brand-save').addEventListener('click', async () => {
      const brandName = panel.querySelector('#gpa-adm-brand').value.trim();
      const defaultTheme = panel.querySelector('#gpa-adm-def-theme').value;
      const dailyQuota = parseInt(panel.querySelector('#gpa-adm-quota').value, 10) || 0;
      await postConfig({ brandName, defaultTheme, dailyQuota }, 'Saved — takes effect for everyone within ~15s.');
    });

    // ---- Chat & access controls (read-only, approval queue, country/model/token/origin limits) ----
    const readOnlyBtn = panel.querySelector('#gpa-adm-readonly');
    const approvalBtn = panel.querySelector('#gpa-adm-approval');
    function toggleBtnState(btn, on, onLabel, offLabel) {
      btn.textContent = on ? onLabel : offLabel;
      btn.classList.toggle('primary', on);
      btn.dataset.on = on ? '1' : '0';
    }
    toggleBtnState(readOnlyBtn, false, '📢 Read-only chat: ON', '📢 Read-only chat: OFF');
    toggleBtnState(approvalBtn, false, '🚪 Approval queue: ON', '🚪 Approval queue: OFF');
    readOnlyBtn.addEventListener('click', async () => {
      const turningOn = readOnlyBtn.dataset.on !== '1';
      if (turningOn && !confirm('Make chat read-only for everyone except you?')) return;
      const cfg = await postConfig({ readOnly: turningOn }, turningOn ? 'Chat is now read-only for everyone but you.' : 'Chat is open again.');
      if (cfg) toggleBtnState(readOnlyBtn, !!cfg.readOnly, '📢 Read-only chat: ON', '📢 Read-only chat: OFF');
    });
    approvalBtn.addEventListener('click', async () => {
      const turningOn = approvalBtn.dataset.on !== '1';
      const cfg = await postConfig({ approvalMode: turningOn }, turningOn ? 'New usernames will now be held for approval.' : 'New usernames no longer need approval.');
      if (cfg) toggleBtnState(approvalBtn, !!cfg.approvalMode, '🚪 Approval queue: ON', '🚪 Approval queue: OFF');
    });
    panel.querySelector('#gpa-adm-access-save').addEventListener('click', async () => {
      const csvList = (id) => panel.querySelector(id).value.split(',').map((s) => s.trim()).filter(Boolean);
      const blockedCountries = csvList('#gpa-adm-blockedcountries');
      const allowedModels = csvList('#gpa-adm-allowedmodels');
      const allowedOrigins = csvList('#gpa-adm-allowedorigins');
      const maxTokens = parseInt(panel.querySelector('#gpa-adm-maxtokens').value, 10) || 0;
      await postConfig({ blockedCountries, allowedModels, allowedOrigins, maxTokens }, 'Access controls saved — takes effect within ~15s.');
    });

    // ---- Audit log ----
    panel.querySelector('#gpa-adm-audit-load').addEventListener('click', async () => {
      const out = panel.querySelector('#gpa-adm-audit');
      const token = teleToken.value.trim();
      const base = adminBase();
      if (!token || !base) { controlMsg.textContent = 'Set the worker URL and admin token on the Usage tab first.'; return; }
      out.innerHTML = '<div class="gpa-sub">Loading…</div>';
      try {
        const res = await fetch(base + '/admin/audit', { headers: adminAuthHeaders(token) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        out.innerHTML = data.entries.length ? data.entries.map((e) =>
          `<div class="gpa-admin-logrow"><span class="t">${escapeHtml(new Date(e.ts).toLocaleString())}</span>`
          + `<span class="ev"><b>${escapeHtml(e.admin || '?')}</b> → ${escapeHtml(e.action)} on ${escapeHtml(e.route)}${e.target ? ' (' + escapeHtml(String(e.target)) + ')' : ''}</span></div>`
        ).join('') : '<div class="gpa-sub">No admin actions logged yet.</div>';
      } catch (e) {
        out.innerHTML = '';
        controlMsg.textContent = 'Could not load audit log: ' + e.message;
      }
    });

    // ---- Full backup / restore ----
    panel.querySelector('#gpa-adm-backup-dl').addEventListener('click', async () => {
      const token = teleToken.value.trim();
      const base = adminBase();
      if (!token || !base) { controlMsg.textContent = 'Set the worker URL and admin token on the Usage tab first.'; return; }
      controlMsg.textContent = 'Preparing backup…';
      try {
        const res = await fetch(base + '/admin/backup', { headers: adminAuthHeaders(token) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `agent-console-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        controlMsg.textContent = 'Backup downloaded.';
      } catch (e) {
        controlMsg.textContent = 'Backup failed: ' + e.message;
      }
    });
    const restoreFileInput = panel.querySelector('#gpa-adm-restore-file');
    panel.querySelector('#gpa-adm-restore-btn').addEventListener('click', () => restoreFileInput.click());
    restoreFileInput.addEventListener('change', async () => {
      const file = restoreFileInput.files && restoreFileInput.files[0];
      restoreFileInput.value = '';
      if (!file) return;
      if (!confirm(`Restore from "${file.name}"? This overwrites any matching records currently on the worker.`)) return;
      const token = teleToken.value.trim();
      const base = adminBase();
      if (!token || !base) { controlMsg.textContent = 'Set the worker URL and admin token on the Usage tab first.'; return; }
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const res = await fetch(base + '/admin/restore', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }), body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        controlMsg.textContent = `Restored ${data.restored} record(s).`;
        loadLive();
      } catch (e) {
        controlMsg.textContent = 'Restore failed: ' + e.message;
      }
    });

    // ---- Assign an API key remotely (one person, several, or everyone) ----
    const keyTargetSel = panel.querySelector('#gpa-adm-key-target');
    const keyUsersRow = panel.querySelector('#gpa-adm-key-users-row');
    function syncKeyTargetUI() { keyUsersRow.style.display = keyTargetSel.value === 'all' ? 'none' : 'flex'; }
    syncKeyTargetUI();
    keyTargetSel.addEventListener('change', syncKeyTargetUI);
    async function assignKeyRemote(removing) {
      const msg = panel.querySelector('#gpa-adm-key-msg');
      const token = teleToken.value.trim();
      const base = adminBase();
      if (!token || !base) { msg.textContent = 'Set the worker URL and admin token on the Usage tab first.'; return; }
      const provider = 'openai';
      const all = keyTargetSel.value === 'all';
      const users = all ? [] : panel.querySelector('#gpa-adm-key-users').value.split(',').map((u) => u.trim()).filter(Boolean);
      if (!all && !users.length) { msg.textContent = 'Enter at least one username, or switch the target to Everyone.'; return; }
      const key = removing ? '' : panel.querySelector('#gpa-adm-key-value').value.trim();
      if (!removing && !key) { msg.textContent = 'Paste the key to assign, or use "Remove instead".'; return; }
      msg.textContent = (removing ? 'Removing' : 'Assigning') + '…';
      try {
        const res = await fetch(base + '/admin/assignkey', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }),
          body: JSON.stringify({ provider, all, users, key })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        const who = all ? 'everyone' : users.join(', ');
        msg.textContent = removing
          ? `Removed ${provider} key from ${who}.`
          : `${provider} key assigned to ${who} — reaches their browser within ~15s.`;
        if (!removing) panel.querySelector('#gpa-adm-key-value').value = '';
      } catch (e) {
        msg.textContent = 'Failed: ' + e.message;
      }
    }
    panel.querySelector('#gpa-adm-key-assign').addEventListener('click', () => assignKeyRemote(false));
    panel.querySelector('#gpa-adm-key-remove').addEventListener('click', () => assignKeyRemote(true));

    // ---- Private chat rooms ----
    async function roomsApi(body) {
      const token = teleToken.value.trim();
      const base = adminBase();
      if (!token || !base) { controlMsg.textContent = 'Set the worker URL and admin token on the Usage tab first.'; return null; }
      try {
        const res = await fetch(base + '/admin/rooms', {
          method: 'POST', headers: adminAuthHeaders(token, { 'Content-Type': 'text/plain' }), body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      } catch (e) { controlMsg.textContent = 'Room action failed: ' + e.message; return null; }
    }
    // Slow mode + ban/unban buttons shared by the public row and every
    // private room row.
    function addRoomModButtons(btns, id, label) {
      const slow = document.createElement('button');
      slow.className = 'gpa-btn'; slow.style.fontSize = '9px'; slow.textContent = '⏱ Slow mode';
      slow.title = 'Seconds between messages per user in this room (0 = off)';
      slow.addEventListener('click', async () => {
        const secStr = prompt(`Slow mode for ${label} — seconds between messages (0 = off):`, '0');
        if (secStr === null) return;
        const seconds = Math.max(0, parseInt(secStr, 10) || 0);
        const d = await roomsApi({ action: 'slowmode', id, seconds });
        if (!d) return;
        controlMsg.textContent = seconds ? `${label}: slow mode set to ${seconds}s.` : `${label}: slow mode off.`;
      });
      const ban = document.createElement('button');
      ban.className = 'gpa-btn'; ban.style.fontSize = '9px'; ban.textContent = '🚫 Ban…';
      ban.title = 'Ban a username from this room only — they can still use every other room';
      ban.addEventListener('click', async () => {
        const target = (prompt(`Ban which username from ${label}?`, '') || '').trim();
        if (!target) return;
        const d = await roomsApi({ action: 'banuser', id, user: target });
        if (!d) return;
        controlMsg.textContent = `Banned ${target} from ${label}.`;
      });
      const unban = document.createElement('button');
      unban.className = 'gpa-btn'; unban.style.fontSize = '9px'; unban.textContent = '✅ Unban…';
      unban.addEventListener('click', async () => {
        const target = (prompt(`Unban which username from ${label}?`, '') || '').trim();
        if (!target) return;
        const d = await roomsApi({ action: 'unbanuser', id, user: target });
        if (!d) return;
        controlMsg.textContent = `Unbanned ${target} from ${label}.`;
      });
      btns.appendChild(slow); btns.appendChild(ban); btns.appendChild(unban);
    }
    async function renderRooms() {
      const wrap = panel.querySelector('#gpa-adm-rooms');
      const data = await roomsApi({ action: 'list' });
      if (!data) return;
      wrap.innerHTML = '';
      // Public room: always exists, gets the same moderation tools as a
      // private room, just no code/delete (it can't be deleted).
      const publicRow = document.createElement('div');
      publicRow.className = 'gpa-admin-userrow';
      publicRow.style.flexDirection = 'column'; publicRow.style.alignItems = 'stretch'; publicRow.style.gap = '4px';
      const publicHead = document.createElement('span');
      publicHead.innerHTML = '# <b>public</b>';
      const publicBtns = document.createElement('div');
      publicBtns.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
      addRoomModButtons(publicBtns, 'public', '# public');
      publicRow.appendChild(publicHead); publicRow.appendChild(publicBtns);
      wrap.appendChild(publicRow);
      if (!data.rooms.length) return;
      data.rooms.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'gpa-admin-userrow';
        row.style.flexDirection = 'column'; row.style.alignItems = 'stretch'; row.style.gap = '4px';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
        const left = document.createElement('span');
        left.innerHTML = `🔒 <b>${escapeHtml(r.name)}</b> <span style="opacity:0.6">${escapeHtml(r.id)}</span>`;
        const btns = document.createElement('span');
        btns.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
        const code = document.createElement('button');
        code.className = 'gpa-btn'; code.style.fontSize = '9px'; code.textContent = '🔑 New code';
        code.addEventListener('click', async () => {
          const d = await roomsApi({ action: 'newcode', id: r.id });
          if (!d) return;
          try { await navigator.clipboard.writeText(d.code); } catch (e) { /* optional */ }
          controlMsg.innerHTML = `Code for <b>${escapeHtml(r.name)}</b>: `
            + `<span style="font-family:ui-monospace,monospace;letter-spacing:2px;color:${(THEMES[theme] || THEMES.dark).accent}">${escapeHtml(d.code)}</span>`
            + ' — copied. Anyone with it can join; the old code no longer works.';
        });
        const del = document.createElement('button');
        del.className = 'gpa-btn'; del.style.fontSize = '9px'; del.textContent = '🗑';
        del.addEventListener('click', async () => {
          if (!confirm(`Delete "${r.name}" and all its messages?`)) return;
          await roomsApi({ action: 'delete', id: r.id });
          controlMsg.textContent = `Deleted ${r.name}.`;
          renderRooms();
        });
        btns.appendChild(code); btns.appendChild(del);
        head.appendChild(left); head.appendChild(btns);
        const modBtns = document.createElement('div');
        modBtns.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
        addRoomModButtons(modBtns, r.id, r.name);
        row.appendChild(head); row.appendChild(modBtns);
        wrap.appendChild(row);
      });
    }
    panel.querySelector('#gpa-adm-room-create').addEventListener('click', async () => {
      const nameEl = panel.querySelector('#gpa-adm-room-name');
      const name = nameEl.value.trim();
      if (!name) { controlMsg.textContent = 'Give the room a name.'; return; }
      const d = await roomsApi({ action: 'create', name });
      if (!d) return;
      nameEl.value = '';
      try { await navigator.clipboard.writeText(d.code); } catch (e) { /* optional */ }
      controlMsg.innerHTML = `Created <b>${escapeHtml(d.name)}</b> (id <code>${escapeHtml(d.id)}</code>). Code: `
        + `<span style="font-family:ui-monospace,monospace;letter-spacing:2px;color:${(THEMES[theme] || THEMES.dark).accent}">${escapeHtml(d.code)}</span>`
        + ' — copied. Share the id and code with whoever should be in it.';
      renderRooms();
    });

    panel.querySelector('#gpa-adm-force-reload').addEventListener('click', async () => {
      if (!confirm('Make every open copy re-fetch the script and restart?')) return;
      await postConfig({ bumpReload: true }, 'Reload pushed — clients update within ~15s.');
    });

    // ---- Diagnostics tab ----
    async function runDiagnostics() {
      const out = panel.querySelector('#gpa-adm-diag');
      out.innerHTML = '<div class="gpa-sub">Running…</div>';
      const rows = [];
      const add = (label, value, good) => rows.push({ label, value: String(value), good });

      add('Page origin', location.origin, true);
      add('Panel storage', location.hostname, true);
      add('Online', navigator.onLine ? 'yes' : 'no (offline)', navigator.onLine);
      add('Provider', currentProviderLabel(), true);
      add('Base model', (admGet(ADMIN_KEYS.MODEL) || OPENAI_MODEL), true);
      add('Smart model', (smartModel() || 'not set') + (autoUpgradeOn() ? ' (auto-upgrade ON)' : ' (auto-upgrade off)'), true);
      add('OpenAI key', localStorage.getItem(OPENAI_STORAGE_KEY) ? 'saved' : 'missing', !!localStorage.getItem(OPENAI_STORAGE_KEY));
      add('YouTube key', localStorage.getItem(YT_STORAGE_KEY) ? 'saved' : 'missing', !!localStorage.getItem(YT_STORAGE_KEY));
      add('Signed in as', currentUser || 'nobody', !!currentUser);
      add('Saved insights', (() => { try { return savedAll().length; } catch (e) { return '?'; } })(), true);
      add('Context memory', contextInsights().length + ' insight(s) active', true);
      add('Usage log', readLogs().length + ' entries', true);
      try {
        const rowsIdb = await idbAllTracks();
        add('Offline music', (rowsIdb || []).length + ' track(s) stored', true);
      } catch (e) { add('Offline music', 'IndexedDB unavailable', false); }
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          add('Browser storage used', formatBytes(est.usage || 0) + ' of ' + formatBytes(est.quota || 0), true);
        }
      } catch (e) { /* not supported */ }

      // Worker checks
      const base = adminBase();
      add('Worker URL', base || 'not set', !!base);
      if (base) {
        try {
          const res = await fetch(base + '/health', { cache: 'no-store' });
          const h = await res.json();
          add('Worker reachable', 'yes (' + res.status + ')', res.ok);
          add('Worker KV bound', h.kvBound ? 'yes' : 'NO — telemetry disabled', !!h.kvBound);
          add('Worker KV writable', h.kvWritable ? 'yes' : 'no', !!h.kvWritable);
          add('Worker ADMIN_TOKEN', h.adminTokenSet ? 'set' : 'NOT SET — admin routes disabled', !!h.adminTokenSet);
          add('Telemetry ready', h.telemetryReady ? 'yes' : 'no', !!h.telemetryReady);
          add('Owner username', h.owner || '?', true);
          add('Private mode', h.privateMode ? 'ON (only owner)' : 'off', true);
        } catch (e) {
          add('Worker reachable', 'NO — ' + ((e && e.message) || e), false);
        }
        const token = teleToken.value.trim();
        if (token) {
          try {
            const res = await fetch(base + '/admin/summary', { headers: adminAuthHeaders(token) });
            add('Admin token accepted', res.ok ? 'yes' : 'NO (' + res.status + ')', res.ok);
            if (res.ok) { const s = await res.json(); knownFlags = s.features || knownFlags; renderFlags(); }
          } catch (e) { add('Admin token accepted', 'check failed', false); }
        } else add('Admin token', 'not entered on the Usage tab', false);
      }

      const t = THEMES[theme] || THEMES.dark;
      out.innerHTML = rows.map((r) =>
        `<div class="gpa-admin-logrow"><span class="ev">${escapeHtml(r.label)}</span>`
        + `<span class="t" style="color:${r.good === false ? '#ff6b6b' : (r.good ? '#22c55e' : t.sub)}">${escapeHtml(r.value)}</span></div>`
      ).join('');
      out.dataset.report = rows.map((r) => r.label + ': ' + r.value).join('\n');
    }
    panel.querySelector('#gpa-adm-diag-run').addEventListener('click', runDiagnostics);
    panel.querySelector('#gpa-adm-diag-copy').addEventListener('click', () => {
      const out = panel.querySelector('#gpa-adm-diag');
      const text = out.dataset.report || '(run the checks first)';
      navigator.clipboard.writeText(text).then(
        () => { panel.querySelector('#gpa-adm-diag').insertAdjacentHTML('afterbegin', '<div class="gpa-sub">✓ copied</div>'); },
        () => { const w = window.open('', '_blank'); if (w) w.document.write('<pre>' + escapeHtml(text) + '</pre>'); }
      );
    });

    // ---- Power tools ----
    // Known OpenAI chat model ids (Sept 2026). The Custom… option future-proofs
    // the list; an invalid id just returns a clear 404.
    const MODEL_OPTIONS = [
      ['', 'Default'],
      ['gpt-4o-mini', 'gpt-4o-mini — fast & cheap'],
      ['gpt-4o', 'gpt-4o — stronger, multimodal'],
      ['gpt-4.1-mini', 'gpt-4.1-mini'],
      ['gpt-4.1', 'gpt-4.1 — strong'],
      ['gpt-5', 'gpt-5'],
      ['gpt-5.1', 'gpt-5.1'],
      ['gpt-5.2', 'gpt-5.2 — top general'],
      ['o4-mini', 'o4-mini — reasoning (hard math)'],
      ['gpt-5.6-luna', 'gpt-5.6-luna'],
      ['gpt-6-astra', 'gpt-6-astra - strongest model (any subject)'],
      ['__custom__', 'Custom…']
    ];
    function fillModelSelect(sel) {
      sel.innerHTML = MODEL_OPTIONS.map(([v, label]) => `<option value="${v}">${escapeHtml(label)}</option>`).join('');
    }
    // Binds a <select> + custom <input> pair to one storage key, saving on
    // change. Custom… reveals the input; a stored id not in the list shows as
    // Custom with the input pre-filled.
    function wireModelPicker(sel, input, key, displayDefault) {
      const refresh = () => {
        const v = admGet(key) || (displayDefault || '');
        const known = MODEL_OPTIONS.some((o) => o[0] === v);
        if (v && !known) { sel.value = '__custom__'; input.style.display = 'block'; input.value = v; }
        else { sel.value = v; input.style.display = 'none'; input.value = ''; }
      };
      sel.addEventListener('change', () => {
        if (sel.value === '__custom__') { input.style.display = 'block'; input.focus(); return; }
        input.style.display = 'none';
        if (sel.value) localStorage.setItem(key, sel.value); else localStorage.removeItem(key);
        panel.querySelector('#gpa-adm-tools-msg').textContent = 'Saved. Applies to the next AI request.';
      });
      input.addEventListener('change', () => {
        const v = input.value.trim();
        if (v) localStorage.setItem(key, v); else localStorage.removeItem(key);
        panel.querySelector('#gpa-adm-tools-msg').textContent = 'Saved. Applies to the next AI request.';
      });
      refresh();
      return refresh;
    }
    const modelSel = panel.querySelector('#gpa-adm-model-sel');
    const smartSel = panel.querySelector('#gpa-adm-smart-sel');
    fillModelSelect(modelSel);
    fillModelSelect(smartSel);
    const refreshBase = wireModelPicker(modelSel, panel.querySelector('#gpa-adm-model'), ADMIN_KEYS.MODEL, OPENAI_MODEL);
    const refreshSmart = wireModelPicker(smartSel, panel.querySelector('#gpa-adm-smart'), ADMIN_KEYS.SMART_MODEL, SMART_MODEL_DEFAULT);

    const autoUpgradeBtn = panel.querySelector('#gpa-adm-autoupgrade');
    function refreshAutoUpgrade() {
      const on = autoUpgradeOn();
      autoUpgradeBtn.textContent = on ? '⚡ Auto-upgrade on hard tasks: ON' : '⚡ Auto-upgrade on hard tasks: OFF';
      autoUpgradeBtn.classList.toggle('primary', on);
    }
    autoUpgradeBtn.addEventListener('click', () => {
      const on = !autoUpgradeOn();
      localStorage.setItem(ADMIN_KEYS.AUTO_UPGRADE, on ? 'on' : 'off');
      refreshAutoUpgrade();
      panel.querySelector('#gpa-adm-tools-msg').textContent = on
        ? (smartModel() ? 'On. Hard tasks will use ' + smartModel() + '.' : 'On — but set a Smart model above, or it falls back to the base model.')
        : 'Off. Every task uses the base model.';
    });

    function loadPowerToolFields() {
      refreshBase(); refreshSmart(); refreshAutoUpgrade();
      panel.querySelector('#gpa-adm-sysprefix').value = admGet(ADMIN_KEYS.SYSPREFIX) || '';
      panel.querySelector('#gpa-adm-maxchars').value = admGet(ADMIN_KEYS.MAXCHARS) || String(MAX_PAGE_CHARS);
      panel.querySelector('#gpa-adm-temp').value = admGet(ADMIN_KEYS.TEMP) || '';
    }
    panel.querySelector('#gpa-adm-save-tools').addEventListener('click', () => {
      const set = (k, v) => { v = String(v).trim(); if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); };
      set(ADMIN_KEYS.SYSPREFIX, panel.querySelector('#gpa-adm-sysprefix').value);
      set(ADMIN_KEYS.MAXCHARS, panel.querySelector('#gpa-adm-maxchars').value);
      set(ADMIN_KEYS.TEMP, panel.querySelector('#gpa-adm-temp').value);
      panel.querySelector('#gpa-adm-tools-msg').textContent = 'Saved. Applies to the next AI request.';
    });
    panel.querySelector('#gpa-adm-reset-tools').addEventListener('click', () => {
      [ADMIN_KEYS.MODEL, ADMIN_KEYS.SMART_MODEL, ADMIN_KEYS.AUTO_UPGRADE, ADMIN_KEYS.SYSPREFIX, ADMIN_KEYS.MAXCHARS, ADMIN_KEYS.TEMP].forEach((k) => localStorage.removeItem(k));
      loadPowerToolFields();
      panel.querySelector('#gpa-adm-tools-msg').textContent = 'Reset to defaults.';
    });
    panel.querySelector('#gpa-adm-play-run').addEventListener('click', async () => {
      const out = panel.querySelector('#gpa-adm-play-out');
      const userMsg = panel.querySelector('#gpa-adm-play-user').value.trim();
      const sysMsg = panel.querySelector('#gpa-adm-play-sys').value.trim();
      if (!userMsg) { out.textContent = 'Type a user message first.'; return; }
      out.textContent = 'Running…';
      try {
        // Straight to the provider — but callAI still prepends admin prefix and
        // any saved context, which is usually what a power user wants to test.
        const res = await callAI(userMsg, sysMsg || undefined);
        out.textContent = res;
        appendModelBadge(out);
      } catch (e) {
        out.textContent = 'Error: ' + ((e && e.message) || e);
      }
    });

    // ---- Data pane: API key manager ----
    // Keys are shown masked — enough to tell which key is which, never enough
    // to copy one out of a screenshot.
    function maskKey(v) {
      if (!v) return '';
      return v.length <= 12 ? v.slice(0, 3) + '…' : v.slice(0, 6) + '…' + v.slice(-4) + ` (${v.length} chars)`;
    }
    function renderKeyManager() {
      const wrap = panel.querySelector('#gpa-adm-keys');
      if (!wrap) return;
      wrap.innerHTML = '';
      // sessionOnly entries live in memory for this session only and are never
      // written to localStorage — see sessionSecrets.
      [['OpenAI', OPENAI_STORAGE_KEY, false], ['YouTube', YT_STORAGE_KEY, false],
       ['Admin token', ADMIN_KEYS.TELE_TOKEN, true], ['Owner code', ADMIN_KEYS.OWNER_CODE, true]].forEach(([label, key, sessionOnly]) => {
        const v = (sessionOnly ? admGet(key) : localStorage.getItem(key)) || '';
        const row = document.createElement('div');
        row.className = 'gpa-admin-userrow';
        const left = document.createElement('span');
        left.innerHTML = `<b>${escapeHtml(label)}</b> <span style="opacity:0.7">${v ? escapeHtml(maskKey(v)) : 'not set'}</span>`
          + (sessionOnly ? ' <span style="opacity:0.55;font-size:9px;">this session only</span>' : '');
        const btns = document.createElement('span');
        btns.style.cssText = 'display:flex;gap:4px;';
        if (v) {
          const clear = document.createElement('button');
          clear.className = 'gpa-btn';
          clear.style.fontSize = '9px';
          clear.textContent = 'Clear';
          clear.addEventListener('click', () => {
            if (!confirm(`Clear the ${label} key from this device?`)) return;
            if (sessionOnly) admSetSecret(key, ''); else localStorage.removeItem(key);
            renderKeyManager(); renderLsEditor();
          });
          btns.appendChild(clear);
        }
        const set = document.createElement('button');
        set.className = 'gpa-btn';
        set.style.fontSize = '9px';
        set.textContent = v ? 'Replace' : 'Set';
        set.addEventListener('click', () => {
          const nv = prompt(`${label} key:`, '');
          if (nv === null) return;
          const clean = sanitizeKey(nv);
          if (sessionOnly) admSetSecret(key, clean);
          else if (clean) localStorage.setItem(key, clean);
          else localStorage.removeItem(key);
          renderKeyManager(); renderLsEditor();
        });
        btns.appendChild(set);
        row.appendChild(left); row.appendChild(btns);
        wrap.appendChild(row);
      });
    }

    // ---- Data pane: localStorage inspector ----
    function renderLsEditor() {
      const wrap = panel.querySelector('#gpa-adm-ls');
      wrap.innerHTML = '';
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gpa_')) keys.push(k); }
      keys.sort();
      if (!keys.length) { wrap.innerHTML = '<div class="gpa-sub">No gpa_ keys stored.</div>'; return; }
      keys.forEach((k) => {
        const row = document.createElement('div');
        row.className = 'gpa-admin-ls-row';
        const kEl = document.createElement('div');
        kEl.className = 'k';
        kEl.textContent = k;
        const ta = document.createElement('textarea');
        ta.value = localStorage.getItem(k) || '';
        const rowBtns = document.createElement('div');
        rowBtns.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
        const save = document.createElement('button');
        save.className = 'gpa-btn';
        save.textContent = 'Save';
        save.addEventListener('click', () => { localStorage.setItem(k, ta.value); save.textContent = '✓'; setTimeout(() => (save.textContent = 'Save'), 800); });
        const del = document.createElement('button');
        del.className = 'gpa-btn';
        del.textContent = 'Delete';
        del.addEventListener('click', () => { if (confirm('Delete ' + k + '?')) { localStorage.removeItem(k); renderLsEditor(); } });
        rowBtns.appendChild(save); rowBtns.appendChild(del);
        row.appendChild(kEl); row.appendChild(ta); row.appendChild(rowBtns);
        wrap.appendChild(row);
      });
    }
    panel.querySelector('#gpa-adm-ls-refresh').addEventListener('click', renderLsEditor);
    panel.querySelector('#gpa-adm-dump').addEventListener('click', () => {
      const dump = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gpa_')) dump[k] = localStorage.getItem(k); }
      const blob = JSON.stringify(dump, null, 2);
      navigator.clipboard.writeText(blob).then(
        () => { panel.querySelector('#gpa-adm-data-msg').textContent = 'All gpa_ data copied to clipboard.'; },
        () => { const w = window.open('', '_blank'); if (w) w.document.write('<pre>' + escapeHtml(blob) + '</pre>'); }
      );
    });
    panel.querySelector('#gpa-adm-wipe').addEventListener('click', () => {
      if (!confirm('Wipe ALL of this tool\'s data on this browser — profiles, settings, logs, keys? This cannot be undone.')) return;
      if (!confirm('Really wipe everything? Last chance.')) return;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gpa_')) keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
      panel.querySelector('#gpa-adm-data-msg').textContent = 'Wiped. Reload the tool to start fresh.';
      renderLsEditor();
    });
  })();

  // ---- Reload the console in place ------------------------------------------
  // Fetches the latest copy of this script and restarts it, so you pick up a
  // new version without re-running the bookmarklet.
  const SCRIPT_SRC = 'https://raw.githubusercontent.com/viztrrx/donnajbesaints/main/script.js';
  function scriptSource() { return (admGet('gpa_script_src') || '').trim() || SCRIPT_SRC; }

  // Undo everything this instance did to the page. Anything missed here shows
  // up as a duplicate after a reload, so the order matters: stop the machinery
  // first, then release resources, then remove the UI.
  function teardownInstance() {
    try { gpaAbort.abort(); } catch (e) { /* listeners already gone */ }
    gpaIntervals.forEach((id) => { try { window.clearInterval(id); } catch (e) { /* ignore */ } });
    gpaIntervals.clear();
    gpaCleanups.forEach((fn) => { try { fn(); } catch (e) { /* already gone */ } });
    gpaCleanups.length = 0;
    // Animation loops aren't intervals, so they'd keep drawing into the
    // detached canvases forever after a reload without these.
    try { if (particleAnimId) cancelAnimationFrame(particleAnimId); particleAnimId = null; } catch (e) { /* never started */ }
    try { if (gpaWelcome3d && gpaWelcome3d.raf) cancelAnimationFrame(gpaWelcome3d.raf); } catch (e) { /* never mounted */ }
    try { if (gpaWelcome3d && gpaWelcome3d.renderer) gpaWelcome3d.renderer.dispose(); } catch (e) { /* never mounted */ }
    try { stopAutoFollow(); } catch (e) { /* not started */ }
    try { closeTutorPopup(); } catch (e) { /* none open */ }
    try { clearPageHighlights(); } catch (e) { /* none injected */ }
    try { stopActiveGame(); } catch (e) { /* no game running */ }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    try {
      localAudio.pause();
      localAudio.removeAttribute('src');
      localPlaylist.forEach((t) => { if (String(t.url).startsWith('blob:')) URL.revokeObjectURL(t.url); });
    } catch (e) { /* player never initialised */ }
    try { iframeKeepAlive.forEach((f) => f.remove()); iframeKeepAlive.length = 0; } catch (e) { /* ignore */ }
    // Note: .gpa-page-highlight is handled by clearPageHighlights above, which
    // unwraps the spans. Removing them outright here would delete page text.
    document.querySelectorAll('.gpa-sel-bubble, .gpa-sel-pop, .gpa-tutor-pop').forEach((el) => {
      try { el.remove(); } catch (e) { /* ignore */ }
    });
    try { host.remove(); } catch (e) { /* already gone */ }
  }

  async function reloadInterface(btn) {
    const src = scriptSource();
    const setBusy = (busy) => {
      if (!btn) return;
      btn.disabled = busy;
      btn.classList.toggle('spinning', busy);
    };
    setBusy(true);
    try {
      // Fetch BEFORE tearing anything down: if the network or the URL is bad we
      // must still be running afterwards, not left with no console at all.
      const url = src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const code = await res.text();
      // Cheap sanity check so a 404 page or a redirect can't be eval'd.
      if (!/gpa-root-host/.test(code)) throw new Error('that URL did not return the console script');
      try { saveProgress(); } catch (e) { /* not signed in */ }
      teardownInstance();
      // Indirect eval runs it in global scope, exactly like the bookmarklet.
      (0, eval)(code);
    } catch (e) {
      setBusy(false);
      showToast('Reload failed: ' + ((e && e.message) || e)
        + ' — the version you have is still running.'
        + (navigator.onLine === false ? ' (You appear to be offline.)' : ''), { type: 'danger' });
    }
  }

  panel.querySelector('#gpa-reload').addEventListener('click', () => reloadInterface(panel.querySelector('#gpa-reload')));


  // ---- Settings control center (behavior) ---------------------------------
  // Drives the Settings pane: section navigation, overview, theme gallery with
  // live 3D preview, custom theme builder, panel appearance, effects preview,
  // typography sample, icon studio, AI status, search and resets.
  //
  // It sits at the end of the file on purpose: it calls into the particle
  // engine, panel sizing, admin/model helpers and account state, which all
  // have to be initialised first. Existing controls (size, particle, font,
  // speed, icon, look, color, language, voice, auto-confirm buttons) keep
  // their original wiring; this module only adds to it.
  //
  // Everything it starts is stopped when Settings is off screen and is
  // registered in gpaCleanups so a reload leaves nothing running.
  (function settingsCenter() {
    const gps = panel.querySelector('#gps');
    const pane = panel.querySelector('.gpa-pane[data-pane="theme"]');
    if (!gps || !pane) return;
    const $ = (sel) => gps.querySelector(sel);
    const $$ = (sel) => Array.from(gps.querySelectorAll(sel));
    const motionQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = () => !!(motionQ && motionQ.matches);
    const SECTION_KEY = 'gpa_settings_section';
    const TYPE_KEY = 'gpa_type_scale';
    const TYPE_DEFAULTS = { size: 13, lh: 1.6 };
    const SECTIONS = $$('.gps-tab').map((t) => t.dataset.sec);
    let activeSec = 'overview';
    let searching = false;

    // The confirm dialog belongs to the panel, not the scrolling pane, so it
    // covers the whole console whatever the scroll position.
    const dialog = $('#gps-dialog');
    panel.appendChild(dialog);

    // ---- Small helpers ----
    const safeGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
    const safeDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } };
    function fillRange(input) {
      const min = Number(input.min), max = Number(input.max), v = Number(input.value);
      input.style.setProperty('--p', (((v - min) / (max - min)) * 100).toFixed(1) + '%');
    }
    function setOut(id, text) { const o = gps.querySelector('#' + id); if (o) o.textContent = text; }
    const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
    const themeName = (n) => (THEME_META[n] && THEME_META[n].name) || cap(n);
    const SIZE_NAMES = { compact: 'Compact', normal: 'Normal', large: 'Large', xl: 'XL', full: 'Full page' };

    // ---- Typography scale (text size + line height for AI answers) ----
    function loadTypeScale() {
      let raw = {};
      try { raw = JSON.parse(safeGet(TYPE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
      const size = Number(raw.size), lh = Number(raw.lh);
      return {
        size: Number.isFinite(size) ? Math.max(11, Math.min(18, size)) : TYPE_DEFAULTS.size,
        lh: Number.isFinite(lh) ? Math.max(1.3, Math.min(2, lh)) : TYPE_DEFAULTS.lh
      };
    }
    let typeScale = loadTypeScale();
    function applyTypeScale() {
      panel.style.setProperty('--gpa-out-size', typeScale.size + 'px');
      panel.style.setProperty('--gpa-out-lh', String(typeScale.lh));
    }
    applyTypeScale();

    // ---- Navigation ----
    const main = panel.querySelector('#gpa-main');
    function showSection(sec, opts) {
      if (!SECTIONS.includes(sec)) sec = 'overview';
      activeSec = sec;
      $$('.gps-tab').forEach((t) => {
        const on = t.dataset.sec === sec;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (on && opts && opts.focus) t.focus();
      });
      $$('.gps-sec').forEach((s) => s.classList.toggle('active', s.dataset.sec === sec));
      safeSet(SECTION_KEY, sec);
      if (opts && opts.scroll && main && main.scrollTop > 0) main.scrollTop = 0;
      refreshSection(sec);
      updateLive();
    }
    function refreshSection(sec) {
      if (sec === 'overview') refreshOverview();
      else if (sec === 'ai') refreshAi();
      else if (sec === 'icon') refreshIconPreview();
      else if (sec === 'colors') renderColorRows();
      else if (sec === 'type') renderTypeSample(false);
    }
    const nav = $('.gps-nav');
    nav.addEventListener('click', (e) => {
      const tab = e.target.closest('.gps-tab');
      if (!tab) return;
      if (searching) clearSearch();
      showSection(tab.dataset.sec, { scroll: true });
    });
    nav.addEventListener('keydown', (e) => {
      const tabs = $$('.gps-tab');
      const i = tabs.indexOf(e.target.closest('.gps-tab'));
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      if (searching) clearSearch();
      showSection(tabs[j].dataset.sec, { focus: true });
    });
    gps.addEventListener('click', (e) => {
      const jump = e.target.closest('[data-jump]');
      if (!jump) return;
      if (searching) clearSearch();
      showSection(jump.dataset.jump, { scroll: true, focus: true });
    });

    // ---- Live state: previews only run while Settings is actually visible ----
    function paneLive() {
      return pane.classList.contains('active') && !isMin && document.visibilityState !== 'hidden';
    }
    function updateLive() {
      const live = paneLive();
      gps.classList.toggle('is-live', live && !reduced());
      const fxShown = live && fxStage && fxStage.offsetParent !== null;
      if (fxShown) startFx(); else stopFx();
    }
    const liveObserver = new MutationObserver(updateLive);
    liveObserver.observe(pane, { attributes: true, attributeFilter: ['class'] });
    liveObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
    gpaCleanups.push(() => liveObserver.disconnect());
    onDoc('visibilitychange', updateLive);
    if (motionQ && motionQ.addEventListener) {
      motionQ.addEventListener('change', updateLive);
      gpaCleanups.push(() => motionQ.removeEventListener('change', updateLive));
    }

    // ---- 3D tilt: pointer position nudges the rig; eased by CSS ----
    function wireTilt(stage) {
      let raf = 0, rx = 0, ry = 0;
      stage.addEventListener('pointermove', (e) => {
        if (reduced() || e.pointerType === 'touch') return;
        const r = stage.getBoundingClientRect();
        rx = ((e.clientX - r.left) / r.width - 0.5) * 18;
        ry = -((e.clientY - r.top) / r.height - 0.5) * 12;
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          stage.style.setProperty('--rx', rx.toFixed(2) + 'deg');
          stage.style.setProperty('--ry', ry.toFixed(2) + 'deg');
        });
      });
      stage.addEventListener('pointerleave', () => {
        stage.style.setProperty('--rx', '0deg');
        stage.style.setProperty('--ry', '0deg');
      });
    }
    $$('[data-tilt]').forEach(wireTilt);

    // ---- Theme gallery ----
    const VAR_KEYS = { bg: '--gpa-bg', bg2: '--gpa-bg2', panel: '--gpa-panel', field: '--gpa-field', text: '--gpa-text', sub: '--gpa-sub', accent: '--gpa-accent', accent2: '--gpa-accent2', accentFg: '--gpa-accent-fg', border: '--gpa-border', glow: '--gpa-glow', atmos: '--gpa-atmos' };
    // Scoped variable override: re-themes one element's subtree only.
    function setScopedTheme(el, name) {
      if (!name) {
        Object.values(VAR_KEYS).forEach((v) => el.style.removeProperty(v));
        el.style.removeProperty('--gpa-card-bg');
        return;
      }
      const t = resolveTheme(name);
      Object.keys(VAR_KEYS).forEach((k) => el.style.setProperty(VAR_KEYS[k], t[k]));
      el.style.setProperty('--gpa-card-bg', t.panel);
    }
    function tileHtml(name) {
      const m = THEME_META[name] || { name: cap(name) };
      const t = resolveTheme(name);
      const label = escapeHtml(m.name + ' theme' + (m.blurb ? '. ' + m.blurb : ''));
      return `<button class="gps-tile" data-theme="${name}" aria-pressed="false" aria-label="${label}">`
        + `<span class="gps-tile-scene">${gpsMiniConsole()}</span>`
        + `<span class="gps-tile-meta"><span class="gps-tile-name">${escapeHtml(m.name)}</span>`
        + `<span class="gps-tile-check">${GPS_ICONS.check}</span>`
        + `<span class="gps-tile-dots"><i style="background:${t.accent}"></i><i style="background:${t.accent2}"></i><i style="background:${t.text}"></i></span></span></button>`;
    }
    function renderGalleries() {
      const groups = { signature: [], classic: [], custom: [] };
      Object.keys(THEME_META).forEach((n) => { if (THEMES[n]) groups[THEME_META[n].group].push(n); });
      Object.keys(groups).forEach((g) => {
        const box = $('#gps-gallery-' + g);
        if (!box) return;
        box.innerHTML = groups[g].map(tileHtml).join('');
        box.querySelectorAll('.gps-tile').forEach((tile) => setScopedTheme(tile, tile.dataset.theme));
      });
      markTiles();
    }
    function markTiles() {
      $$('.gps-tile').forEach((tile) => tile.setAttribute('aria-pressed', tile.dataset.theme === theme ? 'true' : 'false'));
    }
    function refreshCustomTile() {
      const tile = gps.querySelector('.gps-tile[data-theme="custom"]');
      if (!tile) return;
      setScopedTheme(tile, 'custom');
      const t = resolveTheme('custom');
      const dots = tile.querySelectorAll('.gps-tile-dots i');
      if (dots.length === 3) { dots[0].style.background = t.accent; dots[1].style.background = t.accent2; dots[2].style.background = t.text; }
    }
    const themeStage = $('#gps-theme-stage');
    const themeCap = $('#gps-theme-cap');
    let previewing = null;
    function previewTheme(name) {
      if (name === previewing) return;
      previewing = name;
      setScopedTheme(themeStage, name && name !== theme ? name : null);
      themeCap.textContent = name && name !== theme ? 'Previewing ' + themeName(name) : themeName(theme);
    }
    const galleryWrap = $('.gps-sec[data-sec="theme"]');
    galleryWrap.addEventListener('mouseover', (e) => {
      const tile = e.target.closest('.gps-tile');
      if (tile) previewTheme(tile.dataset.theme);
    });
    galleryWrap.addEventListener('mouseleave', () => previewTheme(null));
    galleryWrap.addEventListener('focusin', (e) => {
      const tile = e.target.closest('.gps-tile');
      if (tile) previewTheme(tile.dataset.theme);
    });
    galleryWrap.addEventListener('focusout', (e) => {
      if (!(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.gps-tile'))) previewTheme(null);
    });
    galleryWrap.addEventListener('click', (e) => {
      const tile = e.target.closest('.gps-tile');
      if (!tile) return;
      safeSet(THEME_USER_SET_KEY, '1');
      previewing = null;
      setScopedTheme(themeStage, null);
      applyTheme(tile.dataset.theme);
      themeCap.textContent = themeName(theme);
    });

    // ---- Custom theme builder ----
    const COLOR_ROWS = [
      ['bg', 'Background', 'Behind everything'],
      ['panel', 'Surface', 'Header, sidebar and cards'],
      ['text', 'Text', 'Primary text'],
      ['accent', 'Accent', 'Buttons and active states'],
      ['accent2', 'Second accent', 'Gradients and 3D highlights'],
      ['glow', 'Glow', 'Halo around the panel'],
      ['border', 'Border', 'Outlines and dividers'],
      ['particle', 'Particles', 'Ambient effect color']
    ];
    const colorsBox = $('#gps-colors');
    colorsBox.innerHTML = COLOR_ROWS.map(([k, name, desc]) => {
      const id = k === 'accent' ? 'gpa-custom-color' : 'gps-color-' + k;
      return `<div class="gps-color gps-item-lite" data-color="${k}">`
        + `<label class="gps-swatch" title="Pick ${name.toLowerCase()} color"><input type="color" id="${id}" aria-label="${name} color" /></label>`
        + `<div class="gps-color-meta"><div class="gps-color-name">${name}</div><div class="gps-color-desc">${desc}</div></div>`
        + `<input class="gps-hex" type="text" inputmode="text" maxlength="7" spellcheck="false" aria-label="${name} hex value" />`
        + `<button class="gps-icon-btn" data-color-reset="${k}" aria-label="Reset ${name.toLowerCase()} to its default" title="Reset">${GPS_ICONS.reset}</button>`
        + `</div>`;
    }).join('');
    function saveCustom(src, opts) {
      safeSet(CUSTOM_THEME_KEY, JSON.stringify(src));
      if (src.accent) safeSet(CUSTOM_COLOR_KEY, src.accent); // older builds read this key
      THEMES.custom = customThemeFrom(src);
      safeSet(THEME_USER_SET_KEY, '1');
      applyTheme('custom', opts);
      refreshCustomTile();
    }
    const builderStage = $('#gps-builder-stage');
    const useCustomBtn = $('#gps-use-custom');
    useCustomBtn.addEventListener('click', () => {
      safeSet(THEME_USER_SET_KEY, '1');
      applyTheme('custom');
      renderColorRows();
    });
    function renderColorRows(except) {
      const t = resolveTheme('custom');
      // The preview always shows the custom palette being edited, even while
      // another theme is active.
      setScopedTheme(builderStage, 'custom');
      const onCustom = theme === 'custom';
      useCustomBtn.hidden = onCustom;
      setOut('gps-builder-status', onCustom
        ? 'Custom theme is active. Changes apply everywhere as you make them.'
        : 'You are using ' + themeName(theme) + '. Editing a color switches to your custom theme.');
      colorsBox.querySelectorAll('.gps-color').forEach((row) => {
        const k = row.dataset.color;
        const v = t[k];
        const sw = row.querySelector('.gps-swatch');
        sw.style.background = v;
        const picker = row.querySelector('input[type="color"]');
        const hex = row.querySelector('.gps-hex');
        if (picker !== except) picker.value = v;
        if (hex !== except) { hex.value = v; hex.removeAttribute('aria-invalid'); }
      });
      renderContrast();
    }
    function renderContrast() {
      const t = resolveTheme('custom');
      const onBg = contrastRatio(t.text, t.bg), onPanel = contrastRatio(t.text, t.panel), sub = contrastRatio(t.sub, t.panel);
      const worst = Math.min(onBg, onPanel);
      const ok = worst >= 4.5 && sub >= 4.5;
      const box = $('#gps-contrast');
      box.className = 'gps-contrast ' + (ok ? 'ok' : 'warn');
      box.innerHTML = (ok ? GPS_ICONS.check : GPS_ICONS.warn)
        + `<span>Text contrast <b>${worst.toFixed(1)}:1</b>${ok ? ', readable' : sub < 4.5 && worst >= 4.5 ? ', secondary text is faint' : ', below 4.5:1'}</span>`;
    }
    colorsBox.addEventListener('input', (e) => {
      const row = e.target.closest('.gps-color');
      if (!row || e.target.type !== 'color') return;
      const src = customThemeSource();
      src[row.dataset.color] = e.target.value;
      saveCustom(src, { instant: true });
      renderColorRows(e.target);
    });
    function commitHex(input) {
      const row = input.closest('.gps-color');
      const v = normHex(input.value);
      if (!v) { input.setAttribute('aria-invalid', 'true'); return; }
      const src = customThemeSource();
      src[row.dataset.color] = v;
      saveCustom(src);
      renderColorRows();
    }
    colorsBox.addEventListener('change', (e) => { if (e.target.classList.contains('gps-hex')) commitHex(e.target); });
    colorsBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('gps-hex')) { e.preventDefault(); commitHex(e.target); }
    });
    colorsBox.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color-reset]');
      if (!btn) return;
      const src = customThemeSource();
      delete src[btn.dataset.colorReset];
      saveCustom(src);
      renderColorRows();
    });
    $('#gps-seed').addEventListener('click', () => {
      const t = resolveTheme(theme);
      const src = {};
      CUSTOM_FIELDS.forEach((k) => { src[k] = t[k]; });
      saveCustom(src);
      renderColorRows();
      showToast('Custom theme now starts from ' + themeName(theme) + '. Adjust any color to make it yours.');
    });

    // ---- Panel appearance ----
    const AP_FORMAT = {
      radius: (v) => (v === 100 ? 'Default' : v + '%'),
      opacity: (v) => v + '%',
      blur: (v) => (v === 0 ? 'Off' : v + 'px'),
      border: (v) => v + '%',
      shadow: (v) => v + '%',
      glow: (v) => (v === 0 ? 'Off' : v + '%')
    };
    function renderPanelCap() {
      const bits = [SIZE_NAMES[panelSizeKey] || 'Full page'];
      if (appearance.opacity < 100) bits.push(appearance.opacity + '% opacity');
      if (appearance.blur > 0 && appearance.opacity < 100) bits.push(appearance.blur + 'px blur');
      setOut('gps-panel-cap', bits.join(' · '));
    }
    function renderAppearance() {
      renderPanelCap();
      $$('input[data-ap]').forEach((inp) => {
        const k = inp.dataset.ap;
        inp.value = appearance[k];
        fillRange(inp);
        setOut(inp.id + '-v', AP_FORMAT[k](appearance[k]));
      });
      $$('[data-density]').forEach((b) => b.classList.toggle('primary', b.dataset.density === appearance.density));
      syncPressed();
    }
    gps.addEventListener('input', (e) => {
      const inp = e.target;
      if (!inp.dataset) return;
      if (inp.dataset.ap) {
        const k = inp.dataset.ap;
        const v = Number(inp.value);
        applyAppearance({ [k]: v });
        fillRange(inp);
        setOut(inp.id + '-v', AP_FORMAT[k](v));
        renderPanelCap();
      } else if (inp.dataset.fx) {
        setParticleFx(inp.dataset.fx, Number(inp.value));
        fillRange(inp);
        setOut(inp.id + '-v', '×' + Number(inp.value).toFixed(inp.dataset.fx === 'intensity' ? 2 : 1));
        fx.style = null; // rebuild the preview field with the new values
      } else if (inp.dataset.ty) {
        typeScale = { ...typeScale, [inp.dataset.ty]: Number(inp.value) };
        safeSet(TYPE_KEY, JSON.stringify(typeScale));
        applyTypeScale();
        fillRange(inp);
        renderTypeOutputs();
      } else if (inp.id === 'gpa-particle-size') {
        fillRange(inp);
        setOut('gps-fx-area-v', inp.value + 'px');
        fx.style = null;
      }
    });
    gps.addEventListener('click', (e) => {
      const d = e.target.closest('[data-density]');
      if (!d) return;
      applyAppearance({ density: d.dataset.density });
      renderAppearance();
    });

    // ---- Effects preview ----
    const fxStage = $('#gps-fxstage');
    const fxCanvas = $('#gps-fx-canvas');
    const fxCtx = fxCanvas.getContext('2d');
    const fx = { raf: 0, list: [], w: 0, h: 0, style: null, mx: -9999, my: -9999 };
    function sizeFx() {
      const r = fxStage.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      if (!r.width || !r.height) return false;
      if (fx.w !== r.width || fx.h !== r.height) {
        fx.w = r.width; fx.h = r.height;
        fxCanvas.width = Math.round(r.width * ratio);
        fxCanvas.height = Math.round(r.height * ratio);
        fxCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
        fx.style = null;
      }
      return true;
    }
    function fxLoop() {
      fx.raf = 0;
      const style = safeGet(PARTICLE_KEY) || 'off';
      if (!sizeFx()) return;
      if (style === 'off') {
        fxCtx.clearRect(0, 0, fx.w, fx.h);
        setOut('gps-fx-cap', 'Effects are off. Pick a style to preview it.');
        fx.style = 'off';
        return;
      }
      if (fx.style !== style) {
        fx.list = buildParticles(style, fx.w, fx.h);
        fx.style = style;
        setOut('gps-fx-cap', cap(style));
      }
      drawParticleFrame(fxCtx, fx.list, fx.w, fx.h, style, fx.mx, fx.my, hexRgb(resolveTheme(theme).particle));
      if (!reduced()) fx.raf = requestAnimationFrame(fxLoop);
    }
    function startFx() { if (!fx.raf) fx.raf = requestAnimationFrame(fxLoop); }
    function stopFx() { if (fx.raf) cancelAnimationFrame(fx.raf); fx.raf = 0; }
    gpaCleanups.push(stopFx);
    fxStage.addEventListener('pointermove', (e) => {
      const r = fxStage.getBoundingClientRect();
      fx.mx = e.clientX - r.left; fx.my = e.clientY - r.top;
    });
    fxStage.addEventListener('pointerleave', () => { fx.mx = -9999; fx.my = -9999; });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { if (fx.raf || fx.style) { sizeFx(); if (!fx.raf && paneLive()) startFx(); } });
      ro.observe(fxStage);
      gpaCleanups.push(() => ro.disconnect());
    }
    function renderEffects() {
      $$('input[data-fx]').forEach((inp) => {
        inp.value = particleFx[inp.dataset.fx];
        fillRange(inp);
        setOut(inp.id + '-v', '×' + Number(inp.value).toFixed(inp.dataset.fx === 'intensity' ? 2 : 1));
      });
      const area = $('#gpa-particle-size');
      area.value = particleMargin;
      fillRange(area);
      setOut('gps-fx-area-v', particleMargin + 'px');
      fx.style = null;
      if (!fx.raf && paneLive() && fxStage.offsetParent !== null) startFx();
    }

    // ---- Typography ----
    const SAMPLE_TEXT = 'Photosynthesis turns light into chemical energy.\n\n1. Light is absorbed by chlorophyll.\n2. Water splits, releasing oxygen.\n3. The Calvin cycle builds glucose from CO2.';
    const typeSample = $('#gps-type-sample');
    let typeRun = 0;
    function renderTypeOutputs() {
      $$('input[data-ty]').forEach((inp) => {
        inp.value = typeScale[inp.dataset.ty];
        fillRange(inp);
        setOut(inp.id + '-v', inp.dataset.ty === 'size' ? typeScale.size + 'px' : typeScale.lh.toFixed(2));
      });
    }
    // Same timing as typeText(), but cancellable so replays never interleave.
    function renderTypeSample(animate) {
      const run = ++typeRun;
      const speed = safeGet(SPEED_KEY) || 'normal';
      if (!animate || speed === 'instant' || reduced()) {
        typeSample.classList.remove('gpa-typing');
        typeSample.textContent = SAMPLE_TEXT;
        return;
      }
      const delay = { slow: 28, normal: 12, fast: 4 }[speed] || 12;
      typeSample.classList.add('gpa-typing');
      typeSample.textContent = '';
      const cursor = document.createElement('span');
      cursor.className = 'gpa-cursor';
      typeSample.appendChild(cursor);
      const chunk = Math.max(1, Math.ceil(SAMPLE_TEXT.length / 400));
      let i = 0;
      (function step() {
        if (run !== typeRun) return;
        if (i >= SAMPLE_TEXT.length) { cursor.remove(); typeSample.classList.remove('gpa-typing'); return; }
        cursor.insertAdjacentText('beforebegin', SAMPLE_TEXT.slice(i, i + chunk));
        i += chunk;
        setTimeout(step, delay);
      })();
    }
    $('#gps-type-play').addEventListener('click', () => renderTypeSample(true));

    // ---- Icon studio ----
    const miniPrev = $('#gps-mini-prev');
    const iconStage = $('.gps-iconstage');
    function refreshIconPreview() {
      miniPrev.innerHTML = minimized.innerHTML;
      miniPrev.className = 'gps-mini' + (minimized.classList.contains('gpa-mini-minimal') ? ' gpa-mini-minimal' : '');
      miniPrev.style.background = minimized.style.background;
      miniPrev.style.boxShadow = minimized.style.boxShadow;
      // Paint the mock page with the real host page's colors, so "Match this
      // page" previews against what it actually matches.
      try {
        const bg = parseRgbString(getComputedStyle(document.body).backgroundColor);
        const c = bg && bg.a > 0.05 ? bg : { r: 255, g: 255, b: 255 };
        iconStage.style.setProperty('--gps-page-bg', `rgb(${c.r},${c.g},${c.b})`);
        iconStage.style.setProperty('--gps-page-fg', relativeLuminance(c) > 0.4 ? '#111827' : '#f3f4f6');
      } catch (e) { /* keep the neutral default */ }
    }

    // ---- AI status (read-only; never touches key values) ----
    function refreshAi() {
      try {
        const base = (admGet(ADMIN_KEYS.MODEL) || '').trim() || OPENAI_MODEL;
        const smart = smartModel();
        setOut('gps-ai-base', base);
        setOut('gps-ai-smart', smart);
        const auto = $('#gps-ai-auto');
        auto.textContent = autoUpgradeOn() ? 'On' : 'Off';
        auto.className = 'gps-badge ' + (autoUpgradeOn() ? 'ok' : 'off');
        const reason = $('#gps-ai-reason');
        reason.textContent = modelSupportsReasoning(smart) ? cap(reasoningEffort) : 'Not used';
        reason.className = 'gps-badge ' + (modelSupportsReasoning(smart) ? 'ok' : 'off');
        const assigned = !!serverAssignedKeys.openai;
        const local = !!readStoredKey(OPENAI_STORAGE_KEY);
        const key = $('#gps-ai-key');
        key.textContent = assigned ? 'Owner key' : local ? 'Your key' : 'No key yet';
        key.className = 'gps-badge ' + (assigned || local ? 'ok' : 'warn');
        setOut('gps-ai-keyhint', assigned
          ? 'The owner assigned a key. It stays on the worker and never reaches this browser.'
          : local ? 'Using the key saved in this browser. Its value is never shown here.'
            : "You'll be asked for a key on your first AI request.");
        setOut('gps-ai-route', OPENAI_PROXY
          ? 'Requests go through your worker at ' + OPENAI_PROXY.replace(/^https?:\/\//, '') + '.'
          : 'Requests go directly to api.openai.com.');
      } catch (e) { /* admin helpers not ready yet */ }
    }

    // ---- Overview ----
    const ICON_NAMES = { dot: 'Dot', sparkle: 'Sparkle', bolt: 'Bolt', orbit: 'Orbit', chat: 'Chat', letter: 'Letter' };
    // What "default" means for each preference, for the personalization meter.
    function customizations() {
      const checks = [
        (safeGet(THEME_KEY) || 'matte') !== 'matte',
        !!safeGet(CUSTOM_THEME_KEY),
        (safeGet(PANEL_SIZE_KEY) || 'full') !== 'full',
        ...Object.keys(APPEARANCE_DEFAULTS).map((k) => appearance[k] !== APPEARANCE_DEFAULTS[k]),
        (safeGet(PARTICLE_KEY) || 'off') !== 'off',
        particleMargin !== 40,
        ...Object.keys(PARTICLE_FX_DEFAULTS).map((k) => particleFx[k] !== PARTICLE_FX_DEFAULTS[k]),
        (safeGet(FONT_KEY) || 'mono') !== 'mono',
        (safeGet(SPEED_KEY) || 'normal') !== 'normal',
        typeScale.size !== TYPE_DEFAULTS.size, typeScale.lh !== TYPE_DEFAULTS.lh,
        (safeGet(ICON_KEY) || 'dot') !== 'dot',
        (safeGet(ICON_LOOK_KEY) || 'minimal') !== 'minimal',
        (safeGet(ICON_COLOR_MODE_KEY) || 'page') !== 'page'
      ];
      return { n: checks.filter(Boolean).length, of: checks.length };
    }
    function refreshOverview() {
      const t = resolveTheme(theme);
      const m = THEME_META[theme] || {};
      setOut('gps-ov-theme', themeName(theme));
      setOut('gps-ov-blurb', m.blurb || (m.group === 'classic' ? 'Classic theme' : ''));
      const pal = $$('#gps-ov-palette i');
      [t.bg, t.panel, t.accent, t.accent2, t.text].forEach((c, i) => { if (pal[i]) pal[i].style.background = c; });
      $('#gps-ov-accent-dot').style.background = t.accent;
      setOut('gps-ov-accent', t.accent);
      const bits = [SIZE_NAMES[panelSizeKey] || 'Full page'];
      if (appearance.opacity < 100) bits.push(appearance.opacity + '% opacity');
      if (appearance.density !== 'comfortable') bits.push(cap(appearance.density));
      setOut('gps-ov-panel', bits.join(' · '));
      const ps = safeGet(PARTICLE_KEY) || 'off';
      setOut('gps-ov-fx', ps === 'off' ? 'Off' : cap(ps) + (particleFx.density !== 1 ? ' · ×' + particleFx.density.toFixed(1) : ''));
      const f = (safeGet(FONT_KEY) || 'mono') === 'system' ? 'Standard' : 'Typewriter';
      setOut('gps-ov-type', f + ' · ' + typeScale.size + 'px · ' + cap(safeGet(SPEED_KEY) || 'normal'));
      try { setOut('gps-ov-ai', ((admGet(ADMIN_KEYS.MODEL) || '').trim() || OPENAI_MODEL) + ' · ' + smartModel()); } catch (e) { /* not ready */ }
      setOut('gps-ov-icon', (ICON_NAMES[safeGet(ICON_KEY) || 'dot'] || 'Dot') + ' · ' + cap(safeGet(ICON_LOOK_KEY) || 'minimal'));
      const c = customizations();
      setOut('gps-ov-custom', c.n === 0 ? 'Default setup' : c.n + ' of ' + c.of + ' settings customized');
      $('#gps-ov-meter').style.width = Math.round((c.n / c.of) * 100) + '%';
    }

    // ---- aria-pressed mirrors the legacy "primary" class on toggle buttons ----
    function syncPressed() {
      $$('.gps-seg-btn, .gps-choices > button, .gps-sizes > button, .gps-switch').forEach((b) => {
        b.setAttribute('aria-pressed', b.classList.contains('primary') ? 'true' : 'false');
      });
    }
    // Runs after the original handlers (bubbling), so it sees their result.
    gps.addEventListener('click', (e) => {
      // Read the target now: once dispatch ends, the browser clears
      // event.target for nodes inside a shadow root.
      const btn = e.target.closest('button');
      if (!btn) return;
      requestAnimationFrame(() => {
        syncPressed();
        if (activeSec === 'overview') refreshOverview();
        if (btn.matches('.icon-btn, .look-btn, .colormode-btn')) refreshIconPreview();
        if (btn.matches('.speed-btn, .font-btn')) renderTypeSample(true);
        if (btn.matches('.particle-btn')) { fx.style = null; updateLive(); }
        if (btn.matches('.size-btn')) renderPanelCap();
      });
    });

    // ---- Search ----
    const searchInput = $('#gps-search');
    const resultsHead = $('#gps-results-head');
    const emptyBox = $('#gps-empty');
    let haystacks = null;
    function buildHaystacks() {
      haystacks = new Map();
      $$('.gps-sec').forEach((sec) => {
        const secName = (sec.getAttribute('aria-label') || '').toLowerCase();
        sec.querySelectorAll('.gps-item').forEach((it) => {
          haystacks.set(it, ((it.dataset.k || '') + ' ' + secName + ' ' + (it.querySelector('.gps-label, .gps-sec-title') || {}).textContent).toLowerCase());
        });
      });
    }
    function runSearch() {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) { clearSearch(true); return; }
      if (!haystacks) buildHaystacks();
      searching = true;
      gps.classList.add('is-searching');
      const terms = q.split(/\s+/).filter(Boolean);
      let total = 0;
      $$('.gps-sec').forEach((sec) => {
        let n = 0;
        if (sec.dataset.sec !== 'overview') {
          sec.querySelectorAll('.gps-item').forEach((it) => {
            const hay = haystacks.get(it) || '';
            const hit = terms.every((t) => hay.includes(t));
            it.classList.toggle('no-match', !hit);
            if (hit) n++;
          });
        }
        sec.classList.toggle('no-match', n === 0);
        const tab = gps.querySelector(`.gps-tab[data-sec="${sec.dataset.sec}"]`);
        if (tab) tab.classList.toggle('has-match', n > 0);
        total += n;
      });
      emptyBox.hidden = total > 0;
      resultsHead.textContent = total ? `${total} setting${total === 1 ? '' : 's'} match "${searchInput.value.trim()}"` : '';
      updateLive();
    }
    function clearSearch(keepFocus) {
      searching = false;
      if (!keepFocus) searchInput.value = '';
      gps.classList.remove('is-searching');
      $$('.no-match').forEach((el) => el.classList.remove('no-match'));
      $$('.has-match').forEach((el) => el.classList.remove('has-match'));
      emptyBox.hidden = true;
      resultsHead.textContent = '';
      showSection(activeSec);
    }
    let searchRaf = 0;
    searchInput.addEventListener('input', () => {
      if (!searchRaf) searchRaf = requestAnimationFrame(() => { searchRaf = 0; runSearch(); });
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); e.stopPropagation(); clearSearch(); }
    });
    // "/" focuses search while Settings is open (not while typing elsewhere).
    panel.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!pane.classList.contains('active')) return;
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchInput.focus();
    });

    // ---- Confirm dialog ----
    let dialogResolve = null, dialogReturn = null;
    const dlgOk = dialog.querySelector('#gps-dialog-ok');
    const dlgCancel = dialog.querySelector('#gps-dialog-cancel');
    function confirmReset(title, body, okLabel) {
      dialog.querySelector('#gps-dialog-title').textContent = title;
      dialog.querySelector('#gps-dialog-body').textContent = body;
      dlgOk.textContent = okLabel || 'Reset';
      dialogReturn = root.activeElement;
      dialog.hidden = false;
      dlgCancel.focus();
      return new Promise((resolve) => { dialogResolve = resolve; });
    }
    function closeDialog(result) {
      if (dialog.hidden) return;
      dialog.hidden = true;
      if (dialogResolve) dialogResolve(result);
      dialogResolve = null;
      if (dialogReturn && dialogReturn.focus) dialogReturn.focus();
    }
    dlgOk.addEventListener('click', () => closeDialog(true));
    dlgCancel.addEventListener('click', () => closeDialog(false));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(false); });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDialog(false); }
      else if (e.key === 'Tab') { // two buttons: keep focus inside
        e.preventDefault();
        (root.activeElement === dlgOk ? dlgCancel : dlgOk).focus();
      }
    });

    // ---- Resets (only preference keys; never account, keys, notes or data) ----
    const RESETS = {
      theme() {
        [THEME_KEY, THEME_USER_SET_KEY, CUSTOM_THEME_KEY, CUSTOM_COLOR_KEY].forEach(safeDel);
        THEMES.custom = loadCustomTheme();
        refreshCustomTile();
        applyTheme('matte');
      },
      colors() {
        [CUSTOM_THEME_KEY, CUSTOM_COLOR_KEY].forEach(safeDel);
        THEMES.custom = loadCustomTheme();
        refreshCustomTile();
        if (theme === 'custom') applyTheme('custom');
      },
      panel() {
        safeDel(APPEARANCE_KEY);
        appearance = loadAppearance();
        applyAppearance({}, { transient: true });
        setSizeUI('full');
        applyPanelSize('full');
      },
      effects() {
        [PARTICLE_KEY, PARTICLE_SIZE_KEY, PARTICLE_FX_KEY].forEach(safeDel);
        particleFx = loadParticleFx();
        particleMargin = 40;
        resizeParticleCanvas();
        setParticleUI('off');
        setParticleStyle('off', { persist: false });
      },
      type() {
        [FONT_KEY, SPEED_KEY, TYPE_KEY].forEach(safeDel);
        typeScale = loadTypeScale();
        applyTypeScale();
        setFontUI('mono');
        setSpeedUI('normal');
      },
      icon() {
        [ICON_KEY, ICON_LOOK_KEY, ICON_COLOR_MODE_KEY].forEach(safeDel);
        setIconUI('dot'); setLookUI('minimal'); setColorModeUI('page');
        renderMiniIcon(); applyMiniLook(); applyMiniColorMode();
      },
      controls() {
        [TTS_KEY, AUTOCONFIRM_KEY].forEach(safeDel);
        if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
        renderTtsBtn(); renderAutoConfirmBtn();
      }
    };
    const RESET_COPY = {
      theme: ['Reset theme?', 'Returns to Matte Black and clears your custom colors.'],
      colors: ['Reset custom colors?', 'Your custom theme goes back to its starting palette.'],
      panel: ['Reset panel?', 'Size returns to full page and every appearance slider to its default.'],
      effects: ['Reset effects?', 'Particles turn off and their sliders return to defaults.'],
      type: ['Reset typography?', 'Font, text size, line height and typing speed return to defaults.'],
      icon: ['Reset icon?', 'The minimized button returns to the default dot.'],
      appearance: ['Reset appearance?', 'Panel, effects, typography and icon settings return to defaults. Your theme stays.'],
      all: ['Reset all settings?', 'Theme, colors, panel, effects, typography, icon, voice and page-action settings return to defaults for this profile. Your account, keys, notes and saved work are not touched.']
    };
    const RESET_GROUPS = {
      appearance: ['panel', 'effects', 'type', 'icon'],
      all: ['theme', 'panel', 'effects', 'type', 'icon', 'controls']
    };
    gps.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-reset]');
      if (!btn) return;
      const which = btn.dataset.reset;
      const copy = RESET_COPY[which];
      if (!copy) return;
      const ok = await confirmReset(copy[0], copy[1], which === 'all' ? 'Reset all' : 'Reset');
      if (!ok) return;
      (RESET_GROUPS[which] || [which]).forEach((g) => { try { RESETS[g](); } catch (err) { console.warn('[Agent Console] reset failed:', g, err); } });
      if (typeof saveProgress === 'function') { try { saveProgress(); } catch (err) { /* not signed in */ } }
      refreshAll();
      showToast(copy[0].replace('?', '') + ' done.');
    });

    // ---- Theme hook: called by applyTheme() after the tokens change ----
    onThemeApplied = function () {
      markTiles();
      if (!previewing) themeCap.textContent = themeName(theme);
      if (activeSec === 'overview') refreshOverview();
      if (activeSec === 'icon') refreshIconPreview();
      if (activeSec === 'colors') renderContrast();
    };

    // ---- Full refresh (initial load and after a profile restore) ----
    function refreshAll() {
      typeScale = loadTypeScale();
      applyTypeScale();
      renderGalleries();
      renderColorRows();
      renderAppearance();
      renderEffects();
      renderTypeOutputs();
      renderTypeSample(false);
      refreshIconPreview();
      refreshOverview();
      refreshAi();
      syncPressed();
      themeCap.textContent = themeName(theme);
      if (searching) runSearch();
    }
    gpsRefreshAll = refreshAll;

    refreshAll();
    const saved = safeGet(SECTION_KEY);
    showSection(SECTIONS.includes(saved) ? saved : 'overview');
  })();

  // ---- Session restore on load ----
  // If this browser already had someone signed in, skip straight back in.
  (function restoreSession() {
    const savedUser = localStorage.getItem(SESSION_KEY);
    if (savedUser && readProfile(savedUser)) {
      enterApp(savedUser);
    } else {
      localStorage.removeItem(SESSION_KEY);
      loginOverlay.style.display = 'flex';
      setLockedChrome(true);
      refreshAccountUI();
    }
  })();

})();
