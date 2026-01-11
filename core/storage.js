/**
 * Storage - Unified storage layer for branch data and caching
 * Abstracts chrome.storage.local operations
 */

// Storage keys
const STORAGE_KEYS = {
  BRANCH_DATA: 'chatgpt_branch_data',
  SETTINGS: 'branchTreeSettings',
  PENDING_BRANCH: 'pendingBranch',
  DEBUG_FLAG: 'branchTreeDebug',
  CONV_CACHE_PREFIX: 'conv_cache_'
};

// Cache TTL values (milliseconds)
const CACHE_TTL = {
  CURRENT_CONVERSATION: 2 * 60 * 1000, // 2 minutes
  HISTORY_CONVERSATION: 15 * 60 * 1000, // 15 minutes
  ACCESS_TOKEN: 5 * 60 * 1000 // 5 minutes
};

// In-memory cache layer
const memoryCache = new Map();

/**
 * Get value from chrome.storage.local
 * @param {string} key - Storage key
 * @returns {Promise<any>} - Stored value or null
 */
export async function get(key) {
  try {
    const data = await chrome.storage.local.get(key);
    return data?.[key] ?? null;
  } catch (err) {
    console.error('[Storage] Get error:', key, err);
    return null;
  }
}

/**
 * Set value in chrome.storage.local
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @returns {Promise<boolean>} - Success status
 */
export async function set(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
    return true;
  } catch (err) {
    console.error('[Storage] Set error:', key, err);
    return false;
  }
}

/**
 * Remove value from chrome.storage.local
 * @param {string|string[]} keys - Key(s) to remove
 * @returns {Promise<boolean>} - Success status
 */
export async function remove(keys) {
  try {
    await chrome.storage.local.remove(keys);
    return true;
  } catch (err) {
    console.error('[Storage] Remove error:', keys, err);
    return false;
  }
}

// ============================================
// Branch Data Operations
// ============================================

/**
 * Load branch relationship data
 * @returns {Promise<Object>} - Branch data { branches: {}, titles: {} }
 */
export async function loadBranchData() {
  const data = await get(STORAGE_KEYS.BRANCH_DATA);
  return data || { branches: {}, titles: {} };
}

/**
 * Save branch relationship data
 * @param {Object} data - Branch data to save
 * @returns {Promise<boolean>}
 */
export async function saveBranchData(data) {
  return set(STORAGE_KEYS.BRANCH_DATA, data);
}

/**
 * Record a branch relationship
 * @param {string} parentId - Parent conversation ID
 * @param {string} childId - Child conversation ID
 * @param {string} childTitle - Title of child conversation
 * @param {number} timestamp - When branch was created
 * @param {string} [firstMessage] - First user message in branch
 * @param {Object} [existingData] - Existing branch data to avoid reload
 * @returns {Promise<Object>} - Updated branch data
 */
export async function recordBranch(
  parentId,
  childId,
  childTitle,
  timestamp,
  firstMessage,
  existingData = null
) {
  const data = existingData || (await loadBranchData());

  if (!data.branches[parentId]) {
    data.branches[parentId] = [];
  }

  const exists = data.branches[parentId].some((b) => b.childId === childId);
  if (!exists) {
    const timestampSeconds = Math.floor((timestamp || Date.now()) / 1000);
    data.branches[parentId].push({
      childId,
      title: childTitle || 'Conversation',
      firstMessage: firstMessage || null,
      createdAt: timestampSeconds
    });
  }

  data.titles[childId] = childTitle || data.titles[childId] || 'Conversation';
  await saveBranchData(data);

  return data;
}

// ============================================
// Conversation Cache Operations
// ============================================

/**
 * Get cached conversation
 * @param {string} conversationId - Conversation ID
 * @param {boolean} [isCurrent=false] - Use shorter TTL for current conversation
 * @returns {Promise<Object|null>} - Cached data or null
 */
export async function getCachedConversation(conversationId, isCurrent = false) {
  // Check memory cache first
  const memCached = memoryCache.get(conversationId);
  if (memCached) {
    const ttl = isCurrent
      ? CACHE_TTL.CURRENT_CONVERSATION
      : CACHE_TTL.HISTORY_CONVERSATION;
    if (Date.now() - memCached.timestamp < ttl) {
      return memCached.data;
    }
    memoryCache.delete(conversationId);
  }

  // Check persistent storage
  const key = `${STORAGE_KEYS.CONV_CACHE_PREFIX}${conversationId}`;
  const cached = await get(key);

  if (!cached) return null;

  const ttl = isCurrent
    ? CACHE_TTL.CURRENT_CONVERSATION
    : CACHE_TTL.HISTORY_CONVERSATION;
  if (Date.now() - cached.timestamp > ttl) {
    remove(key).catch(() => {});
    return null;
  }

  // Populate memory cache
  memoryCache.set(conversationId, cached);
  return cached.data;
}

