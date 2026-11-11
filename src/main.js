import { runtime } from './runtime.js';
import { addCSSClass, addIconFont } from './styles.js';
import { waitFor } from './utils.js';
import { getOriginalAnchors } from './dom.js';
import { rebuild, observeChatList } from './observer.js';
import { initDragAndDrop, clearDropHighlight } from './drag.js';
import { listenDomain, updateSelectedState } from './selection.js';
import { restoreDisplayTitles } from './titles.js';
import { disposeRenameEditor } from './editor.js';
import { cleanupInPlace, removeNewFolderButton, disposeNewFolderEditor, disposeFolderRename } from './render.js';
import { initKatexCopy } from './katex-copy.js';
import { initMessageNav } from './message-nav.js';
import { patchNativeNavBreakpoint } from './native-nav.js';
import { initThinkCollapse, disposeThinkCollapse } from './think-collapse.js';

// 开发热更新可能只重跑入口而不重跑 runtime.js；先回收当前实例再登记本轮清理
if (runtime.initialized) {
    runtime.dispose();
}
runtime.initialized = true;

// 必须在应用读取断点前改写，否则导航已被卸载
patchNativeNavBreakpoint();

runtime.disposers.push(
    clearDropHighlight,
    restoreDisplayTitles,
    disposeRenameEditor,
    cleanupInPlace,
    removeNewFolderButton,
    disposeNewFolderEditor,
    disposeFolderRename,
    disposeThinkCollapse
);
runtime.refreshSelection = updateSelectedState;
runtime.rebuild = rebuild;

// 检测 DeepSeek 前端结构是否变化；变化时只提示不执行，避免脚本报错刷屏
function checkFrontUpdating() {
    const criticalClasses = ['cb86951c', 'dc04ec1d', '_546d736', 'ds-scroll-area'];
    return criticalClasses.some(className => !document.querySelector(`.${className}`));
}


const isDeepSeek = location.hostname === 'chat.deepseek.com';

// 入口：先注入样式，再等侧栏出现会话后原地重排一次，并开始监听变化
function main() {
    addCSSClass();

    // 会话目录依赖 DeepSeek 侧栏结构，其他站点只启用消息导航；
    // 图标字体和公式复制补丁都是 DeepSeek 专属，其他站点注入会被 CSP 拦下并中断初始化
    if (!isDeepSeek) {
        console.log('[DeepSeek 工具箱] 脚本已加载（消息导航）');
        initMessageNav();
        return;
    }

    addIconFont();
    initKatexCopy();

    console.log('[DeepSeek 工具箱] 脚本已加载，等待会话列表…');

    // 思考折叠只依赖消息区结构，不等侧栏，开局就接管
    initThinkCollapse();

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
    // document-start 下 head/body 可能还没解析出来，等 DOM 就绪再注入样式和监听
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
} catch (err) {
    console.error('[DeepSeek 工具箱] 初始化失败', err);
}
