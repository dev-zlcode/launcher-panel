# AI 操作指南 · launcher-panel

给**替这台机器上的 launcher-panel 干活的 AI** 看的：怎么加/改/删各类条目、怎么调设置、接口字段叫什么、哪些值合法、错了会返回什么文案。
人怎么用它写在 `README.md`，这里只写机器怎么改它——两份口径不一致时，**以 `server/api.mjs` 为准，并请把这一页改掉**。

## 0. 前置事实

- 面板是**本机 Web 服务**，只绑 `127.0.0.1`，不对外网开放，**没有任何鉴权**。
- 地址下文中记作 `BASE`：`npm run dev` 是 `http://127.0.0.1:5178`（`strictPort`，端口被占就直接失败）；`npm start` 是同一批 `/api/*`，默认也是 5178，可用 `PORT=5180` 覆盖。**动手前先确认你要连的是哪一个。**
- 一切配置只有一个落点：`data/items.json`（外加 `data/icons/`、`data/runs/` 两个派生缓存目录）。`data/` 整个 git-ignore，里面是**这个人的真实路径和条目**。
- 所有请求/响应都是 JSON。带 body 的方法要带 `-H 'content-type: application/json'`；body 不是合法 JSON 会 400 `invalid JSON body`。
- 出错时返回 `{ "error": "中文或英文文案" }` + 对应状态码（400/404/409/500）。

## 1. 铁律（违反会直接坏事）

1. **只用 HTTP 接口，永不手改 `data/items.json`。** 服务进程在内存里持有整表，你写到磁盘的内容会在它下一次保存时被整体覆盖掉；而且手写极易漏字段——漏掉条目的 `openWith` 会让**构建后的面板白屏**（React 直接卸载，console 不报错），这个坑踩过。
2. **未经明确许可，不要对他的 dev server（5178）发任何写请求，也不要 kill 它。** 那上面跑的是真实配置。要试请求就在 `/tmp` 起一份沙箱（见 §6）。只读的 `GET /api/state` 可以直接打。
3. **改前先读。** 每次用 `GET /api/state` 拿现状（条目 id、当前 `settings`、`appsExist`），不要凭上文记忆或猜测拼 payload。
4. **`POST /api/items` 时不要自己塞 `openWith`**：新建的条目会**自动**按该类型的清单种一份模板。要改候选，事后走 `PATCH /api/items/:id`。
5. **两个 PATCH 语义相反**，别混：`PATCH /api/settings` 是**按字段/按页合并**（只传 `view.panel.layout` 不会碰到 `group`，也不会碰到 `manage`）；`PATCH /api/library` 是**整表替换**（你没列出的应用等于被从分组里拿掉）。
6. **「移除」不碰磁盘。** `DELETE /api/items/:id` 只删面板里那条记录。永远不要为了"清理"去 `rm`、`mv` 他机器上的文件或 `.app`。
7. **不要把 `data/` 的内容贴进对话、日志或提交。** 需要示例时用假路径（`/Applications/Example.app`、`~/Documents/example`）。
8. **说"做好"之前自己验一遍**：把 `GET /api/state` 读回来对照你声称改掉的字段。不通过就直说不通过。
9. **不"顺手改进"**：不加接口、不加字段、不加缓存/分页/鉴权/迁移脚本，不改既有字段名和文案。这个项目的口径是**能少一处就少一处**——配置都塞进 `items.json`，不为小配置开新接口，不用 localStorage。

## 2. 六类条目

`kind` 只有这六个值：`app` / `folder` / `file` / `url` / `snippet` / `command`。

| kind | `value` 填什么 | 单击做什么 | 能配打开方式 | 要注意 |
| --- | --- | --- | --- | --- |
| `app` | `.app` **绝对路径**（`~` 会展开） | 启动该应用 | 否 | 名称留空取路径 basename |
| `folder` | 目录绝对路径 | 用「有效清单」里第一个还活着的应用打开 | **是** | |
| `file` | 文件绝对路径 | 同上 | **是** | |
| `url` | `http`/`https` 链接 | 交给浏览器（或该类型清单里的应用） | **是** | 其他协议 400 `只允许 http/https` |
| `snippet` | 任意文本 | 写进剪贴板（`pbcopy`） | 否 | `/api/open` 对它是 no-op，返回 `{ok:true,note:'snippet 走复制'}` |
| `command` | 可以**多行**的 shell | 后台 `zsh -i -c`，输出进 `data/runs/<id>.log` | 否 | `/api/open` 会 400 `命令条目要用「运行」`，必须走 `/api/run` |

