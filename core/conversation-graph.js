/**
 * Conversation Graph - Deduplicated message DAG
 * Supports unified tree view across multiple conversations
 */

/**
 * Validation error object returned by ConversationGraph.validate()
 * @typedef {Object} ValidationError
 * @property {string} type - Error type: 'orphaned_node', 'circular_reference',
 *   'inconsistent_parent_child', 'missing_edit_sibling', 'edit_group_mismatch',
 *   or 'orphaned_edit_group'
 * @property {string} messageId - ID of the problematic message
 * @property {string} [missingParent] - For 'orphaned_node': ID of missing parent
 * @property {string} [parentId] - For 'inconsistent_parent_child': ID of parent node
 * @property {string} [editGroupId] - For edit group errors: ID of the edit group
 * @property {string} [missingMessageId] - For 'missing_edit_sibling': ID of missing sibling
 * @property {string} [expectedGroup] - For 'edit_group_mismatch': expected group ID
 * @property {string} [actualGroup] - For 'edit_group_mismatch': actual group ID
 */

/**
 * Represents a single message node in the graph
 * @class
 */
export class MessageNode {
  /**
   * @param {string} id - Unique message identifier
   * @param {Object} message - Message data
   * @param {string} [message.text] - Message text content
   * @param {string} message.role - Message role ('user' or 'assistant')
   * @param {number} [message.createTime] - Message creation timestamp
   * @param {string|null} [message.parentId] - Parent message ID
   */
  constructor(id, message) {
    this.id = id;
    this.text = message.text || '';
    this.role = message.role; // 'user' | 'assistant'
    this.createTime = message.createTime || 0;

    // Relationships
    this.parentId = message.parentId || null;
    this.childIds = new Set();
    this.editSiblingIds = new Set();

    // Metadata
    this.conversationIds = new Set();
    this.isEditVersion = false;
    this.editGroupId = null;
    this.hasUnknownEdits = false;
  }

  /**
   * Add this node to a conversation
   * @param {string} conversationId - Conversation identifier
   */
  addToConversation(conversationId) {
    this.conversationIds.add(conversationId);
  }

  /**
   * Check if this message appears in multiple conversations
   * @returns {boolean} True if message is shared across conversations
   */
  isShared() {
    return this.conversationIds.size > 1;
  }
}

/**
 * Graph representing conversation structure with deduplication
 * @class
 */
export class ConversationGraph {
  constructor() {
    /** @type {Map<string, MessageNode>} */
    this.nodes = new Map(); // messageId -> MessageNode
    /** @type {Map<string, Object>} */
    this.conversations = new Map(); // conversationId -> metadata
    /** @type {Map<string, Set<string>>} */
    this.editGroups = new Map(); // editGroupId -> Set<messageId>
  }

  /**
   * Add a message to the graph
   * If message already exists, just adds conversationId to existing node
   *
   * IMPORTANT: Messages should be added in parent-first order to ensure
   * parent-child relationships are established correctly
   *
   * @param {Object} message - Message data
   * @param {string} message.id - Unique message identifier
   * @param {string} message.role - Message role ('user' or 'assistant')
   * @param {string} [message.text] - Message text content
   * @param {number} [message.createTime] - Message creation timestamp
   * @param {string|null} [message.parentId] - Parent message ID
   * @param {string} conversationId - Conversation identifier
   * @param {Object} [_metadata] - Reserved for future use
   * @returns {MessageNode|null} Created or existing node, or null on invalid input
   */
  addMessage(message, conversationId, _metadata = {}) {
    // Validate inputs
    if (!message || typeof message !== 'object') {
      console.warn('ConversationGraph.addMessage: Invalid message object');
      return null;
    }

    if (!message.id || typeof message.id !== 'string') {
      console.warn(
        'ConversationGraph.addMessage: Invalid or missing message.id'
      );
      return null;
    }

    if (!conversationId || typeof conversationId !== 'string') {
      console.warn(
        'ConversationGraph.addMessage: Invalid or missing conversationId'
      );
      return null;
    }

    const { id } = message;

    if (this.nodes.has(id)) {
      // Message already exists - just add to conversation
      const node = this.nodes.get(id);
      node.addToConversation(conversationId);
      return node;
    }

    // Create new node
    const node = new MessageNode(id, message);
    node.addToConversation(conversationId);
    this.nodes.set(id, node);

    // Establish parent-child relationship
    if (node.parentId && this.nodes.has(node.parentId)) {
      const parent = this.nodes.get(node.parentId);
      parent.childIds.add(id);
    }

    return node;
  }

  /**
   * Get a node by ID
   * @param {string} messageId - Message identifier
   * @returns {MessageNode|undefined} The node, or undefined if not found
   */
  getNode(messageId) {
    return this.nodes.get(messageId);
  }

