# 靶心 · 工业 B2B 目标客户精准发现 SaaS

面向工业 B2B（首个品类：**工业阀门**）的对外获客软件。用户只需描述"我要找什么样的客户"，软件从国内外多数据源聚合、去重、精准过滤评分，直接交付**可复制 / 可收藏 / 可点击联系**的目标客户清单。

## 快速体验

直接用浏览器打开 `mvp/index.html`（纯前端，无需后端与安装）。

演示账号（密码统一 `123456`，也可用任意新邮箱直接开通租户）：

| 账号 | 租户 | 默认市场 |
|---|---|---|
| `demo@valve-cn.com` | 浙江精工阀门 · 国内销售团队 | 国内 A |
| `demo@valve-ex.com` | 宁波阀门出口部 · 外贸团队 | 国外 B |

> 两个账号的**收藏 / 常用 ICP / 联系记录互不可见**，用于验证多租户隔离。

## 核心能力（原型已跑通）

1. **说要求** — ICP 表单：市场 / 行业 / 地区（硬过滤）+ 角色 / 认证 / 采购信号（加权）
2. **多源聚合去重** — 10 个可插拔适配器；归一化主体指纹去重、跨源字段互补、多源交叉验证加权
   实测：**107 条原始记录 → 合并为 36 家企业，消除 71 条重复**
3. **精准评分** — `40 + 角色15 + 认证10×n + Σ信号权重 + min((源数-1)×8, 24)`，每条标注命中理由与置信度
4. **直接可用** — 联系方式一键复制、收藏、点击联系（`tel:` / `mailto:` 自动带话术 / LinkedIn）、CSV 导出 19 列
5. **多租户** — 登录即开租户，收藏 / 常用 ICP / 联系记录按 `tenant_id` 隔离

## 文档

| 文件 | 内容 |
|---|---|
| `架构设计.md` | 技术底座：模块化单体 + CQRS + 事件总线 |
| `获客逻辑设计.md` | 国内外主流获客软件逻辑抽象 + A国内/B国外落地方案（本产品的数据源来源与转化 SOP） |
| `对外获客软件产品设计.md` | 本产品设计：闭环、ICP 维度、适配器契约、去重算法、评分引擎、多租户架构、真实 API 接入清单 |

## 运行后端（真实多租户 SaaS 骨架，零依赖）

前端已改为「后端优先、本地回退」：有后端时收藏 / 常用 ICP / 联系记录按 `tenant_id` 行级隔离存服务端；后端不可用时自动回退浏览器本地（演示）。

```bash
# 需要 Node 18+（无需 npm install，零外部依赖）
node server/index.js            # 默认端口 8787，可用 PORT=xxxx 覆盖
# 浏览器打开 http://localhost:8787
```

- `server/engine.js` — 精准引擎（多源聚合去重 + ICP 评分），纯函数；`setLiveRaw()` 注入真实数据
- `server/store.js` — JSON 存储层，所有读写按 `tenant_id` 过滤（生产替换为 SQLite/Postgres，接口不变）
- `server/jwt.js` — 极简 HS256 JWT（内置 crypto，无依赖）
- `server/index.js` — 路由：注册/登录、`/api/leads`（公开，带 live 实时源状态）、收藏/ICP/联系（受保护）、`/api/refresh-sources`（热刷新）
- `server/sources/` — **真实数据源适配器**：`qcc.js`（企查查）、`hunter.js`（Hunter 海外公司+邮箱）、`customs.js`（海关进口数据）、`tender.js`（招投标公告·国内免费带电话）、`index.js`（编排器，读 env 开关）、`http.js`（带超时 HTTP）
- `server/test_api.js` — 端到端测试：`node server/test_api.js`（需先启动服务），验证注册→登录→收藏→**跨租户隔离**→401 拦截，当前 19/19 通过
- `server/test_sources.js` — 数据源接入验证：`node server/test_sources.js`，单测（QCC 签名 / 打标 / Hunter 映射 / 海关 HS 查询）+ **实测 Hunter 公开测试 key 真打 API + 海关演示样本真跑引擎评分**，当前 24/24 通过

> 演示账号在后端启动时自动 seed；`server/data.json` 为运行时数据（已 gitignore）。

## 接入真实数据源（v4 已落地）

不填任何 key 时引擎自动回退到内置演示数据（36 家样本投影）。给 key 即启用真实源、默认开启并参与聚合：

```bash
cp server/.env.example server/.env      # 编辑填入 key（.env 已 gitignore，不会入库）
# 示例：用 Hunter 公开测试 key 零成本验证整条链路（返回示例数据，不耗额度）
echo 'HUNTER_API_KEY=test-api-key' > server/.env
node server/index.js                     # 启动即拉取实时源并注入引擎
# 浏览器打开 http://localhost:8787 → 国外市场即可看到实时客户（带邮箱）
```

| 源 | 适配器 | 状态 | 说明 |
|---|---|---|---|
| 企查查（国内工商） | `server/sources/qcc.js` | 已实现（待填 key） | `FuzzySearch` + MD5 签名；返回公司名/法人/信用代码/地区，联系方式需白名单，留待 enrich 补全 |
| Hunter（海外公司+邮箱） | `server/sources/hunter.js` | **已实测打通** | `v2/discover` 按行业/国家搜公司 + `v2/domain-search` 补全邮箱；填 `test-api-key` 即跑通 |
| 海关进口数据（阀门外贸最强信号） | `server/sources/customs.js` | **已实现（演示态默认生效）** | 腾道 API（Bearer/OAuth2）+ 阀门 HS 8481；无 key 跑内置进口商样本，填 `CUSTOMS_API_KEY` 即换真实提单 |
| **招投标公告（国内免费·直接带电话）** | `server/sources/tender.js` | **已实现（演示态默认生效）** | 聚合中国政府采购网/公共资源交易中心的公开招标；公告自带采购人+联系人+电话+邮箱。**零成本、且解决企查查 886 不返电话的痛点**；设 `TENDER_LIVE=1` 启用真实聚合（须守 robots/低频） |
| LinkedIn / 国际站 / 全球企业库 | — | 待接（契约见设计文档 8.1） | 复用 `server/sources/` 适配器形态，实现 `fetchRaw→RAW` 即可，引擎/去重/评分/多租户零改动 |

热刷新：`POST /api/refresh-sources`（需登录）重新拉取实时源，无需重启。

## 下一步

按设计文档第 8.1 节的落地顺序（招投标 → 企查查 → 海关 → 邮箱补全 → LinkedIn）继续补齐剩余适配器；替换 `server/store.js` 为真实数据库并加固密码强度 / 限流。

## 合规

企业工商 / 海关 / 招标属公开或授权商业数据；**个人手机号与邮箱必须来自授权源**并符合《个人信息保护法》与 GDPR 的告知同意要求，禁止未授权爬取（尤其 LinkedIn）。
