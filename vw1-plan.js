/* vw1-plan.js — VW1's partnership-proposal plan, ONE copy shared by Today (its monthly revenue target) and Stats (the forecast).
   Month 1 = November 2026 (Sarah 2026-10-20) until a commencement date is set; then month 1 = that date's month.
   VW1_PLAN.month(ym[, startYm]) → { i, occ, nights, gross } in USD for plan month i (1…48), or null outside the plan.
   gross = nights × the plan's nightly rate × that calendar month's price index × the yearly rate growth — the plan's revenue line. */
var VW1_PLAN = (function () {
  var P = { occ: [0.40, 0.55, 0.65], occTypical: 0.78, occCap: 0.92, rate: 64, rateGrowth: 0.035, stay: 5, cleanPerStay: 650, laundryPerStay: 400,
    supplies: 1500, internet: 800, utilities: 1800, opsMgr: 1200, contingency: 0.05, costInfl: 0.15, fee: 0.25,
    demand: [0.93, 1.05, 1.06, 0.937, 0.96, 0.95, 1.06, 0.97, 1.009, 1.06, 0.95, 1.06], price: [1.044, 0.997, 1.034, 1.05, 1.06, 1.011, 0.988, 1.032, 0.97, 0.982, 0.988, 0.914] };
  var START = '2026-11';
  function diff(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
  function daysIn(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function month(ym, startYm) {
    var i = diff(startYm || START, ym) + 1; if (i < 1 || i > 48) return null;
    var cal = +ym.slice(5, 7) - 1, yr = Math.floor((i - 1) / 12), occ = i <= 3 ? P.occ[i - 1] : Math.min(P.occCap, P.occTypical * P.demand[cal]);
    var nights = daysIn(ym) * occ;
    return { i: i, occ: occ, nights: nights, gross: nights * P.rate * P.price[cal] * Math.pow(1 + P.rateGrowth, yr) };
  }
  return { P: P, START: START, month: month };
})();