**条目字段**（`GET /api/state` 的 `items[]` 每一项）：

| 字段 | 类型 | 谁能写 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 服务端 | 新建时是 UUID；**不接受客户端传入**。改 `id` 请删了重建 |
| `kind` | 上表六值 | 你 | **传非法值不报错，会被静默改成 `file`**——所以拼错 `command` 会得到一个 file 条目 |
| `name` | string | 你 | 留空则推断：`url`→整个链接，`command`→第一个 token，其余→路径 basename |
| `nameEn` | string? | 你 | 中文名旁边的英文名，只为搜索。和 `name` 相同则不存 |
| `value` | string | 你 | 必填。`app`/`folder`/`file` 会被 `path.resolve` 成绝对路径，其余原样存 |
| `iconPath` | string\|null | 服务端 | 派生：有本地路径的三类＝`value`，其余＝`null`。**不要发这个字段** |
| `group` | string | 你 | 默认 `默认`。**传空串＝落回 `默认`，不是"保持原值"** |
| `tags` | string[] | 你 | 去重后**最多 24 个**。传 `[]` 是真的清空。没有独立标签池，侧栏标签轴是从条目反推的 |
| `pinned` | boolean | 你 | 只有真布尔值会覆盖，其他值＝保持原值 |
| `note` | string | 你 | **最长 2000 字**，超出静默截断 |
| `openWith` | string[] | 你 | 该条目自己的候选，**最多 12 项**，每一项必须以 `.app` 结尾（否则 400 `候选应用必须指向 .app`）。语义见 §4 |
| `useCount` / `lastUsedAt` | number / string\|null | 服务端 | 由打开/运行/`POST /api/items/:id/use` 记账 |
| `createdAt` / `updatedAt` | ISO string | 服务端 | 只读 |

## 3. 逐个动作的配方

### 3.1 读现状

```bash
curl -s $BASE/api/state | jq '{n:(.items|length), groups, settings}'
```

返回 `{ items, tags, settings, appsExist, groups }`：

- `settings` = `{ theme, openByKind, terminals, defaultTerminals, discoverDirs, defaultDiscoverDirs, view }`。
- **`appsExist` 是唯一可信的"这个应用还在不在"来源**（服务端对每个被引用的 `.app` 路径 `existsSync`）。**没出现在 map 里的路径按"已安装"处理。** 别拿 `/api/apps` 的扫描列表去判断未安装——那个列表只覆盖 `discoverDirs` 底下扫得到的。
- `groups` = 条目上出现过的分组名，去重排序。

### 3.2 新增条目 `POST /api/items` → `{ item }`

```bash
# 应用
curl -s -X POST $BASE/api/items -H 'content-type: application/json' \
  -d '{"kind":"app","value":"/Applications/Example.app","group":"效率","tags":["work"],"pinned":true}'

# 文件夹
curl -s -X POST $BASE/api/items -H 'content-type: application/json' \
  -d '{"kind":"folder","value":"~/Documents/example","note":"周报目录"}'

# 链接
curl -s -X POST $BASE/api/items -H 'content-type: application/json' \
  -d '{"kind":"url","name":"Example CI","value":"https://example.com/","tags":["ci"]}'

# 文本片段
curl -s -X POST $BASE/api/items -H 'content-type: application/json' \
  -d '{"kind":"snippet","name":"收件人","value":"someone@example.com"}'

# 命令（可以多行；\\n 就是换行）
curl -s -X POST $BASE/api/items -H 'content-type: application/json' \
  -d '{"kind":"command","name":"整理下载","value":"cd ~/Downloads\nls -1 | head"}'
```

- `value` 空 → **400 `value is required`**。
- 同一 `kind + value` 已存在 → **409 `该项已存在`**（比较的是解析后的绝对路径，所以 `~/x` 和 `/Users/…/x` 算同一个）。
- 新建时若你没给 `openWith`，会**自动**复制该类型的 `openByKind[kind]`（`app`/`snippet`/`command` 没有这个清单，就是空）。

