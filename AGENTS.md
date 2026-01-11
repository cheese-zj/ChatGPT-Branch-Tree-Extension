## 0 · 角色与语言约束

- 你正在协助的对象是 **James**（资深后端/数据库工程师）。
- 讨论、分析、总结使用 **简体中文**。
- 代码、注释、标识符、提交信息、以及 Markdown 代码块内的内容全部使用 **English**。
- 目标是“Slow is Fast”：强调推理质量、架构与可维护性，而非短期速度。

---

## 1 · 项目概览

- 这是一个 Chromium 扩展，核心入口为 `content.js`、`panel.js`、`background.js`。
- 业务逻辑主要集中在 `core/` 与 `platforms/`：
  - `core/` 放通用数据结构与树构建逻辑。
  - `platforms/` 放不同平台的适配器（ChatGPT/Claude/Gemini/Perplexity）。
- 本仓库以 **ES modules + 浏览器扩展 API** 为主；`content.js` 是 IIFE 风格内容脚本。

---

## 2 · 常用命令（Build/Lint/Test）

### 2.1 依赖安装

```bash
npm install
```

### 2.2 Lint

```bash
npm run lint
```

单文件 lint：

```bash
npx eslint path/to/file.js
```

自动修复：

```bash
npm run lint:fix
```

### 2.3 格式化

```bash
npm run prettier
```

单文件格式化：

```bash
npx prettier --write path/to/file.js
```

### 2.4 Build / Test

- **没有专用 build 脚本**。开发时用浏览器“Load unpacked”。
- **没有自动化测试脚本**。如果需要验证功能，请执行 README 的 Manual QA Checklist。
- 若未来新增测试，请补充 `package.json` 的 `test` 脚本，并在此处说明单测运行方式。

---

## 3 · 代码风格与工程约定

### 3.1 格式化与 ESLint

- 使用 Prettier，配置见 `.prettierrc.json`：
  - `printWidth: 80`, `tabWidth: 2`, `semi: true`, `singleQuote: true`。
  - `trailingComma: none`, `arrowParens: always`。
- ESLint 规则见 `eslint.config.js`：
  - `no-var` 强制禁止 `var`。
  - `no-unused-vars` 允许 `_` 前缀忽略。
  - `prettier/prettier` 为 error（格式化失败视为错误）。

### 3.2 模块与导入

- `core/` 与 `platforms/` 使用 **ES modules**，优先使用 **named exports**。
- 避免默认导出；保持 API 直观、可读。
- 内容脚本 `content.js` 使用 IIFE + `use strict` 约束全局污染。

### 3.3 命名与结构

- 变量/函数使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。
- 类型与类使用 `PascalCase`（如 `BaseAdapter`）。
- 函数分区用清晰的 `// ===` 分隔区块（现有文件已使用）。

### 3.4 类型表达与注释

- JS 代码使用 **JSDoc** 表达数据结构与函数契约：
  - `@typedef` 描述结构体；
  - `@param`/`@returns` 清晰标注输入输出。
- 注释应解释 **为什么这样做**，避免重复代码本身。

### 3.5 错误处理

- 所有 `chrome.*` 调用优先用 `try/catch` + `chrome.runtime.lastError` 防护。
- 失败时 **记录日志并返回安全默认值**（如 `null`/`false`/空对象）。
- 仅在“不可恢复、配置错误或编程错误”时抛出异常（如抽象基类）。

### 3.6 异步与状态

- 异步函数尽量保持 **返回值稳定**（即使失败也返回结构化结果）。
- 内存缓存与持久化缓存的 TTL 逻辑保持集中管理（参考 `core/storage.js`）。
- UI 状态写入遵循“先更新内存，再落库”的顺序。

---

## 4 · 开发与验证建议

- 手动验证时，按 README 的 Manual QA Checklist 执行，重点关注：
  - 节点点击与滚动定位是否正确。
  - “Branch in new chat” 的关系是否被记录。
  - Tooltip 与预览长度设置是否准确。
- 扩展调试优先使用：
  - `chrome://extensions` → “Inspect views” 检查 Service Worker。
  - 页面 DevTools 检查 `content.js` 注入与 DOM 操作。

---

## 5 · 工作方式（Agent 约束）

- **trivial 任务**：直接给出修复/修改，不必 Plan。
- **moderate/complex 任务**：必须先给 Plan，再进入 Code。
- 若需要改动多个模块，应先阐明依赖顺序与风险点。
- 避免无谓澄清；缺失信息会影响正确性时才询问。

---

## 6 · 规则同步说明

- 未发现 `.cursor/rules/`、`.cursorrules` 或 `.github/copilot-instructions.md`。
- 若未来新增这些规则，应在此文件中补充并优先遵循。
