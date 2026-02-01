/**
 * AI Conversation Index - Panel Script
 * Renders the conversation tree in the side panel
 * Supports ChatGPT, Claude, Gemini, Perplexity
 */

const statusEl = document.getElementById('status');
const statusDot = document.getElementById('status-dot');
const treeRoot = document.getElementById('tree-root');
const refreshBtn = document.getElementById('refresh');
const clearDataBtn = document.getElementById('clear-data');
const exportMdBtn = document.getElementById('export-markdown');
const tooltip = document.getElementById('tooltip');
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const infoBtn = document.getElementById('info-btn');
const infoOverlay = document.getElementById('info-overlay');
const infoClose = document.getElementById('info-close');
const platformIndicator = document.getElementById('platform-indicator');
const exportMdBtnIdleMarkup = exportMdBtn?.innerHTML || '';

// Settings elements
const settingTheme = document.getElementById('setting-theme');
const settingCompact = document.getElementById('setting-compact');
const settingTimestamps = document.getElementById('setting-timestamps');
const settingPreviewLength = document.getElementById('setting-preview-length');
const previewLengthValue = document.getElementById('preview-length-value');
const segmentedBtns = document.querySelectorAll('.segmented-btn');

let activeTabId = null;
let activeTabInfo = null;
let refreshDebounceTimer = null;
let lastStatusState = null;
let isRefreshing = false;
let lastRenderSignature = null;
let currentConversationId = null;
let currentSearchQuery = '';

// Platform configurations
const PLATFORM_CONFIG = {
  chatgpt: { name: 'ChatGPT', color: '#10a37f' },
  claude: { name: 'Claude', color: '#cc785c' },
  gemini: { name: 'Gemini', color: '#4285f4' },
  perplexity: { name: 'Perplexity', color: '#20808d' }
};

/**
 * Update platform indicator in the UI
 */
function updatePlatformIndicator(platform) {
  if (!platformIndicator) return;

  if (!platform || !PLATFORM_CONFIG[platform]) {
    platformIndicator.style.display = 'none';
    return;
  }

  const config = PLATFORM_CONFIG[platform];
  platformIndicator.style.display = 'flex';
  platformIndicator.innerHTML = `<span class="platform-name">${config.name}</span>`;
  platformIndicator.style.setProperty('--platform-color', config.color);
}

async function runtimeSendMessageSafe(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (err) {
      resolve({ error: err?.message || String(err) });
    }
  });
}

async function tabsSendMessageSafe(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (err) {
      resolve({ error: err?.message || String(err) });
    }
  });
}

// ============================================
// Settings
// ============================================

const SETTINGS_KEY = 'branchTreeSettings';

const DEFAULT_SETTINGS = {
  previewLength: 70,
  timestampFormat: 'absolute', // "absolute" | "relative"
  showTimestamps: true,
  theme: 'system', // "system" | "dark" | "light"
  compactMode: false
};

// Current settings (loaded on init)
let currentSettings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    currentSettings = { ...DEFAULT_SETTINGS, ...(data?.[SETTINGS_KEY] || {}) };
  } catch {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  applySettings();
  updateSettingsUI();
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function applySettings() {
  // Apply theme
  document.body.classList.remove('theme-dark', 'theme-light');
  if (currentSettings.theme === 'dark') {
    document.body.classList.add('theme-dark');
  } else if (currentSettings.theme === 'light') {
    document.body.classList.add('theme-light');
  }

  // Apply compact mode
  document.body.classList.toggle('compact-mode', currentSettings.compactMode);
}

function updateSettingsUI() {
  // Theme dropdown
  if (settingTheme) {
    settingTheme.value = currentSettings.theme;
  }

  // Compact mode toggle
  if (settingCompact) {
    settingCompact.checked = currentSettings.compactMode;
  }

  // Show timestamps toggle
  if (settingTimestamps) {
    settingTimestamps.checked = currentSettings.showTimestamps;
  }

  // Timestamp format segmented control
  segmentedBtns.forEach((btn) => {
    btn.classList.toggle(
      'active',
      btn.dataset.value === currentSettings.timestampFormat
    );
  });

  // Preview length slider
  if (settingPreviewLength) {
    settingPreviewLength.value = currentSettings.previewLength;
  }
  if (previewLengthValue) {
    previewLengthValue.textContent = currentSettings.previewLength;
  }
}

function setupSettingsListeners() {
  // Theme change
  if (settingTheme) {
    settingTheme.addEventListener('change', () => {
      currentSettings.theme = settingTheme.value;
      applySettings();
      saveSettings();
    });
  }

  // Compact mode toggle
  if (settingCompact) {
    settingCompact.addEventListener('change', () => {
      currentSettings.compactMode = settingCompact.checked;
      applySettings();
      saveSettings();
    });
  }

  // Show timestamps toggle
  if (settingTimestamps) {
    settingTimestamps.addEventListener('change', () => {
      currentSettings.showTimestamps = settingTimestamps.checked;
      saveSettings();
      refresh(); // Re-render tree with new setting
    });
  }

  // Timestamp format segmented control
  segmentedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      segmentedBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSettings.timestampFormat = btn.dataset.value;
      saveSettings();
      refresh(); // Re-render tree with new format
    });
  });

  // Preview length slider
  if (settingPreviewLength) {
    settingPreviewLength.addEventListener('input', () => {
      const value = parseInt(settingPreviewLength.value, 10);
      currentSettings.previewLength = value;
      if (previewLengthValue) {
        previewLengthValue.textContent = value;
      }
    });

    // Save on change (when user releases slider)
    settingPreviewLength.addEventListener('change', () => {
      saveSettings();
      refresh(); // Re-render tree with new length
    });
  }
}

// Store node data for event delegation (avoids closure memory leaks)
const nodeDataMap = new Map();

// Track if global listeners are already registered (prevent duplicates)
let globalListenersRegistered = false;

// ============================================
// Color Palette
// ============================================

// Colors for main chain (depth-based)
const DEPTH_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7' // purple
];

// Extended color palette for branches - distinct, vibrant colors
// Each branch gets a deterministic color based on conversation ID hash
const BRANCH_COLORS = [
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#ef4444', // red
  '#f97316', // orange
  '#14b8a6', // teal
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#d946ef', // fuchsia
  '#22c55e', // green
  '#eab308', // yellow
  '#a855f7', // purple
  '#0ea5e9', // sky
  '#f43f5e' // rose
];

const ICON_SVGS = {
  branch:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"></path><path d="M6 9v6"></path><path d="M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"></path><path d="M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"></path><path d="M18 9c0 4-6 4-6 9"></path></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7h.01"></path></svg>'
};

function getColor(depth) {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length];
}

/**
 * Check if the main line continues after a branch at a given index
 * This looks for non-branch nodes that would be on the main line (same depth, no colorIndex)
 */
