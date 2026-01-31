# ChatGPT Branch View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ChatGPT pre-branch pages render normally and show parent-branch context when viewing a branched conversation, with SVG icons for real vs edit branches.

**Architecture:** Add small pure utility functions for ChatGPT conversation ID parsing and branch-context construction (unit-tested). Content script uses these utilities (kept in sync) to render pre-branch banners and parent branch context. Panel switches branch/edit icons to inline SVG for consistent visuals.

**Tech Stack:** Vanilla JS (ESM for tests/utilities), Chrome Extension content script + side panel, Node assert tests.

### Task 1: Add test harness + branch utils (TDD)

**Files:**
- Create: `tests/chatgpt-branch-utils.test.js`
- Create: `core/chatgpt-branch-utils.js`
- Modify: `package.json`
- Modify: `AGENTS.md`

**Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import {
  cleanChatGPTConversationId,
  extractChatGPTConversationIdFromPath,
  findParentBranch,
  buildBranchContextNodes
} from '../core/chatgpt-branch-utils.js';

// cleanChatGPTConversationId
assert.equal(cleanChatGPTConversationId('WEB:abc-123'), 'abc-123');
assert.equal(cleanChatGPTConversationId('abc-123'), 'abc-123');
assert.equal(cleanChatGPTConversationId(null), null);

// extractChatGPTConversationIdFromPath
assert.equal(extractChatGPTConversationIdFromPath('/c/WEB:abc-123'), 'WEB:abc-123');
assert.equal(extractChatGPTConversationIdFromPath('/c/abc-123'), 'abc-123');
assert.equal(extractChatGPTConversationIdFromPath('/foo'), null);

// findParentBranch + buildBranchContextNodes
const branchData = {
  branches: {
    parent1: [
      { childId: 'childA', title: 'Child A', firstMessage: 'Hi', createdAt: 10 },
      { childId: 'childB', title: 'Child B', firstMessage: 'Yo', createdAt: 20 }
    ]
  },
  titles: { parent1: 'Parent Chat' }
};

const parentInfo = findParentBranch(branchData, 'childB');
assert.deepEqual(parentInfo, {
  parentId: 'parent1',
  branchIndex: 1,
  branch: branchData.branches.parent1[1]
});

const context = buildBranchContextNodes({
  branchData,
  parentId: 'parent1',
  currentConversationId: 'childB'
});
assert.equal(context.ancestorTitle?.type, 'ancestor-title');
assert.equal(context.branchRoot?.type, 'branchRoot');
assert.equal(context.branchNodes.length, 2);
assert.equal(context.branchNodes[1].isViewing, true);
```

**Step 2: Run test to verify it fails**

Run: `node tests/chatgpt-branch-utils.test.js`
Expected: FAIL with module not found / missing exports

**Step 3: Write minimal implementation**

```js
export function cleanChatGPTConversationId(id) {
  if (!id) return null;
  return id.replace(/^WEB:/, '');
}

export function extractChatGPTConversationIdFromPath(pathname = '') {
  const match = pathname.match(/\/c\/((?:WEB:)?[0-9a-f-]+)/i);
  return match?.[1] || null;
}

export function findParentBranch(branchData, childId) {
  if (!branchData?.branches || !childId) return null;
  for (const [parentId, branches] of Object.entries(branchData.branches)) {
    const idx = branches.findIndex((b) => b.childId === childId);
    if (idx >= 0) {
      return { parentId, branchIndex: idx, branch: branches[idx] };
    }
  }
  return null;
}

