/* ============================================================
 * auth.js — shared session auth for every Hub screen.
 *
 * ADD TO A NEW SCREEN IN 2 STEPS:
 *   1) in <head> or before the screen's own <script>:
 *        <script src="auth.js"></script>
 *   2) at the bottom of the screen's script, replace  boot();  with:
 *        AUTH_ON_LOGIN = boot; if (authGuard()) boot();
 *
 * Then call the backend with  api('fn_name', {param:value})  instead of
 * building a fetch URL. The session token is attached automatically.
 *
 * WHY POST: the token must never sit in a URL — 'sid' is a RESERVED query
 * param on script.google.com (Google's edge 400s the request before the
 * script runs), and URLs leak into logs/history. In a POST body it is safe.
 * Content-Type text/plain keeps it a "simple" CORS request (no preflight).
 *
 * ONE login covers every screen: the token lives in localStorage, which is
 * shared across all pages of the same site. Switching screens costs nothing.
 * ============================================================ */

/* the ONE place the backend URL is written — every screen reads it from here */
var ENDPOINT = "https://script.google.com/macros/s/AKfycbzhR3ESnz3HQyStXvg5OLp5qKZj3lghCuuJtXIkwuEag1cMWLi9JeDCdZhtqtJoZeTJ/exec";

var SID = null, ME = null;
try { SID = localStorage.getItem('owh_sid') || null; ME = JSON.parse(localStorage.getItem('owh_me') || 'null'); } catch (e) {}

/* the screen's own loader — auth.js calls it after a successful sign-in */
var AUTH_ON_LOGIN = null;

/* WHICH ROLE MAY OPEN THIS SCREEN. Each screen may override before calling authGuard():
 *   'admin'   (default) — Sarah/Khaled only. A partner is sent to their own screen.
 *   'partner'           — the partner screens (admins may view them too, to check/demo).
 *   'any'               — no role restriction.
 * The partner NEVER lands on today/week/stats/close/repairs/internet: those are admin screens.
 * Role is taken from the server's response, so editing localStorage cannot widen access — and the
 * backend scopes the data by session regardless, so this is presentation, not the security boundary. */
var AUTH_ROLE = 'admin';
/* Set to 'partner.html' once Screen 6 exists. While empty, a partner sees an explanation instead of
 * being redirected to a page that isn't built yet. */
var AUTH_PARTNER_HOME = '';
var AUTH_ADMIN_HOME   = 'today.html';

/* ---------- the one call every screen uses ---------- */
function api(fn, extra) {
  var body = { fn: fn };
  if (extra) for (var k in extra) body[k] = extra[k];
  if (SID) body.sid = SID;                     // 'sid' is fine in a body; never in a URL
  return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.ok === false && j.code === 'AUTH') {          // token missing/expired/revoked
        authClear(); authShowForm('Your session expired — please sign in again.');
        throw new Error('AUTH');                                // screens ignore this one (form is already up)
      }
      /* The server states who you are on every read. Trust that over the cached copy, then re-check
         the screen — so editing ME.role in localStorage can't render an admin screen. */
      if (j && j.me && j.me.role) {
        ME = j.me;
        try { localStorage.setItem('owh_me', JSON.stringify(ME)); } catch (e) {}
        if (!authRoleOk()) throw new Error('AUTH');
      }
      return j;
    });
}

/* ---------- session state ---------- */
/* wipes the token AND every cached screen payload (P&L data must not survive a sign-out) */
function authClear() {
  SID = null; ME = null;
  try {
    var kill = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('owh_') === 0) kill.push(k); }
    for (var j = 0; j < kill.length; j++) localStorage.removeItem(kill[j]);
  } catch (e) {}
}

/* call before loading a screen: true = go ahead, false = a form/notice was shown instead */
function authGuard() {
  if (!SID) { authShowForm(''); return false; }
  return authRoleOk();
}

/* Is the signed-in role allowed on this screen? Wrong role → send them to their own screen. */
function authRoleOk() {
  var need = AUTH_ROLE || 'admin';
  var role = (ME && ME.role) || '';
  if (need === 'any' || !role) return true;
  if (need === 'admin'   && role !== 'admin')                        return authWrongScreen(AUTH_PARTNER_HOME, 'partner');
  if (need === 'partner' && role !== 'partner' && role !== 'admin')  return authWrongScreen(AUTH_ADMIN_HOME, role);
  return true;
}

function authWrongScreen(target, role) {
  var here = (location.pathname.split('/').pop() || '');
  if (target && target !== here) { location.replace(target); return false; }
  document.body.innerHTML =
    '<div style="font-family:Cairo,sans-serif;max-width:340px;margin:60px auto;background:#fff;border:1px solid #ecdede;' +
    'border-radius:16px;padding:22px;text-align:center;color:#1a1a1a">' +
    '<img src="hub-logo.png" alt="" style="width:64px;height:64px;border-radius:13px;margin-bottom:10px">' +
    '<h2 style="margin:0 0 6px;font-size:17px">Not your screen</h2>' +
    '<p style="margin:0 0 14px;font-size:12px;color:#6b6b6b">This screen is for the OWH team. ' +
    (role === 'partner' ? 'Your own statement screen is not published yet.' : 'Signed in as ' + role + '.') + '</p>' +
    '<button onclick="logout()" style="border:0;background:#cc5f5f;color:#fff;font-family:inherit;font-weight:700;' +
    'font-size:13px;border-radius:9px;padding:8px 18px;cursor:pointer">Sign out</button></div>';
  return false;
}

