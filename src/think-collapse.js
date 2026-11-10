import { getPageWindow } from './runtime.js';

// 默认折叠思考：折叠状态是消息组件内部的 state，从外面改不了，
// 只能点应用自己的标题栏来切换。脚本只给已完成的思考块补一次点击。
//
// 判定：
//   思考块 —— 直接含 .ds-think-content 的容器，标题栏是它的第一个子元素
//   已完成 —— 标题不是“正在思考 / 思考中 / Thinking”这类进行中文案
//   用户动过 —— 用户自己点过的思考块不再自动折叠
//
// 流式输出期间 DOM 一直在变，扫描按固定间隔节流，不跟防抖走

const THINK_SELECTOR = '.ds-think-content';
const HEADER_ATTR = 'data-dscf-think';
const ITEM_KEY_ATTR = 'data-virtual-list-item-key';
const WIP_TITLE = /^(正在|思考中|Thinking)/i;
const SCAN_INTERVAL = 200;
const MAX_ATTEMPTS = 3;

// 状态按“会话 + 消息项 key”记账：虚拟列表滚出视野会销毁节点，重新挂载时靠 key 找回，
// 否则用户展开过的思考会在滚回来时被重新折叠。消息项的 key 在不同会话间会重复，
// 所以必须带上会话 id，否则上个会话的选择会串到新会话。没有 key 时退回按节点记
const states = new Map();
const fallbackStates = new WeakMap();

let observer = null;
let timer = null;
let routeKey = '';

function currentRouteKey() {
    const match = location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
    return match ? match[1] : '';
}

function stateOf(wrapper) {
    const item = wrapper.closest(`[${ITEM_KEY_ATTR}]`);
    const key = item && item.getAttribute(ITEM_KEY_ATTR);
    if (!key) {
        if (!fallbackStates.has(wrapper)) fallbackStates.set(wrapper, { touched: false, attempts: 0 });
        return fallbackStates.get(wrapper);
    }
    const fullKey = (routeKey || currentRouteKey()) + '#' + key;
    if (!states.has(fullKey)) states.set(fullKey, { touched: false, attempts: 0 });
    return states.get(fullKey);
}

// 收集展开中的思考块；标题栏必须在容器里、且不是内容本身
function getBlocks() {
    return Array.from(document.querySelectorAll(THINK_SELECTOR))
        .map(content => {
            const wrapper = content.parentElement;
            const header = wrapper && wrapper.firstElementChild;
            if (!wrapper || !header || header.contains(content)) return null;
            return { wrapper, header };
        })
        .filter(Boolean);
}

// 派发真实点击：只改样式不会影响组件状态，下次渲染又会展开
function clickHeader(header) {
    const pageWindow = getPageWindow();
    const MouseEventCtor = pageWindow.MouseEvent || MouseEvent;
    header.dispatchEvent(new MouseEventCtor('click', {
        bubbles: true,
        cancelable: true,
        view: pageWindow
    }));
}

function collapseFinished() {
    getBlocks().forEach(({ wrapper, header }) => {
        header.setAttribute(HEADER_ATTR, '1');

        const state = stateOf(wrapper);
        if (state.touched || state.attempts >= MAX_ATTEMPTS) return;

        // 思考还在输出时保持展开，等标题变成“已思考”再折叠
        const title = (header.textContent || '').trim();
        if (!title || WIP_TITLE.test(title)) return;

        state.attempts += 1;
        clickHeader(header);
    });
}

// 节流而不是防抖：流式输出期间 DOM 持续变化，防抖会把折叠拖到输出结束
function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        collapseFinished();
    }, SCAN_INTERVAL);
}

// 用户点过的块不再自动折叠；脚本自己的合成点击 isTrusted 为 false，不计入
function onDocumentClick(event) {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    const header = target && target.closest(`[${HEADER_ATTR}]`);
    if (header && header.parentElement) stateOf(header.parentElement).touched = true;
}

export function initThinkCollapse() {
    routeKey = currentRouteKey();
    collapseFinished();

    document.addEventListener('click', onDocumentClick, true);
    observer = new MutationObserver(() => {
        // 会话切换后消息项 key 会从头复用，清掉旧会话的记录
        const next = currentRouteKey();
        if (next !== routeKey) {
            routeKey = next;
            states.clear();
        }
        schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function disposeThinkCollapse() {
    clearTimeout(timer);
    timer = null;
    document.removeEventListener('click', onDocumentClick, true);
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    states.clear();
    // 标记只服务本实例，热更新后重新扫描
    document.querySelectorAll(`[${HEADER_ATTR}]`).forEach(header => {
        header.removeAttribute(HEADER_ATTR);
    });
}