function findMainLineContinuation(allNodes, branchIndex, branchDepth) {
  for (let i = branchIndex + 1; i < allNodes.length; i++) {
    const node = allNodes[i];
    // Skip expanded branch children (they have colorIndex)
    if (node.colorIndex !== undefined) continue;
    // If we find a non-branch node at the same or lower depth without colorIndex, main continues
    if (node.type !== 'branch' && (node.depth ?? 0) <= branchDepth) {
      return true;
    }
    // If we find another branch at same level, main still continues through it
    if (node.type === 'branch' && (node.depth ?? 0) === branchDepth) {
      continue;
    }
  }
  return false;
}

/**
 * Mark terminal nodes in the node array
 * A terminal node is one that has no subsequent nodes in its visual chain
 */
function markTerminalNodes(nodes) {
  // A node is terminal if:
  // 1. It's the last node, OR
  // 2. The next node is a branch (branches start new chains), OR
  // 3. The next node has a different colorIndex (different branch context)

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextNode = nodes[i + 1];

    // Edit branches are always terminal (standalone nodes)
    if (node.type === 'editBranch') {
      node.isTerminal = true;
      continue;
    }

    // Branches have their own terminal logic
    if (node.type === 'branch') {
      // A branch is terminal if there are no more same-context nodes after it
      // AND it's not expanded (expanded branches connect to their children)
      if (node.expanded) {
        // Expanded branches connect to their children, not terminal
        node.isTerminal = false;
      } else {
        // Non-expanded branches: check if main line continues after
        let mainContinues = false;
        for (let j = i + 1; j < nodes.length; j++) {
          const futureNode = nodes[j];
          // Skip other branches at this level
          if (futureNode.type === 'branch') continue;
          // Skip nodes inside branches (they have colorIndex)
          if (futureNode.colorIndex !== undefined) continue;
          // Found a main-line node after this branch
          mainContinues = true;
          break;
        }
        node.isTerminal = !mainContinues;
      }
      continue;
    }

    // Last node is always terminal
    if (!nextNode) {
      node.isTerminal = true;
      continue;
    }

    // If next node is a branch, check if there's a same-context continuation after it
    if (nextNode.type === 'branch') {
      let sameContextContinues = false;
      for (let j = i + 1; j < nodes.length; j++) {
        const futureNode = nodes[j];
        if (futureNode.type === 'branch') continue;
        // Check if this future node has the same context
        const sameContext =
          node.colorIndex === futureNode.colorIndex ||
          (node.colorIndex === undefined &&
            futureNode.colorIndex === undefined);
        if (sameContext) {
          sameContextContinues = true;
          break;
        }
        // If we hit a node with different context, stop looking
        if (futureNode.colorIndex !== node.colorIndex) break;
      }
      node.isTerminal = !sameContextContinues;
      continue;
    }

    // If next node has different colorIndex, this is terminal for its chain
    const sameContext =
      node.colorIndex === nextNode.colorIndex ||
      (node.colorIndex === undefined && nextNode.colorIndex === undefined);

    node.isTerminal = !sameContext;
  }

  return nodes;
}

/**
 * Annotate nodes with whether there is a previous/next straight-line node
 * of the same depth and context (colorIndex). This lets connectors know
 * when to draw up/down stubs even if intervening nodes are at other depths.
 */
function annotateContextContinuations(nodes) {
  const makeKey = (node) => `${node.depth ?? 0}|${node.colorIndex ?? 'main'}`;
  const shouldTrack = (node) => node.type !== 'branch';

  const seen = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!shouldTrack(node)) continue;
    const key = makeKey(node);
    node.hasPrevContext = seen.has(key);
    seen.add(key);
  }

  const seenFromEnd = new Set();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!shouldTrack(node)) continue;
    const key = makeKey(node);
    node.hasNextContext = seenFromEnd.has(key);
    seenFromEnd.add(key);
  }

  return nodes;
}

/**
 * Get a deterministic color for a branch based on its colorIndex
 * colorIndex is derived from a hash of the conversation ID
 */
function getBranchColor(colorIndex) {
  if (colorIndex === undefined || colorIndex === null) return BRANCH_COLORS[0];
  return BRANCH_COLORS[Math.abs(colorIndex) % BRANCH_COLORS.length];
}

// ============================================
// Utilities
// ============================================

function truncate(text, max = null) {
  if (!text) return '';
  const limit = max ?? currentSettings.previewLength ?? 70;
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length <= limit ? clean : clean.slice(0, limit - 1) + '…';
}

/**
 * Generate a stable signature for a render payload so we can skip
 * re-rendering when nothing changed.
 */
function computeRenderSignature(nodes, title, hasAncestry) {
  try {
    return JSON.stringify({
      conversationId: currentConversationId || null,
      title: title || '',
      hasAncestry: !!hasAncestry,
      settings: {
        previewLength: currentSettings.previewLength,
        timestampFormat: currentSettings.timestampFormat,
        showTimestamps: currentSettings.showTimestamps
      },
      nodes: Array.isArray(nodes) ? JSON.parse(JSON.stringify(nodes)) : []
    });
  } catch {
    // Fallback to force render if we can't serialize for any reason
    return Math.random().toString(36);
  }
}

/**
 * Format a relative time string (e.g., "2h ago", "3d ago")
 */
