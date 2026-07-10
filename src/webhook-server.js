const http = require('node:http');

function startWebhookServer({ port, path, onEvent }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== path) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        await onEvent(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (error) {
        console.error('Webhook error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"internal"}');
      }
    });
  });

  server.listen(port, () => {
    console.log(`Webhook ЮKassa: http://127.0.0.1:${port}${path}`);
  });

  return server;
}

module.exports = {
  startWebhookServer,
};
