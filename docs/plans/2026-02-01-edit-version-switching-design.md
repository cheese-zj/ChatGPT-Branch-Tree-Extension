# Edit Version Switching (No Refresh)

**Date**: 2026-02-01
**Status**: Design Complete, Ready for Implementation

## Overview

Improve edit version navigation to be smooth and non-disruptive. Replace the
current refresh-based behavior with in-place version switching driven by
platform UI controls. The panel remains the primary control surface with inline
Prev/Next arrows and a vX/Y indicator. Switching updates both the panel content
and the page message without a full reload.

## Goals

1. **No Page Refresh**: Switching edit versions must not reload the page.
2. **Inline UX**: Version controls live inside each message card.
3. **Stable Navigation**: Clicking arrows switches versions; clicking the card
   still scrolls to the message.
4. **Sync Panel Content**: After switching, the card preview and vX/Y reflect
   the new version.
5. **Resilient Fallbacks**: Retry short-term, then show a brief error if the
   version UI is unavailable.

## UI/UX

- Message cards with `totalVersions > 1` show a compact control group:
  - Left arrow, `vX/Y`, right arrow.
  - Disable arrows at boundaries to avoid invalid actions.
- Clicking arrows stops propagation so it does not trigger the card click.
- A lightweight status message shows during switching (no modal/overlay).
- Keep existing edit version label styling; extend it to a control container.

## Data Flow

1. Panel arrow click sends:

   - `SWITCH_EDIT_VERSION` with:
     - `messageId`
     - `direction` (`-1` or `+1`)
     - `platform`

2. Content script handles the message:

   - Locate the message element.
   - Locate the platform version switcher UI.
   - Click the correct control (prev/next or a direct version).
   - Scroll and highlight the message.

3. MutationObserver/refresh pipeline updates tree data and triggers
   `TREE_UPDATED`, which updates the panel in place.

### Optional direct selection

When a direct sibling id is available (e.g., from an edit-branch node), the
message can include `targetVersionId` to switch directly to that version. This
reuses the same handler and still avoids page reloads.

## DOM Switching Strategy

- **ChatGPT** (primary target):
  - Find message by `data-message-id` or `data-testid`.
  - Search inside the message for version UI (text like `1/3`, or
    buttons/aria-labels with `version`/`edit`/`draft`).
  - Resolve prev/next buttons by sibling relations or aria-labels.
- **Claude/Gemini/Perplexity**:
  - Best-effort detection using platform-specific selectors.
  - If no controls found, return a structured error and leave state unchanged.

## Error Handling & Retries

- Use a short retry loop (e.g., 3 attempts with 300/600/900ms backoff).
- If controls remain unavailable, return `{ ok: false, error }`.
- Panel shows a brief, non-blocking error message and keeps current version.
- All `chrome.*` calls use `try/catch` and `lastError` checks.

## Testing Plan

1. **Manual** (required):
   - ChatGPT with multiple edit versions: arrows switch versions without
     reload; page updates; panel preview updates.
   - Boundary versions: correct arrow disable state.
   - Claude/Gemini/Perplexity: failure shows brief message without breaking
     navigation.
2. **Automated** (where feasible):
   - Panel click handler sends `SWITCH_EDIT_VERSION` and prevents propagation.
   - `_updateNodeElement` updates preview text and vX/Y after `TREE_UPDATED`.

## Out of Scope

- Replacing branch switching behavior for non-edit branches.
- Large UI redesigns beyond inline controls.
