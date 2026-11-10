
## DeepSeek 网页端工具箱 - LaTeX 公式复制 & 会话文件夹 & 消息导航

安装地址: https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js

- 公式复制修正

修复 DeepSeek 网页端 LaTeX 公式复制问题:

DeepSeek 网页端复制公式得到的是混乱的文本，而不是 LaTeX 源码。

脚本注入 KaTeX 官方的 copy-tex，复制时得到 LaTeX 源码

- 会话文件夹

支持用文件夹管理会话历史

原理是把会话标题改为路径格式, 例如「工作/项目A/讨论」, 然后渲染为文件夹结构, 方便管理和查找。

- 消息导航

会话内消息过多时, 可以通过消息导航快速跳转到指定消息。

DeepSeek 使用它自带的右侧消息导航; 脚本只做两件事: 全程常显该导航（含侧栏展开、窄屏）, 并给消息区补右内边距避免重叠。

ChatGPT / Grok / Gemini 等站点使用脚本的通用导航: 消息区右侧一列圆点, 点击跳到对应消息, 顶部按钮展开完整消息列表。

同时支持 deepseek, chatgpt, grok, gemini 网页端;