/**
 * Cache a conversation
 * @param {string} conversationId - Conversation ID
 * @param {Object} data - Conversation data
 * @returns {Promise<boolean>}
 */
export async function setCachedConversation(conversationId, data) {
  const cacheEntry = {
    data,
    timestamp: Date.now()
  };

  memoryCache.set(conversationId, cacheEntry);

  const key = `${STORAGE_KEYS.CONV_CACHE_PREFIX}${conversationId}`;
  return set(key, cacheEntry);
}

/**
 * Clear all conversation caches
 * @returns {Promise<void>}
 */
export async function clearConversationCache() {
  memoryCache.clear();

  try {
    const allData = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(allData).filter((k) =>
      k.startsWith(STORAGE_KEYS.CONV_CACHE_PREFIX)
    );
    if (keysToRemove.length > 0) {
      await remove(keysToRemove);
    }
  } catch (err) {
    console.error('[Storage] Cache clear error:', err);
  }
}

/**
 * Prune expired cache entries
 * @returns {Promise<void>}
 */
export async function pruneExpiredCache() {
  try {
    const allData = await chrome.storage.local.get(null);
    const now = Date.now();
    const keysToRemove = [];

    for (const [key, value] of Object.entries(allData)) {
      if (!key.startsWith(STORAGE_KEYS.CONV_CACHE_PREFIX)) continue;
      if (
        value?.timestamp &&
        now - value.timestamp > CACHE_TTL.HISTORY_CONVERSATION
      ) {
        keysToRemove.push(key);
      }
    }

    if (keysToRemove.length > 0) {
      await remove(keysToRemove);
    }
  } catch (err) {
    console.error('[Storage] Cache prune error:', err);
  }
}

// ============================================
// Settings Operations
// ============================================

const DEFAULT_SETTINGS = {
  previewLength: 70,
  timestampFormat: 'absolute',
  showTimestamps: true,
  theme: 'system',
  compactMode: false
};

/**
 * Load user settings
 * @returns {Promise<Object>} - Settings object
 */
export async function loadSettings() {
  const data = await get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

/**
 * Save user settings
 * @param {Object} settings - Settings to save
 * @returns {Promise<boolean>}
 */
export async function saveSettings(settings) {
  return set(STORAGE_KEYS.SETTINGS, settings);
}

// ============================================
// Pending Branch Operations
// ============================================

/**
 * Get pending branch creation
 * @returns {Promise<Object|null>}
 */
export async function getPendingBranch() {
  return get(STORAGE_KEYS.PENDING_BRANCH);
}

/**
 * Set pending branch creation
 * @param {Object} pendingBranch - { parentId, timestamp }
 * @returns {Promise<boolean>}
 */
export async function setPendingBranch(pendingBranch) {
  return set(STORAGE_KEYS.PENDING_BRANCH, pendingBranch);
}

/**
 * Clear pending branch
 * @returns {Promise<boolean>}
 */
export async function clearPendingBranch() {
  return remove(STORAGE_KEYS.PENDING_BRANCH);
}

// ============================================
// Debug Operations
// ============================================

/**
 * Check if debug mode is enabled
 * @returns {Promise<boolean>}
 */
export async function isDebugEnabled() {
  const data = await get(STORAGE_KEYS.DEBUG_FLAG);
  return Boolean(data);
}

/**
 * Set debug mode
 * @param {boolean} enabled
 * @returns {Promise<boolean>}
 */
export async function setDebugEnabled(enabled) {
  return set(STORAGE_KEYS.DEBUG_FLAG, enabled);
}

export default {
  get,
  set,
  remove,
  loadBranchData,
  saveBranchData,
  recordBranch,
  getCachedConversation,
  setCachedConversation,
  clearConversationCache,
  pruneExpiredCache,
  loadSettings,
  saveSettings,
  getPendingBranch,
  setPendingBranch,
  clearPendingBranch,
  isDebugEnabled,
  setDebugEnabled,
  STORAGE_KEYS,
  CACHE_TTL
};
