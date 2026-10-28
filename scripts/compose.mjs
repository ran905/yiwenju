#!/usr/bin/env node
/**
 * 把「中文改写」(data/curation.json) 和 arXiv 元数据合并成站点数据 data/papers.json。
 * 元数据会缓存在 data/meta.json，只有缺失的 id 才会重新请求 arXiv。
 *
 * 用法：node scripts/compose.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DATA, file), 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

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

async function fetchMeta(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const url = `https://export.arxiv.org/api/query?id_list=${batch.join(',')}&max_results=${batch.length + 5}`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'FrontierSlice/1.0 (high-school science digest)' },
    });
    if (!res.ok) throw new Error(`arXiv 返回 HTTP ${res.status}`);
    const xml = await res.text();
    for (const chunk of xml.split('<entry>').slice(1)) {
      const entry = chunk.split('</entry>')[0];
      const baseId = pick(entry, 'id')
        .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
        .replace(/v\d+$/, '');
      const links = [...entry.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
      const alt = links.find((l) => l.includes('rel="alternate"'));
      const pdf = links.find((l) => l.includes('title="pdf"'));
      out[baseId] = {
        id: baseId,
        title: pick(entry, 'title'),
        abstract: pick(entry, 'summary'),
        authors: pickAll(entry, 'name').filter(Boolean),
        published: pick(entry, 'published'),
        primary: attr(entry, 'arxiv:primary_category', 'term'),
        comment: pick(entry, 'arxiv:comment'),
        url: alt ? attr(alt, 'link', 'href').replace(/v\d+$/, '') : `https://arxiv.org/abs/${baseId}`,
        pdf: pdf ? attr(pdf, 'link', 'href') : `https://arxiv.org/pdf/${baseId}`,
      };
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

const REQUIRED = ['title_zh', 'one_liner', 'why', 'bg', 'method', 'finding', 'impact', 'analogy', 'field'];

const curation = await readJson('curation.json');
const meta = await readJson('meta.json', {});

const missing = Object.keys(curation).filter((id) => !meta[id]);
if (missing.length) {
  console.log(`· 从 arXiv 补元数据：${missing.length} 篇`);
  Object.assign(meta, await fetchMeta(missing));
  await writeFile(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

const papers = [];
for (const [id, c] of Object.entries(curation)) {
  const m = meta[id];
  if (!m) throw new Error(`缺少 ${id} 的 arXiv 元数据`);
  for (const key of REQUIRED) {
    if (!c[key]) throw new Error(`${id} 缺少字段 ${key}`);
  }
  papers.push({
    id,
    field: c.field,
    source: 'arXiv',
    source_label: `arXiv · ${m.primary || 'preprint'}`,
    published: m.published.slice(0, 10),
    title_en: m.title,
    title_zh: c.title_zh,
    one_liner: c.one_liner,
    why: c.why,
    sections: { background: c.bg, method: c.method, finding: c.finding, impact: c.impact },
    analogy: c.analogy,
    terms: c.terms || [],
    tags: c.tags || [],
    difficulty: c.difficulty || 2,
    minutes: c.minutes || 3,
    pick: Boolean(c.pick),
    authors: m.authors,
    abstract: m.abstract,
    url: m.url,
    pdf: m.pdf,
  });
}

papers.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));

const MAX = Number(arg('limit', 80));
const kept = papers.slice(0, MAX);

await writeFile(
  path.join(DATA, 'papers.json'),
  JSON.stringify({ count: kept.length, papers: kept }, null, 2) + '\n',
  'utf8',
);
console.log(`✓ data/papers.json：${kept.length} 篇`);
