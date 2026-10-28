# 上线清单：yiwenju.asia

> **已上线（2026-10-28）**：<https://yiwenju.asia>，Cloudflare Pages 项目 `yiwenju`，
> `www.yiwenju.asia` 和根域名都已 active，证书自动签发。
> 下面是当时的完整过程，留作以后换域名或复盘的参考。

---

## 阶段一：先把网站放上线（不用等域名）

这一段做完，你就有 `https://xxx.pages.dev`，手机能开、能发给同学，跟域名无关。

1. 打开 <https://dash.cloudflare.com>，用邮箱注册（免费，不用信用卡）
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Upload assets**
3. 项目名填 `yiwenju`（或任意，会成为 `yiwenju.pages.dev`）
4. 把项目里的 `dist` 文件夹整个拖进去 → **Deploy site**
5. 打开生成的 `https://yiwenju.pages.dev`，用手机 4G 再开一次

> 之后每次改内容，`node scripts/build.mjs` 重新生成 `dist`，再拖一次即可。

---

## 阶段二：接上 yiwenju.asia（等实名认证通过）

### 0. 先确认域名活了

在域名服务商控制台看到状态是「正常 / 已实名」，并且：

```bash
nslookup yiwenju.asia
```

能返回 NS 记录（不是 NXDOMAIN），才继续。**实名没过就改 NS，服务商通常会拒绝，或者域名处于 serverHold，改了也不解析。**

### 1. 把域名加进 Cloudflare

1. Cloudflare 首页 → **Add a site** → 输入 `yiwenju.asia` → 选 **Free**
2. Cloudflare 会分配两条 NS，形如：
   ```
   ada.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
   把这两条记下来（每家的前缀不一样，以你页面显示的为准）。

### 2. 去域名服务商改 NS

| 服务商 | 路径 |
| --- | --- |
| 阿里云 | 域名控制台 → 域名列表 → 管理 → **DNS 修改** |
| 腾讯云 | 域名注册 → 我的域名 → 管理 → **DNS 服务器** → 修改 |
| 华为云 | 域名注册 → 我的域名 → 管理 → **DNS 服务器** |
| 其他 | 找「Nameservers / DNS 服务器 / 自定义 DNS」 |

把原来的 NS 全部替换成 Cloudflare 给的两条，保存。

### 3. 等 Cloudflare 变成 Active

回到 Cloudflare 的站点页面，点 **Check nameservers**。通常几分钟到几小时，最长 24 小时。
状态变成 **Active** 才说明 NS 生效了。

### 4. 在 Pages 里绑定域名

1. 打开 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 先加 `yiwenju.asia`，按提示确认（Cloudflare 会自动加好 CNAME / ALIAS 记录）
3. 再加 `www.yiwenju.asia`

站点里的 `_redirects` 已经写好：`www` 会自动 301 跳到主域名。

### 5. 等证书

Cloudflare 会为这两个域名自动签发 Universal SSL，一般 15 分钟内。
浏览器出现证书错误时先等一会儿，别急着改 SSL 模式。

---

## 验证清单

- [ ] `https://yiwenju.asia` 返回 200，页面完整
- [ ] `http://yiwenju.asia` 自动跳 https
- [ ] `https://www.yiwenju.asia` 跳到 `https://yiwenju.asia`
- [ ] 手机 4G 网络能打开（别只测 Wi-Fi）
- [ ] 点开一篇详情，原文链接能跳 arXiv
- [ ] 微信里发给自己：标题、描述正常（分享图要等域名生效后才显示）
- [ ] `https://yiwenju.asia/sitemap.xml` 能打开

---

## 常见坑

**改了 NS 但一直 Pending**
先用 `nslookup -type=ns yiwenju.asia` 看返回的是不是 Cloudflare 的 NS。有的注册商要等 24 小时，有的需要手动点「同步」。

**502 / 522 / 523**
这是 Cloudflare 连不到源站，通常是 Pages 项目没部署成功，或者自定义域名没绑上。回 Pages 看部署记录。

**证书报错**
Universal SSL 还没签发，等 15 分钟；仍不行就看 Cloudflare 的 SSL/TLS 页面有没有报「pending validation」。

**国内访问慢**
Cloudflare 免费版在国内的速度一般。先用着，如果确实慢，再考虑国内 OSS + CDN——但那条路要 ICP 备案（个人备案 2–3 周）。

**`.asia` 的特殊要求**
注册局要求注册人在亚太地区（你符合），实名信息要和注册人一致。实名通过后域名才会从 serverHold 变成 ok。

---

## 不想改 NS 的备选（不推荐）

DNS 留在服务商：加一条 `www` → CNAME → `yiwenju.pages.dev`，根域名用服务商的「URL 转发」跳到 `www`。
缺点：国内服务商的 URL 转发经常要求备案，而且 HTTPS 证书只覆盖 `www`，根域名体验割裂。

---

## 我已经按这个域名改好的地方

- `index.html`：canonical、`og:url`、`og:image` 都指向 `https://yiwenju.asia/`
- `sitemap.xml`、`robots.txt`：已写死这个域名
- `_redirects`：`www` → 主域名 301
- `assets/og.png`：微信/微博分享用的 1200×630 封面

如果最后换域名，改这 4 个文件里的字符串再 `node scripts/build.mjs` 即可。
