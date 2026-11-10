import { runtime } from './runtime.js';
import { addCSSClass } from './styles.js';
import { waitFor } from './utils.js';
import { getOriginalAnchors } from './dom.js';
import { rebuild, observeChatList } from './observer.js';
import { initDragAndDrop, clearDropHighlight } from './drag.js';
import { listenDomain, updateSelectedState } from './selection.js';
import { restoreDisplayTitles } from './titles.js';
import { disposeRenameEditor } from './editor.js';
import { cleanupInPlace, removeNewFolderButton, disposeNewFolderEditor, disposeFolderRename } from './render.js';
import { initKatexCopy } from './katex-copy.js';

// 开发热更新可能只重跑入口而不重跑 runtime.js；先回收当前实例再登记本轮清理
if (runtime.initialized) {
    runtime.dispose();
}
runtime.initialized = true;

runtime.disposers.push(clearDropHighlight, restoreDisplayTitles, disposeRenameEditor, cleanupInPlace, removeNewFolderButton, disposeNewFolderEditor, disposeFolderRename);
runtime.refreshSelection = updateSelectedState;
runtime.rebuild = rebuild;


// 检测 DeepSeek 前端结构是否变化；变化时只提示不执行，避免脚本报错刷屏
function checkFrontUpdating() {
    const criticalClasses = ['cb86951c', 'dc04ec1d', '_546d736', 'ds-scroll-area'];
    return criticalClasses.some(className => !document.querySelector(`.${className}`));
}


// 入口：先修好公式复制，再等侧栏出现会话后原地重排一次，并开始监听变化
function main() {
    console.log('[DeepSeek 工具箱] 脚本已加载，等待会话列表…');
    addCSSClass();
    initKatexCopy();

    waitFor(() => getOriginalAnchors().length > 0, () => {
        if (checkFrontUpdating()) {
            console.warn('Deepseek 前端已更新，会话目录暂不生效（公式复制不受影响）。');
            return;
        }

        // 强制重排，兼容只重跑入口的热更新
        rebuild(true);
        observeChatList();
        initDragAndDrop();
        listenDomain();
        console.log(`[DeepSeek 工具箱] 已初始化，会话数 ${getOriginalAnchors().length}`);
    });
}

try {
    main();
} catch (err) {
    console.error('[DeepSeek 工具箱] 初始化失败', err);
}