### 3.3 改条目 `PATCH /api/items/{id}` → `{ item }`

只发你要改的字段。`kind`、`value` 也允许改（改完仍会做重复检查吗？**不会**——PATCH 不查重，别把两条改成同一个）。找不到 id → 404 `not found`。

```bash
# 换候选（整份替换，顺序就是优先级；[] 表示清空＝改回跟随类型清单）
curl -s -X PATCH $BASE/api/items/$ID -H 'content-type: application/json' \
  -d '{"openWith":["/Applications/Visual Studio Code.app","/Applications/Example.app"]}'

# 取消置顶 + 换分组
curl -s -X PATCH $BASE/api/items/$ID -H 'content-type: application/json' \
  -d '{"pinned":false,"group":"归档"}'
```

**PATCH 永远不会给你套类型模板**（只有 POST 会）。想让某个条目不再跟随设置页的类型清单，就得显式写它的 `openWith`。

### 3.4 删条目 `DELETE /api/items/{id}` → `{ ok: true }`

只删记录，不碰磁盘。找不到 → 404 `not found`。

### 3.5 打开 / 运行 / 看输出

| 动作 | 请求 | 关键点 |
| --- | --- | --- |
| 打开 | `POST /api/open` `{kind,value,app?}` | `app` 是**这次**用哪个应用，必须 `.app` 且真实存在；路径不存在 → 404 `路径不存在: <path>` |
| 后台运行命令 | `POST /api/run` `{id}` | **只认 id，不接受命令文本**。立即返回 `{ok,started,command,log}`；同 id 还在跑 → 409 `这条命令正在运行中` |
| 交给终端运行 | `POST /api/run` `{id,app}` | 写 `data/runs/<id>.command`（`chmod 755`）后 `open -a` 它；窗口/输出归终端 |
| 看输出 | `GET /api/runs/{id}` | `{running,startedAt,code,command,text,droppedBytes}`；`text` 是日志尾 64KB 去掉 ANSI 和 shell 噪声 |
| Finder 显示 | `POST /api/reveal` `{value}` | |
| 写剪贴板 | `POST /api/copy` `{text}` | 返回 `{ok,length}` |
| 在终端中打开目录 | `POST /api/terminal` `{value,app}` | `app` **必须在 `settings.terminals` 里**；传文件路径会退到它所在目录 |
| 记一次使用 | `POST /api/items/{id}/use` | 手工记账用；正常打开/运行服务端已经记了 |

关于命令的两条硬约束（**别试图"改进"**）：
- 执行一律走 `$SHELL -i -c`（`cwd = ~`），因为像 `killport` 这类是他 rc 文件里的**函数**，非交互 shell 里不存在。
- **只有退出码 0 才给条目记一次使用。** `GET /api/runs/:id` 的 `code` 在服务重启后会变回 `null`（内存态），日志文件才是事实。

### 3.6 批量发现与导入

```bash
curl -s "$BASE/api/discover?q=example&limit=120" | jq '.results'
curl -s -X POST $BASE/api/import -H 'content-type: application/json' \
  -d '{"items":[{"kind":"app","name":"Example","value":"/Applications/Example.app"}],"group":"新装的"}'
```

- `GET /api/discover` 递归扫 `discoverDirs`（深度 ≤ 8、访问目录预算 20000、**同名只留第一个**），并且**已经过滤掉面板里存在的 `value`**。返回 `{total, results, dirs}`，`limit` 缺省 80（前端传 120），不是服务端硬上限。
- `results` 里可能带 `displayName`（`mdls` 拿到的本地化名，只在和英文名不同时才有）。
- `POST /api/import` 返回 `{added, items}`；**`body.group` / `body.tags` 会覆盖每一项自带的值**——`group` 缺省 `默认`、`tags` 缺省 `['自动发现']`。`displayName` 存在时它占用 `name`、英文名挪去 `nameEn`。坏项静默跳过，已存在的 `value` 静默跳过，所以 `added` 可能小于你发的数量。

### 3.7 设置 `PATCH /api/settings` → `{ settings }`

一次可以只传一个键。五类：

