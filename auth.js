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

/* PHASE 1 FAST READS (Sarah 2026-10-17: the Hub → Supabase, for speed). The finished screen data is also kept on Supabase;
   a screen that is switched on there (engine_config HUB_FAST_PAGES) opens from it in ~0.4 s instead of 3–6 s. Anything that
   copy cannot serve — a partner, a preview, a screen not switched on, a copy older than this tab's last save, a network
   hiccup — answers "not here" and the call goes to the Hub exactly as before. Only READS ever go there. */
var FAST_ENDPOINT = "https://geszrsrdqxwtihrqzxiu.supabase.co/functions/v1/hub";
function hubPage_() { var p = (location.pathname.split('/').pop() || '').replace(/\.html?$/, ''); return p || 'today'; }

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
var AUTH_PARTNER_HOME = 'partner.html';   // Screen 6 — where a partner always lands
var AUTH_ADMIN_HOME   = 'today.html';

/* ---------- the one call every screen uses ---------- */
/* SCREEN-SWITCH CACHE (perf, 2026-08-02): every screen fetches the same props_get_all payload, so
   navigating Today → Week → Close used to pay a full 3-6s server build each time. Reads are served
   from sessionStorage for 90 seconds; ANY other call (a write, a sync) clears the cache, so acting
   on data always refetches fresh. Per-tab, wiped when the tab closes, never survives logout
   (authClear also clears sessionStorage). */
var PGA_TTL = 90000;
function pgaKey(body) { return 'owh_pga|' + body.fn + '|' + (body.scope || '') + (body.asPartner ? '|as:' + body.asPartner : ''); }   // v229: each partner preview is its own entry
/* calls that only READ — they never invalidate anything, and the first few may be served by the fast copy */
var HUB_READS = { people_get: 1, bot_updates: 1, props_settings_get: 1, props_get_all: 1, props_alerts: 1, validate: 1, props_review_list: 1, props_objections: 1, props_objections_mine: 1, props_guest_index: 1,
                  props_stay_finder: 1, props_revenue_detail: 1, props_stripe_month: 1, props_other_rev: 1, props_recurring: 1, props_close_readiness: 1 };
var HUB_FAST_SAVES = { props_set_fx: 1, props_other_rev_save: 1,                                   // Phase 4a (Close group) — see fastSave_
                       props_set_pay: 1, props_set_guests: 1, props_set_real_dates: 1, props_vrbo_payout: 1, props_vrbo_actual: 1, props_review_set: 1, props_guest_refund: 1, props_elec_decide: 1, props_sync_all: 1, props_sync_status: 1,   // 4b (bookings) + guest refund (2026-10-21)
                       props_stripe_check: 1, props_stripe_link: 1,   // 5m (2026-10-18): Stripe saves on Supabase (hub-jobs holds the Stripe engine)
                       props_dismiss_elec: 1, props_review_phase: 1,   // 5n (2026-10-18): settings saves → hub_settings
                       props_set_recurring: 1,   // 5o (2026-10-18): the Close panel's recurring box → hub-jobs recur_write
                       props_mark_final: 1, props_objection_submit: 1, props_objection_reply: 1,   // 5r (2026-10-18): the partner side → hub-jobs
                       props_settings_save: 1,
                       people_get: 1, people_save: 1, people_remove: 1, people_signout: 1, bot_save: 1, bot_updates: 1, bot_test: 1, bot_message: 1 };   // the People screen (2026-10-18)   // Phase 6 (2026-10-18): the settings tabs (settings.html)
var HUB_FAST_FNS = { props_settings_get: 1, props_get_all: 1, props_alerts: 1, props_review_list: 1, props_objections: 1, props_objections_mine: 1,
                     props_close_readiness: 1, props_other_rev: 1, props_recurring: 1, props_stripe_month: 1,
                     props_guest_index: 1, props_revenue_detail: 1, props_stay_finder: 1 };   // 5k-5 (2026-10-18): computed live on Supabase
