// Appended to every page the proxy serves: tells the Saints Service Proxy tab
// which address the frame is on (a cross-origin frame's address can't be
// read), so its Back / Forward buttons follow links clicked inside the page.
// Only the page's own proxy address is sent, and only to the frame's parent.
// The Worker's own pages allow exactly this script by its hash; a proxied
// site whose CSP refuses inline scripts simply doesn't report.
export const NAV_REPORT_JS = 'try{parent!==window&&parent.postMessage({saintsProxy:1,type:"nav",url:location.href},"*")}catch(e){}';
export const NAV_REPORT = "<script>" + NAV_REPORT_JS + "</script>";
// base64 SHA-256 of NAV_REPORT_JS (tests/proxy-worker.test.mjs checks it).
export const NAV_REPORT_HASH = "'sha256-WgDDkgF3oqj/BiFmvbSgbRCmqiWSD6QDaiioGDyTBXs='";
