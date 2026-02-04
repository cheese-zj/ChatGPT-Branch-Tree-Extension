/**
 * ChatGPT Platform Adapter
 * Handles conversation extraction, edit versions, and branch tracking for ChatGPT
 */

import { BaseAdapter } from '../base-adapter.js';
import * as storage from '../../core/storage.js';

// Constants
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minute TTL for access token

/**
 * ChatGPT Platform Adapter
 */
export class ChatGPTAdapter extends BaseAdapter {
  constructor() {
    super();

    // Access token cache
    this._cachedToken = null;
    this._tokenExpiry = 0;

    // Pending branch detection
    this._pendingBranch = null;

    // Bind methods for event listeners
    this._handleBranchClick = this._handleBranchClick.bind(this);
  }

  // ============================================
  // Platform Identification
  // ============================================

  get platformId() {
    return 'chatgpt';
  }

  get platformName() {
    return 'ChatGPT';
  }

  get platformColor() {
    return '#10a37f';
  }

  // ============================================
  // URL Matching
  // ============================================

  matchUrl(url) {
    return /^https:\/\/(www\.)?(chatgpt\.com|chat\.openai\.com)/i.test(url);
  }

  getConversationId() {
    // Match both regular IDs and WEB: prefixed pre-branch IDs
    const match = location.pathname.match(/\/c\/((?:WEB:)?[0-9a-f-]+)/i);
    return match?.[1] || null;
  }

  /**
   * Check if current conversation is a pre-branch state (WEB: prefix)
   * @returns {boolean}
   */
  isPreBranch() {
    const id = this.getConversationId();
    return id ? id.startsWith('WEB:') : false;
  }

  /**
   * Extract the clean conversation ID (remove WEB: prefix if present)
   * @param {string} [id] - Conversation ID (defaults to current)
   * @returns {string|null} - Clean ID
   */
  getCleanConversationId(id) {
    const convId = id || this.getConversationId();
    if (!convId) return null;
    return convId.replace(/^WEB:/, '');
  }

  getBaseUrl() {
    return location.hostname.includes('openai')
      ? 'https://chat.openai.com'
      : 'https://chatgpt.com';
  }

  // ============================================
  // Authentication
  // ============================================

  async getAccessToken() {
    // Return cached token if still valid
    if (this._cachedToken && Date.now() < this._tokenExpiry) {
      this.debug('Using cached access token');
      return this._cachedToken;
    }

    const res = await fetch(`${this.getBaseUrl()}/api/auth/session`, {
      credentials: 'include'
    });

    if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);

    const data = await res.json();
    if (!data?.accessToken) throw new Error('No access token');

    this._cachedToken = data.accessToken;
    this._tokenExpiry = Date.now() + TOKEN_TTL_MS;
    this.debug('Cached new access token');

