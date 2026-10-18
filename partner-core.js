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

  var MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monLabelP(ym) { var p = (ym || '').split('-'); return p.length === 2 ? MON3[(+p[1]) - 1] + ' ' + p[0] : ym; }

  /* ---- THE EXCEL FILE (Sarah 2026-10-13): one formatted workbook for a chosen run of months — the statement's own rows (one column per month),
     every cost entry, every booking. E = ExcelJS (loaded by the page when the button is pressed). Used by «Statement» → Download. ---- */
function xlDate(ymd){ var m=(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):(ymd||null); }
function buildWorkbook(E,D,f,flat,CUR,ms){
  var models=ms.map(function(m){ return model(D,f,m); }).filter(Boolean), defs=rowDefs(models);
  var RED='FFCC5F5F', BLUSH='FFF9F0F0', LINE='FFECDEDE', GREY='FF6B6B6B', SOFT='FF7A6A6A', INK='FF1A1A1A', AMBER='FFFDF1D8';
  var MONEY=CUR==='USD'?'#,##0.00;[Red]-#,##0.00;"–"':'#,##0;[Red]-#,##0;"–"';
  var fill=function(a){ return {type:'pattern',pattern:'solid',fgColor:{argb:a}}; };
  var hair={style:'thin',color:{argb:LINE}}, dark={style:'thin',color:{argb:INK}};
  var wb=new E.Workbook(); wb.creator='The Hub · OurWelcomeHome'; wb.created=new Date();
  var when=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  var range=monLabelP(ms[0])+(ms.length>1?' → '+monLabelP(ms[ms.length-1]):'');

  /* ---------- sheet 1 — the statement, month by month ---------- */
  var ws=wb.addWorksheet('Statement by month',{properties:{tabColor:{argb:RED}},views:[{state:'frozen',xSplit:1,ySplit:5,showGridLines:false}],
    pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'4:5'}});
  var nc=models.length+1;
  ws.columns=[{width:54}].concat(models.map(function(){ return {width:15}; }));
  ws.mergeCells(1,1,1,nc); var t1=ws.getCell(1,1); t1.value=flat+' — statement by month'; t1.font={name:'Calibri',size:16,bold:true,color:{argb:RED}}; ws.getRow(1).height=26;
  ws.mergeCells(2,1,2,nc); var t2=ws.getCell(2,1);
  t2.value=range+' · '+models.length+' month'+(models.length===1?'':'s')+' · amounts in '+CUR+(CUR==='EGP'?'':' (each month converted at its own EGP/USD rate, shown in the statement)')+' · prepared '+when;
  t2.font={name:'Calibri',size:10,color:{argb:GREY}};
  ws.addRow([]);
  var hr=ws.addRow(['Line'].concat(models.map(function(m){ return monLabelP(m.ym); })));
  hr.height=22; hr.eachCell(function(c,n){ c.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}}; c.fill=fill(RED); c.alignment={vertical:'middle',horizontal:n===1?'left':'right'}; });
  var sr=ws.addRow([''].concat(models.map(function(m){ return m.status==='final'?'final':'in progress'; })));
  sr.eachCell(function(c,n){ c.font={name:'Calibri',size:9,italic:true,color:{argb:GREY}}; c.fill=fill(BLUSH); c.alignment={horizontal:n===1?'left':'right'}; c.border={bottom:hair}; });

  defs.forEach(function(d){
    if(d.sec){
      var sh=ws.addRow([d.sec.toUpperCase()]);
      for(var k=1;k<=nc;k++){ var c=sh.getCell(k); c.fill=fill(BLUSH); c.font={name:'Calibri',size:10,bold:true,color:{argb:GREY}}; c.border={top:hair,bottom:hair}; }
      sh.height=20; return;
    }
    if(d.sub){ var sb=ws.addRow([d.sub]); sb.getCell(1).font={name:'Calibri',size:10,bold:true,italic:true,color:{argb:SOFT}}; sb.getCell(1).alignment={indent:0}; return; }
    var vals=models.map(function(m){ var v=d.get(m); if(v==null||!isFinite(v)) return null;
      if(d.t==='n') return Math.round(v); if(d.t==='p') return Math.round(v*1000)/1000; if(d.t==='r') return Math.round(v*100)/100; return Math.round((CUR==='USD'?v:v*m.rate)*100)/100; });
    var row=ws.addRow([d.label].concat(vals));
    var fmtz=d.t==='n'?'#,##0':(d.t==='p'?'0.0%':(d.t==='r'?'0.00':MONEY));
    var bold=(d.cls==='tot'||d.cls==='net'), grey=(d.cls==='sub'||d.cls==='cat');
    row.eachCell({includeEmpty:true},function(c,n){
      if(n>nc) return;
      c.font={name:'Calibri',size:11,bold:bold,color:{argb:grey?SOFT:INK}};
      c.border={bottom:hair};
      if(n===1){ c.alignment={horizontal:'left',indent:d.cat?2:(d.cls==='sub'?1:0)}; }
      else { c.numFmt=fmtz; c.alignment={horizontal:'right'}; }
      if(d.cls==='tot') c.border={top:dark,bottom:hair};
      if(d.cls==='net'){ c.fill=fill(BLUSH); c.border={top:dark,bottom:dark}; }
    });
  });
  ws.addRow([]);
  var notes=['Minus on the balance means owed to OWH. Management fee and costs are shown as they reduce your share.',
             'Every cost category is a line above; the entries behind each are on the “Cost entries” sheet, and every booking is on the “Bookings” sheet.'];
  notes.forEach(function(t){ var r=ws.addRow([t]); ws.mergeCells(r.number,1,r.number,nc); r.getCell(1).font={name:'Calibri',size:9,italic:true,color:{argb:GREY}}; r.getCell(1).alignment={wrapText:true,vertical:'top'}; r.height=26; });

  /* ---------- sheet 2 — every cost entry ---------- */
  var inR={}; ms.forEach(function(m){ inR[m]=1; });
  var catKey={}; Object.keys(CATMAP).forEach(function(k){ catKey[CATMAP[k]]=k; });
  var w2=wb.addWorksheet('Cost entries',{properties:{tabColor:{argb:'FF8A6420'}},views:[{state:'frozen',ySplit:1}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'}});
  w2.columns=[{header:'Month',width:11},{header:'Category',width:20},{header:'Date',width:13},{header:'Description',width:52},{header:'Amount',width:13},{header:'Currency',width:10},{header:"USD at that month's rate",width:22}];
  var entries=(D.tx||[]).filter(function(t){ return t.flat===f&&inR[t.ym]; }).sort(function(a,b){ return (a.ym+a.date)<(b.ym+b.date)?-1:1; });
  entries.forEach(function(t){
    var m=models.filter(function(x){ return x.ym===t.ym; })[0], usd=(t.currency==='USD')?t.amount:(m?t.amount/m.rate:null), k=catKey[t.cat];
    w2.addRow([monLabelP(t.ym),(k&&LABEL[k])||t.cat,xlDate(t.date),t.desc||'',t.amount==null?null:Math.round(t.amount*100)/100,t.currency||'',usd==null?null:Math.round(usd*100)/100]); });
  var h2=w2.getRow(1); h2.height=22; h2.eachCell(function(c,n){ c.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}}; c.fill=fill('FF8A6420'); c.alignment={vertical:'middle',horizontal:n>=5&&n!==6?'right':'left'}; });
  for(var r2=2;r2<=entries.length+1;r2++){ var rw=w2.getRow(r2);
    rw.getCell(3).numFmt='dd mmm yyyy'; rw.getCell(3).alignment={horizontal:'left'}; rw.getCell(5).numFmt='#,##0.00'; rw.getCell(7).numFmt='#,##0.00';
    rw.eachCell({includeEmpty:true},function(c){ c.font={name:'Calibri',size:11}; c.border={bottom:hair}; }); }
  if(entries.length){
    w2.autoFilter={from:{row:1,column:1},to:{row:entries.length+1,column:7}};
    var tr=w2.addRow(['Total (visible rows)','','','','','',{formula:'SUBTOTAL(109,G2:G'+(entries.length+1)+')'}]);
    tr.eachCell({includeEmpty:true},function(c,n){ if(n>7) return; c.font={name:'Calibri',size:11,bold:true}; c.fill=fill(BLUSH); c.border={top:dark}; });
    tr.getCell(7).numFmt='#,##0.00';
  }

  /* ---------- sheet 3 — every booking ---------- */
  var lo=ms[0], hi=ms[ms.length-1];
  var w3=wb.addWorksheet('Bookings',{properties:{tabColor:{argb:'FF4A7FB5'}},views:[{state:'frozen',ySplit:1}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'}});
  w3.columns=[{header:'Guest',width:24},{header:'Channel',width:14},{header:'Status',width:12},{header:'Booked',width:13},{header:'Check-in',width:13},{header:'Check-out',width:13},{header:'Nights',width:8},
              {header:'Gross guest payment (USD)',width:16},{header:'Platform and card fees (USD)',width:16},{header:'Net (USD)',width:12},{header:'Other revenue (USD)',width:14},{header:'Review booking',width:30},{header:'Returned to you (USD)',width:16}];
  var bs=(D.stays||[]).filter(function(s){ return s.flat===f&&s.portal!=='Blocked'&&s.checkIn&&s.checkOut&&s.checkIn.slice(0,7)<=hi&&s.checkOut.slice(0,7)>=lo; }).sort(function(a,b){ return a.checkIn<b.checkIn?-1:1; });
  var r2d=function(x){ return Math.round(x*100)/100; };
  bs.forEach(function(s){
    var w=(s.allIn||0)-(s.other||0), g=(s.gross>0&&s.gross>=w)?s.gross:w;
    w3.addRow([s.guest||'',s.portal||'Direct',s.status||'',xlDate(s.booked),xlDate(s.checkIn),xlDate(s.checkOut),s.nights||null,r2d(g),r2d(g-w),r2d(w),r2d(s.other||0),
      s.review==='owh'?'OWH-funded (outside revenue)':(s.review==='owner'?'owner-funded (outside revenue)':''),s.review==='owner'?r2d(s.reviewGross||0):null]); });
  var h3=w3.getRow(1); h3.height=34; h3.eachCell(function(c,n){ c.font={name:'Calibri',size:10,bold:true,color:{argb:'FFFFFFFF'}}; c.fill=fill('FF4A7FB5'); c.alignment={vertical:'middle',wrapText:true,horizontal:(n>=7&&n!==12)?'right':'left'}; });
  for(var r3=2;r3<=bs.length+1;r3++){ var b=w3.getRow(r3), flagged=!!b.getCell(12).value;
    [4,5,6].forEach(function(n){ b.getCell(n).numFmt='dd mmm yyyy'; b.getCell(n).alignment={horizontal:'left'}; });
    [8,9,10,11,13].forEach(function(n){ b.getCell(n).numFmt='#,##0.00;[Red]-#,##0.00'; b.getCell(n).alignment={horizontal:'right'}; });
    b.getCell(7).alignment={horizontal:'right'};
    b.eachCell({includeEmpty:true},function(c,n){ if(n>13) return; c.font={name:'Calibri',size:11}; c.border={bottom:hair}; if(flagged) c.fill=fill(AMBER); }); }
  if(bs.length){
    w3.autoFilter={from:{row:1,column:1},to:{row:bs.length+1,column:13}};
    var tb=w3.addRow(['Total (visible rows)','','','','','',{formula:'SUBTOTAL(109,G2:G'+(bs.length+1)+')'},{formula:'SUBTOTAL(109,H2:H'+(bs.length+1)+')'},{formula:'SUBTOTAL(109,I2:I'+(bs.length+1)+')'},{formula:'SUBTOTAL(109,J2:J'+(bs.length+1)+')'},{formula:'SUBTOTAL(109,K2:K'+(bs.length+1)+')'},'',{formula:'SUBTOTAL(109,M2:M'+(bs.length+1)+')'}]);
    tb.eachCell({includeEmpty:true},function(c,n){ if(n>13) return; c.font={name:'Calibri',size:11,bold:true}; c.fill=fill(BLUSH); c.border={top:dark}; if(n>=7&&n!==12){ c.alignment={horizontal:'right'}; c.numFmt=n===7?'#,##0':'#,##0.00;[Red]-#,##0.00'; } });
  }
  return wb;
}
  /* ---- THE OWNER'S INVESTMENT AND RETURN (Sarah 2026-10-18) — one set-up amount the owner paid herself (entered by OWH in Close, never
     OWH's own pre-launch costs: those are repaid out of her month results under clause 5.3, so counting them here would count them twice),
     against each month's result as the statement shows it. USD, the statement's basis; an EGP set-up converts at its month's rate.
     Used by the owner's Overview and by OWH's Statistics, so the two always agree. ---- */
  function investReturn(D, f) {
    var su = D.meta && D.meta.partnerSetup && D.meta.partnerSetup[f]; if (!su || !(su.amount > 0)) return null;
    var sm = String(su.date).slice(0, 7), fx = (D.meta && D.meta.fx) || {}, rate = (fx.byMonth && fx.byMonth[sm]) || fx.current || 1;
    var setupUsd = su.currency === 'USD' ? su.amount : su.amount / rate, cm = (D.meta && D.meta.currentMonth) || '9999-99';
    var ms = monthsOf(D, f).filter(function (m) { return m <= cm; });
    var first = ms.length && ms[0] < sm ? ms[0] : sm, rows = [], acc = -setupUsd, back = null, flows = [];
    var idx = function (m) { return (+m.slice(0, 4) - +first.slice(0, 4)) * 12 + (+m.slice(5, 7) - +first.slice(5, 7)); };
    flows[idx(sm)] = -setupUsd;
    ms.forEach(function (m) {
      var md = model(D, f, m); if (!md) return; var res = r2(md.v.res || 0);
      acc = r2(acc + res); flows[idx(m)] = (flows[idx(m)] || 0) + res;
      rows.push({ m: m, res: res, acc: acc, final: md.status === 'final' });
      if (back === null && acc >= 0) back = m;
    });
    for (var i = 0; i < flows.length; i++) if (flows[i] == null) flows[i] = 0;
    var got = r2(acc + setupUsd), irr = null;
    if (back) {                                   // a yearly rate only once the money is back — before that a «rate» says nothing useful
      var npv = function (r) { var v = 0; for (var k = 0; k < flows.length; k++) v += flows[k] / Math.pow(1 + r, k); return v; };
      var lo = -0.99, hi = 1; if (npv(lo) * npv(hi) < 0) { for (var it = 0; it < 200; it++) { var mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; } irr = Math.pow(1 + (lo + hi) / 2, 12) - 1; }
    }
    return { amount: su.amount, currency: su.currency, date: su.date, rate: su.currency === 'USD' ? null : rate, setupUsd: r2(setupUsd),
             rows: rows, got: got, acc: acc, recovered: setupUsd ? got / setupUsd : 0, payback: back, irr: irr };
  }
  function investCard(x, opts) {
    opts = opts || {}; var you = opts.you !== false, fm = function (v) { var n = Math.abs(v), s2 = n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return '<span style="white-space:nowrap">' + (v < -0.004 ? '−' : '') + '$' + s2 + '</span>'; };
    var esc2 = function (s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); };
    if (!x) return '';
    var lastRow = x.rows.length ? x.rows[x.rows.length - 1] : null, pct = Math.max(0, Math.min(1, x.recovered));
    var h = '<div class="card"><h3>' + (you ? 'Your investment and return' : 'The owner\'s investment and return') + '</h3>' +
      '<table class="d"><tr><td>Set-up ' + (you ? 'you paid' : 'the owner paid') + ' · ' + monLabelP(String(x.date).slice(0, 7)) + '</td><td class="r">' + fm(-x.setupUsd) + '</td></tr>' +
      (x.currency === 'EGP' ? '<tr class="subrow"><td>EGP ' + Math.round(x.amount).toLocaleString('en-US') + ' at ' + x.rate + ' EGP per USD</td><td class="r"></td></tr>' : '') +
      '<tr><td>Month results to date · ' + x.rows.length + ' month' + (x.rows.length === 1 ? '' : 's') + (lastRow && !lastRow.final ? ' (the last one in progress)' : '') + '</td><td class="r">' + fm(x.got) + '</td></tr>' +
      '<tr class="net"><td>Where ' + (you ? 'you stand' : 'the owner stands') + '</td><td class="r">' + fm(x.acc) + '</td></tr></table>' +
      '<div style="margin:9px 0 3px;height:9px;border-radius:5px;background:#f0e6e6;overflow:hidden"><div style="height:100%;width:' + Math.round(pct * 100) + '%;background:#3a7d4d"></div></div>' +
      '<p class="note" style="margin:0">' + (x.payback ? '<b>Paid back in ' + monLabelP(x.payback) + '.</b>' + (x.irr != null ? ' Yearly return so far: <b>' + (x.irr * 100).toFixed(1) + '%</b> (from the set-up date to the latest month).' : '')
                                                    : '<b>' + Math.round(pct * 100) + '% recovered</b> — ' + fm(-x.acc) + ' to go before the set-up is paid back. The yearly return shows once it is.') + '</p>';
    if (x.rows.length) {
      h += '<details style="margin-top:6px"><summary class="note" style="cursor:pointer">Month by month</summary><table class="d" style="font-size:11.5px"><tr><th>Month</th><th class="r">Month result</th><th class="r">Running total</th></tr>' +
        x.rows.map(function (r) { return '<tr><td>' + monLabelP(r.m) + (r.final ? '' : ' <span class="muted">· in progress</span>') + '</td><td class="r">' + fm(r.res) + '</td><td class="r">' + fm(r.acc) + '</td></tr>'; }).join('') + '</table></details>';
    }
    h += '<p class="note" style="margin-top:6px">' + (you ? 'Your' : 'The owner\'s') + ' own set-up spend only, in USD (the statement\'s basis). Costs OWH paid before the start are repaid from the month results (clause 5.3), so they are already counted there.</p></div>';
    return h;
  }

  return { investReturn: investReturn, investCard: investCard, buildWorkbook: buildWorkbook, xlDate: xlDate, ORDER: ORDER, LABEL: LABEL, CATMAP: CATMAP, model: model, rowDefs: rowDefs, costKeys: costKeys, monthsOf: monthsOf, recOf: recOf, rateOf: rateOf,
           nightsOf: nightsOf, staysIn: staysIn, liveStays: liveStays, parts: parts, daysIn: daysIn, turnoversOf: turnoversOf };
})();
