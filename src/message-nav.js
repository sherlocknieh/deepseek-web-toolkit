import { runtime } from './runtime.js';
import { storageGet, storageSet } from './storage.js';
import { NAV_POSITION_KEY } from './constants.js';

// 通用消息导航：复刻 DeepSeek 原生导航——右侧一颗胶囊收成一列横线，悬停展开提问列表；
// 每个提问一行，回答各占一行缩进折叠在提问下，点击提问展开/收起并跳转，点击回答跳到该条。
// 所有站点（含 DeepSeek）都用这一套，DeepSeek 的原生导航由样式隐藏；实现只依赖 DOM，不碰站点内部实例。
//
// 识别规则：
//   消息块 —— 按站点各自的结构取；没有适配的站点才退回通用语义标记
//   滚动容器 —— 同时包含多条消息、内容最高的可滚动区块
//   角色 —— 优先读站点标记，读不到时按提问/回答交替推断；导航列出提问，
//           提问后面连续的每条回答各记一条，供展开与跳转
//   身份 —— 站点标识优先，其次按元素本身与「角色+正文」认回同一条；
//           虚拟列表只挂载可视区，已发现的消息累积下来，滚到哪儿补到哪儿

// 有一条提问就出导航：DeepSeek 原生导航同样单条提问即常显，这里保持一致
const NAV_ATTR = 'data-dscf-msgnav';
const FLASH_MS = 600;
// 松手后滑向吸附边的时长，与样式里的 is-flying 过渡保持一致
const NAV_FLY_MS = 260;
const NAV_EDGE = 16;
const MIN_ENTRIES = 1;
// 站点给消息块的稳定标识：有它就能跨虚拟列表的挂载/卸载认回同一条
const KEY_ATTRS = ['data-virtual-list-item-key', 'data-message-id', 'data-chatgpt-search-unit-key'];

// 元素身份：站点没给标识时靠元素本身（WeakMap）和「角色+正文」认回同一条；
// 切会话时整体换新，免得把上一个会话的消息带过来
let identity = createIdentity();

function createIdentity() {
    return { nextId: 0, byEl: new WeakMap() };
}

// DeepSeek 回答正文的根：正文和思考栏分开挂，专用容器里不含思考栏；
// 老版本没有这层时退回「最外层、不在思考区里的 .ds-markdown」
function deepseekAnswerRoots(el) {
    const body = el.querySelector('.ds-assistant-message-main-content');
    if (body) return [body];
    return Array.from(el.querySelectorAll('.ds-markdown'))
        .filter(node => !node.parentElement.closest('.ds-markdown')
            && !node.closest('.ds-think-content'));
}

