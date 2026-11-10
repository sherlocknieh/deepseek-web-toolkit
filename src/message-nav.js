import { runtime } from './runtime.js';

// 通用消息导航：在消息区右侧画一列圆点，点击跳到对应消息。
// DeepSeek 自带原生导航，这里只在其他站点启用；实现只依赖 DOM，不碰站点内部实例。
//
// 识别规则：
//   消息块 —— 各站点常见的语义标记（data-message-author-role、user-query 等）
//   滚动容器 —— 同时包含多条消息、内容最高的可滚动区块
//   角色 —— 优先读标记，读不到时按提问/回答交替推断

const NAV_ATTR = 'data-dscf-msgnav';
const FLASH_MS = 1600;
const MIN_ENTRIES = 3;

const MESSAGE_SELECTOR = [
    '[data-message-author-role]',
    'user-query',
    'model-response',
    'message-content',
    'article'
].join(',');

const state = {
    scroller: null,
    entries: [],
    signature: '',
    root: null,
    rail: null,
    dots: [],
    toggle: null,
    panel: null,
    list: null,
    rows: [],
    open: false,
    activeKey: null,
    observer: null,
    onScroll: null,
    historyTimer: null,
    href: location.href,
    refreshTimer: null,
    watchTimer: null,
    layoutFrame: 0,
    flashing: new Map()
};

// 取消息正文：去掉按钮和工具栏文案后压成单行，供列表和悬停提示使用
function readText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, svg, [aria-hidden="true"], nav, form').forEach(node => node.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function detectRole(el, index) {
    const author = el.getAttribute('data-message-author-role');
    if (author === 'user') return 'USER';
    if (author === 'assistant') return 'ASSISTANT';

    const tag = el.tagName.toLowerCase();
    if (tag === 'user-query') return 'USER';
    if (tag === 'model-response') return 'ASSISTANT';

    return index % 2 === 0 ? 'USER' : 'ASSISTANT';
}

function getMessageBlocks() {
    return Array.from(document.querySelectorAll(MESSAGE_SELECTOR))
        .filter(el => el.getClientRects().length > 0);
}

// 滚动容器：从消息块往上找同时装有多条消息、内容最高的可滚动区块
function resolveScroller(blocks) {
    let best = null;
    let bestHeight = 0;

    let node = blocks[0]?.parentElement;
    while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) {
            const contains = blocks.filter(block => node.contains(block)).length;
            if (contains >= 2 && node.scrollHeight > bestHeight) {
                best = node;
                bestHeight = node.scrollHeight;
            }
        }
        node = node.parentElement;
    }

    // 结构化标记都识别不到时，退回“最高的可滚动区块”
    return best || Array.from(document.querySelectorAll('*'))
        .filter(el => {
            const style = getComputedStyle(el);
            return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 200;
        })
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
}

// 消息条目：key 用序号，站内消息 DOM 被重建后仍能重新定位
function readEntries() {
    return getMessageBlocks().map((el, index) => ({
        key: String(index),
        el,
        role: detectRole(el, index),
        text: readText(el)
    }));
}

function makeSignature(entries) {
    return entries.map(entry => entry.key + ':' + entry.text.slice(0, 12)).join('|');
}

function isUserEntry(entry) {
    return entry.role === 'USER';
}

function findBlock(entry) {
    if (entry.el && entry.el.isConnected) return entry.el;
    return getMessageBlocks()[Number(entry.key)] || null;
}

function jumpTo(entry) {
    const block = findBlock(entry);
    if (!block) return;

    block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    flashEntry(block);
    setActive(entry.key);
    closePanel();
}

// 跳转后短暂高亮，提示定位到了哪条消息
function flashEntry(block) {
    clearTimeout(state.flashing.get(block));
    block.setAttribute('data-dscf-flash', '1');
    const timer = setTimeout(() => block.removeAttribute('data-dscf-flash'), FLASH_MS);
    state.flashing.set(block, timer);
}

// 圆点高亮跟随滚动：最后一条越过视口上沿的消息就是当前读到的位置
function updateActive() {
    if (!state.entries.length || !state.scroller) return;

    const limit = state.scroller.getBoundingClientRect().top + 96;
    let key = state.entries[0].key;

    for (const entry of state.entries) {
        const block = findBlock(entry);
        if (block && block.getBoundingClientRect().top <= limit) {
            key = entry.key;
        }
    }

    setActive(key);
}

