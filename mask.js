// 개인정보 가림 — 이름 · 전화번호 · 사번을 [이름] [전화번호] [사번] 으로 바꾼다.
// 분류는 가린 문장으로 한다. 브라우저(window.Mask)와 node(require) 양쪽에서 쓸 수 있다.
(function (root) {
  "use strict";

  var TITLES = "사원|대리|과장|차장|부장|팀장|주임|선임|책임|수석|인턴|님";

  function mask(text) {
    var t = String(text || "");
    var found = [];

    // 전화번호: 010-1234-5678, 010 1234 5678, 01012345678, 02-123-4567
    t = t.replace(/(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, function () {
      found.push("전화번호");
      return "[전화번호]";
    });

    // 사번: "사번 12345", "사번은 00000", "사번: 1234"
    t = t.replace(/사번\s*(은|는|이|:)?\s*\d{3,10}/g, function () {
      found.push("사번");
      return "사번 [사번]";
    });

    // 이름 + 직함: "홍길동 사원", "김아무개 대리"
    var titleRe = new RegExp("([가-힣]{2,5})(\\s?)(" + TITLES + ")(?=[\\s(),.!?이예입에께]|$)", "g");
    t = t.replace(titleRe, function (m, name, sp, title) {
      found.push("이름");
      return "[이름]" + sp + title;
    });

    // "홍길순입니다." 처럼 자기소개 — 사번 · 전화번호가 함께 있을 때만,
    // 그리고 문장 맨 앞이나 쉼표 · 마침표 바로 뒤일 때만 가린다(오탐 줄이기).
    if (found.length > 0) {
      t = t.replace(/(^|[,.]\s*)([가-힣]{2,5})(입니다|이에요|예요)(?=[\s.,!]|$)/g, function (m, pre, name, end) {
        found.push("이름");
        return pre + "[이름]" + end;
      });
    }

    return { text: t, masked: found };
  }

  var api = { mask: mask };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Mask = api;
})(this);
