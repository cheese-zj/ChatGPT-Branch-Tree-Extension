# Unified Tree Design with Deduplication

**Date**: 2026-02-01
**Status**: Design Complete, Ready for Implementation

## Overview

Redesign the conversation tree architecture to build a true deduplicated tree structure where messages appear exactly once, with proper handling of edit versions and branch relationships.

## Current Problems

1. **Redundant Information**: Messages duplicated across branch contexts
2. **Unreliable Edit Detection**: Edit branches show inconsistently, especially on Claude
3. **Confusing Structure**: Chronological sorting mixes unrelated conversation paths
4. **No True Tree**: Flat list sorted by time, not a hierarchical graph

## Design Goals

1. **Deduplicated Universal Tree**: Each message appears exactly once
2. **Edit Siblings at Same Level**: Alternate versions shown side-by-side with version indicators
3. **Structure Over Time**: Tree follows conversation flow, timestamps are secondary
4. **Robust Edit Detection**: Multi-layered approach for platforms like Claude

## Architecture

### Component Structure

```
Platform Adapter (extracts raw messages)
    ↓
Conversation Graph Builder (deduplicates, builds DAG)
    ↓
Tree Renderer (traverses graph, creates display nodes)
    ↓
Panel UI (renders visual tree)
```

### Module Responsibilities

**1. Platform Adapters** (`platforms/*/adapter.js`)

- Extract messages with parent/sibling relationships
- Return normalized message arrays
- No changes to existing interface

**2. Conversation Graph** (`core/conversation-graph.js`) - NEW

- Accepts messages from multiple conversations
- Builds unified DAG with deduplication by message ID
- Provides traversal methods for rendering
- Validates graph integrity

**3. Tree Builder** (`core/tree-builder.js`) - MODIFIED

- New: `buildTreeFromGraph(graph, currentConvId, branchData)`
- Traverses graph to create display nodes
- Deprecated: `buildDisplayList` (kept for migration)

**4. Content Script** (`content.js`) - MODIFIED

- Collect messages from current + related conversations
- Build graph once, reuse for rendering
- Feature-flagged rollout per platform

## Data Structures

### MessageNode

```javascript
class MessageNode {
  id: string;                    // Unique message ID
  text: string;
  role: 'user' | 'assistant';
  createTime: number;

  // Relationships
  parentId: string | null;       // Primary parent (conversation flow)
  childIds: Set<string>;         // Possible continuations
  editSiblingIds: Set<string>;   // Alternate versions (same parent)

  // Metadata
  conversationIds: Set<string>;  // Which conversations contain this
  isEditVersion: boolean;
  editGroupId: string | null;    // Groups edit siblings together
  hasUnknownEdits: boolean;      // Flag for incomplete edit data
}
```

### ConversationGraph

```javascript
class ConversationGraph {
  nodes: Map<messageId, MessageNode>;
  conversations: Map<convId, metadata>;
  editGroups: Map<groupId, Set<messageId>>;

  addMessage(message, conversationId, metadata)
  processEditVersions(messages, platform)
  getConversationPath(conversationId): messageId[]
  getEditSiblings(messageId): Set<messageId>
  findDivergencePoint(childConvId, parentConvId): messageId
  validate(): errors[]
}
```

## Rendering Algorithm

### Tree Traversal

```javascript
function buildTreeFromGraph(graph, currentConversationId, branchData) {
  const displayNodes = [];
  const path = graph.getConversationPath(currentConversationId);

  for (const msgId of path) {
    // 1. Add main message at depth 0
    displayNodes.push({
      id: msgId,
      type: 'message',
      depth: 0,
      isShared: node.conversationIds.size > 1
    });

    // 2. Add edit siblings at depth 1
    const siblings = graph.getEditSiblings(msgId);
    for (const sibId of siblings) {
      if (sibId !== msgId) {
        displayNodes.push({
          id: sibId,
          type: 'editBranch',
          depth: 1,
          editVersionLabel: `v${index}/${total}`
        });
      }
    }

    // 3. Add external branches at depth 1
    const branches = findBranchesFromMessage(msgId, branchData);
    for (const branch of branches) {
      displayNodes.push({
        type: 'branch',
        depth: 1,
        targetConversationId: branch.childId
      });
    }
  }

  return displayNodes;
}
```

