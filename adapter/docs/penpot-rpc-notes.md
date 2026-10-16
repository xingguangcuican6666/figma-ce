# Penpot RPC 的一手笔记

这个项目里 Penpot 的接入是**逆向 + 对活实例试出来的**,不是照文档写的 —— Penpot 的
`update-file` change schema 没有任何公开文档。这份笔记记录**经验证确实成立**的行为,
以及踩过的坑的确切症状,免得下一个人(或下一次会话)重新踩一遍。

验证环境:自托管 Penpot `2.18`,docker-compose 官方模板。

---

## 1. RPC 基础约定

- 所有命令都在 **`POST /api/rpc/command/<name>`** —— query 类和 mutation 类都是 POST,
  不需要按命令类型区分 GET/POST。
- 带 **`Accept: application/json`** 时,响应是**普通 camelCase JSON**(日期是 ISO-8601
  字符串),而不是 Penpot 原生线格式 Transit+JSON。**请求体也能用普通 JSON**,键为
  camelCase(例如请求里写 `teamId` 而不是 `team-id`)。
- **这条让整个适配器不需要任何 Transit 解码器。** 只有两个例外(见 §4、§5),都是
  请求侧要 Transit,响应侧仍然可以是普通 JSON —— 请求和响应的内容协商是**相互独立**的。
- 认证:`Authorization: Token <access-token>`。

## 2. Bot 账号 + token 可以全 API 化,不用开浏览器

```bash
# 建账号(容器内跑 manage.py)
docker exec <backend-container> python3 manage.py create-profile \
  -n NAME -e EMAIL -p PASSWORD --skip-tutorial --skip-walkthrough

# 用密码换 session cookie
curl -i -X POST http://localhost:9001/api/rpc/command/login-with-password \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}'     # 从 Set-Cookie 取 auth-token

# 用 cookie 铸一个真实的个人 access token
curl -b "auth-token=xxx" -X POST http://localhost:9001/api/rpc/command/create-access-token \
  -H "Content-Type: application/json" -d '{"name":"..."}'
```

之后那个 token 直接用 `Authorization: Token <token>` 即可,不需要额外的 `type` 字段
(只有想用 Penpot 自己的 MCP-bridge token 类型时才要设 `type:"mcp"`,本项目不用)。

## 3. 编程式导入 `.penpot` 文件

`POST /api/rpc/command/import-binfile`,**multipart/form-data**,字段:`name`、
`project-id`、`file`(二进制 `.penpot` zip)。`version` 可省略,会自动识别。

响应是 **`text/event-stream`,无视 `Accept` 头**,逐段推 `event: progress`
(manifest / storage-objects / file / tokens-lib / component / page / relations),
最后 `event: end` 带 `["<新文件 id>"]`。

**含义:整条「Figma → 自托管」导入链可以零浏览器全脚本化。**

## 4. ⚠️ `update-file`(写入路径)的 Transit 陷阱 —— 这个坑花了最多时间

### 症状

一部分写入"看起来成功",随后在**应用阶段**才被拒:

```
500 {"code":"assertion", "hint":"invalid shape found '<id>'",
     "explain":"... value \"flex\" ... expected one of #{:grid :flex}"}
```

### 原因

`update-file` 和别的命令一样**接受普通 JSON**(camelCase 键、UUID 字符串自动转换、
`type` 这类分派值靠各自 schema 自带的 `:decode/json` 钩子自动变成 keyword)。所以
`create_node` / `update_node_properties` / `delete_node` / `move_node` 用普通 JSON
全都正常。

**唯一的例外**是 Penpot 自定义的 `one-of` **枚举** schema(用于 frame 的 `layout`、
`layoutFlexDir`、`layoutJustifyContent`、`layoutAlignItems`,以及别处的 `blendMode`、
`constraintsH/V`、`growType` 等)。它**没有**那个自动转换:普通 JSON 字符串在解析阶段
被放行(字段是宽松的 `::sm/any`),要等到**应用后被 file-schema 校验**才报错。

**所以别以为拿到 2xx、甚至"过了校验"就代表枚举字段真的写对了。**

### 解决(已实现:`src/penpot/transitEncode.ts`)

把**整个** `update-file` 请求体换成 `Content-Type: application/transit+json`
(响应仍可要求普通 JSON):

| 内容 | 编码 |
|---|---|
| 所有键 | kebab-case 且加 `~:` 前缀 |
| UUID 类字段(`id`/`sessionId`/`pageId`/`frameId`/`parentId`/`objectId`/`componentId`/`commentThreadId`) | 值加 `~u` 前缀 |
| **枚举值** | 加 `~:` 前缀 |

**关键发现:枚举值只能在调用点显式包 `kw('flex')`,不能按字段名推断。** 因为同一个
通用的 `{type:'set', attr, val}` 形状,`val` 有时是普通字符串(`attr:'name'`)有时必须是
keyword(`attr:'layout'`) —— 光看线格式无法区分,必须知道该 `attr` 在 Penpot schema 里
的**具体**类型。

注意 `attr` 本身(指出改哪个字段)始终是**普通字符串**,即使整个请求是 Transit ——
它会正常自动转换;不转换的是 `one-of` 枚举**值**。

## 5. `/api/export`(渲染出图)是另一套子系统

`get_screenshot` / `download_assets` 落到 **`POST /api/export`**(注意:不是
`/api/rpc/command/...`),代理给独立的 `penpot-exporter` 微服务,真实跑一个无头浏览器
渲染。它**两条**约定都跟主 RPC 不同:

