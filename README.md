# 你的前世身份档案

一个纯静态的性格测评站点：20 道情境题 → 五维坐标 → 与 18 位历史人物做最近邻匹配。
前端托管在 **GitHub Pages**，后端与数据库走 **Supabase**，两边都有免费额度。

- **不配 Supabase 也能跑**：自动进入「本地模式」，测评、结果、雷达图、分享全都能用，
  分享链接会把结果直接编码进 URL。接上 Supabase 之后才多出短链接、全局统计和反馈收集。
- **没有任何构建步骤**：全是静态文件，改完推上去就生效。
- **没有依赖**：不引 CDN、不引框架，断网也能打开（本地模式下）。

---

## 目录结构

```
past-life-persona/
├── index.html                  单页入口（hash 路由，刷新不会 404）
├── 404.html                    GitHub Pages 的兜底页
├── config.js                   ← 只改这一个文件就能完成部署
├── manifest.webmanifest        可「添加到主屏幕」，像 App 一样打开
├── assets/
│   ├── style.css
│   └── js/
│       ├── data.js             题库 + 18 个原型坐标（由原型文件自动生成，勿手改）
│       ├── engine.js           计分 / 匹配 / 雷达图 / 分享文案（纯逻辑）
│       ├── store.js            数据层：Supabase RPC + 本地降级
│       └── app.js              路由与界面
├── supabase/
│   └── schema.sql              ← 数据库结构，粘贴到 Supabase 的 SQL Editor 执行一次
└── .github/workflows/deploy.yml 自动部署
```

---

## 第一步：部署到 GitHub Pages

### 1. 建仓库

在 GitHub 上新建一个仓库，建议 **Public**（私有仓库用 Pages 需要付费版）。
名字随意，比如 `past-life-persona`。

> 仓库名会影响你的网址：用户名为 `yourname`、仓库名为 `past-life-persona`，
> 那么网址是 `https://yourname.github.io/past-life-persona/`。
> 如果仓库名取成 `yourname.github.io`，网址就是 `https://yourname.github.io/` 根路径。

### 2. 推代码

在 `past-life-persona/` 目录下执行（把地址换成你自己的仓库）：

```bash
git init
git add .
git commit -m "初次提交：前世身份档案"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

### 3. 等 1 分钟

推送后 GitHub 会自动跑 `.github/workflows/deploy.yml`。
去仓库的 **Actions** 标签页能看到进度，绿色的勾出现就说明发布成功。

工作流里带了 `enablement: true`，会**自动把 Pages 打开**并设为「GitHub Actions」来源，
不需要手动进 Settings 点选。如果因为权限原因没有自动开启，手动做一次即可：
**Settings → Pages → Build and deployment → Source 选 "GitHub Actions"**。

网址在 **Settings → Pages** 顶部，形如 `https://yourname.github.io/past-life-persona/`。

到这一步，**网站已经可以随时随地访问了**，只是还没有全局统计。

---

## 第二步：接上 Supabase（可选，但建议做）

接上之后会多出四样东西：短分享链接、首页「已有 N 份档案」、结果页「你和多少人一样」、
以及「准 / 不准」反馈。大概 5 分钟。

### 1. 建项目

去 [supabase.com](https://supabase.com) 注册 → **New project**。
区域选 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，国内访问更快。
数据库密码随便设一个记下来，本流程用不到它。

### 2. 建表

项目建好后，左侧 **SQL Editor → New query**，
把 `supabase/schema.sql` 全文粘进去 → **Run**。

跑完会返回一行结果，列出 4 个函数名（`persona_create`、`persona_feedback`、
`persona_get`、`persona_stats`）。看到了就说明成功。
这段 SQL 可以重复执行，不会报错也不会重复建表。

### 3. 拿密钥

左侧 **Project Settings → API**，复制两个值：

| 界面上叫什么 | 填到 `config.js` 的哪个字段 |
|---|---|
| Project URL | `SUPABASE_URL` |
| `anon` `public` key | `SUPABASE_ANON_KEY` |

打开 `config.js` 填进去：

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  SITE_NAME: "前世身份档案",
  SHOW_STATS: true
};
```

> **anon key 是可以公开的**，它本来就是要随前端下发的。
> 真正的安全边界在数据库那边：`schema.sql` 里给两张表开了 RLS 并且
> **故意一条策略都不建**，匿名角色连一行都读不到；所有读写都必须走那 4 个
> 带校验和限流的数据库函数。所以就算有人把 key 抄走，也只能写一份合法档案，
> 没法拖库、没法改数据、没法删数据。

### 4. 推上去

```bash
git add config.js
git commit -m "接入 Supabase"
git push
```

等 Actions 跑完，刷新网站。首页底部会出现「已有 N 份档案被生成」，
说明后端通了。

---

## 本地预览

站点用相对路径，**双击 `index.html` 就能看**。
但 `file://` 协议下剪贴板接口不可用，「复制」按钮会退化成手动复制提示。