| 键 | 形状 | 规则 |
| --- | --- | --- |
| `openByKind` | `{folder\|file\|url: [".app 路径…]}` | **整条列表替换**。第一个＝该类型的默认应用，`[]`＝交给 macOS。上限 12/类。数组以外的值 400 `每类的打开方式需要是应用数组，第一个为默认` |
| `terminals` | `[".app 路径…]` | **整条列表替换**，上限 8。内置 Terminal 会被补回（传 `[]` 也剩它），但**位置跟随你给的顺序**——你没把它写进前 8 位，它就被截掉（见下方坑）。它**不是**"第一个即默认"，别按 `openByKind` 理解 |
| `discoverDirs` | `[绝对路径…]` | **整条列表替换**，上限 12。三个默认目录（`/Applications`、`~/Applications`、`/System/Applications`）同样被补回末尾。改这份列表**同时**改变「发现应用」和所有应用选择器的候选，并清空 30s 扫描缓存 |
| `view` | `{panel?\|manage?: {group,sort,layout,collapsed}}` | 按页、按字段合并。见下表 |
| `theme` | 取值 `system`、`dark`、`light` 三选一 | 缺省 `system`（跟 macOS）。**只有这一档对非法值报 400**：`theme 需要是 system \| dark \| light` |

**一个已经量过的坑（补回 + 截断的顺序）**：`terminals` 和 `discoverDirs` 的实现是 `[...new Set([你给的…, 内置项…])].slice(0, 上限)`——内置项是**补在尾部**再截断的。所以
`{"terminals":["/Applications/C0.app" … 共 8 个]}` 会**真的把系统 Terminal 从清单里挤掉**，`discoverDirs` 给到 11 个自定义目录也会把 `/System/Applications` 挤出去（实测：剩 11 个自定义 + `/Applications`）。
→ **写这两个列表时永远把内置项显式列在你自己的顺序里**（Terminal 放第一个、三个默认目录放前面），别指望补回。UI 上那个「系统」徽标只是标出锁定项，不代表服务端会保住它。

`view` 的合法值（**两页的分组/排序枚举不一样**）：

| 页 | `group` | `sort` | `layout` | `collapsed` |
| --- | --- | --- | --- | --- |
| `panel` | `none`/`group`/`kind`/`tag` | `manual`/`name`/`used`/`recent` | `grid`/`list` | boolean |
| `manage` | `none`/`group`/`dir` | `manual`/`name` | `grid`/`list` | boolean |

- 缺省值两页同为 `{group:'group', sort:'manual', layout:'grid', collapsed:false}`。
- **枚举内的"默认顺序"就是 `manual`**（`items.json` 里的数组顺序）；跟他说的时候用中文「默认顺序」，别说"手动顺序"。
- 未知值不报错：读侧回落默认（`view`/`theme` 里坏掉的叶子值都是这个政策）。**只有契约违规才 400**——容器不是对象、`openByKind` 里出现没有的类型（`没有「x」这类打开方式配置`）、`view` 里出现别的页名（`没有「x」这一页的视图配置`）、`terminals` 不是数组、路径不是绝对路径。

```bash
# 把面板切成「列表 + 按标签分组」，其它轴不动
curl -s -X PATCH $BASE/api/settings -H 'content-type: application/json' \
  -d '{"view":{"panel":{"layout":"list","group":"tag"}}}' | jq '.settings.view.panel'
```

### 3.8 应用管理（`/manage.html` 背后的整表）

```bash
curl -s $BASE/api/library | jq '{ungroupedName, autoGroupNames, groups:[.groups[]|{name,n:(.apps|length),auto,ungrouped}], stale}'
```

- `groups[]`：`{name, apps:[.app 路径], auto?, ungrouped?}`。**数组顺序＝显示顺序，组内 apps 顺序＝卡片顺序。**
- `ungroupedName` 恒为 `未分组`，它在 `groups` 里恰好出现一次；它的**成员是派生的**（扫到的减去别的组认领的），你存的那个数组只是它的手动顺序和这一行自身的位置。
- `auto` 三个衍生组（`系统工具` / `Xcode 插件` / `Setapp`）在**第一次被写入存下时才固化**为普通组；`autoGroupNames` 是这三个名字，`autoAdd[名字]` 是「更新分组」会补进去的应用。
- `stale`：存着但当前扫不到的应用数量（视图里不显示、**记录保留**）。
- 响应里 `all`（以及 `groups[].apps`）可能有几百条绝对路径。**不要整份贴进对话或日志**，用 `jq` 只取你要改的那一组。
- `PATCH /api/library` body 是 `{groups:[{name,apps}]}`，**整表替换**。校验很严，全过了才写：

