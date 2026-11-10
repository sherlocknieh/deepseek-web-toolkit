import { unsafeWindow } from '$';
import { RUNTIME_KEY } from './constants.js';

// 开发热更新可能重跑入口：先回收上一轮实例，避免界面和监听叠加
const previousRuntime = window[RUNTIME_KEY];
if (previousRuntime && typeof previousRuntime.dispose === 'function') {
    previousRuntime.dispose();
}

// 本轮运行时状态；disposers 由入口登记，dispose 统一清理
export const runtime = {
    observer: null,
    timer: null,
    onRouteChange: null,
    drag: null,
    dropKey: null,
    moving: false,
    dragAbort: null,
    // 新建文件夹的内联输入状态：{ draft }，由 render 在重排时重建输入行
    newFolder: null,
    // 目录重命名的行内输入状态：{ path, draft, focusPending }，重排时该行重新渲染成输入框
    folderRename: null,
    pinning: new Set(),
    disposers: [],
    refreshSelection: null,
    refreshMessageNav: null,
    rebuild: null,
    initialized: false,
    dispose: null
};

window[RUNTIME_KEY] = runtime;

// 断开监听、取消定时器并执行各模块登记的清理函数
runtime.dispose = () => {
    if (runtime.timer) {
        clearTimeout(runtime.timer);
        runtime.timer = null;
    }
    if (runtime.observer) {
        runtime.observer.disconnect();
        runtime.observer = null;
    }
    if (runtime.onRouteChange) {
        window.removeEventListener('popstate', runtime.onRouteChange);
        window.removeEventListener('hashchange', runtime.onRouteChange);
        runtime.onRouteChange = null;
    }
    if (runtime.dragAbort) {
        runtime.dragAbort.abort();
        runtime.dragAbort = null;
    }
    runtime.drag = null;
    runtime.moving = false;
    runtime.newFolder = null;
    runtime.pinning.clear();

    const disposers = runtime.disposers;
    runtime.disposers = [];
    disposers.forEach(fn => {
        try {
            fn();
        } catch (err) {
            console.warn('[DeepSeek 工具箱] 清理失败', err);
        }
    });
};

// 页面 window：兼容 Tampermonkey/Violentmonkey 的 unsafeWindow，dev 模式下直接用 window
export function getPageWindow() {
    return typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
}
