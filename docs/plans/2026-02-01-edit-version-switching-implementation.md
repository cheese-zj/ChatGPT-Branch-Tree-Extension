# Edit Version Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable in-panel edit version switching without page reloads, using inline prev/next controls that trigger platform UI updates.

**Architecture:** Add inline version controls in the panel, route clicks through a new `SWITCH_EDIT_VERSION` message to the content script, and have the content script click the platform’s version UI (with retries) plus trigger a local refresh. Keep the tree update flow via `TREE_UPDATED` so the panel stays in sync.

**Tech Stack:** Vanilla JS, Chrome Extension APIs, DOM selectors, MutationObserver.

## Task 1: Add panel version controls UI

**Files:**

- Modify: `panel.js`
- Modify: `panel.html`
- Create: `tests/panel-version-controls.test.js`

**Step 1: Write the failing test**

```js
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const panel = readFileSync('panel.js', 'utf8');
const html = readFileSync('panel.html', 'utf8');

assert.ok(panel.includes('card-version-control'));
assert.ok(panel.includes('version-arrow'));
assert.ok(html.includes('.card-version-control'));
```

**Step 2: Run test to verify it fails**

Run: `node --no-warnings tests/panel-version-controls.test.js`

Expected: FAIL with missing string assertions.

**Step 3: Render inline controls**

Update `panel.js` inside `createNodeElement` to replace the single
`card-version-tag` with a control container:

```js
const versionControl = document.createElement('span');
versionControl.className = 'card-version-control';

const prevBtn = document.createElement('button');
prevBtn.type = 'button';
prevBtn.className = 'version-arrow version-prev';
prevBtn.setAttribute('aria-label', 'Previous version');
prevBtn.dataset.direction = '-1';

const label = document.createElement('span');
label.className = 'version-label';
label.textContent = `v${editVersionIndex}/${totalVersions}`;

const nextBtn = document.createElement('button');
nextBtn.type = 'button';
nextBtn.className = 'version-arrow version-next';
nextBtn.setAttribute('aria-label', 'Next version');
nextBtn.dataset.direction = '1';

versionControl.append(prevBtn, label, nextBtn);
header.appendChild(versionControl);
```

Also apply disabled state when `editVersionIndex` is at the ends by adding a
`.is-disabled` class and `aria-disabled="true"`.

**Step 4: Add CSS styles**

Update `panel.html` styles to include:

```css
.card-version-control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  color: var(--accent);
}

.version-arrow {
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  background: transparent;
  color: var(--accent);
  border-radius: 4px;
  padding: 0 4px;
  cursor: pointer;
}

.version-arrow.is-disabled {
  opacity: 0.4;
  cursor: default;
}
```

**Step 5: Run the test**

Run: `node --no-warnings tests/panel-version-controls.test.js`

Expected: PASS

**Step 6: Commit**

```bash
git add panel.js panel.html tests/panel-version-controls.test.js
git commit -m "feat: add inline version controls"
```

## Task 2: Add panel click handling and routing

**Files:**

- Modify: `panel.js`
- Modify: `content.js`
- Modify: `tests/panel-version-controls.test.js`

**Step 1: Extend the test to require routing token**

```js
assert.ok(panel.includes('SWITCH_EDIT_VERSION'));
```

**Step 2: Run test to verify it fails**

Run: `node --no-warnings tests/panel-version-controls.test.js`

Expected: FAIL on missing token.

**Step 3: Add click handling**

Update the tree click handler to intercept arrow clicks before node navigation.
Send a message using `tabsSendMessageSafe`:

```js
const arrow = e.target.closest('.version-arrow');
if (arrow) {
  const node = e.target.closest('.tree-node');
  const nodeId = node?.dataset?.nodeId;
  const nodeData = nodeDataMap.get(nodeId);
  await requestEditVersionSwitch(nodeData, {
    direction: parseInt(arrow.dataset.direction, 10)
  });
  return;
}
```

Add `requestEditVersionSwitch` to:

- Validate `activeTabId`.
- Show `setStatus('Switching version...', 'loading')`.
- Send `{ type: 'SWITCH_EDIT_VERSION', messageId, direction, steps }`.
- Show a short error on failure.

Also update `handleNodeClick` for `type === 'editBranch'` to call
`requestEditVersionSwitch` instead of `SWITCH_CHATGPT_BRANCH`. Use the
`siblingIds` list to resolve the current message node in the tree and compute
steps to reach the target version.

**Step 4: Ensure edit-branch nodes include edit indices**

In `content.js` inside `extractChatGPTTree`, include `editVersionIndex`,
`totalVersions`, and `siblingIds` on edit-branch items so the panel can compute
switch steps.

**Step 5: Run test to verify it passes**

Run: `node --no-warnings tests/panel-version-controls.test.js`

Expected: PASS

**Step 6: Commit**

```bash
git add panel.js content.js tests/panel-version-controls.test.js
git commit -m "feat: route edit version switches from panel"
```

## Task 3: Implement content-script version switching

**Files:**

- Modify: `content.js`

**Step 1: Write a small failing assertion test (optional)**

If no practical unit test is possible, skip and document manual QA in the
commit message. Otherwise create a simple string-presence test to assert the
new handler exists.

**Step 2: Add message handler**

Add a new `SWITCH_EDIT_VERSION` branch in the message listener:

```js
if (msg?.type === 'SWITCH_EDIT_VERSION') {
  handleSwitchEditVersion(msg).then(sendResponse);
  return true;
}
```

**Step 3: Implement switching with retries**

Add helpers near DOM interaction:

```js
async function handleSwitchEditVersion({ messageId, direction, steps = 1 }) {
  const platform = detectPlatform();
  const el = findMessageElement(messageId, platform);
  if (!el) return { ok: false, error: 'Message not found' };

  for (let attempt = 0; attempt < 3; attempt++) {
    const controls = findVersionControls(el, platform);
    if (controls) {
      const btn = direction < 0 ? controls.prev : controls.next;
      if (
        !btn ||
        btn.disabled ||
        btn.getAttribute('aria-disabled') === 'true'
      ) {
        return { ok: false, error: 'Version control unavailable' };
      }
      for (let i = 0; i < steps; i++) btn.click();
      scrollToMessage(messageId, platform);
      scheduleRefresh(200);
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 300 + attempt * 300));
  }

  return { ok: false, error: 'Version controls not found' };
}
```

`findVersionControls` should:

- Search inside the message element for buttons with `aria-label` or `title`
  containing `previous/next/version/edit/draft`.
- If a `1/3` style label exists, locate the nearest two buttons and treat them
  as prev/next.
- Return `{ prev, next }` or `null`.

**Step 4: Run existing tests**

Run: `npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add content.js
git commit -m "feat: switch edit versions without page reload"
```

## Task 4: Manual QA checklist

**Files:**

- Modify: `docs/plans/2026-02-01-edit-version-switching-implementation.md`

**Step 1: Add a manual QA section at the end**

```md
### Manual QA

- ChatGPT: edit message with multiple versions → arrows switch versions without reload
- Panel preview updates after switch (content + vX/Y)
- Boundary versions disable prev/next
- Claude/Gemini/Perplexity: if version UI missing, show brief error without crash
```

**Step 2: Commit**

```bash
git add docs/plans/2026-02-01-edit-version-switching-implementation.md
git commit -m "docs: add edit version switch QA steps"
```

### Manual QA

- ChatGPT: edit message with multiple versions → arrows switch versions without reload
- Panel preview updates after switch (content + vX/Y)
- Boundary versions disable prev/next
- Claude/Gemini/Perplexity: if version UI missing, show brief error without crash