| 文案 | 触发 |
| --- | --- |
| `groups 需要是 [{ name, apps: [.app 路径…] }]` | `groups` 不是数组 |
| `最多 20 个分组` | 用户自己的组 > 20（`未分组` 不计） |
| `分组需要是 { name, apps }` | 某一项不是对象 |
| `分组名不能为空` / `分组名最长 40 字` / `已有分组「X」` | 名字问题 |
| `「未分组」只能有一个` | 出现两个 |
| `分组「X」的 apps 需要是路径数组` / `路径不能为空` / `需要是 .app 路径: …` | apps 形状 |
| `同一 App 不能出现在多个分组: <path>` | 一个应用被两组认领 |
| `最多 3000 个 App` | 总量超限 |

`{"groups":[]}` 是**合法的**（200）：它清掉所有存下的分组和手动顺序，三个自动组会重新派生出来。所以整表替换前**必须先 `GET` 拿全量再改**，漏一组就是丢一组。

### 3.9 三个小工具

- `GET /api/apps` → `{apps:[{name,value,displayName?}]}`：`discoverDirs` 下的扫描结果（缓存 30s），是**所有应用选择器的唯一来源**。
- `POST /api/pick` `{kind:'folder'｜'file'}` → 弹 macOS 原生选择器，**会阻塞到人选完或 120s 超时**；返回 `{cancelled, value, kind, name}`。`kind:'app'` 不支持（400 `kind 需为 folder/file`）——原生应用选择器要先过 Apple Events 授权且授权后仍会报错，应用一律从 `/api/apps` 里搜。
- `GET /api/enrich?path=<绝对路径>` → `{iconUrl}`：确保图标已渲染。`GET /api/icon?hash=<64 位十六进制>` 取那张 png（不是这个形状 400 `bad hash`，没这个文件 404 `no icon`）。图标只在服务端算得出来（`osascript -l JavaScript` + `sips`），**不要试图自己生成**。

## 4. 打开方式的解析链：五处界面看的是同一份

这是他反复强调的口径——**"逻辑和其他的一样，不再搞不一样的逻辑"**。任何一处少看一层，他都当 bug。

```
条目的存活候选 (item.openWith)
  → 该类型的存活候选 (settings.openByKind[kind])
    → 都没有＝交给 macOS（系统默认）
```

- `candidateApps(item, openByKind)`（`src/paths.ts`）把上面两级拼成**有效清单**（顺序保留、去重），**每次打开时实时算**。卡片值行前面的应用名、「双击 N 选」徽标、双击菜单、右键「打开方式…」的提示词、弹窗里的「当前候选」——**都是这一份**。
- 单击用的就是这份清单里**第一个还在安装的**应用（`resolveDefaultApp`）。
- **编辑即固化**：只要他在弹窗/编辑器里动过一次手（拖动、增、删、清空），整份清单就被写进该条目的 `openWith`，此后设置页再改不跟它。「清空」＝写 `[]`＝改回跟随类型清单。
- 只有 `folder`/`file`/`url` 有"用别的应用打开"的含义；`app`/`snippet`/`command` 没有类型清单。
- 失效徽标只统计**条目自己写过的**路径，类型清单里的陈旧项不算这条卡片的毛病。
- 终端是另一份清单（`settings.terminals`），folder/file 的「在终端中打开」和 command 的「在终端里运行」共用它；内置 Terminal 在清单里就带「系统」徽标、UI 不给删除按钮，它**不是**"默认项"（没有"单击进终端"这个动作）。写这份清单时留意 §3.7 那个截断坑。

**跨机器**：他可能把项目搬到别的 Mac。指向已卸载应用的记录**不删、只在 UI 里标失效**（写入端只校验 `.app` 形状，启动端才严格校验存在性）。清理只能由他在设置页「已失效引用」上点出来，那是他的决定，不是你自动做的。

## 5. 怎么给他描述（意图 → 接口 → 提示词例句）

