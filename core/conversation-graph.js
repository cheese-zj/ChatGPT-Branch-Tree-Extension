/**
 * Conversation Graph - Deduplicated message DAG
 * Supports unified tree view across multiple conversations
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
}
