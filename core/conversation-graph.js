/**
 * Conversation Graph - Deduplicated message DAG
 * Supports unified tree view across multiple conversations
 */

'use strict';

/**
 * Represents a single message node in the graph
 */
export class MessageNode {
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
   */
  addToConversation(conversationId) {
    this.conversationIds.add(conversationId);
  }

  /**
   * Check if this message appears in multiple conversations
   */
  isShared() {
    return this.conversationIds.size > 1;
  }
}

/**
 * Graph representing conversation structure with deduplication
 */
export class ConversationGraph {
  constructor() {
    this.nodes = new Map(); // messageId -> MessageNode
    this.conversations = new Map(); // conversationId -> metadata
    this.editGroups = new Map(); // editGroupId -> Set<messageId>
  }

  /**
   * Add a message to the graph
   * If message already exists, just adds conversationId
   */
  addMessage(message, conversationId, metadata = {}) {
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
   */
  getNode(messageId) {
    return this.nodes.get(messageId);
  }

  /**
   * Check if node exists
   */
  hasNode(messageId) {
    return this.nodes.has(messageId);
  }
}
