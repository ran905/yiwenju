# 自动更新配置（GitHub Actions → Cloudflare Pages）

目标：每天早上自动抓论文、让大模型改写、提交到仓库，并直接部署到已有的 Pages 项目。
配好之后你什么都不用管，也不需要动 Cloudflare 的构建设置。

```
GitHub Action（每天北京时间 07:00）
   ├─ fetch.mjs       抓 arXiv
   ├─ summarize.mjs   调模型写中文（LLM_API_KEY）
   ├─ compose.mjs     合成 data/papers.json
   ├─ build.mjs       生成 dist/
   ├─ wrangler pages deploy  →  https://yiwenju.asia
   └─ git commit + push（保存数据，留痕）
```

---

## 需要配 3 个 GitHub Secret

仓库 → **Settings → Secrets and variables → Actions → New repository secret**

| Name | 值 | 说明 |
| --- | --- | --- |
| `LLM_API_KEY` | `sk-...` | DeepSeek 或任意 OpenAI 兼容 Key |
| `CLOUDFLARE_API_TOKEN` | 见下 | 只给 Pages 编辑权限 |
| `CLOUDFLARE_ACCOUNT_ID` | `08283a898de9af3e4247194841d3e47c` | 就是你的账号 ID |

### 怎么建 Cloudflare API Token

1. Cloudflare 右上角头像 → **My Profile → API Tokens → Create Token**
2. 选 **Create Custom Token**
3. Permissions：
   - **Account** → **Cloudflare Pages** → **Edit**
4. Account Resources：选你的账号
5. Create Token → 复制（只显示一次）

> 不要用 `cfut_` 开头的那个 wrangler 登录 token，它是临时的，几天就过期。专门的 API Token 才适合放 CI。

可选变量（**Variables** 标签）：
- `LLM_BASE_URL`，默认 `https://api.deepseek.com`
- `LLM_MODEL`，默认 `deepseek-chat`

---

## 第一次手动跑

1. 仓库 → **Actions** → 左侧 `每日更新` → **Run workflow** → 绿色按钮
2. 等 2–5 分钟：
   - `筛选并改写` 会打印“入选 N 篇”
   - `部署到 Cloudflare Pages` 会打印 `https://xxxx.yiwenju.pages.dev`
3. 打开 <https://yiwenju.asia> 看有没有新论文

之后每天 07:00 自动跑，不需要你管。

---

## 常见问题

**部署步骤报 401 / Authentication error**
`CLOUDFLARE_API_TOKEN` 权限不对，或账号 ID 填错。重新建一个 Token，确认是 **Cloudflare Pages: Edit**。

**改写步骤报 401 / 402**
模型 Key 无效或余额不足。去对应平台充值，或换一个 Key。

**没有新提交**
正常：当天没有合适的新论文，`compose` 后内容没变，脚本会跳过提交。

**构建失败**
看日志里的中文报错。`build.mjs` 只依赖 Node 18+，一般不会失败。

**想改运行时间**
编辑 `.github/workflows/daily.yml` 的 cron。注意是 **UTC**：`0 23 * * *` = 北京时间次日 07:00。