function formatRelativeTime(ms) {
  const now = Date.now();
  const diff = now - ms;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function formatTimestamp(ts) {
  if (!ts || ts <= 0) return '';
  if (!currentSettings.showTimestamps) return '';

  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);

  if (currentSettings.timestampFormat === 'relative') {
    return formatRelativeTime(ms);
  }

  // Absolute format
  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${time} · ${day}`;
}

let statusResetTimer = null;
let statusResetGeneration = 0; // Guard against stale timer callbacks

function setStatus(text, state = 'ready') {
  // Skip if same state (avoid flicker)
  if (lastStatusState === state && state !== 'loading') {
    return;
  }

  clearTimeout(statusResetTimer);
  statusResetTimer = null;
  statusResetGeneration++;
  const currentGeneration = statusResetGeneration;

  lastStatusState = state;
  statusEl.textContent = text;
  statusDot.classList.remove('loading', 'success');

  if (state === 'loading') {
    statusDot.classList.add('loading');
  } else if (state === 'success') {
    statusDot.classList.add('success');
    // Reset to ready after 1.5 seconds (with guard)
    statusResetTimer = setTimeout(() => {
      // Guard: only execute if this is still the current timer
      if (currentGeneration === statusResetGeneration) {
        statusDot.classList.remove('success');
        lastStatusState = 'ready';
      }
    }, 1500);
  }
}

function isChatUrl(url = '') {
  // Support all platforms: ChatGPT, Claude, Gemini, Perplexity
  return /https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai)/i.test(
    url
  );
}

/**
 * Detect platform from URL
 */
function detectPlatformFromUrl(url = '') {
  if (/chatgpt\.com|chat\.openai\.com/i.test(url)) return 'chatgpt';
  if (/claude\.ai/i.test(url)) return 'claude';
  if (/gemini\.google\.com/i.test(url)) return 'gemini';
  if (/perplexity\.ai/i.test(url)) return 'perplexity';
  return null;
}

// ============================================
// Tab Management
// ============================================

async function getActiveTab() {
  const response = await runtimeSendMessageSafe({
    type: 'GET_ACTIVE_CHAT_TAB'
  });
  if (response?.error) return null;
  const tab = response?.tab;
  if (tab?.id) activeTabId = tab.id;
  if (tab) activeTabInfo = tab;
  return tab;
}

// ============================================
// Tree Rendering
// ============================================

function createNodeElement(node, index, total, prevNode, nextNode, allNodes) {
  const {
    id,
    type,
    text,
    depth,
    targetConversationId,
    createTime,
    colorIndex,
    branchIndex,
    expanded,
    isCurrent,
    isCurrentPath,
    isViewing,
    branchPath,
    isTerminal,
    hasPrevContext,
    hasNextContext,
    isMainViewing,
    // Edit version fields
    hasEditVersions,
    editVersionIndex,
    totalVersions,
    siblingIds,
    // Edit branch fields
    branchNodeId,
    editVersionLabel,
    descendantCount,
    // Icon and label fields
    icon,
    branchLabel
  } = node;

  // Helper to fetch the rendered row element for a node (by id) if already in DOM
  function prevNodeRow(n) {
    if (!n) return null;
    return treeRoot.querySelector(`[data-node-id="${n.id}"]`);
  }

  const row = document.createElement('div');
  row.className = 'tree-node';
  row.dataset.nodeId = id;
  row.dataset.depth = depth ?? 0;
  row.tabIndex = 0;
  // Staggered animation delay (max 15 nodes, 30ms each)
  row.style.animationDelay = `${Math.min(index, 15) * 30}ms`;

  const isBranch = type === 'branch';
  const isEditBranch = type === 'editBranch';
  const isBranchRoot = type === 'branchRoot';
  const isPreBranchIndicator = type === 'preBranchIndicator';
  const isTitle =
    type === 'title' || type === 'ancestor-title' || type === 'current-title';
  const isAncestorTitle = type === 'ancestor-title';
  const isCurrentTitle = type === 'current-title';
  const isViewingBranch = isBranch && isViewing;
  const isMainViewingTitle = isTitle && isMainViewing;
  const isExpanded = expanded === true;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const hasBranchLabel = isBranch || isBranchRoot || isEditBranch;
  const isMessageCard = !isTitle && !hasBranchLabel && !isPreBranchIndicator;
  const showMainViewingTag = isMainViewingTitle;

  if (isBranch) row.classList.add('is-branch');
  if (isEditBranch) row.classList.add('is-edit-branch');
  if (isBranchRoot) row.classList.add('is-branch-root');
  if (isPreBranchIndicator) row.classList.add('is-pre-branch-indicator');
  if (isTitle) row.classList.add('is-title');
  if (isAncestorTitle) row.classList.add('is-ancestor-title');
  if (isCurrentTitle) row.classList.add('is-current-title');
  if (isExpanded) row.classList.add('is-expanded');
  if (isCurrent) row.classList.add('is-current');
  if (isCurrentPath) row.classList.add('is-current-path');
  if (isViewingBranch) row.classList.add('is-viewing');
  if (isMainViewingTitle) row.classList.add('is-main-viewing');
  if (isLast) row.classList.add('is-last-node');
  if (isTerminal) row.classList.add('is-terminal');

  // Determine color: branches use their deterministic color based on conversation ID
  // Non-branch messages in a branch also use their inherited colorIndex
  const hasColorIndex = colorIndex !== undefined && colorIndex !== null;
  const color =
    isBranch || hasColorIndex
      ? getBranchColor(colorIndex ?? 0)
      : getColor(depth ?? 0);

  // Set color CSS variables on the row for child elements to use
  row.style.setProperty('--color', color);
  if (isBranch || hasColorIndex) {
    row.style.setProperty('--branch-color', color);
  }
  row.dataset.color = color;

  // Check what's around us - for T-junction logic
  const nextIsBranch = nextNode?.type === 'branch';
  const prevIsBranch = prevNode?.type === 'branch';
  const prevBranchContinues = prevIsBranch
    ? findMainLineContinuation(allNodes, index - 1, prevNode.depth ?? 0)
    : false;

  // Determine if this node should connect to the next node
  // A node connects below if:
  // 1. It's not terminal (last in its chain)
  // 2. The next node exists and is NOT a branch (branches connect via T-junction)
  // 3. The next node has the same colorIndex (same branch context)
  const nextHasSameContext =
    nextNode &&
    !nextIsBranch &&
    (colorIndex === nextNode.colorIndex ||
      (colorIndex === undefined && nextNode.colorIndex === undefined));

  // Show line above: not first, and not a branch (branches use T-junction)
  // Connect from:
  // 1. Previous node with same context (same colorIndex)
  // 2. Title nodes (start of main chain)
  // 3. Expanded branches (they show line down to children)
  const prevHasSameContext =
    prevNode &&
    prevNode.type !== 'branch' &&
    (colorIndex === prevNode.colorIndex ||
      (colorIndex === undefined && prevNode.colorIndex === undefined));

  // Check if previous is an expanded branch with same colorIndex (we're its first child)
  const prevIsExpandedBranch =
    prevNode?.type === 'branch' &&
    prevNode.expanded === true &&
    prevNode.colorIndex === colorIndex;

  const showAbove =
    !isFirst &&
    !isBranch &&
    (prevHasSameContext ||
      hasPrevContext ||
      prevIsExpandedBranch ||
      prevBranchContinues ||
      prevNode?.type === 'title' ||
      prevNode?.type === 'ancestor-title' ||
      prevNode?.type === 'current-title');

  // Show line below: has next node in same context that isn't a branch
  // Terminal nodes never show line below
  const showBelow = !isTerminal && (nextHasSameContext || hasNextContext);

  // Rail (visual connector)
  const rail = document.createElement('div');
  rail.className = 'rail';
  rail.style.setProperty('--depth', depth ?? 0);
  rail.style.setProperty('--color', color);

  // Vertical lines for depth indentation (colored per level)
  for (let i = 0; i < (depth ?? 0); i++) {
    const line = document.createElement('span');
    line.className = 'rail-line';
    line.style.setProperty('--line-color', getColor(i));
    rail.appendChild(line);
  }

  // Current node connector
  const connector = document.createElement('span');
  connector.className = 'rail-connector';

  // For branches, show T-junction from main line
  if (isBranch) {
    connector.classList.add('branch-connector');
    // Expanded branches show line continuing down into children
    if (isExpanded) {
      connector.classList.add('branch-expanded');
    }
    // Check if main line continues below (there's a non-branch node after this)
    // Look ahead to find if there's another non-branch node at the same level (main continuation)
    const mainContinues = findMainLineContinuation(allNodes, index, depth ?? 0);
    if (mainContinues) {
      connector.classList.add('main-continues');
    }
    // Set the main line color for the T-junction
    // Use the parent/main-line color for the T junction; prefer previous non-branch color if available
    let prevColor = null;
    if (prevNode && prevNode.type !== 'branch') {
      const prevEl = prevNodeRow(prevNode);
      if (prevEl) {
        prevColor =
          getComputedStyle(prevEl).getPropertyValue('--color')?.trim() || null;
      }
    }
    const mainColor = prevColor || getColor(depth ?? 0);
    connector.style.setProperty('--main-color', mainColor);
  } else {
    if (showAbove) connector.classList.add('has-above');
    if (showBelow) connector.classList.add('has-below');
  }

  const dot = document.createElement('span');
  dot.className = 'rail-dot';
  if (isBranch) {
    dot.classList.add('branch-dot');
    dot.style.setProperty('--branch-color', color);
    if (isExpanded) dot.classList.add('expanded-dot');
  }
  if (isBranchRoot) dot.classList.add('branch-root-dot');
  if (isTitle) dot.classList.add('title-dot');
  if (isCurrentTitle) dot.classList.add('current-title-dot');
  connector.appendChild(dot);
  rail.appendChild(connector);

  row.appendChild(rail);

  // Card content
  const card = document.createElement('div');
  card.className = 'tree-card';
  if (isTitle) card.classList.add('title-card');
  if (isAncestorTitle) card.classList.add('ancestor-card');
  if (isCurrentTitle) card.classList.add('current-card');
  if (isExpanded) card.classList.add('expanded-card');
  if (isMessageCard) card.classList.add('message-card');
  if (isPreBranchIndicator) card.classList.add('pre-branch-indicator-card');

  // For pre-branch indicator, show an info banner
  if (isPreBranchIndicator) {
    const indicatorBanner = document.createElement('div');
    indicatorBanner.className = 'pre-branch-banner';
    const infoIcon = document.createElement('span');
    infoIcon.className = 'pre-branch-icon';
    if (ICON_SVGS.info) {
      infoIcon.innerHTML = ICON_SVGS.info;
      infoIcon.setAttribute('aria-hidden', 'true');
    }
    const infoText = document.createElement('span');
    infoText.className = 'pre-branch-text';
    infoText.textContent = text;
    indicatorBanner.appendChild(infoIcon);
    indicatorBanner.appendChild(infoText);
    card.appendChild(indicatorBanner);
  } else if (isTitle) {
    if (isAncestorTitle) {
      const ancestorLabel = document.createElement('div');
      ancestorLabel.className = 'card-ancestor-label';
      ancestorLabel.textContent = 'Ancestor';
      card.appendChild(ancestorLabel);
    } else if (isCurrentTitle) {
      const currentLabel = document.createElement('div');
      currentLabel.className = 'card-current-label';
      currentLabel.textContent = 'Viewing';
      card.appendChild(currentLabel);
    } else {
      if (showMainViewingTag) {
        const titleHeader = document.createElement('div');
        titleHeader.className = 'card-header main-title-header';
        const combinedTag = document.createElement('span');
        combinedTag.className =
          'card-label label-main-viewing title-viewing-tag';
        combinedTag.textContent = 'Main · Viewing';
        titleHeader.appendChild(combinedTag);
        card.appendChild(titleHeader);
      } else {
        // Root/main title node
        const mainLabel = document.createElement('div');
        mainLabel.className = 'card-main-label';
        mainLabel.textContent = 'Main';
        card.appendChild(mainLabel);
      }
    }
    const titleText = document.createElement('div');
    titleText.className = 'card-title-text';
    titleText.textContent = truncate(text, 55);
    card.appendChild(titleText);
  } else {
    // Compact header: label + timestamp + edit versions inline
    const timestamp = formatTimestamp(createTime);
    const hasTimestamp = Boolean(timestamp);
    const hasVersions = hasEditVersions && totalVersions > 1;
    const needsHeader = hasBranchLabel || hasTimestamp || hasVersions;

    if (needsHeader) {
      const header = document.createElement('div');
      header.className = 'card-header';
      if (isMessageCard) header.classList.add('message-header');

      // Only show labels for branches, editBranches, and branchRoots
      if (type === 'branch' || type === 'branchRoot' || type === 'editBranch') {
        const label = document.createElement('span');
        label.className = 'card-label';

        // Add icon if specified
        if (icon) {
          const iconEl = document.createElement('span');
          iconEl.className = 'card-icon';
          if (ICON_SVGS[icon]) {
            iconEl.innerHTML = ICON_SVGS[icon];
            iconEl.setAttribute('aria-hidden', 'true');
          }
          label.appendChild(iconEl);
        }

        const labelText = document.createElement('span');
        labelText.className = 'card-label-text';

        if (type === 'editBranch') {
          labelText.textContent = editVersionLabel || 'Edit';
          label.classList.add('label-edit-branch');
          label.appendChild(labelText);
          if (descendantCount > 0) {
            const countBadge = document.createElement('span');
            countBadge.className = 'card-descendant-count';
            countBadge.textContent = `${descendantCount} msg${descendantCount !== 1 ? 's' : ''}`;
            header.appendChild(label);
            header.appendChild(countBadge);
          } else {
            header.appendChild(label);
          }
        } else if (type === 'branch') {
          const pathLabel = branchPath || `${(branchIndex ?? 0) + 1}`;
          if (isViewing) {
            labelText.textContent = branchLabel || 'Viewing';
            label.classList.add('label-viewing');
          } else if (isExpanded) {
            labelText.textContent = branchLabel || `Branch ${pathLabel}`;
            label.classList.add('label-expanded');
          } else {
            labelText.textContent = branchLabel || `Branch ${pathLabel}`;
          }
          label.classList.add('label-branch');
          label.appendChild(labelText);
          header.appendChild(label);
        } else {
          labelText.textContent = 'From';
          label.classList.add('label-branch-root');
          label.appendChild(labelText);
          header.appendChild(label);
        }
      }

      // Edit version controls (v1/3 + arrows)
      if (hasVersions && isMessageCard) {
        const versionControl = document.createElement('span');
        versionControl.className = 'card-version-control';
        versionControl.title = `Version ${editVersionIndex} of ${totalVersions} (edited message)`;

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'version-arrow version-prev';
        prevBtn.setAttribute('aria-label', 'Previous version');
        prevBtn.dataset.direction = '-1';

        const label = document.createElement('span');
        label.className = 'version-label';
        label.textContent = `v${editVersionIndex}/${totalVersions}`;

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'version-arrow version-next';
        nextBtn.setAttribute('aria-label', 'Next version');
        nextBtn.dataset.direction = '1';

        const atStart = editVersionIndex <= 1;
        const atEnd = editVersionIndex >= totalVersions;
        if (atStart) {
          prevBtn.classList.add('is-disabled');
          prevBtn.setAttribute('aria-disabled', 'true');
        }
        if (atEnd) {
          nextBtn.classList.add('is-disabled');
          nextBtn.setAttribute('aria-disabled', 'true');
        }

        if (siblingIds) {
          versionControl.dataset.siblingIds = JSON.stringify(siblingIds);
        }

        versionControl.appendChild(prevBtn);
        versionControl.appendChild(label);
        versionControl.appendChild(nextBtn);
        header.appendChild(versionControl);
      }

      // Timestamp on the right
      if (hasTimestamp) {
        const timeEl = document.createElement('span');
        timeEl.className = 'card-time';
        if (isMessageCard) timeEl.classList.add('card-time-compact');
        timeEl.textContent = timestamp;
        header.appendChild(timeEl);
      }

      card.appendChild(header);
    }

    // Text preview - only show if there's actual content
    // Don't show preview for viewing branch (first message will appear below)
    const trimmedText = truncate(text);
    if (trimmedText && !isViewing) {
      const preview = document.createElement('div');
      preview.className = 'card-preview';
      if (isMessageCard) preview.classList.add('message-preview');
      preview.textContent = trimmedText;
      card.appendChild(preview);
    }

    // For viewing branch, show branch number on its own line for clarity
    if (type === 'branch' && isViewing) {
      const pathLabel = branchPath || `${(branchIndex ?? 0) + 1}`;
      const branchLine = document.createElement('div');
      branchLine.className = 'branch-path-line';
      branchLine.textContent = `Branch ${pathLabel}`;
      card.appendChild(branchLine);
    }
  }

  row.appendChild(card);

  // Store full text for tooltip (in dataset for event delegation)
  row.dataset.fullText = text || '';
  row.dataset.type = type || 'message';
  row.dataset.targetConv = targetConversationId || '';

  // Store node data in Map for event delegation (avoids closure memory leaks)
  nodeDataMap.set(id, {
    id,
    type,
    targetConversationId,
    hasEditVersions,
    editVersionIndex,
    totalVersions,
    siblingIds,
    branchNodeId
  });

  return row;
}

const NO_CONVERSATION_STEPS = [
  'Open a conversation in ChatGPT, Claude, Gemini, or Perplexity.',
  'Messages will be indexed automatically for quick navigation.',
  'Return here and press Refresh to see the message index.'
];

function renderGuidanceState({
  badge = 'Waiting for a conversation',
  title = 'Open a conversation in ChatGPT, Claude, Gemini, or Perplexity',
  description = '',
  steps = [],
  hint = 'After you open a chat, press Refresh to retry.'
} = {}) {
  nodeDataMap.clear();
  lastRenderSignature = null;
  treeRoot.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'empty-guidance';

  if (badge) {
    const badgeEl = document.createElement('div');
    badgeEl.className = 'empty-guidance-badge';
    badgeEl.textContent = badge;
    container.appendChild(badgeEl);
  }

  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'empty-guidance-title';
    titleEl.textContent = title;
    container.appendChild(titleEl);
  }

  if (description) {
    const descEl = document.createElement('div');
    descEl.className = 'empty-guidance-desc';
    descEl.textContent = description;
    container.appendChild(descEl);
  }

  if (steps?.length) {
    const list = document.createElement('ol');
    list.className = 'empty-guidance-steps';
    steps.forEach((step, idx) => {
      const item = document.createElement('li');
      const number = document.createElement('span');
      number.className = 'empty-guidance-step-num';
      number.textContent = `${idx + 1}`;
      const text = document.createElement('span');
      text.textContent = step;
      item.appendChild(number);
      item.appendChild(text);
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'empty-guidance-hint';
    hintEl.textContent = hint;
    container.appendChild(hintEl);
  }

  treeRoot.appendChild(container);
}

function showNoConversationGuidance(description) {
  renderGuidanceState({
    badge: 'No conversation detected',
    title: 'Open a conversation in ChatGPT, Claude, Gemini, or Perplexity',
    description:
      description ||
      'Visit chatgpt.com, claude.ai, gemini.google.com, or perplexity.ai, open any conversation, then press Refresh.',
    steps: NO_CONVERSATION_STEPS,
    hint: 'Once a chat is open, hit Refresh to load the tree.'
  });
}

/**
 * Render skeleton loading state
 * @param {string|null} title - Optional title to show while loading
 * @param {boolean} showAncestryLoading - Whether to show ancestry loading indicator
 */
function renderSkeleton(title = null, showAncestryLoading = false) {
  nodeDataMap.clear();
  lastRenderSignature = null;
  treeRoot.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'skeleton-container';

  // Ancestry loading indicator
  if (showAncestryLoading) {
    const ancestryLoading = document.createElement('div');
    ancestryLoading.className = 'skeleton-ancestry-loading';
    ancestryLoading.innerHTML = `
      <div class="loading-spinner"></div>
      <span>Loading branch ancestry...</span>
    `;
    container.appendChild(ancestryLoading);
  }

  // Title skeleton or actual title
  const titleNode = document.createElement('div');
  titleNode.className = 'skeleton-title';
  if (title) {
    titleNode.innerHTML = `
      <div class="skeleton-title-dot" style="background: var(--accent); animation: none;"></div>
      <div class="skeleton-title-bar" style="background: transparent; animation: none; color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(truncate(title, 50))}</div>
    `;
  } else {
    titleNode.innerHTML = `
      <div class="skeleton-title-dot"></div>
      <div class="skeleton-title-bar"></div>
    `;
  }
  container.appendChild(titleNode);

  // Skeleton nodes (3-4 items to simulate loading)
  const skeletonConfigs = [
    { lines: ['long'] },
    { lines: ['medium'] },
    { lines: ['short'] },
    { lines: ['long'] }
  ];

  skeletonConfigs.forEach((config, idx) => {
    const node = document.createElement('div');
    node.className = 'skeleton-node';
    node.style.animationDelay = `${idx * 100}ms`;

    const dot = document.createElement('div');
    dot.className = 'skeleton-dot';
    node.appendChild(dot);

    const card = document.createElement('div');
    card.className = 'skeleton-card';

    config.lines.forEach((lineClass) => {
      const line = document.createElement('div');
      line.className = `skeleton-line ${lineClass}`;
      card.appendChild(line);
    });

    node.appendChild(card);
    container.appendChild(node);
  });

  treeRoot.appendChild(container);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

/**
 * Map technical error messages to user-friendly descriptions
 */
function mapErrorMessage(error = '') {
  const lower = error.toLowerCase();
  if (lower.includes('401') || lower.includes('session fetch failed')) {
    return 'Please log in and try again';
  }
  if (lower.includes('no access token') || lower.includes('auth')) {
    return 'Authentication required - refresh the page';
  }
  if (lower.includes('403')) {
    return 'Access denied - check your account';
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limited - try again shortly';
  }
  if (lower.includes('500') || lower.includes('server')) {
    return 'Server error - try again later';
  }
  if (lower.includes('fetch failed') || lower.includes('network')) {
    return 'Network error - check connection';
  }
  if (lower.includes('no conversation id')) {
    return 'Open a conversation first';
  }
  if (lower.includes('unsupported')) {
    return 'This page is not supported';
  }
  // Return original if no mapping found (truncated)
  return error.length > 50 ? error.slice(0, 47) + '...' : error;
}

function isNoConversationError(errorText = '') {
  const lower = errorText.toLowerCase();
  return (
    lower.includes('conversation id') ||
    lower.includes('no conversation') ||
    lower.includes('receiving end does not exist') ||
    lower.includes('establish connection') ||
    lower.includes('cannot access contents') ||
    lower.includes('chatgpt conversation') ||
    lower.includes('open a conversation')
  );
}

/**
 * Update an existing node element in-place (avoids DOM destruction)
 */
function _updateNodeElement(el, node) {
  // Update text preview
  const preview = el.querySelector('.card-preview, .message-preview');
  if (preview) {
    const newText = truncate(node.text);
    if (preview.textContent !== newText) {
      preview.textContent = newText;
    }
  }

  // Update version control
  const versionControl = el.querySelector('.card-version-control');
  if (node.hasEditVersions && node.totalVersions > 1) {
    const vText = `v${node.editVersionIndex}/${node.totalVersions}`;
    const label = versionControl?.querySelector('.version-label');
    if (label && label.textContent !== vText) {
      label.textContent = vText;
    }
    const prevBtn = versionControl?.querySelector('.version-prev');
    const nextBtn = versionControl?.querySelector('.version-next');
    const atStart = (node.editVersionIndex || 1) <= 1;
    const atEnd = (node.editVersionIndex || 1) >= (node.totalVersions || 1);
    if (prevBtn) {
      prevBtn.classList.toggle('is-disabled', atStart);
      prevBtn.setAttribute('aria-disabled', atStart ? 'true' : 'false');
    }
    if (nextBtn) {
      nextBtn.classList.toggle('is-disabled', atEnd);
      nextBtn.setAttribute('aria-disabled', atEnd ? 'true' : 'false');
    }
  }

  // Update timestamp
  const timeEl = el.querySelector('.card-time');
  if (timeEl) {
    const newTime = formatTimestamp(node.createTime);
    if (timeEl.textContent !== newTime) {
      timeEl.textContent = newTime;
    }
  }

  // Update node data in map
  nodeDataMap.set(node.id, {
    id: node.id,
    type: node.type,
    targetConversationId: node.targetConversationId,
    hasEditVersions: node.hasEditVersions,
    editVersionIndex: node.editVersionIndex,
    totalVersions: node.totalVersions,
    siblingIds: node.siblingIds,
    branchNodeId: node.branchNodeId
  });
}

function renderTree(nodes, title, hasAncestry = false) {
  // Skip re-render if payload is unchanged to avoid double animations
  const renderSignature = computeRenderSignature(nodes, title, hasAncestry);
  if (lastRenderSignature && renderSignature === lastRenderSignature) {
    return false; // Return false to indicate no render occurred
  }
  lastRenderSignature = renderSignature;

  // Clear previous node data to prevent memory leaks
  nodeDataMap.clear();
  treeRoot.innerHTML = '';

  // Filter out nodes with empty text (keep branches, editBranches, branchRoots, and title types)
  const filteredNodes = (nodes || []).filter((node) => {
    if (
      node.type === 'branch' ||
      node.type === 'branchRoot' ||
      node.type === 'editBranch'
    )
      return true;
    if (
      node.type === 'title' ||
      node.type === 'ancestor-title' ||
      node.type === 'current-title'
    )
      return true;
    return node.text && node.text.trim().length > 0;
  });

  if (filteredNodes.length === 0 && !title) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
      <span class="empty-state-text">No conversation found</span>
    `;
    treeRoot.appendChild(empty);
    return true; // Still a valid render (empty state)
  }

  // Check if nodes already have title nodes (ancestry tree)
  const hasTitleNode = filteredNodes.some(
    (n) =>
      n.type === 'title' ||
      n.type === 'ancestor-title' ||
      n.type === 'current-title'
  );

  // Create title as the first node in the chain (only if not ancestry tree)
  const allNodes = [];
  if (title && !hasTitleNode) {
    allNodes.push({
      id: 'title-node',
      type: 'title',
      text: title,
      depth: 0,
      hasChildren: filteredNodes.length > 0,
      isMainViewing: !hasAncestry
    });
  }
  allNodes.push(...filteredNodes);

  // Inline nested branches as regular branch nodes (keep normal layout everywhere)
  const expandedNodes = [];
  allNodes.forEach((node) => {
    expandedNodes.push(node);
    if (
      node.type === 'branch' &&
      !node.expanded &&
      node.nestedBranches?.length > 0
    ) {
      node.nestedBranches.forEach((nested) => {
        expandedNodes.push({
          ...nested,
          type: 'branch',
          expanded: false,
          isNestedInline: true
        });
      });
    }
  });
  allNodes.length = 0;
  allNodes.push(...expandedNodes);

  // Mark terminal nodes before rendering
  markTerminalNodes(allNodes);
  annotateContextContinuations(allNodes);

  const fragment = document.createDocumentFragment();
  let visualIndex = 0; // Track visual position for staggered animation
  allNodes.forEach((node, idx) => {
    const prevNode = idx > 0 ? allNodes[idx - 1] : null;
    const nextNode = idx < allNodes.length - 1 ? allNodes[idx + 1] : null;
    fragment.appendChild(
      createNodeElement(
        node,
        visualIndex,
        allNodes.length,
        prevNode,
        nextNode,
        allNodes
      )
    );
    visualIndex++;
  });
  treeRoot.appendChild(fragment);

  // Draw colored backbones per depth to bridge gaps (stops at last node)
  drawBackbones();

  return true; // Indicate that rendering actually occurred
}

