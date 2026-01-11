/**
 * Gemini Platform Adapter
 * Handles conversation extraction for Gemini (gemini.google.com)
 * Uses DOM extraction with precise selectors to avoid duplicates
 */

import { BaseAdapter } from '../base-adapter.js';

// Minimum message length to filter out UI elements
const MIN_MESSAGE_LENGTH = 15;

// Blacklist patterns for UI text that should not be captured
const UI_TEXT_BLACKLIST = [
  /^show thinking$/i,
  /^hide thinking$/i,
  /^show drafts$/i,
  /^copy$/i,
  /^share$/i,
  /^google search$/i,
  /^tools$/i,
  /^thinking$/i,
  /^pro$/i,
  /^ask gemini/i,
  /^what do you want/i,
  /^gemini can make mistakes/i,
  /^contents$/i,
  /^create$/i,
  /^share and export$/i,
  /^updated$/i
];

/**
 * Gemini Platform Adapter
 */
export class GeminiAdapter extends BaseAdapter {
  constructor() {
    super();
    this._observer = null;
  }

  // ============================================
  // Platform Identification
  // ============================================

  get platformId() {
    return 'gemini';
  }

  get platformName() {
    return 'Gemini';
  }

  get platformColor() {
    return '#4285f4';
  }

  // ============================================
  // URL Matching
  // ============================================

  matchUrl(url) {
    return /^https:\/\/(www\.)?gemini\.google\.com/i.test(url);
  }

  getConversationId() {
    // Gemini URL patterns:
    // https://gemini.google.com/app/{conversation_id}
    // https://gemini.google.com/share/{conversation_id}
    const match = location.pathname.match(/\/(app|share)\/([a-zA-Z0-9_-]+)/i);
    return match?.[2] || null;
  }

  // ============================================
  // Deep Research Detection
  // ============================================

  /**
   * Check if we're in Deep Research mode
   * Deep Research has a document panel on the left and chat on the right
   */
  _isDeepResearchMode() {
    // Deep Research indicators
    const indicators = [
      // Canvas/document container
      'canvas-container',
      'research-panel',
      'document-panel',
      // Or check for the "Contents" sidebar
      '.contents-panel',
      '[aria-label*="Contents"]'
    ];

    for (const sel of indicators) {
      if (
        document.querySelector(sel) ||
        document.querySelector(`[class*="${sel}"]`)
      ) {
        return true;
      }
    }

    // Also check if there's a visible document/canvas area
    const hasDocumentArea = document.querySelector(
      '[class*="canvas"], [class*="document-view"], [class*="research-output"]'
    );

    return Boolean(hasDocumentArea);
  }

  /**
   * Find the chat/conversation container, excluding document areas
   */
  _findChatContainer() {
    // In Deep Research mode, chat is typically on the right side
    // We need to find the conversation area specifically

    const chatSelectors = [
      // Try specific chat containers first
      '[class*="chat-container"]',
      '[class*="conversation-container"]',
      '[class*="chat-history"]',
      '[class*="message-list"]',
      // Main area with role
      'main[role="main"]',
      '[role="main"]'
      // Fallback to body but we'll filter more carefully
    ];

    for (const sel of chatSelectors) {
      const container = document.querySelector(sel);
      if (container) {
        this.debug(`Found chat container with selector: ${sel}`);
        return container;
      }
    }

    // Fallback: use body but be very careful with selectors
    return document.body;
  }

  // ============================================
  // Message Extraction (DOM-based)
  // ============================================

  supportsEditVersions() {
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

    const title = this._extractTitle();
    const messages = this._extractMessagesFromDOM();

    return {
      conversationId,
      title: title || 'Gemini Conversation',
      messages,
      raw: null
    };
  }

  /**
   * Extract title from the page
   * @returns {string|null}
   */
  _extractTitle() {
    // The title is typically shown in the header/top bar
    const titleSelectors = [
      // Gemini shows conversation title in a specific location
      'h1[class*="title"]',
      '[class*="conversation-title"]',
      '[class*="chat-title"]',
      // The dropdown button often contains the title
      'button[class*="title"]'
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        if (
          text &&
          text.length > 0 &&
          text.length < 100 &&
          !this._isBlacklistedText(text)
        ) {
          return text;
        }
      }
    }

