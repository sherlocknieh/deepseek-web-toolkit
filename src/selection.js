import { RUNTIME_KEY } from './constants.js';
import { runtime } from './runtime.js';
import { getScrollArea, getAnchorSelectedClass, extractIdFromUrl, isSubtreeHidden } from './dom.js';
import { getChatTitle } from './titles.js';
import { parseChatPath } from './path.js';

// 从地址栏取当前会话 id，同步原始会话项和折叠目录的高亮
export function updateSelectedState() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    const selectedClass = getAnchorSelectedClass();
    const chatId = extractIdFromUrl(location.href);

    scrollArea.querySelectorAll('a[href^="/a/chat/s/"]').forEach(anchor => {
        anchor.classList.remove(selectedClass);
    });
    scrollArea.querySelectorAll('.dscf-folder-row').forEach(row => {
        row.classList.remove(selectedClass);
    });

    if (!chatId) return;

    const activeAnchor = scrollArea.querySelector(`a[href="/a/chat/s/${chatId}"]`);
    if (!activeAnchor) return;

    activeAnchor.classList.add(selectedClass);

    // 当前会话被折叠在目录里时，高亮最深的可见祖先目录，避免侧栏看不出当前会话在哪
    if (!isSubtreeHidden(activeAnchor)) return;

    const parsed = parseChatPath(getChatTitle(activeAnchor));
    if (!parsed) return;

    const fullPath = parsed.folderPath.join('/');
    const visibleRows = Array.from(scrollArea.querySelectorAll('.dscf-folder-row')).filter(row =>
        !isSubtreeHidden(row) &&
        (fullPath === row.dataset.path || fullPath.startsWith(row.dataset.path + '/'))
    );

    if (visibleRows.length) {
        visibleRows[visibleRows.length - 1].classList.add(selectedClass);
    }
}

// 监听 SPA 路由变化，切换会话、前进后退时让高亮跟随
export function listenDomain() {
    // 路由事件用固定引用注册，热更新时由 runtime.dispose 移除
    runtime.onRouteChange = () => updateSelectedState();
    window.addEventListener('popstate', runtime.onRouteChange);
    window.addEventListener('hashchange', runtime.onRouteChange);

    // history 补丁在页面生命周期内只打一次，内部转发到当前实例
    if (!window.__dscfHistoryPatched) {
        window.__dscfHistoryPatched = true;

        ["pushState", "replaceState"].forEach(fn => {
            const orig = history[fn];
            history[fn] = function(...args) {
                const ret = orig.apply(this, args);
                window[RUNTIME_KEY]?.refreshSelection?.();
                return ret;
            };
        });
    }

    updateSelectedState();
}
