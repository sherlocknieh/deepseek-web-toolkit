# DeepSeek 工具箱 — Agent Index

DeepSeek 油猴脚本，一个产物包含四块互不依赖的功能：会话目录（置顶区里名称带 `/` 的会话原地折叠成目录）、KaTeX 复制修正（注入官方 copy-tex）、消息导航（DeepSeek 用原生导航，其他站点用通用实现）、默认折叠思考。Vite + vite-plugin-monkey，源码在 `src/`，产物在 `dist/deepseek-web-toolkit.user.js`。

## 快速命令

```bash
npm run dev                    # 开发调试
npm run build                  # 只构建，不动版本号
npm run hooks                  # 启用 .githooks（提交前自动升版本+构建）
npm run release "feat: xxx"    # 升版本 → 构建 → commit → tag（--push 推送）
npm run release --dry-run      # 只预览版本号
```

版本号由 `scripts/bump-and-build.mjs` 按本地时间写入 `vite.config.js`，格式 `YYYY.MM.DD.HHmm`，不要手改，也不要手改 `dist`。

## 模块

依赖方向：`main → drag / observer / editor / selection / styles → render / titles / pin / api → dom / path / storage → runtime / constants`。

| 文件 | 职责 |
| --- | --- |
| `main.js` | 入口、启动顺序、热更新清理登记 |
| `katex-copy.js` | 注入 KaTeX copy-tex，与目录功能无依赖 |
| `native-nav.js` | 改写原生导航的 `(max-width: 1200px)` 断点，避免侧栏展开时导航被卸载 |
| `message-nav.js` | 通用消息导航：复刻 DeepSeek 胶囊（横线 + 悬停展开提问列表），按站点适配选择器；DeepSeek 不启用 |
| `think-collapse.js` | 默认折叠已完成的思考块，只点应用自己的标题栏 |
| `runtime.js` | 运行时状态、上一实例回收、页面 window |
| `constants.js` | 键名、缩进、布局 data 属性名 |
| `storage.js` | GM/localStorage 回退、展开状态、空目录占位（仅内存） |
| `dom.js` | DOM 查询、置顶区、原始标题读写、折叠标记 |
| `path.js` | 标题 → 目录路径 / 前缀树 / 排序 |
| `titles.js` | 完整标题、叶子显示、改名覆盖、自动置顶检测 |
| `pin.js` | 用应用菜单置顶，串行队列 |
| `api.js` | 登录 token、页面 fetch、`update_title` |
| `editor.js` | 应用改名输入框：定位被顶替的行、预填末段、补回前缀 |
| `selection.js` | 当前会话高亮、SPA 路由 |
| `render.js` | flex order 重排、目录行、新建/重命名行内编辑、折叠 |
| `observer.js` | 变更监听、签名、防抖重排 |
| `drag.js` | 拖动/放置判定、移动执行、占位清理 |
| `folder.js` | 整目录子树改名与占位迁移（拖动与重命名共用） |
| `styles.js` | 注入目录/拖动/导航样式；图标字体单独按需加载 |
| `utils.js` | 启动等待 |

## 关键不变量

- **完整标题是唯一事实来源**：解析、排序、置顶、拖动、改名都用 `getChatTitle`，不要用显示文本反推路径。
- **显示标题是视图**：叶子只显示末段，完整路径存 `data-dscf-full-title`；`applyLeafTitle` 切换，`restoreDisplayTitles` 恢复。
- **目录只在置顶区**：`getPinnedSection` / `isAnchorPinned` 是唯一判定，未置顶会话平铺。
- **不改动、不复制会话节点**：只加 `display:flex` + `order` + 插入目录行，保留选中态、导航和菜单。
- **折叠状态用 data 属性**：`data-dscf-hidden` / `data-dscf-chat`，因为 React 切换选中会重写 `className`。
- **空目录是内存占位**：不写存储，刷新消失；会话拖入改名成功后 `dropExtraFolderChain` 清占位，整目录移动时 `renameExtraFolders` 迁移。
- **整目录移动/改名共用 `moveFolderSubtree`**：`drag.js` 与 `render.js` 都调它，不要各写前缀截取。
- **行内编辑**：新建用 `runtime.newFolder`，重命名用 `runtime.folderRename`；Enter/失焦提交，Esc 取消，输入法组合中的 Enter 不提交。
- **改名不重复提交**：预填只改显示值、不派发 `input`；名称没变时静默还原成完整路径。
- **改名输入框顶替会话行**：`input.ds-input__input` 不是行的子元素，`rebuild` 检测到就跳过一次重排。
- **补前缀要核对服务端**：`ensureServerTitle` 写完读一次列表，仍是末段就再补写；期间 `isRestoringTitle` 暂停重排。
- **签名跳过**：展开/折叠不改变签名，必须 `rebuild(true)`。

## 启动与热更新

`main.js` → `addCSSClass` →（仅 DeepSeek）`addIconFont` / `initKatexCopy` / `initThinkCollapse` → `waitFor` 侧栏会话 → `checkFrontUpdating` → `rebuild(true)` → `observeChatList` / `initDragAndDrop` / `listenDomain`。

