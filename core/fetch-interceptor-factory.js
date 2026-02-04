/**
 * Fetch Interceptor Factory
 * Creates platform-specific fetch interceptors for capturing API responses
 * Used to extract conversation data from Claude, Gemini, and Perplexity
 */

/**
 * Platform interceptor configurations
 */
const INTERCEPTOR_CONFIGS = {
  claude: {
    scriptId: 'claude-fetch-interceptor',
    windowFlag: '__claudeInterceptorInstalled',
    messageType: 'CLAUDE_API_RESPONSE',
    urlMatcher: `url.includes('/api/') && (url.includes('chat_conversations') || url.includes('completion'))`,
    responseParser: `
      const contentType = cloned.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await cloned.json();
        return data;
      }
      return null;
    `
  },
  gemini: {
    scriptId: 'gemini-fetch-interceptor',
    windowFlag: '__geminiInterceptorInstalled',
    messageType: 'GEMINI_API_RESPONSE',
    urlMatcher: `url.includes('batchexecute') || url.includes('/conversation') || url.includes('/generate')`,
    responseParser: `
      const contentType = cloned.headers.get('content-type') || '';
      if (contentType.includes('application/json') || contentType.includes('text/')) {
        let text = await cloned.text();
        // Gemini responses are often wrapped in )]}' prefix
        if (text.startsWith(")]}'")) {
          text = text.slice(4);
        }
        try {
          return JSON.parse(text);
        } catch(e) {
          // If JSON parse fails, return raw text for further processing
          return { rawText: text };
        }
      }
      return null;
    `
  },
  perplexity: {
    scriptId: 'perplexity-fetch-interceptor',
    windowFlag: '__perplexityInterceptorInstalled',
    messageType: 'PERPLEXITY_API_RESPONSE',
    urlMatcher: `url.includes('/api/') && (url.includes('search') || url.includes('query') || url.includes('answer'))`,
    responseParser: `
      const contentType = cloned.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await cloned.json();
        return data;
      }
      return null;
    `
  }
};

/**
 * Generate the script content for a fetch interceptor
 * @param {Object} config - Interceptor configuration
 * @param {string} platformName - Platform name for logging
 * @returns {string} Script content to inject
 */
function generateInterceptorScript(config, platformName) {
  return `
    (function() {
      if (window.${config.windowFlag}) return;
      window.${config.windowFlag} = true;

      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

        // Check if URL matches this platform's API patterns
        if (${config.urlMatcher}) {
          try {
            const cloned = response.clone();
            const parseResponse = async (cloned) => {
              ${config.responseParser}
            };
            const data = await parseResponse(cloned);
            if (data) {
              window.postMessage({
                type: '${config.messageType}',
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
      console.log('[ConversationIndex] ${platformName} fetch interceptor installed');
    })();
  `;
}

/**
 * Inject a fetch interceptor for the specified platform
 * @param {string} platformId - Platform identifier ('claude', 'gemini', 'perplexity')
 * @returns {boolean} True if injected, false if already exists or invalid platform
 */
export function injectFetchInterceptor(platformId) {
  const config = INTERCEPTOR_CONFIGS[platformId];
  if (!config) {
    console.warn(`[FetchInterceptor] Unknown platform: ${platformId}`);
    return false;
  }

  // Check if already injected
  if (document.getElementById(config.scriptId)) {
    return false;
  }

  const platformName = platformId.charAt(0).toUpperCase() + platformId.slice(1);
  const script = document.createElement('script');
  script.id = config.scriptId;
  script.textContent = generateInterceptorScript(config, platformName);
  document.documentElement.appendChild(script);
  script.remove();

  return true;
}

/**
 * Get the message type for a platform's API responses
 * @param {string} platformId - Platform identifier
 * @returns {string|null} Message type or null if invalid platform
 */
export function getInterceptorMessageType(platformId) {
  return INTERCEPTOR_CONFIGS[platformId]?.messageType || null;
}

/**
 * Check if an interceptor is already injected for a platform
 * @param {string} platformId - Platform identifier
 * @returns {boolean} True if already injected
 */
export function isInterceptorInjected(platformId) {
  const config = INTERCEPTOR_CONFIGS[platformId];
  if (!config) return false;
  return document.getElementById(config.scriptId) !== null;
}

export default {
  injectFetchInterceptor,
  getInterceptorMessageType,
  isInterceptorInjected
};
