import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from prometheus_client import CONTENT_TYPE_LATEST, generate_latest


# HTTP endpoint paths exposed by the produce command admin server.
METRICS_PATH = "/metrics"
HEALTH_PATH = "/healthz"
READINESS_PATH = "/readyz"


class PmgenAdminRequestHandler(BaseHTTPRequestHandler):
    # Request handler for pmgen operational endpoints.
    #
    # The handler intentionally stays small because pmgen only needs metrics and
    # basic probes here. Runtime control APIs can move this to a full web
    # framework later if the service grows a Web UI.

    def do_GET(self) -> None:
        # Route simple GET requests to the supported operational endpoints.
        request_path = self.path.split("?", maxsplit=1)[0]

        if request_path == METRICS_PATH:
            self._write_metrics_response()
            return

        if request_path == HEALTH_PATH:
            self._write_empty_response(HTTPStatus.OK)
            return

        if request_path == READINESS_PATH:
            self._write_empty_response(HTTPStatus.OK)
            return

        self._write_empty_response(HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:
        # Suppress per-request access logs so scrape traffic does not clutter
        # pmgen's event-production logs.
        return

    def _write_metrics_response(self) -> None:
        # Serialize the default Prometheus registry using the official client.
        response_body = generate_latest()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", CONTENT_TYPE_LATEST)
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _write_empty_response(self, status: HTTPStatus) -> None:
        # Write an empty response for probe and not-found endpoints.
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()


def start_admin_http_server(port: int) -> ThreadingHTTPServer:
    # Start the admin HTTP server in a daemon thread so the asyncio producer loop
    # remains responsible for the main process lifetime.
    server = ThreadingHTTPServer(("", port), PmgenAdminRequestHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    return server
