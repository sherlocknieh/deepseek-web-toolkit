import { runtime } from './runtime.js';

// 通用消息导航：复刻 DeepSeek 原生导航——右侧一颗胶囊收成一列横线，悬停展开提问列表，
// 点击条目跳到对应提问，条目上的箭头按钮跳到紧随其后的回答。所有站点（含 DeepSeek）
// 都用这一套，DeepSeek 的原生导航由样式隐藏；实现只依赖 DOM，不碰站点内部实例。
//
// 识别规则：
//   消息块 —— 按站点各自的结构取；没有适配的站点才退回通用语义标记
//   滚动容器 —— 同时包含多条消息、内容最高的可滚动区块
//   角色 —— 优先读站点标记，读不到时按提问/回答交替推断；只把提问放进导航，
//           每条提问再记下紧随其后那条回答的序号，供条目上的箭头按钮跳转

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
        // 每条消息是一个虚拟列表项；回答里有 .ds-markdown（思考区也在里面），提问只有纯文本气泡
        selector: '[data-virtual-list-item-key]',
        role: el => (el.querySelector('.ds-markdown') ? 'ASSISTANT' : 'USER'),
        content: el => el.querySelector('.ds-message') || el,
        // .ds-message 是满宽的行，气泡是它内部按内容撑开的一层；带附件时图片和文字各占一块，
        // 有正文就落在文字气泡上，纯图片交给圆角图片框兜底
        bubble: el => Array.from(el.querySelectorAll('.ds-message > div'))
            .find(node => (node.innerText || '').trim()),
        scroller: '.ds-scroll-area'
    },
    {
        hosts: ['sichang.xyz'],
        // 用户气泡正文是 .chat-message-copy，回答渲染进 .chat-message-markdown；
        // 两个都是站点自己的语义类名，比外层那串 Tailwind 组合类稳定
        selector: '.chat-message-markdown, .chat-message-copy',
        // 角色以气泡底色为准：回答是 bg-bubble-assistant，用户是 bg-bubble-user；
        // 短回答万一也走 .chat-message-copy，光看类名会认错
        role: el => {
            if (el.closest('[class*="bg-bubble-assistant"]')) return 'ASSISTANT';
            if (el.closest('[class*="bg-bubble-user"]')) return 'USER';
            return el.classList.contains('chat-message-markdown') ? 'ASSISTANT' : 'USER';
        },
        content: el => el,
        // 光晕贴气泡：用户是 bg-bubble-user，回答是 bg-bubble-assistant/90，按前缀统一找
        bubble: el => el.closest('[class*="bg-bubble-"]'),
        scroller: '[data-slot="scroll-area-viewport"]'
    },
    {
        hosts: ['venice.ai'],
        // 两种聊天页结构不同，一次收全：
        // agentic 页每条消息是 [role=group]（用户）或 .assistant（回答）；
        // 经典聊天页每条消息是 [data-message-id]，回答里嵌 .assistant
        selector: '.minds-chat-scroll-root [role="group"], .minds-chat-scroll-root .assistant, [data-message-id]',
        role: el => {
            if (el.matches('.assistant') || el.querySelector('.assistant')) return 'ASSISTANT';
            const box = el.querySelector('[data-message-content]');
            return box && box.getAttribute('data-role') === 'assistant' ? 'ASSISTANT' : 'USER';
        },
        content: el => el.querySelector('.assistant')
            || el.querySelector('[data-testid="user-message"]')
            || el.querySelector('[data-message-content="true"]')
            || el.querySelector('.assistant-content')
            || el,
        bubble: el => el.querySelector('.assistant')
            || el.querySelector('[data-testid="user-message"]')
            || el.querySelector('.assistant-content'),
        // 经典聊天的滚动容器是个只带内联样式的 div，没有类名，只能按最近的滚动祖先找
        scroller: scrollableAncestor
    }
];

// 最近的滚动祖先：站点没给稳定类名时用它兜底；不要求已经溢出，
// 短会话也要认下容器，导航才能挂上去
function scrollableAncestor(el) {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
}

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
    halo: null,
    haloToken: 0
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

// 站点声明的滚动容器：可以是选择器，也可以是按消息块现算的函数
function hintScroller(block) {
    if (!ADAPTER || !ADAPTER.scroller) return null;
    return typeof ADAPTER.scroller === 'function'
        ? ADAPTER.scroller(block)
        : block.closest(ADAPTER.scroller);
}

