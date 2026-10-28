# 自动更新配置（GitHub + Cloudflare Pages）

目标：每天早上自动抓论文、让大模型改写、提交到仓库，Cloudflare 检测到新提交后自动重新发布。
配好之后你什么都不用管。

```
GitHub Action（每天 07:00）
   ├─ fetch.mjs      抓 arXiv
   ├─ summarize.mjs  调模型写中文（需要 LLM_API_KEY）
   ├─ compose.mjs    合成 data/papers.json
   └─ git commit + push
          ↓
Cloudflare Pages 检测到 push
   ├─ npm 不需要装，直接 node scripts/build.mjs
   └─ 发布 dist/ → https://yiwenju.asia
```

---

## 第 1 步：建 GitHub 仓库并推送

在 GitHub 上新建一个 **Public** 仓库，名字建议 `yiwenju`，**不要**勾选 README / .gitignore（保持空仓库）。

然后在项目目录（`frontier-slice`）执行：

```bash
git remote add origin https://github.com/<你的用户名>/yiwenju.git
git push -u origin main
```

第一次 push 会弹浏览器让你登录 GitHub，登录一次即可。

> 如果 `git push` 提示 `src refspec main does not match any`，说明还没有提交，先执行：
> `git add . && git commit -m "init: 前沿切片"`

---

## 第 2 步：让 Cloudflare Pages 从 GitHub 构建

1. Cloudflare 控制台 → **Workers & Pages** → 点项目 `yiwenju`
2. **Settings → Build & deployments → Connect to Git**
3. 选 GitHub → 授权 → 选 `yiwenju` 仓库 → `main` 分支
4. 构建设置：
   - Framework preset：`None`
   - Build command：`node scripts/build.mjs`
   - Build output directory：`dist`
   - Root directory：留空
5. 环境变量（可选，但建议加）：
   - `NODE_VERSION` = `22`
6. 保存，然后点一次 **Retry deployment** 验证

> 连接 Git 后，手动 `wrangler pages deploy` 那一套就不需要了，以后都靠 push 触发。

---

## 第 3 步：配置模型 Key

没有 Key 也能跑：每天只更新抓取结果，不生成新文章（脚本会打印提示然后跳过）。

要生成新内容：

1. GitHub 仓库 → **Settings → Secrets and variables → Actions**
2. **New repository secret**
   - Name：`LLM_API_KEY`
   - Secret：你的 DeepSeek（或任意 OpenAI 兼容）Key
3. 可选变量（**Variables** 标签里加）：
   - `LLM_BASE_URL`，默认 `https://api.deepseek.com`
   - `LLM_MODEL`，默认 `deepseek-chat`

---

## 第 4 步：手动跑一次验证

1. 仓库 → **Actions** → 左侧 `每日更新` → **Run workflow**
2. 等 2–5 分钟，看是否绿勾
3. 绿了之后，仓库会多一个 `chore: 更新 ...` 的提交
4. 回 Cloudflare Pages，应该会自动开始一次新部署
5. 打开 <https://yiwenju.asia>，看是否多了新论文

---

## 常见问题

**Action 失败在“筛选并改写”**
看日志里是不是 401/402：Key 无效或余额不足。Key 正确时这一步会打印“入选 N 篇”。

**Action 成功但没有新提交**
正常：arXiv 当天没有合适的新论文，或者 `compose` 后内容没变化，脚本会跳过提交。

**Cloudflare 没自动部署**
检查 Settings → Builds 里是否真的连上了 Git；或看 Deployments 列表有没有新的 build。

**构建失败：`node: command not found`**
在 Pages 的环境变量里加 `NODE_VERSION=22`，或在仓库根目录放 `.nvmrc`（已经放好了）。

**想改每天跑的时间**
编辑 `.github/workflows/daily.yml` 里的 cron。注意是 **UTC**：`0 23 * * *` = 北京时间次日 07:00。
