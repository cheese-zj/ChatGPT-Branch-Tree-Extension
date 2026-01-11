/**
 * Platform Registry - Central hub for platform adapters
 * Routes requests to the appropriate adapter based on URL
 */

// Import adapters (will be populated as we create them)
// import { ChatGPTAdapter } from '../platforms/chatgpt/adapter.js';
// import { ClaudeAdapter } from '../platforms/claude/adapter.js';
// import { GeminiAdapter } from '../platforms/gemini/adapter.js';
// import { PerplexityAdapter } from '../platforms/perplexity/adapter.js';

const registeredAdapters = [];

/**
 * Register a platform adapter
 * @param {Object} adapter - Platform adapter instance
 */
export function registerAdapter(adapter) {
  if (!adapter || !adapter.platformId) {
    console.error('[PlatformRegistry] Invalid adapter:', adapter);
    return;
  }

  // Avoid duplicate registration
  const existing = registeredAdapters.find(
    (a) => a.platformId === adapter.platformId
  );
  if (existing) {
    console.warn(
      `[PlatformRegistry] Adapter ${adapter.platformId} already registered`
    );
    return;
  }

  registeredAdapters.push(adapter);
  console.log(`[PlatformRegistry] Registered adapter: ${adapter.platformId}`);
}

/**
 * Get the adapter that matches the given URL
 * @param {string} url - URL to match
 * @returns {Object|null} - Matching adapter or null
 */
export function getAdapterForUrl(url) {
  if (!url) return null;

  for (const adapter of registeredAdapters) {
    if (adapter.matchUrl(url)) {
      return adapter;
    }
  }

  return null;
}

/**
 * Get adapter by platform ID
 * @param {string} platformId - Platform identifier
 * @returns {Object|null} - Adapter or null
 */
export function getAdapterById(platformId) {
  return registeredAdapters.find((a) => a.platformId === platformId) || null;
}

/**
 * Get all registered adapters
 * @returns {Object[]} - Array of adapters
 */
export function getAllAdapters() {
  return [...registeredAdapters];
}

/**
 * Get current active adapter based on window location
 * @returns {Object|null} - Active adapter or null
 */
export function getCurrentAdapter() {
  if (typeof window === 'undefined') return null;
  return getAdapterForUrl(window.location.href);
}

/**
 * Platform configuration for URL matching
 */
export const PLATFORM_CONFIGS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    urlPatterns: [
      /^https:\/\/(www\.)?chatgpt\.com/,
      /^https:\/\/(www\.)?chat\.openai\.com/
    ],
    color: '#10a37f'
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    urlPatterns: [/^https:\/\/(www\.)?claude\.ai/],
    color: '#cc785c'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    urlPatterns: [/^https:\/\/(www\.)?gemini\.google\.com/],
    color: '#4285f4'
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    urlPatterns: [/^https:\/\/(www\.)?perplexity\.ai/],
    color: '#20808d'
  }
};

/**
 * Check if URL matches a specific platform
 * @param {string} url - URL to check
 * @param {string} platformId - Platform to match
 * @returns {boolean}
 */
export function urlMatchesPlatform(url, platformId) {
  const config = PLATFORM_CONFIGS[platformId];
  if (!config) return false;

  return config.urlPatterns.some((pattern) => pattern.test(url));
}

/**
 * Get platform config by URL
 * @param {string} url - URL to check
 * @returns {Object|null} - Platform config or null
 */
export function getPlatformConfigForUrl(url) {
  for (const [_id, config] of Object.entries(PLATFORM_CONFIGS)) {
    if (config.urlPatterns.some((pattern) => pattern.test(url))) {
      return config;
    }
  }
  return null;
}

export default {
  registerAdapter,
  getAdapterForUrl,
  getAdapterById,
  getAllAdapters,
  getCurrentAdapter,
  PLATFORM_CONFIGS,
  urlMatchesPlatform,
  getPlatformConfigForUrl
};