// 滚动容器：优先用站点给定的容器，找不到再从消息块往上找同时装有多条消息、内容最高的可滚动区块
function resolveScroller(blocks) {
    const hinted = hintScroller(blocks[0]);
    // 短会话内容可能尚未溢出，但仍需要用站点指定的容器承载导航和后续消息变化
    if (hinted) return hinted;

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

    // 结构化标记都识别不到时，退回“最高的可滚动区块”。必须真的装着消息，
    // 否则会挑中侧栏之类的滚动区，跳转就落到不相关的容器上
    return best || Array.from(document.querySelectorAll('*'))
        .filter(el => {
            const style = getComputedStyle(el);
            return /(auto|scroll)/.test(style.overflowY)
                && el.scrollHeight > el.clientHeight + 200
                && blocks.some(block => el.contains(block));
        })
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
}

// 消息条目：只列用户提问，回答不进导航；key 用消息块序号，站内 DOM 被重建后仍能重新定位。
// 每条提问顺带记住紧随其后的回答块（序号 + 元素）：回答可能晚于提问出现，签名里带上它，
// 回答一渲染出来旧条目就会重画，箭头按钮随之启用
function readEntries() {
    const blocks = getMessageBlocks().map((el, index) => ({
        key: String(index),
        el,
        role: detectRole(el, index),
        text: readText(el)
    }));

    return blocks
        .map((entry, index) => {
            if (!isUserEntry(entry)) return null;
            const next = blocks[index + 1];
            const reply = next && next.role === 'ASSISTANT' ? next : null;
            return {
                ...entry,
                replyKey: reply ? reply.key : null,
                replyEl: reply ? reply.el : null
            };
        })
        .filter(Boolean);
}

function makeSignature(entries) {
    return entries
        .map(entry => entry.key + ':' + (entry.replyKey || '-') + ':' + entry.text.slice(0, 12))
        .join('|');
}

function isUserEntry(entry) {
    return entry.role === 'USER';
}

function findBlock(entry) {
    return findBlockByKey(entry.key, entry.el);
}

function findBlockByKey(key, el) {
    if (el && el.isConnected) return el;
    return getMessageBlocks()[Number(key)] || null;
}

// 跳转落点比悬浮标题再低一点：气泡边缘的光晕向外扩 16px，留出的距离要盖住这段，
// 否则气泡虽然完整，光晕的上半圈会被滚动区顶端裁成一条直线
const JUMP_GAP = 20;

// 站点可能在消息区顶部给悬浮标题留出高度（Grok 的滚动区从视口顶开始、首条消息往下让 128px）：
// 这段留白就是首条消息距滚动原点的距离，跳转时让出来，目标才不会压在悬浮标题下面
function readTopInset(scroller, blocks) {
    if (!blocks.length) return JUMP_GAP;
    const inset = blocks[0].getBoundingClientRect().top
        - scroller.getBoundingClientRect().top + scroller.scrollTop;
    return (inset > 0 && inset < 200 ? inset : 0) + JUMP_GAP;
}

// 取元素自己的滚动父级：站点可能把滚动交给内层元素，state.scroller 未必包住目标
function scrollParentOf(el) {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return null;
}

// 跳到目标消息：直接改滚动容器的 scrollTop。停在底部时站点（Grok 已确认）会把平滑滚动
// 逐帧拉回底部，动画整段被吞掉，所以这里不做过渡动画；容器关系不明时才退回 scrollIntoView
function jumpTo(entry) {
    jumpToKey(entry.key, entry.el, entry.key);
}

// 跳到对应回答：高亮仍落在提问条目上，导航表示的是「当前读到哪一问」
function jumpToReply(entry) {
    if (!entry.replyKey) return;
    jumpToKey(entry.replyKey, entry.replyEl, entry.key);
}