function api(fn, extra) {
  var body = { fn: fn };
  if (extra) for (var k in extra) body[k] = extra[k];
  if (SID) body.sid = SID;                     // 'sid' is fine in a body; never in a URL
  if (fn === 'props_get_all') {
    try {
      var c = JSON.parse(sessionStorage.getItem(pgaKey(body)) || 'null');
      if (c && Date.now() - c.t < PGA_TTL) return Promise.resolve(c.j);
    } catch (e) {}
  } else if (!HUB_READS[fn] && fn.indexOf('_draft') < 0 && fn.indexOf('phone_bill') < 0) {   // drafts + phone bills live outside the payload
    // a write or a sync — what the screens show next must be rebuilt, not replayed
    try { sessionStorage.setItem('owh_fast_after', String(Date.now())); } catch (e) {}   // the fast copy must be newer than this save
    try { for (var i = sessionStorage.length - 1; i >= 0; i--) { var sk = sessionStorage.key(i); if (sk && sk.indexOf('owh_pga|') === 0) sessionStorage.removeItem(sk); } } catch (e) {}
  }
  /* GOOGLE SOMETIMES ANSWERS WITH A PAGE, NOT JSON (Sarah 2026-08-12: a save came back
     «Unexpected token '<', "<!DOCTYPE "…»). That is Apps Script's own error/redirect page after a
     transient failure — nothing to do with the data being sent. Parsing it threw a developer
     error at the user. Now: read the body as text, and if it isn't JSON, retry the call ONCE;
     if it still isn't, return a plain-language error that says what to check. */
  function post_() {
    return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { return { __html: true, snippet: String(t).slice(0, 60) }; } });
  }
  /* Silent retry READS ONLY (2026-10-01). The one-retry above was firing for writes too: a write
     whose first POST already LANDED server-side but came back as an HTML glitch page was being
     re-sent, writing a second row — the 8A internet double (two NETC cards a minute apart). A write
     is never auto-resent now; it returns "may already have saved — refresh". Reads still self-heal. */
  var isRead = (!!HUB_READS[fn] || fn.indexOf('_draft') > -1 || fn.indexOf('phone_bill') > -1);
  // the fast copy first (reads only); anything but a clean answer → the Hub, as before
  function fast_() {
    var after = 0; try { after = Number(sessionStorage.getItem('owh_fast_after') || 0); } catch (e) {}
    if (after && Date.now() - after > 10 * 60 * 1000) after = 0;            // older saves are long since in the copy
    var fb = { fn: fn, sid: body.sid, scope: body.scope, asPartner: body.asPartner, month: body.month, flat: body.flat, page: hubPage_(), after: after };
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : null;
    return fetch(FAST_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(fb), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (to) clearTimeout(to); return (j && j.ok) ? j : null; })
      .catch(function () { if (to) clearTimeout(to); return null; });
  }
  /* PHASE 4 SAVES (2026-10-17): a save whose tab group lives on Supabase is made there (≈0.3–1 s). Before the switch the
     engine answers FAST_OFF / NO_FAST and the save goes to the Hub exactly as before. A write is NEVER sent twice: if the
     engine can't be reached, the page says so instead of trying the Hub as well. */
  function fastSave_() {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    var fb = {}; for (var k2 in body) fb[k2] = body[k2]; fb.page = hubPage_();
    return fetch(FAST_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(fb), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (to) clearTimeout(to);
        if (j && (j.code === 'FAST_OFF' || j.code === 'NO_FAST')) return post_();
        return j; })
      .catch(function () { if (to) clearTimeout(to);
        return { ok: false, code: 'SAVE_UNSURE', error: 'No answer from the server — refresh before retrying, the entry may already have saved.' }; });
  }
  var first = (SID && HUB_FAST_SAVES[fn]) ? fastSave_()
            : (SID && HUB_FAST_FNS[fn]) ? fast_().then(function (j) { return j || post_(); }) : post_();
  return first
    .then(function (j) { return (j && j.__html && isRead) ? post_() : j; })    // one silent retry — reads only
    .then(function (j) {
      if (j && j.__html) {
        return { ok: false, code: 'BAD_REPLY',
                 error: 'Google returned a page instead of data (a temporary glitch).' +
                        (isRead ? ' Try again in a moment.' : ' Refresh before retrying — the entry may already have saved.') };
      }
      return j;
    })
    .then(function (j) {
      if (fn === 'props_get_all' && j && j.ok) {
        try { sessionStorage.setItem(pgaKey(body), JSON.stringify({ t: Date.now(), j: j })); } catch (e) {}
      }
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
  try {  // the navigation cache must not survive a sign-out either
    var kill2 = [];
    for (var i2 = 0; i2 < sessionStorage.length; i2++) { var k2 = sessionStorage.key(i2); if (k2 && k2.indexOf('owh_pga|') === 0) kill2.push(k2); }
    for (var j2 = 0; j2 < kill2.length; j2++) sessionStorage.removeItem(kill2[j2]);
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
    (role === 'partner' ? 'This screen is not part of your owner view.' : 'Signed in as ' + role + '.') + '</p>' +
    '<button onclick="logout()" style="border:0;background:#cc5f5f;color:#fff;font-family:inherit;font-weight:700;' +
    'font-size:13px;border-radius:9px;padding:8px 18px;cursor:pointer">Sign out</button></div>';
  return false;
}

/* SIGN-IN ON SUPABASE (2026-10-18): sign in / out at the fast endpoint; until it is switched on it answers FAST_OFF and the Hub does it, as before */
function authPost_(body) {
  var post = function (url) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); };
  return post(FAST_ENDPOINT).then(function (j) { return (j && (j.code === 'FAST_OFF' || j.code === 'NO_FAST')) ? post(ENDPOINT) : j; }, function () { return post(ENDPOINT); });
}
function logout() {
  var old = SID;
  if (old) authPost_({ fn: 'logout', sid: old }).catch(function () {});
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
        '<a href="reset.html" style="display:block;margin-top:10px;font-size:11.5px;color:#6b6b6b;text-decoration:none">Forgot your password?</a>' +
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
  authPost_({ fn: 'login', user: u, pw: pw })
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

/* ---------- MONTH PICKERS = YEAR + MONTH (Sarah 2026-11-03: "the drop down is becoming very long") ----------
 * Every Hub screen loads this file, so any <select> whose choices are months (yyyy-mm) is shown as two short selects —
 * the year, then that year's months — including selects a screen builds later. The original select stays the source of
 * truth, hidden: picking sets its value and fires its own change event, so each screen's own handler runs untouched.
 * Choices that are not months (Stats' "previous month", "3-month average") sit at the top of the year list.
 * A select that must stay as it is carries data-ym="off". */
(function () {
  if (typeof document === 'undefined' || !window.MutationObserver) return;
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function isYm(v) { return /^\d{4}-\d{2}$/.test(v); }
  function optsOf(s) { var o = []; for (var i = 0; i < s.options.length; i++) o.push({ v: s.options[i].value, t: s.options[i].text }); return o; }
  function qualifies(s) {
    if (s.multiple || s.getAttribute('data-ym') === 'off' || (s.parentNode && s.parentNode.className === 'ym-pair')) return false;
    var o = optsOf(s), n = 0; for (var i = 0; i < o.length; i++) if (isYm(o[i].v)) n++;
    return n >= 2 && o.length - n <= 3;                       // months, plus at most a few special choices
  }
  function setSrc(s, v) { if (s.value === v) return; s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); sync(s, true); }
  function sync(s, force) {
    var w = s.__ym; if (!w) return;
    var o = optsOf(s), sig = o.map(function (x) { return x.v; }).join(',') + '|' + s.value;
    var vis = s.style.display === 'none' ? 'none' : '';
    if (w.style.display !== vis) w.style.display = vis;
    if (!force && w.__sig === sig) return; w.__sig = sig;
    var y = w.firstChild, m = w.lastChild, cur = s.value, years = [], specials = o.filter(function (x) { return !isYm(x.v); });
    o.forEach(function (x) { if (isYm(x.v) && years.indexOf(x.v.slice(0, 4)) < 0) years.push(x.v.slice(0, 4)); });
    y.innerHTML = specials.map(function (x) { return '<option value="s:' + x.v.replace(/"/g, '&quot;') + '">' + x.t.replace(/</g, '&lt;') + '</option>'; }).join('') +
                  years.map(function (yr) { return '<option value="' + yr + '">' + yr + '</option>'; }).join('');
    if (isYm(cur)) {
      y.value = cur.slice(0, 4);
      m.innerHTML = o.filter(function (x) { return isYm(x.v) && x.v.slice(0, 4) === cur.slice(0, 4); })
                     .map(function (x) { return '<option value="' + x.v + '">' + MN[+x.v.slice(5, 7) - 1] + '</option>'; }).join('');
      m.value = cur; m.style.display = '';
    } else { y.value = 's:' + cur; m.style.display = 'none'; }
  }
  function enhance(s) {
    var w = document.createElement('span'); w.className = 'ym-pair';
    var y = document.createElement('select'), m = document.createElement('select');
    y.setAttribute('aria-label', 'Year'); m.setAttribute('aria-label', 'Month');
    [y, m].forEach(function (x) { x.style.cssText = s.style.cssText; x.style.display = ''; x.className = s.className; w.appendChild(x); });
    y.onchange = function () {
      if (y.value.indexOf('s:') === 0) { setSrc(s, y.value.slice(2)); return; }
      var inYr = optsOf(s).filter(function (x) { return isYm(x.v) && x.v.slice(0, 4) === y.value; }).map(function (x) { return x.v; });
      var same = y.value + (isYm(s.value) ? s.value.slice(4) : '');   // the same month in the other year, when it exists
      setSrc(s, inYr.indexOf(same) > -1 ? same : inYr[0]);
    };
    m.onchange = function () { setSrc(s, m.value); };
    s.__ym = w; s.classList.add('ym-src'); s.parentNode.insertBefore(w, s.nextSibling);
    sync(s, true);
  }
  var queued = false;
  function scan() {
    queued = false;
    var all = document.querySelectorAll('select');
    for (var i = 0; i < all.length; i++) { var s = all[i];
      if (s.__ym) { if (!s.__ym.parentNode && s.parentNode) s.parentNode.insertBefore(s.__ym, s.nextSibling); sync(s); }
      else if (qualifies(s)) enhance(s); }
  }
  function later() { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(scan); } }
  function start() {
    var st = document.createElement('style');
    st.textContent = 'select.ym-src{display:none!important}.ym-pair{display:inline-flex;gap:4px;align-items:center;vertical-align:middle}';
    document.head.appendChild(st);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    setInterval(scan, 1500);                                  // a value a screen sets in code, without a change event
    scan();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