/**
 * Draw small backbone segments only across vertical gaps between nodes of the same depth.
 * Keeps the existing node connectors untouched and only fills missing segments.
 * Uses requestAnimationFrame to batch reads and writes for performance.
 */
let backboneRafId = null;

function drawBackbones() {
  // Cancel any pending backbone draw
  if (backboneRafId) {
    cancelAnimationFrame(backboneRafId);
  }

  backboneRafId = requestAnimationFrame(() => {
    backboneRafId = null;

    // Remove existing backbones
    treeRoot.querySelectorAll('.tree-backbone').forEach((el) => el.remove());

    const nodes = Array.from(treeRoot.querySelectorAll('.tree-node'));
    if (nodes.length === 0) return;

    const railSize = 20; // matches --rail-size

    // Batch read: collect all measurements first
    const measurements = nodes.map((node) => ({
      node,
      type: node.dataset.type || '',
      depth: parseInt(node.dataset.depth || '0', 10),
      top: node.offsetTop,
      bottom: node.offsetTop + node.offsetHeight,
      color: node.dataset.color?.trim() || '',
      isExpanded: node.classList.contains('is-expanded')
    }));

    // Group by depth
    const nodesByDepth = new Map();
    for (const m of measurements) {
      const entry = nodesByDepth.get(m.depth) || [];
      entry.push(m);
      nodesByDepth.set(m.depth, entry);
    }

    // Batch write: create all backbone elements
    const fragment = document.createDocumentFragment();

    nodesByDepth.forEach((list, depth) => {
      list.sort((a, b) => a.top - b.top);
      let lastColor = null;
      for (let i = 0; i < list.length - 1; i++) {
        const current = list[i];
        const next = list[i + 1];
        const inheritedColor = current.color || lastColor || getColor(depth);
        lastColor = inheritedColor;
        const gap = next.top - current.bottom;

        if (gap <= 4) continue;

        // Do not extend from collapsed branches or edit branches
        if (
          (current.type === 'branch' && !current.isExpanded) ||
          current.type === 'editBranch'
        ) {
          continue;
        }

        const backbone = document.createElement('div');
        backbone.className = 'tree-backbone';
        backbone.style.background = inheritedColor;
        backbone.style.left = `${depth * railSize + railSize / 2 - 1}px`;
        const topPos = current.bottom - 6;
        const height = gap + 30;
        backbone.style.top = `${topPos}px`;
        backbone.style.height = `${height}px`;
        fragment.appendChild(backbone);
      }
    });

    treeRoot.appendChild(fragment);
  });
}

