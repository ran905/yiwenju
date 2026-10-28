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
const REDO = process.argv.includes('--redo');
const LIMIT = Number(arg('limit', 0)) || Infinity;

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
你的读者十五六岁，聪明但没有大学专业课基础。你的任务不是把论文翻译一遍，而是让读者读完 4 分钟，
能向同学复述这篇论文在做什么、为什么有意思，并且不被任何一个名词卡住。

写作要求：
- 用日常中文，像跟人聊天，不用「赋能」「范式」「颠覆」这类营销词。
- 保留关键数字（比如「6.6 倍」「0.7 km/s/Mpc」），但不要堆公式；必须出现的符号要用一句话说明它代表什么。
- 凡是专业名词、英文缩写、学科黑话，第一次出现时就用半句话解释（比如「拓扑绝缘体——内部绝缘、表面却能导电的材料」），
  并且必须收进术语表。术语表要覆盖正文里出现的所有专业名词，6-8 个，按重要性排序。
- 术语解释写成「是什么 + 在这篇论文里起什么作用」，40-70 字，不要只给一句同义替换。
- 多解释一句，也不要让读者卡住；但不要为了凑字数重复。
- 标题要像科普报道的标题：具体、有信息量，不要逐字直译英文标题。
- 不夸大、不编造。论文没说的意义不要替它说；不确定的地方用「可能」。

只输出 JSON，不要 Markdown 代码块，不要解释。`;

const SCHEMA_HINT = `返回格式（严格 JSON）：
{
  "papers": [
    {
      "id": "arXiv id，例如 2610.12345",
      "title_zh": "中文标题，不超过 30 个字，要具体",
      "one_liner": "一句话总结，不超过 80 字，说清做了什么、结论是什么",
      "why": "为什么值得高中生看，90-130 字",
      "bg": "研究背景：这个领域原来卡在哪、为什么难，120-200 字",
      "method": "他们具体怎么做的，把关键手段讲清楚，120-200 字",
      "finding": "发现了什么，带上关键数字和对比，140-220 字",
      "impact": "为什么重要、可能带来什么变化，100-160 字",
      "analogy": "一个生活化的比喻，70-110 字，必须贴切",
      "terms": [{ "t": "术语名", "d": "是什么 + 在论文里的作用，40-70 字" }],
      "tags": ["标签1", "标签2", "标签3"],
      "difficulty": 1,
      "minutes": 3,
      "pick": false
    }
  ]
}
difficulty：1 = 初中生能懂，2 = 需要一点耐心，3 = 有硬核概念但能讲明白。
minutes：认真读完这篇导览需要的分钟数，3-6。
pick：这一批里最推荐的一篇设为 true，其余 false。
terms：6-8 个，覆盖正文出现的所有专业名词，不能漏。`;

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
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    // 模型偶尔会返回不合法 JSON（多一个逗号、引号没转义），重试一次
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return callLLM(messages, attempt + 1, jsonMode);
    }
    throw new Error(`模型返回的 JSON 不合法：${err.message}`);
  }
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

function toCuration(p, fieldId) {
  return {
    title_zh: p.title_zh,
    one_liner: p.one_liner,
    why: p.why,
    bg: p.bg,
    method: p.method,
    finding: p.finding,
    impact: p.impact,
    analogy: p.analogy,
    terms: (p.terms || []).slice(0, 8).map((t) => ({ t: t.t, d: t.d })),
    tags: (p.tags || []).slice(0, 4),
    difficulty: Math.min(3, Math.max(1, Number(p.difficulty) || 2)),
    minutes: Math.min(6, Math.max(2, Number(p.minutes) || 4)),
    pick: Boolean(p.pick),
    field: fieldId,
    model: MODEL,
    generated_at: new Date().toISOString(),
  };
}

/** --redo：用新提示词重写已收录的文章（按 id 逐篇调用） */
async function redoAll(fields, curation) {
  const meta = JSON.parse(await readFile(path.join(DATA, 'meta.json'), 'utf8'));
  const ids = Object.keys(curation).slice(0, LIMIT);
  let done = 0;

  for (const id of ids) {
    const old = curation[id];
    const m = meta[id];
    if (!m) continue;
    const field = fields.find((f) => f.id === old.field) || { name: old.field, blurb: '' };

    process.stdout.write(`· ${id} … `);
    try {
      const result = await callLLM([
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `领域：${field.name}（${field.blurb}）

这是本站已经收录的一篇论文。请按上面的新要求重写导读。

必须保留原来的：
- 标题：${old.title_zh}
- 一句话总结：${old.one_liner}
- 比喻：${old.analogy}

要做的是：
1. 把四段正文（bg / method / finding / impact）扩写得更详细，补充「为什么难」「具体怎么验证」这类细节；
2. 把术语表补到 6-8 个，覆盖正文里出现的每一个专业名词；
3. 标题、一句话、比喻只在明显有错时才微调，不要换风格。

id: ${id}
标题: ${m.title}
摘要: ${truncate(m.abstract, 3000)}

${SCHEMA_HINT}`,
        },
      ]);

      const list = result.papers || [];
      const p = list.find((x) => x.id === id) || list[0];
      if (!p || VALID.some((k) => !p[k])) {
        console.log('返回不完整，跳过');
        continue;
      }
      curation[id] = { ...old, ...toCuration(p, old.field), pick: Boolean(old.pick) };
      done++;
      console.log(`✓ ${p.title_zh}（${curation[id].terms.length} 个术语）`);
      // 每篇落盘一次，中途断了也不丢进度
      await writeFile(path.join(DATA, 'curation.json'), JSON.stringify(curation, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.log(`失败：${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  await writeFile(path.join(DATA, 'curation.json'), JSON.stringify(curation, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 重写完成：${done}/${ids.length} 篇`);
  console.log('  下一步：node scripts/compose.mjs');
}

async function main() {
  const fields = JSON.parse(await readFile(path.join(DATA, 'fields.json'), 'utf8'));
  const curation = JSON.parse(await readFile(path.join(DATA, 'curation.json'), 'utf8'));
  const rawFiles = (await readdir(path.join(DATA, 'raw'))).filter((f) => f.endsWith('.json'));

  if (REDO) {
    await redoAll(fields, curation);
    return;
  }

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
      curation[p.id] = toCuration(p, field.id);
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
