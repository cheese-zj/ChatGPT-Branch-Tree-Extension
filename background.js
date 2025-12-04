/**
 * ChatGPT Branch Tree - Background Service Worker
 * Handles cross-tab communication and extension actions
 */

// Helper to check if URL is a ChatGPT conversation
function isChatUrl(url = "") {
  return /https:\/\/(chatgpt\.com|chat\.openai\.com)/i.test(url);
}

// Open or focus an existing conversation tab
async function openOrFocusConversation(conversationId, preferredHost = "chatgpt.com") {
  const urlPatterns = [
    "https://chatgpt.com/c/*",
    "https://chat.openai.com/c/*",
  ];

  const tabs = await chrome.tabs.query({ url: urlPatterns });
  const match = tabs.find(t => (t.url || "").includes(`/c/${conversationId}`));
  if (match?.id) {
    await chrome.tabs.update(match.id, { active: true });
    if (match.windowId) {
      await chrome.windows.update(match.windowId, { focused: true });
    }
    return { ok: true, focused: true, tabId: match.id };
  }

  const host = preferredHost || "chatgpt.com";
  const url = `https://${host}/c/${conversationId}`;
  const created = await chrome.tabs.create({ url });
  return { ok: true, opened: true, tabId: created?.id };
}

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Get active ChatGPT tab info
  if (msg?.type === "GET_ACTIVE_CHAT_TAB") {
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
          url: tab.url || "",
          isChat: isChatUrl(tab.url),
        },
      });
    });
    return true; // Keep channel open for async response
  }

  // Forward tree updates to panel iframe
  if (msg?.type === "TREE_UPDATED") {
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

  if (msg?.type === "OPEN_OR_FOCUS_CONVERSATION") {
    openOrFocusConversation(msg.conversationId, msg.preferredHost)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true; // async
  }

  return false;
});

// Extension icon click - toggle panel via content script
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !isChatUrl(tab.url)) return;
  
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" }).catch(() => {
    // Content script might not be loaded yet, inject it
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => {});
  });
});