export function buildBranchContextNodes({
  branchData,
  parentId,
  currentConversationId
}) {
  if (!branchData || !parentId) {
    return { ancestorTitle: null, branchRoot: null, branchNodes: [] };
  }

  const parentTitle = branchData.titles?.[parentId] || 'Conversation';

  const ancestorTitle = {
    id: `ancestor-title:${parentId}`,
    type: 'ancestor-title',
    text: parentTitle,
    depth: 0,
    targetConversationId: parentId,
    isMainViewing: false
  };

  const branchRoot = {
    id: `branch-root:${parentId}`,
    type: 'branchRoot',
    text: parentTitle,
    depth: 0,
    targetConversationId: parentId
  };

  const branches = branchData.branches?.[parentId] || [];
  const branchNodes = branches.map((branch, idx) => ({
    id: `branch:${branch.childId}`,
    type: 'branch',
    text: branch.firstMessage || branch.title || 'Branched conversation',
    createTime: branch.createdAt || 0,
    targetConversationId: branch.childId,
    branchIndex: idx,
    branchLabel: `Branch: ${branch.title || 'New Chat'}`,
    depth: 1,
    icon: 'branch',
    isViewing: branch.childId === currentConversationId
  }));

  return { ancestorTitle, branchRoot, branchNodes };
}
```

**Step 4: Run test to verify it passes**

Run: `node tests/chatgpt-branch-utils.test.js`
Expected: PASS (no output)

**Step 5: Add test script + docs**

- Add `"test": "node tests/chatgpt-branch-utils.test.js"` to `package.json`.
- Update `AGENTS.md` Section 2.4 to include `npm test`.

**Step 6: Commit**

```bash
git add core/chatgpt-branch-utils.js tests/chatgpt-branch-utils.test.js package.json AGENTS.md
HUSKY=0 git commit -m "test: add chatgpt branch utils"
```

### Task 2: Update content.js (pre-branch + branch view)

**Files:**
- Modify: `content.js`

**Step 1: Extend failing tests for branch-context output**

Add additional expectations in `tests/chatgpt-branch-utils.test.js` for:
- `buildBranchContextNodes` includes `branchLabel`, `icon`, and `isViewing`.
- `extractChatGPTConversationIdFromPath` handles uppercase `WEB:` and mixed-case.

Run: `node tests/chatgpt-branch-utils.test.js`
Expected: FAIL with missing properties or mismatch

**Step 2: Update utils to pass tests**

- Ensure `extractChatGPTConversationIdFromPath` is case-insensitive.
- Ensure `buildBranchContextNodes` sets `branchLabel`, `icon`, `isViewing`.

Run: `node tests/chatgpt-branch-utils.test.js`
Expected: PASS

**Step 3: Apply the same logic in `content.js`**

- Add pure helpers (keep in sync with `core/chatgpt-branch-utils.js`):
  - `cleanChatGPTConversationId`
  - `extractChatGPTConversationIdFromPath`
  - `findParentBranch`
  - `buildBranchContextNodes`
- Update `getConversationId('chatgpt')` to return clean ID via helper.
- Update `fetchChatGPTConversation` to use clean ID for API + cache keys.
- Update URL change detection regex to support `WEB:` and compare clean IDs.
- In `handleGetTree`:
  - Derive `rawChatGPTId` + `isPreBranch` from `location.pathname`.
  - Use clean `conversationId` for fetch, cache, branchData keys.
  - Build branch context nodes if current conversation is a child branch.
  - Insert `current-title` node before current conversation messages.
  - Insert `preBranchIndicator` node when `isPreBranch`.
  - Set `hasAncestry: true` when branch context is present.

**Step 4: Run unit tests**

Run: `node tests/chatgpt-branch-utils.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add content.js core/chatgpt-branch-utils.js tests/chatgpt-branch-utils.test.js
HUSKY=0 git commit -m "feat: show branch context and pre-branch" 
```

### Task 3: Switch branch/edit icons to SVG

**Files:**
- Modify: `panel.js`
- Modify: `panel.html`
- Create: `tests/panel-icons.test.js`
- Modify: `package.json`

**Step 1: Write failing test**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('panel.js', 'utf8');
assert.ok(panel.includes('ICON_SVGS')); // expect constants
assert.ok(panel.includes('<svg'));
```

**Step 2: Run test to verify it fails**

Run: `node tests/panel-icons.test.js`
Expected: FAIL (ICON_SVGS missing)

**Step 3: Implement SVG icons**

- Add `ICON_SVGS` constants in `panel.js` for `branch` and `edit` (optional `info`).
- Replace emoji usage with inline SVG: `iconEl.innerHTML = ICON_SVGS[icon]`.
- If pre-branch banner uses icon, swap to SVG and adjust CSS sizing in `panel.html`.

**Step 4: Run tests to verify they pass**

Run: `node tests/panel-icons.test.js`
Expected: PASS

**Step 5: Update test script + commit**

- Update `package.json` test script to run both tests:
  - `"test": "node tests/chatgpt-branch-utils.test.js && node tests/panel-icons.test.js"`

```bash
git add panel.js panel.html tests/panel-icons.test.js package.json
HUSKY=0 git commit -m "style: replace branch icons with svg"
```

### Task 4: Final verification

**Files:**
- Modify: `AGENTS.md` (if not updated in Task 1)

**Step 1: Run full tests**

Run: `npm test`
Expected: PASS

**Step 2: Lint (optional)**

Run: `npm run lint`
Expected: PASS

**Step 3: Commit (if needed)**

```bash
git add AGENTS.md
HUSKY=0 git commit -m "docs: add test command"
```