// ============================================
// Tooltip & Event Delegation
// ============================================

let tooltipTimer = null;
let tooltipGeneration = 0; // Guard against stale timer callbacks

function showTooltip(el, text, type) {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  tooltipGeneration++;

  const rect = el.getBoundingClientRect();
  const containerRect = treeRoot.getBoundingClientRect();

  tooltip.textContent = text || '(empty message)';
  tooltip.className = 'tooltip visible';
  if (type === 'branch') tooltip.classList.add('tooltip-branch');

  // Position tooltip
  const top = rect.top - containerRect.top + treeRoot.scrollTop;
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${rect.left - containerRect.left + 40}px`;
  tooltip.style.maxWidth = `${containerRect.width - 60}px`;
}

function hideTooltip() {
  tooltipGeneration++;
  const currentGeneration = tooltipGeneration;

  tooltipTimer = setTimeout(() => {
    // Guard: only execute if this is still the current timer
    if (currentGeneration === tooltipGeneration) {
      tooltip.classList.remove('visible');
    }
  }, 100);
}

// Delegated event handlers for tree nodes (single handler for all nodes)
function setupTreeEventDelegation() {
  // Mouse events for tooltip
  treeRoot.addEventListener('mouseover', (e) => {
    const node = e.target.closest('.tree-node');
    if (node) {
      showTooltip(node, node.dataset.fullText, node.dataset.type);
    }
  });

  treeRoot.addEventListener('mouseout', (e) => {
    const node = e.target.closest('.tree-node');
    if (node) hideTooltip();
  });

  // Click handler using event delegation (no closure memory leaks)
  treeRoot.addEventListener('click', (e) => {
    const node = e.target.closest('.tree-node');
    if (!node) return;

    const nodeId = node.dataset.nodeId;
    const nodeData = nodeDataMap.get(nodeId);

    if (nodeData) {
      handleNodeClick(nodeData);
    }
  });
}

// ============================================
// Actions
// ============================================

async function focusMessageInTab(tabId, nodeId, attempts = 6) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < attempts; i++) {
    const resp = await tabsSendMessageSafe(tabId, {
      type: 'FOCUS_MESSAGE',
      nodeId
    });
    const ok = resp?.ok === true;
    if (ok) return true;
    await delay(350 + i * 150);
  }
  return false;
}

async function handleNodeClick(node) {
  if (!activeTabId) return;

  const { id, type, targetConversationId, branchNodeId } = node;

  // Ignore clicks on pre-branch indicator (informational only)
  if (type === 'preBranchIndicator') {
    return;
  }

  const destinationConversationId =
    targetConversationId || currentConversationId;

  const preferredHost = (() => {
    try {
      const url = new URL(activeTabInfo?.url || '');
      return url.host || 'chatgpt.com';
    } catch {
      return 'chatgpt.com';
    }
  })();

  try {
    // Handle edit branch clicks - switch ChatGPT to that branch
    if (type === 'editBranch' && branchNodeId) {
      setStatus('Switching branch...', 'loading');
      const resp = await tabsSendMessageSafe(activeTabId, {
        type: 'SWITCH_CHATGPT_BRANCH',
        branchNodeId
      });
      if (resp?.ok) {
        setStatus('Branch switched', 'success');
      } else {
        setStatus(resp?.error || 'Switch failed');
      }
      return;
    }

    // Navigate to conversation for branches, branchRoots, or ancestor titles with targetConversationId
    const isNavigableType =
      type === 'branch' ||
      type === 'branchRoot' ||
      type === 'title' ||
      type === 'ancestor-title';
    if (isNavigableType && targetConversationId) {
      await runtimeSendMessageSafe({
        type: 'OPEN_OR_FOCUS_CONVERSATION',
        conversationId: targetConversationId,
        preferredHost
      });
      return;
    }

    // If the message belongs to another conversation, open/focus it then scroll
    if (
      destinationConversationId &&
      destinationConversationId !== currentConversationId
    ) {
      const result = await runtimeSendMessageSafe({
        type: 'OPEN_OR_FOCUS_CONVERSATION',
        conversationId: destinationConversationId,
        preferredHost
      });
      const targetTabId = result?.tabId || activeTabId;
      if (targetTabId) {
        activeTabId = targetTabId;
        activeTabInfo = {
          ...(activeTabInfo || {}),
          id: targetTabId,
          url: `https://${preferredHost}/c/${destinationConversationId}`
        };
        await focusMessageInTab(targetTabId, id);
      }
      return;
    }

    // Same conversation: scroll to message
    await focusMessageInTab(activeTabId, id);
  } catch {
    setStatus('Action failed');
  }
}

