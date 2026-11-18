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
    /* the month's own rate from the FX table when it has one (2026-11-18: a month with one small EGP cost recovered 55.80 from rounded
       figures, so December opened at 15,136 against November's 15,132) — else recovered from the figures as before */
    var bmR = (D.meta && D.meta.fx && D.meta.fx.byMonth) || {}, rate = (+bmR[ym] > 0 ? +bmR[ym] : rateOf(D, r)), pv = r.partnerView || {};
    var st = staysIn(D, f, ym), G = 0, N = 0, nights = 0, nightsAdr = 0, done = 0;
    /* NIGHTS AND OCCUPANCY COUNT FROM THE LAUNCH (Sarah 2026-11-16, VW1 launch 15 Nov): nights before the commencement date are not
       operating nights — the launch month's occupancy is nights ÷ the days from the launch to the month end; months before it have none.
       The money is untouched (revenue follows its own rules). */
    var L = String((D.meta && D.meta.commencement && D.meta.commencement[f]) || '').slice(0, 10), Ld = /^\d{4}-\d{2}-\d{2}$/.test(L) ? new Date(L + 'T00:00:00') : null;
    var lo0 = new Date(ym + '-01T00:00:00'), hi0 = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 1);
    var avail = !Ld || Ld <= lo0 ? daysIn(ym) : (Ld >= hi0 ? 0 : Math.round((hi0 - Ld) / 86400000));
    var opN = function (s) { if (!Ld || Ld <= lo0) return nightsOf(s, ym); if (Ld >= hi0) return 0;
      var ci = new Date(s.checkIn.slice(0, 10) + 'T00:00:00'), co = new Date(s.checkOut.slice(0, 10) + 'T00:00:00'), n = 0;
      for (var d = new Date(Math.max(ci, Ld)); d < co && d < hi0; d.setDate(d.getDate() + 1)) n++; return n; };
    var today = String((D.meta && D.meta.asOf) || new Date().toISOString().slice(0, 10)).slice(0, 10);
    st.forEach(function (s) {
      var p = parts(s, ym), n = opN(s);
      G += p.gross; N += p.net; nights += n; if (!s.review) nightsAdr += n;
      if ((s.checkOut || '').slice(0, 7) === ym && (!Ld || new Date(s.checkOut.slice(0, 10) + 'T00:00:00') > Ld) && s.checkOut.slice(0, 10) <= today) done++;   // completed = checked out by today (2026-11-17: a stay still in the house counted)
    });
    var E = r.revenue.earnings || 0, O = r.revenue.other || 0, T = r.revenue.total || 0;
    var fee = pv.managementFee || 0, ret = pv.reviewReturn || 0;                 // owner-funded review bookings, returned to her (outside revenue, no fee)
    /* SET-UP (Sarah 2026-11-09): costs paid before the launch are not the month's — they go to the balance in the settlement (r.setup) */
    var su = r.setup || null, suUsd = su ? (su.usd || 0) : 0;
    /* the review-booking return is settled through the balance, not the month result (Sarah 2026-11-16) */
    var res = (pv.netPayout != null ? pv.netPayout : r.net) + suUsd;
    var cost = {}, costNative = {};
    (r.costs || []).forEach(function (c) {
      if (c.key === 'subscription') return;                                    // OWH's own cost, never shown
      costNative[c.key] = { amt: c.amount, cur: c.currency };
      var amt = c.amount - ((su && su.byKey && su.byKey[c.key]) || 0); if (Math.abs(amt) < 0.005) amt = 0;
      costNative[c.key] = { amt: amt, cur: c.currency };
      cost[c.key] = amt ? (c.currency === 'USD' ? amt : amt / rate) : 0;
    });
    var all = monthsOf(D, f), i = all.indexOf(ym), pr = i > 0 ? recOf(D, f, all[i - 1]) : null, ppl = pr && pr.partnerLedger, pl = r.partnerLedger, led = null;
    if (pl) {
      var openBal = ppl ? ppl.balanceAfter : 0, prep = pl.prepay || 0;
      led = { result: pl.monthResult, setup: pl.setup || 0, rvBack: pl.reviewBack || 0, applied: r2(pl.balanceAfter - openBal - prep + (pl.setup || 0) - (pl.reviewBack || 0)), retained: pl.floatRetained || 0, drawn: pl.floatDrawn || 0, payable: pl.payable || 0,
              openBal: openBal, prep: prep, balAfter: pl.balanceAfter, floatOpen: r2(pl.floatAfter - (pl.floatRetained || 0) + (pl.floatDrawn || 0)),
              floatAfter: pl.floatAfter, target: pl.floatTarget, paid: pl.paidToDate || 0, still: pl.outstanding || 0 };
    }
    return { ym: ym, r: r, rate: rate, status: r.status, projected: !!(pl && pl.projected), closedAt: r.closedAt || null, pct: pv.managementFeePct || 0,
             k: { stays: done, turn: turnoversOf(D, f, ym), nights: nights, nightsAdr: nightsAdr, occ: avail ? nights / avail : 0, availDays: avail, adr: nightsAdr ? E / nightsAdr : null },
             v: { G: G, F: G - N, adj: E - N, E: E, O: O, T: T, fee: fee, share: T - fee, ret: ret, res: res, costs: (T - fee) - res },
             cost: cost, costNative: costNative, led: led, setup: su };
  }

  /* every category the owner can be charged, zero ones included; anything new in the sheet still appears */
  function costKeys(models) {
    var seen = {}, keys = [];
    models.forEach(function (m) { if (m) (m.r.costs || []).forEach(function (c) { seen[c.key] = 1; }); });
    ORDER.forEach(function (k) { if (k !== 'subscription') { keys.push(k); delete seen[k]; } });
    for (var k in seen) if (k !== 'subscription') keys.push(k);
    return keys;
  }

  /* THE ROWS. t: 'n' count · 'p' percent · 'r' an exchange rate (never converted) · 'm' money (USD, signed — minus = a deduction, or owed to OWH). cls drives the layout.
     sec rows are headings. `id` is stable: pages hang drill-downs on 'costs', 'cost:<key>' and 'bal'. */
  /* The rows kept in the BRIEF table (Statistics): the operational KPIs, the statement without its breakdowns, and the settlement's end results. */
  var BRIEF = { stays: 1, turn: 1, nights: 1, occ: 1, adr: 1, fx: 1, net: 1, fee: 1, share: 1, ret: 1, costs: 1, res: 1, bal: 1, f_after: 1, p_pay: 1, p_paid: 1, p_still: 1 };
  function rowDefs(models, opts) {
    var rows = rowDefsFull(models);
    if (!(opts && opts.brief)) return rows;
    var out = [], pendingSec = null;
    rows.forEach(function (d) {
      if (d.sec) { pendingSec = /^Settlement/.test(d.sec) ? { sec: 'Settlement' } : d; return; }
      if (d.sub || !BRIEF[d.id]) return;
      if (pendingSec) { out.push(pendingSec); pendingSec = null; }
      out.push(d);
    });
    return out;
  }
  function rowDefsFull(models) {
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
    rows.push({ id: 'fx', label: 'EGP per USD — the rate used for the month', t: 'r', get: function (m) { return m.rate; } });
    rows.push({ id: 'gross', label: 'Gross guest payments', t: 'm', get: function (m) { return m.v.G; } });
    rows.push({ id: 'fees', label: 'platform & card fees', cls: 'sub', t: 'm', get: function (m) { return -m.v.F; } });
    if (any(function (m) { return Math.abs(m.v.adj) > 0.02; }))
      rows.push({ id: 'adj', label: 'other adjustments', cls: 'sub', t: 'm', get: function (m) { return m.v.adj; } });
    rows.push({ id: 'earn', label: 'Earnings (net of fees)', t: 'm', get: function (m) { return m.v.E; } });
    rows.push({ id: 'other', label: 'other revenue', cls: 'sub', t: 'm', get: function (m) { return m.v.O; } });
    rows.push({ id: 'net', label: 'Net revenue', cls: 'tot', t: 'm', get: function (m) { return m.v.T; } });
    rows.push({ id: 'fee', label: 'management fee — ' + Math.round(pct * 100) + '% of net revenue', t: 'm', get: function (m) { return -m.v.fee; } });
    rows.push({ id: 'share', label: 'Your share — ' + Math.round((1 - pct) * 100) + '% of net revenue', cls: 'tot', t: 'm', get: function (m) { return m.v.share; } });
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
      if (any(function (m) { return m.led && m.led.setup > 0.005; }))
        rows.push({ id: 'b_setup', label: 'set-up costs paid by OWH before the launch', t: 'm', get: L(function (l) { return l.setup ? -l.setup : null; }) });
      if (any(function (m) { return m.led && m.led.rvBack > 0.005; }))
        rows.push({ id: 'b_rv', label: 'review bookings you paid — returned to you (net, no fee)', t: 'm', get: L(function (l) { return l.rvBack ? l.rvBack : null; }) });
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

  var MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monLabelP(ym) { var p = (ym || '').split('-'); return p.length === 2 ? MON3[(+p[1]) - 1] + ' ' + p[0] : ym; }

  /* ---- THE EXCEL FILE (Sarah 2026-10-13): one formatted workbook for a chosen run of months — the statement's own rows (one column per month),
     every cost entry, every booking. E = ExcelJS (loaded by the page when the button is pressed). Used by «Statement» → Download. ---- */
function xlDate(ymd){ var m=(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):(ymd||null); }
/* THE EXCEL FILE — EVERY DERIVED FIGURE IS A FORMULA (Sarah 2026-11-18: "all sheets should have formulas and not burnt numbers").
   The only typed numbers are the records themselves: each booking, each cost entry, and — on «Typed figures» — the few figures that have
   no source sheet in the file (the month's EGP rate, turnovers, other revenue and booking adjustments from the P&L, prepayments, payouts,
   the balances before the first month shown, the launch date). Every other cell traces back to them.
   Sheets: Statement by month · How the balance is worked out · Typed figures · Cost entries · Bookings · Bookings by month. */
function buildWorkbook(E,D,f,flat,CUR,ms){
  var models=ms.map(function(m){ return model(D,f,m); }).filter(Boolean), defs=rowDefs(models);
  var RED='FFCC5F5F', BLUSH='FFF9F0F0', LINE='FFECDEDE', GREY='FF6B6B6B', SOFT='FF7A6A6A', INK='FF1A1A1A', AMBER='FFFDF1D8', TYPED='FFFFF7D6', GREEN='FF3A7D4D';
  var MONEY=CUR==='USD'?'#,##0.00;[Red]-#,##0.00;"–"':'#,##0;[Red]-#,##0;"–"', USDF='#,##0.00;[Red]-#,##0.00;"–"';
  var fill=function(a){ return {type:'pattern',pattern:'solid',fgColor:{argb:a}}; };
  var hair={style:'thin',color:{argb:LINE}}, dark={style:'thin',color:{argb:INK}};
  var wb=new E.Workbook(); wb.creator='The Hub · OurWelcomeHome'; wb.created=new Date(); try{ wb.calcProperties.fullCalcOnLoad=true; }catch(e){}   // formulas compute on open
  var when=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  var range=monLabelP(ms[0])+(ms.length>1?' → '+monLabelP(ms[ms.length-1]):'');
  var colL=function(n){ var s=''; while(n>0){ var q=(n-1)%26; s=String.fromCharCode(65+q)+s; n=Math.floor((n-1)/26); } return s; };
  var Fm=function(x){ return {formula:x}; };
  var dt=function(ym,add){ var y=+ym.slice(0,4), mo=+ym.slice(5,7)+(add||0); while(mo>12){ mo-=12; y++; } return 'DATE('+y+','+mo+',1)'; };
  var lmModels=models.filter(function(m){ return m.led; }), launch=String((D.meta&&D.meta.commencement&&D.meta.commencement[f])||'').slice(0,10);
  var asOf=String((D.meta&&D.meta.asOf)||new Date().toISOString().slice(0,10)).slice(0,10);
  var all=monthsOf(D,f), first=models[0], prevM=first?all[all.indexOf(first.ym)-1]:null, pmod=prevM?model(D,f,prevM):null;
  var target=(lmModels[0]&&lmModels[0].led.target)||400, pct=(models.length?models[models.length-1].pct:0.25)||0.25;
  var head=function(row,color){ row.eachCell(function(c,n){ c.font={name:'Calibri',size:10,bold:true,color:{argb:'FFFFFFFF'}}; c.fill=fill(color); c.alignment={vertical:'middle',wrapText:true,horizontal:n===1?'left':'right'}; }); };

  // the sheets, in the order they appear
  var ws=wb.addWorksheet('Statement by month',{properties:{tabColor:{argb:RED}},views:[{state:'frozen',xSplit:1,ySplit:5,showGridLines:false}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'4:5'}});
  var w4=lmModels.length?wb.addWorksheet('How the balance is worked out',{properties:{tabColor:{argb:GREEN}},views:[{state:'frozen',xSplit:1,ySplit:4}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}}):null;
  var wi=wb.addWorksheet('Typed figures',{properties:{tabColor:{argb:'FFB8860B'}},views:[{state:'frozen',xSplit:1,ySplit:4}]});
  var w2=wb.addWorksheet('Cost entries',{properties:{tabColor:{argb:'FF8A6420'}},views:[{state:'frozen',ySplit:1}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'}});
  var w3=wb.addWorksheet('Bookings',{properties:{tabColor:{argb:'FF4A7FB5'}},views:[{state:'frozen',ySplit:1}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'}});
  var w5=wb.addWorksheet('Bookings by month',{properties:{tabColor:{argb:'FF6F9AC8'}},views:[{state:'frozen',ySplit:1}]});
  var TF="'Typed figures'", CE="'Cost entries'", BK="Bookings", BM="'Bookings by month'", HB="'How the balance is worked out'";

  /* ---------- Typed figures — the ONLY numbers typed in this file besides the bookings and cost entries ---------- */
  wi.columns=[{width:46}].concat(models.map(function(){ return {width:14}; }));
  wi.getCell(1,1).value='Typed figures — the numbers this file starts from'; wi.getCell(1,1).font={name:'Calibri',size:14,bold:true,color:{argb:'FFB8860B'}};
  wi.getCell(2,1).value='Besides each booking (Bookings) and each cost entry (Cost entries), these are the only typed numbers — they have no source sheet in this file. Every other figure is a formula.';
  wi.getCell(2,1).font={name:'Calibri',size:9,italic:true,color:{argb:GREY}};
  var ih=wi.getRow(4); ih.values=['Figure'].concat(models.map(function(m){ return monLabelP(m.ym); })); head(ih,'FFB8860B');
  var IROW={rate:5,turn:6,other:7,adj:8,prep:9,paid:10};
  var irow=function(r,label,get,fmtz){ var row=wi.getRow(r); row.getCell(1).value=label; models.forEach(function(m,i){ var v=get(m); row.getCell(i+2).value=(v==null||!isFinite(v))?null:Math.round(v*100)/100; row.getCell(i+2).numFmt=fmtz; row.getCell(i+2).fill=fill(TYPED); });
    row.getCell(1).font={name:'Calibri',size:11}; };
  irow(5,'EGP per USD — the month\'s rate',function(m){ return m.rate; },'0.00');
  irow(6,'Turnovers — cleanings that took place',function(m){ return m.k.turn; },'0');
  irow(7,'Other revenue (USD) — from the P&L',function(m){ return m.v.O; },USDF);
  irow(8,'Adjustments to booking revenue (USD) — from the P&L',function(m){ return m.v.adj; },USDF);
  irow(9,'Your prepayments received (USD)',function(m){ return m.led?m.led.prep:null; },USDF);
  irow(10,'Paid to you, to date (USD)',function(m){ return m.led?m.led.paid:null; },USDF);
  var one=function(r,label,v,fmtz){ wi.getCell(r,1).value=label; var c=wi.getCell(r,2); c.value=v; c.numFmt=fmtz; c.fill=fill(TYPED); };
  one(12,'Balance with OWH before '+monLabelP(first?first.ym:ms[0])+' (USD, minus = owed to OWH)',lmModels[0]?Math.round(lmModels[0].led.openBal*100)/100:0,USDF);
  one(13,'Security float before '+monLabelP(first?first.ym:ms[0])+' (USD)',lmModels[0]?Math.round(lmModels[0].led.floatOpen*100)/100:0,USDF);
  one(14,'Paid to you before '+monLabelP(first?first.ym:ms[0])+' (USD)',pmod&&pmod.led?Math.round(pmod.led.paid*100)/100:0,USDF);
  one(15,'Still to pay to you before '+monLabelP(first?first.ym:ms[0])+' (USD)',pmod&&pmod.led?Math.round(pmod.led.still*100)/100:0,USDF);
  one(17,'Launch (commencement) date',launch?xlDate(launch):null,'dd mmm yyyy');
  one(18,'Figures as of',xlDate(asOf),'dd mmm yyyy');
  one(19,'Management fee (share of net revenue)',pct,'0%');
  one(20,'Security float target (USD)',target,USDF);
  var IN=function(key,i){ return TF+'!$'+colL(i+2)+'$'+IROW[key]; }, RATE=function(i){ return IN('rate',i); };
  var LAUNCH=TF+'!$B$17', ASOF=TF+'!$B$18', PCT=TF+'!$B$19', TGT=TF+'!$B$20';
  var RATEAT=function(cellMonthLabel){ return 'INDEX('+TF+'!$B$5:$'+colL(models.length+1)+'$5,MATCH('+cellMonthLabel+','+TF+'!$B$4:$'+colL(models.length+1)+'$4,0))'; };

  /* ---------- Bookings — one row per booking (the records) ---------- */
  var lo=ms[0], hi=ms[ms.length-1];
  w3.columns=[{header:'Guest',width:24},{header:'Channel',width:14},{header:'Status',width:12},{header:'Booked',width:13},{header:'Check-in',width:13},{header:'Check-out',width:13},{header:'Nights',width:8},
              {header:'Gross guest payment (USD)',width:16},{header:'Platform and card fees (USD)',width:16},{header:'Net (USD)',width:12},{header:'Other revenue (USD)',width:14},{header:'Review booking',width:30},{header:'Returned to you (USD)',width:16}];
  var bs=(D.stays||[]).filter(function(s){ return s.flat===f&&s.portal!=='Blocked'&&s.checkIn&&s.checkOut&&s.checkIn.slice(0,7)<=hi&&s.checkOut.slice(0,7)>=lo; }).sort(function(a,b){ return a.checkIn<b.checkIn?-1:1; });
  var r2d=function(x){ return Math.round(x*100)/100; };
  bs.forEach(function(s,i){ var r=i+2, w=(s.allIn||0)-(s.other||0), g=(s.gross>0&&s.gross>=w)?s.gross:w;
    w3.addRow([s.guest||'',s.portal||'Direct',s.status||'',xlDate(s.booked),xlDate(s.checkIn),xlDate(s.checkOut),s.nights||null,r2d(g),Fm('H'+r+'-J'+r),r2d(w),r2d(s.other||0),
      s.review==='owh'?'OWH-funded (outside revenue)':(s.review==='owner'?'owner-funded (outside revenue)':''),s.review==='owner'?r2d(s.reviewNet||0):null]); s.__row=r; });
  head(w3.getRow(1),'FF4A7FB5'); w3.getRow(1).height=34;
  for(var r3=2;r3<=bs.length+1;r3++){ var b=w3.getRow(r3), flagged=!!b.getCell(12).value;
    [4,5,6].forEach(function(n){ b.getCell(n).numFmt='dd mmm yyyy'; b.getCell(n).alignment={horizontal:'left'}; });
    [8,9,10,11,13].forEach(function(n){ b.getCell(n).numFmt='#,##0.00;[Red]-#,##0.00'; b.getCell(n).alignment={horizontal:'right'}; });
    b.eachCell({includeEmpty:true},function(c,n){ if(n>13) return; c.font={name:'Calibri',size:11}; c.border={bottom:hair}; if(flagged) c.fill=fill(AMBER); }); }
  if(bs.length){
    w3.autoFilter={from:{row:1,column:1},to:{row:bs.length+1,column:13}};
    var tb=w3.addRow(['Total (visible rows)','','','','','',Fm('SUBTOTAL(109,G2:G'+(bs.length+1)+')'),Fm('SUBTOTAL(109,H2:H'+(bs.length+1)+')'),Fm('SUBTOTAL(109,I2:I'+(bs.length+1)+')'),Fm('SUBTOTAL(109,J2:J'+(bs.length+1)+')'),Fm('SUBTOTAL(109,K2:K'+(bs.length+1)+')'),'',Fm('SUBTOTAL(109,M2:M'+(bs.length+1)+')')]);
    tb.eachCell({includeEmpty:true},function(c,n){ if(n>13) return; c.font={name:'Calibri',size:11,bold:true}; c.fill=fill(BLUSH); c.border={top:dark}; if(n>=7&&n!==12){ c.alignment={horizontal:'right'}; c.numFmt=n===7?'#,##0':'#,##0.00;[Red]-#,##0.00'; } });
  }

  /* ---------- Bookings by month — each booking's nights and money split over the months it touches (all formulas) ---------- */
  w5.columns=[{header:'Guest',width:22},{header:'Month',width:11},{header:'Check-in',width:12},{header:'Check-out',width:12},{header:'Month starts',width:12},{header:'Next month starts',width:12},
              {header:'Nights in the booking',width:10},{header:'Nights in this month',width:10},{header:'Share of the booking',width:10},{header:'Gross in the month (USD)',width:13},{header:'Net in the month (USD)',width:13},
              {header:'Nights from the launch (occupancy)',width:12},{header:'Counts for the nightly rate (1 = yes)',width:12}];
  var live=bs.filter(function(s){ var st=String(s.status||'').toLowerCase(); return st.indexOf('cancel')<0&&st.indexOf('block')<0; }), r5=2;
  live.forEach(function(s){ models.forEach(function(m){ var ym=m.ym; if(!(s.checkIn.slice(0,7)<=ym&&s.checkOut.slice(0,7)>=ym)) return; var R=s.__row, r=r5++;
    w5.addRow([Fm(BK+'!A'+R),monLabelP(ym),Fm(BK+'!E'+R),Fm(BK+'!F'+R),Fm(dt(ym)),Fm(dt(ym,1)),Fm(BK+'!G'+R),Fm('MAX(0,MIN(D'+r+',F'+r+')-MAX(C'+r+',E'+r+'))'),Fm('IF(G'+r+'>0,H'+r+'/G'+r+',0)'),
      Fm(BK+'!H'+R+'*I'+r),Fm(BK+'!J'+R+'*I'+r),Fm('MAX(0,MIN(D'+r+',F'+r+')-MAX(C'+r+',E'+r+','+LAUNCH+'))'),Fm('IF('+BK+'!L'+R+'="",1,0)')]); }); });
  head(w5.getRow(1),'FF6F9AC8'); w5.getRow(1).height=46;
  for(var q5=2;q5<r5;q5++){ var rw5=w5.getRow(q5); [3,4,5,6].forEach(function(n){ rw5.getCell(n).numFmt='dd mmm yyyy'; }); rw5.getCell(9).numFmt='0.0%'; [10,11].forEach(function(n){ rw5.getCell(n).numFmt=USDF; });
    rw5.eachCell({includeEmpty:true},function(c){ c.font={name:'Calibri',size:10}; c.border={bottom:hair}; }); }

  /* ---------- Cost entries — one row per cost (the records); the USD column and the rate are formulas ---------- */
  var inR={}; ms.forEach(function(m){ inR[m]=1; });
  var catKey={}; Object.keys(CATMAP).forEach(function(k){ catKey[CATMAP[k]]=k; });
  w2.columns=[{header:'Month',width:11},{header:'Category',width:20},{header:'Date',width:13},{header:'Description',width:52},{header:'Amount',width:13},{header:'Currency',width:10},{header:"USD at that month's rate",width:16},
              {header:'Treated as',width:24},{header:'EGP per USD (the month)',width:12}];
  var entries=(D.tx||[]).filter(function(t){ return t.flat===f&&inR[t.ym]; }).sort(function(a,b){ return (a.ym+a.date)<(b.ym+b.date)?-1:1; });
  entries.forEach(function(t,i){ var r=i+2, k=catKey[t.cat];
    w2.addRow([monLabelP(t.ym),(k&&LABEL[k])||t.cat,xlDate(t.date),t.desc||'',t.amount==null?null:Math.round(t.amount*100)/100,t.currency||'',Fm('IF(F'+r+'="USD",E'+r+',E'+r+'/I'+r+')'),
      t.setup?'Set-up → your balance':'Operating cost',Fm(RATEAT('A'+r))]); });
  head(w2.getRow(1),'FF8A6420'); w2.getRow(1).height=30;
  for(var r2=2;r2<=entries.length+1;r2++){ var rw=w2.getRow(r2);
    rw.getCell(3).numFmt='dd mmm yyyy'; rw.getCell(3).alignment={horizontal:'left'}; rw.getCell(5).numFmt='#,##0.00'; rw.getCell(7).numFmt='#,##0.00'; rw.getCell(9).numFmt='0.00';
    rw.eachCell({includeEmpty:true},function(c){ c.font={name:'Calibri',size:11}; c.border={bottom:hair}; }); }
  if(entries.length){
    w2.autoFilter={from:{row:1,column:1},to:{row:entries.length+1,column:9}};
    var tr=w2.addRow(['Total (visible rows)','','','','','',Fm('SUBTOTAL(109,G2:G'+(entries.length+1)+')')]);
    tr.eachCell({includeEmpty:true},function(c,n){ if(n>7) return; c.font={name:'Calibri',size:11,bold:true}; c.fill=fill(BLUSH); c.border={top:dark}; });
    tr.getCell(7).numFmt='#,##0.00';
  }
  // a month's costs of one kind, in USD: the EGP added up then converted once at the month's rate (as the statement does), plus any USD
  var costUSD=function(monthCell,rateRef,treated,catCell){
    var c=CE+'!A:A,'+monthCell+','+CE+'!H:H,"'+treated+'"'+(catCell?','+CE+'!B:B,'+catCell:'');
    return '(SUMIFS('+CE+'!E:E,'+c+','+CE+'!F:F,"EGP")/'+rateRef+'+SUMIFS('+CE+'!E:E,'+c+','+CE+'!F:F,"USD"))'; };

  /* ---------- How the balance is worked out (USD) — every cell a formula ---------- */
  var HBROW={}, HB0=5;
  if(w4){
    var cols=[['Month',13],['EGP per USD',10],['Bookings\' net in the month',13],['Adjustments',11],['Other revenue',11],['Net revenue',12],['Management fee',12],['Your share',12],['Operating costs',13],['Month result',12],
              ['Set-up charged',13],['Review bookings you paid — returned',14],['Your prepayments',12],['Balance brought forward',13],['Balance before the result',13],['Result → pays down your balance',14],
              ['Result → security float',12],['Float used to cover a loss',12],['Payable to you',12],['Balance after the month',13],['Float after the month',12],['Paid to you, to date',12],['Still to pay to you',12],['Balance after — in EGP',14]];
    w4.columns=cols.map(function(c){ return {width:c[1]}; });
    w4.mergeCells(1,1,1,cols.length); w4.getCell(1,1).value=flat+' — how the balance with OWH is worked out, month by month (USD)'; w4.getCell(1,1).font={name:'Calibri',size:14,bold:true,color:{argb:GREEN}};
    w4.mergeCells(2,1,2,cols.length); var s4=w4.getCell(2,1);
    s4.value='Every cell is a formula: revenue from «Bookings by month», costs from «Cost entries» (by month and by «Treated as»), the rest from «Typed figures». Clause 7: set-up and returns move the balance; the month result first pays down what you owe OWH, then fills the security float, and only the rest is payable to you. Minus = owed to OWH.';
    s4.font={name:'Calibri',size:9,italic:true,color:{argb:GREY}}; s4.alignment={wrapText:true,vertical:'top'}; w4.getRow(2).height=40;
    var hr4=w4.getRow(4); cols.forEach(function(c,i){ hr4.getCell(i+1).value=c[0]; }); head(hr4,GREEN); hr4.height=46;
    var o=w4.getRow(HB0); o.getCell(1).value='Before '+monLabelP(lmModels[0].ym);
    o.getCell(20).value=Fm(TF+'!$B$12'); o.getCell(21).value=Fm(TF+'!$B$13'); o.getCell(22).value=Fm(TF+'!$B$14'); o.getCell(23).value=Fm(TF+'!$B$15');
    lmModels.forEach(function(m,j){ var i=models.indexOf(m), r=HB0+1+j, R=function(L){ return L+r; }, P=function(L){ return L+(r-1); }; HBROW[m.ym]=r;
      var row=w4.getRow(r), V=function(n,x){ row.getCell(n).value=Fm(x); };
      row.getCell(1).value=monLabelP(m.ym);
      V(2,RATE(i)); V(3,'SUMIFS('+BM+'!K:K,'+BM+'!B:B,'+R('A')+')'); V(4,IN('adj',i)); V(5,IN('other',i)); V(6,R('C')+'+'+R('D')+'+'+R('E'));
      V(7,R('F')+'*'+PCT); V(8,R('F')+'-'+R('G')); V(9,costUSD(R('A'),R('B'),'Operating cost')); V(10,R('H')+'-'+R('I'));
      V(11,costUSD(R('A'),R('B'),'Set-up → your balance'));
      V(12,'SUMIFS('+BK+'!M:M,'+BK+'!F:F,">="&'+dt(m.ym)+','+BK+'!F:F,"<"&'+dt(m.ym,1)+')'); V(13,IN('prep',i)); V(14,P('T')); V(15,R('N')+'+'+R('M')+'-'+R('K')+'+'+R('L'));
      var fO=P('U');
      V(16,'IF('+R('J')+'>=0,MIN('+R('J')+',MAX(0,-'+R('O')+')),-MIN(MAX(0,'+R('O')+'),-'+R('J')+')-MAX(0,-'+R('J')+'-MAX(0,'+R('O')+')-'+fO+'))');
      V(17,'IF('+R('J')+'>=0,MIN('+R('J')+'-'+R('P')+',MAX(0,'+TGT+'-'+fO+')),0)');
      V(18,'IF('+R('J')+'<0,MIN('+fO+',MAX(0,-'+R('J')+'-MAX(0,'+R('O')+'))),0)');
      V(19,'IF('+R('J')+'>=0,'+R('J')+'-'+R('P')+'-'+R('Q')+',0)');
      V(20,R('O')+'+'+R('P')); V(21,fO+'+'+R('Q')+'-'+R('R')); V(22,IN('paid',i)); V(23,P('W')+'+'+R('S')+'-('+R('V')+'-'+P('V')+')'); V(24,R('T')+'*'+R('B'));
    });
    for(var r4=HB0;r4<HB0+1+lmModels.length;r4++){ w4.getRow(r4).eachCell({includeEmpty:true},function(c,n){ if(n>24) return; c.font={name:'Calibri',size:11,bold:n===20||n===10}; c.border={bottom:hair};
      if(n===1) c.alignment={horizontal:'left'}; else { c.numFmt=n===2?'0.00':USDF; c.alignment={horizontal:'right'}; } if(n===20) c.fill=fill(BLUSH); }); }
    var nr2=w4.addRow([]); nr2=w4.addRow(['Small differences of a cent come from rounding.']); nr2.getCell(1).font={name:'Calibri',size:9,italic:true,color:{argb:GREY}};
  }

  /* ---------- Statement by month — every money row a formula (USD sources, ×the month's rate when the file is in EGP) ---------- */
  var nc=models.length+1;
  ws.columns=[{width:54}].concat(models.map(function(){ return {width:15}; }));
  ws.mergeCells(1,1,1,nc); var t1=ws.getCell(1,1); t1.value=flat+' — statement by month'; t1.font={name:'Calibri',size:16,bold:true,color:{argb:RED}}; ws.getRow(1).height=26;
  ws.mergeCells(2,1,2,nc); var t2=ws.getCell(2,1);
  t2.value=range+' · '+models.length+' month'+(models.length===1?'':'s')+' · amounts in '+CUR+(CUR==='EGP'?'':' (each month converted at its own EGP/USD rate)')+' · prepared '+when+' · every figure is a formula — see «Typed figures» for the few numbers typed in';
  t2.font={name:'Calibri',size:10,color:{argb:GREY}};
  ws.getRow(3).values=[];
  var hr=ws.getRow(4); hr.values=['Line'].concat(models.map(function(m){ return monLabelP(m.ym); })); hr.height=22;
  hr.eachCell(function(c,n){ c.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}}; c.fill=fill(RED); c.alignment={vertical:'middle',horizontal:n===1?'left':'right'}; });
  var sr=ws.getRow(5); sr.values=[''].concat(models.map(function(m){ return m.projected?'projected':(m.status==='final'?'final':'in progress'); }));
  sr.eachCell(function(c,n){ c.font={name:'Calibri',size:9,italic:true,color:{argb:GREY}}; c.fill=fill(BLUSH); c.alignment={horizontal:n===1?'left':'right'}; c.border={bottom:hair}; });
  var ROW={}, rr=6, laid=[];
  defs.forEach(function(d){ if(d.id) ROW[d.id]=rr; laid.push({d:d,r:rr}); rr++; });
  var costIds=defs.filter(function(d){ return d.cat; }).map(function(d){ return d.id; });
  laid.forEach(function(x){ var d=x.d, r=x.r, row=ws.getRow(r);
    if(d.sec){ row.getCell(1).value=d.sec.toUpperCase(); for(var k=1;k<=nc;k++){ var c=row.getCell(k); c.fill=fill(BLUSH); c.font={name:'Calibri',size:10,bold:true,color:{argb:GREY}}; c.border={top:hair,bottom:hair}; } row.height=20; return; }
    if(d.sub){ row.getCell(1).value=d.sub; row.getCell(1).font={name:'Calibri',size:10,bold:true,italic:true,color:{argb:SOFT}}; return; }
    row.getCell(1).value=d.label;
    models.forEach(function(m,i){ var C=colL(i+2), cell=row.getCell(i+2), X=CUR==='EGP'?'*'+RATE(i):'', mlab=C+'$4', at=function(id){ return C+ROW[id]; }, hb=HBROW[m.ym], H=function(L){ return HB+'!'+L+hb; };
      var y=+m.ym.slice(0,4), mo=+m.ym.slice(5,7), fx=null;
      switch(d.id){
        case 'stays': fx='COUNTIFS('+BK+'!F:F,">="&'+dt(m.ym)+','+BK+'!F:F,"<"&'+dt(m.ym,1)+','+BK+'!F:F,"<="&'+ASOF+','+BK+'!F:F,">"&'+LAUNCH+','+BK+'!C:C,"<>*ancel*")'; break;
        case 'turn': fx=IN('turn',i); break;
        case 'nights': fx='SUMIFS('+BM+'!L:L,'+BM+'!B:B,'+mlab+')'; break;
        case 'occ': fx='IFERROR('+at('nights')+'/MAX(0,'+dt(m.ym,1)+'-MAX('+dt(m.ym)+','+LAUNCH+')),0)'; break;
        case 'adr': fx='IFERROR('+at('earn')+'/SUMIFS('+BM+'!L:L,'+BM+'!B:B,'+mlab+','+BM+'!M:M,1),"")'; break;
        case 'fx': fx=RATE(i); break;
        case 'gross': fx='SUMIFS('+BM+'!J:J,'+BM+'!B:B,'+mlab+')'+X; break;
        case 'fees': fx='-(SUMIFS('+BM+'!J:J,'+BM+'!B:B,'+mlab+')-SUMIFS('+BM+'!K:K,'+BM+'!B:B,'+mlab+'))'+X; break;
        case 'adj': fx=IN('adj',i)+X; break;
        case 'earn': fx='SUMIFS('+BM+'!K:K,'+BM+'!B:B,'+mlab+')'+X+(ROW.adj?'+'+at('adj'):'+'+IN('adj',i)+X); break;
        case 'other': fx=IN('other',i)+X; break;
        case 'net': fx=at('earn')+'+'+at('other'); break;
        case 'fee': fx='-'+at('net')+'*'+PCT; break;
        case 'share': fx=at('net')+'+'+at('fee'); break;
        case 'costs': fx=costIds.length?'SUM('+C+ROW[costIds[0]]+':'+C+ROW[costIds[costIds.length-1]]+')':'0'; break;
        case 'res': fx=at('share')+'-'+at('costs'); break;
        default:
          if(d.cat) fx=costUSD(mlab,RATE(i),'Operating cost','$A'+r)+X;
          else if(hb){ var M={s_res:'J',s_applied:'P',s_ret:'Q',s_drawn:'-R',s_pay:'S',b_open:'N',b_prep:'M',b_setup:'-K',b_rv:'L',b_applied:'P',bal:'T',f_ret:'Q',f_drawn:'-R',f_after:'U',p_pay:'S',p_paid:'V',p_still:'W'}[d.id];
            if(M) fx=(M.charAt(0)==='-'?'-'+H(M.slice(1)):H(M))+X;
            else if(d.id==='f_open') fx=HB+'!U'+(hb-1)+X; }
      }
      if(fx) cell.value=Fm(fx);
      cell.numFmt=d.t==='n'?'#,##0':(d.t==='p'?'0.0%':(d.t==='r'?'0.00':MONEY)); cell.alignment={horizontal:'right'};
    });
    var bold=(d.cls==='tot'||d.cls==='net'), grey=(d.cls==='sub'||d.cls==='cat');
    row.eachCell({includeEmpty:true},function(c,n){ if(n>nc) return; c.font={name:'Calibri',size:11,bold:bold,color:{argb:grey?SOFT:INK}}; c.border={bottom:hair};
      if(n===1) c.alignment={horizontal:'left',indent:d.cat?2:(d.cls==='sub'?1:0)};
      if(d.cls==='tot') c.border={top:dark,bottom:hair}; if(d.cls==='net'){ c.fill=fill(BLUSH); c.border={top:dark,bottom:dark}; } });
  });
  var notes=['Minus on the balance means owed to OWH. Management fee and costs are shown as they reduce your share.',
             'Revenue comes from «Bookings by month» (each booking split by its nights in the month), costs from «Cost entries», the settlement from «How the balance is worked out»; the only typed numbers are on «Typed figures», «Bookings» and «Cost entries».'];
  rr++; notes.forEach(function(t){ var r=ws.getRow(rr++); r.getCell(1).value=t; ws.mergeCells(r.number,1,r.number,nc); r.getCell(1).font={name:'Calibri',size:9,italic:true,color:{argb:GREY}}; r.getCell(1).alignment={wrapText:true,vertical:'top'}; r.height=26; });
  return wb;
}

  /* ---- THE OWNER'S INVESTMENT AND RETURN (Sarah 2026-10-18) — one set-up amount the owner paid herself (entered by OWH in Close, never
     OWH's own pre-launch costs: those are repaid out of her month results under clause 5.3, so counting them here would count them twice),
     against each month's result as the statement shows it. USD, the statement's basis; an EGP set-up converts at its month's rate.
     Used by the owner's Overview and by OWH's Statistics, so the two always agree. ---- */
  function investReturn(D, f, upTo) {
    /* her investment = what she paid herself for the set-up (Settings → PARTNER_SETUP) + the set-up costs OWH paid before the launch
       (2026-11-09: "set-up counts as her investment" — repaid through her balance, so each is an outflow in the month it was paid) */
    var su = D.meta && D.meta.partnerSetup && D.meta.partnerSetup[f], fx = (D.meta && D.meta.fx) || {}, cm = (D.meta && D.meta.currentMonth) || '9999-99';
    var lim = upTo && upTo > cm ? upTo : cm;   // up to the month picked; beyond the current one it is projected (2026-11-18)
    var ms = monthsOf(D, f).filter(function (m) { return m <= lim; }), own = su && su.amount > 0, sm = own ? String(su.date).slice(0, 7) : null;
    var rate = own ? ((fx.byMonth && fx.byMonth[sm]) || fx.current || 1) : null, ownUsd = own ? (su.currency === 'USD' ? su.amount : su.amount / rate) : 0;
    var rateM = function (m) { return +(fx.byMonth && fx.byMonth[m]) || fx.current || 1; };
    var ownEgp = own ? (su.currency === 'USD' ? su.amount * rate : su.amount) : 0, owhEgp = 0;
    var owhSet = {}, owhUsd = 0; ms.forEach(function (m) { var rr = recOf(D, f, m); if (rr && rr.setup && rr.setup.usd > 0) { owhSet[m] = rr.setup.usd; owhUsd += rr.setup.usd;
      owhEgp += (rr.setup.egp || 0) + (rr.setup.usdN || 0) * rateM(m); } });
    var setupUsd = r2(ownUsd + owhUsd); if (!(setupUsd > 0)) return null;
    var setM = Object.keys(owhSet).sort(), first = [ms[0], sm, setM[0]].filter(Boolean).sort()[0], rows = [], acc = -setupUsd, back = null, flows = [], accE = -(ownEgp + owhEgp);
    var idx = function (m) { return (+m.slice(0, 4) - +first.slice(0, 4)) * 12 + (+m.slice(5, 7) - +first.slice(5, 7)); };
    if (own) flows[idx(sm)] = -ownUsd; setM.forEach(function (m) { flows[idx(m)] = (flows[idx(m)] || 0) - owhSet[m]; });
    ms.forEach(function (m) {
      var md = model(D, f, m); if (!md) return; var res = r2(md.v.res || 0);
      acc = r2(acc + res); flows[idx(m)] = (flows[idx(m)] || 0) + res;
      var resE = r2(res * rateM(m)); accE = r2(accE + resE);
      rows.push({ m: m, res: res, acc: acc, resE: resE, accE: accE, final: md.status === 'final', proj: m > cm });
      if (back === null && acc >= 0) back = m;
    });
    for (var i = 0; i < flows.length; i++) if (flows[i] == null) flows[i] = 0;
    var got = r2(acc + setupUsd), irr = null;
    if (back) {                                   // a yearly rate only once the money is back — before that a «rate» says nothing useful
      var npv = function (r) { var v = 0; for (var k = 0; k < flows.length; k++) v += flows[k] / Math.pow(1 + r, k); return v; };
      var lo = -0.99, hi = 1; if (npv(lo) * npv(hi) < 0) { for (var it = 0; it < 200; it++) { var mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; } irr = Math.pow(1 + (lo + hi) / 2, 12) - 1; }
    }
    return { amount: own ? su.amount : r2(setupUsd), currency: own ? su.currency : 'USD', date: own ? su.date : (setM[0] || '') + '-01', rate: own && su.currency !== 'USD' ? rate : null, setupUsd: r2(setupUsd),
             ownUsd: r2(ownUsd), owhSetupUsd: r2(owhUsd), E: { own: r2(ownEgp), owh: r2(owhEgp), setup: r2(ownEgp + owhEgp), got: r2(accE + ownEgp + owhEgp), acc: r2(accE) },
             rows: rows, got: got, acc: acc, recovered: setupUsd ? got / setupUsd : 0, payback: back, irr: irr };
  }
  function investCard(x, opts) {
    opts = opts || {}; var you = opts.you !== false, eg = opts.cur === 'EGP' && x && x.E, fm = function (v) { var n = Math.abs(v), s2 = n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return '<span style="white-space:nowrap">' + (v < -0.004 ? '−' : '') + (eg ? 'EGP ' : '$') + s2 + '</span>'; };
    if (eg) { x = Object.assign({}, x, { ownUsd: x.E.own, owhSetupUsd: x.E.owh, setupUsd: x.E.setup, got: x.E.got, acc: x.E.acc, currency: 'USD',   // the same card, its figures in EGP (2026-11-18)
      rows: x.rows.map(function (r) { return Object.assign({}, r, { res: r.resE, acc: r.accE }); }) }); }
    var esc2 = function (s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); };
    if (!x) return '';
    var lastRow = x.rows.length ? x.rows[x.rows.length - 1] : null, pct = Math.max(0, Math.min(1, x.recovered));
    var h = '<div class="card"><h3>' + (you ? 'Your investment and return' : 'The owner\'s investment and return') + '</h3>' +
      '<table class="d">' +
      (x.ownUsd > 0 ? '<tr><td>Set-up ' + (you ? 'you paid yourself' : 'the owner paid') + ' · ' + monLabelP(String(x.date).slice(0, 7)) + '</td><td class="r">' + fm(-x.ownUsd) + '</td></tr>' +
        (x.currency === 'EGP' ? '<tr class="subrow"><td>EGP ' + Math.round(x.amount).toLocaleString('en-US') + ' at ' + x.rate + ' EGP per USD</td><td class="r"></td></tr>' : '') : '') +
      (x.owhSetupUsd > 0 ? '<tr><td>Set-up OWH paid before the launch · charged to ' + (you ? 'your' : 'the owner\'s') + ' balance</td><td class="r">' + fm(-x.owhSetupUsd) + '</td></tr>' : '') +
      (x.ownUsd > 0 && x.owhSetupUsd > 0 ? '<tr class="tot"><td>Total set-up</td><td class="r">' + fm(-x.setupUsd) + '</td></tr>' : '') +
      '<tr><td>Month results ' + (lastRow && lastRow.proj ? 'to ' + monLabelP(lastRow.m) : 'to date') + ' · ' + x.rows.length + ' month' + (x.rows.length === 1 ? '' : 's') +
        (lastRow && lastRow.proj ? ' (' + x.rows.filter(function (r) { return r.proj; }).length + ' projected)' : (lastRow && !lastRow.final ? ' (the last one in progress)' : '')) + '</td><td class="r">' + fm(x.got) + '</td></tr>' +
      '<tr class="net"><td>Where ' + (you ? 'you stand' : 'the owner stands') + '</td><td class="r">' + fm(x.acc) + '</td></tr></table>' +
      '<div style="margin:9px 0 3px;height:9px;border-radius:5px;background:#f0e6e6;overflow:hidden"><div style="height:100%;width:' + Math.round(pct * 100) + '%;background:#3a7d4d"></div></div>' +
      '<p class="note" style="margin:0">' + (x.payback ? '<b>Paid back in ' + monLabelP(x.payback) + '.</b>' + (x.irr != null ? ' Yearly return so far: <b>' + (x.irr * 100).toFixed(1) + '%</b> (from the set-up date to the latest month).' : '')
                                                    : '<b>' + Math.round(pct * 100) + '% recovered</b> — ' + fm(-x.acc) + ' to go before the set-up is paid back. The yearly return shows once it is.') + '</p>';
    if (x.rows.length) {
      h += '<details style="margin-top:6px"><summary class="note" style="cursor:pointer">Month by month</summary><table class="d" style="font-size:11.5px"><tr><th>Month</th><th class="r">Month result</th><th class="r">Running total</th></tr>' +
        x.rows.map(function (r) { return '<tr><td>' + monLabelP(r.m) + (r.proj ? ' <span class="muted" style="color:#b8860b">· projected</span>' : (r.final ? '' : ' <span class="muted">· in progress</span>')) + '</td><td class="r">' + fm(r.res) + '</td><td class="r">' + fm(r.acc) + '</td></tr>'; }).join('') + '</table></details>';
    }
    h += '<p class="note" style="margin-top:6px">' + (you ? 'Your' : 'The owner\'s') + ' set-up — what ' + (you ? 'you' : 'the owner') + ' paid directly and what OWH paid before the launch (repaid through the balance, clause 5.3) — in ' + (eg ? 'EGP — the set-up as it was paid, each month at its own rate' : 'USD, the statement\'s basis') + '. The month results exclude the set-up, so nothing is counted twice.</p></div>';
    return h;
  }

  return { investReturn: investReturn, investCard: investCard, buildWorkbook: buildWorkbook, xlDate: xlDate, ORDER: ORDER, LABEL: LABEL, CATMAP: CATMAP, model: model, rowDefs: rowDefs, costKeys: costKeys, monthsOf: monthsOf, recOf: recOf, rateOf: rateOf,
           nightsOf: nightsOf, staysIn: staysIn, liveStays: liveStays, parts: parts, daysIn: daysIn, turnoversOf: turnoversOf };
})();