### Branch View Rendering

When viewing a child branch:

```javascript
// SECTION 1: Shared history (before divergence)
const sharedPath = graph.getPathToNode(divergencePoint);
for (const msgId of sharedPath) {
  nodes.push({
    ...createDisplayNode(msgId),
    depth: 0,
    isShared: true,
    isBeforeDivergence: true
  });
}

// SECTION 2: Divergence point with branch options
nodes.push({
  type: 'branchRoot',
  text: 'Branches from here'
});

const allBranches = graph.getBranchesFromNode(divergencePoint);
for (const branch of allBranches) {
  nodes.push({
    type: 'branch',
    depth: 1,
    isViewing: branch.convId === currentConversationId
  });
}

// SECTION 3: Current branch's unique messages
const uniquePath = graph.getUniquePathAfter(divergencePoint, currentConvId);
for (const msgId of uniquePath) {
  nodes.push({
    ...createDisplayNode(msgId),
    depth: 0,
    isUnique: true
  });
}
```

## Edit Version Detection

### Multi-Layered Strategy (Claude)

**Layer 1: API Interception**

```javascript
// Intercept fetch calls to Claude's API
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const clone = response.clone();

  if (isClaudeAPI(args[0])) {
    const data = await clone.json();
    this._processAPIResponse(data);
  }

  return response;
};
```

**Layer 2: MutationObserver for Version Switchers**

```javascript
// Watch for version switcher UI appearing
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    this._scanForVersionSwitchers(mutation.target);
  }
});
```

**Layer 3: DOM Structure Analysis**

```javascript
// Analyze message parent-child relationships from API responses
function _buildEditRelationships(messages) {
  const parentMap = new Map();

  for (const msg of messages) {
    if (msg.parent_message_id) {
      parentMap.get(msg.parent_message_id).push(msg.id);
    }
  }

  // Messages with same parent are edit siblings
  for (const [parentId, siblings] of parentMap) {
    if (siblings.length > 1) {
      this._cacheEditGroup(parentId, siblings);
    }
  }
}
```

**Caching for Persistence**

```javascript
// Store discovered edit relationships
async _cacheVersionInfo(messageId, editInfo) {
  const key = `claude_edit_cache_${conversationId}`;
  await chrome.storage.local.set({
    [key]: { ...editInfo, timestamp: Date.now() }
  });
}
```

## Error Handling

### Graceful Degradation

```javascript
static async buildFromConversation(convId, platform, branchData) {
  const graph = new ConversationGraph();
  const errors = [];

  try {
    // Load current conversation (critical)
    const currentMessages = await this._fetchWithRetry(convId, platform);
    // ... add to graph
  } catch (e) {
    return { graph: null, errors: [{ type: 'critical', error: e }] };
  }

  try {
    // Load parent conversation (non-critical)
    const parentMessages = await this._fetchWithRetry(parentId, platform);
    // ... add to graph
  } catch (e) {
    errors.push({ type: 'parent_load', error: e });
    // Continue without parent context
  }

  return { graph, errors };
}
```

### Validation

```javascript
validate() {
  const errors = [];

  // Check for orphaned nodes
  for (const [id, node] of this.nodes) {
    if (node.parentId && !this.nodes.has(node.parentId)) {
      errors.push({ type: 'orphaned_node', messageId: id });
    }
  }

  // Check for circular references
  for (const [id, _] of this.nodes) {
    if (this._hasCircularPath(id)) {
      errors.push({ type: 'circular_reference', messageId: id });
    }
  }

  return errors;
}
```

## Migration Strategy

### Phase 1: Add Graph Layer (Non-Breaking)

- Create `core/conversation-graph.js`
- Keep existing code working
- Feature flag: `USE_GRAPH_BUILDER = false`

### Phase 2: ChatGPT Only

- Enable graph builder for ChatGPT
- Test deduplication and edit detection
- Validate performance

### Phase 3: Extend to Other Platforms