    // Try to get from the page title, removing "Google Gemini" suffix
    const pageTitle = document.title
      ?.replace(/\s*[-–]\s*Google Gemini\s*$/i, '')
      .trim();
    if (pageTitle && pageTitle.length > 0 && pageTitle !== 'Gemini') {
      return pageTitle;
    }

    return null;
  }

  /**
   * Check if text matches blacklisted UI patterns
   */
  _isBlacklistedText(text) {
    if (!text) return true;
    const trimmed = text.trim();
    return UI_TEXT_BLACKLIST.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Extract messages from DOM with deduplication
   * @returns {Message[]}
   */
  _extractMessagesFromDOM() {
    const messages = [];
    const seenTexts = new Set(); // For deduplication
    const isDeepResearch = this._isDeepResearchMode();

    this.debug(`Deep Research mode: ${isDeepResearch}`);

    // Find the chat container
    const container = this._findChatContainer();

    // Strategy: Find user queries and model responses as distinct conversation turns
    // Gemini typically structures conversations as query-response pairs

    // First, try to find explicit conversation turns
    let turns = this._findConversationTurns(container, isDeepResearch);

    if (turns.length === 0) {
      this.debug(
        'No conversation turns found with primary strategy, trying fallback'
      );
      turns = this._findMessagesByAlternateStrategy(container);
    }

    this.debug(`Found ${turns.length} potential message elements`);

    let index = 0;
    for (const turnData of turns) {
      const { element, role: detectedRole } = turnData;

      const role = detectedRole || this._determineRole(element);
      if (role !== 'user' && role !== 'assistant') continue;

      const text = this._extractMessageText(element);

      // Skip if too short or blacklisted
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;
      if (this._isBlacklistedText(text)) continue;

      // Deduplication: use first 150 chars as key
      const textKey = text.slice(0, 150).toLowerCase().replace(/\s+/g, ' ');
      if (seenTexts.has(textKey)) {
        this.debug(`Skipping duplicate: "${text.slice(0, 50)}..."`);
        continue;
      }
      seenTexts.add(textKey);

      const id = element.dataset?.messageId || `gemini-msg-${index}`;
      const versionInfo = this._getVersionInfo(element);

      messages.push({
        id,
        role,
        text,
        createTime: Date.now() / 1000 - (turns.length - index) * 60,
        hasEditVersions: versionInfo.hasVersions,
        editVersionIndex: versionInfo.currentIndex,
        totalVersions: versionInfo.totalVersions
      });

      index++;
    }

    this.debug(`Extracted ${messages.length} unique messages`);
    return messages;
  }

  /**
   * Find conversation turns using Gemini's structure
   * Returns array of {element, role} objects
   */
  _findConversationTurns(container, isDeepResearch) {
    const turns = [];

    // Gemini uses custom elements or specific class patterns
    // User messages are typically in query containers
    // Model responses are in response containers

    // Strategy 1: Look for user query containers (usually has user avatar or specific class)
    const userQuerySelectors = [
      // User message containers - be very specific
      '[class*="query-content"]:not([class*="query-content-"] *)',
      '[class*="user-query"]:not([class*="user-query-"] *)',
      '[data-message-author-role="user"]'
    ];

    const modelResponseSelectors = [
      // Model response containers - be very specific
      '[class*="response-container"]:not([class*="response-container-"] *)',
      '[class*="model-response"]:not([class*="model-response-"] *)',
      '[data-message-author-role="model"]'
    ];

    // Find user messages
    for (const sel of userQuerySelectors) {
      try {
        const elements = container.querySelectorAll(sel);
        for (const el of elements) {
          // Skip if inside Deep Research document area
          if (isDeepResearch && this._isInDocumentArea(el)) continue;
          turns.push({ element: el, role: 'user' });
        }
        if (turns.length > 0) break;
      } catch {
        // Invalid selector, continue
      }
    }

    // Find model responses
    for (const sel of modelResponseSelectors) {
      try {
        const elements = container.querySelectorAll(sel);
        for (const el of elements) {
          if (isDeepResearch && this._isInDocumentArea(el)) continue;
          turns.push({ element: el, role: 'assistant' });
        }
        if (turns.some((t) => t.role === 'assistant')) break;
      } catch {
        // Invalid selector, continue
      }
    }

    // Sort by DOM position to maintain conversation order
    turns.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return turns;
  }

  /**
   * Alternate strategy: look for message-like structures
   */
  _findMessagesByAlternateStrategy(container) {
    const turns = [];
    const seen = new Set();

    // Look for elements that contain substantial text and appear to be messages
    // This is more heuristic-based

    // Find all elements with markdown-rendered content (typical for AI responses)
    const markdownElements = container.querySelectorAll(
      '[class*="markdown"]:not([class*="markdown-"] *), ' +
        '[class*="prose"]:not([class*="prose-"] *)'
    );

    for (const el of markdownElements) {
      // Get the message container (parent that represents the full message)
      const messageContainer = this._findMessageContainer(el);
      if (!messageContainer || seen.has(messageContainer)) continue;
      seen.add(messageContainer);

      // Skip if in document area
      if (this._isInDocumentArea(messageContainer)) continue;

      const role = this._determineRole(messageContainer);
      if (role === 'user' || role === 'assistant') {
        turns.push({ element: messageContainer, role });
      }
    }

    // Also look for user input bubbles (often styled differently)
    const userBubbles = container.querySelectorAll(
      '[class*="user-bubble"], [class*="query-bubble"], [class*="input-text"]'
    );

    for (const el of userBubbles) {
      const messageContainer = this._findMessageContainer(el);
      if (!messageContainer || seen.has(messageContainer)) continue;
      seen.add(messageContainer);

      if (this._isInDocumentArea(messageContainer)) continue;

      turns.push({ element: messageContainer, role: 'user' });
    }

    // Sort by DOM position
    turns.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return turns;
  }

  /**
   * Find the message container element for a given child element
   */
  _findMessageContainer(el) {
    // Walk up the DOM to find the message container
    const containerPatterns = [
      '[class*="message-container"]',
      '[class*="turn-container"]',
      '[class*="query-container"]',
      '[class*="response-container"]',
      '[role="listitem"]',
      '[role="article"]'
    ];

    let current = el;
    while (current && current !== document.body) {
      for (const pattern of containerPatterns) {
        if (current.matches?.(pattern)) {
          return current;
        }
      }
      // Also check if current element has a class suggesting it's a container
      const className = current.className || '';
      if (
        className.includes('message') ||
        className.includes('turn') ||
        className.includes('query') ||
        className.includes('response')
      ) {
        // Make sure it's a container, not a child element
        if (current.children?.length > 1) {
          return current;
        }
      }
      current = current.parentElement;
    }

    // If no container found, return the original element
    return el;
  }

  /**
   * Check if element is inside the Deep Research document area
   */
  _isInDocumentArea(el) {
    // Document area indicators
    const docSelectors = [
      '[class*="canvas"]',
      '[class*="document"]',
      '[class*="research-output"]',
      '[class*="report-content"]'
    ];

    for (const sel of docSelectors) {
      if (el.closest(sel)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine message role from element
   * @param {Element} el
   * @returns {'user'|'assistant'|'unknown'}
   */
  _determineRole(el) {
    if (!el) return 'unknown';

    // Check data attribute
    const roleAttr = el.dataset?.messageAuthorRole;
    if (roleAttr === 'user' || roleAttr === 'human') return 'user';
    if (roleAttr === 'model' || roleAttr === 'assistant') return 'assistant';

    // Check class names
    const className = (el.className || '').toLowerCase();

    // User indicators
    if (
      className.includes('query') ||
      className.includes('user') ||
      className.includes('human') ||
      className.includes('input')
    ) {
      return 'user';
    }

    // Assistant indicators
    if (
      className.includes('response') ||
      className.includes('model') ||
      className.includes('assistant') ||
      className.includes('output')
    ) {
      return 'assistant';
    }

    // Check for avatar/icon indicators
    const geminiIndicator = el.querySelector(
      '[class*="gemini"], [class*="model-icon"], [class*="sparkle"]'
    );
    if (geminiIndicator) return 'assistant';

    const userIndicator = el.querySelector(
      '[class*="user-avatar"], [class*="account"], [class*="profile"]'
    );
    if (userIndicator) return 'user';

    // Check for markdown/prose content (typically model responses)
    const hasMarkdown = el.querySelector(
      '[class*="markdown"], [class*="prose"]'
    );
    if (hasMarkdown && el.textContent && el.textContent.length > 100) {
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
    if (!el) return '';

    // For user messages, look for the query text specifically
    const queryTextSelectors = [
      '[class*="query-text"]',
      '[class*="user-text"]',
      '[class*="input-text"]'
    ];

    for (const sel of queryTextSelectors) {
      const textEl = el.querySelector(sel);
      if (textEl) {
        const text = textEl.textContent?.trim();
        if (text && text.length >= MIN_MESSAGE_LENGTH) {
          return text;
        }
      }
    }

    // For model responses, look for markdown/prose content
    const contentSelectors = [
      '[class*="markdown-content"]',
      '[class*="response-text"]',
      '[class*="message-content"]',
      '[class*="prose"]',
      '[class*="markdown"]'
    ];

    for (const sel of contentSelectors) {
      const content = el.querySelector(sel);
      if (content) {
        // Clean up the text - remove nested UI elements
        const clone = content.cloneNode(true);

        // Remove buttons, icons, and other UI elements
        const uiElements = clone.querySelectorAll(
          'button, [role="button"], [class*="icon"], [class*="action"], ' +
            '[class*="toolbar"], [class*="menu"], svg'
        );
        uiElements.forEach((ui) => ui.remove());

        const text = clone.textContent?.trim();
        if (text && text.length >= MIN_MESSAGE_LENGTH) {
          return text;
        }
      }
    }

    // Fallback: direct text content, but be careful
    const directText = el.textContent?.trim();
    if (
      directText &&
      directText.length >= MIN_MESSAGE_LENGTH &&
      !this._isBlacklistedText(directText)
    ) {
      return directText;
    }

    return '';
  }

  /**
   * Get version info for a message
   * @param {Element} el
   * @returns {{hasVersions: boolean, currentIndex?: number, totalVersions?: number}}
   */
  _getVersionInfo(el) {
    if (!el) return { hasVersions: false };

    // Look for draft/version indicators
    const versionIndicators = el.querySelectorAll(
      '[class*="draft"], [class*="version"], [aria-label*="draft"]'
    );

    for (const indicator of versionIndicators) {
      const text = indicator.textContent || '';
      const match = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
      if (match) {
        return {
          hasVersions: true,
          currentIndex: parseInt(match[1], 10),
          totalVersions: parseInt(match[2], 10)
        };
      }
    }

    // Check for "Show drafts" button
    const draftButton = el.querySelector(
      '[class*="show-drafts"], [aria-label*="drafts"], [class*="draft-selector"]'
    );
    if (draftButton) {
      return { hasVersions: true, currentIndex: 1, totalVersions: 2 };
    }

    return { hasVersions: false };
  }

  /**
   * Get edit versions for a message
   * @param {string} messageId
   * @returns {Promise<EditVersion[]>}
   */
  async getEditVersions(_messageId) {
    // Gemini doesn't expose this easily via DOM
    return [];
  }

  // ============================================
  // DOM Interaction
  // ============================================

  findMessageElement(messageId) {
    if (!messageId) return null;

    let el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) return el;

    // Try by generated ID
    if (messageId.startsWith('gemini-msg-')) {
      const index = parseInt(messageId.replace('gemini-msg-', ''), 10);
      const messages = this._extractMessagesFromDOM();
      // This is inefficient but provides fallback
      if (index >= 0 && index < messages.length) {
        // Re-extract to get the element
        const container = this._findChatContainer();
        const turns = this._findConversationTurns(
          container,
          this._isDeepResearchMode()
        );
        if (turns[index]) {
          return turns[index].element;
        }
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
    this.debug('Gemini adapter initialized');
  }

  observe(callback) {
    let lastTrigger = 0;
    const THROTTLE_MS = 1000; // Increased throttle for stability

    this._observer = new MutationObserver((mutations) => {
      const now = Date.now();
      if (now - lastTrigger < THROTTLE_MS) return;

      // Only trigger on significant changes
      let shouldTrigger = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const className = (node.className || '').toLowerCase();
              // Be more selective about what triggers a refresh
              if (
                className.includes('message') ||
                className.includes('response') ||
                className.includes('query') ||
                className.includes('turn')
              ) {
                shouldTrigger = true;
                break;
              }
            }
          }
        }
        if (shouldTrigger) break;
      }

      if (shouldTrigger) {
        lastTrigger = now;
        callback();
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

export default GeminiAdapter;
