/**
 * Claude Platform Adapter
 * Handles conversation extraction for Claude.ai
 * Uses DOM extraction with API fallback
 */

import { BaseAdapter } from '../base-adapter.js';

/**
 * Claude Platform Adapter
 */
export class ClaudeAdapter extends BaseAdapter {
  constructor() {
    super();
    this._observer = null;
  }

  // ============================================
  // Platform Identification
  // ============================================

  get platformId() {
    return 'claude';
  }

  get platformName() {
    return 'Claude';
  }

  get platformColor() {
    return '#cc785c';
  }

  // ============================================
  // URL Matching
  // ============================================

  matchUrl(url) {
    return /^https:\/\/(www\.)?claude\.ai/i.test(url);
  }

  getConversationId() {
    // Claude URL format: https://claude.ai/chat/{conversation_id}
    const match = location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/i);
    return match?.[1] || null;
  }

  // ============================================
  // Message Extraction (DOM-based)
  // ============================================

  supportsEditVersions() {
    // Claude supports editing messages which creates new response branches
    return true;
  }

  /**
   * Extract conversation from DOM
   * @returns {Promise<ConversationData>}
   */
  async extractConversation() {
    const conversationId = this.getConversationId();
    if (!conversationId) {
      throw new Error('No conversation ID found');
    }

    // Try to get title from page
    const title = this._extractTitle();

    // Extract messages from DOM
    const messages = this._extractMessagesFromDOM();

    return {
      conversationId,
      title: title || 'Claude Conversation',
      messages,
      raw: null
    };
  }

  /**
   * Extract title from the page
   * @returns {string|null}
   */
  _extractTitle() {
    // Try multiple selectors for title
    const selectors = [
      'h1',
      '[data-testid="conversation-title"]',
      '.conversation-title',
      'title'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text !== 'Claude' && !text.includes('Claude.ai')) {
          return text;
        }
      }
    }

    return null;
  }

  /**
   * Extract messages from DOM
   * @returns {Message[]}
   */
  _extractMessagesFromDOM() {
    const messages = [];

    // Claude's message container selectors (may need updates as UI changes)
    const messageSelectors = [
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '.human-message',
      '.assistant-message',
      '[class*="Message_humanMessage"]',
      '[class*="Message_assistantMessage"]',
      // Generic fallback - look for message containers
      '[class*="message"]'
    ];

    // Try to find message containers
    let messageElements = [];
    for (const sel of messageSelectors) {
      messageElements = document.querySelectorAll(sel);
      if (messageElements.length > 0) {
        this.debug(
          `Found ${messageElements.length} messages with selector: ${sel}`
        );
        break;
      }
    }

    // Alternative: find by role pattern in the DOM structure
    if (messageElements.length === 0) {
      messageElements = this._findMessagesByStructure();
    }

    let index = 0;
    for (const el of messageElements) {
      const role = this._determineRole(el);
      if (role !== 'user' && role !== 'assistant') continue;

      const text = this._extractMessageText(el);
      if (!text || !text.trim()) continue;

      const id = el.dataset?.messageId || `claude-msg-${index}`;

      // Check for edit versions (look for version switcher)
      const versionInfo = this._getVersionInfo(el);

      messages.push({
        id,
        role,
        text,
        createTime: Date.now() / 1000 - (messageElements.length - index) * 60, // Estimate
        hasEditVersions: versionInfo.hasVersions,
        editVersionIndex: versionInfo.currentIndex,
        totalVersions: versionInfo.totalVersions
      });

      index++;
    }

    return messages;
  }

  /**
   * Find messages by analyzing DOM structure
   * @returns {NodeListOf<Element>|Element[]}
   */
  _findMessagesByStructure() {
    // Look for alternating human/AI message pattern
    const candidates = document.querySelectorAll(
      '[class*="prose"], [class*="markdown"]'
    );
    const messages = [];

    for (const el of candidates) {
      // Check if this looks like a message
      const parent = el.closest(
        '[class*="Message"], [class*="message"], [role="article"]'
      );
      if (parent && !messages.includes(parent)) {
        messages.push(parent);
      }
    }

    return messages;
  }

  /**
   * Determine message role from element
   * @param {Element} el - Message element
   * @returns {'user'|'assistant'|'unknown'}
   */
  _determineRole(el) {
    const className = el.className || '';
    const testId = el.dataset?.testid || '';

    if (
      className.includes('human') ||
      className.includes('user') ||
      testId.includes('human') ||
      testId.includes('user')
    ) {
      return 'user';
    }

    if (
      className.includes('assistant') ||
      className.includes('claude') ||
      testId.includes('assistant') ||
      testId.includes('claude')
    ) {
      return 'assistant';
    }

    // Check for avatar or role indicators
    const avatar = el.querySelector('[class*="avatar"], [class*="Avatar"]');
    if (avatar) {
      const avatarText = avatar.textContent?.toLowerCase() || '';
      if (avatarText.includes('you') || avatarText.includes('human')) {
        return 'user';
      }
      if (avatarText.includes('claude') || avatarText.includes('ai')) {
        return 'assistant';
      }
    }

    // Check parent elements
    const parent = el.parentElement;
    if (parent) {
      const parentClass = parent.className || '';
      if (parentClass.includes('human') || parentClass.includes('user')) {
        return 'user';
      }
      if (parentClass.includes('assistant') || parentClass.includes('claude')) {
        return 'assistant';
      }
    }

    return 'unknown';
  }

  /**
   * Extract text content from message element
   * @param {Element} el - Message element
   * @returns {string}
   */
  _extractMessageText(el) {
    // Try to find the content container
    const contentSelectors = [
      '[class*="prose"]',
      '[class*="markdown"]',
      '[class*="content"]',
      'p'
    ];

    for (const sel of contentSelectors) {
      const content = el.querySelector(sel);
      if (content) {
        return content.textContent?.trim() || '';
      }
    }

    // Fallback to direct text
    return el.textContent?.trim() || '';
  }

  /**
   * Get version info if message has edit versions
   * @param {Element} el - Message element
   * @returns {{hasVersions: boolean, currentIndex?: number, totalVersions?: number}}
   */
  _getVersionInfo(el) {
    // Look for version switcher UI (e.g., "1/3" or arrows)
    const versionSelectors = [
      '[class*="version"]',
      '[class*="edit"]',
      '[aria-label*="version"]'
    ];

    for (const sel of versionSelectors) {
      const versionEl = el.querySelector(sel);
      if (versionEl) {
        const text = versionEl.textContent || '';
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          return {
            hasVersions: true,
            currentIndex: parseInt(match[1], 10),
            totalVersions: parseInt(match[2], 10)
          };
        }
      }
    }

    return { hasVersions: false };
  }

  /**
   * Get edit versions for a message
   * Claude doesn't expose this via API easily, so return empty for now
   * @param {string} messageId - Message ID
   * @returns {Promise<EditVersion[]>}
   */
  async getEditVersions(_messageId) {
    // Would need to interact with UI or find API endpoints
    // For now, return empty - can be enhanced later
    return [];
  }

  // ============================================
  // DOM Interaction
  // ============================================

  findMessageElement(messageId) {
    // Try data attribute first
    let el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) return el;

    // Try by generated ID pattern
    if (messageId.startsWith('claude-msg-')) {
      const index = parseInt(messageId.replace('claude-msg-', ''), 10);
      const messages = this._extractMessagesFromDOM();
      // This is imperfect but provides basic navigation
      if (index >= 0 && index < messages.length) {
        const allMsgElements = document.querySelectorAll(
          '[class*="message"], [role="article"]'
        );
        return allMsgElements[index] || null;
      }
    }

    return null;
  }

  scrollToMessage(messageId) {
    const el = this.findMessageElement(messageId);
    if (!el) return false;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlightElement(el);
    return true;
  }

  // ============================================
  // Lifecycle
  // ============================================

  init() {
    super.init();
    this.debug('Claude adapter initialized');
  }

  observe(callback) {
    // Throttled observer for Claude
    let lastTrigger = 0;
    const THROTTLE_MS = 500;

    this._observer = new MutationObserver((mutations) => {
      const now = Date.now();
      if (now - lastTrigger < THROTTLE_MS) return;

      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          // Check if new messages were added
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const className = node.className || '';
              if (
                className.includes('message') ||
                className.includes('Message')
              ) {
                lastTrigger = now;
                callback();
                return;
              }
            }
          }
        }
      }
    });

    this._observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return this._observer;
  }

  cleanup() {
    super.cleanup();
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }
}

export default ClaudeAdapter;
