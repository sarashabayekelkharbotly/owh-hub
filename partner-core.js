/* partner-core.js — ONE definition of the owner's statement, shared by «This month» (partner.html) and «Statistics»
   (partner-history.html) so the two screens, and both CSV exports, can never show different rows (Sarah 2026-10-13:
   "the export CSV and the table of Your history should show the same rows as the statement view").

   PC.model(D, flat, ym)   one month, everything in USD (the sheet's own basis); the page converts for display
   PC.rowDefs(models)      the ordered rows: operational KPIs → the statement chain → costs (EVERY category) → month result
                           → the Clause-7 settlement. Each row has get(model) so a page can lay them out over 1, 2 or 12 months.
   Pages keep their own layout, drill-downs and currency toggle; they never re-derive a figure. */
var PC = (function () {
  var ORDER = ['cleaning-labor', 'laundry', 'supplies', 'electricity', 'tv-phone-internet', 'water', 'heat-gas', 'furniture', 'maintenance',
               'compound-maintenance', 'opsmanager', 'services-contingency', 'contingency', 'gifts-contingency', 'general-contingency', 'subscription'];
  var LABEL = { 'cleaning-labor': 'cleaning', 'laundry': 'laundry', 'supplies': 'supplies', 'electricity': 'electricity', 'tv-phone-internet': 'internet',
                'water': 'water', 'heat-gas': 'gas', 'maintenance': 'maintenance', 'furniture': 'furniture', 'compound-maintenance': 'compound',
                'opsmanager': 'operations', 'services-contingency': 'services', 'contingency': 'contingency', 'gifts-contingency': 'gifts',
                'general-contingency': 'general', 'subscription': 'booking software' };
  /* statement cost line → the category the drill-down entries carry (tx.cat) */
  var CATMAP = { 'electricity': '__electricity', 'subscription': '__subscription', 'laundry': 'laundry', 'supplies': 'supplies', 'cleaning-labor': 'cleaning-labor',
                 'opsmanager': 'opsManager', 'services-contingency': 'Services', 'maintenance': 'Maintenance', 'furniture': 'Furniture', 'tv-phone-internet': 'TV/Phone/Internet',
                 'water': 'Water', 'heat-gas': 'Heat/gas', 'compound-maintenance': 'compound maintenance', 'contingency': 'contingency', 'gifts-contingency': 'Gifts',
                 'general-contingency': 'General' };

  function r2(x) { return Math.round(x * 100) / 100; }
  function monthsOf(D, f) { return D.pnl && D.pnl[f] ? Object.keys(D.pnl[f]).sort() : []; }
  function recOf(D, f, m) { return (D.pnl && D.pnl[f] && D.pnl[f][m]) || null; }
  function fxNow(D) { return (D.meta.fx && D.meta.fx.current) || 1; }
  /* The month's own EGP/USD rate, recovered from the sheet's own figures: the P&L's Net already has the EGP costs converted,
     so (EGP costs) ÷ (their USD value) gives back exactly the rate the sheet used. Nothing hardcoded. */
  function rateOf(D, r) {
    if (!r) return fxNow(D);
    var egp = 0, usd = 0;
    (r.costs || []).forEach(function (c) { if (!c.amount) return; if (c.currency === 'EGP') egp += c.amount; else usd += c.amount; });
    var allUsd = r.revenue.total - r.net, egpUsd = allUsd - usd;
    return (egp > 0 && egpUsd > 0.01) ? egp / egpUsd : fxNow(D);
  }
  function daysIn(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function nightsOf(s, ym) {
    var lo = new Date(ym + '-01T00:00:00'), hi = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 1), n = 0;
    var ci = new Date(s.checkIn.slice(0, 10) + 'T00:00:00'), co = new Date(s.checkOut.slice(0, 10) + 'T00:00:00');
    for (var d = new Date(Math.max(ci, lo)); d < co && d < hi; d.setDate(d.getDate() + 1)) n++;
    return n;
  }
  function liveStays(D, f) {
    return (D.stays || []).filter(function (s) {
      var st = (s.status || '').toLowerCase();
      return s.flat === f && s.portal !== 'Blocked' && st.indexOf('cancel') < 0 && st.indexOf('block') < 0 && s.checkIn && s.checkOut;
    });
  }
  function staysIn(D, f, ym) {
    return liveStays(D, f).filter(function (s) { return s.checkIn.slice(0, 7) <= ym && s.checkOut.slice(0, 7) >= ym; })
                          .sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : 1; });
  }
  /* A stay's money for one month (USD): (All-in − Other) ÷ nights per night inside the month — the settled revenue rule.
     Gross = what the guest paid; fees = gross − net recorded, so gross − fees = net ALWAYS. No gross on record → no fees shown. */
  function parts(s, ym) {
    var tot = s.nights || nightsOf(s, ym) || 1, k = nightsOf(s, ym) / tot, w = (s.allIn || 0) - (s.other || 0);
    var net = w * k, gross = (s.gross > 0 && s.gross >= w) ? s.gross * k : net;
    return { gross: gross, fees: gross - net, net: net };
  }
  /* A turnover is a cleaning that actually took place = a cleaning (laundry) submission — the record Annex C's cleaning formula and
     clause 6.5.1's ceiling are built on. NOT the schedule, NOT the number of stays. null = the server did not send them. */
  function turnoversOf(D, f, ym) {
    var t = D.turnovers && D.turnovers[f];
    return t ? (t[ym] || 0) : null;
  }

  function model(D, f, ym) {
    var r = recOf(D, f, ym); if (!r) return null;
    var rate = rateOf(D, r), pv = r.partnerView || {};
    var st = staysIn(D, f, ym), G = 0, N = 0, nights = 0, nightsAdr = 0, done = 0;
    st.forEach(function (s) {
      var p = parts(s, ym), n = nightsOf(s, ym);
      G += p.gross; N += p.net; nights += n; if (!s.review) nightsAdr += n;
      if ((s.checkOut || '').slice(0, 7) === ym) done++;
    });
    var E = r.revenue.earnings || 0, O = r.revenue.other || 0, T = r.revenue.total || 0;
    var fee = pv.managementFee || 0, ret = pv.reviewReturn || 0;                 // owner-funded review bookings, returned to her (outside revenue, no fee)
    var res = (pv.netPayout != null ? pv.netPayout : r.net) + ret;
    var cost = {}, costNative = {};
    (r.costs || []).forEach(function (c) {
      if (c.key === 'subscription') return;                                    // OWH's own cost, never shown
      costNative[c.key] = { amt: c.amount, cur: c.currency };
      cost[c.key] = c.amount ? (c.currency === 'USD' ? c.amount : c.amount / rate) : 0;
    });
    var all = monthsOf(D, f), i = all.indexOf(ym), pr = i > 0 ? recOf(D, f, all[i - 1]) : null, ppl = pr && pr.partnerLedger, pl = r.partnerLedger, led = null;
    if (pl) {
      var openBal = ppl ? ppl.balanceAfter : 0, prep = pl.prepay || 0;
      led = { result: pl.monthResult, applied: r2(pl.balanceAfter - openBal - prep), retained: pl.floatRetained || 0, drawn: pl.floatDrawn || 0, payable: pl.payable || 0,
              openBal: openBal, prep: prep, balAfter: pl.balanceAfter, floatOpen: r2(pl.floatAfter - (pl.floatRetained || 0) + (pl.floatDrawn || 0)),
              floatAfter: pl.floatAfter, target: pl.floatTarget, paid: pl.paidToDate || 0, still: pl.outstanding || 0 };
    }
    return { ym: ym, r: r, rate: rate, status: r.status, closedAt: r.closedAt || null, pct: pv.managementFeePct || 0,
             k: { stays: done, turn: turnoversOf(D, f, ym), nights: nights, nightsAdr: nightsAdr, occ: nights / daysIn(ym), adr: nightsAdr ? E / nightsAdr : null },
             v: { G: G, F: G - N, adj: E - N, E: E, O: O, T: T, fee: fee, share: T - fee, ret: ret, res: res, costs: (T - fee) + ret - res },
             cost: cost, costNative: costNative, led: led };
  }

  /* every category the owner can be charged, zero ones included; anything new in the sheet still appears */
  function costKeys(models) {
    var seen = {}, keys = [];
    models.forEach(function (m) { if (m) (m.r.costs || []).forEach(function (c) { seen[c.key] = 1; }); });
    ORDER.forEach(function (k) { if (k !== 'subscription') { keys.push(k); delete seen[k]; } });
    for (var k in seen) if (k !== 'subscription') keys.push(k);
    return keys;
  }

  /* THE ROWS. t: 'n' count · 'p' percent · 'm' money (USD, signed — minus = a deduction, or owed to OWH). cls drives the layout.
     sec rows are headings. `id` is stable: pages hang drill-downs on 'costs', 'cost:<key>' and 'bal'. */
  function rowDefs(models) {
    var ms = models.filter(Boolean), pct = ms.length ? ms[ms.length - 1].pct : 0;
    var any = function (fn) { return ms.some(fn); };
    var L = function (fn) { return function (m) { return m.led ? fn(m.led) : null; }; };
    var rows = [];
    rows.push({ sec: 'Operations' });
    rows.push({ id: 'stays', label: 'Stays (completed)', t: 'n', get: function (m) { return m.k.stays; } });
    rows.push({ id: 'turn', label: 'Turnovers', t: 'n', get: function (m) { return m.k.turn; } });
    rows.push({ id: 'nights', label: 'Nights', t: 'n', get: function (m) { return m.k.nights; } });
    rows.push({ id: 'occ', label: 'Occupancy', t: 'p', get: function (m) { return m.k.occ; } });
    rows.push({ id: 'adr', label: 'Average nightly rate (ADR)', t: 'm', get: function (m) { return m.k.adr; } });
    rows.push({ sec: 'Statement' });
    rows.push({ id: 'gross', label: 'Gross guest payments', t: 'm', get: function (m) { return m.v.G; } });
    rows.push({ id: 'fees', label: 'platform & card fees', cls: 'sub', t: 'm', get: function (m) { return -m.v.F; } });
    if (any(function (m) { return Math.abs(m.v.adj) > 0.02; }))
      rows.push({ id: 'adj', label: 'other adjustments', cls: 'sub', t: 'm', get: function (m) { return m.v.adj; } });
    rows.push({ id: 'earn', label: 'Earnings (net of fees)', t: 'm', get: function (m) { return m.v.E; } });
    rows.push({ id: 'other', label: 'other revenue', cls: 'sub', t: 'm', get: function (m) { return m.v.O; } });
    rows.push({ id: 'net', label: 'Net revenue', cls: 'tot', t: 'm', get: function (m) { return m.v.T; } });
    rows.push({ id: 'fee', label: 'management fee — ' + Math.round(pct * 100) + '% of net revenue', t: 'm', get: function (m) { return -m.v.fee; } });
    rows.push({ id: 'share', label: 'Your share — ' + Math.round((1 - pct) * 100) + '% of net revenue', cls: 'tot', t: 'm', get: function (m) { return m.v.share; } });
    if (any(function (m) { return Math.abs(m.v.ret) > 0.005; }))
      rows.push({ id: 'ret', label: 'Review bookings you paid — returned to you (no fee)', t: 'm', get: function (m) { return m.v.ret; } });
    rows.push({ id: 'costs', label: 'Costs paid on your behalf', cls: 'tot', t: 'm', get: function (m) { return m.v.costs; }, group: 'costs' });
    costKeys(ms).forEach(function (k) {
      rows.push({ id: 'cost:' + k, key: k, label: LABEL[k] || k, cls: 'cat', t: 'm', cat: true, get: function (m) { return m.cost[k] ? m.cost[k] : null; } });
    });
    rows.push({ id: 'res', label: 'Month result', cls: 'net', t: 'm', get: function (m) { return m.v.res; } });
    if (any(function (m) { return m.led; })) {
      rows.push({ sec: 'Settlement — what happens to the month result' });
      rows.push({ sub: '1 · Where the month result goes (clause 7)' });
      rows.push({ id: 's_res', label: 'Month result', cls: 'tot', t: 'm', get: L(function (l) { return l.result; }) });
      rows.push({ id: 's_applied', label: 'to your balance with OWH', cls: 'sub', t: 'm', get: L(function (l) { return l.applied; }) });
      rows.push({ id: 's_ret', label: 'kept in the security float', cls: 'sub', t: 'm', get: L(function (l) { return l.retained; }) });
      rows.push({ id: 's_drawn', label: 'of the shortfall, covered by the float', cls: 'sub', t: 'm', get: L(function (l) { return -l.drawn; }) });
      rows.push({ id: 's_pay', label: 'payable to you', cls: 'sub', t: 'm', get: L(function (l) { return l.payable; }) });
      rows.push({ sub: '2 · Your balance with OWH (minus = owed to OWH)' });
      rows.push({ id: 'b_open', label: 'brought forward', t: 'm', get: L(function (l) { return l.openBal; }) });
      rows.push({ id: 'b_prep', label: 'your prepayments received', t: 'm', get: L(function (l) { return l.prep; }) });
      rows.push({ id: 'b_applied', label: 'from the month result', t: 'm', get: L(function (l) { return l.applied; }) });
      rows.push({ id: 'bal', label: 'Balance after the month', cls: 'net', t: 'm', get: L(function (l) { return l.balAfter; }) });
      rows.push({ sub: '3 · Security float (target ' + (ms.length && ms[ms.length - 1].led ? '$' + Math.round(ms[ms.length - 1].led.target) : '') + ')' });
      rows.push({ id: 'f_open', label: 'brought forward', t: 'm', get: L(function (l) { return l.floatOpen; }) });
      rows.push({ id: 'f_ret', label: 'retained from the month result', t: 'm', get: L(function (l) { return l.retained; }) });
      rows.push({ id: 'f_drawn', label: 'drawn to cover a shortfall', t: 'm', get: L(function (l) { return -l.drawn; }) });
      rows.push({ id: 'f_after', label: 'Float after the month', cls: 'net', t: 'm', get: L(function (l) { return l.floatAfter; }) });
      rows.push({ sub: '4 · Payment to you' });
      rows.push({ id: 'p_pay', label: 'Payable for the month', cls: 'tot', t: 'm', get: L(function (l) { return l.payable; }) });
      rows.push({ id: 'p_paid', label: 'paid to date', t: 'm', get: L(function (l) { return l.paid; }) });
      rows.push({ id: 'p_still', label: 'still to pay', t: 'm', get: L(function (l) { return l.still; }) });
    }
    return rows;
  }

  return { ORDER: ORDER, LABEL: LABEL, CATMAP: CATMAP, model: model, rowDefs: rowDefs, costKeys: costKeys, monthsOf: monthsOf, recOf: recOf, rateOf: rateOf,
           nightsOf: nightsOf, staysIn: staysIn, liveStays: liveStays, parts: parts, daysIn: daysIn, turnoversOf: turnoversOf };
})();
