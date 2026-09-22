# 怎么参与

这是我自己每天在用的本机工具，代码公开是为了让别人也能用、也能改着自用。
没有 contributor license agreement、没有 CLA、没有"先提 issue 讨论再动手"的规矩——
想改直接开 PR 就行。但下面这些约束是我踩出来的，绕过它们等于给我制造 bug。

## 跑起来

```bash
npm install
npm run dev        # http://127.0.0.1:5178（strictPort，只绑 127.0.0.1）
```

只能 macOS（`open` / `osascript` / `sips` / `plutil` / `pbcopy` / `mdls`），Node ≥ 20.19（Vite 7 的下限）。
克隆下来 `data/` 是空的（整个目录 git-ignore），起服务时会自动写入种子条目——第一次跑别以为是坏掉了。
想动这些出厂默认（改值、加一条）：直接改 `server/api.mjs` 里那三张 `COMMON_*` 表就行。服务启动时会拿它们和 `items.json` 的 `seed` 快照对账，只把**用户没碰过**的种子条目同步过去，改过值/改过名/删掉的都不动，所以不用叫用户手动配合。

改完代码跑这四条，全绿再提：

```bash
npm run typecheck  # tsc --noEmit
npm test           # node --test server/api.test.mjs（纯函数单测，不起服务）
npm run build      # 前两条的超集 + vite build → dist/
npm start          # 想验生产构建再跑；PORT 可覆盖端口
```

**不要拿我的 dev server 做实验。** `:5178` 上跑的是真实配置，服务进程在内存里持有整表，
外部写 `data/items.json` 会被覆盖掉。要验证就在 `/tmp` 起一份沙箱副本（配方在 `docs/AI-GUIDE.md` §6）。

## 先读这两份，别读三份

| 文件 | 给谁 | 内容 |
| --- | --- | --- |
| `README.md` | 给人 | 装、用、每个界面在哪 |
| `docs/AI-GUIDE.md` | 给 AI 和维护者 | 六类条目的字段与上限、`/api/*` 的请求与错误文案、视图枚举、意图→接口映射 |
| `AGENTS.md` | 给 AI | 指针 + 红线，不复述接口 |

**接口口径只写在 `docs/AI-GUIDE.md` 一份里。** 你要加接口，就同时更新那一份，
不要在 PR 描述、README、注释里再抄一遍——三处描述同一个接口，一定会有两处过期。

## 硬约束（这几条我的回答永远是"不行"）

- **不新增接口面、不加第二处存储。** 配置一律进 `data/items.json` 的现有键，不用 localStorage，不为一个小开关开一个新接口。少一处能错的地方就少一处。
- **一份清单只出现一次。** 凡是"这个条目能用哪些应用打开"，卡片值行、徽标、双击菜单、右键提示、「打开方式…」弹窗必须都是同一份 `candidateApps`（`src/paths.ts`）。新界面也一样，哪一处少看一层就是 bug。
- **措辞是定死的。** 分组单位叫「分组」（不是"分类/文件夹/目录"）；排序那一档叫「默认顺序」（不是"手动顺序"）；徽标「系统」＝不可删的内置项、「默认」＝只表示排第一个。改文案前先照这张表。
- **「移除」不碰磁盘。** 删条目、清理失效引用都只改配置，绝不 `rm` 用户文件。
- **不"顺手改进"。** 不改字段名、不加缓存/鉴权/迁移脚本、不重构路过看到的代码。这些不是坏事，是不在这个 PR 里的事。

## 措辞之外的技术约定

- 前端所有 `/api/*` 只有一个出口：`src/api.ts`（类型化，字段名的第二参照）。别在组件里裸写 `fetch`。
- 共享形状都放 `src/types.ts`。
- 样式只有 `src/index.css` 一层 token（`ink-*` / `mute-*` / `accent` / `card-surface` / `chip`），加控件先看 `src/components/`（`Select`、`AppChips`、`AppList`、`ViewControls`、`ContextMenu`…），别再攒一份内联样式。
- 服务端读进来的每一项都要清洗（id/kind/tags 之类的野值），坏 `items.json` 覆写前会留 corrupt 备份——保持这个取向。

## Issue 和 PR

Issue 请走模板。**Bug 模板要的那几样不是形式主义**：没有 `kind`、没有实际请求、没有状态码和 `error` 文案，我基本没法判断是校验拦住了还是解析链掉了一层。

提交信息用中文、写清 *why*（为什么改，而不是改了哪几个文件）：

```
侧栏：两页各一档展开/收起，collapsed 并入 view 第四字段
安全：读盘条目的 id/kind/tags 一律清洗，坏 items.json 覆写前留 corrupt 备份
```

一个 PR 只做一件事。想同时改 UI 和改服务端校验，拆成两个——我合并前会逐条看，混在一起就只能整体拒掉。

不要提交 `data/` 下任何东西，也不要在 PR 描述、截图、测试用例里带真实路径。示例用假数据。

## 版本和发布

版本号只有一个来源：`package.json` 的 `version`。没有 CHANGELOG 文件，也没有第二处版本常量——
别在代码里写死版本号，也别在 README 里另记一个。

- **发版才动 `version`，平时提交不动。** PR 里看到 bump 版本我一律问为什么；改行为和发版是两件事，别混在一个提交里。
- **发版那一刻打 tag**：`git tag -a vX.Y.Z -m "一句话"`，然后 `git push origin vX.Y.Z`。tag 名必须和 `package.json` 里的 `version` 一致。
- **继续直推 `main`，不引入分支模型。** 我自己用，日常提交就在 `main` 上；`vX.Y.Z` 标记的是"当时能用的那份"，不是发布分支的头。
- 提交信息还是上面那种中文一句话式，tag 的说明也照这个写。
