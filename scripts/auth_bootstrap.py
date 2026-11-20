import os
import sys
import base64
import urllib.parse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests
from dotenv import load_dotenv

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
REQUIRED_SCOPE = "user-read-recently-played"

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    auth_code: str | None = None
    auth_error: str | None = None

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed_url.query)

        if "code" in params:
            OAuthCallbackHandler.auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<h1>Spotify Authorization Successful!</h1>"
                b"<p>You can close this tab and return to the terminal.</p>"
            )
        elif "error" in params:
            OAuthCallbackHandler.auth_error = params["error"][0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                f"<h1>Authorization Failed</h1><p>{OAuthCallbackHandler.auth_error}</p>".encode("utf-8")
            )
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silence default HTTP server console logging
        return

def exchange_code_for_token(client_id: str, client_secret: str, redirect_uri: str, code: str) -> dict:
    auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("utf-8")
    headers = {
        "Authorization": f"Basic {auth_header}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }

    response = requests.post(SPOTIFY_TOKEN_URL, headers=headers, data=data)
    if response.status_code != 200:
        raise RuntimeError(f"Token exchange failed ({response.status_code}): {response.text}")

    return response.json()

def main():
    load_dotenv()

    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback")

    if not client_id or not client_secret:
        print("ERROR: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env or environment.", file=sys.stderr)
        sys.exit(1)

    parsed_redirect = urllib.parse.urlparse(redirect_uri)
    host = parsed_redirect.hostname or "127.0.0.1"
    port = parsed_redirect.port or 8888

    auth_params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": REQUIRED_SCOPE,
        "show_dialog": "true",
    }
    auth_url = f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(auth_params)}"

    print(f"Starting local callback server on {host}:{port}...")
    try:
        server = HTTPServer((host, port), OAuthCallbackHandler)
    except OSError as e:
        print(f"ERROR: Could not bind to {host}:{port}: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Opening browser for Spotify authorization...")
    print(f"If your browser does not open automatically, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    # Wait for the single callback request
    server.handle_request()

    if OAuthCallbackHandler.auth_error:
        print(f"ERROR: Authorization failed with error: {OAuthCallbackHandler.auth_error}", file=sys.stderr)
        sys.exit(1)

    code = OAuthCallbackHandler.auth_code
    if not code:
        print("ERROR: No authorization code received.", file=sys.stderr)
        sys.exit(1)

    print("Authorization code received. Exchanging for refresh token...")
    try:
        token_data = exchange_code_for_token(client_id, client_secret, redirect_uri, code)
        refresh_token = token_data.get("refresh_token")
        if not refresh_token:
            print("ERROR: Response did not contain a refresh_token.", file=sys.stderr)
            sys.exit(1)

        print("\n================ SUCCESS ================")
        print(f"SPOTIFY_REFRESH_TOKEN={refresh_token}")
        print("=========================================\n")
        print("Add SPOTIFY_REFRESH_TOKEN to your .env file.")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
