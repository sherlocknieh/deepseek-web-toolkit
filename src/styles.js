// 注入图标字体和目录行样式；列表重排只依赖 flex 的 order，不改动会话项本身
export function addCSSClass() {
    // 热更新时先移除旧样式，避免重复注入
    document.getElementById('dscf-fontawesome')?.remove();
    document.getElementById('dscf-style')?.remove();

    const iconLink = document.createElement('link');
    iconLink.id = 'dscf-fontawesome';
    iconLink.rel = 'stylesheet';
    iconLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(iconLink);

    const style = document.createElement('style');
    style.id = 'dscf-style';
    style.textContent = `
        /* 让会话列表容器按 order 排列，从而在不移动 DOM 的前提下形成层级 */
        .dscf-list-parent {
            display: flex !important;
            flex-direction: column;
        }

        /* 折叠时隐藏该文件夹下的所有会话与子目录行；
           用 data 属性而不是 class，避免 React 切换选中态重写 className 时被抹掉 */
        [data-dscf-hidden] {
            display: none !important;
        }

        /* 目录行和新建输入行沿用会话项的字体和悬停样式，只额外加文件夹图标 */
        .dscf-folder-row,
        .dscf-new-folder-row {
            display: flex;
            align-items: center;
            justify-content: flex-start !important;
            min-height: 40px;
            box-sizing: border-box;
            border-radius: 12px;
            cursor: pointer;
            position: relative;
        }

        /* 新建行正在等待命名：用浅色底提示这是临时行，不是已存在的目录 */
        .dscf-new-folder-row {
            cursor: text;
            background-color: rgba(103, 112, 254, 0.10);
        }

        .dscf-folder-row::before,
        .dscf-new-folder-row::before {
            content: "\\f07b";
            font-family: "Font Awesome 6 Free";
            font-weight: 900;
            color: #6770FE;
            display: inline-block;
            flex: 0 0 16px;
            width: 16px;
            margin-right: 6px;
            text-align: center;
        }

        .dscf-folder-row.dscf-folder-open::before {
            content: "\\f07c";
        }

        /* 新建行里的输入框：去掉边框和背景，看起来像直接在选择目录名 */
        .dscf-new-folder-input {
            flex: 1 1 auto;
            min-width: 0;
            width: 100%;
            padding: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            line-height: inherit;
        }

        .dscf-folder-name {
            flex: 1 1 auto;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }

        /* 正在重命名的目录行：和新建行一样用浅色底提示处于编辑状态 */
        .dscf-folder-renaming {
            background-color: rgba(103, 112, 254, 0.10);
            cursor: text;
        }

        /* 置顶标题行右侧的新建文件夹按钮：无边框小图标，悬停时才变明显。
           margin-right 给应用自带的置顶排序按钮（绝对定位在右侧）留出位置 */
        .dscf-new-folder {
            margin-left: auto;
            margin-right: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 18px;
            width: 18px;
            height: 18px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: inherit;
            font-size: 11px;
            cursor: pointer;
            opacity: 0.65;
        }

        .dscf-new-folder:hover {
            opacity: 1;
            color: #6770FE;
            background-color: rgba(103, 112, 254, 0.16);
        }

        /* 目录行的重命名/删除按钮：默认隐藏，悬停目录行才出现，避免误触 */
        .dscf-folder-rename,
        .dscf-folder-remove {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 18px;
            width: 18px;
            height: 18px;
            margin-left: 2px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: inherit;
            font-size: 11px;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
        }

        .dscf-folder-row:hover .dscf-folder-rename,
        .dscf-folder-row:hover .dscf-folder-remove,
        .dscf-folder-row:focus-within .dscf-folder-rename,
        .dscf-folder-row:focus-within .dscf-folder-remove {
            opacity: 0.6;
            pointer-events: auto;
        }

        .dscf-folder-rename:hover {
            opacity: 1;
            color: #6770FE;
            background-color: rgba(103, 112, 254, 0.16);
        }

        .dscf-folder-remove:hover {
            opacity: 1;
            color: #ff5c5c;
            background-color: rgba(255, 92, 92, 0.12);
        }

        /* 拖动时高亮可放置的目录/会话行；拖到空白处表示移回根级 */
        .dscf-drop-target {
            background-color: rgba(103, 112, 254, 0.16) !important;
            outline: 1.5px dashed rgba(103, 112, 254, 0.75);
            outline-offset: -2px;
        }

        .dscf-drop-root {
            box-shadow: inset 0 0 0 1.5px rgba(103, 112, 254, 0.55);
        }

        /* 通用消息导航（其他站点用；DeepSeek 走原生导航）：右侧圆点常驻，按钮展开完整列表 */
        .dscf-msgnav {
            position: fixed;
            top: 0;
            left: 0;
            height: 400px;
            display: none;
            align-items: flex-start;
            z-index: 40;
            pointer-events: none;
            color: var(--dscf-fg, #1f2329);
        }

        .dscf-msgnav.is-visible {
            display: flex;
        }

        .dscf-msgnav-side {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            pointer-events: auto;
        }

        .dscf-msgnav-toggle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 20px;
            width: 20px;
            height: 20px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: inherit;
            font-size: 11px;
            cursor: pointer;
            opacity: 0.55;
            transition: opacity 0.15s ease, color 0.15s ease;
        }

        .dscf-msgnav-toggle:hover,
        .dscf-msgnav-toggle.is-active {
            opacity: 1;
            color: #6770FE;
        }

        .dscf-msgnav-rail {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            max-height: 100%;
            overflow: hidden;
        }

        .dscf-msgnav-dot {
            flex: 0 0 auto;
            width: 6px;
            height: 6px;
            padding: 0;
            border: 0;
            border-radius: 999px;
            background: currentColor;
            opacity: 0.22;
            cursor: pointer;
            transition: opacity 0.15s ease, background-color 0.15s ease, width 0.15s ease;
        }

        .dscf-msgnav-dot:hover {
            opacity: 0.7;
        }

        .dscf-msgnav-dot.is-active {
            background: #6770FE;
            opacity: 1;
            width: 10px !important;
        }

        /* 面板绝对定位到圆点左侧，避免被视口右缘裁掉 */
        .dscf-msgnav-panel {
            position: absolute;
            top: 0;
            right: calc(100% + 8px);
            pointer-events: auto;
            display: flex;
            flex-direction: column;
            width: 300px;
            max-height: min(60vh, var(--dscf-msgnav-height, 400px));
            border-radius: 12px;
            background: var(--dscf-panel-bg, rgba(255, 255, 255, 0.98));
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
            border: 1px solid rgba(127, 127, 127, 0.16);
            overflow: hidden;
        }

        .dscf-msgnav-panel[hidden] {
            display: none;
        }

        .dscf-msgnav-head {
            flex: 0 0 auto;
            padding: 10px 12px 6px;
            font-size: 12px;
            font-weight: 600;
            opacity: 0.6;
        }

        .dscf-msgnav-list {
            flex: 1 1 auto;
            overflow-y: auto;
            padding: 0 6px 8px;
        }

        .dscf-msgnav-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            width: 100%;
            padding: 7px 8px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }

        .dscf-msgnav-item:hover {
            background: rgba(103, 112, 254, 0.10);
        }

        .dscf-msgnav-item.is-active {
            background: rgba(103, 112, 254, 0.16);
        }

        .dscf-msgnav-item > i {
            flex: 0 0 12px;
            margin-top: 4px;
            font-size: 10px;
            opacity: 0.55;
            text-align: center;
        }

        .dscf-msgnav-text {
            flex: 1 1 auto;
            min-width: 0;
            font-size: 12px;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .dscf-msgnav-index {
            flex: 0 0 auto;
            font-size: 10px;
            opacity: 0.4;
            margin-top: 2px;
        }

        /* 深色主题：各站点标记不同（ChatGPT/Grok 用 html.dark，DeepSeek 用 body.dark，
           Gemini 用 dark-theme / data-theme），全部跟随，避免深色底上画出深色圆点 */
        html.dark .dscf-msgnav,
        body.dark .dscf-msgnav,
        .dark-theme .dscf-msgnav,
        [data-theme="dark"] .dscf-msgnav {
            --dscf-fg: #e6e8eb;
            --dscf-panel-bg: rgba(38, 40, 44, 0.98);
        }

        /* 跳转目标短暂高亮 */
        [data-dscf-flash] {
            border-radius: 8px;
            animation: dscf-flash 1.6s ease-out;
        }

        @keyframes dscf-flash {
            from { background-color: rgba(103, 112, 254, 0.22); }
            to { background-color: transparent; }
        }

        /* 原生消息导航被前端在 768px 以下设成 display:none，宽屏也要悬停才露出。
           这里不设断点、全程常显：断点两侧的媒体查询区间不重合，缩放跨过 768px
           时会先消失再出现 */
        [style*="--scroll-nav-page-padding"] {
            display: flex !important;
        }

        /* 窄屏给消息列表补右内边距，避开导航。应用在 768px 处把列表外边距从 44px
           收到 20px，这里把下限同步从 14px 提到 38px，右侧总留白全程都是 58px，
           缩放跨断点不再突然变宽 */
        .ds-virtual-list--printable .ds-virtual-list-items {
            padding-right: max(calc((100% - var(--message-list-max-width)) / 2), 14px) !important;
        }

        @media not all and (min-width: 768px) {
            .ds-virtual-list--printable .ds-virtual-list-items {
                padding-right: max(calc((100% - var(--message-list-max-width)) / 2), 38px) !important;
            }
        }
    `;
    document.head.appendChild(style);
}
