import { runtime } from './runtime.js';

// 通用消息导航：复刻 DeepSeek 原生导航——右侧一颗胶囊收成一列横线，悬停展开提问列表，
// 点击跳到对应提问。DeepSeek 自带原生导航，这里只在其他站点启用；实现只依赖 DOM，不碰站点内部实例。
//
// 识别规则：
//   消息块 —— 按站点各自的结构取；没有适配的站点才退回通用语义标记
//   滚动容器 —— 同时包含多条消息、内容最高的可滚动区块
//   角色 —— 优先读站点标记，读不到时按提问/回答交替推断；只把提问放进导航

// 有一条提问就出导航：DeepSeek 原生导航同样单条提问即常显，这里保持一致
const NAV_ATTR = 'data-dscf-msgnav';
const FLASH_MS = 600;
const MIN_ENTRIES = 1;

// 站点适配：每种站点只声明自己的消息块选择器、角色判定、正文范围和滚动容器。
// 不共用一个“全能选择器”，否则外层容器和它的子元素会同时命中，同一条消息被数两次
const SITE_ADAPTERS = [
    {
        hosts: ['chatgpt.com', 'chat.openai.com'],
        // 旧版每段消息带 author-role；新版整轮拆成 unit，角色写在 data-chatgpt-search-unit-key 后缀
        selector: '[data-message-author-role], [data-chatgpt-search-unit-key]',
        role: el => {
            const author = el.getAttribute('data-message-author-role');
            if (author) return author === 'user' ? 'USER' : 'ASSISTANT';
            return /:user$/.test(el.getAttribute('data-chatgpt-search-unit-key') || '') ? 'USER' : 'ASSISTANT';
        },
        // 高亮只画在气泡上：整轮容器是满宽的，画上去会横穿正文
        bubble: el => el.querySelector('.bg-user-message') || el.querySelector('[data-message-author-role="user"]'),
        scroller: 'main'
    },
    {
        hosts: ['gemini.google.com'],
        selector: 'user-query, model-response',
        role: el => (el.tagName.toLowerCase() === 'user-query' ? 'USER' : 'ASSISTANT'),
        // 正文只在气泡内；「你说」这类读屏副本由 readText 统一剔除
        content: el => el.querySelector('div.query-content') || el.querySelector('.query-text') || el.querySelector('message-content') || el,
        // 提问气泡自带圆角底色，光晕要贴着它，不能画在整块 user-query 上
        bubble: el => el.querySelector('.user-query-bubble-with-background')
            || el.querySelector('div.query-text')
            || el.querySelector('div.query-content'),
        scroller: 'infinite-scroller, #chat-history'
    },
    {
        hosts: ['grok.com'],
        // 用户消息和回答都在 response- 前缀的块里，靠 testid 区分角色
        selector: "div[id^='response-']",
        role: el => (el.querySelector('[data-testid="user-message"]') ? 'USER' : 'ASSISTANT'),
        content: el => el.querySelector('.response-content-markdown') || el.querySelector('[data-bubble-text]') || el,
        bubble: el => el.querySelector('[data-testid="user-message"]'),
        scroller: 'main'
    },
    {
        hosts: ['chat.deepseek.com'],
        // 每条消息是一个虚拟列表项；回答里有 .ds-markdown（思考区也在里面），提问只有纯文本气泡。
        // 只在应用没渲染原生导航时启用（见 native-nav.js）
        selector: '[data-virtual-list-item-key]',
        role: el => (el.querySelector('.ds-markdown') ? 'ASSISTANT' : 'USER'),
        content: el => el.querySelector('.ds-message') || el,
        // .ds-message 是满宽的行，气泡是它内部按内容撑开的一层；带附件时图片和文字各占一块，
        // 有正文就落在文字气泡上，纯图片交给圆角图片框兜底
        bubble: el => Array.from(el.querySelectorAll('.ds-message > div'))
            .find(node => (node.innerText || '').trim()),
        scroller: '.ds-scroll-area'
    }
];

// 未适配站点按常见语义标记兜底；去掉嵌套命中由 dropNested 负责
const FALLBACK_SELECTOR = [
    '[data-message-author-role]',
    'user-query',
    'model-response',
    'message-content',
    'article'
].join(',');

// 同一页面内站点不会变化，适配器在加载时定下来
const ADAPTER = resolveAdapter();

function resolveAdapter() {
    const host = location.hostname;
    return SITE_ADAPTERS.find(adapter =>
        adapter.hosts.some(h => host === h || host.endsWith('.' + h))
    ) || null;
}

