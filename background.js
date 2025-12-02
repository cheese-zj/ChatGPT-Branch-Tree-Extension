/**
 * ChatGPT Branch Tree - Background Service Worker
 * Handles cross-tab communication and extension actions
 */

// Helper to check if URL is a ChatGPT conversation
function isChatUrl(url = "") {
  return /https:\/\/(chatgpt\.com|chat\.openai\.com)/i.test(url);
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
    // Broadcast to all frames (including the panel iframe)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    });
    return false;
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