描述里说清这四样，返工最少：**① 类型 ② 值（路径或文本）③ 名称 ④ 要不要动打开方式**。
下表最后一列是**他可以直接照着说**的话；让 AI 少猜的诀窍就是把条目名/路径念出来。

| 你想做什么 | 接口与字段 | 照这句说 |
| --- | --- | --- |
| 加一个应用 | `POST /api/items` `{kind:'app',value:'<.app 路径>',group?,tags?,pinned?}` | 「把 `/Applications/Obsidian.app` 加进面板，放『效率』组，置顶」 |
| 加一个文件夹 | 同上，`kind:'folder'` | 「加个条目指到 `~/Documents/周报`，名字叫『周报』，备注『每周一下午交』」 |
| 加一个文件 | `kind:'file'` | 「把 `~/Desktop/合同.pdf` 收到面板里，打『待办』标签」 |
| 加一个链接 | `kind:'url'` + `name` | 「加个链接 https://example.com/ ，叫『CI』，归到『工作』」 |
| 加一段文本片段 | `kind:'snippet'` | 「存一段片段：内容是…，名字『收件人邮箱』，点了直接复制」 |
| 加一条命令 | `kind:'command'`（value 可多行） | 「加条命令『清端口』，内容是 `killport 5173`，放『开发』组」 |
| 一次导入一个目录里的 App | `GET /api/discover?q=` → `POST /api/import {items, group}` | 「扫一下有没有 Obsidian 开头的 App，导入到『新装的』」 |
| 改某条的候选应用（顺序即优先级） | `PATCH /api/items/{id}` `{openWith:[…]}` | 「『周报』这个条目，用 VS Code 打开，VS Code 排第一个」 |
| 让某条不再跟随设置页 | `PATCH` `{openWith:[]}`（＝改回跟随）或写死一份 | 「这个条目的候选恢复成跟设置里一致」 |
| 给某类设默认打开应用 | `PATCH /api/settings` `{openByKind:{folder:[…]}}`（整条替换） | 「设置里『文件夹』的默认打开应用改成 VS Code，Finder 放第二个」 |
| 加/删可用终端 | `PATCH /api/settings` `{terminals:[…]}`（≤8，Terminal 删不掉） | 「把 iTerm 加进可用终端」 |
| 换视图：宫格/列表 | `PATCH /api/settings` `{view:{panel:{layout}}}` | 「面板切成列表视图」 |
| 按标签分组看 | `{view:{panel:{group:'tag'}}}` | 「面板按标签分组」 |
| 改排序 | `{view:{panel:{sort:'used'｜'name'｜'recent'｜'manual'}}}` | 「面板按使用次数排」 |
| 收起侧栏 | `{view:{panel:{collapsed:true}}}`（两页各一档） | 「把面板的侧栏收起」 |
| 切浅色/深色/跟系统 | `PATCH /api/settings` `{theme}` | 「面板切成浅色」 |
| 加扫描目录 | `PATCH /api/settings` `{discoverDirs:[…]}`（默认三个恒在） | 「把 `~/Applications/Setapp` 也算进扫描范围」 |
| 应用管理：把某 App 挪进某组 | `GET /api/library` → 改数组 → `PATCH /api/library`（**整表替换**） | 「在应用管理里把 Obsidian 挪到『写作』组，放到第一位」 |
| 重命名分组（条目侧） | 逐条 `PATCH /api/items/{id}` `{group}` | 「把『工具』组里的条目全改名成『效率』」 |
| 看某条命令的输出 | `GET /api/runs/{id}` | 「跑一下『整理下载』那条命令，把输出给我」 |
| 置顶/取消置顶 | `PATCH /api/items/{id}` `{pinned}` | 「把 CI 那条置顶」 |
| 删掉一个条目 | `DELETE /api/items/{id}` | 「面板里不要『周报』这条了（文件别动）」 |
| 清理指向已卸载应用的配置 | **只能他在设置页点**（`/api/state` 的 `appsExist` 是判断依据） | 「设置里那个『已失效引用』清掉」 |

反过来说，这几件事**不要自动做**，要先问：删条目、清失效引用、改 `openByKind` 的整体顺序、任何会动到多条记录/整张库的批量写。

## 6. 排错

**先分清你连的是哪个进程。** 沙箱起法（在他仓库之外做验证，绝不碰他的 `data/`）：

