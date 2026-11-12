// 注入目录行和导航样式；列表重排只依赖 flex 的 order，不改动会话项本身
export function addCSSClass() {
    // 热更新时先移除旧样式，避免重复注入
    document.getElementById('dscf-style')?.remove();

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

        /* 通用消息导航（所有站点；DeepSeek 的原生导航已隐藏）：几何照搬原生导航——
           右侧固定 34×300，收起时只露一颗 34×292 的毛玻璃胶囊和一列横线；
           悬停后换成 240 宽、按内容高度垂直居中的实色提问列表 */
        .dscf-msgnav {
            --dscf-nav-bg: rgba(255, 255, 255, 0.8);
            --dscf-nav-solid: #ffffff;
            --dscf-nav-border: transparent;
            --dscf-nav-shadow: 0 0 1px 0 rgba(0, 0, 0, 0.2), 0 0 4px 0 rgba(0, 0, 0, 0.02), 0 12px 32px 0 rgba(0, 0, 0, 0.08);
            --dscf-nav-title: #81858c;
            --dscf-nav-hover: #0f1115;
            --dscf-nav-line: rgba(0, 0, 0, 0.16);
            --dscf-nav-active: #3964fe;
            position: fixed;
            top: 50%;
            right: 16px;
            transform: translateY(-50%);
            width: 34px;
            height: 300px;
            z-index: 40;
            display: none;
            user-select: none;
        }

        .dscf-msgnav.is-visible {
            display: block;
        }

        /* 窄屏也让出位置而不是整个隐藏：收起时只是右侧一条 34px 的胶囊，展开是悬停操作，
           压住正文的范围有限，隐藏反而让窄屏用户完全用不到导航 */

        /* 胶囊底色单独一层：收起时只有它可见，展开后被列表的实色背景盖住 */
        .dscf-msgnav-pill {
            position: absolute;
            top: 50%;
            right: 0;
            transform: translateY(-50%);
            width: 34px;
            height: calc(100% - 8px);
            border-radius: 16px;
            transition: opacity 0.2s ease;
        }

        /* 展开后由列表的实色背景接管，避免胶囊在列表上下露出半截 */
        .dscf-msgnav:hover .dscf-msgnav-pill,
        .dscf-msgnav:has(:focus-visible) .dscf-msgnav-pill {
            opacity: 0;
        }

        /* 列表宽度固定 240：收起时透明、只漏出右侧横线，展开时条目不再横向跳动 */
        .dscf-msgnav-list {
            position: absolute;
            top: 50%;
            right: 0;
            transform: translateY(-50%);
            display: flex;
            flex-direction: column;
            width: 240px;
            max-height: 100%;
            box-sizing: border-box;
            border: 1px solid transparent;
            border-radius: 16px;
            overflow: hidden;
            pointer-events: none;
            transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .dscf-msgnav:hover .dscf-msgnav-list,
        .dscf-msgnav:has(:focus-visible) .dscf-msgnav-list {
            background-color: var(--dscf-nav-solid);
            border-color: var(--dscf-nav-border);
            box-shadow: var(--dscf-nav-shadow);
            pointer-events: auto;
        }

        /* 列表高度随条目走，最多撑满胶囊；条目整体在胶囊里垂直居中 */
        .dscf-msgnav-items {
            flex: 0 1 auto;
            max-height: 290px;
            padding: 15px 6px 15px 24px;
            box-sizing: border-box;
            overflow-y: auto;
            scrollbar-width: none;
        }

        .dscf-msgnav-items::-webkit-scrollbar {
            width: 0;
        }

        /* 一项一条消息：标题靠左、横线贴右；收起时标题透明，只留横线 */
        .dscf-msgnav-item {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: 100%;
            height: 30px;
            padding: 0;
            border: 0;
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
            color: var(--dscf-nav-title);
            opacity: 0;
            transition: opacity 0.1s ease, color 0.2s ease;
        }

        .dscf-msgnav:hover .dscf-msgnav-title,
        .dscf-msgnav:has(:focus-visible) .dscf-msgnav-title {
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
            background-color: var(--dscf-nav-line);
            transition: background-color 0.2s ease, transform 0.2s ease;
        }

        /* 悬停条目：标题和横线一起提到正文色 */
        .dscf-msgnav-item:hover .dscf-msgnav-line {
            background-color: var(--dscf-nav-hover);
        }

        .dscf-msgnav-item:hover .dscf-msgnav-title {
            color: var(--dscf-nav-hover);
        }

        .dscf-msgnav-item.is-active .dscf-msgnav-line {
            background-color: var(--dscf-nav-active);
            transform: scale(1.5);
        }

        .dscf-msgnav-item.is-active .dscf-msgnav-title {
            color: var(--dscf-nav-active);
            font-weight: 500;
        }

        /* 深色主题：各站点标记不同（ChatGPT/Grok 用 html.dark，DeepSeek 用 body.dark，
           Gemini 用 dark-theme / data-theme），全部跟随，免得深色底上画出浅色胶囊 */
        html.dark .dscf-msgnav,
        body.dark .dscf-msgnav,
        .dark-theme .dscf-msgnav,
        [data-theme="dark"] .dscf-msgnav {
            --dscf-nav-bg: rgba(21, 21, 23, 0.6);
            --dscf-nav-solid: #232324;
            --dscf-nav-border: rgba(255, 255, 255, 0.06);
            --dscf-nav-title: #adb2b8;
            --dscf-nav-hover: #f9fafb;
            --dscf-nav-line: rgba(255, 255, 255, 0.2);
            --dscf-nav-active: #679efe;
        }

        /* 跳转目标的气泡边缘发光：只画光圈不铺底色，正文颜色不受影响；
           时长与 message-nav.js 的 FLASH_MS 一致，圆角沿用气泡自己的 */
        [data-dscf-flash] {
            animation: dscf-flash 0.6s ease-out;
        }

        @keyframes dscf-flash {
            from {
                box-shadow: 0 0 0 2px rgba(103, 112, 254, 0.7), 0 0 16px 4px rgba(103, 112, 254, 0.45);
            }
            to {
                box-shadow: 0 0 0 2px rgba(103, 112, 254, 0), 0 0 0 0 rgba(103, 112, 254, 0);
            }
        }

        /* DeepSeek 原生消息导航由通用导航完全替代：直接隐藏，避免两套胶囊并存 */
        [style*="--scroll-nav-page-padding"] {
            display: none !important;
        }

        /* 窄屏给消息列表补右内边距，避开右上常显的通用导航。应用在 768px 处把列表
           外边距从 44px 收到 20px，这里把下限同步从 14px 提到 38px，右侧总留白
           全程都是 58px，缩放跨断点不再突然变宽 */
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

// 目录行靠 Font Awesome 画文件夹图标；其他站点只用内联样式，不加载外部字体
export function addIconFont() {
    document.getElementById('dscf-fontawesome')?.remove();

    const iconLink = document.createElement('link');
    iconLink.id = 'dscf-fontawesome';
    iconLink.rel = 'stylesheet';
    iconLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(iconLink);
}
