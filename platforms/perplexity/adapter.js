/**
 * Perplexity Platform Adapter
 * Handles conversation extraction for Perplexity.ai
 * Uses DOM extraction as primary method
 */

import { BaseAdapter } from '../base-adapter.js';

/**
 * Perplexity Platform Adapter
 */
export class PerplexityAdapter extends BaseAdapter {
  constructor() {
    super();
    this._observer = null;
  }

  // ============================================
  // Platform Identification
  // ============================================

  get platformId() {
    return 'perplexity';
  }

  get platformName() {
    return 'Perplexity';
  }

  get platformColor() {
    return '#20808d';
  }

  // ============================================
  // URL Matching
  // ============================================

  matchUrl(url) {
    return /^https:\/\/(www\.)?perplexity\.ai/i.test(url);
  }

  getConversationId() {
    // Perplexity URL patterns:
    // https://www.perplexity.ai/search/{conversation_id}
    // https://www.perplexity.ai/search?q=...&uuid={id}
    const pathMatch = location.pathname.match(/\/search\/([a-zA-Z0-9-]+)/i);
    if (pathMatch) return pathMatch[1];

    // Check URL params
    const params = new URLSearchParams(location.search);
    const uuid = params.get('uuid');
    if (uuid) return uuid;

    // Generate ID from URL if no explicit ID
    const query = params.get('q');
    if (query) {
      // Use hash of query as pseudo-ID
      return `pplx-${this._hashString(query).toString(36)}`;
    }

    return null;
  }

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // ============================================
  // Message Extraction (DOM-based)
  // ============================================

  supportsEditVersions() {
    // Perplexity has limited edit support
    return false;
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

    const title = this._extractTitle();
    const messages = this._extractMessagesFromDOM();

    return {
      conversationId,
      title: title || 'Perplexity Search',
      messages,
      raw: null
    };
  }

  /**
   * Extract title from page
   * @returns {string|null}
   */
  _extractTitle() {
    // Perplexity shows the query as title
    const selectors = [
      '.search-query',
      '[class*="query-text"]',
      'h1',
      // The main query input might have the text
      'textarea[placeholder*="Ask"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.value || el.textContent)?.trim();
        if (text && text.length > 0 && text.length < 200) {
          return text;
        }
      }
    }

    // Try to get from page title
    const pageTitle = document.title;
    if (pageTitle && !pageTitle.includes('Perplexity')) {
      return pageTitle;
    }

    return null;
  }

  /**
   * Extract messages from DOM
   * @returns {Message[]}
   */
  _extractMessagesFromDOM() {
    const messages = [];

    // Perplexity message selectors
    const containerSelectors = [
      // Query and answer blocks
      '[class*="query-block"]',
      '[class*="answer-block"]',
      '[class*="QueryBlock"]',
      '[class*="AnswerBlock"]',
      // Follow-up questions
      '[class*="follow-up"]',
      // Generic message containers
      '[class*="prose"]',
      '[class*="message"]'
    ];

    let messageElements = [];

    for (const sel of containerSelectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        messageElements = elements;
        this.debug(`Found ${elements.length} messages with selector: ${sel}`);
        break;
      }
    }

    // Alternative: find by structure
    if (messageElements.length === 0) {
      messageElements = this._findMessagesByStructure();
    }

    let index = 0;
    for (const el of messageElements) {
      const role = this._determineRole(el);
      if (role !== 'user' && role !== 'assistant') continue;

      const text = this._extractMessageText(el);
      if (!text || !text.trim()) continue;

      const id = el.dataset?.messageId || `pplx-msg-${index}`;

      messages.push({
        id,
        role,
        text,
        createTime: Date.now() / 1000 - (messageElements.length - index) * 60,
        hasEditVersions: false
      });

      index++;
    }

    return messages;
  }

  /**
   * Find messages by analyzing DOM structure
   * @returns {Element[]}
   */
  _findMessagesByStructure() {
    const messages = [];

    // Look for text containers that might be messages
    const containers = document.querySelectorAll(
      '[class*="prose"], [class*="markdown"]'
    );

    for (const el of containers) {
      const parent = el.closest(
        '[class*="block"], [class*="message"], [role="article"]'
      );
      if (parent && !messages.includes(parent)) {
        messages.push(parent);
      }
    }

    return messages;
  }

  /**
   * Determine message role from element
   * @param {Element} el
   * @returns {'user'|'assistant'|'unknown'}
   */
  _determineRole(el) {
    const className = el.className || '';

    // Check for query (user) indicators
    if (
      className.includes('query') ||
      className.includes('Query') ||
      className.includes('question') ||
      className.includes('user')
    ) {
      return 'user';
    }

    // Check for answer (assistant) indicators
    if (
      className.includes('answer') ||
      className.includes('Answer') ||
      className.includes('response') ||
      className.includes('prose')
    ) {
      return 'assistant';
    }

    // Check for follow-up indicators
    if (className.includes('follow-up') || className.includes('related')) {
      return 'user';
    }

    // Check data attributes
    if (el.dataset?.role === 'user' || el.dataset?.type === 'query') {
      return 'user';
    }
    if (el.dataset?.role === 'assistant' || el.dataset?.type === 'answer') {
      return 'assistant';
    }

    return 'unknown';
  }

  /**
   * Extract text content from message element
   * @param {Element} el
   * @returns {string}
   */
  _extractMessageText(el) {
    // Try specific content containers
    const contentSelectors = [
      '.prose',
      '[class*="markdown"]',
      '[class*="text-content"]',
      '[class*="answer-text"]',
      '[class*="query-text"]',
      'p'
    ];

    for (const sel of contentSelectors) {
      const content = el.querySelector(sel);
      if (content) {
        // Perplexity answers often have citations - extract main text
        const text = this._extractCleanText(content);
        if (text) return text;
      }
    }

    return this._extractCleanText(el);
  }

  /**
   * Extract clean text, removing citation numbers and source links
   * @param {Element} el
   * @returns {string}
   */
  _extractCleanText(el) {
    if (!el) return '';

    // Clone to avoid modifying original
    const clone = el.cloneNode(true);

    // Remove citation markers like [1], [2]
    const citations = clone.querySelectorAll(
      '[class*="citation"], sup, [class*="source"]'
    );
    citations.forEach((c) => c.remove());

    // Remove source links
    const sourceLinks = clone.querySelectorAll(
      '[class*="sources"], [class*="reference"]'
    );
    sourceLinks.forEach((s) => s.remove());

    return clone.textContent?.trim() || '';
  }

  /**
   * Get edit versions (not supported)
   * @param {string} messageId
   * @returns {Promise<EditVersion[]>}
   */
  async getEditVersions(_messageId) {
    return [];
  }

  // ============================================
  // DOM Interaction
  // ============================================

  findMessageElement(messageId) {
    let el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) return el;

    // Try by generated ID
    if (messageId.startsWith('pplx-msg-')) {
      const index = parseInt(messageId.replace('pplx-msg-', ''), 10);
      const allMsgElements = document.querySelectorAll(
        '[class*="query-block"], [class*="answer-block"], [class*="prose"]'
      );
      return allMsgElements[index] || null;
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
    this.debug('Perplexity adapter initialized');
  }

  observe(callback) {
    let lastTrigger = 0;
    const THROTTLE_MS = 500;

    this._observer = new MutationObserver((mutations) => {
      const now = Date.now();
      if (now - lastTrigger < THROTTLE_MS) return;

      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const className = node.className || '';
              if (
                className.includes('answer') ||
                className.includes('query') ||
                className.includes('prose')
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

export default PerplexityAdapter;
