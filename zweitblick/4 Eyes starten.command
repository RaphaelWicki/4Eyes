#!/bin/bash
# Startet 4 Eyes lokal und öffnet es im Browser. Fenster offen lassen, solange du arbeitest.
# Der Server sagt dem Browser, nichts zwischenzuspeichern – so siehst du nach Änderungen immer die neue Version.
cd "$(dirname "$0")"
PORT=8420
echo "4 Eyes läuft auf http://localhost:$PORT  (Beenden: dieses Fenster schliessen oder Ctrl+C)"
( sleep 1; open "http://localhost:$PORT" ) &
python3 -c '
import http.server, sys
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), NoCache).serve_forever()
' $PORT
