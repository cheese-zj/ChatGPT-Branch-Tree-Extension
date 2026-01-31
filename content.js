/**
 * AI Conversation Index - Content Script Router
 * Detects the current platform and loads the appropriate adapter
 * Provides unified message handling for the side panel
 */
(() => {
  'use strict';

  // ============================================
  // Platform Detection
  // ============================================

  const PLATFORM_PATTERNS = {
    chatgpt: [/^https:\/\/(www\.)?(chatgpt\.com|chat\.openai\.com)/i],
    claude: [/^https:\/\/(www\.)?claude\.ai/i],
    gemini: [/^https:\/\/(www\.)?gemini\.google\.com/i],
    perplexity: [/^https:\/\/(www\.)?perplexity\.ai/i]
  };

  function detectPlatform() {
    const url = window.location.href;
    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
      if (patterns.some((p) => p.test(url))) {
        return platform;
      }
    }
    return null;
  }

  // ============================================
  // Storage Helpers (inline to avoid module issues)
  // ============================================

  const STORAGE_KEY = 'chatgpt_branch_data';
  const CONV_CACHE_PREFIX = 'conv_cache_';
  const CURRENT_CONV_TTL_MS = 2 * 60 * 1000;
  const HISTORY_CONV_TTL_MS = 15 * 60 * 1000;
  const TOKEN_TTL_MS = 5 * 60 * 1000;

  const memoryCache = new Map();
  const MAX_CACHE_SIZE = 50;
  let cachedToken = null;
  let tokenExpiry = 0;

  // ============================================
  // Raw Conversation Cache for Markdown Export
  // ============================================
  // Stores original message content (with Markdown) from API responses
  // Structure: { conversationId, title, messages: [{id, role, content, createTime}], lastUpdate }
  const rawConversationCache = {
    chatgpt: null,
    claude: null,
    gemini: null,
    perplexity: null
  };

  /**
   * Update raw conversation cache for a platform
   * @param {string} platform - Platform identifier
   * @param {Object} data - Conversation data with messages
   */
  function updateRawCache(platform, data) {
    if (!platform || !data) return;
    rawConversationCache[platform] = {
      ...data,
      lastUpdate: Date.now()
    };
  }

  /**
   * Get raw conversation cache for a platform
   * @param {string} platform - Platform identifier
   * @returns {Object|null} - Cached conversation data or null
   */
  function getRawCache(platform, conversationId = null) {
    const cached = rawConversationCache[platform];
    if (!cached) return null;
    if (conversationId && cached.conversationId !== conversationId) {
      return null;
    }
    // Cache is valid for 10 minutes for export purposes
    const EXPORT_CACHE_TTL_MS = 10 * 60 * 1000;
    if (Date.now() - cached.lastUpdate > EXPORT_CACHE_TTL_MS) {
      rawConversationCache[platform] = null;
      return null;
    }
    return cached;
  }

  // ============================================
  // Markdown Export Generation
  // ============================================

  /**
   * Platform display names
   */
  const PLATFORM_NAMES = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    perplexity: 'Perplexity'
  };

  /**
   * Generate Markdown content from conversation messages
   * @param {Object} options - Export options
   * @param {string} options.title - Conversation title
   * @param {string} options.platform - Platform identifier
   * @param {string} options.conversationId - Conversation ID
   * @param {Array} options.messages - Array of {id, role, content, createTime}
   * @returns {string} - Markdown formatted string
   */
  function generateMarkdown({ title, platform, conversationId, messages }) {
    const platformName = PLATFORM_NAMES[platform] || platform;
    const exportDate = new Date().toISOString();
    const sanitizedTitle = title || 'Conversation';

    let md = `# ${sanitizedTitle}\n\n`;
    md += `> **Platform:** ${platformName}  \n`;
    md += `> **Exported:** ${exportDate}  \n`;
    if (conversationId) {
      md += `> **Conversation ID:** ${conversationId}  \n`;
    }
    md += '\n---\n\n';

    if (!messages || messages.length === 0) {
      md += '*No messages found in this conversation.*\n';
      return md;
    }

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.content || msg.text || '';

      md += `## ${role}\n\n`;
      md += `${content}\n\n`;
      md += `---\n\n`;
    }

    return md;
  }

  /**
   * Generate a safe filename from title
   * @param {string} title - Conversation title
   * @param {string} platform - Platform name
   * @returns {string} - Safe filename
   */
  function generateFilename(title, platform) {
    // Remove or replace unsafe characters
    const safeTitle = (title || 'conversation')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '_')
      .slice(0, 50);

    const timestamp = new Date().toISOString().slice(0, 10);
    return `${safeTitle}_${platform}_${timestamp}.md`;
  }

  /**
   * Trigger file download in browser
   * @param {string} content - File content
   * @param {string} filename - File name
   */
  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  async function loadBranchData() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data?.[STORAGE_KEY] || { branches: {}, titles: {} };
  }

  async function saveBranchData(data) {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  async function getCachedConversation(conversationId, isCurrent = false) {
    const memCached = memoryCache.get(conversationId);
    if (memCached) {
      const ttl = isCurrent ? CURRENT_CONV_TTL_MS : HISTORY_CONV_TTL_MS;
      if (Date.now() - memCached.timestamp < ttl) {
        return memCached.data;
      }
      memoryCache.delete(conversationId);
    }

    const key = `${CONV_CACHE_PREFIX}${conversationId}`;
    try {
      const stored = await chrome.storage.local.get(key);
      const cached = stored?.[key];
      if (!cached) return null;

      const ttl = isCurrent ? CURRENT_CONV_TTL_MS : HISTORY_CONV_TTL_MS;
      if (Date.now() - cached.timestamp > ttl) {
        chrome.storage.local.remove(key).catch(() => {});
        return null;
      }

      memoryCache.set(conversationId, cached);
      return cached.data;
    } catch {
      return null;
    }
  }

  async function setCachedConversation(conversationId, data) {
    const cacheEntry = { data, timestamp: Date.now() };
    memoryCache.set(conversationId, cacheEntry);

    // LRU eviction: remove oldest entries if over limit
    if (memoryCache.size > MAX_CACHE_SIZE) {
      const oldest = memoryCache.keys().next().value;
      memoryCache.delete(oldest);
    }

    const key = `${CONV_CACHE_PREFIX}${conversationId}`;
    try {
      await chrome.storage.local.set({ [key]: cacheEntry });
    } catch {
      // Ignore storage errors silently
    }
  }

  async function clearConversationCache() {
    memoryCache.clear();
    try {
      const allData = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(allData).filter((k) =>
        k.startsWith(CONV_CACHE_PREFIX)
      );
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch {
      // Ignore storage errors silently
    }
  }

  // ============================================
  // ChatGPT-Specific Functions
  // ============================================

  function getBaseUrl() {
    return location.hostname.includes('openai')
      ? 'https://chat.openai.com'
      : 'https://chatgpt.com';
  }

  async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) {
      return cachedToken;
    }

    const res = await fetch(`${getBaseUrl()}/api/auth/session`, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
    const data = await res.json();
    if (!data?.accessToken) throw new Error('No access token');

    cachedToken = data.accessToken;
    tokenExpiry = Date.now() + TOKEN_TTL_MS;
    return cachedToken;
  }

  function clearTokenCache() {
    cachedToken = null;
    tokenExpiry = 0;
  }

  async function fetchChatGPTConversation(
    conversationId,
    useCache = true,
    isCurrent = false,
    retryOnAuthError = true
  ) {
    const cleanId = cleanChatGPTConversationId(conversationId);
    if (!cleanId) throw new Error('No conversation ID found');

    if (useCache) {
      const cached = await getCachedConversation(cleanId, isCurrent);
      if (cached) return cached;
    }

    const token = await getAccessToken();
    const res = await fetch(
      `${getBaseUrl()}/backend-api/conversation/${cleanId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      }
    );

    if (res.status === 401 && retryOnAuthError) {
      clearTokenCache();
      return fetchChatGPTConversation(
        conversationId,
        useCache,
        isCurrent,
        false
      );
    }

    if (!res.ok) throw new Error(`Conversation fetch failed: ${res.status}`);
    const data = await res.json();
    await setCachedConversation(cleanId, data);
    return data;
  }

  // ============================================
  // Message Extraction
  // ============================================

  function toSeconds(ts) {
    if (!ts || ts <= 0) return 0;
    return ts > 1e12 ? ts / 1000 : ts;
  }

  function normalizeContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content.trim();

    if (Array.isArray(content)) {
      const parts = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.content === 'string') return part.content;
          if (Array.isArray(part?.parts)) {
            return part.parts
              .map((subPart) => {
                if (typeof subPart === 'string') return subPart;
                if (typeof subPart?.text === 'string') return subPart.text;
                if (typeof subPart?.content === 'string')
                  return subPart.content;
                return '';
              })
              .filter(Boolean)
              .join('\n');
          }
          return '';
        })
        .filter(Boolean);
      return parts.join('\n').trim();
    }

    if (Array.isArray(content.parts)) {
      const parts = content.parts
        .map((part) => {
          if (typeof part === 'string') return part;
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.content === 'string') return part.content;
          return '';
        })
        .filter(Boolean);
      return parts.join('\n').trim();
    }

    if (typeof content.text === 'string') return content.text.trim();
    if (typeof content.content === 'string') return content.content.trim();
    return '';
  }

  function extractText(message) {
    if (!message) return '';
    const contentText = normalizeContent(message.content);
    if (contentText) return contentText;
    const text = normalizeContent(message.text);
    if (text) return text;
    return '';
  }

  function isInternalMessage(text) {
    if (!text) return false;
    return text.startsWith('Original custom instructions');
  }

  /**
   * Build path from root to current node in ChatGPT mapping
   */
  function buildCurrentPath(mapping, rootId, targetId) {
    if (!rootId || !targetId) return [];

    const parentOf = {};
    for (const [id, entry] of Object.entries(mapping)) {
      if (entry.parent) {
        parentOf[id] = entry.parent;
      }
    }

    const path = [];
    let current = targetId;
    while (current) {
      path.unshift(current);
      current = parentOf[current];
    }
    return path;
  }

  /**
   * Count descendants of a node in the mapping tree
   */
  function countDescendants(nodeId, childrenMap, mapping) {
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
   * Find the leaf node of a branch subtree (for switching)
   */
  function findBranchLeaf(nodeId, childrenMap) {
    let current = nodeId;
    while (true) {
      const children = childrenMap[current] || [];
      if (children.length === 0) return current;
      // Follow the last child (most recent path)
      current = children[children.length - 1];
    }
  }

  /**
   * Extract ChatGPT conversation as a tree with edit branches.
   * Walks the current path and emits editBranch nodes for siblings.
   */
  function extractChatGPTTree(mapping, currentNode) {
    if (!mapping) return [];

    // Build parent->children map
    const childrenMap = {};
    const parentMap = {};
    let rootId = null;

    for (const [id, entry] of Object.entries(mapping)) {
      const parentId = entry.parent;
      if (!parentId) {
        rootId = id;
      } else {
        parentMap[id] = parentId;
        if (!childrenMap[parentId]) {
          childrenMap[parentId] = [];
        }
        childrenMap[parentId].push(id);
      }
    }

    const currentPath = buildCurrentPath(mapping, rootId, currentNode);
    const messages = [];

    for (const nodeId of currentPath) {
      const entry = mapping[nodeId];
      const msg = entry?.message;
      if (!msg) continue;

      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const text = extractText(msg);
      if (!text || !text.trim()) continue;
      if (isInternalMessage(text)) continue;

      // Check for siblings (edit versions)
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

      // Emit the current-path message
      messages.push({
        id: nodeId,
        type: 'message',
        role,
        text,
        createTime: toSeconds(msg.create_time || 0),
        parentId: parent,
        hasEditVersions: hasSiblings,
        editVersionIndex: hasSiblings ? editVersionIndex : undefined,
        totalVersions: hasSiblings ? sortedSiblings.length : undefined,
        siblingIds: hasSiblings ? sortedSiblings.map((s) => s.id) : undefined
      });

      // Emit edit branch nodes for non-current siblings
      if (hasSiblings) {
        for (const sib of sortedSiblings) {
          if (sib.id === nodeId) continue;
          const sibEntry = mapping[sib.id];
          const sibMsg = sibEntry?.message;
          const sibText = sibMsg ? extractText(sibMsg) : '';
          const sibRole = sibMsg?.author?.role;
          if (!sibText || !sibText.trim()) continue;

          const sibIndex = sortedSiblings.findIndex((s) => s.id === sib.id) + 1;

          messages.push({
            id: `edit-branch:${sib.id}`,
            type: 'editBranch',
            role: sibRole,
            text: sibText,
            createTime: toSeconds(sib.createTime || 0),
            depth: 1,
            branchNodeId: sib.id,
            editVersionLabel: `Edit v${sibIndex}/${sortedSiblings.length}`,
            descendantCount: countDescendants(sib.id, childrenMap, mapping),
            icon: 'edit' // Icon type for visual distinction
          });
        }
      }
    }

    return messages;
  }

  /**
   * Extract messages from DOM (for non-ChatGPT platforms)
   */
  // Minimum message length to filter out UI elements
  const MIN_MESSAGE_LENGTH = 15;

  // Blacklist patterns for UI text that should not be captured (Gemini specific)
  const GEMINI_UI_BLACKLIST = [
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

  // ============================================
  // Claude-Specific Selectors and State
  // ============================================

  const CLAUDE_SELECTORS = {
    // User message - must be non-streaming state
    userMessage:
      '[data-is-streaming="false"] .font-user-message, [data-test-render-count] .font-user-message, .font-user-message',
    // Claude response
    assistantMessage: '.font-claude-message',
    // Streaming state detection
    streamingIndicator: '[data-is-streaming="true"]',
    // Conversation container
    conversationContainer:
      'main[class*="conversation"], [class*="overflow-y-auto"]',
    // Any message content
    messageContent: '.font-claude-message, .font-user-message'
  };

  // Cache for Claude API data (from fetch interception)
  let claudeApiCache = {
    conversationId: null,
    messages: [],
    lastUpdate: 0
  };

  let claudeOrgId = null;
  const CLAUDE_ORG_ID_REGEX = /^[a-f0-9-]{36}$/i;

  function extractClaudeConversationIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/chat_conversations\/([a-zA-Z0-9-]+)/i);
    return match?.[1] || null;
  }

  function extractClaudeOrgIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/organizations\/([a-zA-Z0-9-]+)/i);
    const orgId = match?.[1] || null;
    if (!orgId) return null;
    return CLAUDE_ORG_ID_REGEX.test(orgId) ? orgId : null;
  }

  function extractClaudeOrgIdFromStorage(storage) {
    if (!storage) return null;
    const keys = Object.keys(storage);
    for (const key of keys) {
      if (!key.toLowerCase().includes('org')) continue;
      const value = storage.getItem(key);
      if (!value) continue;
      if (CLAUDE_ORG_ID_REGEX.test(value)) return value;
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string' && CLAUDE_ORG_ID_REGEX.test(parsed)) {
          return parsed;
        }
        if (parsed && typeof parsed === 'object') {
          for (const candidate of Object.values(parsed)) {
            if (
              typeof candidate === 'string' &&
              CLAUDE_ORG_ID_REGEX.test(candidate)
            ) {
              return candidate;
            }
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    return null;
  }

  function extractClaudeOrgIdFromWindow() {
    const pageProps = window.__NEXT_DATA__?.props?.pageProps;
    const candidates = [
      pageProps?.organization?.uuid,
      pageProps?.organization_uuid,
      pageProps?.currentOrganization?.uuid,
      pageProps?.user?.organization?.uuid,
      pageProps?.user?.organization_uuid
    ];

    for (const candidate of candidates) {
      if (
        typeof candidate === 'string' &&
        CLAUDE_ORG_ID_REGEX.test(candidate)
      ) {
        return candidate;
      }
    }

    return (
      extractClaudeOrgIdFromStorage(localStorage) ||
      extractClaudeOrgIdFromStorage(sessionStorage)
    );
  }

  function extractClaudeOrgIdFromPerformance() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const entry of entries) {
        const orgId = extractClaudeOrgIdFromUrl(entry.name);
        if (orgId) return orgId;
      }
    } catch {
      // Ignore performance access errors
    }
    return null;
  }

  function getClaudeOrgId() {
    if (claudeOrgId) return claudeOrgId;
    const orgId =
      extractClaudeOrgIdFromWindow() || extractClaudeOrgIdFromPerformance();
    if (orgId) {
      claudeOrgId = orgId;
    }
    return claudeOrgId;
  }

  /**
   * Inject fetch interceptor to capture Claude API responses
   * This runs in the page context to intercept window.fetch
   */
  function injectClaudeFetchInterceptor() {
    // Check if already injected
    if (document.getElementById('claude-fetch-interceptor')) return;

    const script = document.createElement('script');
    script.id = 'claude-fetch-interceptor';
    script.textContent = `
      (function() {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          
          // Intercept Claude conversation API responses
          if (url.includes('/api/') && (url.includes('chat_conversations') || url.includes('completion'))) {
            try {
              const cloned = response.clone();
              const contentType = cloned.headers.get('content-type') || '';
              
              // Only process JSON responses (not streaming)
              if (contentType.includes('application/json')) {
                const data = await cloned.json();
                window.postMessage({
                  type: 'CLAUDE_API_RESPONSE',
                  url: url,
                  data: data
                }, '*');
              }
            } catch(e) {
              // Silently ignore parse errors
            }
          }
          return response;
        };
        console.log('[ConversationIndex] Claude fetch interceptor installed');
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }

  function extractClaudeMessagesFromApi(data) {
    if (!data) {
      return { messages: [], conversationId: null, title: null };
    }

    let extractedMessages = [];
    const conversationId = data.uuid || null;
    const title = data.name || null;

    const sourceMessages = Array.isArray(data.chat_messages)
      ? data.chat_messages
      : Array.isArray(data.messages)
        ? data.messages
        : [];

    if (sourceMessages.length > 0) {
      // Group messages by parent_message_uuid to detect edits
      const parentGroups = new Map();

      const mapped = sourceMessages
        .map((msg, idx) => {
          const contentText = normalizeContent(msg.text ?? msg.content);
          const parentMsgId = msg.parent_message_uuid || msg.parent || null;
          return {
            id: msg.uuid || msg.id || `claude-api-${idx}`,
            role:
              msg.sender === 'human' || msg.role === 'user'
                ? 'user'
                : 'assistant',
            content: contentText,
            text: contentText,
            createTime: msg.created_at
              ? new Date(msg.created_at).getTime() / 1000
              : Date.now() / 1000,
            parentMsgId,
            index: msg.index ?? idx
          };
        })
        .filter((msg) => msg.content && msg.content.trim().length > 0);

      // Build parent groups for edit detection
      for (const msg of mapped) {
        if (msg.parentMsgId) {
          const group = parentGroups.get(msg.parentMsgId) || [];
          group.push(msg);
          parentGroups.set(msg.parentMsgId, group);
        }
      }

      // Mark edit versions for messages sharing a parent
      for (const msg of mapped) {
        const siblings = msg.parentMsgId
          ? parentGroups.get(msg.parentMsgId) || []
          : [];
        // Only mark as edits if siblings share the same role
        const sameRoleSiblings = siblings.filter((s) => s.role === msg.role);

        if (sameRoleSiblings.length > 1) {
          sameRoleSiblings.sort((a, b) => a.createTime - b.createTime);
          const versionIndex =
            sameRoleSiblings.findIndex((s) => s.id === msg.id) + 1;

          msg.hasEditVersions = true;
          msg.editVersionIndex = versionIndex;
          msg.totalVersions = sameRoleSiblings.length;
          msg.siblingIds = sameRoleSiblings.map((s) => s.id);
        }
      }

      extractedMessages = mapped;
    }

    return { messages: extractedMessages, conversationId, title };
  }

  async function fetchClaudeConversation(conversationId) {
    const orgId = getClaudeOrgId();
    if (!orgId) {
      throw new Error('No Claude organization ID available');
    }

    const url = `${location.origin}/api/organizations/${orgId}/chat_conversations/${conversationId}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`Claude conversation fetch failed: ${res.status}`);
    }

    const data = await res.json();
    const extracted = extractClaudeMessagesFromApi(data);
    const resolvedConversationId =
      extracted.conversationId || conversationId || null;

    if (extracted.messages.length > 0) {
      claudeApiCache = {
        conversationId: resolvedConversationId,
        messages: extracted.messages,
        lastUpdate: Date.now()
      };

      updateRawCache('claude', {
        conversationId: resolvedConversationId,
        title:
          extracted.title ||
          document.title?.replace(/\s*[-–]\s*Claude\s*$/i, '').trim() ||
          'Claude Conversation',
        messages: extracted.messages
      });
    }

    return {
      conversationId: resolvedConversationId,
      title: extracted.title,
      messages: extracted.messages
    };
  }

  /**
   * Handle Claude API response data from fetch interceptor
   */
  function handleClaudeApiResponse(data, url) {
    if (!data) return;

    const orgId = extractClaudeOrgIdFromUrl(url);
    if (orgId) {
      claudeOrgId = orgId;
    }

    const extracted = extractClaudeMessagesFromApi(data);
    const conversationId =
      extracted.conversationId ||
      extractClaudeConversationIdFromUrl(url) ||
      getConversationId('claude');
    const title = extracted.title || null;

    if (extracted.messages.length > 0) {
      claudeApiCache = {
        conversationId,
        messages: extracted.messages,
        lastUpdate: Date.now()
      };

      // Also update the raw conversation cache for Markdown export
      updateRawCache('claude', {
        conversationId,
        title:
          title ||
          document.title?.replace(/\s*[-–]\s*Claude\s*$/i, '').trim() ||
          'Claude Conversation',
        messages: extracted.messages
      });

      // Trigger a refresh
      scheduleRefresh(100);
    }
  }

  // Listen for messages from injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'CLAUDE_API_RESPONSE') {
      handleClaudeApiResponse(event.data.data, event.data.url);
    }

    if (event.data?.type === 'GEMINI_API_RESPONSE') {
      handleGeminiApiResponse(event.data.data, event.data.url);
    }

    if (event.data?.type === 'PERPLEXITY_API_RESPONSE') {
      handlePerplexityApiResponse(event.data.data, event.data.url);
    }
  });

  // ============================================
  // Gemini API Interception
  // ============================================

  /**
   * Inject fetch interceptor for Gemini API responses
   */
  function injectGeminiFetchInterceptor() {
    if (document.getElementById('gemini-fetch-interceptor')) return;

    const script = document.createElement('script');
    script.id = 'gemini-fetch-interceptor';
    script.textContent = `
      (function() {
        if (window.__geminiInterceptorInstalled) return;
        window.__geminiInterceptorInstalled = true;
        
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          
          // Intercept Gemini conversation API responses
          // Gemini uses various endpoints like /batchexecute, /stream, etc.
          if (url.includes('batchexecute') || url.includes('/conversation') || url.includes('/generate')) {
            try {
              const cloned = response.clone();
              const contentType = cloned.headers.get('content-type') || '';
              
              if (contentType.includes('application/json') || contentType.includes('text/')) {
                const text = await cloned.text();
                // Gemini responses are often wrapped in )]}' prefix
                let data = text;
                if (text.startsWith(")]}'")) {
                  data = text.slice(4);
                }
                try {
                  const parsed = JSON.parse(data);
                  window.postMessage({
                    type: 'GEMINI_API_RESPONSE',
                    url: url,
                    data: parsed
                  }, '*');
                } catch(e) {
                  // If JSON parse fails, try to extract message data from the response
                  window.postMessage({
                    type: 'GEMINI_API_RESPONSE',
                    url: url,
                    data: { rawText: text }
                  }, '*');
                }
              }
            } catch(e) {
              // Silently ignore errors
            }
          }
          return response;
        };
        console.log('[ConversationIndex] Gemini fetch interceptor installed');
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }

  /**
   * Handle Gemini API response data
   */
  function handleGeminiApiResponse(data, _url) {
    if (!data) return;

    let extractedMessages = [];
    const conversationId = getConversationId('gemini');

    // Gemini has complex nested response structures
    // Try to extract conversation messages from various formats

    // Format 1: Look for conversation array in nested structure
    function extractFromNested(obj, messages = []) {
      if (!obj || typeof obj !== 'object') return messages;

      // Look for message-like structures
      if (obj.text && typeof obj.text === 'string' && obj.text.length > 10) {
        const role =
          obj.author === 'user' || obj.role === 'user' ? 'user' : 'assistant';
        messages.push({
          id: obj.id || `gemini-api-${messages.length}`,
          role,
          content: obj.text,
          text: obj.text,
          createTime: Date.now() / 1000
        });
      } else if (Array.isArray(obj.parts)) {
        const partsText = normalizeContent(obj.parts);
        if (partsText.length > 10) {
          const role =
            obj.author === 'user' || obj.role === 'user' ? 'user' : 'assistant';
          messages.push({
            id: obj.id || `gemini-api-${messages.length}`,
            role,
            content: partsText,
            text: partsText,
            createTime: Date.now() / 1000
          });
        }
      }

      // Recursively search arrays and objects
      if (Array.isArray(obj)) {
        for (const item of obj) {
          extractFromNested(item, messages);
        }
      } else {
        for (const key of Object.keys(obj)) {
          extractFromNested(obj[key], messages);
        }
      }

      return messages;
    }

    extractedMessages = extractFromNested(data);

    // Filter for meaningful messages
    extractedMessages = extractedMessages.filter(
      (m) => m.content && m.content.length >= MIN_MESSAGE_LENGTH
    );

    if (extractedMessages.length > 0) {
      updateRawCache('gemini', {
        conversationId: conversationId || 'gemini-conv',
        title:
          document.title?.replace(/\s*[-–]\s*Google Gemini\s*$/i, '').trim() ||
          'Gemini Conversation',
        messages: extractedMessages
      });
      scheduleRefresh(100);
    }
  }

  // ============================================
  // Perplexity API Interception
  // ============================================

  /**
   * Inject fetch interceptor for Perplexity API responses
   */
  function injectPerplexityFetchInterceptor() {
    if (document.getElementById('perplexity-fetch-interceptor')) return;

    const script = document.createElement('script');
    script.id = 'perplexity-fetch-interceptor';
    script.textContent = `
      (function() {
        if (window.__perplexityInterceptorInstalled) return;
        window.__perplexityInterceptorInstalled = true;
        
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          
          // Intercept Perplexity search/answer API responses
          if (url.includes('/api/') && (url.includes('search') || url.includes('query') || url.includes('answer'))) {
            try {
              const cloned = response.clone();
              const contentType = cloned.headers.get('content-type') || '';
              
              if (contentType.includes('application/json')) {
                const data = await cloned.json();
                window.postMessage({
                  type: 'PERPLEXITY_API_RESPONSE',
                  url: url,
                  data: data
                }, '*');
              }
            } catch(e) {
              // Silently ignore errors
            }
          }
          return response;
        };
        console.log('[ConversationIndex] Perplexity fetch interceptor installed');
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }

  /**
   * Handle Perplexity API response data
   */
  function handlePerplexityApiResponse(data, _url) {
    if (!data) return;

    let extractedMessages = [];
    const conversationId = getConversationId('perplexity');

    // Perplexity response formats
    // Format 1: Search results with query and answer
    if (data.query || data.answer || data.text) {
      if (data.query) {
        extractedMessages.push({
          id: 'pplx-query',
          role: 'user',
          content: data.query,
          text: data.query,
          createTime: Date.now() / 1000 - 60
        });
      }

      if (data.answer || data.text) {
        extractedMessages.push({
          id: 'pplx-answer',
          role: 'assistant',
          content: data.answer || data.text,
          text: data.answer || data.text,
          createTime: Date.now() / 1000
        });
      }
    }

    // Format 2: Messages array
    if (data.messages && Array.isArray(data.messages)) {
      for (const msg of data.messages) {
        extractedMessages.push({
          id: msg.id || `pplx-api-${extractedMessages.length}`,
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content || msg.text || '',
          text: msg.content || msg.text || '',
          createTime: msg.created_at
            ? new Date(msg.created_at).getTime() / 1000
            : Date.now() / 1000
        });
      }
    }

    // Format 3: Threads/turns
    if (data.thread && Array.isArray(data.thread)) {
      for (const turn of data.thread) {
        if (turn.query) {
          extractedMessages.push({
            id: `pplx-q-${extractedMessages.length}`,
            role: 'user',
            content: turn.query,
            text: turn.query,
            createTime: Date.now() / 1000
          });
        }
        if (turn.answer || turn.response) {
          extractedMessages.push({
            id: `pplx-a-${extractedMessages.length}`,
            role: 'assistant',
            content: turn.answer || turn.response,
            text: turn.answer || turn.response,
            createTime: Date.now() / 1000
          });
        }
      }
    }

    // Filter for meaningful messages
    extractedMessages = extractedMessages.filter(
      (m) => m.content && m.content.length >= MIN_MESSAGE_LENGTH
    );

    if (extractedMessages.length > 0) {
      updateRawCache('perplexity', {
        conversationId: conversationId || 'pplx-conv',
        title:
          document.title?.replace(/\s*[-–]\s*Perplexity\s*$/i, '').trim() ||
          'Perplexity Search',
        messages: extractedMessages
      });
      scheduleRefresh(100);
    }
  }

  function isGeminiBlacklistedText(text) {
    if (!text) return true;
    const trimmed = text.trim();
    return GEMINI_UI_BLACKLIST.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Check if we're in Gemini Deep Research mode
   */
  function isGeminiDeepResearchMode() {
    const indicators = [
      '[class*="canvas"]',
      '[class*="document-view"]',
      '[class*="research-output"]',
      '[class*="report-content"]'
    ];
    for (const sel of indicators) {
      if (document.querySelector(sel)) return true;
    }
    return false;
  }

  /**
   * Check if element is in Gemini document area (Deep Research)
   */
  function isInGeminiDocumentArea(el) {
    const docSelectors = [
      '[class*="canvas"]',
      '[class*="document"]',
      '[class*="research-output"]',
      '[class*="report-content"]'
    ];
    for (const sel of docSelectors) {
      if (el.closest(sel)) return true;
    }
    return false;
  }

  /**
   * Extract Gemini messages with deduplication and filtering
   * Also tags DOM elements for accurate scroll-to-message
   */
  function extractGeminiMessages() {
    const messages = [];
    const seenTexts = new Set();
    const isDeepResearch = isGeminiDeepResearchMode();
    let index = 0;

    // Clear previous tags
    document.querySelectorAll('[data-branch-tree-id]').forEach((el) => {
      el.removeAttribute('data-branch-tree-id');
    });

    // Find user queries - look for user message containers
    const userElements = document.querySelectorAll(
      '[class*="query-content"], [class*="user-query"], [data-message-author-role="user"]'
    );

    // Find model responses
    const modelElements = document.querySelectorAll(
      '[class*="response-container"], [class*="model-response"], [data-message-author-role="model"]'
    );

    // Combine and process all elements
    const allElements = [];

    for (const el of userElements) {
      if (isDeepResearch && isInGeminiDocumentArea(el)) continue;
      allElements.push({ element: el, role: 'user' });
    }

    for (const el of modelElements) {
      if (isDeepResearch && isInGeminiDocumentArea(el)) continue;
      allElements.push({ element: el, role: 'assistant' });
    }

    // Sort by DOM position
    allElements.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // If no elements found with specific selectors, try fallback
    if (allElements.length === 0) {
      const fallbackElements = document.querySelectorAll(
        '[class*="markdown"]:not([class*="markdown-"] *), [class*="prose"]:not([class*="prose-"] *)'
      );

      for (const el of fallbackElements) {
        if (isDeepResearch && isInGeminiDocumentArea(el)) continue;
        const role = determineRole(el, 'gemini');
        if (role === 'user' || role === 'assistant') {
          allElements.push({ element: el, role });
        }
      }
    }

    // Process elements with deduplication
    for (const { element, role } of allElements) {
      // Extract text, cleaning up UI elements
      let text = '';

      // Try to find the main text content
      const textContainers = element.querySelectorAll(
        '[class*="markdown-content"], [class*="response-text"], [class*="query-text"], [class*="prose"]'
      );

      if (textContainers.length > 0) {
        for (const tc of textContainers) {
          const clone = tc.cloneNode(true);
          // Remove UI elements
          const uiElements = clone.querySelectorAll(
            'button, [role="button"], svg, [class*="icon"], [class*="action"]'
          );
          uiElements.forEach((ui) => ui.remove());
          text = clone.textContent?.trim() || '';
          if (text.length >= MIN_MESSAGE_LENGTH) break;
        }
      }

      if (!text || text.length < MIN_MESSAGE_LENGTH) {
        text = element.textContent?.trim() || '';
      }

      // Skip if too short or blacklisted
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;
      if (isGeminiBlacklistedText(text)) continue;

      // Deduplication
      const textKey = text.slice(0, 150).toLowerCase().replace(/\s+/g, ' ');
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);

      const msgId = `gemini-msg-${index}`;

      // Tag the DOM element for accurate scroll targeting
      element.setAttribute('data-branch-tree-id', msgId);

      messages.push({
        id: msgId,
        type: 'message',
        role,
        text,
        createTime: Date.now() / 1000 - (allElements.length - index) * 60,
        hasEditVersions: false
      });

      index++;
    }

    return messages;
  }

  /**
   * Extract Claude messages with improved selectors and streaming awareness
   * Only extracts completed messages (data-is-streaming="false")
   */
  function extractClaudeMessages(minLength = MIN_MESSAGE_LENGTH) {
    const messages = [];
    const seenTexts = new Set();
    let index = 0;
    const conversationId = getConversationId('claude');

    // Clear previous tags
    document.querySelectorAll('[data-branch-tree-id]').forEach((el) => {
      el.removeAttribute('data-branch-tree-id');
    });

    // Strategy 1: Use API cache if available and recent (within 30 seconds)
    if (
      claudeApiCache.messages.length > 0 &&
      claudeApiCache.conversationId === conversationId &&
      Date.now() - claudeApiCache.lastUpdate < 30000
    ) {
      // Use API data as authoritative source
      for (const msg of claudeApiCache.messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;

        const textKey = msg.text
          .slice(0, 150)
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (seenTexts.has(textKey)) continue;
        seenTexts.add(textKey);

        messages.push({
          id: msg.id || `claude-msg-${index}`,
          type: 'message',
          role: msg.role,
          text: msg.text,
          createTime: msg.createTime || Date.now() / 1000,
          hasEditVersions: false
        });
        index++;
      }

      // If we got messages from API, return them
      if (messages.length > 0) {
        return messages;
      }
    }

    // Strategy 2: DOM extraction with precise selectors

    // Find conversation container
    let conversationContainer = document.querySelector(
      CLAUDE_SELECTORS.conversationContainer
    );
    if (!conversationContainer) {
      conversationContainer = document.body;
    }

    // Find user messages using precise selector
    const userElements = conversationContainer.querySelectorAll(
      CLAUDE_SELECTORS.userMessage
    );
    // Find assistant messages using precise selector
    const assistantElements = conversationContainer.querySelectorAll(
      CLAUDE_SELECTORS.assistantMessage
    );

    // Combine all message elements with their roles
    const allElements = [];

    for (const el of userElements) {
      // Skip if this element is inside a streaming container
      if (el.closest('[data-is-streaming="true"]')) continue;
      allElements.push({ element: el, role: 'user' });
    }

    for (const el of assistantElements) {
      // Skip streaming assistant messages - only capture completed ones
      if (el.closest('[data-is-streaming="true"]')) continue;
      allElements.push({ element: el, role: 'assistant' });
    }

    // Sort by DOM position
    allElements.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // Process elements
    for (const { element, role } of allElements) {
      const text = element.textContent?.trim() || '';
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;

      // Deduplication
      const textKey = text.slice(0, 150).toLowerCase().replace(/\s+/g, ' ');
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);

      const msgId = `claude-msg-${index}`;

      // Find the best container for scroll targeting
      const container =
        element.closest('[class*="group"]') ||
        element.closest('[data-is-streaming]') ||
        element.parentElement;
      if (container) {
        container.setAttribute('data-branch-tree-id', msgId);
      }

      messages.push({
        id: msgId,
        type: 'message',
        role,
        text,
        createTime: Date.now() / 1000 - (allElements.length - index) * 60,
        hasEditVersions: false
      });

      index++;
    }

    // Strategy 3: Fallback to generic selectors if nothing found
    if (messages.length === 0) {
      const fallbackSelectors = [
        '[data-testid*="message"]',
        '[class*="Message"]',
        '.prose',
        '[class*="break-words"][class*="whitespace-pre-wrap"]'
      ];

      let fallbackElements = [];
      for (const sel of fallbackSelectors) {
        fallbackElements = document.querySelectorAll(sel);
        if (fallbackElements.length > 0) break;
      }

      for (const el of fallbackElements) {
        // Skip streaming elements
        if (el.closest('[data-is-streaming="true"]')) continue;

        const role = determineRole(el, 'claude');
        if (role !== 'user' && role !== 'assistant') continue;

        const text = el.textContent?.trim() || '';
        if (!text || text.length < minLength) continue;

        const textKey = text.slice(0, 150).toLowerCase().replace(/\s+/g, ' ');
        if (seenTexts.has(textKey)) continue;
        seenTexts.add(textKey);

        const msgId = `claude-msg-${index}`;
        el.setAttribute('data-branch-tree-id', msgId);

        messages.push({
          id: msgId,
          type: 'message',
          role,
          text,
          createTime:
            Date.now() / 1000 - (fallbackElements.length - index) * 60,
          hasEditVersions: false
        });

        index++;
      }
    }

    return messages;
  }

  function extractDOMMessages(platform) {
    // Use specialized extractors for specific platforms
    if (platform === 'gemini') {
      return extractGeminiMessages();
    }

    if (platform === 'claude') {
      return extractClaudeMessages();
    }

    const messages = [];
    const seenTexts = new Set(); // Add dedup for all platforms
    let index = 0;

    // Platform-specific selectors
    const selectors = {
      perplexity: [
        '[class*="query-block"]',
        '[class*="answer-block"]',
        '[class*="prose"]'
      ]
    };

    const platformSelectors = selectors[platform] || [];
    let elements = [];

    for (const sel of platformSelectors) {
      elements = document.querySelectorAll(sel);
      if (elements.length > 0) break;
    }

    // Fallback: look for common patterns
    if (elements.length === 0) {
      elements = document.querySelectorAll(
        '[class*="message"], [class*="prose"], [role="article"]'
      );
    }

    for (const el of elements) {
      const role = determineRole(el, platform);
      if (role !== 'user' && role !== 'assistant') continue;

      const text = el.textContent?.trim() || '';
      if (!text || text.length < MIN_MESSAGE_LENGTH) continue;

      // Deduplication
      const textKey = text.slice(0, 150).toLowerCase().replace(/\s+/g, ' ');
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);

      messages.push({
        id: `${platform}-msg-${index}`,
        type: 'message',
        role,
        text,
        createTime: Date.now() / 1000 - (elements.length - index) * 60,
        hasEditVersions: false
      });

      index++;
    }

    return messages;
  }

  function determineRole(el, platform) {
    const className = el.className || '';
    const testId = el.dataset?.testid || '';
    const roleAttr = el.dataset?.messageAuthorRole;

    // Direct role attribute
    if (roleAttr === 'user' || roleAttr === 'human') return 'user';
    if (roleAttr === 'model' || roleAttr === 'assistant') return 'assistant';

    // Class-based detection
    const userPatterns = ['user', 'human', 'query'];
    const assistantPatterns = ['assistant', 'model', 'response', 'answer'];

    for (const p of userPatterns) {
      if (className.includes(p) || testId.includes(p)) return 'user';
    }
    for (const p of assistantPatterns) {
      if (className.includes(p) || testId.includes(p)) return 'assistant';
    }

    // Claude-specific: look for font-claude-message class (assistant) vs regular styling
    if (platform === 'claude') {
      if (
        className.includes('font-claude-message') ||
        className.includes('font-tiempos')
      ) {
        return 'assistant';
      }
      // Check parent for role hints
      const parent = el.closest('[data-testid]');
      if (parent) {
        const parentTestId = parent.dataset.testid || '';
        if (parentTestId.includes('user')) return 'user';
        if (parentTestId.includes('assistant') || parentTestId.includes('bot'))
          return 'assistant';
      }
    }

    // 'prose' class alone could be either - need context
    if (className.includes('prose')) {
      // Check ancestors for role hints
      const ancestor = el.closest('[class*="user"], [class*="human"]');
      if (ancestor) return 'user';
      const assistantAncestor = el.closest(
        '[class*="assistant"], [class*="response"], [class*="bot"]'
      );
      if (assistantAncestor) return 'assistant';
    }

    return 'unknown';
  }

  // ============================================
  // Tree Building (simplified for multi-platform)
  // ============================================

  function cleanChatGPTConversationId(id) {
    if (!id) return null;
    return id.replace(/^WEB:/i, '');
  }

  function extractChatGPTConversationIdFromPath(pathname = '') {
    const match = pathname.match(/\/c\/((?:WEB:)?[0-9a-f-]+)/i);
    return match?.[1] || null;
  }

  function isPreBranchChatGPTId(id) {
    return typeof id === 'string' ? /^WEB:/i.test(id) : false;
  }

  function findParentBranch(branchData, childId) {
    if (!branchData?.branches || !childId) return null;
    for (const [parentId, branches] of Object.entries(branchData.branches)) {
      const idx = branches.findIndex((branch) => branch.childId === childId);
      if (idx >= 0) {
        return { parentId, branchIndex: idx, branch: branches[idx] };
      }
    }
    return null;
  }

  function buildBranchContextNodes({
    branchData,
    parentId,
    currentConversationId
  }) {
    if (!branchData || !parentId) {
      return { ancestorTitle: null, branchRoot: null, branchNodes: [] };
    }

    const parentTitle = branchData.titles?.[parentId] || 'Conversation';

    const ancestorTitle = {
      id: `ancestor-title:${parentId}`,
      type: 'ancestor-title',
      text: parentTitle,
      depth: 0,
      targetConversationId: parentId,
      isMainViewing: false
    };

    const branchRoot = {
      id: `branch-root:${parentId}`,
      type: 'branchRoot',
      text: parentTitle,
      depth: 0,
      targetConversationId: parentId
    };

    const branches = branchData.branches?.[parentId] || [];
    const branchNodes = branches.map((branch, idx) => ({
      id: `branch:${branch.childId}`,
      type: 'branch',
      text: branch.firstMessage || branch.title || 'Branched conversation',
      createTime: toSeconds(branch.createdAt || 0),
      targetConversationId: branch.childId,
      branchIndex: idx,
      branchLabel: `Branch: ${branch.title || 'New Chat'}`,
      depth: 1,
      icon: 'branch',
      isViewing: branch.childId === currentConversationId
    }));

    return { ancestorTitle, branchRoot, branchNodes };
  }

  function buildDisplayList(messages, branchData, conversationId, title) {
    const result = [];
    const branches = branchData?.branches?.[conversationId] || [];

    // Separate edit branch nodes from regular messages
    const editBranches = messages.filter((m) => m.type === 'editBranch');
    const regularMessages = messages.filter((m) => m.type !== 'editBranch');

    // Filter to user messages for display
    const userMessages = regularMessages.filter((m) => m.role === 'user');

    // Add title node
    if (title) {
      result.push({
        id: 'title-node',
        type: 'title',
        text: title,
        depth: 0,
        targetConversationId: conversationId
      });
    }

    // Create external branch nodes
    const branchNodes = branches.map((branch, idx) => ({
      id: `branch:${branch.childId}`,
      type: 'branch',
      text: branch.firstMessage || branch.title || 'Branched conversation',
      createTime: toSeconds(branch.createdAt || 0),
      targetConversationId: branch.childId,
      branchIndex: idx,
      branchLabel: `Branch: ${branch.title || 'New Chat'}`,
      depth: 1,
      icon: 'branch' // Icon type for visual distinction
    }));

    // Combine user messages + external branches + edit branches
    const allItems = [...userMessages, ...branchNodes, ...editBranches].sort(
      (a, b) => toSeconds(a.createTime) - toSeconds(b.createTime)
    );

    // Add to result
    for (const item of allItems) {
      if (item.type === 'branch') {
        result.push({ ...item, depth: 1 });
      } else if (item.type === 'editBranch') {
        result.push({
          ...item,
          targetConversationId: conversationId
        });
      } else {
        result.push({
          ...item,
          type: 'message',
          depth: 0,
          targetConversationId: conversationId
        });
      }
    }

    return result;
  }

  // ============================================
  // Conversation ID Extraction
  // ============================================

  function getConversationId(platform) {
    const pathname = location.pathname;
    const search = location.search;

    switch (platform) {
      case 'chatgpt': {
        const rawId = extractChatGPTConversationIdFromPath(pathname);
        return cleanChatGPTConversationId(rawId);
      }

      case 'claude': {
        const claudeMatch = pathname.match(/\/chat\/([a-zA-Z0-9-]+)/i);
        return claudeMatch?.[1] || null;
      }

      case 'gemini': {
        const geminiMatch = pathname.match(/\/(app|share)\/([a-zA-Z0-9_-]+)/i);
        return geminiMatch?.[2] || null;
      }

      case 'perplexity': {
        const pplxPathMatch = pathname.match(/\/search\/([a-zA-Z0-9-]+)/i);
        if (pplxPathMatch) return pplxPathMatch[1];
        const params = new URLSearchParams(search);
        return params.get('uuid') || null;
      }

      default:
        return null;
    }
  }

  // ============================================
  // Branch Detection (ChatGPT only)
  // ============================================

  let pendingBranch = null;

  /**
   * Detect if a click target is a "Branch in new chat" button.
   * Uses multiple heuristics for resilience against UI changes.
   */
  function isBranchButton(target) {
    if (!target) return false;

    // Check text content (case-insensitive, partial match)
    const text = (target.textContent || '').trim().toLowerCase();
    if (text.includes('branch')) return true;

    // Check aria-label
    const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('branch')) return true;

    // Check data-testid
    const testId = target.dataset?.testid || '';
    if (testId.includes('branch')) return true;

    // Check closest parent with branch indicators
    const branchParent = target.closest(
      '[data-testid*="branch"], [aria-label*="branch" i]'
    );
    if (branchParent) return true;

    return false;
  }

  document.addEventListener(
    'click',
    (e) => {
      if (isBranchButton(e.target)) {
        const platform = detectPlatform();
        if (platform === 'chatgpt') {
          const convId = getConversationId(platform);
          if (convId) {
            const timestampSeconds = Math.floor(Date.now() / 1000);
            pendingBranch = {
              parentId: convId,
              timestamp: timestampSeconds
            };
            chrome.storage.local.set({ pendingBranch });
          }
        }
      }
    },
    true
  );

  // URL change detection for branch creation backup
  let lastContentUrl = location.href;

  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== lastContentUrl) {
      const platform = detectPlatform();
      if (platform === 'chatgpt') {
        const oldRaw = extractChatGPTConversationIdFromPath(
          new URL(lastContentUrl).pathname
        );
        const newRaw = extractChatGPTConversationIdFromPath(
          new URL(currentUrl).pathname
        );
        const oldClean = cleanChatGPTConversationId(oldRaw);
        const newClean = cleanChatGPTConversationId(newRaw);
        const preBranchChanged =
          isPreBranchChatGPTId(oldRaw) !== isPreBranchChatGPTId(newRaw);
        if (
          oldClean &&
          newClean &&
          (oldClean !== newClean || preBranchChanged)
        ) {
          // Navigation to a different conversation - check pending
          scheduleRefresh(300);
        }
      }
      lastContentUrl = currentUrl;
    }
  }

  // Poll for URL changes (pushState doesn't fire events)
  setInterval(checkUrlChange, 1000);

  async function checkPendingBranch(
    currentConvId,
    currentTitle,
    mapping,
    branchData
  ) {
    const data = await chrome.storage.local.get('pendingBranch');
    const pending = data?.pendingBranch;
    if (!pending) return null;

    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (nowInSeconds - pending.timestamp > 120) {
      await chrome.storage.local.remove('pendingBranch');
      return null;
    }

    if (pending.parentId === currentConvId) return null;

    // Get first user message for better branch naming
    const userMessages = [];
    for (const [_id, entry] of Object.entries(mapping || {})) {
      const msg = entry?.message;
      if (!msg || msg.author?.role !== 'user') continue;
      const text = extractText(msg);
      if (!text || isInternalMessage(text)) continue;
      userMessages.push({ text, createTime: msg.create_time || 0 });
    }
    userMessages.sort((a, b) => a.createTime - b.createTime);
    const firstMessage = userMessages[0]?.text || null;

    // Record branch
    if (!branchData.branches[pending.parentId]) {
      branchData.branches[pending.parentId] = [];
    }

    const exists = branchData.branches[pending.parentId].some(
      (b) => b.childId === currentConvId
    );
    if (!exists) {
      branchData.branches[pending.parentId].push({
        childId: currentConvId,
        title: currentTitle || 'Conversation',
        firstMessage,
        createdAt: pending.timestamp
      });
    }

    branchData.titles[currentConvId] =
      currentTitle || branchData.titles[currentConvId] || 'Conversation';
    await saveBranchData(branchData);
    await chrome.storage.local.remove('pendingBranch');

    return branchData;
  }

  // ============================================
  // DOM Interaction
  // ============================================

  const HIGHLIGHT_CLASS = 'branch-tree-highlight';

  function injectStyles() {
    if (document.getElementById('branch-tree-styles')) return;
    const style = document.createElement('style');
    style.id = 'branch-tree-styles';
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 3px solid #6b8af7 !important;
        outline-offset: 2px;
        border-radius: 8px;
        transition: outline 0.2s ease;
      }
    `;
    document.head.appendChild(style);
  }

  function findMessageElement(nodeId, platform) {
    if (!nodeId || nodeId.startsWith('branch') || nodeId.startsWith('title'))
      return null;

    // Try our custom data attribute first (set during extraction)
    let el = document.querySelector(`[data-branch-tree-id="${nodeId}"]`);
    if (el) return el;

    // Try data-message-id attribute
    el = document.querySelector(`[data-message-id="${nodeId}"]`);
    if (el) return el;

    // ChatGPT specific
    if (platform === 'chatgpt') {
      el =
        document.querySelector(`[data-testid="conversation-turn-${nodeId}"]`) ||
        document.getElementById(nodeId);
      if (el) return el;
    }

    // For Gemini, re-extract to find the element (last resort)
    if (platform === 'gemini' && nodeId.startsWith('gemini-msg-')) {
      // Re-run extraction which will re-tag elements
      extractGeminiMessages();
      el = document.querySelector(`[data-branch-tree-id="${nodeId}"]`);
      if (el) return el;
    }

    // For other platforms, try to find by index as fallback
    const match = nodeId.match(/(claude|pplx)-msg-(\d+)/);
    if (match) {
      const index = parseInt(match[2], 10);
      const messages = document.querySelectorAll(
        '[class*="message"], [class*="prose"], [role="article"]'
      );
      return messages[index] || null;
    }

    return null;
  }

  function scrollToMessage(nodeId, platform) {
    const el = findMessageElement(nodeId, platform);
    if (!el) return false;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 1500);
    return true;
  }

  // ============================================
  // Main Handler
  // ============================================

  async function handleGetTree() {
    const platform = detectPlatform();
    if (!platform) {
      return { error: 'Unsupported platform' };
    }

    const rawChatGPTId =
      platform === 'chatgpt'
        ? extractChatGPTConversationIdFromPath(location.pathname)
        : null;
    const isPreBranch =
      platform === 'chatgpt' ? isPreBranchChatGPTId(rawChatGPTId) : false;
    const conversationId = getConversationId(platform);
    if (!conversationId) {
      return { error: 'No conversation ID found' };
    }

    try {
      let messages = [];
      let title = 'Conversation';
      let branchData = await loadBranchData();
      let hasAncestry = false;

      if (platform === 'chatgpt') {
        // Use API for ChatGPT
        const conv = await fetchChatGPTConversation(conversationId, true, true);
        title = conv.title || 'Conversation';

        // Check for pending branch
        const updatedData = await checkPendingBranch(
          conversationId,
          title,
          conv.mapping,
          branchData
        );
        if (updatedData) {
          branchData = updatedData;
        }

        // Extract messages as tree with edit branches
        messages = extractChatGPTTree(conv.mapping, conv.current_node);
      } else {
        // Use DOM for other platforms
        messages = extractDOMMessages(platform);

        // Try to get title from page
        const pageTitle = document.title;
        if (pageTitle && !pageTitle.includes(platform)) {
          title = pageTitle;
        }
      }

      // Update title in branch data
      branchData.titles[conversationId] = title;
      await saveBranchData(branchData);

      // Build display list
      const parentInfo =
        platform === 'chatgpt'
          ? findParentBranch(branchData, conversationId)
          : null;
      const baseNodes = buildDisplayList(
        messages,
        branchData,
        conversationId,
        parentInfo ? null : title
      );

      let nodes = baseNodes;

      if (parentInfo) {
        const context = buildBranchContextNodes({
          branchData,
          parentId: parentInfo.parentId,
          currentConversationId: conversationId
        });

        const currentTitleNode = {
          id: `current-title:${conversationId}`,
          type: 'current-title',
          text: title,
          depth: 0,
          targetConversationId: conversationId,
          isMainViewing: true
        };

        nodes = [
          context.ancestorTitle,
          context.branchRoot,
          ...context.branchNodes,
          currentTitleNode,
          ...baseNodes
        ].filter(Boolean);
        hasAncestry = true;
      }

      if (platform === 'chatgpt' && isPreBranch) {
        const indicator = {
          id: 'pre-branch-indicator',
          type: 'preBranchIndicator',
          text: 'You are viewing a branch preview. Send a message to create a new branch.',
          depth: 0,
          isPersistent: true
        };
        const insertAfterIndex = nodes.findIndex(
          (node) =>
            node.type === 'current-title' ||
            node.type === 'title' ||
            node.type === 'ancestor-title'
        );
        if (insertAfterIndex >= 0) {
          nodes.splice(insertAfterIndex + 1, 0, indicator);
        } else {
          nodes.unshift(indicator);
        }
      }

      return {
        conversationId,
        title,
        nodes,
        platform,
        hasAncestry
      };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }

  // ============================================
  // Message Handlers
  // ============================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const platform = detectPlatform();

    if (msg?.type === 'GET_CONVERSATION_TREE') {
      handleGetTree().then(sendResponse);
      return true;
    }

    if (msg?.type === 'FOCUS_MESSAGE') {
      injectStyles();
      const ok = scrollToMessage(msg.nodeId, platform);
      sendResponse({ ok });
      return false;
    }

    if (msg?.type === 'OPEN_CONVERSATION') {
      const baseUrl =
        platform === 'chatgpt' ? getBaseUrl() : window.location.origin;
      const url = `${baseUrl}/c/${msg.conversationId}`;
      window.location.href = url;
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === 'CLEAR_CACHE') {
      clearConversationCache().then(() => {
        clearTokenCache();
        sendResponse({ ok: true });
      });
      return true;
    }

    // Handle Claude API completion notification from background script
    if (msg?.type === 'CLAUDE_API_COMPLETED') {
      // Background script detected Claude API request completed
      const orgId = extractClaudeOrgIdFromUrl(msg.url);
      if (orgId) {
        claudeOrgId = orgId;
      }
      // Trigger a refresh to pick up new messages
      scheduleRefresh(200);
      sendResponse({ ok: true });
      return false;
    }

    // Handle Gemini API completion notification from background script
    if (msg?.type === 'GEMINI_API_COMPLETED') {
      scheduleRefresh(200);
      sendResponse({ ok: true });
      return false;
    }

    // Handle Perplexity API completion notification from background script
    if (msg?.type === 'PERPLEXITY_API_COMPLETED') {
      scheduleRefresh(200);
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === 'SWITCH_CHATGPT_BRANCH') {
      (async () => {
        try {
          const convId = getConversationId('chatgpt');
          if (!convId || !msg.branchNodeId) {
            sendResponse({ ok: false, error: 'Missing data' });
            return;
          }

          // Build children map to find leaf of the branch
          const conv = await fetchChatGPTConversation(convId, true, true);
          const childrenMap = {};
          for (const [id, entry] of Object.entries(conv.mapping || {})) {
            const parentId = entry.parent;
            if (parentId) {
              if (!childrenMap[parentId]) {
                childrenMap[parentId] = [];
              }
              childrenMap[parentId].push(id);
            }
          }

          const leafId = findBranchLeaf(msg.branchNodeId, childrenMap);

          // PATCH the conversation to switch current_node
          const token = await getAccessToken();
          const res = await fetch(
            `${getBaseUrl()}/backend-api/conversation/${convId}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              credentials: 'include',
              body: JSON.stringify({ current_node: leafId })
            }
          );

          if (res.ok) {
            // Clear cache to force fresh extraction
            memoryCache.delete(convId);
            const cacheKey = `${CONV_CACHE_PREFIX}${convId}`;
            try {
              await chrome.storage.local.remove(cacheKey);
            } catch {
              // Ignore
            }
            // Reload the page to reflect the branch switch
            location.reload();
            sendResponse({ ok: true });
          } else {
            sendResponse({
              ok: false,
              error: `API returned ${res.status}`
            });
          }
        } catch (err) {
          sendResponse({
            ok: false,
            error: err.message || 'Switch failed'
          });
        }
      })();
      return true;
    }

    if (msg?.type === 'GET_PLATFORM') {
      sendResponse({ platform });
      return false;
    }

    if (msg?.type === 'EXPORT_MARKDOWN') {
      handleExportMarkdown(platform).then(sendResponse);
      return true;
    }

    return false;
  });

  /**
   * Handle Markdown export request
   * @param {string} platform - Current platform
   * @returns {Promise<Object>} - Result with success/error status
   */
  async function handleExportMarkdown(platform) {
    if (!platform) {
      return { ok: false, error: 'Unsupported platform' };
    }

    const conversationId = getConversationId(platform);
    if (!conversationId) {
      return { ok: false, error: 'No conversation found' };
    }

    try {
      let messages = [];
      let title = document.title || 'Conversation';

      if (platform === 'chatgpt') {
        // ChatGPT: Use API to get complete conversation with original Markdown
        const conv = await fetchChatGPTConversation(
          conversationId,
          false,
          true
        );
        title = conv.title || title;

        // Extract ALL messages (both user and assistant) with original Markdown
        messages = extractChatGPTMessagesForExport(
          conv.mapping,
          conv.current_node
        );

        // Also update raw cache for future use
        updateRawCache('chatgpt', { conversationId, title, messages });
      } else if (platform === 'claude') {
        const cached = getRawCache('claude', conversationId);

        if (cached && cached.messages && cached.messages.length > 0) {
          title = cached.title || getPageTitle('claude') || title;
          messages = cached.messages;
        } else {
          let apiResult = null;
          try {
            apiResult = await fetchClaudeConversation(conversationId);
          } catch (err) {
            console.warn(
              '[ConversationIndex] Claude export fetch failed:',
              err
            );
          }

          if (apiResult?.messages?.length > 0) {
            title = apiResult.title || getPageTitle('claude') || title;
            messages = apiResult.messages;
          } else {
            // Fallback: Extract from DOM (may lose some Markdown formatting)
            const domMessages = extractClaudeMessagesForExport();
            if (domMessages.length > 0) {
              messages = domMessages;
              title = getPageTitle('claude') || title;
            }
          }
        }
      } else {
        // Other platforms: Try to use cached API data first
        const cached = getRawCache(platform, conversationId);

        if (cached && cached.messages && cached.messages.length > 0) {
          title = cached.title || title;
          messages = cached.messages;
        } else {
          // Fallback: Extract from DOM (may lose some Markdown formatting)
          const domMessages = extractDOMMessagesForExport(platform);
          if (domMessages.length > 0) {
            messages = domMessages;
            title = getPageTitle(platform) || title;
          }
        }
      }

      if (messages.length === 0) {
        return { ok: false, error: 'No messages found to export' };
      }

      // Generate Markdown content
      const markdown = generateMarkdown({
        title,
        platform,
        conversationId,
        messages
      });

      // Generate filename and trigger download
      const filename = generateFilename(title, platform);
      downloadFile(markdown, filename);

      return { ok: true, filename, messageCount: messages.length };
    } catch (err) {
      console.error('[ConversationIndex] Export error:', err);
      return { ok: false, error: err.message || 'Export failed' };
    }
  }

  /**
   * Extract all messages from ChatGPT mapping for export (both user AND assistant)
   * @param {Object} mapping - ChatGPT conversation mapping
   * @param {string} currentNode - Current node ID
   * @returns {Array} - Array of messages with content
   */
  function extractChatGPTMessagesForExport(mapping, currentNode) {
    if (!mapping) return [];

    // Build parent->children map
    const parentMap = {};
    let rootId = null;

    for (const [id, entry] of Object.entries(mapping)) {
      const parentId = entry.parent;
      if (!parentId) {
        rootId = id;
      } else {
        parentMap[id] = parentId;
      }
    }

    const currentPath = buildCurrentPath(mapping, rootId, currentNode);
    const messages = [];

    for (const nodeId of currentPath) {
      const entry = mapping[nodeId];
      const msg = entry?.message;
      if (!msg) continue;

      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const text = extractText(msg);
      if (!text || !text.trim()) continue;
      if (isInternalMessage(text)) continue;

      messages.push({
        id: nodeId,
        role,
        content: text, // Original Markdown content from API
        text: text,
        createTime: toSeconds(msg.create_time || 0)
      });
    }

    return messages;
  }

  /**
   * Extract Claude messages for export (fallback to DOM)
   * @returns {Array} - Array of messages
   */
  function extractClaudeMessagesForExport() {
    const domMessages = extractClaudeMessages(1);
    return domMessages.map((msg, index) => {
      const content = msg.text || '';
      return {
        id: msg.id || `claude-export-${index}`,
        role: msg.role,
        content,
        text: content,
        createTime: msg.createTime || Date.now() / 1000
      };
    });
  }

  /**
   * Extract messages from DOM for export (fallback when API cache not available)
   * @param {string} platform - Platform identifier
   * @returns {Array} - Array of messages
   */
  function extractDOMMessagesForExport(platform) {
    const messages = [];
    const seenTexts = new Set();

    // Get platform-specific selectors
    const selectors = {
      claude: ['.font-user-message', '.font-claude-message'],
      gemini: [
        '[data-message-author-role="user"]',
        '[data-message-author-role="model"]',
        '[class*="query-content"]',
        '[class*="response-container"]'
      ],
      perplexity: [
        '[class*="query-block"]',
        '[class*="answer-block"]',
        '[class*="prose"]'
      ]
    };

    const platformSelectors = selectors[platform] || [
      '[class*="message"]',
      '[class*="prose"]'
    ];

    // Collect all message elements
    const allElements = [];
    for (const sel of platformSelectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        allElements.push(el);
      }
    }

    // Sort by DOM position
    allElements.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    let index = 0;
    for (const el of allElements) {
      const role = determineRole(el, platform);
      if (role !== 'user' && role !== 'assistant') continue;

      // Try to extract HTML and convert to text (preserving some structure)
      let content = '';

      // Look for markdown/prose content
      const proseEl =
        el.querySelector('[class*="prose"], [class*="markdown"]') || el;
      content = proseEl.textContent?.trim() || '';

      if (!content || content.length < 10) continue;

      // Deduplication
      const textKey = content.slice(0, 150).toLowerCase();
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);

      messages.push({
        id: `${platform}-export-${index}`,
        role,
        content,
        text: content,
        createTime: Date.now() / 1000
      });

      index++;
    }

    return messages;
  }

  /**
   * Get page title cleaned for the platform
   * @param {string} platform - Platform identifier
   * @returns {string} - Cleaned title
   */
  function getPageTitle(platform) {
    const title = document.title || '';
    const suffixes = {
      claude: /\s*[-–]\s*Claude\s*$/i,
      gemini: /\s*[-–]\s*Google Gemini\s*$/i,
      perplexity: /\s*[-–]\s*Perplexity\s*$/i,
      chatgpt: /\s*[-–]\s*ChatGPT\s*$/i
    };

    const suffix = suffixes[platform];
    if (suffix) {
      return title.replace(suffix, '').trim();
    }
    return title;
  }

  // ============================================
  // Auto-refresh
  // ============================================

  let refreshTimer = null;
  let isRefreshing = false;
  let lastObserverTrigger = 0;
  const OBSERVER_THROTTLE_MS = 500; // Balanced throttle

  // Track message hash for change detection (polling fallback)
  let lastMessageHash = '';

  // Track tree signature to prevent sending duplicate updates
  let lastTreeSignature = '';

  /**
   * Compute a signature of the tree result for change detection
   * Only sends TREE_UPDATED when content actually changes
   */
  function computeTreeSignature(result) {
    if (!result || result.error) return '';
    try {
      return JSON.stringify({
        conversationId: result.conversationId,
        title: result.title,
        nodeCount: result.nodes?.length || 0,
        // Use summary of node content to detect changes without full serialization
        nodesSummary:
          result.nodes
            ?.map((n) => `${n.id}:${n.text?.slice(0, 50)}`)
            .join('|') || ''
      });
    } catch {
      return '';
    }
  }

  async function refreshTree() {
    if (isRefreshing) return;
    isRefreshing = true;

    try {
      const result = await handleGetTree();
      if (!result.error) {
        const signature = computeTreeSignature(result);
        // Only send update if content actually changed
        if (signature !== lastTreeSignature) {
          lastTreeSignature = signature;
          chrome.runtime.sendMessage({ type: 'TREE_UPDATED', ...result });
        }
      }
    } catch {
      // Ignore errors during auto-refresh
    } finally {
      isRefreshing = false;
    }
  }

  function scheduleRefresh(delay = 800) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!isRefreshing) {
        refreshTree();
      }
    }, delay);
  }

  function throttledScheduleRefresh() {
    const now = Date.now();
    if (now - lastObserverTrigger < OBSERVER_THROTTLE_MS) return;
    lastObserverTrigger = now;
    scheduleRefresh();
  }

  /**
   * Compute a simple hash of current messages for change detection.
   * Debounced: returns cached result if called within 300ms.
   */
  let lastHashTime = 0;
  let cachedHash = '';

  function computeMessageHash() {
    const now = Date.now();
    if (now - lastHashTime < 300 && cachedHash) {
      return cachedHash;
    }
    lastHashTime = now;
    const platform = detectPlatform();
    if (!platform) return '';

    // Get all potential message elements
    const selectors = {
      chatgpt: '[data-message-id]',
      claude:
        '[data-testid*="message"], [class*="font-claude-message"], .prose, [class*="grid-cols-1"] > div',
      gemini:
        '[data-message-author-role], [class*="response-container"], [class*="query-content"]',
      perplexity:
        '[class*="prose"], [class*="query-block"], [class*="answer-block"]'
    };

    const sel = selectors[platform] || '[class*="message"]';
    const elements = document.querySelectorAll(sel);

    // Build a hash from element count and total text length
    let totalTextLength = 0;
    for (const el of elements) {
      totalTextLength += el.textContent?.length || 0;
    }

    cachedHash = `${elements.length}:${totalTextLength}`;
    return cachedHash;
  }

  // Watch for DOM changes - enhanced to catch streaming updates
  const observer = new MutationObserver((mutations) => {
    let shouldRefresh = false;

    for (const m of mutations) {
      // Check for added/removed nodes
      if (m.addedNodes.length || m.removedNodes.length) {
        shouldRefresh = true;
        break;
      }

      // Check for text content changes (streaming responses)
      if (m.type === 'characterData') {
        shouldRefresh = true;
        break;
      }

      // Check for attribute changes on message containers
      if (m.type === 'attributes' && m.target instanceof Element) {
        // Special handling for Claude streaming state change
        if (m.attributeName === 'data-is-streaming') {
          const streamingValue = m.target.getAttribute('data-is-streaming');
          // Trigger refresh when streaming completes (changes to "false")
          if (streamingValue === 'false') {
            shouldRefresh = true;
            break;
          }
        }

        const className = m.target.className || '';
        if (
          className.includes('message') ||
          className.includes('prose') ||
          className.includes('response') ||
          className.includes('Message')
        ) {
          shouldRefresh = true;
          break;
        }
      }
    }

    if (shouldRefresh) {
      throttledScheduleRefresh();
    }
  });

  // ============================================
  // Initialize
  // ============================================

  /**
   * Polling-based change detection for platforms with streaming issues (Claude)
   * Checks if message content has changed and triggers refresh if so
   */
  let pollingInterval = null;

  function startPolling(intervalMs = 1000) {
    if (pollingInterval) return;

    pollingInterval = setInterval(() => {
      const currentHash = computeMessageHash();
      if (currentHash !== lastMessageHash) {
        lastMessageHash = currentHash;
        scheduleRefresh(100); // Quick refresh when change detected
      }
    }, intervalMs);
  }

  function _stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function init() {
    const platform = detectPlatform();
    if (!platform) {
      console.log('[ConversationIndex] Unsupported platform');
      return;
    }

    console.log(`[ConversationIndex] Initialized for ${platform}`);
    injectStyles();

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      // Include data-is-streaming for Claude streaming state detection
      attributeFilter: [
        'class',
        'data-testid',
        'data-message-id',
        'data-is-streaming'
      ]
    });

    // For Claude, use polling as fallback with longer interval
    // Primary detection is via fetch interceptor events
    if (platform === 'claude') {
      startPolling(2000); // Poll every 2s as fallback
      injectClaudeFetchInterceptor();
    }

    // Inject fetch interceptors for other platforms to capture raw Markdown
    if (platform === 'gemini') {
      injectGeminiFetchInterceptor();
    }

    if (platform === 'perplexity') {
      injectPerplexityFetchInterceptor();
    }

    scheduleRefresh(100);

    // Also refresh on visibility change (tab becomes active)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh(200);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
