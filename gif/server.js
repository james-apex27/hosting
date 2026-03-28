const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8080;
const STATIC_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // ── Image Proxy Endpoint ──────────────────
    if (pathname === '/proxy-image') {
        const imageUrl = parsed.query.url;
        if (!imageUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing ?url= parameter');
            return;
        }

        // Only allow proxying from apex27 domains for security
        try {
            const imgParsed = new URL(imageUrl);
            if (!imgParsed.hostname.endsWith('.apex27.co.uk')) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end('Only apex27.co.uk image URLs are allowed');
                return;
            }
        } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid URL');
            return;
        }

        const protocol = imageUrl.startsWith('https') ? https : http;
        protocol.get(imageUrl, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
            });
            proxyRes.pipe(res);
        }).on('error', (err) => {
            console.error('Proxy error:', err.message);
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Failed to fetch image');
        });
        return;
    }

    // ── Save to Apex27 Proxy ─────────────────
    if (pathname === '/save-to-apex' && req.method === 'POST') {
        const queryString = parsed.search || '';
        const targetUrl = 'https://n8n.apex27.co.uk/webhook/3319ef78-e13f-4651-9ad9-8b7d74047255' + queryString;

        // Collect the incoming request body
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks);

            const targetParsed = new URL(targetUrl);
            const options = {
                hostname: targetParsed.hostname,
                port: 443,
                path: targetParsed.pathname + targetParsed.search,
                method: 'POST',
                headers: {
                    ...req.headers,
                    host: targetParsed.hostname,
                    'content-length': body.length
                }
            };

            const proxyReq = https.request(options, (proxyRes) => {
                const resChunks = [];
                proxyRes.on('data', chunk => resChunks.push(chunk));
                proxyRes.on('end', () => {
                    const resBody = Buffer.concat(resChunks);
                    res.writeHead(proxyRes.statusCode, {
                        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(resBody);
                });
            });

            proxyReq.on('error', (err) => {
                console.error('Save proxy error:', err.message);
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to save to Apex27: ' + err.message }));
            });

            proxyReq.write(body);
            proxyReq.end();
        });
        return;
    }

    // ── Static File Serving ───────────────────
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(STATIC_DIR, filePath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  Apex GIF Creator server running at:`);
    console.log(`  → http://localhost:${PORT}\n`);
    console.log(`  Image proxy available at /proxy-image?url=...\n`);
});