// 站点适配：每种站点只声明自己的消息块选择器、角色判定、正文范围和滚动容器。
// 不共用一个“全能选择器”，否则外层容器和它的子元素会同时命中，同一条消息被数两次
const SITE_ADAPTERS = [
    {
        hosts: ['chatgpt.com', 'chat.openai.com'],
        // 长会话只挂载可视区附近的消息：没读到的旧条目不能直接当删除
        windowed: true,
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
        // infinite-scroller 分片渲染
        windowed: true,
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
        // 站点可能分片渲染，保守按窗口化处理：只裁窗口内部缺失的条目
        windowed: true,
        // 用户消息和回答都在 response- 前缀的块里，靠 testid 区分角色
        selector: "div[id^='response-']",
        role: el => (el.querySelector('[data-testid="user-message"]') ? 'USER' : 'ASSISTANT'),
        content: el => el.querySelector('.response-content-markdown') || el.querySelector('[data-bubble-text]') || el,
        bubble: el => el.querySelector('[data-testid="user-message"]'),
        scroller: 'main'
    },
    {
        hosts: ['chat.deepseek.com'],
        // 虚拟列表只挂载可视区附近的消息
        windowed: true,
        // 每条消息是一个虚拟列表项；回答里有 .ds-markdown（思考区也在里面），提问只有纯文本气泡
        selector: '[data-virtual-list-item-key]',
        role: el => (el.querySelector('.ds-markdown') ? 'ASSISTANT' : 'USER'),
        // 预览只读回答正文：思考栏（「已思考（用时 1 秒）」）在正文容器外面，
        // 折叠后思考内容还会从 DOM 消失，靠剔除 .ds-think-content 去不干净
        content: el => deepseekAnswerRoots(el)[0] || el.querySelector('.ds-message') || el,
        // .ds-message 是满宽的行，气泡是它内部按内容撑开的一层；带附件时图片和文字各占一块，
        // 有正文就落在文字气泡上，纯图片交给圆角图片框兜底
        bubble: el => Array.from(el.querySelectorAll('.ds-message > div'))
            .find(node => (node.innerText || '').trim()),
        // 回答的跳转落点：消息块顶端是思考栏，对齐它只会看到「已思考」标题，
        // 正文被推到下面。从正文根的首个子元素开始，光晕则圈住整块正文容器
        replyAnchor: el => {
            const [root] = deepseekAnswerRoots(el);
            return root && (root.firstElementChild || root);
        },
        // 高亮范围：正文容器本身；老版本没有容器时退回锚点（第一段正文）
        replyBubble: el => deepseekAnswerRoots(el)[0] || null,
        scroller: '.ds-scroll-area'
    },
    {
        hosts: ['sichang.xyz'],
        // 整段 DOM 常驻：本轮没读到的旧消息就是被删了，两端也一起裁掉
        windowed: false,
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
        // 两种聊天页都可能分片渲染，保守按窗口化处理
        windowed: true,
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
    // 会话内已发现的消息（提问与各条回答），按文档顺序累积；虚拟列表卸载掉的也留着，
    // 滚动再发现时按稳定 key 归位，而不是整列重排
    items: [],
    itemsByKey: new Map(),
    signature: '',
    root: null,
    list: null,
    rows: [],
    rowsByKey: new Map(),
    // 每个提问连同它的回答子条目编成一组；列表面板里放的是分组而不是散行
    groups: [],
    groupsByKey: new Map(),
    activeKey: null,
    observer: null,
    onScroll: null,
    historyTimer: null,
    href: location.href,
    refreshTimer: null,
    watchTimer: null,
    halo: null,
    haloToken: 0,
    // 跳转后高亮锁在选中条目上，等用户主动滚动才重新按位置判定
    jumpLocked: false,
    // 用户已动手要滚，等下一次滚动事件到来才解锁
    awaitScroll: false,
    onIntent: null,
    // 指针移动的跟踪函数：按实际位置开关展开态，重画/重渲染都不会误收
    onNavMove: null,
    // 已点开的提问 key：回答子条目默认折叠，点击提问才展开；
    // 滚动到某条回答时自动把它的提问加进来，重画后仍按它恢复展开态
    expanded: new Set(),
    // 用户点了关闭图标：只隐藏本次页面的导航，刷新后重新识别即恢复
    dismissed: false,
    // 本会话是否已经展示过导航：站点重渲染时条目可能瞬间归零，已经出现过就常驻，
    // 不跟着条目数量一隐一现；切会话时由 resetDiscovery 复位
    shown: false,
    // 顶栏拖动后的吸附边与纵向比例（卡片顶边 / 视口高）；null 表示保持默认的右侧垂直居中
    position: null,
    // 正在拖动时的指针偏移、卡片坐标与是否越过阈值
    drag: null,
    // 松手后滑向边缘的定时器
    flyTimer: null,
    // 卡片外壳（含顶栏）与条目容器分开：定位与拖动都按卡片量，条目上方还压着 28px 顶栏
    card: null,
    bar: null
};

// 取消息正文：先按站点收敛到气泡元素，再去掉按钮和工具栏文案后压成单行
function readText(el) {
    const source = ADAPTER && ADAPTER.content ? ADAPTER.content(el) : el;
    const clone = source.cloneNode(true);
    // 读屏专用文案（Gemini 复述的提问、ChatGPT/Grok 的「你说」）会和正文重复，一并剔除；
    // 思考区也算回答块里的前置内容，预览只取正式回答，不把思考过程当正文
    clone.querySelectorAll('button, svg, [aria-hidden="true"], nav, form, .sr-only, .cdk-visually-hidden, .ds-think-content').forEach(node => node.remove());
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
    if (!blocks.length) return null;
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

// 站点给消息块的稳定标识；没有时交给 mergePass 按元素与正文认回
function attrKey(el) {
    for (const attr of KEY_ATTRS) {
        const value = el.getAttribute(attr);
        if (value) return 'k:' + attr + ':' + value;
    }
    return null;
}

// 识别一轮：只读当前挂载的块；没有标识的块留空，交给 mergePass 补认
function readPass() {
    return getMessageBlocks().map((el, index) => {
        const role = detectRole(el, index);
        const text = readText(el);
        const attr = attrKey(el);
        const known = identity.byEl.get(el);

        // 虚拟列表会把同一个节点换给另一条消息：旧消息的 el 引用先清掉，
        // 条目仍留在清单里，等滚回来按 key 认回，免得跳到别的消息上
        if (attr && known && known !== attr) {
            const stale = state.itemsByKey.get(known);
            if (stale) stale.el = null;
        }

        return { el, role, text, key: attr || known || null };
    });
}

// 把一轮识别并进已发现清单：
//   1) 没标识的块先在旧清单里按「角色+正文」顺序认领，节点重建过也算同一条
//   2) 新块按窗口里的锚点插进全局顺序：往上滚出的旧消息插到前面，不整体重排
function mergePass(blocks) {
    const claimed = new Set(blocks.map(block => block.key).filter(Boolean));

    let cursor = 0;
    for (const block of blocks) {
        if (!block.key) {
            const landed = findRemembered(block, claimed, cursor);
            if (landed) {
                block.key = landed.key;
                cursor = landed.index + 1;
            } else {
                block.key = 'i:' + (identity.nextId += 1);
            }
        }
        claimed.add(block.key);
        identity.byEl.set(block.el, block.key);
    }

    const fresh = blocks.map(({ key, role, text, el }) => ({ key, role, text, el }));
    const order = mergeOrder(fresh.map(item => item.key));
    const freshByKey = new Map(fresh.map(item => [item.key, item]));
    const items = pruneMissing(order, freshByKey);

    // 被删掉的提问不再占位：展开态和失效的当前条目一起清掉，
    // 本轮末尾的 updateActive 会按滚动位置重新选一条
    const keptKeys = new Set(items.map(item => item.key));
    state.expanded.forEach(key => {
        if (!keptKeys.has(key)) state.expanded.delete(key);
    });
    if (state.activeKey && !keptKeys.has(state.activeKey)) state.activeKey = null;

    state.items = items;
    state.itemsByKey = new Map(items.map(item => [item.key, item]));
    state.entries = groupEntries(items);
    return state.entries;
}

// 删除判定：窗口化站点会卸载视口外的消息，只有夹在本轮已挂载窗口中间的旧条目才算删除；
// 整段 DOM 常驻的站点（windowed: false）本轮没读到就是被删了，两端也一起裁掉
function pruneMissing(order, freshByKey) {
    const windowed = !ADAPTER || ADAPTER.windowed !== false;
    let first = -1;
    let last = -1;
    order.forEach((key, index) => {
        if (!freshByKey.has(key)) return;
        if (first < 0) first = index;
        last = index;
    });

    const items = [];
    order.forEach((key, index) => {
        if (freshByKey.has(key)) {
            items.push(freshByKey.get(key));
            return;
        }
        // 窗口两端缺失可能只是还没挂载，先留着；中间缺失才是被删
        if (windowed && (first < 0 || index < first || index > last)) {
            items.push(state.itemsByKey.get(key));
        }
    });
    return items.filter(Boolean);
}

// 旧清单里找同一条：同角色、同正文，从上次认领的位置往后找，
// 连续两条一样的「继续」也能按顺序各认各的
function findRemembered(block, claimed, from) {
    for (let index = from; index < state.items.length; index += 1) {
        const item = state.items[index];
        if (claimed.has(item.key) || item.role !== block.role || item.text !== block.text) continue;
        return { key: item.key, index };
    }
    return null;
}

// 新块按窗口锚点插入：窗口是连续的一段，先用它前面最近的认识块定位，
// 前面没有就贴到后面最近的认识块之前；整段都新时接在末尾
function mergeOrder(freshKeys) {
    const order = state.items.map(item => item.key);
    const atByKey = new Map(order.map((key, index) => [key, index]));

    freshKeys.forEach((key, freshIndex) => {
        if (atByKey.has(key)) return;
        let at = -1;
        for (let i = freshIndex - 1; i >= 0 && at < 0; i -= 1) {
            const hit = atByKey.get(freshKeys[i]);
            if (hit !== undefined) at = hit + 1;
        }
        for (let i = freshIndex + 1; i < freshKeys.length && at < 0; i += 1) {
            const hit = atByKey.get(freshKeys[i]);
            if (hit !== undefined) at = hit;
        }
        if (at < 0) at = order.length;
        order.splice(at, 0, key);
        for (let i = at; i < order.length; i += 1) atByKey.set(order[i], i);
    });

    return order;
}

// 导航只列提问；提问后面连续的每条回答各成一条子条目（一个提问可能有多条独立回答），
// 夹在提问前面的回答被虚拟列表切掉提问时先当孤立项，等提问挂上来再归位
function groupEntries(items) {
    const entries = [];
    let current = null;
    for (const item of items) {
        if (isUserEntry(item)) {
            current = { ...item, replies: [] };
            entries.push(current);
        } else if (current) {
            current.replies.push(item);
        }
    }
    return entries;
}

function makeSignature(entries) {
    return entries
        .map(entry => entry.key + ':' + entry.replies.map(reply => reply.key).join(',') + ':' + entry.text.slice(0, 12))
        .join('|');
}

function isUserEntry(entry) {
    return entry.role === 'USER';
}

// 找到块的当前节点：挂载着就直接用，卸载后按稳定 key 在当前窗口里找回来
function findBlock(item) {
    if (item.el && item.el.isConnected) return item.el;
    const block = item.key
        ? getMessageBlocks().find(el => (attrKey(el) || identity.byEl.get(el)) === item.key)
        : null;
    if (block) item.el = block;
    return block || null;
}

// 当前读到哪一条的基准线：内容区顶端的留白之外再下移一点，首条消息恰好压线时高亮不会来回跳
const ACTIVE_LINE_OFFSET = 20;

// 翻页、方向键、空格、Home/End 说明用户在键盘滚动；其余按键（打字、快捷键）不算
const SCROLL_KEYS = /^(PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End| |Spacebar)$/;

// 站点可能在消息区顶部给悬浮标题留出高度（Grok 的滚动区从视口顶开始、首条消息往下让 128px）：
// 这段留白就是首条消息距滚动原点的距离，高亮基准线要跟着下移，否则消息一进内容区就算作当前
function readTopInset(scroller, blocks) {
    if (!blocks.length) return ACTIVE_LINE_OFFSET;
    const inset = blocks[0].getBoundingClientRect().top
        - scroller.getBoundingClientRect().top + scroller.scrollTop;
    return (inset > 0 && inset < 200 ? inset : 0) + ACTIVE_LINE_OFFSET;
}

// 取元素自己的滚动父级：站点可能把滚动交给内层元素，state.scroller 未必包住目标
function scrollParentOf(el) {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return null;
}

// 跳到目标消息并停在滚动区中间，让上下文（上一问、提问的尾巴）一起进视野。
// 直接改滚动容器的 scrollTop：停在底部时站点（Grok 已确认）会把平滑滚动逐帧拉回底部，
// 动画整段被吞掉，所以这里不做过渡动画；容器关系不明时才退回 scrollIntoView
function jumpTo(entry) {
    jumpToKey(entry.key, entry.el, entry.key);
}

function jumpToKey(key, el, activeKey, reply = false, retry = true) {
    const block = el && el.isConnected ? el : findBlock({ key, el });
    if (!block) {
        // 目标还在可视区外、站点没渲染（虚拟列表/分页）：先按它在清单里的比例滚过去，
        // 等站点把这一条挂上来再精确对齐
        if (retry) jumpToUnmounted(key, activeKey, reply);
        return;
    }

    // 回答块顶端往往排着思考栏，从它开始滚看到的是思考而不是正文；
    // 站点给了正文锚点就从锚点开始，没有锚点的站点仍按整块落点
    const target = (reply && ADAPTER && ADAPTER.replyAnchor ? ADAPTER.replyAnchor(block) : null) || block;

    const scroller = state.scroller && state.scroller.contains(target)
        ? state.scroller
        : scrollParentOf(target);
    const height = target.getBoundingClientRect().height;
    // 居中后目标停在可视区正中，按「越过顶端」判定的当前位置会退回上一条：
    // 先锁住这次跳转的条目，等用户自己滚动再交还给位置判定
    lockActiveOnJump();

    const view = scroller ? scroller.clientHeight : window.innerHeight;
    // 整块放得进可视区就整块居中；比可视区还高时按上边缘居中，正文开头停在正中、上方留出上一问的尾巴
    const inset = height < view ? (view - height) / 2 : view / 2;

    if (scroller) {
        const top = target.getBoundingClientRect().top
            - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(Math.max(0, top - inset), max);
    } else {
        // 找不到滚动父级时只能借助浏览器：先对齐顶端，再把页面往上带一段，等效于居中
        target.scrollIntoView({ block: 'start' });
        window.scrollBy(0, -inset);
    }

    // 回答落点在正文容器里：光晕按站点声明的正文容器画，圈住整块回答而不是第一段；
    // 站点没给容器时退回锚点本身（整块气泡的顶端已经在视口外，圈出来也看不见）
    const replyBubble = reply && ADAPTER && ADAPTER.replyBubble ? ADAPTER.replyBubble(block) : null;
    flashEntry(target, replyBubble || (target !== block ? target : null));
    setActive(activeKey);
}

// 目标不在当前挂载窗口里：按它在全局清单里的位置估算滚动距离，滚过去后等一次渲染再重试。
// 只重试一次，避免站点始终不渲染时反复拉扯滚动位置
function jumpToUnmounted(key, activeKey, reply) {
    const scroller = state.scroller;
    const index = state.items.findIndex(item => item.key === key);
    if (!scroller || index < 0) return;

    lockActiveOnJump();
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = state.items.length > 1 ? (index / (state.items.length - 1)) * max : 0;
    setActive(activeKey);

    setTimeout(() => {
        const item = state.itemsByKey.get(key);
        const block = item && findBlock(item);
        if (block) jumpToKey(key, block, activeKey, reply, false);
    }, 400);
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

// 跳转后短暂高亮，提示定位到了哪条消息；exact 给了元素时只圈这个元素
// （回答锚点或正文容器），不再套气泡或圆角图片框
function flashEntry(block, exact = null) {
    const bubble = exact
        || (ADAPTER && ADAPTER.bubble ? ADAPTER.bubble(block) : null)
        || roundedImageBox(block)
        || block;
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

// 跳转锁：目标居中后「最后一条越过顶线」会算成上一条，锁住期间沿用跳转选中的条目
function lockActiveOnJump() {
    state.jumpLocked = true;
    state.awaitScroll = false;
}

// 用户动手滚（滚轮、触摸、拖动、翻页键）就记下意向，等真的滚了再解锁，让高亮重新跟着位置走。
// 只按意向不解锁：点气泡选字、点一下没滚动时目标还在中间，高亮不该退回上一条；
// 打字和普通快捷键也不算意向，在输入框里敲空格、按方向键不该影响当前位置
function markScrollIntent(event) {
    if (!state.jumpLocked) return;
    if (event && event.type === 'keydown') {
        const target = event.target;
        const typing = target && (target.isContentEditable
            || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''));
        if (typing || !SCROLL_KEYS.test(event.key)) return;
    }
    state.awaitScroll = true;
}

// 滚动容器动了：用户自己滚出来的位移才解掉跳转锁
function onScroll() {
    if (state.awaitScroll) {
        state.awaitScroll = false;
        state.jumpLocked = false;
    }
    updateActive();
}

// 横线高亮跟随滚动：最后一条越过内容区顶端（悬浮标题之下那条线）的消息就是当前读到的位置。
// 一个提问下有多条独立回答时，滚到哪条回答就高亮哪条子条目
function updateActive() {
    if (!state.entries.length || !state.scroller || state.jumpLocked) return;

    const limit = state.scroller.getBoundingClientRect().top + state.topInset + 1;
    let key = state.entries[0].key;

    for (const entry of state.entries) {
        // 所有回答都占一行子条目：滚到哪条回答就高亮哪条，并展开它所在的提问
        const candidates = [entry, ...entry.replies];
        for (const item of candidates) {
            // 只认当前挂载着的块：滚动时每条都去查一次 DOM 会把长会话拖慢，
            // 重新挂载的条目由下一次刷新补回 el
            const block = item.el && item.el.isConnected ? item.el : null;
            if (block && block.getBoundingClientRect().top <= limit) {
                key = item.key;
            }
        }
    }

    setActive(key);
}

// 找到某条回答所属的提问：滚动到回答时用它自动展开分组
function entryOfReply(key) {
    return state.entries.find(entry => entry.replies.some(reply => reply.key === key)) || null;
}

function setActive(key) {
    if (state.activeKey === key) return;
    state.activeKey = key;

    // 当前读到的是回答：把它所在的提问自动展开，面板和横线都能看到这一条
    const owner = entryOfReply(key);
    if (owner) setEntryExpanded(owner.key, true);

    state.rows.forEach(row => {
        const active = row.dataset.key === key;
        row.classList.toggle('is-active', active);

        // 展开面板时把当前项滚进可见范围，列表比胶囊高也不用自己找
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

    const card = document.createElement('div');
    card.className = 'dscf-msgnav-list';

    // [导航顶栏]: 展开后盖在列表上方，左端拖动把手、右端隐藏按钮；
    // 整条都是拖动区，拖动只改垂直位置，松手按指针所在半屏吸附左右边缘
    const bar = document.createElement('div');
    bar.className = 'dscf-msgnav-bar';

    const grip = document.createElement('span');
    grip.className = 'dscf-msgnav-grip';
    grip.innerHTML = GRIP_ICON;

    // [导航关闭图标]: 顶栏右侧，点击只隐藏本次页面的导航（不动识别与监听）
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dscf-msgnav-close';
    close.title = '临时隐藏（刷新后恢复）';
    close.setAttribute('aria-label', close.title);
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => {
        state.dismissed = true;
        syncVisibility();
    });

    bar.append(grip, close);
    bar.addEventListener('pointerdown', startNavDrag);

    const items = document.createElement('div');
    items.className = 'dscf-msgnav-items';
    card.append(bar, items);

    root.append(card);
    document.body.appendChild(root);

    // 展开态不靠 :hover 单独维持：站点重渲染时浏览器可能重算 hover，纯 CSS 会把手底下的
    // 面板收起。改为按指针实际位置跟踪——进入即展开，指针真的移到面板外才收起；
    // 不用 pointerleave 判定，DOM 重建把它误触发时也不会误收。触屏没有 hover，
    // 保持原来的点击行为，免得点一下就锁在展开态
    if (window.matchMedia('(hover: hover)').matches) {
        root.addEventListener('pointerenter', () => root.classList.add('is-open'));
        state.onNavMove = trackNavHover;
        window.addEventListener('pointermove', state.onNavMove, { passive: true });
    }

    state.root = root;
    state.list = items;
    state.card = card;
    state.bar = bar;
}

// 指针是否落在导航上：收起时只认右侧那一条横线区域（面板整体透明、不接事件），
// 展开后连同整块面板都算
function navPointInside(x, y) {
    if (!state.root || !state.card) return false;
    const strip = state.root.getBoundingClientRect();
    if (x >= strip.left && x <= strip.right && y >= strip.top && y <= strip.bottom) return true;
    if (!state.root.classList.contains('is-open')) return false;
    const card = state.card.getBoundingClientRect();
    return x >= card.left && x <= card.right && y >= card.top && y <= card.bottom;
}

// 指针每次移动都按坐标重算展开态：只要还在面板上就保持展开，
// 真正移到外面才收起；不依赖 pointerleave，DOM 重建不会把它误判成离开
function trackNavHover(event) {
    if (!state.root || state.drag || state.flyTimer) return;
    state.root.classList.toggle('is-open', navPointInside(event.clientX, event.clientY));
}

// [导航展开标记]：提问行行首的折叠箭头，展开回答时转向下；内联 SVG 不依赖图标字体
const CARET_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M6.2 3.6 10.6 8l-4.4 4.4" fill="none" stroke="currentColor"'
    + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';

const CLOSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" fill="none" stroke="currentColor"'
    + ' stroke-width="1.4" stroke-linecap="round"/>'
    + '</svg>';

// 顶栏把手：两列三点，提示这一条可以拖
const GRIP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<g fill="currentColor">'
    + '<circle cx="6" cy="4.5" r="1"/><circle cx="10" cy="4.5" r="1"/>'
    + '<circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/>'
    + '<circle cx="6" cy="11.5" r="1"/><circle cx="10" cy="11.5" r="1"/>'
    + '</g>'
    + '</svg>';

// 提问行的无障碍文案：有没有回答、当前是否展开，决定点击后是跳转还是也收起
function jumpLabel(entry, expanded) {
    const text = entry.text || '（无正文）';
    if (!entry.replies.length) return '跳到提问：' + text;
    return (expanded
        ? '收起回答并跳到提问：'
        : '展开 ' + entry.replies.length + ' 条回答并跳到提问：') + text;
}

// 展开态按提问 key 记，点击提问切换；分组 class 与无障碍文案一起更新，不整列重画
function setEntryExpanded(key, expanded) {
    if (expanded) {
        state.expanded.add(key);
    } else {
        state.expanded.delete(key);
    }

    const group = state.groupsByKey.get(key);
    group?.classList.toggle('is-expanded', expanded);
    // 展开后卡片变高，靠近视口下沿时把它拉回可视范围（不改用户拖拽的锚点比例）
    if (expanded) keepNavInView();

    const entry = state.entries.find(item => item.key === key);
    const jump = state.rowsByKey.get(key)?.querySelector('.dscf-msgnav-jump');
    if (entry && jump) {
        jump.setAttribute('aria-label', jumpLabel(entry, expanded));
        jump.setAttribute('aria-expanded', String(expanded));
    }
}

// 重画条目：按 key 复用已有行、只换内容，不在交互中整列删除重建——
// 站点重渲染触发刷新时，鼠标停着也不会丢 hover、面板不会反复收起。
// 每个提问连同它的回答行编成一组：回答行默认折叠，点击提问才展开，
// 连续多条提问各占一行、各自折叠自己的回答
function renderItems() {
    ensureDom();

    const nextRows = [];
    const nextByKey = new Map();
    const nextGroups = [];
    const nextGroupsByKey = new Map();
    let cursor = state.list.firstElementChild;

    // 分组按文档顺序排：已在正确位置就不动，其余插到游标前，等于原地移动元素而不销毁
    const placeGroup = group => {
        nextGroups.push(group);
        nextGroupsByKey.set(group.dataset.key, group);
        if (group === cursor) {
            cursor = group.nextElementSibling;
        } else {
            state.list.insertBefore(group, cursor);
        }
    };

    // 组内行按顺序复用；条数变少时多出来的旧行（例如回答被撤回）一并移除
    const fillGroup = (group, members) => {
        members.forEach((row, index) => {
            const existing = group.children[index];
            if (existing !== row) group.insertBefore(row, existing || null);
            nextRows.push(row);
            nextByKey.set(row.dataset.key, row);
        });
        while (group.children.length > members.length) group.lastElementChild.remove();
    };

    state.entries.forEach(entry => {
        const group = state.groupsByKey.get(entry.key) || document.createElement('div');
        group.className = 'dscf-msgnav-group';
        group.dataset.key = entry.key;

        const row = state.rowsByKey.get(entry.key) || document.createElement('div');
        fillItemRow(row, entry);

        const members = [row];

        // 所有回答都单独占一行子条目，缩进折叠在提问行下
        entry.replies.forEach((reply, index) => {
            const replyRow = state.rowsByKey.get(reply.key) || document.createElement('div');
            fillReplyRow(replyRow, entry, reply, index);
            members.push(replyRow);
        });

        fillGroup(group, members);
        group.classList.toggle('is-expanded', state.expanded.has(entry.key));
        placeGroup(group);
    });

    // 条目消失（重新生成、切分支）才删行与分组
    state.rows.forEach(row => {
        if (!nextByKey.has(row.dataset.key)) row.remove();
    });
    state.groups.forEach(group => {
        if (!nextGroupsByKey.has(group.dataset.key)) group.remove();
    });

    state.rows = nextRows;
    state.rowsByKey = nextByKey;
    state.groups = nextGroups;
    state.groupsByKey = nextGroupsByKey;
}

function fillItemRow(row, entry) {
    const active = entry.key === state.activeKey;
    const expandable = entry.replies.length > 0;
    const expanded = expandable && state.expanded.has(entry.key);

    // 行本身是容器：点击整行展开/收起该提问的回答并跳过去；
    // 行首箭头只做提示，不单独接事件，避免在箭头上留死区
    row.className = 'dscf-msgnav-item';
    row.classList.toggle('is-active', active);
    row.dataset.key = entry.key;
    delete row.dataset.parentKey;

    const caret = document.createElement('span');
    caret.className = 'dscf-msgnav-caret';
    caret.setAttribute('aria-hidden', 'true');
    if (expandable) caret.innerHTML = CARET_ICON;

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'dscf-msgnav-jump';
    jump.setAttribute('aria-label', jumpLabel(entry, expanded));
    if (expandable) jump.setAttribute('aria-expanded', String(expanded));

    const text = document.createElement('span');
    text.className = 'dscf-msgnav-text';
    text.textContent = entry.text || '（无正文）';
    text.title = entry.text || '';
    jump.append(text);

    const indicator = document.createElement('span');
    indicator.className = 'dscf-msgnav-indicator';
    const line = document.createElement('span');
    line.className = 'dscf-msgnav-line';
    indicator.append(line);

    row.replaceChildren(caret, jump, indicator);

    // 整行都是命中区（正文、箭头、最右侧横线）：点提问先切换子回答展开态，再跳到该提问
    row.onclick = () => {
        if (expandable) setEntryExpanded(entry.key, !state.expanded.has(entry.key));
        jumpTo(entry);
    };
}

// 子条目：一条回答，行首序号标明同一提问下的第几条；点击展开所在提问并跳到这条回答
function fillReplyRow(row, entry, reply, index) {
    row.className = 'dscf-msgnav-item is-sub';
    row.classList.toggle('is-active', reply.key === state.activeKey);
    row.dataset.key = reply.key;
    row.dataset.parentKey = entry.key;

    const order = document.createElement('span');
    order.className = 'dscf-msgnav-subindex';
    order.textContent = String(index + 1);

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'dscf-msgnav-jump';
    jump.setAttribute('aria-label', '跳到第 ' + (index + 1) + ' 条回答：' + (reply.text || '（无正文）'));

    const text = document.createElement('span');
    text.className = 'dscf-msgnav-text';
    text.textContent = reply.text || '（无正文）';
    text.title = reply.text || '';
    jump.append(text);

    const indicator = document.createElement('span');
    indicator.className = 'dscf-msgnav-indicator';
    const line = document.createElement('span');
    line.className = 'dscf-msgnav-line';
    indicator.append(line);

    row.replaceChildren(order, jump, indicator);

    row.onclick = () => openReply(entry, reply);
}

// 点击回答行：展开它所在的提问，并跳到这条回答（高亮落在回答行上）
function openReply(entry, reply) {
    setEntryExpanded(entry.key, true);
    jumpToKey(reply.key, reply.el, reply.key, true);
}

// 回答流式输出时正文一直在变，签名不变就只把最新文字写回现有行，避免整列重画打断操作
function syncEntryTexts() {
    const entryByKey = new Map(state.entries.map(entry => [entry.key, entry]));
    const replyByKey = new Map();
    state.entries.forEach(entry => entry.replies.forEach((reply, index) => {
        replyByKey.set(reply.key, { reply, index });
    }));

    state.rows.forEach(row => {
        const entry = entryByKey.get(row.dataset.key);
        if (entry) {
            setRowText(row.querySelector('.dscf-msgnav-text'), entry.text, '（无正文）');
            const jump = row.querySelector('.dscf-msgnav-jump');
            if (jump) {
                jump.setAttribute('aria-label', jumpLabel(entry, state.expanded.has(entry.key)));
            }
            return;
        }

        const found = replyByKey.get(row.dataset.key);
        if (!found) return;
        const { reply, index } = found;
        setRowText(row.querySelector('.dscf-msgnav-text'), reply.text, '（无正文）');
        const jump = row.querySelector('.dscf-msgnav-jump');
        if (jump) {
            jump.setAttribute('aria-label', '跳到第 ' + (index + 1) + ' 条回答：' + (reply.text || '（无正文）'));
        }
    });
}

function setRowText(node, text, empty) {
    if (!node) return;
    node.textContent = text || empty;
    node.title = text || '';
}

// 可见性由已展示标记与关闭标记共同决定：识别到第一条提问后常驻，
// 站点重渲染导致条目暂时归零也不收起；关闭只做本页隐藏，刷新后重新识别即恢复
function syncVisibility() {
    if (!state.root) return;
    if (state.entries.length >= MIN_ENTRIES) state.shown = true;
    const visible = !state.dismissed && state.shown;
    // 收起时一并放掉悬停锁定，下次展开重新按指针位置决定
    if (!visible) state.root.classList.remove('is-open');
    state.root.classList.toggle('is-visible', visible);
}

// 位置存吸附边与纵向比例；比例以视口高度为分母，手机版/电脑版切换、横竖屏旋转、
// 窗口缩放后按同一比例还原。旧版只存像素顶边，读到时按当前视口折成比例
function readNavPosition() {
    const raw = storageGet(NAV_POSITION_KEY, '');
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed) return null;
        const side = parsed.side === 'left' ? 'left' : 'right';
        const ratio = Number.isFinite(parsed.ratio)
            ? parsed.ratio
            : (Number.isFinite(parsed.top) ? topToRatio(parsed.top) : NaN);
        if (!Number.isFinite(ratio)) return null;
        return { side, ratio: Math.min(1, Math.max(0, ratio)) };
    } catch (e) {
        return null;
    }
}

function saveNavPosition() {
    if (state.position) {
        storageSet(NAV_POSITION_KEY, JSON.stringify({
            side: state.position.side,
            ratio: state.position.ratio
        }));
    }
}

// 卡片（展开后的 240 宽面板）横向夹在视口内；拖动与飞行都以卡片左侧坐标为基准
function clampNavLeft(left) {
    const width = state.card?.offsetWidth || 0;
    return Math.min(Math.max(0, left), Math.max(0, window.innerWidth - width));
}

// 卡片可移动的纵向范围由卡片高度决定：顶边 0（贴顶）到「视口高 - 卡片高」（贴底）
function clampNavTop(top) {
    const height = state.root?.getBoundingClientRect().height || 0;
    return Math.min(Math.max(0, top), Math.max(0, window.innerHeight - height));
}

// 位置以视口高度为分母存比例（百分比定位），换算后再夹回可移动范围；
// 分母不随卡片高度变，所以条目增减不会让面板自己漂移
function topToRatio(top) {
    return window.innerHeight ? Math.min(1, Math.max(0, top / window.innerHeight)) : 0;
}

function ratioToTop(ratio) {
    return clampNavTop(Math.min(1, Math.max(0, ratio)) * window.innerHeight);
}

// 按卡片坐标摆位置：右侧吸附时列表从 34px 胶囊向左溢出，左侧吸附则向右展开；
// 跨边时换镜像 class 但卡片本身仍停在 cardLeft，不跟着跳
function positionNavCard(side, cardLeft, cardTop) {
    const root = state.root;
    const card = state.card;
    if (!root || !card) return;

    root.classList.toggle('is-left', side === 'left');
    root.style.transform = 'none';
    root.style.right = 'auto';
    root.style.left = side === 'left'
        ? `${cardLeft}px`
        : `${cardLeft + card.offsetWidth - root.offsetWidth}px`;
    root.style.top = `${cardTop}px`;
}

// 静止态的摆放：吸附边贴 16px 边距，顶边显式写死，默认的垂直居中偏移随之取消
function layoutNavCard(side, top) {
    const root = state.root;
    if (!root) return;
    const left = side === 'left';
    root.classList.toggle('is-left', left);
    root.style.top = `${top}px`;
    root.style.transform = 'none';
    // 边距与样式里的 16px 保持一致
    root.style.left = left ? `${NAV_EDGE}px` : 'auto';
    root.style.right = left ? 'auto' : `${NAV_EDGE}px`;
}

// 按存储的比例摆位置；比例是锚点，条目增减与视口缩放都以它为准
function applyNavPosition(position) {
    state.position = position;
    layoutNavCard(position.side, ratioToTop(position.ratio));
}

// 条目变多后卡片变高，可能顶出屏幕下沿：只纠正视觉位置，不改锚点比例，
// 换回大视口（切回电脑版、横屏）时仍回到用户拖到的相对位置
function keepNavInView() {
    if (!state.position || !state.root || state.drag || state.flyTimer) return;
    const current = parseFloat(state.root.style.top);
    if (!Number.isFinite(current)) return;
    const top = clampNavTop(current);
    if (Math.abs(top - current) < 1) return;
    layoutNavCard(state.position.side, top);
}

// 视口自身变化（手机版/电脑版切换、横竖屏、窗口缩放）后按锚点比例整体重摆
function rescaleNavPosition() {
    if (!state.position || !state.root || state.drag || state.flyTimer) return;
    applyNavPosition(state.position);
}

// 松手后滑向吸附边：先在不带过渡的情况下把卡片摆到当前视觉位置（跨边时内容镜像
// 立刻切换，卡片不跳），再开 transition 走到目标坐标，结束后清掉过渡交给逐帧拖动
function flyNavTo(side, cardLeft, cardTop) {
    if (!state.root || !state.card) return;

    const card = state.card.getBoundingClientRect();
    state.root.classList.remove('is-flying');
    positionNavCard(side, card.left, card.top);
    void state.root.offsetWidth;

    state.root.classList.add('is-flying');
    positionNavCard(side, cardLeft, cardTop);

    state.position = { side, ratio: topToRatio(cardTop) };
    saveNavPosition();

    clearTimeout(state.flyTimer);
    state.flyTimer = setTimeout(() => {
        state.flyTimer = null;
        state.root?.classList.remove('is-flying');
        // 飞行途中指针可能已经离开面板（拖动期间不处理 pointerleave），落地后补一次判断
        if (state.root && !state.root.matches(':hover')) state.root.classList.remove('is-open');
    }, NAV_FLY_MS + 60);
}

// [导航顶栏] 拖动：按下记录指针与卡片的相对位置，超过阈值后卡片按指针双轴移动；
// 松手按卡片中线所在半屏吸附左/右边缘并滑过去。事件挂到 window，指针移出胶囊也不丢
function startNavDrag(event) {
    if (event.button !== 0 || !state.root || !state.bar || !state.card) return;
    if (event.target.closest?.('.dscf-msgnav-close')) return;

    // 飞行途中再次按下：停在当前视觉位置，从半路接着拖
    clearTimeout(state.flyTimer);
    state.flyTimer = null;
    state.root.classList.remove('is-flying');

    const side = state.position?.side === 'left' ? 'left' : 'right';
    const card = state.card.getBoundingClientRect();
    positionNavCard(side, card.left, card.top);

    state.drag = {
        pointerId: event.pointerId,
        side,
        offsetX: event.clientX - card.left,
        offsetY: event.clientY - card.top,
        cardLeft: card.left,
        cardTop: card.top,
        moved: false
    };
    state.root.classList.add('is-dragging');
    state.bar.setPointerCapture?.(event.pointerId);

    window.addEventListener('pointermove', moveNavDrag);
    window.addEventListener('pointerup', endNavDrag);
    window.addEventListener('pointercancel', endNavDrag);
    event.preventDefault();
}

function moveNavDrag(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId || !state.root) return;

    const cardLeft = clampNavLeft(event.clientX - drag.offsetX);
    const cardTop = clampNavTop(event.clientY - drag.offsetY);
    if (!drag.moved && Math.hypot(cardLeft - drag.cardLeft, cardTop - drag.cardTop) < 3) return;

    drag.moved = true;
    drag.cardLeft = cardLeft;
    drag.cardTop = cardTop;
    positionNavCard(drag.side, cardLeft, cardTop);
}

function endNavDrag(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    state.drag = null;
    state.root?.classList.remove('is-dragging');
    if (state.bar?.hasPointerCapture?.(drag.pointerId)) {
        state.bar.releasePointerCapture(drag.pointerId);
    }
    stopNavDragListeners();
    if (!drag.moved || !state.root || !state.card) return;

    const width = state.card.offsetWidth;
    // 取消（如系统手势打断）时留在原吸附边，不按可能为 0 的指针位置重算
    const side = event.type === 'pointercancel'
        ? drag.side
        : (drag.cardLeft + width / 2 < window.innerWidth / 2 ? 'left' : 'right');
    const maxLeft = Math.max(0, window.innerWidth - width);
    const cardLeft = side === 'left'
        ? Math.min(NAV_EDGE, maxLeft)
        : Math.max(0, maxLeft - NAV_EDGE);

    flyNavTo(side, cardLeft, clampNavTop(drag.cardTop));
}

function stopNavDragListeners() {
    window.removeEventListener('pointermove', moveNavDrag);
    window.removeEventListener('pointerup', endNavDrag);
    window.removeEventListener('pointercancel', endNavDrag);
}

function clearMessageNav() {
    detachScroller();
    state.entries = [];
    state.signature = '';
    state.activeKey = null;
    state.topInset = 0;
    state.expanded.clear();
    state.rows.forEach(row => row.remove());
    state.groups.forEach(group => group.remove());
    state.rows = [];
    state.rowsByKey = new Map();
    state.groups = [];
    state.groupsByKey = new Map();
    syncVisibility();
}

// 换会话时清空已发现的清单：key 只在本会话内有意义，留着会把上一个会话的消息混进来
function resetDiscovery() {
    identity = createIdentity();
    state.items = [];
    state.itemsByKey = new Map();
    state.entries = [];
    state.signature = '';
    state.activeKey = null;
    state.expanded.clear();
    // 新会话重新从「未展示」开始；先不急着收起面板，等这次刷新读到新会话的消息再定，
    // 免得地址栏一变就先隐一下再出现
    state.shown = false;
}

function attachScroller(scroller) {
    detachScroller();
    state.scroller = scroller;

    state.onScroll = onScroll;
    scroller.addEventListener('scroll', state.onScroll, { passive: true });

    // 跳转落点在中间，只有用户自己动手滚才该让高亮跟着位置变
    state.onIntent = markScrollIntent;
    ['wheel', 'touchstart', 'pointerdown'].forEach(type =>
        scroller.addEventListener(type, state.onIntent, { passive: true }));
    document.addEventListener('keydown', state.onIntent);

    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(scroller, { childList: true, subtree: true });
}

function detachScroller() {
    if (state.scroller && state.onScroll) {
        state.scroller.removeEventListener('scroll', state.onScroll);
    }
    if (state.scroller && state.onIntent) {
        ['wheel', 'touchstart', 'pointerdown'].forEach(type =>
            state.scroller.removeEventListener(type, state.onIntent));
    }
    document.removeEventListener('keydown', state.onIntent);
    state.observer?.disconnect();
    state.observer = null;
    state.scroller = null;
    state.onScroll = null;
    state.onIntent = null;
    state.jumpLocked = false;
    state.awaitScroll = false;
}

function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshMessageNav(), 300);
}