想完整预览（包括剪贴板），起个静态服务：

```bash
# 任选其一
npx serve .
python -m http.server 8080
```

然后打开 `http://localhost:8080`。

---

## 日常怎么改

| 想改什么 | 改哪里 |
|---|---|
| Supabase 地址和密钥 | `config.js` |
| 站点名字 | `config.js` 的 `SITE_NAME` |
| 题目、选项、原型文案与坐标 | `assets/js/data.js` |
| 配色、字号、间距 | `assets/style.css` 顶部的 `:root` 变量 |
| 匹配算法、雷达图、分享文案格式 | `assets/js/engine.js` |
| 页面结构 | `assets/js/app.js` |

改完 `git push`，Actions 会自动重新发布，一般 40 秒内生效。

> `data.js` 是从原型 HTML 自动抽取的。如果你重新生成了原型文件，
> 用同样的方式再抽一次即可；也可以直接手改，结构很直白。

---

## 什么时候需要动原型坐标

这是这套设计里**唯一需要持续维护**的地方。

进站点的 `#/stats` 页看「原型分布」。规则很简单：

- 某个原型长期占比 **超过 25%** → 它的坐标离大多数人的重心太近，往后调
- 某个原型占比 **长期低于 1%** → 它太偏了，往中间收一点
- 调坐标**不动算法**，只改 `data.js` 里 `archetypes[].vec` 那 5 个数字

调完可以用 Supabase SQL Editor 里的这句复核：

```sql
select archetype, count(*) as n,
       round(count(*) * 100.0 / sum(count(*)) over (), 1) as pct
  from public.personas
 group by archetype
 order by n desc;
```

看每日趋势：

```sql
select date_trunc('day', created_at) as d, count(*)
  from public.personas
 where created_at > now() - interval '7 days'
 group by d order by d;
```

---

## 分享链接是怎么工作的

结果页有两个复制按钮，对应两种链接：

- **接了 Supabase**：`https://你的域名/#/r/a3f9c21b0e4d`
  库里存一条匿名记录，只带原型和坐标，不含任何个人信息。
- **没接 Supabase（本地模式）**：`https://你的域名/#/d/守护者/30.46.20.38.88`
  结果直接编在链接里，不依赖任何后端，永远不会失效。

两种链接打开后看到的内容**完全一样**，因为展示用的文案是从 `data.js` 现场还原的，
链接里只带「哪一型 + 五维坐标」这几个数。

---

## 常见问题

**打开是 404，或者样式全丢**
仓库名和路径大小写要对上（Linux 跑构建，大小写敏感）。
`assets/` 目录名是小写，别改成 `Assets`。

**Actions 里报 `Get Pages site failed`**
说明 Pages 没自动开起来。去 **Settings → Pages**，
把 Source 手动设成 **GitHub Actions**，再重跑一次工作流。

**首页没有「已有 N 份档案」这一行**
两种情况：`config.js` 里两个字段还空着（本地模式，属正常）；
或者填了但值不对。打开浏览器控制台看有没有报错，
再去 Supabase 的 **Project Settings → API** 核对一遍 URL 有没有多余的空格或结尾斜杠。

**结果页显示「档案编号」但统计一直是 0**
`persona_stats` 函数没建成功。重跑一遍 `supabase/schema.sql`。

**想绑自己的域名**
仓库 **Settings → Pages → Custom domain** 填域名，
然后在你的 DNS 服务商加一条 CNAME 指向 `你的用户名.github.io`。
HTTPS 会在证书签发后自动生效（一般几分钟到半小时）。
绑了自定义域名后，**分享链接会自动跟着变成新域名**，不需要改代码。

**结果分布太集中，某个原型老是出现**
看上面「什么时候需要动原型坐标」那一节。

---

## 隐私与合规

- 数据库里**不存**任何可以定位到人的信息：没有昵称、没有手机号、
  没有 IP、没有原始 UA。浏览器指纹只以 sha256 哈希形式保存，
  且仅用于同源限流去重，不可逆推。
- 站内已标注「本测评为娱乐性质的人格投射，不构成心理诊断或专业建议」。
- 历史人物评价仅涉及性格层面的通用描述，不涉及史实争议与敏感议题。
