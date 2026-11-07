"""사내 IT 요청 분류 — Gemini 호출 서버 함수 (Vercel Python)

POST /api/classify  ← {"texts": ["가린 문장", ...]}
                    → {"results": [{"category", "urgency", "reason"} 또는 null, ...] 또는 null,
                       "model": 쓴 모델, "reason": 실패 이유}
GET  /api/classify  → {"model": 쓸 모델}

열쇠는 환경 변수 GEMINI_API_KEY 에서만 읽는다. 코드와 폴더에는 두지 않는다.
모델은 환경 변수 GEMINI_MODEL, 비어 있으면 gemini-3.5-flash-lite.
기준은 criteria.json 에서 읽는다. 문장은 브라우저에서 이름 · 전화번호 · 사번을 가린 뒤 온다.
파이썬 표준 라이브러리만 쓴다. 넣은 문장은 저장하지 않는다(로그도 남기지 않는다).
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import re
import socket
import urllib.error
import urllib.request

DEFAULT_MODEL = "gemini-3.5-flash-lite"
MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$")
WAIT_SECONDS = 60       # Gemini 답을 기다리는 시간
MAX_TEXTS = 20          # 한 번에 받는 문장 수 상한 (화면은 10개씩 보낸다)
MAX_CHARS = 500         # 문장 하나의 길이 상한
MAX_BODY = 64 * 1024
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

HERE = os.path.dirname(os.path.abspath(__file__))
CRITERIA_PATHS = [
    os.path.join(HERE, "..", "criteria.json"),
    os.path.join(os.getcwd(), "criteria.json"),
]


def model_name():
    return os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL


def load_criteria():
    for p in CRITERIA_PATHS:
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError("criteria.json 을 찾지 못했습니다")


def build_prompt(criteria, texts):
    cats = sorted(criteria["categories"], key=lambda c: c["order"])
    lines = ["너는 사내 IT 팀장을 돕는 분류기다. 직원이 보낸 IT 요청 문장을 칸과 긴급도로 나눈다.", "", "[칸]"]
    for c in cats:
        lines.append("- {}: {}".format(c["name"], c["definition"]))
    tb = criteria.get("tie_break", {})
    if tb.get("rule"):
        lines.append(tb["rule"])
    for w in tb.get("why", []):
        lines.append("  (이유: {})".format(w))
    lines += ["", "[긴급도]"]
    for u in criteria["urgency"]:
        lines.append("- {}: {}".format(u["name"], u["definition"]))
    lines += [
        "",
        "문장 속 [이름] [전화번호] [사번]은 가린 개인정보다. 분류에는 쓰지 않는다.",
        "",
        "[분류할 문장]",
    ]
    for i, t in enumerate(texts):
        lines.append("{}. {}".format(i + 1, t))
    names_c = " · ".join(c["name"] for c in cats)
    names_u = " · ".join(u["name"] for u in criteria["urgency"])
    lines += [
        "",
        "[답하는 형식]",
        "JSON 배열 하나만 답한다. 문장마다 {\"i\": 번호, \"category\": 칸, \"urgency\": 긴급도, \"reason\": 이유} 하나.",
        "category는 {} 중 하나, urgency는 {} 중 하나.".format(names_c, names_u),
        "reason은 그렇게 본 까닭을 한국어 한 문장(40자 안쪽)으로 쓴다.",
    ]
    return "\n".join(lines)


def parse_answer(raw_text, n, cat_names, urg_names):
    """모델 답에서 JSON 배열을 꺼내 문장 순서대로 정리한다. 형식이 틀린 항목은 None."""
    s = raw_text.strip()
    start, end = s.find("["), s.rfind("]")
    if start == -1 or end <= start:
        raise ValueError("AI 답에서 JSON 배열을 찾지 못했습니다")
    data = json.loads(s[start:end + 1])
    out = [None] * n
    for k, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item.get("i", k + 1)) - 1
        except (TypeError, ValueError):
            continue
        cat, urg = item.get("category"), item.get("urgency")
        if 0 <= idx < n and cat in cat_names and urg in urg_names:
            out[idx] = {"category": cat, "urgency": urg, "reason": str(item.get("reason", "")).strip()[:120]}
    return out


def call_gemini(model, key, criteria, texts):
    body = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(criteria, texts)}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        API_URL.format(model=model),
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=WAIT_SECONDS) as res:
        data = json.loads(res.read().decode("utf-8"))
    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if not text:
        raise ValueError("AI가 빈 답을 보냈습니다")
    return parse_answer(text, len(texts),
                        [c["name"] for c in criteria["categories"]],
                        [u["name"] for u in criteria["urgency"]])


def fail(model, reason, **extra):
    out = {"results": None, "model": model, "reason": reason}
    out.update(extra)
    return out


def classify(payload):
    model = model_name()
    if not MODEL_RE.match(model):
        return 500, fail(None, "GEMINI_MODEL 값의 형식이 올바르지 않습니다")

    texts = payload.get("texts")
    if not isinstance(texts, list) or not texts or len(texts) > MAX_TEXTS \
            or not all(isinstance(t, str) for t in texts):
        return 400, fail(model, "texts는 문장 1~{}개의 목록이어야 합니다".format(MAX_TEXTS))
    texts = [t.strip()[:MAX_CHARS] for t in texts]

    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        return 200, fail(model, "서버에 GEMINI_API_KEY가 설정되지 않았습니다")

    try:
        criteria = load_criteria()
    except (OSError, ValueError) as e:
        return 200, fail(model, "기준 파일을 읽지 못했습니다: {}".format(e))

    try:
        return 200, {"results": call_gemini(model, key, criteria, texts), "model": model}
    except urllib.error.HTTPError as e:
        msg = ""
        try:
            msg = str((json.loads(e.read().decode("utf-8", "replace")).get("error") or {}).get("message", ""))
        except Exception:
            pass
        msg = msg.replace(key, "***")[:200]
        head = "AI 사용 한도를 넘었습니다" if e.code == 429 else "AI 호출 오류"
        return 200, fail(model, "{}(HTTP {}, 모델 {}){}".format(head, e.code, model, ": " + msg if msg else ""))
    except urllib.error.URLError as e:
        if isinstance(e.reason, (TimeoutError, socket.timeout)):
            return 200, fail(model, "AI가 {}초 안에 답하지 않았습니다(모델 {})".format(WAIT_SECONDS, model), timeout=True)
        return 200, fail(model, "AI 서버에 연결하지 못했습니다(모델 {})".format(model))
    except (TimeoutError, socket.timeout):
        return 200, fail(model, "AI가 {}초 안에 답하지 않았습니다(모델 {})".format(WAIT_SECONDS, model), timeout=True)
    except (ValueError, KeyError, IndexError, AttributeError, TypeError) as e:
        return 200, fail(model, "AI 답을 읽지 못했습니다(모델 {}): {}".format(model, e))


class handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"model": model_name()})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._send(400, fail(None, "요청 본문이 비었거나 너무 큽니다"))
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self._send(400, fail(None, "요청 본문이 JSON이 아닙니다"))
            return
        status, reply = classify(payload)
        self._send(status, reply)

    def log_message(self, *args):
        # 요청 문장이 로그에 남지 않게 기본 접근 로그를 끈다.
        pass