// 重建导航：条目清单变化才重画，单纯滚动只更新高亮
export function refreshMessageNav() {
    const entries = mergePass(readPass());

    if (entries.length < MIN_ENTRIES) {
        // 已发现过消息时，这一轮读不到多半是站点正在重渲染：保留面板和悬停态，
        // 等下一次刷新补回来；只有清单真为空（首次加载、空会话）才收起来
        if (!state.items.length) {
            clearMessageNav();
        } else if (state.rows.length) {
            // 提问被删、只剩未归组的回答：撤掉已删除提问的行，别留下可点的旧条目
            renderItems();
        }
        return;
    }

    // 找滚动容器和首条留白只看当前挂载着的块，累积清单里卸载掉的节点没有矩形
    const mounted = state.items.map(item => item.el).filter(el => el && el.isConnected);
    const scroller = resolveScroller(mounted);
    if (!scroller) {
        // 滚动容器暂时找不到（站点重排、切会话中途）也一样先不撤面板，低频重试
        scheduleWatch();
        return;
    }

    if (scroller !== state.scroller) attachScroller(scroller);
    state.topInset = readTopInset(scroller, mounted);

    const signature = makeSignature(entries);

    if (signature !== state.signature) {
        state.signature = signature;
        renderItems();
    } else {
        // 条目不增不减时只同步正文，流式回答也能实时更新预览
        syncEntryTexts();
    }

    syncVisibility();
    keepNavInView();
    updateActive();
}

