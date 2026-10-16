# figma-ce

把你的 Figma 工程导出来，放到**自己完全掌控的自托管服务**上跑，同时起一个和 **Figma 官方 Dev Mode MCP Server 形状一致**的 MCP 服务器 —— 这样任何已经配置好对接 "Figma MCP" 的 AI 客户端，只要改一下 URL 和 token，就能无缝转去**读**和**写**这份自托管副本。

后端用 [Penpot](https://penpot.app/)（开源设计工具，自托管）。适配器不依赖 Figma，运行时零 Figma 调用。

## 为什么不直接用 Figma 的 MCP

官方 Dev Mode MCP Server 的能力上限和账号套餐绑得很死：

- **免费 / Starter 套餐拿不到 Variables / 设计 token 的 REST 接口**（Enterprise 专属）。
- 远程 MCP server **每月只有 6 次调用**。
- 它是**只读**为主，写入侧只有 `use_figma` 一个工具且仅远程可用。

这个项目的目标不是替代 Figma，而是**在你自己控制的基础设施上拿到可读写、可审计、不限额的等价能力**。

## 架构

```
AI 客户端 (Claude Code / Claude Desktop / 任何 MCP 客户端)
      │  MCP over Streamable HTTP + Bearer Token(每条请求都校验)
      ▼
┌──────────────────────────────────────────┐
│  figma-ce adapter (本仓库 adapter/)        │
│  读工具 → 直接转译成 Penpot RPC 读取         │
│  use_figma → LLM 把自然语言指令翻译成内部     │
│      primitive 操作,整体校验后打包成一次      │
│      原子 update-file 提交                 │
└───────────────┬──────────────────────────┘
                │ bot 账号的 access token(最小权限)
                ▼
┌──────────────────────────────────────────┐
│  自托管 Penpot (infra/penpot/)             │
└───────────────▲──────────────────────────┘
                │ 一次性导出(Penpot Exporter 插件)
           Figma 工程
```

**为什么直连 RPC、不用 Penpot 自己的 MCP**：Penpot 官方 MCP（compose 里 `enable-mcp` 那个）架构上硬依赖一个常驻打开、保持活跃的浏览器标签页。详见 [`adapter/docs/penpot-rpc-notes.md`](adapter/docs/penpot-rpc-notes.md) §10。

## 工具形状

对外暴露的形状**严格照搬 Figma 真实的（粗粒度）形状** —— 写入侧只有一个吃自然语言的总工具，没有社区那种 `create_rectangle` / `set_fill` 式的细粒度工具集。

| 工具 | 说明 |
|---|---|
| `whoami` | 如实返回"这是自托管后端"，不伪装成真实 Figma 账号 |
| `get_metadata` | 页面/节点大纲，保留 Figma 那种稀疏 XML 字符串格式 |
| `get_design_context` | 节点树 + 几何 + fills + 生效的 token |
| `get_variable_defs` | Penpot token sets/themes（**不等价于** Figma Variables，如实返回有什么） |
| `get_screenshot` | 走 exporter 渲染真实 PNG |
| `download_assets` | 多节点导出，沿用 Figma 文档的"单次最多 20 个节点"上限 |
| `use_figma` | **核心写入工具**，见下 |

## `use_figma` 写入路径

```
自然语言指令
   → 拉取当前文件/页面上下文
   → LLM 解释器(强制 tool-call,输出结构化 plan)
   → zod 校验每个 primitive
   → 全部通过才打包成一次 update-file 提交(失败关闭,不留半成品)
   → 自然语言 + node id 回包
```

三个刻意的设计取舍：

1. **内部 primitive 绝不暴露成独立 MCP 工具** —— 这是"严格照搬 Figma 形状"决策的直接推论。primitive 只是解释器 LLM 能引用的操作集。
2. **指令有歧义时提问，不猜。** 解释器输出是带标签的联合类型：`{type:'plan'}` 或 `{type:'clarification_needed', question}`。实测中"add a new frame"（没说放哪）和"the Button / Secondary component"（跨屏有多个）都会正确反问。
3. **不做受限脚本沙箱**（即 Penpot 那种"让 LLM 写代码执行"）。带写权限的任意代码执行，安全面比一个收敛过的 primitive 集合大得多，和最小权限原则冲突。

每次调用都会追加到 JSONL 审计日志（指令原文、结果、提交的 operations、前后 revn、受影响的 node id）。

## 快速开始

**前置**：Node ≥ 22、pnpm、Docker。

```bash
# 1. 起 Penpot
cd infra/penpot
cp .env.example .env      # 填一个真实的 PENPOT_SECRET_KEY,别用出厂占位符
docker compose -p penpot -f docker-compose.yaml up -d

# 2. 配置适配器
cd ../../adapter
cp .env.example .env      # 逐项填,注释里有说明
pnpm install

# 3. 起适配器(不要用 --watch,见 RUNBOOK 的已知坑)
node --env-file=.env --import tsx src/index.ts &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/healthz   # 期望 200
```

接进 MCP 客户端：

```bash
claude mcp add --transport http figma-ce http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer <ADAPTER_READONLY_TOKEN 或 READWRITE_TOKEN>"
```

两种 token scope：**只读** / **读写**。只读 token 调 `use_figma` 会在**碰 LLM 之前**就被拒（有测试专门断言这个顺序）。`use_figma` 需要 `ANTHROPIC_AUTH_TOKEN`；只读工具完全不碰 Anthropic。

## 测试

```bash
cd adapter
pnpm test              # 7 个单元测试,无网络
pnpm test:integration  # 14 个,需要 Penpot + 适配器都活着
pnpm test:live         # 3 个,真实 LLM 调用,会花额度,按需跑
```

## 文档

- [`RUNBOOK.md`](RUNBOOK.md) —— 启停、三种凭证的轮换、审计日志与快照怎么看、已知坑
- [`adapter/docs/penpot-rpc-notes.md`](adapter/docs/penpot-rpc-notes.md) —— **Penpot RPC 逆向的一手笔记**。这个项目的核心知识资产：`update-file` 的 change schema 没有公开文档，全是试出来的，包括那个会让写入"看似成功然后 500"的 Transit 枚举陷阱。

## v1 已知范围限制

- primitive 只覆盖：创建/改属性/删除/移动节点、设 auto-layout、新建页面。**不支持**组件定义、样式库写入、旋转（rotation 恒为 0）、精确的 Figma Variables 对账。
- 一个适配器实例绑定**一个**目标文件，不支持多文件/跨项目。
- `get_design_context` 返回结构化 JSON，不是 Figma 真实的"生成框架代码" —— 刻意简化，代码生成留给调用方的 AI。
- `download_assets` 只做"重新渲染导出"，不支持拉原始上传图片的字节。
- `use_figma` 的解释器需要外部 LLM；只有读工具是完全自足、无外部依赖的。

## 许可证

**GPL-3.0** —— 见 [`LICENSE`](LICENSE)。

```
figma-ce — 在自托管 Penpot 上复刻 Figma MCP 工具形状的适配器
Copyright (C) 2026 xingguangcuican6666

本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
（第 3 版或你选择的任何更高版本）的条款重新分发和/或修改它。

本程序分发的目的是希望它有用，但**不提供任何担保**，
甚至不提供适销性或特定用途适用性的默示担保。
详见 GNU 通用公共许可证。

你应该已经随本程序收到一份 GNU 通用公共许可证的副本。
如果没有，见 <https://www.gnu.org/licenses/>。
```

第三方部分的来源与各自的许可证见 [`NOTICE.md`](NOTICE.md) —— 其中
`infra/penpot/docker-compose.yaml` 源自 Penpot 官方模板，沿用其 **AGPL-3.0**。

## 安全

- 凭证一律不进 git：`infra/penpot/.env`、`infra/penpot/secrets/*.env`、`adapter/.env`、审计日志。仓库里的 `*.env.example` 全是空占位符。
- 用**专门的 bot 账号**，只给目标项目 Editor 权限，不复用人类账号 —— 泄漏了也只影响这一个项目，且 Penpot 的变更历史会清楚标出"这是 AI 改的"而非冒充人改的。
- 默认绑定 `127.0.0.1`。对外暴露请自行加 TLS 或置于内网/VPN 之后 —— bearer token 跑在明文公网 HTTP 上本身就是凭证泄漏风险。
