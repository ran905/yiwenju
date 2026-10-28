#!/usr/bin/env node
/**
 * 生成可部署的 dist/ 目录：只包含站点真正需要的文件。
 * 抓取脚本、原始数据、README 都不会进 dist。
 *
 * 用法：node scripts/build.mjs
 */
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, 'assets'), { recursive: true });
await mkdir(path.join(DIST, 'data'), { recursive: true });

await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
await cp(path.join(ROOT, '404.html'), path.join(DIST, '404.html'));
await cp(path.join(ROOT, 'robots.txt'), path.join(DIST, 'robots.txt'));
await cp(path.join(ROOT, 'sitemap.xml'), path.join(DIST, 'sitemap.xml'));
await cp(path.join(ROOT, '_redirects'), path.join(DIST, '_redirects'));
await cp(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
await cp(path.join(ROOT, 'data', 'papers.json'), path.join(DIST, 'data', 'papers.json'));
await cp(path.join(ROOT, 'data', 'fields.json'), path.join(DIST, 'data', 'fields.json'));

// Cloudflare Pages / Netlify 都认 _headers
await writeFile(
  path.join(DIST, '_headers'),
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '',
    '/data/*',
    '  Cache-Control: public, max-age=300',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=3600',
    '',
  ].join('\n'),
  'utf8',
);

const data = JSON.parse(await readFile(path.join(DIST, 'data', 'papers.json'), 'utf8'));
console.log(`✓ dist/ 就绪：${data.count} 篇论文`);