// 消息区随会话加载才出现：还没识别到消息时低频轮询等待，出现后由滚动容器的观察器接手
function scheduleWatch() {
    clearInterval(state.watchTimer);
    state.watchTimer = setInterval(() => {
        if (!getMessageBlocks().length) return;
        clearInterval(state.watchTimer);
        state.watchTimer = null;
        refreshMessageNav();
    }, 800);
}

// 通用导航的启动：可重复调用，清理由调用方登记到 runtime.disposers
export function initMessageNav() {
    if (state.root) return;
    ensureDom();

    // 位置沿用上次拖到的吸附边与顶边；首次运行保持默认的右侧垂直居中
    const position = readNavPosition();
    if (position) applyNavPosition(position);
    window.addEventListener('resize', rescaleNavPosition);

    state.historyTimer = setInterval(() => {
        if (location.href === state.href) return;
        state.href = location.href;
        // 切会话就整份重来：旧会话的条目和 key 不能带进新会话
        resetDiscovery();
        scheduleRefresh();
    }, 700);

    runtime.refreshMessageNav = refreshMessageNav;

    refreshMessageNav();
    if (!getMessageBlocks().length) scheduleWatch();
}

export function teardownMessageNav() {
    detachScroller();
    stopNavDragListeners();
    window.removeEventListener('resize', rescaleNavPosition);
    if (state.onNavMove) {
        window.removeEventListener('pointermove', state.onNavMove);
        state.onNavMove = null;
    }

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
    state.card = null;
    state.bar = null;
    state.rows = [];
    state.rowsByKey = new Map();
    state.groups = [];
    state.groupsByKey = new Map();
    state.entries = [];
    state.items = [];
    state.itemsByKey = new Map();
    state.activeKey = null;
    state.signature = '';
    state.topInset = 0;
    state.expanded.clear();
    identity = createIdentity();
    state.dismissed = false;
    state.shown = false;
    state.position = null;
    state.drag = null;
    clearTimeout(state.flyTimer);
    state.flyTimer = null;

    if (runtime.refreshMessageNav === refreshMessageNav) {
        runtime.refreshMessageNav = null;
    }
}
