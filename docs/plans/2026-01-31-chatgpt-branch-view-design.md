# ChatGPT Branch View & Pre-Branch Support Design

**Goal**
- 在 ChatGPT 预分支页面（`/c/WEB:<id>`）显示树与提示。
- 在真实分支会话中渲染与父会话一致的分支视图，并显式区分“真实分支”与“编辑分支”。

**Context & Constraints**
- `content.js` 负责 ChatGPT API 获取与树构建；`panel.js`/`panel.html` 已支持 `ancestor-title`、`current-title`、`branchRoot`、`preBranchIndicator` 的 UI。
- 预分支 ID 带 `WEB:` 前缀，API 需要使用 clean ID。
- 分支数据存于 `chatgpt_branch_data`，当前仅按 `conversationId` 渲染分支列表。

**Design**
1) **Pre-Branch Handling**
- 解析 `WEB:` 前缀并保留“预分支状态”标记。
- API 请求使用 clean ID（`WEB:` 去除）。
- 在树节点中插入 `preBranchIndicator`（信息 banner），提示“发送后才生成分支”。
- URL 变更监听支持 `WEB:` 前缀，确保跳转后刷新。

2) **Branch View in Child Conversation**
- 当当前会话是某个父会话的分支时：
  - 构建祖先链：`ancestor-title` → `branchRoot`（From）→ `branch` 列表（父会话分支）。
  - 标记当前分支为 `isViewing`，维持现有“Viewing”高亮。
  - 追加 `current-title` 与当前会话消息树（含 edit branches）。
- UI 使用内联 SVG 图标替代 emoji，`currentColor` 继承配色；真实分支用 fork icon，编辑分支用 pencil icon。

**Data Flow**
- `getConversationId` 返回原始 ID；新增 `getCleanConversationId` 用于 API 与 storage 统一 key。
- `handleGetTree`：判断 pre-branch/child-branch → 构建 nodes → 返回给 panel。

**Risks & Mitigations**
- 祖先链识别依赖本地 branchData：若无父记录，仅显示当前会话（兼容旧数据）。
- `WEB:` 前缀变化：使用正则与 fallback 逻辑覆盖。

**Testing (TDD)**
- 添加最小化单元测试：
  - clean ID 处理（`WEB:` → clean）。
  - 预分支识别与 URL 变更正则。
  - 分支视图节点构建（父分支 + 当前分支标记）。
