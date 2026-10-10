#!/usr/bin/env python3
"""码字工坊 · 本地服务器（网页版）

除了静态文件，还提供 /ai/chat 代理：
  浏览器直连大模型会被 CORS 拦截，所以由本机服务器代为转发。
  仅监听 127.0.0.1，密钥只在你的机器内部流转。

用法:  python serve.py [起始端口]
"""
import http.server
import json
import os
import socket
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request

START_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")


class Handler(http.server.SimpleHTTPRequestHandler):
    # ---------- 静态文件 ----------
    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            target = self.translate_path(parsed.path)
            if not os.path.exists(target):
                base = os.path.basename(parsed.path.rstrip("/"))
                if "." not in base:
                    self.path = "/"
        except Exception:
            pass
        super().do_GET()

    # ---------- AI 代理 ----------
    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/ai/chat":
            self._json(404, {"error": {"message": "not found"}})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception as e:
            self._json(400, {"error": {"message": "bad request body: %s" % e}})
            return

        base = (body.get("baseUrl") or "").rstrip("/")
        key = body.get("apiKey") or ""
        model = body.get("model") or ""
        messages = body.get("messages") or []
        if not base or not key or not model:
            self._json(400, {"error": {"message": "missing baseUrl / apiKey / model"}})
            return
        if not isinstance(messages, list) or not messages:
            self._json(400, {"error": {"message": "messages is empty"}})
            return

        payload = {
            "model": model,
            "messages": messages,
            "temperature": body.get("temperature", 0.8),
            "max_tokens": body.get("maxTokens", 1200),
            "stream": False,
        }
        req = urllib.request.Request(
            base + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                raw = r.read()
            try:
                obj = json.loads(raw.decode("utf-8"))
            except Exception:
                self._json(502, {"error": {"message": "上游返回不是 JSON: " + raw.decode("utf-8", "ignore")[:400]}})
                return
            self._json(200, obj)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:600]
            self._json(502, {"error": {"message": "上游 HTTP %d: %s" % (e.code, detail)}})
        except Exception as e:
            self._json(502, {"error": {"message": "%s: %s" % (type(e).__name__, e)}})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def pick_port(start, tries=40):
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit("from %d, %d ports all in use; pass a free port." % (start, tries))


def main():
    os.chdir(ROOT)
    port = pick_port(START_PORT)
    url = "http://127.0.0.1:%d/" % port
    try:
        with open(os.path.join(os.path.dirname(ROOT), "server-url.txt"), "w", encoding="utf-8") as f:
            f.write(url)
    except Exception:
        pass
    if port != START_PORT:
        print("[note] port %d busy (stale process), switched to %d" % (START_PORT, port))
    print("=" * 52)
    print("  Writer Studio is running")
    print("  URL: %s" % url)
    print("  AI proxy: POST /ai/chat  (for browser CORS)")
    print("  close this window to stop")
    print("=" * 52)
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler) as httpd:
        httpd.daemon_threads = True
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")


if __name__ == "__main__":
    main()
