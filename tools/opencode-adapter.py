#!/usr/bin/env python3
"""
adapter.py — OpenAI-compatible bridge for `opencode serve`.

CampusFlow's AI Manager calls this like any OpenAI endpoint:
    POST http://localhost:8081/v1/chat/completions
    GET  http://localhost:8081/v1/models

This adapter forwards prompts to a headless opencode server (default
http://127.0.0.1:4096) using its session API and returns standard
OpenAI chat-completion responses.

Usage:
    1) opencode serve --port 4096
    2) python adapter.py            (serves on :8081)

Env vars:
    ADAPTER_PORT      port for this adapter          (default 8081)
    OPENCODE_URL      opencode server base URL       (default http://127.0.0.1:4096)
    OPENCODE_PROVIDER default providerID             (auto-detected if unset)
    OPENCODE_MODEL    default modelID                (auto-detected if unset)
"""

import json
import os
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ADAPTER_PORT = int(os.environ.get("ADAPTER_PORT", "8081"))
OPENCODE_URL = os.environ.get("OPENCODE_URL", "http://127.0.0.1:22124").rstrip("/")

# ---------------------------------------------------------------- helpers

def _req(method: str, url: str, body: dict | None = None, timeout: int = 600):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}


def get_default_model() -> tuple[str, str]:
    """Ask opencode for its default provider/model, fall back to env/manual."""
    env_p = os.environ.get("OPENCODE_PROVIDER")
    env_m = os.environ.get("OPENCODE_MODEL")
    try:
        cfg = _req("GET", f"{OPENCODE_URL}/config/providers")
        providers = cfg.get("providers", [])
        dflt = cfg.get("default") or {}
        if isinstance(dflt, dict) and dflt:
            # Prefer opencode's own hosted model over e.g. image models
            if "opencode" in dflt:
                return "opencode", dflt["opencode"]
            p = next(iter(dflt))
            return p, dflt[p]
        if providers:
            p = providers[0].get("id", "opencode")
            models = (providers[0].get("models") or {})
            m = next(iter(models), "default")
            return p, m
    except Exception as e:
        print(f"[adapter] could not auto-detect model ({e}); using fallback")
    return (env_p or "opencode"), (env_m or "default")


def list_all_models() -> list:
    """Enumerate every configured provider/model from opencode.

    Returns OpenAI-compatible model entries [{id: "provider/model", ...}].
    Raises on failure so callers can fall back to the static defaults.
    """
    cfg = _req("GET", f"{OPENCODE_URL}/config/providers", timeout=15)
    providers = cfg.get("providers") or []
    models: list = []
    seen: set = set()
    for p in providers:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip()
        if not pid:
            continue
        raw = p.get("models") or {}
        ids = list(raw.keys()) if isinstance(raw, dict) else raw
        if not isinstance(ids, list):
            continue
        for m in ids:
            mid = str(m or "").strip()
            if not mid:
                continue
            full = f"{pid}/{mid}"
            if full in seen:
                continue
            seen.add(full)
            models.append({"id": full, "object": "model", "owned_by": "opencode"})
    if not models:
        raise RuntimeError("no models found in opencode provider config")
    # Back-compat alias: callers may request model "default" (no slash),
    # which run_completion resolves via get_default_model().
    models.append({"id": "default", "object": "model", "owned_by": "opencode"})
    return models


def extract_text(parts: list) -> str:
    """Concatenate text parts from an opencode assistant message."""
    out = []
    for part in parts or []:
        if not isinstance(part, dict):
            continue
        t = part.get("type")
        if t == "text" and part.get("text"):
            out.append(part["text"])
        elif t == "reasoning":
            continue
        elif t == "tool":
            # surface tool activity compactly (optional, comment out if noisy)
            pass
    return "\n".join(out).strip()


def openai_error(handler, status: int, message: str):
    payload = json.dumps({"error": {"message": message, "type": "adapter_error"}}).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def build_completion(model_id: str, content: str, finish: str = "stop") -> dict:
    now = int(time.time())
    return {
        "id": f"chatcmpl-opencode-{now}",
        "object": "chat.completion",
        "created": now,
        "model": model_id,
        "choices": [{
            "index": 0,
            "finish_reason": finish,
            "message": {"role": "assistant", "content": content},
        }],
        "usage": {
            "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
        },
    }


