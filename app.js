// IT 요청 분류기 — AI(Gemini)가 가르고, 실패하면 단어 규칙으로 가른다
// criteria.json · keywords.json · data/answer.json 을 읽어서 그린다. 정답이나 낱말을 여기에 적지 않는다.
// AI 는 서버 함수(api/classify)로만 부른다. 열쇠는 서버의 환경 변수에만 있다. 보내는 것은 가린 문장뿐이다.
(function () {
  "use strict";

  var rules = null;
  var BATCH = 10;           // 채점 때 한 번에 보내는 문장 수
  var lastAiResult = null;  // 내려받기용

  // 항상 객체를 돌려준다. 실패하면 results: null 과 reason.
  function callAI(texts) {
    return fetch("api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: texts })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!d || typeof d !== "object") throw new Error();
        return d;
      }).catch(function () {
        return { results: null, reason: "AI 서버 응답을 읽지 못했어요(HTTP " + r.status + ")" };
      });
    }, function () {
      return { results: null, reason: "AI 서버에 연결하지 못했어요" };
    });
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function getJSON(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " (HTTP " + r.status + ")");
      return r.json();
    });
  }
  function pct(a, n) { return n ? Math.round((a / n) * 1000) / 10 : 0; }

  // ── 탭 ────────────────────────────────────────────────────────────────────────
  var tabs = [["tab-classify", "panel-classify"], ["tab-score", "panel-score"]];
  tabs.forEach(function (t) {
    $(t[0]).addEventListener("click", function () {
      tabs.forEach(function (u) {
        var on = u[0] === t[0];
        $(u[0]).setAttribute("aria-selected", on ? "true" : "false");
        $(u[1]).hidden = !on;
      });
    });
  });

  // ── 분류 ──────────────────────────────────────────────────────────────────────
  $("classify-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var text = $("text").value.trim();
    if (!text || !rules) return;
    var masked = Mask.mask(text).text;
    var btn = $("classify-btn");
    btn.disabled = true;
    btn.textContent = "가르는 중…";

    callAI([masked]).then(function (d) {
      var ai = Array.isArray(d.results) ? d.results[0] : null;
      var r, source, sourceCls = "";
      if (ai) {
        r = ai;
        source = "AI · " + d.model;
      } else {
        r = rules.classify(masked);
        source = "AI 없이 규칙으로 갈랐습니다" + (d.reason ? " (" + d.reason + ")" : "");
        sourceCls = "bad";
      }
      $("r-masked").textContent = masked;
      $("r-cat").textContent = r.category;
      $("r-urg").textContent = r.urgency;
      $("r-urg").className = "big u" + rules.urgencyIndex(r.urgency);
      $("r-reason").textContent = r.reason;
      $("r-source").textContent = source;
      $("r-source").className = sourceCls;
      $("result").hidden = false;
      btn.disabled = false;
      btn.textContent = "분류";
    });
  });

  // ── 채점 ──────────────────────────────────────────────────────────────────────
  $("score-btn").addEventListener("click", function () {
    var btn = $("score-btn"), msg = $("score-msg");
    btn.disabled = true;
    msg.className = "msg";
    msg.textContent = "채점 중…";

    getJSON("data/answer.json").then(function (items) {
      var n = items.length, cat = 0, urg = 0, both = 0, sec = 0, wrong = [];
      var first = rules.order[0]; // 순서 맨 앞 칸. CLAUDE.md: 이 칸(보안)을 놓치는 것이 가장 나쁜 실수
      items.forEach(function (x) {
        var masked = Mask.mask(x.text).text;
        var p = rules.classify(masked);
        var okC = p.category === x.category, okU = p.urgency === x.urgency;
        if (okC) cat++;
        if (okU) urg++;
        if (okC && okU) both++;
        if (x.category === first && p.category !== first) sec++;
        if (!okC || !okU) wrong.push({ x: x, masked: masked, p: p, okC: okC, okU: okU });
      });

      $("s-cat").textContent = cat + "/" + n + " (" + pct(cat, n) + "%)";
      $("s-urg").textContent = urg + "/" + n + " (" + pct(urg, n) + "%)";
      $("s-both").textContent = both + "/" + n;
      $("s-sec").textContent = sec + "개";
      $("s-sec").className = sec ? "bad" : "";
      var d = new Date(), z = function (v) { return (v < 10 ? "0" : "") + v; };
      $("s-cond").textContent = "잰 조건: 단어 규칙만 · 채점용 " + n + "문장(data/answer.json) · 낱말 keywords.json · 기준 criteria.json 버전 " +
        rules.version + " · " + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());

      $("wrong-title").textContent = "틀린 문장 " + wrong.length + "개 (정답 → 판정)";
      var list = $("wrong-list");
      list.textContent = "";
      wrong.forEach(function (w) {
        var li = el("li");
        var head = el("div", "w-head");
        head.appendChild(el("b", "", w.x.id));
        head.appendChild(el("span", w.okC ? "" : "bad", w.x.category + " → " + w.p.category));
        head.appendChild(el("span", w.okU ? "" : "bad", w.x.urgency + " → " + w.p.urgency));
        li.appendChild(head);
        li.appendChild(el("p", "w-text", w.masked));
        li.appendChild(el("p", "hint", w.p.reason));
        list.appendChild(li);
      });

      $("score").hidden = false;
      msg.textContent = "";
      btn.disabled = false;
    }).catch(function (e) {
      msg.className = "msg error";
      msg.textContent = "채점용 문장을 불러오지 못했어요: " + e.message;
      btn.disabled = false;
    });
  });

  // ── AI로 채점 ─────────────────────────────────────────────────────────────────
  // 30개를 10개씩 보낸다. 답을 못 받은 문장은 오답으로 세고 건수를 따로 적는다.
  function tally(rows, key) {
    var first = rules.order[0]; // CLAUDE.md: 이 칸(보안)을 놓치는 것이 가장 나쁜 실수
    var s = { n: rows.length, cat: 0, urg: 0, both: 0, sec: 0, none: 0 };
    rows.forEach(function (r) {
      var p = r[key];
      if (!p) s.none++;
      var okC = !!p && p.category === r.answer.category, okU = !!p && p.urgency === r.answer.urgency;
      if (okC) s.cat++;
      if (okU) s.urg++;
      if (okC && okU) s.both++;
      if (r.answer.category === first && !(p && p.category === first)) s.sec++;
    });
    return s;
  }

  function nowText() {
    var d = new Date(), z = function (v) { return (v < 10 ? "0" : "") + v; };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
  }

  function renderCompare(rule, ai, model) {
    $("ai-col").textContent = "AI" + (model ? " · " + model : "");
    var body = $("compare-body");
    body.textContent = "";
    var n = rule.n;
    [
      ["칸 정확도", rule.cat + "/" + n + " (" + pct(rule.cat, n) + "%)", ai.cat + "/" + n + " (" + pct(ai.cat, n) + "%)"],
      ["긴급도 정확도", rule.urg + "/" + n + " (" + pct(rule.urg, n) + "%)", ai.urg + "/" + n + " (" + pct(ai.urg, n) + "%)"],
      ["둘 다 맞음", rule.both + "/" + n, ai.both + "/" + n],
      ["보안 놓침", rule.sec + "개", ai.sec + "개"],
      ["답 못 받음", "—", ai.none + "개"]
    ].forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", "", row[0]));
      tr.appendChild(el("td", "", row[1]));
      tr.appendChild(el("td", "", row[2]));
      body.appendChild(tr);
    });
  }

  function renderAiWrong(rows) {
    var wrong = rows.filter(function (r) {
      return !r.ai || r.ai.category !== r.answer.category || r.ai.urgency !== r.answer.urgency;
    });
    $("ai-wrong-title").textContent = "AI가 틀리거나 답 못 받은 문장 " + wrong.length + "개 (정답 → AI)";
    var list = $("ai-wrong-list");
    list.textContent = "";
    wrong.forEach(function (r) {
      var li = el("li"), head = el("div", "w-head");
      head.appendChild(el("b", "", r.id));
      if (!r.ai) {
        head.appendChild(el("span", "bad", r.answer.category + " · " + r.answer.urgency + " → 답 못 받음"));
      } else {
        head.appendChild(el("span", r.ai.category === r.answer.category ? "" : "bad", r.answer.category + " → " + r.ai.category));
        head.appendChild(el("span", r.ai.urgency === r.answer.urgency ? "" : "bad", r.answer.urgency + " → " + r.ai.urgency));
      }
      li.appendChild(head);
      li.appendChild(el("p", "w-text", r.masked));
      if (r.ai && r.ai.reason) li.appendChild(el("p", "hint", "AI: " + r.ai.reason));
      li.appendChild(el("p", "hint", "규칙: " + r.rule.category + " · " + r.rule.urgency));
      list.appendChild(li);
    });
  }

  $("ai-score-btn").addEventListener("click", function () {
    var btn = $("ai-score-btn"), rbtn = $("score-btn"), msg = $("score-msg");
    btn.disabled = true;
    rbtn.disabled = true;
    msg.className = "msg";
    msg.textContent = "채점용 문장을 불러오는 중…";
    $("ai-score").hidden = true;
    var started = nowText();

    getJSON("data/answer.json").then(function (items) {
      var rows = items.map(function (x) {
        var masked = Mask.mask(x.text).text;
        var rule = rules.classify(masked);
        return {
          id: x.id, masked: masked,
          answer: { category: x.category, urgency: x.urgency },
          rule: { category: rule.category, urgency: rule.urgency, reason: rule.reason },
          ai: null
        };
      });
      var n = rows.length, sent = 0, model = "", failures = [];
      msg.textContent = "AI 채점 중… 0/" + n;

      function next() {
        if (sent >= n) return Promise.resolve();
        var batch = rows.slice(sent, sent + BATCH);
        var label = (sent + 1) + "–" + (sent + batch.length);
        return callAI(batch.map(function (r) { return r.masked; })).then(function (d) {
          if (d.model) model = d.model;
          if (Array.isArray(d.results)) {
            batch.forEach(function (r, k) { r.ai = d.results[k] || null; });
          } else {
            failures.push(label + "번째: " + (d.reason || "알 수 없는 오류"));
          }
          sent += batch.length;
          msg.textContent = "AI 채점 중… " + sent + "/" + n;
          return next();
        });
      }

      return next().then(function () {
        var ruleStats = tally(rows, "rule"), aiStats = tally(rows, "ai");
        var cond = "잰 조건: 채점용 " + n + "문장(data/answer.json) · 모델 " + (model || "알 수 없음") +
          " · " + BATCH + "개씩 · 기준 criteria.json 버전 " + rules.version + " · " + started;
        renderCompare(ruleStats, aiStats, model);
        renderAiWrong(rows);
        $("ai-cond").textContent = cond;
        $("ai-fail").textContent = failures.length ? "답을 못 받은 묶음: " + failures.join(" / ") : "";
        lastAiResult = {
          measured_at: started,
          model: model || null,
          criteria_version: rules.version,
          answer_file: "data/answer.json",
          batch_size: BATCH,
          summary: { rule: ruleStats, ai: aiStats },
          failures: failures,
          items: rows
        };
        $("ai-score").hidden = false;
        msg.textContent = "AI 채점을 마쳤어요.";
      });
    }).catch(function (e) {
      msg.className = "msg error";
      msg.textContent = "채점하지 못했어요: " + e.message;
    }).then(function () {
      btn.disabled = false;
      rbtn.disabled = false;
    });
  });

  $("download-btn").addEventListener("click", function () {
    if (!lastAiResult) return;
    var blob = new Blob([JSON.stringify(lastAiResult, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = "ai_채점결과.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // ── 시작: 기준과 낱말을 읽는다 ────────────────────────────────────────────────
  Promise.all([getJSON("criteria.json"), getJSON("keywords.json")]).then(function (res) {
    var criteria = res[0], keywords = res[1];
    var base = Rules.make(criteria, keywords);
    var names = criteria.urgency.map(function (u) { return u.name; });
    rules = {
      order: criteria.tie_break.order,
      version: criteria.version,
      urgencyIndex: function (name) { return names.indexOf(name); },
      classify: function (t) {
        var r = base.classify(t);
        r.urgencyIndex = names.indexOf(r.urgency);
        return r;
      }
    };
    $("load-msg").textContent = criteria.owner + " (버전 " + criteria.version + ")";
    $("load-msg").className = "msg hint";
    $("classify-btn").disabled = false;
    $("score-btn").disabled = false;
    $("ai-score-btn").disabled = false;
  }).catch(function (e) {
    $("load-msg").className = "msg error";
    $("load-msg").textContent = "기준 파일을 읽지 못했어요: " + e.message +
      " — 파일을 두 번 눌러 열면 읽지 못해요. 로컬 서버나 Vercel 주소로 열어 주세요.";
  });
})();