const state = {
    scroller: null,
    topInset: 0,
    entries: [],
    signature: '',
    root: null,
    list: null,
    rows: [],
    activeKey: null,
    observer: null,
    onScroll: null,
    historyTimer: null,
    href: location.href,
    refreshTimer: null,
    watchTimer: null,
    flashing: new Map()
};

// 取消息正文：先按站点收敛到气泡元素，再去掉按钮和工具栏文案后压成单行
function readText(el) {
    const source = ADAPTER && ADAPTER.content ? ADAPTER.content(el) : el;
    const clone = source.cloneNode(true);
    // 读屏专用文案（Gemini 复述的提问、ChatGPT/Grok 的「你说」）会和正文重复，一并剔除
    clone.querySelectorAll('button, svg, [aria-hidden="true"], nav, form, .sr-only, .cdk-visually-hidden').forEach(node => node.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function detectRole(el, index) {
    const role = ADAPTER && ADAPTER.role ? ADAPTER.role(el) : null;
    if (role) return role;

    const author = el.getAttribute('data-message-author-role');
    if (author === 'user') return 'USER';
    if (author === 'assistant') return 'ASSISTANT';

    const tag = el.tagName.toLowerCase();
    if (tag === 'user-query') return 'USER';
    if (tag === 'model-response') return 'ASSISTANT';

    return index % 2 === 0 ? 'USER' : 'ASSISTANT';
}

// 去掉被其他命中元素包含的节点：容器和子元素同时命中会让同一条消息出现两次
function dropNested(nodes) {
    const matched = new Set(nodes);
    return nodes.filter(el => {
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            if (matched.has(parent)) return false;
        }
        return true;
    });
}

function getMessageBlocks() {
    const selector = (ADAPTER && ADAPTER.selector) || FALLBACK_SELECTOR;
    const blocks = Array.from(document.querySelectorAll(selector))
        .filter(el => el.getClientRects().length > 0);
    return dropNested(blocks);
}

// 滚动容器：优先用站点给定的容器，找不到再从消息块往上找同时装有多条消息、内容最高的可滚动区块
function resolveScroller(blocks) {
    if (ADAPTER && ADAPTER.scroller) {
        const hinted = blocks[0].closest(ADAPTER.scroller);
        if (hinted && hinted.scrollHeight > hinted.clientHeight + 40) return hinted;
    }

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

// 消息条目：只列用户提问，回答不进导航；key 用消息块序号，站内 DOM 被重建后仍能重新定位
function readEntries() {
    return getMessageBlocks()
        .map((el, index) => ({
            key: String(index),
            el,
            role: detectRole(el, index),
            text: readText(el)
        }))
        .filter(isUserEntry);
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

// 跳转落点比悬浮标题再低一点，气泡的上边框不会被标题边缘压住
const JUMP_GAP = 12;

// 站点可能在消息区顶部给悬浮标题留出高度（Grok 的滚动区从视口顶开始、首条消息往下让 128px）：
// 这段留白就是首条消息距滚动原点的距离，跳转时让出来，目标才不会压在悬浮标题下面
function readTopInset(scroller, blocks) {
    if (!blocks.length) return JUMP_GAP;
    const inset = blocks[0].getBoundingClientRect().top
        - scroller.getBoundingClientRect().top + scroller.scrollTop;
    return (inset > 0 && inset < 200 ? inset : 0) + JUMP_GAP;
}

// 跳到目标消息：直接改滚动容器的 scrollTop。停在底部时站点（Grok 已确认）会把平滑滚动
// 逐帧拉回底部，动画整段被吞掉，所以这里不做过渡动画；容器关系不明时才退回 scrollIntoView
function jumpTo(entry) {
    const block = findBlock(entry);
    if (!block) return;

    const scroller = state.scroller;
    if (scroller && scroller.contains(block)) {
        scroller.scrollTop = Math.max(0, block.getBoundingClientRect().top
            - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
            - state.topInset);
    } else {
        block.scrollIntoView({ block: 'start' });
    }

    flashEntry(block);
    setActive(entry.key);
}

// 无正文时把光晕落到包住图片、自己带圆角的那层容器上，否则方框会盖住图片的圆角
function roundedImageBox(block) {
    const img = block.querySelector('img');
    if (!img) return null;
    for (let node = img.parentElement; node && node !== block; node = node.parentElement) {
        if (parseFloat(getComputedStyle(node).borderTopLeftRadius) > 0) return node;
    }
    return img.parentElement;
}

// 跳转后短暂高亮气泡，提示定位到了哪条提问
function flashEntry(block) {
    const bubble = (ADAPTER && ADAPTER.bubble ? ADAPTER.bubble(block) : null) || roundedImageBox(block) || block;
    clearTimeout(state.flashing.get(bubble));
    bubble.setAttribute('data-dscf-flash', '1');
    const timer = setTimeout(() => bubble.removeAttribute('data-dscf-flash'), FLASH_MS);
    state.flashing.set(bubble, timer);
}

// 横线高亮跟随滚动：最后一条越过内容区顶端（悬浮标题之下那条线）的消息就是当前读到的位置
function updateActive() {
    if (!state.entries.length || !state.scroller) return;

    const limit = state.scroller.getBoundingClientRect().top + state.topInset + 1;
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

    state.rows.forEach(row => {
        const active = row.dataset.key === key;
        row.classList.toggle('is-active', active);
        // 悬停展开时把当前项滚进可见范围，列表比胶囊高也不用自己找
        if (active && state.root && state.root.matches(':hover')) {
            row.scrollIntoView({ block: 'nearest' });
        }
    });
}

function ensureDom() {
    if (state.root) return;

    // 结构对齐 DeepSeek 原生导航：底部一层毛玻璃胶囊，上面一层列表；收起时列表透明
    const root = document.createElement('div');
    root.className = 'dscf-msgnav';
    root.setAttribute(NAV_ATTR, '1');

    const pill = document.createElement('div');
    pill.className = 'dscf-msgnav-pill';

    const list = document.createElement('div');
    list.className = 'dscf-msgnav-list';

    const items = document.createElement('div');
    items.className = 'dscf-msgnav-items';
    list.append(items);

    root.append(pill, list);
    document.body.appendChild(root);

    state.root = root;
    state.list = items;
}

function renderItems() {
    ensureDom();

    state.rows.forEach(row => row.remove());
    state.rows = state.entries.map(entry => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dscf-msgnav-item';
        row.classList.toggle('is-active', entry.key === state.activeKey);
        row.dataset.key = entry.key;

        const title = document.createElement('span');
        title.className = 'dscf-msgnav-title';
        title.textContent = entry.text || '（无正文）';
        title.title = entry.text || '';

        const indicator = document.createElement('span');
        indicator.className = 'dscf-msgnav-indicator';
        const line = document.createElement('span');
        line.className = 'dscf-msgnav-line';
        indicator.append(line);

        row.append(title, indicator);
        row.addEventListener('click', () => jumpTo(entry));
        state.list.appendChild(row);
        return row;
    });
}

function syncVisibility() {
    if (!state.root) return;
    state.root.classList.toggle('is-visible', state.entries.length >= MIN_ENTRIES);
}

function attachScroller(scroller) {
    detachScroller();
    state.scroller = scroller;

    state.onScroll = () => updateActive();
    scroller.addEventListener('scroll', state.onScroll, { passive: true });

    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(scroller, { childList: true, subtree: true });
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

// 重建导航：条目清单变化才重画，单纯滚动只更新高亮
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
        // 页面还没排好版时可能暂时找不到滚动容器，隔一会儿再认一次
        scheduleWatch();
        syncVisibility();
        return;
    }

    if (scroller !== state.scroller) attachScroller(scroller);
    state.topInset = readTopInset(scroller, entries.map(entry => entry.el));

    const signature = makeSignature(entries);
    if (signature === state.signature) {
        syncVisibility();
        updateActive();
        return;
    }

    state.signature = signature;
    state.entries = entries;

    renderItems();
    syncVisibility();
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

// 通用导航的启动：DeepSeek 也会调用它（原生导航缺席时兜底），所以这里可重复调用；
// 清理由调用方登记到 runtime.disposers
export function initMessageNav() {
    if (state.root) return;
    ensureDom();

    state.historyTimer = setInterval(() => {
        if (location.href === state.href) return;
        state.href = location.href;
        scheduleRefresh();
    }, 700);

    runtime.refreshMessageNav = refreshMessageNav;

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
    state.flashing.forEach(timer => clearTimeout(timer));
    state.flashing.clear();

    state.root?.remove();
    state.root = null;
    state.list = null;
    state.rows = [];
    state.entries = [];
    state.activeKey = null;
    state.signature = '';
    state.topInset = 0;

    if (runtime.refreshMessageNav === refreshMessageNav) {
        runtime.refreshMessageNav = null;
    }
}
