// WEMEDIA · Passwortschutz (Vercel Routing Middleware)
// Ein gemeinsames Team-Passwort für Cockpit und CRM. Im Code liegt nur ein Hash –
// das Passwort selbst steht nirgends. Passwort ändern: neuen Hash erzeugen (siehe README).
export const config = { matcher: '/((?!favicon\\.png|icon\\.png|icon-green\\.png|wordmark\\.png|robots\\.txt).*)' };

const COOKIE = 'wm_auth';
const SALT = 'wemedia-cockpit-v1';
const ITER = 100000;
const TOKEN_HASH = 'e2fb48cf11a40410665a8e14e99fff125869360af10e932a7c86e419aa6328e2';
const APP = 'cockpit';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage angemeldet bleiben

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function tokenFor(pw) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITER }, key, 256));
}
const valid = async (t) => !!t && /^[0-9a-f]{64}$/.test(t) && (await sha(t)) === TOKEN_HASH;
const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });
const cookie = (v, age) => `${COOKIE}=${v}; Path=/; Max-Age=${age}; Secure; SameSite=None; Partitioned`;
function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : '';
}
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const redirect = (to, setCookie) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });

// Öffentlich für Kunden: Terminbuchung (CRM, ?book=1) und Onboarding-Fragebogen (Cockpit, ?onboarding=…)
function isPublic(url) {
  if (APP === 'crm' && url.searchParams.get('book') === '1') return true;
  if (APP === 'cockpit' && url.searchParams.has('onboarding')) return true;
  return false;
}

function loginPage(next, error) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Anmelden · WEMEDIA</title><link rel="icon" href="/favicon.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font-family:"Inter Tight",system-ui,sans-serif;color:#fff;background:radial-gradient(800px 380px at 90% -10%,#cefb5633,transparent 60%),linear-gradient(135deg,#1c1c1f,#131315 60%,#0e0e10)}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background-image:repeating-linear-gradient(0deg,#cefb5626 0 1px,transparent 1px 36px),repeating-linear-gradient(90deg,#cefb5626 0 1px,transparent 1px 36px);-webkit-mask-image:radial-gradient(60% 70% at 70% 10%,#000,transparent 75%);mask-image:radial-gradient(60% 70% at 70% 10%,#000,transparent 75%)}
.box{position:relative;width:min(420px,100%);background:#ffffff0f;border:1px solid #ffffff1f;border-radius:26px;padding:32px 28px;backdrop-filter:blur(8px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.08em;margin-bottom:26px}.brand img{width:34px;height:34px}.brand small{display:block;font-size:9.5px;letter-spacing:.14em;color:#ffffff80;font-weight:600}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}p{margin:0 0 20px;color:#ffffffb0;font-size:14px}
label{display:block;font-size:12px;font-weight:600;color:#ffffffb0;margin-bottom:6px}
input{width:100%;height:46px;border-radius:14px;border:1px solid #ffffff2e;background:#ffffff14;color:#fff;font:inherit;font-size:15px;padding:0 14px;outline:0}input:focus{border-color:#cefb56;box-shadow:0 0 0 3px #cefb5633}
button{margin-top:14px;width:100%;height:46px;border:0;border-radius:99px;background:#cefb56;color:#141416;font:inherit;font-weight:700;font-size:15px;cursor:pointer}button:hover{background:#c2f23c}
.err{background:#fde9e9;color:#c23c3c;border-radius:12px;padding:9px 12px;font-size:13px;font-weight:600;margin-bottom:14px}.hint{margin-top:16px;font-size:12px;color:#ffffff73;text-align:center}</style></head>
<body><form class="box" method="post" action="/__login" onsubmit="this.h.value=location.hash">
<div class="brand"><img src="/icon.png" alt=""><span>WEMEDIA<small>${APP === 'crm' ? 'CRM' : 'COCKPIT'} · INTERN</small></span></div>
<h1>Anmelden</h1><p>Nur für das WEMEDIA-Team. Bitte Team-Passwort eingeben.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<label for="pw">Passwort</label><input id="pw" name="pw" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(next)}"><input type="hidden" name="h" value="">
<button type="submit">Anmelden</button><div class="hint">Du bleibst 30 Tage auf diesem Gerät angemeldet.</div></form></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export default async function middleware(req) {
  const url = new URL(req.url);

  if (url.pathname === '/__logout') return redirect('/', cookie('', 0));

  if (req.method === 'POST' && url.pathname === '/__login') {
    const form = await req.formData();
    const next = safeNext(String(form.get('next') || '/'));
    const h = String(form.get('h') || '');
    const tok = await tokenFor(String(form.get('pw') || ''));
    if (await valid(tok)) return redirect(next + (/^#[\w\-\/:.]*$/.test(h) ? h : ''), cookie(tok, MAX_AGE));
    await new Promise((r) => setTimeout(r, 600)); // bremst Rate-Versuche
    return loginPage(next, 'Falsches Passwort – bitte nochmal versuchen.');
  }

  if (isPublic(url)) return pass();
  if (await valid(readCookie(req))) return pass();

  // Cockpit bettet das CRM ein und reicht die Anmeldung einmalig weiter (?wmauth=…)
  const t = url.searchParams.get('wmauth');
  if (t && (await valid(t))) {
    url.searchParams.delete('wmauth');
    return redirect(url.pathname + url.search, cookie(t, MAX_AGE));
  }

  return loginPage(url.pathname + url.search, '');
}
