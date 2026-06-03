// Reverse proxy: routes between v1 (port 3001) and v2 (port 3002)
// Runs on port 8080 — no root required.
// Cloudflare Tunnel connects to http://localhost:8080
//
// Routing:
//   /ws          → 3002 (v2 WebSocket — LilyGO devices + browser)
//   /api/v2/*    → 3002 (v2 REST, strips /api/v2 prefix)
//   *            → 3001 (v1 legacy MRI monitor)

const http      = require('http');
const httpProxy = require('http-proxy');

const proxy = httpProxy.createProxy();

const V1 = { target: 'http://127.0.0.1:3001' };
const V2 = { target: 'http://127.0.0.1:3002' };

proxy.on('error', (err, req, res) => {
  console.error('[PROXY ERR]', err.message, req.url);
  if (res && !res.headersSent) res.writeHead(502).end('Bad Gateway');
});

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/v2/')) {
    req.url = req.url.replace('/api/v2/', '/api/');
    return proxy.web(req, res, V2);
  }
  proxy.web(req, res, V1);
});

// WebSocket upgrade routing
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws')) {
    return proxy.ws(req, socket, head, V2);
  }
  proxy.ws(req, socket, head, V1);
});

const PORT = parseInt(process.env.PORT) || 8080;
server.listen(PORT, () => console.log(`[PROXY] listening on :${PORT}`));