async function fetchTree(tab = null) {
  const targetTab = tab || (await getActiveTab());

  if (!targetTab?.id) {
    return { error: 'No active tab' };
  }

  if (!isChatUrl(targetTab.url)) {
    return {
      error: 'Open a conversation in ChatGPT, Claude, Gemini, or Perplexity'
    };
  }

  try {
    const response = await tabsSendMessageSafe(targetTab.id, {
      type: 'GET_CONVERSATION_TREE'
    });

    if (response?.error) {
      return { error: response.error };
    }

    return response;
  } catch (err) {
    return { error: err?.message || 'Failed to load' };
  }
}

async function refresh() {
  // Prevent concurrent refreshes
  if (isRefreshing) return;
  isRefreshing = true;
  refreshBtn.disabled = true;

  const tab = await getActiveTab();

  if (!tab?.id) {
    currentConversationId = null;
    updatePlatformIndicator(null);
    showNoConversationGuidance(
      'Open an AI conversation in a tab to build the tree.'
    );
    setStatus('Waiting for chat');
    refreshBtn.disabled = false;
    isRefreshing = false;
    return;
  }

  if (!isChatUrl(tab.url)) {
    // Auto-close panel on non-supported pages
    window.close();
    return;
  }

  // Detect and show platform
  const detectedPlatform = detectPlatformFromUrl(tab.url);
  updatePlatformIndicator(detectedPlatform);

  // Show skeleton immediately for better perceived performance
  setStatus('Loading...', 'loading');
  renderSkeleton(null, false);

  const data = await fetchTree(tab);

  if (data?.error) {
    currentConversationId = null;
    if (isNoConversationError(data.error)) {
      showNoConversationGuidance(
        'Open a conversation tab, then refresh this panel to load the message index.'
      );
      setStatus('Waiting for chat');
    } else {
      // Map technical errors to user-friendly messages
      const friendlyError = mapErrorMessage(data.error);
      setStatus(friendlyError);
    }
    refreshBtn.disabled = false;
    isRefreshing = false;
    return;
  }

  if (data?.nodes) {
    currentConversationId = data.conversationId || null;
    // Update platform from response if available
    if (data.platform) {
      updatePlatformIndicator(data.platform);
    }
    renderTree(data.nodes, data.title, data.hasAncestry);
    setStatus('Ready', 'success');
  } else {
    currentConversationId = null;
    showNoConversationGuidance('Open a conversation to see the message index.');
    setStatus('Waiting for chat');
  }
  refreshBtn.disabled = false;
  isRefreshing = false;
}

