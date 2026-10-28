#!/usr/bin/env node
/**
 * 从 arXiv 抓取各领域最新论文的元数据（标题、摘要、作者、链接）。
 * 只抓元数据，不下载 PDF。
 *
 * 用法：
 *   node scripts/fetch.mjs                  # 每个领域抓 12 篇，只要最近 14 天
 *   node scripts/fetch.mjs --per-field 8 --days 7
 *   node scripts/fetch.mjs --field physics  # 只抓一个领域
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARXIV = 'https://export.arxiv.org/api/query';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const PER_FIELD = Number(arg('per-field', 12));
const DAYS = Number(arg('days', 14));
const ONLY = arg('field', null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 取出 <tag ...>内容</tag>，去掉内部标签并解码实体 */
function pick(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  return decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function pickAll(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    out.push(decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
  }
  return out;
}

function attr(xml, tag, name) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`));
  return m ? m[1] : '';
}

function parseFeed(xml) {
  return xml
    .split('<entry>')
    .slice(1)
    .map((chunk) => chunk.split('</entry>')[0])
    .map((e) => {
      const rawId = pick(e, 'id');
      const id = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
      const links = [...e.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
      const alt = links.find((l) => l.includes('rel="alternate"'));
      const pdf = links.find((l) => l.includes('title="pdf"'));
      return {
        id,
        title: pick(e, 'title'),
        abstract: pick(e, 'summary'),
        authors: pickAll(e, 'name').filter(Boolean),
        published: pick(e, 'published'),
        updated: pick(e, 'updated'),
        primary: attr(e, 'arxiv:primary_category', 'term'),
        categories: [...e.matchAll(/<category\b[^>]*term="([^"]+)"/g)].map((m) => m[1]),
        comment: pick(e, 'arxiv:comment'),
        journalRef: pick(e, 'arxiv:journal_ref'),
        doi: pick(e, 'arxiv:doi'),
        url: alt ? attr(alt, 'link', 'href').replace(/v\d+$/, '') : `https://arxiv.org/abs/${id}`,
        pdf: pdf ? attr(pdf, 'link', 'href') : `https://arxiv.org/pdf/${id}`,
      };
    })
    .filter((p) => p.id && p.title);
}

async function main() {
  const fields = JSON.parse(await readFile(path.join(ROOT, 'data/fields.json'), 'utf8'));
  const cutoff = Date.now() - DAYS * 864e5;
  await mkdir(path.join(ROOT, 'data/raw'), { recursive: true });

  for (const field of fields) {
    if (ONLY && field.id !== ONLY) continue;
    const query = field.arxiv.map((c) => `cat:${c}`).join(' OR ');
    const url =
      `${ARXIV}?search_query=${encodeURIComponent(query)}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${PER_FIELD * 2}`;

    process.stdout.write(`· ${field.name} … `);
    let papers = [];
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'FrontierSlice/1.0 (high-school science digest)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      papers = parseFeed(xml).filter((p) => new Date(p.published).getTime() >= cutoff);
    } catch (err) {
      console.log(`失败：${err.message}`);
      continue;
    }

    // 同一个 id 可能因为多分类重复出现
    const seen = new Set();
    const rows = papers
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .slice(0, PER_FIELD)
      .map((p) => ({ ...p, field: field.id }));

    await writeFile(
      path.join(ROOT, `data/raw/${field.id}.json`),
      JSON.stringify(rows, null, 2) + '\n',
      'utf8',
    );
    console.log(`${rows.length} 篇（最近 ${DAYS} 天）`);
    await sleep(3200); // 对 arXiv 友好一点
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
