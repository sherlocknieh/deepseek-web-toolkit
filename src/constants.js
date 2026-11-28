// 跨模块共享的键名与目录缩进
export const RUNTIME_KEY = '__deepseek_chat_folders_runtime__';
export const EXPANDED_KEY = 'path_folders_expanded';
// 通用导航吸附的边与顶边像素（拖动顶栏后写入）
export const NAV_POSITION_KEY = 'message_nav_position';
export const BASE_PADDING = 12;
export const INDENT = 14;

// 折叠状态和目录归属写在 data 属性上：React 切换选中会话时会重写会话行的
// className（只保留它自己的类），但不会改动 data-*，布局状态才能扛过重渲染
export const HIDDEN_ATTR = 'data-dscf-hidden';
export const CHAT_ATTR = 'data-dscf-chat';
