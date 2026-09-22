# launcher-panel · 给 AI 的说明

**动手前先读 [`docs/AI-GUIDE.md`](docs/AI-GUIDE.md)**：六类条目的字段与限制、`/api/*` 的口径、视图枚举、错误文案、意图→接口映射表都在那一份里。
本文件只放指针和红线，**不复述接口**，免得两处过期。给人看的说明是 `README.md`。

## 红线

1. **不手改 `data/items.json`。** 改配置只走 `http://127.0.0.1:5178`（或你起的那份）的 HTTP 接口。服务进程在内存里持有整表，外部写入会被覆盖；漏字段（尤其条目的 `openWith`）会让构建后的面板白屏。
2. **未经许可不写、不 kill 他的 dev server。** `:5178` 上跑的是真实配置。要验证就在 `/tmp` 起沙箱副本（`docs/AI-GUIDE.md` §6 有配方）。只读的 `GET /api/state` 可以直接打。
3. **`data/` 永不进版本库、内容不贴进对话。** 里面是个人路径和条目；示例一律用假路径。
4. **「移除」不碰磁盘**：删条目、清理失效引用都只改配置。**绝不 `rm` 用户文件去"清理"**。
5. **不"顺手改进"**：不加接口/字段/缓存/鉴权/迁移脚本，不改字段名和文案。口径是能少一处就少一处——配置都进 `items.json`，不用 localStorage，不为小配置开新接口。
6. **交付前自己跑完验证轮**，报告分「已自测 / 需你确认」。没验过就别声称做好了。
7. **不自己 bump 版本、不打 tag。** 版本号唯一来源是 `package.json` 的 `version`，只在他明说发版时改并配 `vX.Y.Z` tag（流程见 `CONTRIBUTING.md`「版本和发布」）。

## 改之前要知道的两件事

- **一份清单只出现一次。** 凡是"这个条目能用哪些应用打开"，卡片值行、徽标、双击菜单、右键提示、「打开方式…」弹窗必须都是同一份 `candidateApps`（`src/paths.ts`）。哪一处少看一层都会被当成 bug。新界面也照这条走。
- **措辞是定死的。** 分组的单位叫「分组」（不是"分类/文件夹/目录"）；排序那一档叫「默认顺序」（不是"手动顺序"）；徽标「系统」＝不可删的内置项、「默认」＝只表示"排第一个"。

## 常用命令

```bash
npm run dev        # http://127.0.0.1:5178（strictPort；改 server/api.mjs 会热重启并清空扫描缓存）
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build → dist/
npm test           # node --test server/api.test.mjs（纯函数单测，不起服务）
npm start          # build 后用 server/prod.mjs 起静态服务（PORT 可覆盖端口）
```

只在 macOS 跑（`open` / `osascript` / `sips` / `plutil` / `pbcopy` / `mdls`）。

## 代码地图

```
server/api.mjs       唯一 API，路由表在文件末尾；读写 items.json、spawn 命令
src/api.ts           前端所有 /api/* 的唯一出口（类型化，字段名的第二参照）
src/types.ts         Item / Kind / ViewPrefs / Library 等共享形状
src/paths.ts         打开方式解析：candidateApps / resolveDefaultApp / liveCandidates
src/App.tsx          面板：筛选、搜索、三轴视图、右键菜单装配
src/index.css        唯一的样式 token 层（ink-* / mute-* / accent / card-surface / chip）
```

加控件前先看 `src/components/`（`Select`、`AppChips`、`AppList`、`ViewControls`、`ContextMenu`…），别再攒一份内联样式。