// Debounced refresh for automatic triggers with additional race protection
function debouncedRefresh() {
  clearTimeout(refreshDebounceTimer);
  refreshDebounceTimer = setTimeout(() => {
    // Double-check we're not already refreshing when timer fires
    if (!isRefreshing) {
      refresh();
    }
  }, 300);
}

// ============================================
// Search & Keyboard Navigation
// ============================================

const searchInput = document.getElementById('search-input');
let searchDebounceTimer = null;

function applySearchFilter() {
  const nodes = treeRoot.querySelectorAll('.tree-node');
  let matchCount = 0;
  const query = currentSearchQuery;

  nodes.forEach((node) => {
    const text = (node.dataset.fullText || '').toLowerCase();
    const nodeType = node.dataset.type || '';
    // Always show title and branch nodes
    const isStructural =
      nodeType === 'title' ||
      nodeType === 'ancestor-title' ||
      nodeType === 'current-title';
    const matches = !query || isStructural || text.includes(query);
    node.classList.toggle('search-hidden', !matches);
    if (matches && !isStructural) matchCount++;
  });

  if (query) {
    setStatus(`${matchCount} match${matchCount !== 1 ? 'es' : ''}`);
  }
}

function setupSearch() {
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      currentSearchQuery = (searchInput.value || '').trim().toLowerCase();
      applySearchFilter();
    }, 200);
  });

  // Clear search on Escape
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      currentSearchQuery = '';
      applySearchFilter();
      searchInput.blur();
    }
  });
}