```bash
rsync -a --delete --exclude node_modules --exclude data --exclude .git \
  /path/to/launcher-panel/ /tmp/lp-check/
ln -s /path/to/launcher-panel/node_modules /tmp/lp-check/node_modules
mkdir -p /tmp/lp-check/data          # 空目录即可，服务会自己写入种子
cd /tmp/lp-check && PORT=5399 node server/prod.mjs   # 需要先 npm run build
BASE=http://127.0.0.1:5399
```

| 现象 | 真正原因 |
| --- | --- |
| 连不上 / `Connection refused` | 服务没起，或端口不是 5178（`PORT` 会改）。**不要靠 `kill`/重启来"修"** |
| 404 `no route GET /api/xxx` | 路径或方法写错（路由表在 `server/api.mjs` 末尾） |
| 400 `value is required` | `value` 漏了或空串 |
| 409 `该项已存在` | 同 `kind` + 同解析后 `value` 已有条目。**该 PATCH 而不是再 POST** |
| 400 `候选应用必须指向 .app` / `终端必须指向 .app` | `openWith`/`terminals` 里塞了不是 `.app` 的字符串 |
| 404 `打开方式不存在: <path>` / `路径不存在: <path>` | 真启动时才校验存在性（`/api/open`、`/api/terminal`）。存储时只校验形状 |
| 400 `这个应用不在「可用终端」清单里` | `app` 指名了清单外的应用。先 `PATCH /api/settings` 加进 `terminals`，或换清单内的 |
| 400 `命令条目要用「运行」` | `command` 条目不能用 `/api/open`，要用 `/api/run` |
| 400 `只允许 http/https` | `url` 用了别的协议 |
| 409 `这条命令正在运行中` | 同一条命令还没退出。**这是保护，不是 bug**；要停请人来停 |
| 404 `没有这条命令条目` | `/api/run`、`/api/runs/:id` 只认 `kind:'command'` 的 id |
| 400 `kind 需为 folder/file` | `/api/pick` 不支持选应用；应用从 `/api/apps` 搜 |
| 500 `打开系统选择器失败` | 无人点选/权限异常；`cancelled:true` 才是他主动取消 |
| 构建后的面板一片白，dev 却正常 | 十有八九是 `items.json` 被手写过、缺 `openWith`。`GET /api/state` 看条目字段是否齐全 |
| 改 `settings` 里某个枚举没生效也没报错 | 未知值会**静默回落默认**（`view` 的叶子值就是这政策）。对照 §3.7 的枚举表拼 |
| 改了 `server/api.mjs` 后扫描结果像丢了 | 正常：Vite 中间件与 dev server 同进程，**改这个文件会热重启并清空内存缓存** |

## 7. 术语（用这套词，别自造）

| 词 | 指 | 别说成 |
| --- | --- | --- |
| 条目 | `items.json` 里的一条记录，六类之一 | 收藏、快捷方式、书签 |
| 应用 | `/Applications` 等处的 `.app` | 软件、程序（写接口时尤其） |
| 分组 | 一个条目一个 `group`，自由文本 | 分类、目录、工作区 |
| 标签 | 条目的 `tags[]`，多对多 | 标记、tag 分类 |
| 视图三轴 | 分组方式 / 排序方式 / 视图（宫格·列表） | 布局设置、显示选项 |
| 默认顺序 | `sort:'manual'`，即数组顺序 | **手动顺序** |
| 候选 · 有效清单 | 条目的 `openWith` 与该类型清单合并后的东西 | 推荐列表、备用应用 |
| 固化 | 动过一次手，类型清单被写进条目自己的 `openWith` | 覆盖、锁定 |
| 失效 | 记录里的 `.app` 磁盘上已不存在 | 错误、损坏 |
| 置顶 | `pinned:true`，侧栏「置顶」和分节时的置顶桶 | 星标、常用 |
| 系统（徽标） | 内置、不可删的锁定项（Terminal、三个扫描目录） | 默认 |
| 默认（徽标） | **只**表示"有序列表里排第一个" | 系统 |

**角标措辞是定死的**：「系统」＝不可删的内置项；「默认」**只**给"排第一"。再新增锁定型配置项请复用「系统」，不要发明第三种叫法。