function setActive(key) {
    if (state.activeKey === key) return;
    state.activeKey = key;
    state.dots.forEach(dot => dot.classList.toggle('is-active', dot.dataset.key === key));
    state.rows.forEach(row => row.classList.toggle('is-active', row.dataset.key === key));
}

function scheduleLayout() {
    cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = requestAnimationFrame(() => {
        updateLayout();
        updateRailSpacing();
    });
}

// 导航吸附在消息区右缘，留出滚动条位置；窗口变窄时整体收进视口
function updateLayout() {
    const scroller = state.scroller;
    const root = state.root;
    if (!scroller || !root) return;

    const rect = scroller.getBoundingClientRect();
    const left = Math.min(rect.right, window.innerWidth) - 36;
    const top = Math.max(rect.top + 48, 0);
    const height = Math.max(160, rect.height - 120);

    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
    root.style.height = `${Math.round(height)}px`;
    root.style.setProperty('--dscf-msgnav-height', `${Math.round(height)}px`);
}

// 圆点按可用高度均分间距，消息多时压缩成细线
function updateRailSpacing() {
    if (!state.rail) return;

    const count = state.entries.length;
    const height = parseFloat(getComputedStyle(state.root).getPropertyValue('--dscf-msgnav-height')) || 0;
    const slot = count ? height / count : 0;
    const size = Math.max(2, Math.min(6, slot * 0.6));
    const gap = Math.max(0, Math.min(8, slot - size));

    state.rail.style.gap = `${Math.round(gap * 10) / 10}px`;
    state.dots.forEach(dot => {
        dot.style.height = `${Math.round(size * 10) / 10}px`;
        dot.style.width = `${Math.round(Math.max(2, size) * 10) / 10}px`;
    });
}

function ensureDom() {
    if (state.root) return;

    const root = document.createElement('div');
    root.className = 'dscf-msgnav';
    root.setAttribute(NAV_ATTR, '1');

    const side = document.createElement('div');
    side.className = 'dscf-msgnav-side';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dscf-msgnav-toggle';
    toggle.title = '消息导航';
    toggle.innerHTML = '<i class="fa-solid fa-list-ul"></i>';
    toggle.addEventListener('click', togglePanel);

    const rail = document.createElement('div');
    rail.className = 'dscf-msgnav-rail';

    const panel = document.createElement('div');
    panel.className = 'dscf-msgnav-panel';
    panel.hidden = true;

    const head = document.createElement('div');
    head.className = 'dscf-msgnav-head';

    const list = document.createElement('div');
    list.className = 'dscf-msgnav-list';

    panel.append(head, list);
    side.append(toggle, rail);
    root.append(side, panel);
    document.body.appendChild(root);

    state.root = root;
    state.rail = rail;
    state.toggle = toggle;
    state.panel = panel;
    state.list = list;

    document.addEventListener('mousedown', onDocumentMouseDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('resize', scheduleLayout);
}

function onDocumentMouseDown(event) {
    if (!state.open) return;
    if (state.root && state.root.contains(event.target)) return;
    closePanel();
}

function onDocumentKeyDown(event) {
    if (event.key === 'Escape' && state.open) closePanel();
}

function renderRail() {
    ensureDom();

    state.dots.forEach(dot => dot.remove());
    state.dots = state.entries.map(entry => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'dscf-msgnav-dot';
        dot.classList.toggle('is-active', entry.key === state.activeKey);
        dot.dataset.key = entry.key;
        dot.title = `${isUserEntry(entry) ? '我' : '回答'}：${entry.text || '（无正文）'}`.slice(0, 120);
        dot.addEventListener('click', () => jumpTo(entry));
        state.rail.appendChild(dot);
        return dot;
    });

    state.toggle.classList.toggle('is-active', state.open);
}