- Claude with improved edit detection
- Gemini/Perplexity (basic support)

### Phase 4: Full Migration

- Remove legacy code
- Clean up feature flags

### Backward Compatibility

```javascript
const BRANCH_DATA_VERSION = 2;

function migrateBranchData(oldData) {
  return {
    ...oldData,
    version: BRANCH_DATA_VERSION,
    editGroups: {}, // New field
    messageIndex: {} // New field
  };
}
```

## Modern Module Structure

### ES Modules (Manifest V3)

**manifest.json**

```json
{
  "manifest_version": 3,
  "content_scripts": [
    {
      "js": ["content.js"],
      "type": "module"
    }
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

**content.js**

```javascript
'use strict';

import { ConversationGraph } from './core/conversation-graph.js';
import * as TreeBuilder from './core/tree-builder.js';
import * as Storage from './core/storage.js';

// No IIFE wrapper needed
```

## File Structure

```
Extension/
├── core/
│   ├── conversation-graph.js        # NEW - Graph data structure
│   ├── tree-builder.js              # MODIFIED - Use graph
│   ├── storage.js                   # MODIFIED - Edit group caching
│   └── platform-registry.js         # No changes
│
├── platforms/
│   ├── base-adapter.js              # MODIFIED - Edit detection hooks
│   ├── chatgpt/adapter.js           # MODIFIED - Enhanced edit processing
│   └── claude/adapter.js            # MODIFIED - API interception
│
├── content.js                       # MODIFIED - Convert to ES module
├── panel.js                         # MODIFIED - Handle new node types
└── manifest.json                    # MODIFIED - Add type: "module"
```

## Testing Strategy

Manual QA checklist (no automated tests):

### ChatGPT

- [ ] Load conversation with no branches
- [ ] Load conversation with edit versions
- [ ] Load conversation with "Branch in new chat"
- [ ] View child branch (parent context + no duplicates)
- [ ] Click edit version → navigates correctly
- [ ] Click branch node → opens branch
- [ ] Pre-branch state (WEB:) → shows indicator

### Claude

- [ ] Load conversation → extracts from DOM
- [ ] Edit message → detects versions
- [ ] API interception working
- [ ] Fallback when API fails

### Edge Cases

- [ ] Parent deleted → warning, shows current only
- [ ] Network error → error state
- [ ] Stale cache → auto-refresh
- [ ] Empty conversation → empty state
- [ ] Large conversation (100+ msgs) → adequate performance

## Performance

### Lazy Loading for Large Graphs

```javascript
async addConversation(convId, messages) {
  if (messages.length > 100) {
    // Load in chunks to avoid blocking UI
    const chunkSize = 50;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      for (const msg of chunk) {
        this.addMessage(msg, convId);
      }
      await new Promise(r => setTimeout(r, 0)); // Yield to event loop
    }
  } else {
    for (const msg of messages) {
      this.addMessage(msg, convId);
    }
  }
}
```

## Success Criteria

1. **No Duplicate Messages**: Each message appears once in the tree
2. **Reliable Edit Detection**: Edit versions consistently shown on ChatGPT and Claude
3. **Clear Structure**: Tree follows conversation flow, not timestamp order
4. **Backward Compatible**: Existing branch data works without migration
5. **Performance**: No noticeable lag for conversations up to 200 messages

## Risks & Mitigations

| Risk                            | Mitigation                                   |
| ------------------------------- | -------------------------------------------- |
| Breaking existing functionality | Phased rollout with feature flags            |
| Claude API changes              | Multi-layered detection with fallbacks       |
| Performance degradation         | Lazy loading for large graphs                |
| Data migration issues           | Keep old format working, auto-migrate        |
| Complex graph bugs              | Comprehensive validation in graph.validate() |

## Next Steps

1. Create `core/conversation-graph.js` with MessageNode and ConversationGraph classes
2. Modify `core/tree-builder.js` to add `buildTreeFromGraph` function
3. Update `platforms/claude/adapter.js` with API interception
4. Convert `content.js` to ES module and add feature flag
5. Update `manifest.json` for ES module support
6. Manual QA with ChatGPT first
7. Expand to Claude once stable