function setupKeyboardNavigation() {
  // "/" key focuses search
  document.addEventListener('keydown', (e) => {
    if (
      e.key === '/' &&
      document.activeElement !== searchInput &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      searchInput?.focus();
      return;
    }
  });

  // Arrow key navigation in tree
  treeRoot.addEventListener('keydown', (e) => {
    const focused = document.activeElement;
    if (!focused?.classList.contains('tree-node')) return;

    const visibleNodes = Array.from(
      treeRoot.querySelectorAll('.tree-node:not(.search-hidden)')
    );
    const idx = visibleNodes.indexOf(focused);

    if (e.key === 'ArrowDown' && idx < visibleNodes.length - 1) {
      e.preventDefault();
      visibleNodes[idx + 1].focus();
    } else if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      visibleNodes[idx - 1].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      focused.click();
    }
  });
}

// ============================================
// Event Listeners
// ============================================

// Settings modal handlers
function openSettings() {
  settingsOverlay.classList.add('visible');
}

function closeSettings() {
  settingsOverlay.classList.remove('visible');
}

function openInfo() {
  if (infoOverlay) infoOverlay.classList.add('visible');
}

function closeInfo() {
  if (infoOverlay) infoOverlay.classList.remove('visible');
}

// Escape key handler (stored reference to avoid accumulation)
function handleEscapeKey(e) {
  if (e.key !== 'Escape') return;
  if (settingsOverlay?.classList.contains('visible')) closeSettings();
  if (infoOverlay?.classList.contains('visible')) closeInfo();
}

// Setup all global event listeners (called once on init)
function setupGlobalListeners() {
  // Prevent duplicate registration
  if (globalListenersRegistered) return;
  globalListenersRegistered = true;

  // Settings button handlers
  settingsBtn.addEventListener('click', openSettings);
  if (infoBtn) {
    infoBtn.addEventListener('click', openInfo);
  }
  if (infoOverlay) {
    infoOverlay.addEventListener('click', (e) => {
      if (e.target === infoOverlay) closeInfo();
    });
  }
  if (infoClose) {
    infoClose.addEventListener('click', closeInfo);
  }
  settingsClose.addEventListener('click', closeSettings);

  // Close settings when clicking overlay background
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      closeSettings();
    }
  });

  // Close settings on Escape key (single listener)
  document.addEventListener('keydown', handleEscapeKey);

  // Refresh button
  refreshBtn.addEventListener('click', () => {
    closeSettings();
    refresh();
  });

  // Clear all branch data
  clearDataBtn.addEventListener('click', async () => {
    if (confirm('Clear all branch tracking data? This cannot be undone.')) {
      await chrome.storage.local.remove('chatgpt_branch_data');
      await chrome.storage.local.remove('pendingBranch');
      try {
        const tab = await getActiveTab();
        if (tab?.id) {
          await tabsSendMessageSafe(tab.id, { type: 'CLEAR_CACHE' });
        }
      } catch {
        // Ignore if we cannot reach the content script
      }
      setStatus('Data cleared', 'success');
      closeSettings();
      refresh();
    }
  });

  // Export as Markdown
  if (exportMdBtn) {
    exportMdBtn.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab?.id) {
        setStatus('No active tab');
        return;
      }

      // Update button state to show loading
      exportMdBtn.disabled = true;
      exportMdBtn.classList.add('is-loading');
      exportMdBtn.innerHTML = '<span class="header-spinner"></span>';
      exportMdBtn.title = 'Exporting...';
      setStatus('Exporting...', 'loading');

      try {
        const response = await tabsSendMessageSafe(tab.id, {
          type: 'EXPORT_MARKDOWN'
        });

        if (response?.ok) {
          setStatus(
            `Exported ${response.messageCount || ''} messages`,
            'success'
          );
          closeSettings();
        } else {
          setStatus(response?.error || 'Export failed');
        }
      } catch {
        setStatus('Export failed');
      } finally {
        exportMdBtn.disabled = false;
        exportMdBtn.classList.remove('is-loading');
        exportMdBtn.innerHTML = exportMdBtnIdleMarkup;
        exportMdBtn.title = 'Export Markdown';
      }
    });
  }

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'TREE_UPDATED' && msg.nodes) {
      currentConversationId = msg.conversationId || null;
      if (msg.platform) {
        updatePlatformIndicator(msg.platform);
      }
      // Only update status if content actually changed (renderTree returns true)
      const didRender = renderTree(msg.nodes, msg.title, msg.hasAncestry);
      if (didRender) {
        setStatus('Updated', 'success');
      }
    }
  });

  // Tab change detection
  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener((info) => {
      activeTabId = info.tabId;
      debouncedRefresh();
    });
  }

  if (chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (
        tabId === activeTabId &&
        (changeInfo.status === 'complete' || changeInfo.url)
      ) {
        debouncedRefresh();
      }
    });
  }

  // Visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      debouncedRefresh();
    }
  });

  // Setup tree event delegation (clicks and tooltips)
  setupTreeEventDelegation();

  // Setup settings listeners
  setupSettingsListeners();

  // Setup search and keyboard navigation
  setupSearch();
  setupKeyboardNavigation();
}

// Initialize
async function init() {
  await loadSettings();
  setupGlobalListeners();
  refresh();
}

init();
