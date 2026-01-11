/**
 * Base Platform Adapter - Abstract base class for all platform adapters
 * Defines the interface that each platform must implement
 */

/**
 * @typedef {Object} Message
 * @property {string} id - Message ID
 * @property {'user'|'assistant'|'system'} role - Message role
 * @property {string} text - Message content
 * @property {number} createTime - Unix timestamp (seconds)
 * @property {boolean} [hasEditVersions] - Has alternate versions
 * @property {number} [editVersionIndex] - Current version index (1-based)
 * @property {number} [totalVersions] - Total version count
 * @property {string} [parentId] - Parent message ID
 * @property {string[]} [siblingIds] - IDs of sibling versions
 */

/**
 * @typedef {Object} EditVersion
 * @property {string} versionId - Version message ID
 * @property {string} text - Version content
 * @property {number} createTime - When version was created
 * @property {boolean} isCurrent - Is currently displayed version
 */

/**
 * @typedef {Object} ConversationData
 * @property {string} conversationId - Conversation ID
 * @property {string} title - Conversation title
 * @property {Message[]} messages - Normalized messages
 * @property {Object} [raw] - Raw API response for platform-specific processing
 */

/**
 * Abstract base class for platform adapters
 * Each platform adapter should extend this class
 */
export class BaseAdapter {
  constructor() {
    if (new.target === BaseAdapter) {
      throw new Error(
        'BaseAdapter is abstract and cannot be instantiated directly'
      );
    }

    // Debug logging flag
    this._debugEnabled = false;
  }

  // ============================================
  // Platform Identification (must override)
  // ============================================

  /**
   * Platform identifier
   * @returns {string}
   */
  get platformId() {
    throw new Error('platformId must be implemented');
  }

  /**
   * Display name for the platform
   * @returns {string}
   */
  get platformName() {
    throw new Error('platformName must be implemented');
  }

  /**
   * Platform brand color (hex)
   * @returns {string}
   */
  get platformColor() {
    return '#6366f1'; // Default indigo
  }

  // ============================================
  // URL Matching (must override)
  // ============================================

  /**
   * Check if URL matches this platform
   * @param {string} url - URL to check
   * @returns {boolean}
   */
  matchUrl(_url) {
    throw new Error('matchUrl must be implemented');
  }

  /**
   * Extract conversation ID from current page
   * @returns {string|null}
   */
  getConversationId() {
    throw new Error('getConversationId must be implemented');
  }

  // ============================================
  // Message Extraction (must override)
  // ============================================

  /**
   * Extract normalized messages from the current conversation
   * @returns {Promise<ConversationData>}
   */
  async extractConversation() {
    throw new Error('extractConversation must be implemented');
  }

  /**
   * Get alternate versions (edits/regenerations) for a message
   * @param {string} messageId - Message ID
   * @returns {Promise<EditVersion[]>}
   */
  async getEditVersions(_messageId) {
    // Default: no edit versions
    return [];
  }

  /**
   * Check if the platform supports edit versions
   * @returns {boolean}
   */
  supportsEditVersions() {
    return false;
  }

  // ============================================
  // DOM Interaction (must override)
  // ============================================

  /**
   * Scroll to and highlight a message in the page
   * @param {string} messageId - Message ID to focus
   * @returns {boolean} - Success status
   */
  scrollToMessage(_messageId) {
    throw new Error('scrollToMessage must be implemented');
  }

  /**
   * Find the DOM element for a message
   * @param {string} messageId - Message ID
   * @returns {HTMLElement|null}
   */
  findMessageElement(messageId) {
    // Default implementation - can be overridden
    return document.querySelector(`[data-message-id="${messageId}"]`);
  }

  /**
   * Highlight a message element temporarily
   * @param {HTMLElement} element - Element to highlight
   * @param {number} [duration=1500] - Highlight duration in ms
   */
  highlightElement(element, duration = 1500) {
    if (!element) return;

    const HIGHLIGHT_CLASS = 'branch-tree-highlight';
    element.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), duration);
  }

  // ============================================
  // Lifecycle (optional override)
  // ============================================

  /**
   * Initialize the adapter
   * Called when the adapter is first activated
   */
  init() {
    this.injectStyles();
    this.debug(`${this.platformName} adapter initialized`);
  }

  /**
   * Start observing DOM changes for auto-refresh
   * @param {Function} callback - Called when refresh is needed
   * @returns {MutationObserver|null}
   */
  observe(callback) {
    // Default implementation - watch for significant DOM changes
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length || m.removedNodes.length) {
          callback();
          return;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    return observer;
  }

  /**
   * Cleanup when adapter is deactivated
   */
  cleanup() {
    this.debug(`${this.platformName} adapter cleanup`);
  }

  // ============================================
  // Branch Detection (optional override)
  // ============================================

  /**
   * Check if this platform supports branch tracking
   * (e.g., ChatGPT's "Branch in new chat")
   * @returns {boolean}
   */
  supportsBranching() {
    return false;
  }

  /**
   * Setup branch detection listeners
   * @param {Function} onBranchCreated - Callback when branch is detected
   */
  setupBranchDetection(_onBranchCreated) {
    // Default: no-op
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get the base URL for API calls
   * @returns {string}
   */
  getBaseUrl() {
    return window.location.origin;
  }

  /**
   * Inject highlight styles into the page
   */
  injectStyles() {
    const STYLE_ID = 'branch-tree-adapter-styles';
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .branch-tree-highlight {
        outline: 3px solid #6b8af7 !important;
        outline-offset: 2px;
        border-radius: 8px;
        transition: outline 0.2s ease;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Extract text content from various message formats
   * @param {Object} message - Raw message object
   * @returns {string}
   */
  extractText(message) {
    if (!message) return '';

    // ChatGPT format
    if (Array.isArray(message.content?.parts)) {
      return message.content.parts.join('\n').trim();
    }

    // Generic text content
    if (typeof message.content === 'string') {
      return message.content.trim();
    }

    if (message.content?.text) {
      return message.content.text.trim();
    }

    if (message.text) {
      return message.text.trim();
    }

    return '';
  }

  /**
   * Normalize timestamp to seconds
   * @param {number} ts - Timestamp (may be ms or seconds)
   * @returns {number}
   */
  toSeconds(ts) {
    if (!ts || ts <= 0) return 0;
    return ts > 1e12 ? ts / 1000 : ts;
  }

  /**
   * Debug logging
   * @param {...any} args - Log arguments
   */
  debug(...args) {
    if (this._debugEnabled) {
      console.log(`[${this.platformName}Adapter]`, ...args);
    }
  }

  /**
   * Enable/disable debug mode
   * @param {boolean} enabled
   */
  setDebugEnabled(enabled) {
    this._debugEnabled = enabled;
  }
}

export default BaseAdapter;
