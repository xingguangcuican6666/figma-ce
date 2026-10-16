# 第三方来源说明

本仓库整体以 **GPL-3.0** 授权（见 `LICENSE`），但其中包含源自第三方的部分，
它们各自沿用原有的许可证。列出如下，以便分发时保留正确的署名。

---

## `infra/penpot/docker-compose.yaml`

**来源**：[Penpot](https://penpot.app/) 官方自托管 docker-compose 模板
（<https://help.penpot.app/technical-guide/getting-started/> 提供的版本）。

**上游许可证**：**AGPL-3.0** —— Penpot 是 AGPL-3.0 授权的软件
（<https://github.com/penpot/penpot/blob/develop/LICENSE>）。

**本仓库的改动**（相对上游模板）：固定 `PENPOT_VERSION`、把 `PENPOT_SECRET_KEY`
改为从 `.env` 注入而不是出厂占位符、在 `PENPOT_FLAGS` 里加上 `enable-access-tokens`。
其余结构与上游模板一致。

**合规说明**：AGPL-3.0 与 GPL-3.0 是不同许可证。本文件属于"聚合"关系 —— 它是运行
Penpot（独立程序）的部署配置，不是对 Penpot 源码的修改或衍生。分发本仓库时，此文件
按 AGPL-3.0 的条款对待，其余文件按 GPL-3.0。**本仓库不包含、也不修改 Penpot 自身的
任何源码**，它只通过官方镜像的公开 HTTP API 与之交互。

> 注意：与本仓库 GPL-3.0 文件不同，AGPL-3.0 对**通过网络提供服务**有额外约束。
> 但该约束作用于 Penpot 程序本身，不影响本仓库中作为客户端调用它的适配器代码。

---

## `adapter` 的 npm 依赖

以各自 `package.json` 中声明的许可证为准，不在此逐一罗列。运行时直接依赖：

| 包 | 用途 |
|---|---|
| `@modelcontextprotocol/sdk` | MCP 协议实现 |
| `express` | HTTP 服务 |
| `zod` | schema 校验 |
| `@anthropic-ai/sdk` | `use_figma` 的指令解释器 |

---

## Figma 工具的"形状"

本项目的工具清单按 **Figma Dev Mode MCP Server** 的**公开文档**照搬其接口形状
（工具名、粗粒度划分、`use_figma` 吃自然语言指令的形态）。

这只是**接口层面的兼容**：本仓库不包含、不反编译、也不依赖 Figma 的任何代码或私有
协议，全部行为都是针对自托管 Penpot 的独立实现。Figma 是其各自权利人的商标，
本项目与 Figma, Inc. 无隶属或背书关系。
