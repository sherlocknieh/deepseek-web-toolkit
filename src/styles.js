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

        /* 通用消息导航（其他站点用；DeepSeek 走原生导航）：照搬 DeepSeek 原生导航的
           尺寸与交互——右侧居中的毛玻璃胶囊收成一列横线，悬停展开成消息列表 */
        .dscf-msgnav {
            position: fixed;
            top: 50%;
            right: 16px;
            transform: translateY(-50%);
            height: 300px;
            z-index: 40;
            display: none;
            user-select: none;
            color: var(--dscf-fg, #262626);
        }

        .dscf-msgnav.is-visible {
            display: block;
        }

        /* 和原生导航一致：窄屏不显示，避免胶囊压住正文 */
        @media not all and (min-width: 768px) {
            .dscf-msgnav {
                display: none !important;
            }
        }

        /* 胶囊本体：34px 收起、240px 展开，尺寸变化由 width 过渡承载 */
        .dscf-msgnav-list {
            position: relative;
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 34px;
            padding: 4px 0;
            box-sizing: border-box;
            border-radius: 16px;
            overflow: hidden;
            background-color: var(--dscf-nav-bg, rgba(255, 255, 255, 0.8));
            backdrop-filter: blur(5px);
            transition: width 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
        }

        /* 展开后列表可滚动，上下各盖一层同色渐变，和原生导航的滚动边缘一致 */
        .dscf-msgnav-list::before,
        .dscf-msgnav-list::after {
            content: "";
            position: absolute;
            left: 0;
            right: 0;
            height: 24px;
            z-index: 2;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .dscf-msgnav-list::before {
            top: 0;
            background: linear-gradient(var(--dscf-nav-bg-solid, #ffffff), transparent);
        }

        .dscf-msgnav-list::after {
            bottom: 0;
            background: linear-gradient(transparent, var(--dscf-nav-bg-solid, #ffffff));
        }

        .dscf-msgnav:hover .dscf-msgnav-list::before,
        .dscf-msgnav:hover .dscf-msgnav-list::after,
        .dscf-msgnav:focus-within .dscf-msgnav-list::before,
        .dscf-msgnav:focus-within .dscf-msgnav-list::after {
            opacity: 1;
        }

        .dscf-msgnav-items {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }

        .dscf-msgnav-items::-webkit-scrollbar {
            width: 0;
        }

        .dscf-msgnav:hover .dscf-msgnav-list,
        .dscf-msgnav:focus-within .dscf-msgnav-list {
            width: 240px;
            background-color: var(--dscf-nav-bg-solid, #ffffff);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        }

        /* 一项一条消息：标题靠左、横线贴右；收起时标题透明，只留横线 */
        .dscf-msgnav-item {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: calc(100% - 6px);
            height: 30px;
            margin-right: 8px;
            padding: 0;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }

        .dscf-msgnav-title {
            flex: 1 1 auto;
            min-width: 0;
            margin-right: 12px;
            font-size: 13px;
            line-height: 20px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--dscf-fg, #262626);
            opacity: 0;
            transition: opacity 0.1s ease, color 0.2s ease;
        }

        .dscf-msgnav:hover .dscf-msgnav-title,
        .dscf-msgnav:focus-within .dscf-msgnav-title {
            opacity: 1;
        }

        /* 横线的定位盒固定 16×20，横线本身 8×2；当前项放大 1.5 倍并变成品牌色 */
        .dscf-msgnav-indicator {
            flex: 0 0 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 20px;
        }

        .dscf-msgnav-line {
            width: 8px;
            height: 2px;
            border-radius: 4px;
            background-color: var(--dscf-line, #c9c9c9);
            transition: background-color 0.2s ease, transform 0.2s ease;
        }

        .dscf-msgnav-item:hover .dscf-msgnav-line {
            background-color: var(--dscf-fg, #262626);
        }

        .dscf-msgnav-item:hover .dscf-msgnav-title {
            color: var(--dscf-fg, #262626);
        }

        .dscf-msgnav-item.is-active .dscf-msgnav-line {
            background-color: var(--dscf-brand, #4d6bfe);
            transform: scale(1.5);
        }

        .dscf-msgnav-item.is-active .dscf-msgnav-title {
            color: var(--dscf-brand, #4d6bfe);
            font-weight: 500;
        }

        /* 深色主题：各站点标记不同（ChatGPT/Grok 用 html.dark，DeepSeek 用 body.dark，
           Gemini 用 dark-theme / data-theme），全部跟随，免得深色底上画出浅色胶囊 */
        html.dark .dscf-msgnav,
        body.dark .dscf-msgnav,
        .dark-theme .dscf-msgnav,
        [data-theme="dark"] .dscf-msgnav {
            --dscf-fg: #e6e8eb;
            --dscf-line: rgba(255, 255, 255, 0.28);
            --dscf-brand: #7a92ff;
            --dscf-nav-bg: rgba(21, 21, 23, 0.6);
            --dscf-nav-bg-solid: #1b1b1d;
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