# ---------------------------------------------------------------- core flow

def run_completion(body: dict) -> dict:
    user_msg, model_id, system = "", "", None
    for m in body.get("messages") or []:
        role = m.get("role")
        content = m.get("content")
        if isinstance(content, list):  # OpenAI multimodal -> keep text bits
            content = "\n".join(
                p.get("text", "") for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            )
        if role == "system" or role == "developer":
            system = content
        elif role == "user":
            user_msg = content or ""

    if body.get("model") and "/" in str(body["model"]):
        provider_id, model_id = str(body["model"]).split("/", 1)
    else:
        provider_id, model_id = get_default_model()

    # Fresh session per request: caller already sends full history in `messages`,
    # so reusing sessions would double the context.
    session = _req("POST", f"{OPENCODE_URL}/session", {"title": "campusflow"})
    sid = session.get("id")

    msg_body = {
        "parts": [{"type": "text", "text": user_msg}],
        "model": {"providerID": provider_id, "modelID": model_id},
    }
    if system:
        msg_body["system"] = [system]

    result = _req("POST", f"{OPENCODE_URL}/session/{sid}/message", msg_body)

    # Surface upstream errors (e.g., provider auth failures) instead of empty text
    err = (result.get("info") or {}).get("error")
    if err:
        try:
            _req("DELETE", f"{OPENCODE_URL}/session/{sid}")
        except Exception:
            pass
        detail = ((err.get("data") or {}).get("responseBody") or err.get("name") or "unknown")
        raise RuntimeError(f"opencode model error [{provider_id}/{model_id}]: {detail}")

    content = extract_text(result.get("parts"))
    try:
        _req("DELETE", f"{OPENCODE_URL}/session/{sid}")
    except Exception:
        pass

    return build_completion(str(body.get("model") or f"{provider_id}/{model_id}"),
                            content or "(empty response)")


# ---------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"[adapter] {fmt % args}")

    def _json(self, obj, status=200):
        payload = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip("/") in ("/v1/models", "/models"):
            try:
                try:
                    models = list_all_models()
                except Exception as e:
                    print(f"[adapter] model enumeration failed ({e}); using fallback")
                    provider_id, model_id = get_default_model()
                    models = [{"id": f"{provider_id}/{model_id}", "object": "model",
                               "owned_by": "opencode"},
                              {"id": "default", "object": "model", "owned_by": "opencode"}]
                self._json({"object": "list", "data": models})
            except Exception as e:
                openai_error(self, 502, f"opencode unreachable: {e}")
        elif self.path.rstrip("/") == "/health":
            self._json({"ok": True})
        else:
            openai_error(self, 404, "unknown path")

    def do_POST(self):
        if not self.path.rstrip("/").endswith("chat/completions"):
            openai_error(self, 404, "unknown path")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            openai_error(self, 400, f"bad JSON: {e}")
            return
        try:
            result = run_completion(body)
            if body.get("stream"):
                # Minimal SSE shim: one chunk then [DONE]
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                chunk = result["choices"][0]["message"]["content"]
                frame = {"id": result["id"], "object": "chat.completion.chunk",
                         "created": result["created"], "model": result["model"],
                         "choices": [{"index": 0, "finish_reason": None,
                                      "delta": {"role": "assistant", "content": chunk}}]}
                self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
                done = {"choices": [{"index": 0, "finish_reason": "stop", "delta": {}}]}
                self.wfile.write(f"data: {json.dumps(done)}\n\ndata: [DONE]\n\n".encode())
            else:
                self._json(result)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            openai_error(self, 502, f"opencode error {e.code}: {detail}")
        except Exception as e:
            openai_error(self, 500, f"adapter failure: {e}")


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", ADAPTER_PORT), Handler)
    print(f"[adapter] OpenAI-compatible bridge on  http://127.0.0.1:{ADAPTER_PORT}/v1")
    print(f"[adapter] forwarding to opencode at   {OPENCODE_URL}")
    print(f"[adapter] endpoints: POST /v1/chat/completions | GET /v1/models | GET /health")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[adapter] bye")
