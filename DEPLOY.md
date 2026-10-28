# 部署指南

> **本项目当前正在用 `yiwenju.asia` 上线**，域名专属的步骤（实名认证、改 NS、绑定域名）见
> **[docs/GO-LIVE-yiwenju.md](docs/GO-LIVE-yiwenju.md)**。下面是通用的部署说明。

站点是**纯静态**的：一堆 HTML / CSS / JS / JSON，没有数据库、没有后端。
所以「上线」= 把这些文件放到一个能公开访问的地方。三种常见做法，按省心程度排序。

| 方案 | 费用 | 需要注册 | 国内访问 | 自定义域名 | 每天自动更新 |
| --- | --- | --- | --- | --- | --- |
| **Cloudflare Pages** | 免费，流量不限 | Cloudflare | 一般（部分地区偏慢） | 支持，SSL 自动 | 支持，接 GitHub 即可 |
| GitHub Pages | 免费 | GitHub | 偏慢但稳定 | 支持 | 支持（仓库里已有 Action） |
| 阿里云 OSS + CDN | 几元/月 | 阿里云 | 最快 | 支持，但**要 ICP 备案** | 要自己写脚本 |

给这个项目，推荐 **Cloudflare Pages**：免费、不用备案、绑定域名最简单、自带 HTTPS。

---

## 一、先准备部署包

在项目目录执行：

```bash
node scripts/build.mjs
```

会生成 `dist/`，里面只有站点需要的文件：

```
dist/
├─ index.html
├─ 404.html
├─ robots.txt
├─ _headers
├─ assets/     # css / js / 图标
└─ data/       # papers.json + fields.json
```

`dist/` 就是最终要上传的东西。仓库根目录也能直接跑，只是会多带脚本和文档。

---

## 二、Cloudflare Pages（推荐）

### 1. 直接上传，5 分钟拿到网址

1. 打开 <https://dash.cloudflare.com>，用邮箱注册 / 登录（免费）
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Upload assets**
3. 项目名填 `frontier-slice`
4. 把 `dist` 文件夹整个拖进去（或拖 `frontier-slice-site.zip` 解压后的内容）
5. **Deploy site**

完成后会得到一个 `https://frontier-slice.pages.dev` 的地址，手机也能直接开。

> 以后内容更新了，重复一次上传即可；想全自动就往下一步走。

### 2. 绑定自己的域名

1. Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入你买的域名，比如 `qianyan.site`
3. 按提示加 DNS 记录：
   - 域名**已经托管在 Cloudflare**：它会自动加好 CNAME，等 1–2 分钟
   - 域名在阿里云 / Namecheap：去那边的 DNS 面板加
     - `www` → CNAME → `frontier-slice.pages.dev`
     - 根域名（`@`）：把 NS 改成 Cloudflare 的两条地址最省事（免费），否则根域名无法加 CNAME
4. HTTPS 证书 Cloudflare 会自动签发，不用管

### 3. 接上 Git，实现每天自动更新

1. 把仓库推到 GitHub（见下一节）
2. Pages → **Create** → **Connect to Git** → 选仓库
3. 构建设置：
   - Framework preset：`None`
   - Build command：**留空**
   - Build output directory：`dist`
4. 仓库里的 `.github/workflows/daily.yml` 每天早上 7 点抓论文、改写、提交；
   Cloudflare 检测到新提交会自动重新部署。

> 注意：Action 需要仓库 Secret `LLM_API_KEY`。没有它会跳过改写，只更新抓取结果。

---

## 三、GitHub Pages（备选）

适合「已经有 GitHub 账号、想少一个平台」的情况。

```bash
cd frontier-slice
git init -b main
git add .
git commit -m "init: 前沿切片"
git remote add origin https://github.com/<你的用户名>/frontier-slice.git
git push -u origin main
```

然后：

1. 仓库 **Settings → Pages**
2. Source 选 **Deploy from a branch**，分支 `main`，目录 `/ (root)`
3. 等 1 分钟，访问 `https://<用户名>.github.io/frontier-slice/`

自定义域名：

1. Settings → Pages → **Custom domain** 填域名，保存
2. DNS 加记录：
   - `www` → CNAME → `<用户名>.github.io`
   - 根域名 → A 记录 → `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`
3. 回 Pages 勾选 **Enforce HTTPS**

站点所有路径都是相对的，放在 `/frontier-slice/` 子路径下也能正常工作。

---

## 四、域名怎么买

| 渠道 | 价格（.com 参考） | 支付 | 说明 |
| --- | --- | --- | --- |
| Cloudflare Registrar | 约 $10/年，按成本价 | 国际信用卡 | 最省事，买完直接用它家 DNS |
| Namecheap | 首年 $6–10 | 信用卡 / PayPal | 经常有优惠 |
| 阿里云 / 腾讯云 | ¥60–90/年 | 支付宝 / 微信 | 要实名认证，续费略贵 |

**关于备案**：只要网站托管在境外（Cloudflare、GitHub），域名就不需要 ICP 备案。
一旦用国内服务器 / OSS / CDN，就必须备案，个人备案免费但要 2–3 周。

**关于国内访问**：`*.pages.dev` 和 `*.github.io` 在国内大部分网络能打开，但高峰期可能慢，
个别校园网会拦。如果主要受众在国内、又很在意速度，最终方案通常是「国内 OSS + CDN + 备案」，
前期先用 Cloudflare 验证内容，完全够用。

选域名的几个建议：

- `.com` 最稳，`.site` / `.org` / `.cn` 也可以
- 短、好念、能拼出来，别用连字符
- 中文名「前沿切片」对应的拼音 `qianyan` 很抢手，可以加后缀如 `qianyanslice.com`

---

## 五、上线前检查

- [ ] 手机 4G 网络能打开（不要只测 Wi-Fi）
- [ ] 点开一篇详情，确认 JSON 能加载、原文链接能跳转
- [ ] 微信里发给自己，看标题和描述是否正常（`index.html` 里已有 og 标签）
- [ ] 把「前沿切片」换成你最终定的名字（`index.html`、`assets/app.js` 里的文案）
- [ ] 确认免责声明还在（页脚和详情页底部）

---

## 六、出问题先看这里

**打开是空白页**
多半是 `data/papers.json` 没上传，或路径不对。按 F12 看 Network，确认 `data/papers.json` 返回 200。

**CSS 没生效**
确认 `assets/style.css` 和 `assets/app.js` 都在 `dist/assets/` 下，且上传的是 `dist` 里的内容，不是整个仓库。

**自定义域名 522 / 521**
DNS 还没生效，或者 CNAME 指错了。等 10 分钟，用 `nslookup 你的域名` 检查。

**每天自动更新没跑**
GitHub 仓库 → Actions，看 `每日更新` 是否失败；最常见原因是没配 `LLM_API_KEY`。