function logout() {
  var old = SID;
  if (old) fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: 'logout', sid: old }) }).catch(function () {});
  authClear();
  authShowForm('');
}

/* ribbon HTML: who you are + a way out. Use in a screen's topbar. */
function authWho() {
  if (!ME) return '';
  return '<b>' + (ME.user || '') + '</b>' + (ME.role && ME.role !== 'admin' ? ' (' + ME.role + ')' : '') +
         ' · <a href="#" onclick="logout();return false" style="color:#cc5f5f;text-decoration:none;font-weight:700">log out</a>';
}

/* ---------- the sign-in form (injected, so no screen carries form markup) ---------- */
function authShowForm(msg) {
  var w = document.getElementById('owhLoginWrap');
  if (!w) {
    var st = document.createElement('style');
    st.textContent =
      '#owhLoginWrap{position:fixed;inset:0;background:#dcd0d0;display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;font-family:Cairo,sans-serif}' +
      '#owhLoginWrap .lb{background:#fff;border:1px solid #ecdede;border-radius:18px;box-shadow:0 6px 28px rgba(0,0,0,.14);padding:22px 20px;width:100%;max-width:320px;text-align:center}' +
      '#owhLoginWrap img{width:72px;height:72px;border-radius:14px;margin:0 auto 9px;display:block}' +
      '#owhLoginWrap h2{margin:0 0 3px;font-size:18px;color:#1a1a1a;font-weight:700}' +
      '#owhLoginWrap p{margin:0 0 16px;font-size:11.5px;color:#6b6b6b}' +
      '#owhLoginWrap label{text-align:left}' +
      '#owhLoginWrap label{display:block;font-size:10px;color:#6b6b6b;margin:0 0 3px}' +
      '#owhLoginWrap input{width:100%;font-family:inherit;font-size:15px;padding:9px 10px;border:1px solid #ecdede;border-radius:9px;margin-bottom:11px;background:#f6f2f2;color:#1a1a1a}' +
      '#owhLoginWrap button{width:100%;border:0;background:#cc5f5f;color:#fff;font-family:inherit;font-weight:700;font-size:14.5px;border-radius:10px;padding:10px;cursor:pointer}' +
      '#owhLoginWrap button:disabled{opacity:.55;cursor:default}' +
      '#owhLoginMsg{font-size:11.5px;color:#cc5f5f;min-height:15px;margin-top:9px;text-align:center;line-height:1.4}';
    document.head.appendChild(st);

    w = document.createElement('div');
    w.id = 'owhLoginWrap';
    w.innerHTML =
      '<form class="lb" onsubmit="authLogin();return false">' +
        '<img src="hub-logo.png" alt="The Hub">' +
        '<h2>The Hub</h2>' +
        '<p>Our Welcome Home · sign in to continue</p>' +
        '<label for="owhU">Username</label>' +
        '<input id="owhU" autocomplete="username" autocapitalize="none" spellcheck="false">' +
        '<label for="owhP">Password</label>' +
        '<input id="owhP" type="password" autocomplete="current-password">' +
        '<button id="owhB" type="submit">Sign in</button>' +
        '<div id="owhLoginMsg"></div>' +
      '</form>';
    document.body.appendChild(w);
  }
  w.style.display = 'flex';
  document.getElementById('owhLoginMsg').textContent = msg || '';
  var u = document.getElementById('owhU');
  if (ME && ME.user && !u.value) u.value = ME.user;               // remember who last signed in on this device
  setTimeout(function () { (u.value ? document.getElementById('owhP') : u).focus(); }, 60);
}

function authHideForm() { var w = document.getElementById('owhLoginWrap'); if (w) w.style.display = 'none'; }

function authLogin() {
  var u = (document.getElementById('owhU').value || '').trim(),
      pw = document.getElementById('owhP').value || '',
      b  = document.getElementById('owhB'),
      m  = document.getElementById('owhLoginMsg');
  if (!u || !pw) { m.textContent = 'Enter your username and password.'; return; }
  b.disabled = true; b.textContent = 'Signing in…'; m.textContent = '';
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: 'login', user: u, pw: pw }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      b.disabled = false; b.textContent = 'Sign in';
      if (!j || !j.ok) { m.textContent = (j && j.error) || 'Sign-in failed.'; return; }
      SID = j.sid; ME = { user: j.user, role: j.role, flat: j.flat };
      try { localStorage.setItem('owh_sid', SID); localStorage.setItem('owh_me', JSON.stringify(ME)); } catch (e) {}
      document.getElementById('owhP').value = '';
      authHideForm();
      if (AUTH_ON_LOGIN) AUTH_ON_LOGIN();                        // load the screen we're on
    })
    .catch(function () { b.disabled = false; b.textContent = 'Sign in'; m.textContent = "Couldn't reach the server — check your connection."; });
}
