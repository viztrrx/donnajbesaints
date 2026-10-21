// Text messages through Telnyx (telnyx.com): "text me the subscribe link"
// from the console, and a tiny reply bot for people paying cash.
//
// Worker secrets/vars (Cloudflare → the worker → Settings → Variables):
//   TELNYX_API_KEY    — API key (Telnyx portal → Auth → API Keys). Secret.
//   TELNYX_FROM       — the Telnyx number texts come from, e.g. +12395550123.
//   TELNYX_PUBLIC_KEY — the webhook public key (portal → Keys & Credentials →
//                       Public Key), so /sms/inbound only trusts Telnyx.
//   TELNYX_PROFILE_ID — optional messaging profile id.
// US carriers only deliver application texts from a registered sender (10DLC
// campaign or a verified toll-free number); see README → Texting.

export const SMS_API_DEFAULT = 'https://api.telnyx.com/v2';
const apiBase = (env) => String((env && env.TELNYX_API) || SMS_API_DEFAULT).replace(/\/+$/, '');

export const smsReady = (env) => !!(env && String(env.TELNYX_API_KEY || '').trim() && normPhone(env.TELNYX_FROM));

// US numbers only: 10 digits, or 11 starting with 1 → +1XXXXXXXXXX.
export function normPhone(v) {
  const d = String(v || '').replace(/[^\d]/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return '';
  return '+1' + ten;
}
// (239) 555-0123
export const prettyPhone = (e164) => { const d = String(e164 || '').replace(/^\+1/, ''); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(e164 || ''); };

export async function sendSms(env, to, text) {
  const body = { from: normPhone(env.TELNYX_FROM), to, text };
  if (env.TELNYX_PROFILE_ID) body.messaging_profile_id = String(env.TELNYX_PROFILE_ID);
  const r = await fetch(apiBase(env) + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + String(env.TELNYX_API_KEY).trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = (d.errors && d.errors[0]) || {};
    throw Object.assign(new Error('The text didn’t send: ' + (e.detail || e.title || ('Telnyx ' + r.status))), { status: r.status, code: e.code });
  }
  return d.data || {};
}

const b64 = (s) => Uint8Array.from(atob(String(s || '').trim()), (c) => c.charCodeAt(0));
// Telnyx signs `${timestamp}|${rawBody}` with Ed25519 (headers
// telnyx-signature-ed25519, telnyx-timestamp). Old timestamps are refused so a
// captured webhook can't be replayed.
export async function telnyxSignatureOk(publicKeyB64, sigB64, timestamp, rawBody, nowS = Math.floor(Date.now() / 1000)) {
  const t = parseInt(timestamp, 10);
  if (!publicKeyB64 || !sigB64 || !Number.isFinite(t) || Math.abs(nowS - t) > 300) return false;
  let key = null;
  const raw = b64(publicKeyB64);
  for (const alg of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try { key = await crypto.subtle.importKey('raw', raw, alg, false, ['verify']); break; } catch (e) { /* try the next name */ }
  }
  if (!key) return false;
  try { return await crypto.subtle.verify(key.algorithm, key, b64(sigB64), new TextEncoder().encode(t + '|' + rawBody)); } catch (e) { return false; }
}

// What an incoming text asks for. Carriers require STOP/START/HELP to work.
export function smsKeyword(text) {
  const t = String(text || '').trim().toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPTOUT|REVOKE)$/.test(t)) return 'stop';
  if (/^(START|UNSTOP|YES)$/.test(t)) return 'start';
  if (/^(HELP|INFO)$/.test(t)) return 'help';
  if (/\bCASH\b/.test(t)) return 'cash';
  return 'other';
}

// "viztrrx (owner), ana and kj"
export function namesList(names) {
  const n = names.filter(Boolean);
  return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' or ' + n[n.length - 1];
}