    return this._cachedToken;
  }

  clearTokenCache() {
    this._cachedToken = null;
    this._tokenExpiry = 0;
  }

  // ============================================
  // API Fetching
  // ============================================

  async fetchConversation(
    conversationId,
    useCache = true,
    isCurrent = false,
    retryOnAuthError = true
  ) {
    // For WEB: prefixed IDs, fetch the parent conversation
    const cleanId = this.getCleanConversationId(conversationId);
    const fetchId = cleanId;

    // Check cache first
    if (useCache) {
      const cached = await storage.getCachedConversation(fetchId, isCurrent);
      if (cached) {
        this.debug('Using cached conversation:', fetchId);
        return cached;
      }
    }

    const token = await this.getAccessToken();
    const res = await fetch(
      `${this.getBaseUrl()}/backend-api/conversation/${fetchId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      }
    );

    // Handle auth errors
    if (res.status === 401 && retryOnAuthError) {
      this.debug('Token expired, clearing cache and retrying');
      this.clearTokenCache();
      return this.fetchConversation(conversationId, useCache, isCurrent, false);
    }

    if (!res.ok) throw new Error(`Conversation fetch failed: ${res.status}`);

    const data = await res.json();
    await storage.setCachedConversation(fetchId, data);

    return data;
  }

  // ============================================
  // Message Extraction with Edit Versions
  // ============================================

  supportsEditVersions() {
    return true;
  }

  /**
   * Extract conversation with normalized messages and edit version info
   * @returns {Promise<ConversationData>}
   */
  async extractConversation() {
    const conversationId = this.getConversationId();
    if (!conversationId) {
      throw new Error('No conversation ID found');
    }

    const isPreBranch = this.isPreBranch();
    const cleanId = this.getCleanConversationId(conversationId);
    const conv = await this.fetchConversation(conversationId, true, true);
    const messages = this._extractTree(conv.mapping, conv.current_node);

    // Add pre-branch indicator if in pre-branch state
    if (isPreBranch) {
      messages.push({
        id: 'pre-branch-indicator',
        type: 'preBranchIndicator',
        text: 'You are viewing a branch preview. Send a message to create a new branch.',
        depth: 0,
        isPersistent: true
      });
    }

    return {
      conversationId: cleanId,
      title: conv.title || 'Conversation',
      messages,
      raw: conv,
      isPreBranch
    };
  }

  /**
   * Normalize ChatGPT mapping into flat message array with edit version info
   * @param {Object} mapping - ChatGPT conversation mapping
   * @param {string} currentNode - Current node ID
   * @returns {Message[]}
   */
  _normalizeMessages(mapping, currentNode) {
    if (!mapping) return [];

    // Build parent->children map and find root
    const childrenMap = {}; // parentId -> [childIds]
    const parentMap = {}; // childId -> parentId
    let rootId = null;

    for (const [_id, entry] of Object.entries(mapping)) {
      const parentId = entry.parent;
      if (!parentId) {
        rootId = _id;
      } else {
        parentMap[_id] = parentId;
        if (!childrenMap[parentId]) {
          childrenMap[parentId] = [];
        }
        childrenMap[parentId].push(_id);
      }
    }

    // Walk the current path from root to currentNode
    const currentPath = this._buildCurrentPath(mapping, rootId, currentNode);

    // Extract messages with version info
    const messages = [];

    for (const nodeId of currentPath) {
      const entry = mapping[nodeId];
      const msg = entry?.message;

      if (!msg) continue;

      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const text = this.extractText(msg);
      if (!text || !text.trim()) continue;

      // Filter internal messages
      if (this._isInternalMessage(text)) continue;

      // Check for siblings (edit versions)
      const parentId = parentMap[nodeId];
      const siblings = parentId ? childrenMap[parentId] || [] : [];
      const hasSiblings = siblings.length > 1;

      // Find this message's index among siblings
      let editVersionIndex = 1;
      let totalVersions = 1;
      let siblingIds = null;

      if (hasSiblings) {
        // Sort siblings by creation time for consistent ordering
        const sortedSiblings = siblings
          .map((id) => ({
            id,
            createTime: mapping[id]?.message?.create_time || 0
          }))
          .sort((a, b) => a.createTime - b.createTime);

        siblingIds = sortedSiblings.map((s) => s.id);
        totalVersions = sortedSiblings.length;
        editVersionIndex = sortedSiblings.findIndex((s) => s.id === nodeId) + 1;
      }

      messages.push({
        id: nodeId,
        role,
        text,
        createTime: this.toSeconds(msg.create_time || 0),
        parentId,
        hasEditVersions: hasSiblings,
        editVersionIndex: hasSiblings ? editVersionIndex : undefined,
        totalVersions: hasSiblings ? totalVersions : undefined,
        siblingIds: hasSiblings ? siblingIds : undefined
      });
    }

    return messages;
  }

  /**
   * Extract conversation tree with edit branch nodes
   * @param {Object} mapping - ChatGPT conversation mapping
   * @param {string} currentNode - Current node ID
   * @returns {Message[]}
   */
  _extractTree(mapping, currentNode) {
    if (!mapping) return [];

    const childrenMap = {};
    const parentMap = {};
    let rootId = null;

    for (const [_id, entry] of Object.entries(mapping)) {
      const parentId = entry.parent;
      if (!parentId) {
        rootId = _id;
      } else {
        parentMap[_id] = parentId;
        if (!childrenMap[parentId]) {
          childrenMap[parentId] = [];
        }
        childrenMap[parentId].push(_id);
      }
    }

    const currentPath = this._buildCurrentPath(mapping, rootId, currentNode);
    const messages = [];

    for (const nodeId of currentPath) {
      const entry = mapping[nodeId];
      const msg = entry?.message;
      if (!msg) continue;

      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const text = this.extractText(msg);
      if (!text || !text.trim()) continue;
      if (this._isInternalMessage(text)) continue;

      const parent = parentMap[nodeId];
      const siblings = parent ? childrenMap[parent] || [] : [];
      const sortedSiblings = siblings
        .map((id) => ({
          id,
          createTime: mapping[id]?.message?.create_time || 0
        }))
        .sort((a, b) => a.createTime - b.createTime);

      const hasSiblings = sortedSiblings.length > 1;
      const editVersionIndex = hasSiblings
        ? sortedSiblings.findIndex((s) => s.id === nodeId) + 1
        : 1;

      messages.push({
        id: nodeId,
        role,
        text,
        createTime: this.toSeconds(msg.create_time || 0),
        parentId: parent,
        hasEditVersions: hasSiblings,
        editVersionIndex: hasSiblings ? editVersionIndex : undefined,
        totalVersions: hasSiblings ? sortedSiblings.length : undefined,
        siblingIds: hasSiblings ? sortedSiblings.map((s) => s.id) : undefined
      });

      if (hasSiblings) {
        for (const sib of sortedSiblings) {
          if (sib.id === nodeId) continue;
          const sibEntry = mapping[sib.id];
          const sibMsg = sibEntry?.message;
          const sibText = sibMsg ? this.extractText(sibMsg) : '';
          const sibRole = sibMsg?.author?.role;
          if (!sibText || !sibText.trim()) continue;

          const sibIndex = sortedSiblings.findIndex((s) => s.id === sib.id) + 1;

          messages.push({
            id: `edit-branch:${sib.id}`,
            type: 'editBranch',
            role: sibRole,
            text: sibText,
            createTime: this.toSeconds(sib.createTime || 0),
            depth: 1,
            branchNodeId: sib.id,
            editVersionIndex: sibIndex,
            totalVersions: sortedSiblings.length,
            siblingIds: sortedSiblings.map((s) => s.id),
            editVersionLabel: `Edit v${sibIndex}/${sortedSiblings.length}`,
            descendantCount: this._countDescendants(
              sib.id,
              childrenMap,
              mapping
            ),
            icon: 'edit' // Icon type for visual distinction
          });
        }
      }
    }

    return messages;
  }

  /**
   * Count descendants of a node
   */
  _countDescendants(nodeId, childrenMap, mapping) {
    let count = 0;
    const stack = [nodeId];
    while (stack.length > 0) {
      const id = stack.pop();
      const children = childrenMap[id] || [];
      for (const childId of children) {
        const msg = mapping[childId]?.message;
        if (
          msg &&
          (msg.author?.role === 'user' || msg.author?.role === 'assistant')
        ) {
          count++;
        }
        stack.push(childId);
      }
    }
    return count;
  }

  /**
   * Build the path from root to current node
   * @param {Object} mapping - Conversation mapping
   * @param {string} rootId - Root node ID
   * @param {string} targetId - Target node ID
   * @returns {string[]} - Array of node IDs from root to target
   */
  _buildCurrentPath(mapping, rootId, targetId) {
    if (!rootId || !targetId) return [];

    // Build child->parent map for traversal
    const parentOf = {};
    for (const [id, entry] of Object.entries(mapping)) {
      if (entry.parent) {
        parentOf[id] = entry.parent;
      }
    }

    // Walk from target back to root
    const path = [];
    let current = targetId;
    while (current) {
      path.unshift(current);
      current = parentOf[current];
    }

    return path;
  }

  /**
   * Get all edit versions for a specific message
   * @param {string} messageId - Message ID
   * @returns {Promise<EditVersion[]>}
   */
  async getEditVersions(messageId) {
    const conversationId = this.getConversationId();
    if (!conversationId) return [];

    const conv = await this.fetchConversation(conversationId, true, true);
    const mapping = conv.mapping;
    if (!mapping || !mapping[messageId]) return [];

    // Find parent and siblings
    const parentId = mapping[messageId]?.parent;
    if (!parentId) return [];

    const siblings = [];
    for (const [id, entry] of Object.entries(mapping)) {
      if (entry.parent === parentId && entry.message) {
        const msg = entry.message;
        const text = this.extractText(msg);
        if (text && !this._isInternalMessage(text)) {
          siblings.push({
            versionId: id,
            text,
            createTime: this.toSeconds(msg.create_time || 0),
            isCurrent: id === messageId,
            role: msg.author?.role
          });
        }
      }
    }

    // Sort by creation time
    siblings.sort((a, b) => a.createTime - b.createTime);

    return siblings;
  }

  /**
   * Check if message is internal ChatGPT message
   * @param {string} text - Message text
   * @returns {boolean}
   */
  _isInternalMessage(text) {
    if (!text) return false;
    return text.startsWith('Original custom instructions');
  }

  // ============================================
  // DOM Interaction
  // ============================================

  findMessageElement(nodeId) {
    if (!nodeId || nodeId.startsWith('branch')) return null;
    return (
      document.querySelector(`[data-message-id="${nodeId}"]`) ||
      document.querySelector(`[data-testid="conversation-turn-${nodeId}"]`) ||
      document.getElementById(nodeId)
    );
  }

  scrollToMessage(messageId) {
    const el = this.findMessageElement(messageId);
    if (!el) return false;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlightElement(el);
    return true;
  }

  // ============================================
  // Branch Detection
  // ============================================

  supportsBranching() {
    return true;
  }

  setupBranchDetection(onBranchCreated) {
    document.addEventListener('click', this._handleBranchClick, true);
    this._onBranchCreated = onBranchCreated;
  }

  _handleBranchClick(e) {
    const target = e.target;
    if (!target) return;

    // Multiple heuristics for resilience
    const text = (target.textContent || '').trim().toLowerCase();
    const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
    const testId = target.dataset?.testid || '';
    const hasParent = target.closest(
      '[data-testid*="branch"], [aria-label*="branch" i]'
    );

    const isBranch =
      text.includes('branch') ||
      ariaLabel.includes('branch') ||
      testId.includes('branch') ||
      hasParent;

    if (isBranch) {
      const convId = this.getConversationId();
      if (convId) {
        const timestampSeconds = Math.floor(Date.now() / 1000);
        this._pendingBranch = {
          parentId: convId,
          timestamp: timestampSeconds
        };
        storage.setPendingBranch(this._pendingBranch);
        this.debug('Pending branch created:', this._pendingBranch);
      }
    }
  }

  /**
   * Check and process pending branch creation
   * @param {string} currentConvId - Current conversation ID
   * @param {string} currentTitle - Current conversation title
   * @param {Object} mapping - Current conversation mapping
   * @param {Object} branchData - Pre-loaded branch data
   * @returns {Promise<Object|null>} - Updated branch data if modified
   */
  async checkPendingBranch(currentConvId, currentTitle, mapping, branchData) {
    const pending = await storage.getPendingBranch();
    if (!pending) return null;

    const nowInSeconds = Math.floor(Date.now() / 1000);

    // Expire after 2 minutes
    if (nowInSeconds - pending.timestamp > 120) {
      await storage.clearPendingBranch();
      return null;
    }

    // Don't process if we're on the parent conversation
    if (pending.parentId === currentConvId) return null;

    // Get parent timestamps for filtering carry-over messages
    let parentTimestamps = null;
    try {
      const parentConv = await this.fetchConversation(pending.parentId);
      parentTimestamps = this._getMessageTimestamps(parentConv.mapping);
    } catch (err) {
      this.debug('Could not fetch parent for timestamp filtering:', err);
    }

    // Extract first unique user message
    const firstMessage = this._extractFirstUserMessage(
      mapping,
      parentTimestamps
    );

    // Record the branch
    const updatedData = await storage.recordBranch(
      pending.parentId,
      currentConvId,
      currentTitle,
      pending.timestamp * 1000,
      firstMessage,
      branchData
    );

    await storage.clearPendingBranch();
    this.debug('Consumed pending branch:', pending);

    return updatedData;
  }

  _getMessageTimestamps(mapping) {
    const timestamps = new Set();
    for (const [_id, entry] of Object.entries(mapping || {})) {
      const msg = entry?.message;
      if (!msg || msg.author?.role !== 'user') continue;
      const createTime = msg.create_time || 0;
      timestamps.add(Math.floor(this.toSeconds(createTime)));
    }
    return timestamps;
  }

  _extractFirstUserMessage(mapping, excludeTimestamps = null) {
    const userMessages = [];
    for (const [_id, entry] of Object.entries(mapping || {})) {
      const msg = entry?.message;
      if (!msg || msg.author?.role !== 'user') continue;

      const text = this.extractText(msg);
      if (!text || !text.trim()) continue;
      if (this._isInternalMessage(text)) continue;

      const createTime = msg.create_time || 0;
      const timestampSeconds = Math.floor(this.toSeconds(createTime));

      if (excludeTimestamps && excludeTimestamps.has(timestampSeconds))
        continue;

      userMessages.push({ text, createTime });
    }

    userMessages.sort((a, b) => a.createTime - b.createTime);
    return userMessages[0]?.text || null;
  }

  // ============================================
  // Lifecycle
  // ============================================

  init() {
    super.init();
    this.setupBranchDetection();

    // Prune expired cache on init
    setTimeout(() => storage.pruneExpiredCache(), 5000);
  }

  cleanup() {
    super.cleanup();
    document.removeEventListener('click', this._handleBranchClick, true);
  }
}

export default ChatGPTAdapter;
