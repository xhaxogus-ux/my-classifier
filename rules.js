// 단어 규칙 분류기 — AI 없이 도는 기준선.
// 칸 · 순서 · 긴급도 이름은 criteria.json 에서, 낱말은 keywords.json 에서 읽는다. 이 파일에는 낱말을 적지 않는다.
// 브라우저(window.Rules)와 node(require) 양쪽에서 쓸 수 있다.
(function (root) {
  "use strict";

  function squash(text) { return String(text || "").replace(/\s+/g, ""); }
  function hits(s, words) { return (words || []).filter(function (w) { return s.indexOf(w) !== -1; }); }
  function quote(w) { return "'" + w + "'"; }

  // criteria: criteria.json, keywords: keywords.json
  function make(criteria, keywords) {
    var order = criteria.tie_break.order;            // 두 칸에 걸치면 앞 칸
    var fallback = order[order.length - 1];          // 낱말이 없으면 마지막 칸
    var U = criteria.urgency.map(function (u) { return u.name; });
    var HIGH = U[0], MID = U[1], LOW = U[2];
    var uk = keywords.urgency;

    function classify(text) {
      var s = squash(text);

      // 칸: 순서대로 보며 처음 낱말이 걸린 칸
      var category = fallback, catHit = [];
      for (var i = 0; i < order.length; i++) {
        var kw = keywords.categories[order[i]] || {};
        var h = hits(s, kw.words);
        var unless = kw.unless || {};
        h = h.filter(function (w) { return !(unless[w] && hits(s, unless[w]).length); });
        if (h.length) { category = order[i]; catHit = h; break; }
      }

      // 긴급도
      var high = hits(s, uk[HIGH].words), works = hits(s, uk[MID].works);
      var trouble = hits(s, uk[MID].trouble), ask = hits(s, uk[LOW].words);
      var urgency, why;
      if (high.length && !works.length) {
        urgency = HIGH; why = quote(high[0]);
      } else if (category === fallback) {
        urgency = LOW; why = "문의 · 재촉";
      } else if (works.length) {
        urgency = trouble.length ? MID : LOW; why = quote(works[0]);
      } else if (ask.length && !trouble.length) {
        urgency = LOW; why = quote(ask[0]);
      } else {
        urgency = MID; why = trouble.length ? quote(trouble[0]) : "기본값";
      }

      var reason = (catHit.length ? quote(catHit[0]) + " → " + category : "걸린 낱말 없음 → " + category) +
        ", " + why + " → " + urgency;
      return { category: category, urgency: urgency, reason: reason };
    }

    return { classify: classify };
  }

  var api = { make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Rules = api;
})(this);