  /**
   * Check if node exists
   * @param {string} messageId - Message identifier
   * @returns {boolean} True if node exists in graph
   */
  hasNode(messageId) {
    return this.nodes.has(messageId);
  }

  /**
   * Process edit version relationships from platform adapter
   * @param {Array<{id: string, siblingIds?: string[], parentId?: string}>} messages - Messages with siblingIds
   * @param {string} platform - Platform identifier
   */
  processEditVersions(messages, platform) {
    if (platform === 'chatgpt') {
      this._processChatGPTEdits(messages);
    }
    // Other platforms will be added in Phase 3
  }

  /**
   * Process ChatGPT edit relationships (uses siblingIds)
   * @param {Array<{id: string, siblingIds?: string[], parentId?: string}>} messages - Messages with siblingIds property
   * @private
   */
  _processChatGPTEdits(messages) {
    // Validate input
    if (!Array.isArray(messages)) {
      console.warn(
        'ConversationGraph._processChatGPTEdits: messages must be an array'
      );
      return;
    }

    const processedGroups = new Set();

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      if (!msg.id || typeof msg.id !== 'string') continue;
      if (!Array.isArray(msg.siblingIds) || msg.siblingIds.length <= 1)
        continue;

      // Use first sibling ID (sorted) as canonical groupId
      const sortedSiblings = [...msg.siblingIds].sort();
      const groupId = sortedSiblings[0];

      // Skip if we've already processed this group
      if (processedGroups.has(groupId)) continue;
      processedGroups.add(groupId);

      // Create edit group if it doesn't exist
      if (!this.editGroups.has(groupId)) {
        this.editGroups.set(groupId, new Set());
      }

      // Add all siblings to the group
      for (const sibId of sortedSiblings) {
        this.editGroups.get(groupId).add(sibId);

        // Mark nodes as edit versions
        const node = this.nodes.get(sibId);
        if (node) {
          node.editGroupId = groupId;
          node.isEditVersion = true;

          // Add sibling relationships
          for (const otherId of sortedSiblings) {
            if (otherId !== sibId) {
              node.editSiblingIds.add(otherId);
            }
          }
        }
      }
    }
  }

  /**
   * Get all edit siblings for a message
   * @param {string} messageId - Message ID
   * @returns {Set<string>} Set of sibling message IDs (including self)
   */
  getEditSiblings(messageId) {
    // Validate input
    if (!messageId || typeof messageId !== 'string') {
      console.warn(
        'ConversationGraph.getEditSiblings: Invalid or missing messageId'
      );
      return new Set([messageId]);
    }

    const node = this.nodes.get(messageId);
    if (!node || !node.editGroupId) {
      return new Set([messageId]);
    }

    return this.editGroups.get(node.editGroupId) || new Set([messageId]);
  }

  /**
   * Store conversation metadata including path
   * @param {string} conversationId - Conversation ID
   * @param {Array<string>} path - Ordered array of message IDs
   * @param {Object} metadata - Additional metadata
   */
  setConversationPath(conversationId, path, metadata = {}) {
    // Validate inputs
    if (!conversationId || typeof conversationId !== 'string') {
      console.warn(
        'ConversationGraph.setConversationPath: Invalid or missing conversationId'
      );
      return;
    }

    if (!Array.isArray(path)) {
      console.warn(
        'ConversationGraph.setConversationPath: path must be an array'
      );
      return;
    }

    this.conversations.set(conversationId, {
      path,
      ...metadata
    });
  }

  /**
   * Get the conversation path (ordered message IDs)
   * @param {string} conversationId - Conversation ID
   * @returns {Array<string>} Ordered message IDs
   */
  getConversationPath(conversationId) {
    // Validate input
    if (!conversationId || typeof conversationId !== 'string') {
      console.warn(
        'ConversationGraph.getConversationPath: Invalid or missing conversationId'
      );
      return [];
    }

    const conv = this.conversations.get(conversationId);
    return conv?.path || [];
  }

  /**
   * Find divergence point between two conversations
   * @param {string} childConvId - Child conversation ID
   * @param {string} parentConvId - Parent conversation ID
   * @returns {string|null} Message ID where paths diverge, or null if no common messages
   */
  findDivergencePoint(childConvId, parentConvId) {
    // Validate inputs
    if (!childConvId || typeof childConvId !== 'string') {
      console.warn(
        'ConversationGraph.findDivergencePoint: Invalid or missing childConvId'
      );
      return null;
    }

    if (!parentConvId || typeof parentConvId !== 'string') {
      console.warn(
        'ConversationGraph.findDivergencePoint: Invalid or missing parentConvId'
      );
      return null;
    }

    const childPath = this.getConversationPath(childConvId);
    const parentPath = this.getConversationPath(parentConvId);

    if (!childPath.length || !parentPath.length) return null;

    // Find last common message
    let divergenceIndex = -1;
    const minLength = Math.min(childPath.length, parentPath.length);

    for (let i = 0; i < minLength; i++) {
      if (childPath[i] === parentPath[i]) {
        divergenceIndex = i;
      } else {
        break;
      }
    }

    return divergenceIndex >= 0 ? childPath[divergenceIndex] : null;
  }

  /**
   * Get messages unique to a conversation after divergence point
   * @param {string} divergenceMessageId - Where the split happened
   * @param {string} conversationId - Conversation to get unique messages from
   * @returns {Array<string>} Message IDs after divergence
   */
  getUniquePathAfter(divergenceMessageId, conversationId) {
    // Validate inputs
    if (!divergenceMessageId || typeof divergenceMessageId !== 'string') {
      console.warn(
        'ConversationGraph.getUniquePathAfter: Invalid or missing divergenceMessageId'
      );
      return [];
    }

    if (!conversationId || typeof conversationId !== 'string') {
      console.warn(
        'ConversationGraph.getUniquePathAfter: Invalid or missing conversationId'
      );
      return [];
    }

    const path = this.getConversationPath(conversationId);
    const divergenceIndex = path.indexOf(divergenceMessageId);

    if (divergenceIndex === -1) return path;

    // Return messages after divergence point
    return path.slice(divergenceIndex + 1);
  }

  /**
   * Validate graph integrity
   * Checks for orphaned nodes, circular references, parent-child consistency,
   * and edit group consistency
   * @returns {Array<ValidationError>} Array of validation errors (empty if valid)
   */
  validate() {
    const errors = [];

    // Check for orphaned nodes (parent doesn't exist)
    for (const [id, node] of this.nodes) {
      if (node.parentId && !this.nodes.has(node.parentId)) {
        errors.push({
          type: 'orphaned_node',
          messageId: id,
          missingParent: node.parentId
        });
      }
    }

    // Check for bidirectional parent-child consistency
    for (const [id, node] of this.nodes) {
      if (node.parentId) {
        const parent = this.nodes.get(node.parentId);
        if (parent && !parent.childIds.has(id)) {
          errors.push({
            type: 'inconsistent_parent_child',
            messageId: id,
            parentId: node.parentId
          });
        }
      }
    }

    // Check for circular references (optimized O(n) with shared visited set)
    const visitedGlobal = new Set();
    for (const [id, _] of this.nodes) {
      if (!visitedGlobal.has(id)) {
        const circularId = this._findCircularPath(id, visitedGlobal);
        if (circularId) {
          errors.push({
            type: 'circular_reference',
            messageId: circularId
          });
        }
      }
    }

    // Check for inconsistent edit groups (forward: group -> nodes)
    for (const [groupId, sibIds] of this.editGroups) {
      for (const sibId of sibIds) {
        const node = this.nodes.get(sibId);
        if (!node) {
          errors.push({
            type: 'missing_edit_sibling',
            editGroupId: groupId,
            missingMessageId: sibId
          });
        } else if (node.editGroupId !== groupId) {
          errors.push({
            type: 'edit_group_mismatch',
            messageId: sibId,
            expectedGroup: groupId,
            actualGroup: node.editGroupId
          });
        }
      }
    }

    // Check for orphaned edit groups (reverse: nodes -> group)
    for (const [id, node] of this.nodes) {
      if (node.editGroupId && !this.editGroups.has(node.editGroupId)) {
        errors.push({
          type: 'orphaned_edit_group',
          messageId: id,
          editGroupId: node.editGroupId
        });
      }
    }

    return errors;
  }

  /**
   * Find circular reference in parent chain (optimized)
   * Uses shared visited set to avoid redundant traversals (O(n) total complexity)
   * @param {string} startId - Starting message ID
   * @param {Set<string>} visitedGlobal - Global visited set across all checks
   * @returns {string|null} ID of message in cycle, or null if no cycle
   * @private
   */
  _findCircularPath(startId, visitedGlobal) {
    const pathSet = new Set();
    let currentId = startId;

    while (currentId) {
      // Already checked this entire path - no cycle
      if (visitedGlobal.has(currentId)) {
        // Mark all nodes in current path as visited
        for (const id of pathSet) {
          visitedGlobal.add(id);
        }
        return null;
      }

      // Cycle detected in current path
      if (pathSet.has(currentId)) {
        return currentId;
      }

      pathSet.add(currentId);
      const node = this.nodes.get(currentId);

      if (!node || !node.parentId) {
        // Reached end of chain - mark all as visited
        for (const id of pathSet) {
          visitedGlobal.add(id);
        }
        return null;
      }

      currentId = node.parentId;
    }

    // Mark all nodes in path as visited
    for (const id of pathSet) {
      visitedGlobal.add(id);
    }
    return null;
  }
}
