/**
 * AI Conversation Index - Background Service Worker
 * Handles cross-tab communication and extension actions
 * Supports ChatGPT, Claude, Gemini, Perplexity
 */

// Helper to check if URL is a supported AI conversation platform
function isChatUrl(url = '') {
  return /https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai)/i.test(
    url
  );
}

// Update side panel availability based on tab URL
// When disabled, the panel automatically closes and won't open on action click
async function updateSidePanelForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const enabled = isChatUrl(tab.url);
    // Must specify path when enabling, otherwise the panel won't work
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'panel.html',
      enabled
    });
  } catch {
    // Tab may have been closed or is restricted (chrome:// pages)
  }
}

// Detect platform from URL
function detectPlatform(url = '') {
  if (/chatgpt\.com|chat\.openai\.com/i.test(url)) return 'chatgpt';
  if (/claude\.ai/i.test(url)) return 'claude';
  if (/gemini\.google\.com/i.test(url)) return 'gemini';
  if (/perplexity\.ai/i.test(url)) return 'perplexity';
  return null;
}

// Open or focus an existing conversation tab
async function openOrFocusConversation(
  conversationId,
  preferredHost = 'chatgpt.com'
) {
  // Support multiple platforms
  const urlPatterns = [
    'https://chatgpt.com/c/*',
    'https://chat.openai.com/c/*',
    'https://claude.ai/chat/*',
    'https://gemini.google.com/app/*',
    'https://www.perplexity.ai/search/*',
    'https://perplexity.ai/search/*'
  ];

  const tabs = await chrome.tabs.query({ url: urlPatterns });

  // Find matching tab by conversation ID
  const match = tabs.find((t) => {
    const url = t.url || '';
    return (
      url.includes(`/${conversationId}`) || url.includes(`=${conversationId}`)
    );
  });

  if (match?.id) {
    await chrome.tabs.update(match.id, { active: true });
    if (match.windowId) {
      await chrome.windows.update(match.windowId, { focused: true });
    }
    return { ok: true, focused: true, tabId: match.id };
  }

  // Create new tab - determine URL based on platform
  const platform = detectPlatform(`https://${preferredHost}`);
  let url;

  switch (platform) {
    case 'claude':
      url = `https://claude.ai/chat/${conversationId}`;
      break;
    case 'gemini':
      url = `https://gemini.google.com/app/${conversationId}`;
      break;
    case 'perplexity':
      url = `https://www.perplexity.ai/search/${conversationId}`;
      break;
    default:
      url = `https://${preferredHost || 'chatgpt.com'}/c/${conversationId}`;
  }

  const created = await chrome.tabs.create({ url });
  return { ok: true, opened: true, tabId: created?.id };
}

// Enable side panel to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set panel behavior:', error));

// Listen for tab activation to update panel availability
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateSidePanelForTab(activeInfo.tabId);
});

// Listen for URL changes to update panel availability
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateSidePanelForTab(tabId);
  }
});

// ============================================
// API Request Monitoring for All Platforms
// ============================================

// Listen for Claude API requests completing to trigger content script refresh
// This helps catch conversation data that may not trigger DOM mutations
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Only process Claude conversation-related API calls
    if (
      details.url.includes('chat_conversations') ||
      details.url.includes('completion') ||
      details.url.includes('messages')
    ) {
      // Notify the content script that new data may be available
      if (details.tabId && details.tabId > 0) {
        chrome.tabs
          .sendMessage(details.tabId, {
            type: 'CLAUDE_API_COMPLETED',
            url: details.url,
            timestamp: Date.now()
          })
          .catch(() => {
            // Ignore errors if content script isn't ready
          });
      }
    }
  },
  {
    urls: ['https://claude.ai/api/*', 'https://api.claude.ai/*']
  }
);

// Listen for Gemini API requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId && details.tabId > 0) {
      chrome.tabs
        .sendMessage(details.tabId, {
          type: 'GEMINI_API_COMPLETED',
          url: details.url,
          timestamp: Date.now()
        })
        .catch(() => {
          // Ignore errors if content script isn't ready
        });
    }
  },
  {
    urls: ['https://gemini.google.com/*', 'https://*.google.com/batchexecute*']
  }
);

// Listen for Perplexity API requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (
      details.url.includes('/api/') &&
      (details.url.includes('search') ||
        details.url.includes('query') ||
        details.url.includes('answer'))
    ) {
      if (details.tabId && details.tabId > 0) {
        chrome.tabs
          .sendMessage(details.tabId, {
            type: 'PERPLEXITY_API_COMPLETED',
            url: details.url,
            timestamp: Date.now()
          })
          .catch(() => {
            // Ignore errors if content script isn't ready
          });
      }
    }
  },
  {
    urls: ['https://www.perplexity.ai/api/*', 'https://perplexity.ai/api/*']
  }
);

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Get active ChatGPT tab info
  if (msg?.type === 'GET_ACTIVE_CHAT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      const tab = tabs?.[0];
      if (!tab) {
        sendResponse({ tab: null });
        return;
      }

      sendResponse({
        tab: {
          id: tab.id,
          url: tab.url || '',
          isChat: isChatUrl(tab.url)
        }
      });
    });
    return true; // Keep channel open for async response
  }

  // Forward tree updates to panel iframe
  if (msg?.type === 'TREE_UPDATED') {
    // Avoid rebroadcast loops
    if (msg.__fromBackground) {
      return false;
    }

    const payload = { ...msg, __fromBackground: true };

    // Broadcast to all extension contexts (panel iframe, etc.)
    chrome.runtime.sendMessage(payload, () => {
      // Swallow errors if no listeners are ready
      if (chrome.runtime.lastError) {
        return;
      }
    });

    // Also notify the originating tab (keeps content + panel in sync)
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, payload, () => {
        if (chrome.runtime.lastError) {
          return;
        }
      });
    }
    return false;
  }

  if (msg?.type === 'OPEN_OR_FOCUS_CONVERSATION') {
    openOrFocusConversation(msg.conversationId, msg.preferredHost)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true; // async
  }

  return false;
});

// Side panel is opened automatically via setPanelBehavior({ openPanelOnActionClick: true })

// Initialize panel state for all existing tabs on startup
chrome.tabs.query({}).then((tabs) => {
  tabs.forEach((tab) => {
    if (tab.id) updateSidePanelForTab(tab.id);
  });
});