1. **只认 `Content-Type: application/transit+json`** —— 普通 JSON 静默失败,没有
   camelCase 便利层,必须手写 Transit:

   ```json
   {"~:cmd":"~:export-shapes","~:wait":true,"~:profile-id":"~u<uuid>",
    "~:exports":[{"~:page-id":"~u<uuid>","~:file-id":"~u<uuid>","~:object-id":"~u<uuid>",
                  "~:type":"~:png","~:suffix":"","~:scale":1,"~:name":"..."}]}
   ```

   注意 `:type` 的**值**也是 keyword(`~:png` / `~:svg` / `~:pdf`)。

2. **认证是 session cookie**(`auth-token`,来自 `login-with-password`),**不是**
   `Authorization: Token` 那个 bearer —— bot 的个人 access token 在这里会被**拒绝/忽略**,
   尽管它在别处都好使。

响应(仍是 Transit,无视 `Accept`)是 `{mtype, name, filename, id, uri}`,`uri` 是可下载
的资源链接 —— **那个下载 URL 两种认证都接受**(cookie 或 bearer token)。

**实现含义:适配器必须为这一个端点族额外维护一个 Penpot session cookie**
(登录一次、按需刷新),见 `src/penpot/exportClient.ts`(6 天过期前刷新)。

### 坑:all-zeros 的根对象 id 渲染不出来

`00000000-0000-0000-0000-000000000000`(page 的隐式 root frame)没有真实几何,
拿去渲染会得到一个 `0.01×0.01` 的 SVG,然后 exporter 里 `locator.waitFor` 超时。
**渲染真实的顶层 frame/shape id,并显式拒绝 all-zeros sentinel**,见
`src/tools/getScreenshot.ts`。

## 6. 形状的几何字段是**派生**的,必须一起给

`add-obj` 的 `obj` 光有 `x/y/width/height` 不够,还需要 `selrect`、`points`、
`transform`、`transformInverse` —— 由一个不会自己算的字段集组成,Penpot 不会替你补。
`src/penpot/changes.ts` 的 `makeShapeObject` 负责算(v1 只发单位矩阵,rotation 恒为 0)。

frame/group 还要自带一个(初始为空的)`shapes` 子列表。

## 7. `update-file` 响应的 `revn` 是**更新前**的版本号

不是新的。Penpot 自己的源码注释写着 "we need to preserve the original revn for the
response",服务端在内部应用时才自增。**直接用这个值会永远少 1。**

`PenpotRpcClient.submitChanges` 返回 `revn + 1`;`test/integration/writeMechanics.test.ts`
对这个自增做了精确断言。这只影响面向人的"当前版本 N"文案和审计日志的 `afterRevn`,
从来不影响改动本身。

## 8. Auto-layout 写法(已验证落地)

frame 上设 flex:所有值都要 `kw()` 包:

```
layout: 'flex'                → kw('flex')
layoutFlexDir: 'row'|'column' → kw(...)
layoutGap: {rowGap, columnGap}
layoutPadding: {p1, p2, p3, p4}
layoutJustifyContent / layoutAlignItems
```

`set_auto_layout` 对非 frame 必须**明确拒绝**。回归见
`test/integration/writeMechanics.test.ts`(会读回来断言 `layout`/`layoutFlexDir`/
`layoutGap`/`layoutPadding`/`layoutJustifyContent`/`layoutAlignItems` 都到位)。

## 9. 自托管 Penpot 的首次登录强制问卷

新 bot 账号第一次登录会有**必答的三步问卷**(`main_ui_onboarding_questions`,没有跳过
按钮),会挡住无头浏览器的 UI 自动化。

**没去解决它** —— RPC 层验证本来就比 UI 自动化更快更可靠,这条路绕开了就行。真要压制,
`update-profile-props` 这个 RPC 存在,但具体是哪个 prop 控制这个门,还没定位。

## 10. Penpot 自己的 MCP server 不适用

`penpot-mcp` 容器(compose 里 `enable-mcp` flag)暴露出来的那个官方 MCP,
**架构上硬依赖一个常驻打开且保持活跃的浏览器标签页**(核心工具就是让 LLM 在那个标签页里
对 Penpot Plugin API 执行任意代码,走 WebSocket 桥)。它的文档专门有一节讲"保持标签页
活跃",changelog 里也有一长串"标签页休眠导致 MCP 连不上"的 bug。

**所以适配器直连 RPC,不用它。** compose 里那个容器留着当一个给人类手动用的可选旁路,
零额外成本,但**明确不接入**。

## 11. 最小权限的实际边界

`update-file` 的 `:changes` 数组在**一个数据库事务**里原子提交,带乐观并发检测
(`revn`/`vern` 冲突会被拒绝,不会静默覆盖)。适配器依赖 Penpot 自己的这个事务做原子性,
**不自己造回滚机制**。

---

## 参考:怎么自己验证这些

绕过适配器直接 curl,用来区分 bug 到底在适配器的转译逻辑里,还是在"对 Penpot 行为的
假设"错了:

```bash
curl -X POST http://localhost:9001/api/rpc/command/get-file \
  -H "Authorization: Token <token>" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"id":"<file-id>"}'
```

读 `common/src/app/common/files/changes.cljc` 和
`common/src/app/common/types/shape.cljc` 看 change 词汇表和 shape 字段的确切定义 ——
这两个文件是本项目所有写入 builder 的依据来源。
