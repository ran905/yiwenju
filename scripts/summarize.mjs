#!/usr/bin/env node
/**
 * 让大模型从候选论文里挑几篇，并写成高中生能读懂的中文导览。
 * 结果追加到 data/curation.json，之后由 compose.mjs 合成 papers.json。
 *
 * 用法：
 *   LLM_API_KEY=sk-xxx node scripts/summarize.mjs
 *   LLM_API_KEY=sk-xxx node scripts/summarize.mjs --per-field 2 --candidates 8
 *
 * 环境变量：
 *   LLM_API_KEY   必填（也接受 DEEPSEEK_API_KEY）
 *   LLM_BASE_URL  默认 https://api.deepseek.com（任何 OpenAI 兼容接口都行）
 *   LLM_MODEL     默认 deepseek-chat
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');

const API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const PER_FIELD = Number(arg('per-field', 3));
const CANDIDATES = Number(arg('candidates', 10));
const ONLY = arg('field', null);

if (!API_KEY) {
  console.log(
    '\n没有配置 LLM_API_KEY，跳过改写。\n' +
      '（定时任务里这是正常情况：只更新抓取结果，不生成新文章。）\n\n' +
      '  本地手动跑：\n' +
      '    PowerShell:  $env:LLM_API_KEY="sk-..."; node scripts/summarize.mjs\n' +
      '    bash:        LLM_API_KEY=sk-... node scripts/summarize.mjs\n',
  );
  process.exit(0);
}

const SYSTEM = `你是一个给中国高中生写科研导读的编辑。
你的读者十五六岁，聪明但没有大学专业课基础。你的任务不是把论文翻译一遍，而是让读者在 3 分钟内知道：
这篇论文问了什么问题、用了什么办法、发现了什么、为什么值得在意。

写作要求：
- 用日常中文，像跟人聊天，不用「赋能」「范式」「颠覆」这类营销词。
- 保留关键数字（比如「6.6 倍」「0.7 km/s/Mpc」），但不要堆公式；必须出现的符号可以保留。
- 术语第一次出现时，用一个生活化的比喻解释清楚。
- 不夸大、不编造。论文没说的意义不要替它说；不确定的地方用「可能」。
- 如果论文过于专业、不适合高中生，就不要选它。

只输出 JSON，不要 Markdown 代码块，不要解释。`;

const SCHEMA_HINT = `返回格式（严格 JSON）：
{
  "papers": [
    {
      "id": "arXiv id，例如 2610.12345",
      "title_zh": "中文标题，不超过 30 个字，要具体",
      "one_liner": "一句话总结，不超过 70 字，说清做了什么、结论是什么",
      "why": "为什么值得高中生看，70-110 字",
      "bg": "研究背景：这个领域原来卡在哪，80-150 字",
      "method": "他们具体怎么做的，80-150 字",
      "finding": "发现了什么，带上关键数字，90-180 字",
      "impact": "为什么重要、可能带来什么变化，60-110 字",
      "analogy": "一个生活化的比喻，60-100 字，必须贴切",
      "terms": [{ "t": "术语名", "d": "一句话解释，40 字以内" }],
      "tags": ["标签1", "标签2", "标签3"],
      "difficulty": 1,
      "minutes": 3,
      "pick": false
    }
  ]
}
difficulty：1 = 初中生能懂，2 = 需要一点耐心，3 = 有硬核概念但能讲明白。
minutes：认真读完这篇导览需要的分钟数，2-5。
pick：这一批里最推荐的一篇设为 true，其余 false。`;

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function callLLM(messages, attempt = 1, jsonMode = true) {
  const payload = {
    model: MODEL,
    messages,
    temperature: 0.6,
  };
  if (jsonMode) payload.response_format = { type: 'json_object' };

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 有些 OpenAI 兼容网关不支持 response_format，退回普通模式再试一次
    if (jsonMode && res.status === 400 && /response_format|json_object/i.test(body)) {
      return callLLM(messages, attempt, false);
    }
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return callLLM(messages, attempt + 1, jsonMode);
    }
    throw new Error(`LLM HTTP ${res.status}: ${truncate(body, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildPrompt(field, candidates) {
  const list = candidates
    .map(
      (p, i) =>
        `[${i + 1}] id: ${p.id}\n标题: ${p.title}\n分类: ${(p.categories || []).join(', ')}\n摘要: ${truncate(p.abstract, 1500)}`,
    )
    .join('\n\n');

  return `领域：${field.name}（${field.blurb}）

下面是最近几天的候选论文，共 ${candidates.length} 篇。请挑出最多 ${PER_FIELD} 篇最适合高中生读的，按上面的要求写成中文导览。
挑选标准：问题具体、结论清楚、能和日常生活或课本知识建立联系。宁可少选，也不要硬凑。

${list}

${SCHEMA_HINT}`;
}

const VALID = ['title_zh', 'one_liner', 'why', 'bg', 'method', 'finding', 'impact', 'analogy'];

async function main() {
  const fields = JSON.parse(await readFile(path.join(DATA, 'fields.json'), 'utf8'));
  const curation = JSON.parse(await readFile(path.join(DATA, 'curation.json'), 'utf8'));
  const rawFiles = (await readdir(path.join(DATA, 'raw'))).filter((f) => f.endsWith('.json'));

  let added = 0;

  for (const field of fields) {
    if (ONLY && field.id !== ONLY) continue;
    const file = `${field.id}.json`;
    if (!rawFiles.includes(file)) {
      console.log(`· ${field.name}：没有候选数据，跳过`);
      continue;
    }

    const raw = JSON.parse(await readFile(path.join(DATA, 'raw', file), 'utf8'));
    const candidates = raw
      .filter((p) => !curation[p.id])
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, CANDIDATES);

    if (!candidates.length) {
      console.log(`· ${field.name}：没有新论文`);
      continue;
    }

    process.stdout.write(`· ${field.name}：${candidates.length} 篇候选，请求模型… `);
    let result;
    try {
      result = await callLLM([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildPrompt(field, candidates) },
      ]);
    } catch (err) {
      console.log(`失败：${err.message}`);
      continue;
    }

    const picked = (result.papers || []).filter((p) => candidates.some((c) => c.id === p.id));
    for (const p of picked) {
      if (VALID.some((k) => !p[k])) {
        console.log(`\n  ! ${p.id} 字段不全，跳过`);
        continue;
      }
      curation[p.id] = {
        title_zh: p.title_zh,
        one_liner: p.one_liner,
        why: p.why,
        bg: p.bg,
        method: p.method,
        finding: p.finding,
        impact: p.impact,
        analogy: p.analogy,
        terms: (p.terms || []).slice(0, 3).map((t) => ({ t: t.t, d: t.d })),
        tags: (p.tags || []).slice(0, 4),
        difficulty: Math.min(3, Math.max(1, Number(p.difficulty) || 2)),
        minutes: Math.min(5, Math.max(2, Number(p.minutes) || 3)),
        pick: Boolean(p.pick),
        field: field.id,
        model: MODEL,
        generated_at: new Date().toISOString(),
      };
      added++;
    }
    console.log(`入选 ${picked.length} 篇`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!added) {
    console.log('\n没有新增内容。');
    return;
  }

  await writeFile(path.join(DATA, 'curation.json'), JSON.stringify(curation, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 新增 ${added} 篇到 data/curation.json`);
  console.log('  下一步：node scripts/compose.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
