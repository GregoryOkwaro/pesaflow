"""Development server. In production use a real WSGI server, e.g.
    gunicorn -w 4 -b 0.0.0.0:8000 'app.web:application'
"""
import os
import sys
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config, db, notify  # noqa: E402
from app.web import application  # noqa: E402


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietHandler(WSGIRequestHandler):
    def log_request(self, code="-", size="-"):
        if not self.path.startswith("/static/"):
            super().log_request(code, size)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    db.init()
    with make_server("0.0.0.0", port, application, ThreadingWSGIServer, handler_class=QuietHandler) as srv:
        print(f"{config.APP_NAME} running on http://localhost:{port}  (M-Pesa mode: {config.MPESA_ENV})")
        if config.NOTIFY_ENV != "live":
            print("Password-reset codes are printed to this log (NOTIFY_ENV=mock). Never use mock in production.")
        elif not notify.live_channels_configured():
            print("WARNING: NOTIFY_ENV=live but neither SMTP nor Africa's Talking is configured; reset codes can't be sent.")
        srv.serve_forever()
