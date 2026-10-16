# 运维手册

自托管 Figma 工程 + Figma 形状 MCP 适配器。Penpot 内部机制的第一手资料见 `adapter/docs/penpot-rpc-notes.md`。本文件只讲"怎么运维"。

## 目录结构

```
figma_ce/
  infra/penpot/
    docker-compose.yaml       # 自托管 Penpot(官方模板改的,固定版本、真实 secret key、enable-access-tokens)
    .env                      # PENPOT_VERSION / PENPOT_SECRET_KEY(不进 git)
    secrets/bot-account.env   # bot 账号邮箱/密码/token/各种 id(不进 git,权限 600)
  adapter/
    src/                      # TypeScript MCP 适配器源码
    test/{unit,integration,live}/
    logs/use-figma-audit.jsonl  # use_figma 调用审计日志(不进 git)
    .env                      # 适配器自己的配置(不进 git)
```

## 启动/停止/重启

**Penpot(docker-compose,容器带 `restart: always`,机器重启会自己起来)：**
```bash
cd infra/penpot
docker compose -p penpot -f docker-compose.yaml up -d     # 启动
docker compose -p penpot -f docker-compose.yaml down       # 停止
docker compose -p penpot -f docker-compose.yaml ps          # 查状态
```

**适配器(不会自己起来,会话/机器重启后必须手动拉起)：**
```bash
cd adapter
node --env-file=.env --import tsx src/index.ts &   # 生产/稳定运行推荐这样,不要用 --watch
# 或者开发时想要改了自动重启:
pnpm run dev   # 底层是 node --watch,见下面"已知坑"
```

每次怀疑适配器状态不对,先确认而不是瞎猜:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/healthz   # 200 才算活着
ps aux | grep "src/index.ts" | grep -v grep                              # 应该只有一个进程
```

### 已知坑:`pnpm run dev`(`node --watch`)不完全可信

这个会话里连续踩到三次:(1)改完文件偶尔不触发重启,旧进程继续在跑,排查 bug 时会看到"代码明明改了但行为没变";(2)手滑在旧实例还没退出时又起了一个新的,两个抢同一个端口,报错看着像配置丢了实际是进程冲突;(3)**真实崩溃**——`ERR_IPC_CHANNEL_CLOSED`,在请求处理过程中首次懒加载某个 CommonJS 依赖(`iconv-lite`)时,`--watch` 的父子进程 IPC 通道关闭时机不对,直接把整个进程干挂,这是 `--watch` 模式本身的问题(生产环境 `node dist/index.js` 不会走到这条代码路径)。

**结论**:日常改代码用 `pnpm run dev` 图方便没问题,但只要怀疑结果不对,或者要准备一次重要的验证/演示,**手动 kill 掉所有 `src/index.ts` 进程、用不带 `--watch` 的命令重新起一个干净进程**,不要相信日志里"Restarting / listening"这几行字就代表代码真的生效了。

```bash
pkill -9 -f "src/index.ts"
sleep 1
ps aux | grep "src/index.ts" | grep -v grep   # 确认清空
cd adapter && node --env-file=.env --import tsx src/index.ts &
```

## Token 轮换

**Penpot bot 账号的 access token**(适配器用来调大部分 RPC):
```bash
# 1. 用 bot 的邮箱密码登录拿 session cookie
curl -i -X POST http://localhost:9001/api/rpc/command/login-with-password \
  -H "Content-Type: application/json" \
  -d '{"email":"figma-adapter-bot@local.invalid","password":"<见 secrets/bot-account.env>"}'
# 从响应的 Set-Cookie 里取出 auth-token=xxx

# 2. 用这个 cookie 生成新 token
curl -b "auth-token=xxx" -X POST http://localhost:9001/api/rpc/command/create-access-token \
  -H "Content-Type: application/json" -d '{"name":"figma-shape-adapter-v2"}'

# 3. 把新 token 填进 adapter/.env 的 PENPOT_ACCESS_TOKEN,重启适配器
# 4. 去 Penpot 网页版「Your account -> Access tokens」删掉旧 token
```

**Bot 账号密码**(session cookie 认证用,`/api/export` 渲染接口专用）:
Penpot 网页版「Your account -> Password」改,改完同步更新 `secrets/bot-account.env` 和 `adapter/.env` 里的 `PENPOT_BOT_PASSWORD`。

**适配器自己的 bearer token**(MCP 客户端连适配器用的,不是 Penpot 的东西):
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # 生成新的
# 填进 adapter/.env 的 ADAPTER_READONLY_TOKEN / ADAPTER_READWRITE_TOKEN,重启适配器
# 然后去更新所有连接了这个适配器的 MCP 客户端配置(比如 claude mcp add 里的 -H 参数)
```

**Anthropic 凭证**:本适配器把 LLM 调用收敛成一个可配置的 client(`ANTHROPIC_AUTH_TOKEN` + 可选的 `ANTHROPIC_BASE_URL`,见 `src/tools/useFigma/llmClient.ts`),两种接法都支持:

- **直连**:去 console.anthropic.com 申请一个 key,填到 `adapter/.env` 的 `ANTHROPIC_AUTH_TOKEN`(或 `ANTHROPIC_API_KEY`,后者走 `x-api-key` 头),`ANTHROPIC_BASE_URL` 留空即可。
- **走中转/代理**:如果你本机有别的进程在跑一个 Anthropic 兼容的本地中转,把 `ANTHROPIC_BASE_URL` 指向它。**注意这条依赖的边界**:中转进程不是独立服务,它随那个客户端一起生灭——客户端一退,`use_figma` 就连不上(报错会很明确,不是静默失败),其余只读工具不受影响,因为它们完全不碰 Anthropic。生产环境建议用直连 key,别把写工具压在另一个交互式进程的存活上。

## 查看变更历史

**适配器自己的审计日志**(只记录 `use_figma` 调用,不记录只读工具):
```bash
cat adapter/logs/use-figma-audit.jsonl | python3 -c "
import json,sys
for line in sys.stdin:
    e = json.loads(line)
    print(e['timestamp'], e['outcome'], e['instruction'][:60])
"
```
每条记录包含:指令原文、结果(plan_applied / clarification_requested / error)、提交的 operations、变更前后的 revn、受影响的 node id。

**Penpot 自己的版本快照**(更底层,覆盖所有改动来源,不只是适配器):
```bash
curl -H "Authorization: Token <token>" -H "Content-Type: application/json" -H "Accept: application/json" \
  -X POST http://localhost:9001/api/rpc/command/get-file-snapshots -d '{"fileId":"<file-id>"}'
```
出问题需要回滚,Penpot 网页版「文件 -> History」里能直接恢复到某个快照,比手动调 API 更安全。

## v1 已知范围限制

- `use_figma` 的内部 primitive 只覆盖:创建/改属性/删除/移动节点、设置 auto-layout、新建页面。**不支持**:创建/修改组件定义、创建或改样式库(颜色/字体样式)、旋转(所有新建图形 rotation 恒为 0)、精确的 Figma Variables 对账(Free 版 Figma 本来就拿不到 Variables)。
- 适配器启动时绑定**一个**目标 Penpot 文件(`PENPOT_TARGET_FILE_ID`),不支持多文件/跨项目操作。
- `get_design_context` 返回结构化 JSON,不是 Figma 真实的"生成框架代码"——这是刻意的 v1 简化,把代码生成这一步留给调用方的 AI 自己做。
- `download_assets` 目前只做"重新渲染导出",不支持拉取原始上传图片(Figma 真实工具的"raw source images"能力),因为这个测试文件里没有图片填充可供验证,没敢瞎实现。