function renderList() {
    ensureDom();

    state.rows.forEach(row => row.remove());
    state.rows = state.entries.map((entry, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dscf-msgnav-item';
        row.classList.toggle('is-active', entry.key === state.activeKey);
        row.dataset.key = entry.key;

        const icon = document.createElement('i');
        icon.className = isUserEntry(entry) ? 'fa-solid fa-user' : 'fa-solid fa-robot';

        const text = document.createElement('span');
        text.className = 'dscf-msgnav-text';
        text.textContent = entry.text || '（无正文）';
        text.title = entry.text || '';

        const badge = document.createElement('span');
        badge.className = 'dscf-msgnav-index';
        badge.textContent = String(index + 1);

        row.append(icon, text, badge);
        row.addEventListener('click', () => jumpTo(entry));
        state.list.appendChild(row);
        return row;
    });

    state.panel.querySelector('.dscf-msgnav-head').textContent = `消息导航 · ${state.entries.length}`;
}

function syncVisibility() {
    if (!state.root) return;
    const visible = state.entries.length >= MIN_ENTRIES;
    state.root.classList.toggle('is-visible', visible);
    if (!visible && state.open) closePanel();
}

function togglePanel() {
    if (state.open) {
        closePanel();
        return;
    }
    state.open = true;
    state.panel.hidden = false;
    state.toggle.classList.add('is-active');
    state.rows.find(row => row.dataset.key === state.activeKey)?.scrollIntoView({ block: 'nearest' });
}

function closePanel() {
    state.open = false;
    state.toggle?.classList.remove('is-active');
    if (state.panel) state.panel.hidden = true;
}

function attachScroller(scroller) {
    detachScroller();
    state.scroller = scroller;

    state.onScroll = () => {
        updateActive();
        scheduleLayout();
    };
    scroller.addEventListener('scroll', state.onScroll, { passive: true });

    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(scroller, { childList: true, subtree: true });

    scheduleLayout();
}

function detachScroller() {
    if (state.scroller && state.onScroll) {
        state.scroller.removeEventListener('scroll', state.onScroll);
    }
    state.observer?.disconnect();
    state.observer = null;
    state.scroller = null;
    state.onScroll = null;
}

function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshMessageNav(), 300);
}

// 重建导航：条目清单变化才重画圆点和列表，单纯滚动不触发
export function refreshMessageNav() {
    const entries = readEntries();

    if (entries.length < MIN_ENTRIES) {
        state.entries = entries;
        state.signature = '';
        syncVisibility();
        return;
    }

    const scroller = resolveScroller(entries.map(entry => entry.el));
    if (!scroller) {
        syncVisibility();
        return;
    }

    if (scroller !== state.scroller) attachScroller(scroller);

    const signature = makeSignature(entries);
    if (signature === state.signature) {
        syncVisibility();
        scheduleLayout();
        updateActive();
        return;
    }

    state.signature = signature;
    state.entries = entries;

    renderRail();
    renderList();
    syncVisibility();
    updateLayout();
    updateRailSpacing();
    updateActive();
}

// 消息区随会话加载才出现：还没识别到消息时低频轮询等待，出现后由滚动容器的观察器接手
function scheduleWatch() {
    clearInterval(state.watchTimer);
    state.watchTimer = setInterval(() => {
        if (readEntries().length < MIN_ENTRIES) return;
        clearInterval(state.watchTimer);
        state.watchTimer = null;
        refreshMessageNav();
    }, 800);
}

// 其他站点不加载会话目录，这里自己盯地址栏：SPA 切换会话后重新识别
export function initMessageNav() {
    ensureDom();

    state.historyTimer = setInterval(() => {
        if (location.href === state.href) return;
        state.href = location.href;
        scheduleRefresh();
    }, 700);

    runtime.refreshMessageNav = refreshMessageNav;
    runtime.disposers.push(teardownMessageNav);

    refreshMessageNav();
    if (readEntries().length < MIN_ENTRIES) scheduleWatch();
}

export function teardownMessageNav() {
    detachScroller();

    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    clearInterval(state.watchTimer);
    state.watchTimer = null;
    clearInterval(state.historyTimer);
    state.historyTimer = null;
    cancelAnimationFrame(state.layoutFrame);
    state.flashing.forEach(timer => clearTimeout(timer));
    state.flashing.clear();

    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('resize', scheduleLayout);

    state.root?.remove();
    state.root = null;
    state.rail = null;
    state.toggle = null;
    state.panel = null;
    state.list = null;
    state.dots = [];
    state.rows = [];
    state.open = false;
    state.entries = [];
    state.activeKey = null;
    state.signature = '';

    if (runtime.refreshMessageNav === refreshMessageNav) {
        runtime.refreshMessageNav = null;
    }
}
