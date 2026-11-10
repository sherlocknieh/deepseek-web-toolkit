// 保住 DeepSeek 原生消息导航：前端在「宽度 ≤1200px 且侧栏展开」时直接不渲染导航，
// 只靠 CSS 覆盖救不回来，必须在应用读取断点前改写 matchMedia。
//
// 应用用 matchMedia('(max-width: 1200px)') 判断这个断点，且只用于导航显隐，
// 所以让它恒为 false 不会影响其他布局。脚本需在 document-start 运行才能赶在应用之前。
const NARROW_QUERY = '(max-width: 1200px)';
const PATCH_FLAG = '__dscf_native_nav_patched__';

function normalize(query) {
    return String(query).replace(/\s+/g, '').toLowerCase();
}

// 返回一个永不匹配的 MediaQueryList，应用据此认为窗口足够宽
function createNeverMatch(query) {
    return {
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
            return false;
        }
    };
}

// 只改写导航断点，其余查询原样交给浏览器
export function patchNativeNavBreakpoint() {
    const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    if (pageWindow[PATCH_FLAG]) return;

    const original = pageWindow.matchMedia.bind(pageWindow);
    const target = normalize(NARROW_QUERY);

    pageWindow.matchMedia = function (query) {
        if (normalize(query) === target) return createNeverMatch(query);
        return original(query);
    };

    pageWindow[PATCH_FLAG] = true;
}
