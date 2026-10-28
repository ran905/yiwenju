#!/usr/bin/env node
/**
 * 零依赖静态服务器，用于本地预览。
 * 只放行站点真正需要的文件类型，避免把 .git、脚本、原始数据暴露出去。
 *
 * 用法：node scripts/serve.mjs [端口]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// 只允许这些后缀；.mjs / .md / 无后缀（.git 里的文件）一律 404
const ALLOWED = new Set(Object.keys(TYPES));

// 这些路径即使后缀合法也不对外
const DENY = [/^\/data\/curation\.json$/, /^\/data\/meta\.json$/, /^\/data\/raw\//, /^\/\./];

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(ROOT, pathname));

    // 防止路径穿越
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (DENY.some((re) => re.test(pathname))) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info || !ALLOWED.has(path.extname(file).toLowerCase())) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()],
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`500 ${err.message}`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  前沿切片  →  http://127.0.0.1:${PORT}\n`);
});