function jumpToKey(key, el, activeKey) {
    const block = findBlockByKey(key, el);
    if (!block) return;

    const scroller = state.scroller && state.scroller.contains(block)
        ? state.scroller
        : scrollParentOf(block);
    if (scroller) {
        // 换用兜底容器时 topInset 得按它自己的留白重算，直接沿用别的容器会偏出到头
        const inset = scroller === state.scroller ? state.topInset : readTopInset(scroller, [block]);
        scroller.scrollTop = Math.max(0, block.getBoundingClientRect().top
            - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
            - inset);
    } else {
        block.scrollIntoView({ block: 'start' });
    }

    flashEntry(block);
    setActive(activeKey);
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

// 光晕叠层：气泡外面的包裹层带裁剪，画在气泡自身上的外发光会被切掉上沿；
// 这层固定定位在 body 下，按气泡的实际矩形对齐，站点的裁剪管不到它
function ensureHalo() {
    if (state.halo && state.halo.isConnected) return state.halo;
    const halo = document.createElement('div');
    halo.className = 'dscf-halo';
    halo.setAttribute('aria-hidden', 'true');
    document.body.appendChild(halo);
    state.halo = halo;
    return halo;
}

// 跳转后短暂高亮气泡，提示定位到了哪条提问
function flashEntry(block) {
    const bubble = (ADAPTER && ADAPTER.bubble ? ADAPTER.bubble(block) : null) || roundedImageBox(block) || block;
    const halo = ensureHalo();
    const radius = getComputedStyle(bubble).borderRadius;

    // 光晕只是个描边层，位置和尺寸完全跟着气泡的矩形走
    const place = () => {
        const rect = bubble.getBoundingClientRect();
        halo.style.left = `${rect.left}px`;
        halo.style.top = `${rect.top}px`;
        halo.style.width = `${rect.width}px`;
        halo.style.height = `${rect.height}px`;
        halo.style.borderRadius = radius;
    };

    // 连点时只保留最后一次：旧的那圈光晕立刻退场，不会和新位置互相拉扯
    const token = (state.haloToken += 1);
    place();
    halo.getAnimations().forEach(animation => animation.cancel());
    const fade = halo.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: FLASH_MS, easing: 'ease-out' }
    );
    // 标签页被冻结时动画不推进，兜底再收一次，光晕不会一直挂着
    setTimeout(() => fade.cancel(), FLASH_MS + 200);

    // 闪的这段时间跟着滚动走，光晕不会停在原地；动画结束后透明度回到样式表里的 0
    const follow = () => {
        if (token !== state.haloToken || fade.playState !== 'running') return;
        if (!bubble.isConnected) {
            fade.cancel();
            return;
        }
        place();
        requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
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

    // 收起时只有一列横线，展开后叠一层实色列表；容器高度随条目数量变化
    const root = document.createElement('div');
    root.className = 'dscf-msgnav';
    root.setAttribute(NAV_ATTR, '1');

    const list = document.createElement('div');
    list.className = 'dscf-msgnav-list';

    const items = document.createElement('div');
    items.className = 'dscf-msgnav-items';
    list.append(items);

    root.append(list);
    document.body.appendChild(root);

    state.root = root;
    state.list = items;
}

// 跳到回答的箭头图标：内联 SVG，不依赖 Font Awesome（其他站点不加载图标字体）
const REPLY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 3.5v8.4m0 0 3.3-3.3M8 11.9 4.7 8.6" fill="none" stroke="currentColor"'
    + ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderItems() {
    ensureDom();

    state.rows.forEach(row => row.remove());
    state.rows = state.entries.map(entry => {
        // 行本身是容器：一个按钮跳提问，另一个按钮跳回答，按钮不能互相嵌套
        const row = document.createElement('div');
        row.className = 'dscf-msgnav-item';
        row.classList.toggle('is-active', entry.key === state.activeKey);
        row.dataset.key = entry.key;

        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'dscf-msgnav-jump';

        const title = document.createElement('span');
        title.className = 'dscf-msgnav-title';
        title.textContent = entry.text || '（无正文）';
        title.title = entry.text || '';

        const indicator = document.createElement('span');
        indicator.className = 'dscf-msgnav-indicator';
        const line = document.createElement('span');
        line.className = 'dscf-msgnav-line';
        indicator.append(line);

        jump.append(title, indicator);
        jump.addEventListener('click', () => jumpTo(entry));

        const reply = document.createElement('button');
        reply.type = 'button';
        reply.className = 'dscf-msgnav-reply';
        reply.disabled = !entry.replyKey;
        reply.title = entry.replyKey ? '跳到对应回答' : '还没有回答';
        reply.setAttribute('aria-label', reply.title);
        reply.innerHTML = REPLY_ICON;
        if (entry.replyKey) reply.addEventListener('click', () => jumpToReply(entry));

        row.append(jump, reply);
        state.list.appendChild(row);
        return row;
    });
}

function syncVisibility() {
    if (!state.root) return;
    state.root.classList.toggle('is-visible', state.entries.length >= MIN_ENTRIES);
}

function clearMessageNav() {
    detachScroller();
    state.entries = [];
    state.signature = '';
    state.activeKey = null;
    state.topInset = 0;
    state.rows.forEach(row => row.remove());
    state.rows = [];
    syncVisibility();
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
        clearMessageNav();
        return;
    }

    const scroller = resolveScroller(entries.map(entry => entry.el));
    if (!scroller) {
        // 页面还没排好版时可能暂时找不到滚动容器，隔一会儿再认一次
        clearMessageNav();
        scheduleWatch();
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

// 通用导航的启动：可重复调用，清理由调用方登记到 runtime.disposers
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
    state.haloToken += 1;
    state.halo?.remove();
    state.halo = null;

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
