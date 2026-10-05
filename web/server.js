const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const BASE_DIR = path.resolve(__dirname);

// Mapping of named routes to backend microservice ports
const SERVICE_PORTS = {
  order: 9091,
  customer: 9093,
  payment: 9094,
  restaurant: 9095,
  delivery: 9096,
  notif: 9097,
  notification: 9097,
  admin: 9098
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // 1. Handle OPTIONS preflight requests globally
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // 2. Check for reverse-proxy routes: /api/:port/... or /api/:service/...
  const apiMatch = req.url.match(/^\/api\/([^/?#]+)(?:([/?].*)|$)/);
  if (apiMatch) {
    const targetKey = apiMatch[1].toLowerCase();
    let targetPort = SERVICE_PORTS[targetKey];

    if (!targetPort && /^\d+$/.test(targetKey)) {
      targetPort = parseInt(targetKey, 10);
    }

    if (!targetPort || targetPort < 1 || targetPort > 65535) {
      res.writeHead(400, {
        'Content-Type': 'application/json; charset=utf-8',
        ...CORS_HEADERS
      });
      return res.end(JSON.stringify({
        error: `Unknown service or invalid port: ${apiMatch[1]}`
      }));
    }

    // Resolve target subPath
    let subPath = apiMatch[2] || '/';
    if (!subPath.startsWith('/')) {
      subPath = '/' + subPath;
    }

    // Forward request headers (except host)
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['host'];
    delete forwardHeaders['Host'];

    // Proxy request to backend microservice using Node's http.request
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: subPath,
        method: req.method,
        headers: forwardHeaders,
        timeout: 6000
      },
      (proxyRes) => {
        if (res.headersSent || res.writableEnded) return;
        try {
          // Strip existing upstream CORS headers to avoid duplicate header conflicts
          const responseHeaders = { ...proxyRes.headers };
          for (const key of Object.keys(responseHeaders)) {
            if (key.toLowerCase().startsWith('access-control-')) {
              delete responseHeaders[key];
            }
          }
          Object.assign(responseHeaders, CORS_HEADERS);

          res.writeHead(proxyRes.statusCode, responseHeaders);
          proxyRes.pipe(res);
        } catch (e) {
          console.error('[Proxy Response Error]', e.message);
        }
      }
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Proxy request timed out after 6000ms'));
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy Error] ${req.method} http://127.0.0.1:${targetPort}${subPath} - ${err.message}`);
      if (!res.headersSent && !res.writableEnded) {
        try {
          res.writeHead(502, {
            'Content-Type': 'application/json; charset=utf-8',
            ...CORS_HEADERS
          });
          res.end(JSON.stringify({
            error: 'Bad Gateway',
            message: `Failed to connect to microservice at 127.0.0.1:${targetPort}`,
            details: err.message
          }));
        } catch (_) {}
      }
    });

    req.on('error', (err) => {
      console.error(`[Client Request Error] ${err.message}`);
      proxyReq.destroy(err);
    });

    // Forward request body
    req.pipe(proxyReq);
    return;
  }

  // 3. Static File Serving from BASE_DIR (web/)
  let cleanUrl = req.url.split('?')[0];
  if (cleanUrl === '/') cleanUrl = '/index.html';

  const filePath = path.join(BASE_DIR, cleanUrl);

  // Security check: restrict access to within BASE_DIR
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, {
      'Content-Type': 'text/plain; charset=utf-8',
      ...CORS_HEADERS
    });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...CORS_HEADERS
      });
      return res.end('404 Not Found');
    }

    let targetFilePath = filePath;
    if (stats.isDirectory()) {
      targetFilePath = path.join(filePath, 'index.html');
      try {
        const dirIndexStats = fs.statSync(targetFilePath);
        if (!dirIndexStats.isFile()) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8',
            ...CORS_HEADERS
          });
          return res.end('404 Not Found');
        }
      } catch {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          ...CORS_HEADERS
        });
        return res.end('404 Not Found');
      }
    }

    const ext = path.extname(targetFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      ...CORS_HEADERS
    });

    fs.createReadStream(targetFilePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Food Delivery Server with API Reverse-Proxy running at http://localhost:${PORT}`);
  console.log(`- Portal Hub:        http://localhost:${PORT}/index.html`);
  console.log(`- Admin Console:     http://localhost:${PORT}/admin_dashboard/index.html`);
  console.log(`- Driver Dispatch:   http://localhost:${PORT}/driver_app/index.html`);
  console.log(`- Client Customer:   http://localhost:${PORT}/client_app/index.html`);
  console.log(`- API Reverse Proxy: http://localhost:${PORT}/api/<service|port>/<subpath>`);
});
