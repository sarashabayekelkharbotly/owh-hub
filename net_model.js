/* ============================================================
 * net_model.js — THE internet model, one copy for every screen (Sarah 2026-09-02: "so that we
 * don't have several calculations, can't just today mirror from the internet screen").
 * Today's Needs-you used its own crude calendar-day burn rate and disagreed with the internet
 * screen (12 Sep vs 14 Sep for the same flat). This file now owns the occupancy-aware model
 * (§5.4, agreed 2026-08-02) and both internet.html and today.html load it after auth.js:
 *   <script src="net_model.js"></script>
 * It reads the page's globals D (the payload) and STAYS (mergeStays output — both pages build it
 * the same way) at CALL time, and exposes: flatsWithNet, curBundle, lastReading, curStay,
 * netHistory, netCalc. The page must NOT define its own copies of these — that is the whole point.
 * KEEP IN STEP with netWatchCandidates_ in Code.gs — the same model drives the Telegram alert
 * (the server cannot load this file).
 * ============================================================ */
(function(){
  var DAYMS=86400000;
  function pdt(s){ s=(s||'').toString().trim(); if(!s)return null; s=s.replace(' ','T'); if(s.length<=10)s+='T00:00'; var d=new Date(s); return isNaN(d)?null:d; }
  function day(s){ return new Date(String(s).slice(0,10)+'T00:00:00'); }
  function ymd(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function nowLocal(){ return new Date(D.meta.asOf+'T'+new Date().toTimeString().slice(0,5)+':00'); }

  function flatsWithNet(){ return D.meta.flatsOrder; }   // internet covers all flats incl 17B
  function curBundle(flat){
    var b=null; (D.internet.bundles||[]).forEach(function(x){ if(x.flat!==flat)return; var d=pdt(x.cycleStart); if(!d)return;
      if(!b||d>pdt(b.cycleStart))b=x; }); return b;
  }
  function lastReading(flat, sinceDt){
    var r=null; (D.internet.readings||[]).forEach(function(x){ if(x.flat!==flat)return; var d=pdt(x.at); if(!d)return;
      if(sinceDt&&d<sinceDt)return; if(!r||d>pdt(r.at))r=x; }); return r;
  }
  function curStay(flat, dt){
    var cur=null; STAYS.forEach(function(s){ if(s.flat!==flat)return;
      if(day(s.checkIn)<=dt&&dt<day(s.checkOut))cur=s; }); return cur;
  }

  /* §5.4 — the occupancy-aware pace model (agreed with Sarah 2026-08-02).
     Rate priority: current guest's own measured GB/occupied-day (across renewals) → flat history →
     portfolio → quota/30, each labelled. Vacant days burn at the flat's measured idle trickle.
     Projection walks the BOOKED calendar day by day. */
  var __nh=null;
  function netHistory(){
    if(__nh) return __nh;
    var H={guest:{},flat:{},vac:{},port:{gb:0,days:0}};
    flatsWithNet().forEach(function(f){
      var bs=(D.internet.bundles||[]).filter(function(x){return x.flat===f;})
        .map(function(x){return {b:x,cs:pdt(x.cycleStart)};}).filter(function(x){return x.cs;})
        .sort(function(a,z){return a.cs-z.cs;});
      bs.forEach(function(x,bi){
        var ceN=bs[bi+1]?bs[bi+1].cs:null;
        var reads=(D.internet.readings||[]).filter(function(r){ var t=pdt(r.at);
            return r.flat===f&&t&&t>=x.cs&&(!ceN||t<ceN); })
          .map(function(r){return {t:pdt(r.at),rem:r.remaining};}).sort(function(a,z){return a.t-z.t;});
        var pts=[{t:x.cs,rem:x.b.quota}].concat(reads);
        /* THE HOUSE CLOCK (Sarah 2026-08-07): a stay occupies 15:00 check-in day → 12:00 check-out
           day; each interval is sliced at those boundaries and every slice charged to whoever
           really held the flat; the changeover gap burns as vacant idle. */
        var occs=STAYS.filter(function(st){return st.flat===f;}).map(function(st){
          return {st:st, s0:day(st.checkIn).getTime()+15*3600000, s1:day(st.checkOut).getTime()+12*3600000};
        }).filter(function(o){return o.s1>o.s0;});
        function ownerAt(T){ for(var oi=0;oi<occs.length;oi++){ if(T>=occs[oi].s0&&T<occs[oi].s1) return occs[oi].st; } return null; }
        for(var i=0;i<pts.length-1;i++){
          var a=pts[i],z=pts[i+1],delta=Math.max(0,a.rem-z.rem),tot=z.t-a.t; if(tot<=0)continue;
          var cuts=[a.t.getTime(),z.t.getTime()];
          occs.forEach(function(o){ if(o.s0>a.t.getTime()&&o.s0<z.t.getTime())cuts.push(o.s0);
                                    if(o.s1>a.t.getTime()&&o.s1<z.t.getTime())cuts.push(o.s1); });
          cuts.sort(function(p,q){return p-q;});
          for(var c2=0;c2<cuts.length-1;c2++){
            var s1=cuts[c2], s2=cuts[c2+1]; if(s2<=s1)continue;
            var gb=delta*(s2-s1)/tot, df=(s2-s1)/DAYMS;
            var st=ownerAt((s1+s2)/2);
            if(st){ var gk=f+'|'+st.id;
              (H.guest[gk]=H.guest[gk]||{gb:0,days:0}); H.guest[gk].gb+=gb; H.guest[gk].days+=df;
              (H.flat[f]=H.flat[f]||{gb:0,days:0});     H.flat[f].gb+=gb;   H.flat[f].days+=df;
              H.port.gb+=gb; H.port.days+=df; }
            else { (H.vac[f]=H.vac[f]||{gb:0,days:0}); H.vac[f].gb+=gb; H.vac[f].days+=df; }
          }
        }
      });
    });
    return (__nh=H);
  }
  function netCalc(flat){
    var b=curBundle(flat); if(!b) return {state:'nobundle'};
    var cs=pdt(b.cycleStart); var r=lastReading(flat, cs);
    var H=netHistory(), asOfD=day(D.meta.asOf);
    var st=curStay(flat, asOfD), gk=st?flat+'|'+st.id:null;
    var rate, src;
    if(gk&&H.guest[gk]&&H.guest[gk].days>=0.5){ rate=H.guest[gk].gb/H.guest[gk].days; src='guest'; }
    else if(H.flat[flat]&&H.flat[flat].days>=3){ rate=H.flat[flat].gb/H.flat[flat].days; src='history'; }
    else if(H.port.days>=3){ rate=H.port.gb/H.port.days; src='portfolio'; }
    else { rate=b.quota/30; src='fair'; }
    var idle=(H.vac[flat]&&H.vac[flat].days>=1)?Math.min(4,H.vac[flat].gb/H.vac[flat].days):1.5;
    if(!r) return {state:'waiting', bundle:b, rate:rate, rateSource:src, guest:st};
    var at=pdt(r.at)||nowLocal(), consumed=Math.max(0,b.quota-r.remaining);
    // walk the booked calendar from the reading: occupied days at the rate, vacant at the idle trickle
    var rem=r.remaining, depl=null, walk0=day(ymd(at));
    for(var k=0;k<60&&rem>0;k++){
      var dk=new Date(walk0.getTime()+k*DAYMS);
      rem -= curStay(flat,dk) ? rate : idle;
      if(rem<=0){ depl=dk; break; }
    }
    var ce=new Date(cs.getTime()+30*DAYMS), fairDaily=b.quota/30;
    /* UNUSED GB DIES AT RENEWAL (Sarah 2026-08-18): the headline is DAYS TO RENEWAL, and a
       depletion date is only reported when it lands before that renewal, because only then does
       it cost you a bundle. */
    var dRenew=Math.max(0,Math.round((day(ymd(ce))-asOfD)/DAYMS));
    var dies = depl && depl < ce;                                   // will actually run out on this cycle
    var dDeplete = dies ? Math.round((depl-asOfD)/DAYMS) : null;
    var spent = dies && dDeplete<=0;              // reading old or bundle already empty — wants a fresh reading
    var ageD=Math.max(0,Math.round((asOfD-day(ymd(at)))/DAYMS));    // how old the reading behind all this is
    return { state:'live', bundle:b, reading:r, at:at, cycleStart:cs, cycleEnd:ce, cycleDays:30,
             consumed:consumed, remaining:r.remaining, burn:rate, rate:rate, rateSource:src, idle:idle, guest:st,
             fairDaily:fairDaily, pace: fairDaily>0?rate/fairDaily:0,
             depletion:depl, dies:dies, spent:spent, daysToRenew:dRenew, daysToDeplete:Math.max(0,dDeplete||0),
             readingAge:ageD, occupied:!!st, lastsCycle: !dies,
             pct: b.quota>0?Math.max(0,Math.min(1,r.remaining/b.quota)):0 };
  }

  window.flatsWithNet=flatsWithNet; window.curBundle=curBundle; window.lastReading=lastReading;
  window.curStay=curStay; window.netHistory=netHistory; window.netCalc=netCalc;
  window.netModelResetCache=function(){ __nh=null; };
})();
