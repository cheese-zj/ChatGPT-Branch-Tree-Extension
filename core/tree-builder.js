/**
 * Tree Builder - Platform-agnostic tree construction
 * Converts normalized messages into display tree nodes
 */

/**
 * @typedef {Object} Message
 * @property {string} id - Message ID
 * @property {string} role - 'user' | 'assistant' | 'system'
 * @property {string} text - Message content
 * @property {number} createTime - Unix timestamp (seconds)
 * @property {boolean} [hasEditVersions] - Has alternate versions
 * @property {number} [editVersionIndex] - Current version index (1-based)
 * @property {number} [totalVersions] - Total version count
 * @property {string} [parentId] - Parent message ID
 * @property {string[]} [siblingIds] - IDs of sibling versions
 */

/**
 * @typedef {Object} TreeNode
 * @property {string} id - Node ID
 * @property {string} type - 'message' | 'branch' | 'title' | 'branchRoot'
 * @property {string} [role] - Message role
 * @property {string} text - Display text
 * @property {number} createTime - Timestamp
 * @property {number} depth - Tree depth level
 * @property {string} [targetConversationId] - For navigation
 * @property {boolean} [hasEditVersions] - Has alternate versions
 * @property {number} [editVersionIndex] - Current version
 * @property {number} [totalVersions] - Total versions
 * @property {Object[]} [editVersions] - Alternate version data
 */

/**
 * Normalize timestamp to seconds
 * @param {number} ts - Timestamp (may be ms or seconds)
 * @returns {number} - Timestamp in seconds
 */
export function toSeconds(ts) {
  if (!ts || ts <= 0) return 0;
  return ts > 1e12 ? ts / 1000 : ts;
}

/**
 * Build a flat display list from normalized messages
 * @param {Message[]} messages - Normalized message array
 * @param {Object} options - Build options
 * @param {string} [options.conversationId] - Current conversation ID
 * @param {string} [options.title] - Conversation title
 * @param {Object} [options.branchData] - Branch relationship data
 * @returns {TreeNode[]} - Display tree nodes
 */
export function buildDisplayList(messages, options = {}) {
  const { conversationId, title, branchData } = options;
  const result = [];

  // Filter to user messages only (for indexing display)
  const userMessages = messages.filter((m) => m.role === 'user');

  // Sort by creation time
  userMessages.sort(
    (a, b) => toSeconds(a.createTime) - toSeconds(b.createTime)
  );

  // Add title node if provided
  if (title) {
    result.push({
      id: 'title-node',
      type: 'title',
      text: title,
      depth: 0,
      targetConversationId: conversationId
    });
  }

  // Build message nodes
  for (const msg of userMessages) {
    const node = {
      id: msg.id,
      type: 'message',
      role: msg.role,
      text: msg.text,
      createTime: toSeconds(msg.createTime),
      depth: 0,
      targetConversationId: conversationId
    };

    // Add edit version info if present
    if (msg.hasEditVersions) {
      node.hasEditVersions = true;
      node.editVersionIndex = msg.editVersionIndex;
      node.totalVersions = msg.totalVersions;
      if (msg.siblingIds) {
        node.siblingIds = msg.siblingIds;
      }
    }

    result.push(node);
  }

  // Add branch nodes from branchData if provided
  if (branchData?.branches?.[conversationId]) {
    const branches = branchData.branches[conversationId];
    const branchNodes = branches.map((branch, idx) => ({
      id: `branch:${branch.childId}`,
      type: 'branch',
      text: branch.firstMessage || branch.title || 'Branched conversation',
      createTime: toSeconds(branch.createdAt || 0),
      targetConversationId: branch.childId,
      branchIndex: idx,
      depth: 1
    }));

    // Sort branches by time
    branchNodes.sort((a, b) => a.createTime - b.createTime);

    // Merge with messages chronologically
    const allItems = [...result.slice(title ? 1 : 0), ...branchNodes];
    allItems.sort((a, b) => toSeconds(a.createTime) - toSeconds(b.createTime));

    // Rebuild result with title first
    result.length = title ? 1 : 0;
    result.push(...allItems);
  }

  return result;
}

/**
 * Mark terminal nodes in the tree
 * A terminal node has no continuation in its chain
 * @param {TreeNode[]} nodes - Tree nodes
 * @returns {TreeNode[]} - Nodes with isTerminal marked
 */
export function markTerminalNodes(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextNode = nodes[i + 1];

    // Last node is terminal
    if (!nextNode) {
      node.isTerminal = true;
      continue;
    }

    // Branches have their own terminal logic
    if (node.type === 'branch') {
      node.isTerminal = !node.expanded;
      continue;
    }

    // Check if next node continues the chain
    const sameContext =
      nextNode.type !== 'branch' &&
      (node.colorIndex === nextNode.colorIndex ||
        (node.colorIndex === undefined && nextNode.colorIndex === undefined));

    node.isTerminal = !sameContext;
  }

  return nodes;
}

/**
 * Generate a deterministic color index from a string
 * @param {string} str - String to hash
 * @returns {number} - Hash value
 */
export function hashString(str) {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Compute a render signature for change detection
 * @param {TreeNode[]} nodes - Tree nodes
 * @param {string} title - Conversation title
 * @param {Object} settings - Current settings
 * @returns {string} - Signature string
 */
export function computeRenderSignature(nodes, title, settings = {}) {
  try {
    return JSON.stringify({
      title: title || '',
      settings: {
        previewLength: settings.previewLength,
        timestampFormat: settings.timestampFormat,
        showTimestamps: settings.showTimestamps
      },
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        text: n.text?.slice(0, 50),
        depth: n.depth,
        hasEditVersions: n.hasEditVersions,
        editVersionIndex: n.editVersionIndex,
        totalVersions: n.totalVersions
      }))
    });
  } catch {
    return Math.random().toString(36);
  }
}

export default {
  toSeconds,
  buildDisplayList,
  markTerminalNodes,
  hashString,
  computeRenderSignature
};