非 DeepSeek 站点只注入内联样式并启动消息导航：图标字体在 cdnjs、copy-tex 在 jsdelivr，会被 ChatGPT / Gemini 的 CSP 拦下，Gemini 还会因 Trusted Types 在设置 `script.src` 时抛错，所以这两项必须留在 DeepSeek 分支。

`runtime.js` 在模块加载时回收上一轮实例；HMR 可能只重跑 `main.js`，入口再用 `runtime.initialized` 判断并 `runtime.dispose()`，清理函数登记在 `runtime.disposers`。

## DeepSeek DOM 契约

- 滚动区 `.ds-scroll-area`；内容 `._77cdc67`；分组 `._3098d02`；置顶分组额外 `_63701b7`，标题“置顶”/“Pinned”。
- 会话项 `<a class="_546d736" href="/a/chat/s/<id>">`，子元素 `[0]` 焦点环、`[1]` 标题、`[2]` “更多”。
- 选中 class `b64fb9ae`；菜单项文字在 `.ds-dropdown-menu-option__label`。
- 消息项带 `data-virtual-list-item-key`（会话内从 0 递增，切会话会复用）；思考块是 `.ds-message > ._74c0879`，第一个子元素是标题栏、含 `.ds-think-content` 时表示展开。
- 混淆 class 是脆弱契约，改选择器时同步 `dom.js` 与 `main.js` 的 `checkFrontUpdating`。

## 改动路径

- 目录规则/排序 → `path.js` + `render.js`
- 新建文件夹/空目录 → `storage.js` + `render.js` + `drag.js`
- 目录移动/重命名 → `folder.js`；行内交互在 `render.js`
- 显示标题 → `titles.js`
- 拖动/放置 → `drag.js`；置顶 `pin.js`；改名 `api.js`
- 展开持久化 → `storage.js` + `constants.js`
- 通用消息导航 → `message-nav.js`；原生导航显隐 → `native-nav.js` + `styles.js`
- 思考折叠 → `think-collapse.js`
- DeepSeek 前端更新 → `dom.js` + `checkFrontUpdating`
- 新增交互状态 → `runtime.js` + `runtime.disposers`
- 发布流程 → `scripts/*` + `.githooks/pre-commit`
- 消息导航 → `message-nav.js`：非 DeepSeek 站点在 `main.js` 启动；站点差异只写在 `SITE_ADAPTERS`（消息块选择器、角色判定、正文范围、滚动容器），未适配站点走通用标记兜底；胶囊尺寸照抄 DeepSeek 原生导航（34px→240px、条目 30px、横线 8×2），改样式时以真机为准；只列用户提问，跳转直接改滚动容器的 `scrollTop`（站点会把平滑滚动逐帧拉回底部），并按首条消息距滚动原点的距离让出悬浮标题的高度；DeepSeek 用原生导航，`native-nav.js` 改写 `(max-width: 1200px)` 断点避免侧栏展开时被卸载，`styles.js` 负责常显与留白

## 浏览器调试

先问用户要自动调试还是手动调试。

1. 复制登录态（Chrome 136+ 不允许默认配置开远程调试）：

```shell
SRC=~/.config/google-chrome
DST=/tmp/opencode/chrome-debug
rm -rf "$DST" && mkdir -p "$DST/Default"
cp "$SRC/Local State" "$DST/Local State"
cp "$SRC/Default/Cookies" "$DST/Default/Cookies"
cp "$SRC/Default/Preferences" "$DST/Default/Preferences" 2>/dev/null || true
cp -a "$SRC/Default/Local Storage" "$DST/Default/Local Storage"
```

2. 启动 Chrome：`--user-data-dir=$DST --profile-directory=Default --remote-debugging-port=9337 --remote-allow-origins='*'`，打开 `https://chat.deepseek.com/`。
3. 用 `tools/browser-debug.mjs` eval `dist/deepseek-web-toolkit.user.js`，再 `eval` / `shot` / `key` / `type` / `net` 验证。
4. 用 `localStorage.userToken` 调 `GET /api/v0/chat_session/fetch_page?count=50` 核对服务端标题。
5. 收尾：改回测试标题，`close` 浏览器，`rm -rf $DST`。

## 验证

- 构建：`npm run build`；发布：`npm run release "feat: …"`（钩子走同一套升版本+构建，发布脚本用 `--no-verify` 跳过）。
- 真机：控制台出现 `[DeepSeek 工具箱] 脚本已加载` 和 `已初始化，会话数 N`；确认只有置顶区成目录、叶子只显示末段、未置顶斜杠会话平铺、拖动/置顶/改名可用、新建与删除空目录正常。
- 确认打开会话时已完成的思考块默认收起、思考输出中保持展开、手动展开后不再被收起。
- 确认右侧原生消息导航全程常显且不压正文，缩放跨过 768px 时导航不闪、右边距不跳变；其他站点出现右侧胶囊，收起是一列横线，悬停展开提问列表（移开即收回），点击跳到对应提问且不被悬浮标题压住，当前项横线加粗变蓝。
