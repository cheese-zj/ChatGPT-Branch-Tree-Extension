# Branch Node First-Message Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure branch nodes display the first message after branching (not the ancestor's first message).

**Architecture:** Add a small pure helper to select the first user message after a branch timestamp (unit-tested) and use it in the ChatGPT branch-recording path. Content script mirrors the same helper logic locally.

**Tech Stack:** Vanilla JS, Node assert tests, Chrome Extension content script.

### Task 1: Add helper + tests (TDD)

**Files:**
- Modify: `tests/chatgpt-branch-utils.test.js`
- Modify: `core/chatgpt-branch-utils.js`

**Step 1: Write the failing test**

```js
const sample = [
  { text: 'old', createTime: 1 },
  { text: 'new', createTime: 5 }
];

assert.equal(
  selectFirstMessageAfterTimestamp(sample, 4),
  'new'
);
assert.equal(
  selectFirstMessageAfterTimestamp(sample, 10),
  'old'
);
assert.equal(
  selectFirstMessageAfterTimestamp(sample, null),
  'old'
);
```

**Step 2: Run test to verify it fails**

Run: `node --no-warnings tests/chatgpt-branch-utils.test.js`
Expected: FAIL with missing export or function

**Step 3: Implement minimal helper**

```js
export function selectFirstMessageAfterTimestamp(messages, timestampSeconds) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const sorted = messages
    .map((m) => ({
      text: m?.text || '',
      createTime: typeof m?.createTime === 'number' ? m.createTime : 0
    }))
    .filter((m) => m.text)
    .sort((a, b) => a.createTime - b.createTime);

  if (!sorted.length) return null;
  if (typeof timestampSeconds === 'number') {
    const match = sorted.find((m) => m.createTime >= timestampSeconds);
    if (match) return match.text;
  }
  return sorted[0].text;
}
```

**Step 4: Run test to verify it passes**

Run: `node --no-warnings tests/chatgpt-branch-utils.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add core/chatgpt-branch-utils.js tests/chatgpt-branch-utils.test.js
HUSKY=0 git commit -m "test: select branch first message"
```

### Task 2: Use helper logic in content.js

**Files:**
- Modify: `content.js`

**Step 1: Add failing test case**

Extend `tests/chatgpt-branch-utils.test.js` with a case that includes unsorted input and expects the correct selection, then run:

Run: `node --no-warnings tests/chatgpt-branch-utils.test.js`
Expected: FAIL

**Step 2: Update helper (if needed) and mirror in content.js**

- Ensure helper sorts and filters correctly.
- Add a local `selectFirstMessageAfterTimestamp` in `content.js` with identical logic.
- In `checkPendingBranch`, compute `firstMessage` using the helper and `pending.timestamp`.

**Step 3: Run tests**

Run: `node --no-warnings tests/chatgpt-branch-utils.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add content.js core/chatgpt-branch-utils.js tests/chatgpt-branch-utils.test.js
HUSKY=0 git commit -m "fix: use branch-first message after timestamp"
```

### Task 3: Final verification

**Files:**
- None

**Step 1: Run full tests**

Run: `npm test`
Expected: PASS
