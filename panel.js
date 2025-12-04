/**
 * ChatGPT Branch Tree - Panel Script
 * Renders the conversation tree in the side panel
 */

const statusEl = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const treeRoot = document.getElementById("tree-root");
const refreshBtn = document.getElementById("refresh");
const clearDataBtn = document.getElementById("clear-data");
const tooltip = document.getElementById("tooltip");
const settingsBtn = document.getElementById("settings-btn");
const closeBtn = document.getElementById("close-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsClose = document.getElementById("settings-close");
const infoBtn = document.getElementById("info-btn");
const infoOverlay = document.getElementById("info-overlay");
const infoClose = document.getElementById("info-close");

// Settings elements
const settingTheme = document.getElementById("setting-theme");
const settingCompact = document.getElementById("setting-compact");
const settingTimestamps = document.getElementById("setting-timestamps");
const settingPreviewLength = document.getElementById("setting-preview-length");
const previewLengthValue = document.getElementById("preview-length-value");
const segmentedBtns = document.querySelectorAll(".segmented-btn");

let activeTabId = null;
let activeTabInfo = null;
let refreshDebounceTimer = null;
let lastStatusState = null;
let isRefreshing = false;
let lastRenderSignature = null;
let currentConversationId = null;

// ============================================
// Settings
// ============================================

const SETTINGS_KEY = "branchTreeSettings";

const DEFAULT_SETTINGS = {
  previewLength: 70,
  timestampFormat: "absolute", // "absolute" | "relative"
  showTimestamps: true,
  theme: "system", // "system" | "dark" | "light"
  compactMode: false,
};

// Current settings (loaded on init)
let currentSettings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    currentSettings = { ...DEFAULT_SETTINGS, ...(data?.[SETTINGS_KEY] || {}) };
  } catch (e) {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  applySettings();
  updateSettingsUI();
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function applySettings() {
  // Apply theme
  document.body.classList.remove("theme-dark", "theme-light");
  if (currentSettings.theme === "dark") {
    document.body.classList.add("theme-dark");
  } else if (currentSettings.theme === "light") {
    document.body.classList.add("theme-light");
  }
  
  // Apply compact mode
  document.body.classList.toggle("compact-mode", currentSettings.compactMode);
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
  segmentedBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === currentSettings.timestampFormat);
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
    settingTheme.addEventListener("change", () => {
      currentSettings.theme = settingTheme.value;
      applySettings();
      saveSettings();
    });
  }
  
  // Compact mode toggle
  if (settingCompact) {
    settingCompact.addEventListener("change", () => {
      currentSettings.compactMode = settingCompact.checked;
      applySettings();
      saveSettings();
    });
  }
  
  // Show timestamps toggle
  if (settingTimestamps) {
    settingTimestamps.addEventListener("change", () => {
      currentSettings.showTimestamps = settingTimestamps.checked;
      saveSettings();
      refresh(); // Re-render tree with new setting
    });
  }
  
  // Timestamp format segmented control
  segmentedBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      segmentedBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentSettings.timestampFormat = btn.dataset.value;
      saveSettings();
      refresh(); // Re-render tree with new format
    });
  });
  
  // Preview length slider
  if (settingPreviewLength) {
    settingPreviewLength.addEventListener("input", () => {
      const value = parseInt(settingPreviewLength.value, 10);
      currentSettings.previewLength = value;
      if (previewLengthValue) {
        previewLengthValue.textContent = value;
      }
    });
    
    // Save on change (when user releases slider)
    settingPreviewLength.addEventListener("change", () => {
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
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
];

// Extended color palette for branches - distinct, vibrant colors
// Each branch gets a deterministic color based on conversation ID hash
const BRANCH_COLORS = [
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#ef4444", // red
  "#f97316", // orange
  "#14b8a6", // teal
  "#8b5cf6", // violet
  "#3b82f6", // blue
  "#d946ef", // fuchsia
  "#22c55e", // green
  "#eab308", // yellow
  "#a855f7", // purple
  "#0ea5e9", // sky
  "#f43f5e", // rose
];

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
    if (node.type !== "branch" && (node.depth ?? 0) <= branchDepth) {
      return true;
    }
    // If we find another branch at same level, main still continues through it
    if (node.type === "branch" && (node.depth ?? 0) === branchDepth) {
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
    
    // Branches have their own terminal logic
    if (node.type === "branch") {
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
          if (futureNode.type === "branch") continue;
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
    if (nextNode.type === "branch") {
      let sameContextContinues = false;
      for (let j = i + 1; j < nodes.length; j++) {
        const futureNode = nodes[j];
        if (futureNode.type === "branch") continue;
        // Check if this future node has the same context
        const sameContext = 
          (node.colorIndex === futureNode.colorIndex) ||
          (node.colorIndex === undefined && futureNode.colorIndex === undefined);
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
      (node.colorIndex === nextNode.colorIndex) ||
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
  const makeKey = (node) => `${node.depth ?? 0}|${node.colorIndex ?? "main"}`;
  const shouldTrack = (node) =>
    node.type !== "branch" && node.type !== "nested-branch";

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
  if (!text) return "";
  const limit = max ?? currentSettings.previewLength ?? 70;
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= limit ? clean : clean.slice(0, limit - 1) + "…";
}

/**
 * Generate a stable signature for a render payload so we can skip
 * re-rendering when nothing changed.
 */
function computeRenderSignature(nodes, title, hasAncestry) {
  try {
    return JSON.stringify({
      conversationId: currentConversationId || null,
      title: title || "",
      hasAncestry: !!hasAncestry,
      settings: {
        previewLength: currentSettings.previewLength,
        timestampFormat: currentSettings.timestampFormat,
        showTimestamps: currentSettings.showTimestamps,
      },
      nodes: Array.isArray(nodes) ? JSON.parse(JSON.stringify(nodes)) : [],
    });
  } catch (e) {
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
  return "just now";
}

function formatTimestamp(ts) {
  if (!ts || ts <= 0) return "";
  if (!currentSettings.showTimestamps) return "";
  
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  
  if (currentSettings.timestampFormat === "relative") {
    return formatRelativeTime(ms);
  }
  
  // Absolute format
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${time} · ${day}`;
}

let statusResetTimer = null;
let statusResetGeneration = 0; // Guard against stale timer callbacks

function setStatus(text, state = "ready") {
  // Skip if same state (avoid flicker)
  if (lastStatusState === state && state !== "loading") {
    return;
  }
  
  clearTimeout(statusResetTimer);
  statusResetTimer = null;
  statusResetGeneration++;
  const currentGeneration = statusResetGeneration;
  
  lastStatusState = state;
  statusEl.textContent = text;
  statusDot.classList.remove("loading", "success");
  
  if (state === "loading") {
    statusDot.classList.add("loading");
  } else if (state === "success") {
    statusDot.classList.add("success");
    // Reset to ready after 1.5 seconds (with guard)
    statusResetTimer = setTimeout(() => {
      // Guard: only execute if this is still the current timer
      if (currentGeneration === statusResetGeneration) {
        statusDot.classList.remove("success");
        lastStatusState = "ready";
      }
    }, 1500);
  }
}

function isChatUrl(url = "") {
  return /https:\/\/(chatgpt\.com|chat\.openai\.com)/i.test(url);
}

// ============================================
// Tab Management
// ============================================

async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_CHAT_TAB" }, (response) => {
      if (chrome.runtime.lastError || response?.error) {
        resolve(null);
        return;
      }
      const tab = response?.tab;
      if (tab?.id) activeTabId = tab.id;
      if (tab) activeTabInfo = tab;
      resolve(tab);
    });
  });
}

// ============================================
// Tree Rendering
// ============================================

function createNodeElement(node, index, total, prevNode, nextNode, allNodes) {
  const { id, type, role, text, depth, hasChildren, childCount, targetConversationId, createTime, colorIndex, branchIndex, expanded, isCurrent, isCurrentPath, isViewing, branchPath, isTerminal, hasPrevContext, hasNextContext, isMainViewing } = node;
  
  // Helper to fetch the rendered row element for a node (by id) if already in DOM
  function prevNodeRow(n) {
    if (!n) return null;
    return treeRoot.querySelector(`[data-node-id="${n.id}"]`);
  }

  const row = document.createElement("div");
  row.className = "tree-node";
  row.dataset.nodeId = id;
  row.dataset.depth = depth ?? 0;
  // Staggered animation delay (max 15 nodes, 30ms each)
  row.style.animationDelay = `${Math.min(index, 15) * 30}ms`;
  
  const isBranch = type === "branch";
  const isBranchRoot = type === "branchRoot";
  const isTitle = type === "title" || type === "ancestor-title" || type === "current-title";
  const isAncestorTitle = type === "ancestor-title";
  const isCurrentTitle = type === "current-title";
  const isViewingBranch = isBranch && isViewing;
  const isMainViewingTitle = isTitle && isMainViewing;
  const isExpanded = expanded === true;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const hasBranchLabel = isBranch || isBranchRoot;
  const isMessageCard = !isTitle && !hasBranchLabel;
  const showMainViewingTag = isMainViewingTitle;
  
  if (isBranch) row.classList.add("is-branch");
  if (isBranchRoot) row.classList.add("is-branch-root");
  if (isTitle) row.classList.add("is-title");
  if (isAncestorTitle) row.classList.add("is-ancestor-title");
  if (isCurrentTitle) row.classList.add("is-current-title");
  if (isExpanded) row.classList.add("is-expanded");
  if (isCurrent) row.classList.add("is-current");
  if (isCurrentPath) row.classList.add("is-current-path");
  if (isViewingBranch) row.classList.add("is-viewing");
  if (isMainViewingTitle) row.classList.add("is-main-viewing");
  if (isLast) row.classList.add("is-last-node");
  if (isTerminal) row.classList.add("is-terminal");
  // Mark branches that have nested children (for showing connector line to them)
  if (isBranch && !isExpanded && node.nestedBranches?.length > 0) {
    row.classList.add("has-nested");
  }

  // Determine color: branches use their deterministic color based on conversation ID
  // Non-branch messages in a branch also use their inherited colorIndex
  const hasColorIndex = colorIndex !== undefined && colorIndex !== null;
  const color = (isBranch || hasColorIndex) ? getBranchColor(colorIndex ?? 0) : getColor(depth ?? 0);
  
  // Set color CSS variables on the row for child elements to use
  row.style.setProperty("--color", color);
  if (isBranch || hasColorIndex) {
    row.style.setProperty("--branch-color", color);
  }
  row.dataset.color = color;
  
  // Check what's around us - for T-junction logic
  const nextIsBranch = nextNode?.type === "branch";
  const prevIsBranch = prevNode?.type === "branch";
  const prevBranchContinues = prevIsBranch
    ? findMainLineContinuation(allNodes, index - 1, prevNode.depth ?? 0)
    : false;
  
  // Determine if this node should connect to the next node
  // A node connects below if:
  // 1. It's not terminal (last in its chain)
  // 2. The next node exists and is NOT a branch (branches connect via T-junction)
  // 3. The next node has the same colorIndex (same branch context)
  const nextHasSameContext = nextNode && 
    !nextIsBranch && 
    ((colorIndex === nextNode.colorIndex) || 
     (colorIndex === undefined && nextNode.colorIndex === undefined));
  
  // Show line above: not first, and not a branch (branches use T-junction)
  // Connect from:
  // 1. Previous node with same context (same colorIndex)
  // 2. Title nodes (start of main chain)
  // 3. Expanded branches (they show line down to children)
  const prevHasSameContext = prevNode && 
    prevNode.type !== "branch" &&
    ((colorIndex === prevNode.colorIndex) || 
     (colorIndex === undefined && prevNode.colorIndex === undefined));
  
  // Check if previous is an expanded branch with same colorIndex (we're its first child)
  const prevIsExpandedBranch = prevNode?.type === "branch" && 
    prevNode.expanded === true && 
    prevNode.colorIndex === colorIndex;
  
  const showAbove = !isFirst && !isBranch && (
    prevHasSameContext || 
    hasPrevContext ||
    prevIsExpandedBranch ||
    prevBranchContinues ||
    prevNode?.type === "title" || 
    prevNode?.type === "ancestor-title" || 
    prevNode?.type === "current-title"
  );
  
  // Show line below: has next node in same context that isn't a branch
  // Terminal nodes never show line below
  const showBelow = !isTerminal && (nextHasSameContext || hasNextContext);

  // Rail (visual connector)
  const rail = document.createElement("div");
  rail.className = "rail";
  rail.style.setProperty("--depth", depth ?? 0);
  rail.style.setProperty("--color", color);

  // Vertical lines for depth indentation (colored per level)
  for (let i = 0; i < (depth ?? 0); i++) {
    const line = document.createElement("span");
    line.className = "rail-line";
    line.style.setProperty("--line-color", getColor(i));
    rail.appendChild(line);
  }

  // Current node connector
  const connector = document.createElement("span");
  connector.className = "rail-connector";
  
  // For branches, show T-junction from main line
  if (isBranch) {
    connector.classList.add("branch-connector");
    // Expanded branches show line continuing down into children
    if (isExpanded) {
      connector.classList.add("branch-expanded");
    }
    // Check if main line continues below (there's a non-branch node after this)
    // Look ahead to find if there's another non-branch node at the same level (main continuation)
    const mainContinues = findMainLineContinuation(allNodes, index, depth ?? 0);
    if (mainContinues) {
      connector.classList.add("main-continues");
    }
    // Set the main line color for the T-junction
    // Use the parent/main-line color for the T junction; prefer previous non-branch color if available
    let prevColor = null;
    if (prevNode && prevNode.type !== "branch" && prevNode.type !== "nested-branch") {
      const prevEl = prevNodeRow(prevNode);
      if (prevEl) {
        prevColor = getComputedStyle(prevEl).getPropertyValue("--color")?.trim() || null;
      }
    }
    const mainColor = prevColor || getColor(depth ?? 0);
    connector.style.setProperty("--main-color", mainColor);
  } else {
    if (showAbove) connector.classList.add("has-above");
    if (showBelow) connector.classList.add("has-below");
  }
  
  const dot = document.createElement("span");
  dot.className = "rail-dot";
  if (isBranch) {
    dot.classList.add("branch-dot");
    dot.style.setProperty("--branch-color", color);
    if (isExpanded) dot.classList.add("expanded-dot");
  }
  if (isBranchRoot) dot.classList.add("branch-root-dot");
  if (isTitle) dot.classList.add("title-dot");
  if (isCurrentTitle) dot.classList.add("current-title-dot");
  connector.appendChild(dot);
  rail.appendChild(connector);

  row.appendChild(rail);

  // Card content
  const card = document.createElement("div");
  card.className = "tree-card";
  if (isTitle) card.classList.add("title-card");
  if (isAncestorTitle) card.classList.add("ancestor-card");
  if (isCurrentTitle) card.classList.add("current-card");
  if (isExpanded) card.classList.add("expanded-card");
  if (isMessageCard) card.classList.add("message-card");

  // For title nodes, show the title text with optional label
  if (isTitle) {
    if (isAncestorTitle) {
      const ancestorLabel = document.createElement("div");
      ancestorLabel.className = "card-ancestor-label";
      ancestorLabel.textContent = "Ancestor";
      card.appendChild(ancestorLabel);
    } else if (isCurrentTitle) {
      const currentLabel = document.createElement("div");
      currentLabel.className = "card-current-label";
      currentLabel.textContent = "Viewing";
      card.appendChild(currentLabel);
    } else {
      if (showMainViewingTag) {
        const titleHeader = document.createElement("div");
        titleHeader.className = "card-header main-title-header";
        const combinedTag = document.createElement("span");
        combinedTag.className = "card-label label-main-viewing title-viewing-tag";
        combinedTag.textContent = "Main · Viewing";
        titleHeader.appendChild(combinedTag);
        card.appendChild(titleHeader);
      } else {
        // Root/main title node
        const mainLabel = document.createElement("div");
        mainLabel.className = "card-main-label";
        mainLabel.textContent = "Main";
        card.appendChild(mainLabel);
      }
    }
    const titleText = document.createElement("div");
    titleText.className = "card-title-text";
    titleText.textContent = truncate(text, 55);
    card.appendChild(titleText);
  } else {
    // Compact header: label + timestamp inline
    const timestamp = formatTimestamp(createTime);
    const hasTimestamp = Boolean(timestamp);
    const needsHeader = hasBranchLabel || hasTimestamp;

    if (needsHeader) {
      const header = document.createElement("div");
      header.className = "card-header";
      if (isMessageCard) header.classList.add("message-header");

      // Only show labels for branches and branchRoots, not regular messages
      if (type === "branch" || type === "branchRoot") {
        const label = document.createElement("span");
        label.className = "card-label";
        if (type === "branch") {
          // Use hierarchical branch path (e.g., "1", "1.1", "1.1.1")
          const pathLabel = branchPath || `${(branchIndex ?? 0) + 1}`;
          if (isViewing) {
            // Show "Viewing" tag; branch number is shown on its own line below
            label.textContent = "Viewing";
            label.classList.add("label-viewing");
          } else if (isExpanded) {
            label.textContent = `Branch ${pathLabel}`;
            label.classList.add("label-expanded");
          } else {
            label.textContent = `Branch ${pathLabel}`;
          }
          label.classList.add("label-branch");
        } else {
          label.textContent = "From";
          label.classList.add("label-branch-root");
        }
        header.appendChild(label);
      }

      // Timestamp on the right
      if (hasTimestamp) {
        const timeEl = document.createElement("span");
        timeEl.className = "card-time";
        if (isMessageCard) timeEl.classList.add("card-time-compact");
        timeEl.textContent = timestamp;
        header.appendChild(timeEl);
      }

      card.appendChild(header);
    }

    // Text preview - only show if there's actual content
    // Don't show preview for viewing branch (first message will appear below)
    const trimmedText = truncate(text);
    if (trimmedText && !isViewing) {
      const preview = document.createElement("div");
      preview.className = "card-preview";
      if (isMessageCard) preview.classList.add("message-preview");
      preview.textContent = trimmedText;
      card.appendChild(preview);
    }

    // For viewing branch, show branch number on its own line for clarity
    if (type === "branch" && isViewing) {
      const pathLabel = branchPath || `${(branchIndex ?? 0) + 1}`;
      const branchLine = document.createElement("div");
      branchLine.className = "branch-path-line";
      branchLine.textContent = `Branch ${pathLabel}`;
      card.appendChild(branchLine);
    }
  }

  row.appendChild(card);

  // Store full text for tooltip (in dataset for event delegation)
  row.dataset.fullText = text || "";
  row.dataset.type = type || "message";
  row.dataset.targetConv = targetConversationId || "";

  // Store node data in Map for event delegation (avoids closure memory leaks)
  nodeDataMap.set(id, {
    id,
    type,
    targetConversationId,
  });

  return row;
}

/**
 * Create a nested branch preview element (compact view for collapsed branches)
 * @param node - The nested branch node data
 * @param parentColorIndex - The colorIndex of the parent branch (for connecting lines)
 * @param isFirst - Whether this is the first nested branch in the group
 * @param isLast - Whether this is the last nested branch in the group
 * @param mainLineContinues - Whether the main line continues after all nested branches
 */
function createNestedBranchElement(node, parentColorIndex, isFirst = false, isLast = false, mainLineContinues = false) {
  const { id, text, depth, targetConversationId, branchPath, colorIndex } = node;
  
  const row = document.createElement("div");
  row.className = "tree-node nested-branch-node";
  row.dataset.nodeId = id;
  row.dataset.depth = depth ?? 0;
  
  // Mark first nested branch (extends line up to connect with parent)
  if (isFirst) {
    row.classList.add("is-first-nested");
  }
  
  // Mark last nested branch (no line continuing below)
  if (isLast) {
    row.classList.add("is-last-nested");
  }
  
  // Mark if main line continues (to show main purple line alongside)
  if (mainLineContinues) {
    row.classList.add("main-line-continues");
  }
  
  // Use the node's OWN colorIndex for the dot (unique color per branch)
  const ownColor = getBranchColor(colorIndex ?? parentColorIndex ?? 0);
  // Use the PARENT's colorIndex for connecting lines
  const parentColor = getBranchColor(parentColorIndex ?? 0);
  
  // Set both color variables
  row.style.setProperty("--color", ownColor);
  row.style.setProperty("--branch-color", ownColor);
  row.style.setProperty("--parent-color", parentColor);
  row.style.setProperty("--main-color", getColor(0)); // Main line is always depth 0 color
  row.dataset.color = ownColor;

  // Rail (visual connector)
  const rail = document.createElement("div");
  rail.className = "rail nested-rail";
  rail.style.setProperty("--depth", depth ?? 0);

  // Depth indentation lines: use parent color and highlight parent column when continuing
  const branchColumnIndex = Math.max((depth ?? 1) - 1, 0);
  for (let i = 0; i < (depth ?? 0); i++) {
    const line = document.createElement("span");
    line.className = "rail-line nested-rail-line";
    line.style.setProperty("--line-color", parentColor);
    if (mainLineContinues && i === branchColumnIndex) {
      line.classList.add("main-line");
      line.style.setProperty("--line-color", parentColor);
    }
    rail.appendChild(line);
  }

  // Connector with small dot
  const connector = document.createElement("span");
  connector.className = "rail-connector nested-connector";
  
  const dot = document.createElement("span");
  dot.className = "rail-dot nested-dot";
  // Dot uses the branch's OWN color
  dot.style.setProperty("--branch-color", ownColor);
  connector.appendChild(dot);
  rail.appendChild(connector);

  row.appendChild(rail);

  // Compact card
  const card = document.createElement("div");
  card.className = "tree-card nested-card";
  // Card border uses the branch's OWN color
  card.style.setProperty("--branch-color", ownColor);

  // Header with branch path
  const header = document.createElement("div");
  header.className = "card-header";

  const label = document.createElement("span");
  label.className = "card-label label-branch nested-label";
  label.textContent = branchPath || "Branch";
  // Label uses the branch's OWN color
  label.style.setProperty("--color", ownColor);
  header.appendChild(label);

  card.appendChild(header);

  // Text preview (truncated)
  const trimmedText = truncate(text, 50);
  if (trimmedText) {
    const preview = document.createElement("div");
    preview.className = "card-preview nested-preview";
    preview.textContent = trimmedText;
    card.appendChild(preview);
  }

  row.appendChild(card);

  // Store data for tooltip and click handling (in dataset for event delegation)
  row.dataset.fullText = text || "";
  row.dataset.type = "nested-branch";
  row.dataset.targetConv = targetConversationId || "";

  // Store node data in Map for event delegation (avoids closure memory leaks)
  nodeDataMap.set(id, {
    id,
    type: "branch", // Nested branches navigate like regular branches
    targetConversationId,
  });

  return row;
}

function renderTree(nodes, title, hasAncestry = false) {
  // Skip re-render if payload is unchanged to avoid double animations
  const renderSignature = computeRenderSignature(nodes, title, hasAncestry);
  if (lastRenderSignature && renderSignature === lastRenderSignature) {
    return;
  }
  lastRenderSignature = renderSignature;

  // Clear previous node data to prevent memory leaks
  nodeDataMap.clear();
  treeRoot.innerHTML = "";

  // Filter out nodes with empty text (keep branches, branchRoots, and title types)
  const filteredNodes = (nodes || []).filter(node => {
    if (node.type === "branch" || node.type === "branchRoot" || node.type === "nested-branch") return true;
    if (node.type === "title" || node.type === "ancestor-title" || node.type === "current-title") return true;
    return node.text && node.text.trim().length > 0;
  });

  if (filteredNodes.length === 0 && !title) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
      <span class="empty-state-text">No conversation found</span>
    `;
    treeRoot.appendChild(empty);
    return;
  }

  // Check if nodes already have title nodes (ancestry tree)
  const hasTitleNode = filteredNodes.some(n => 
    n.type === "title" || n.type === "ancestor-title" || n.type === "current-title"
  );

  // Create title as the first node in the chain (only if not ancestry tree)
  const allNodes = [];
  if (title && !hasTitleNode) {
    allNodes.push({
      id: "title-node",
      type: "title",
      text: title,
      depth: 0,
      hasChildren: filteredNodes.length > 0,
      isMainViewing: !hasAncestry,
    });
  }
  allNodes.push(...filteredNodes);

  // For root view (no ancestry), inline nested branch previews as regular branch nodes
  if (!hasAncestry) {
    const expandedNodes = [];
    allNodes.forEach((node) => {
      expandedNodes.push(node);
      if (node.type === "branch" && !node.expanded && node.nestedBranches?.length > 0) {
        node.nestedBranches.forEach((nested) => {
          expandedNodes.push({
            ...nested,
            type: "branch",
            expanded: false,
            isNestedInline: true,
          });
        });
      }
    });
    allNodes.length = 0;
    allNodes.push(...expandedNodes);
  }

  // Mark terminal nodes before rendering
  markTerminalNodes(allNodes);
  annotateContextContinuations(allNodes);

  const fragment = document.createDocumentFragment();
  let visualIndex = 0; // Track visual position for staggered animation
  const renderNestedPreviews = hasAncestry;
  allNodes.forEach((node, idx) => {
    const prevNode = idx > 0 ? allNodes[idx - 1] : null;
    const nextNode = idx < allNodes.length - 1 ? allNodes[idx + 1] : null;
    fragment.appendChild(createNodeElement(node, visualIndex, allNodes.length, prevNode, nextNode, allNodes));
    visualIndex++;
    
    // If this is a collapsed branch with nested branches, render them
    if (renderNestedPreviews && node.type === "branch" && !node.expanded && node.nestedBranches?.length > 0) {
      // Check if main line continues after this branch and its nested branches
      const mainLineContinues = findMainLineContinuation(allNodes, idx, node.depth ?? 0);
      
      node.nestedBranches.forEach((nestedNode, nestedIdx) => {
        const isFirstNested = nestedIdx === 0;
        const isLastNested = nestedIdx === node.nestedBranches.length - 1;
        const nestedEl = createNestedBranchElement(
          nestedNode, 
          node.colorIndex,
          isFirstNested,
          isLastNested,
          mainLineContinues
        );
        nestedEl.style.animationDelay = `${Math.min(visualIndex, 15) * 30}ms`;
        fragment.appendChild(nestedEl);
        visualIndex++;
      });
    }
  });
  treeRoot.appendChild(fragment);

  // Draw colored backbones per depth to bridge gaps (stops at last node)
  drawBackbones();
}

/**
 * Draw small backbone segments only across vertical gaps between nodes of the same depth.
 * Keeps the existing node connectors untouched and only fills missing segments.
 */
function drawBackbones() {
  // Remove existing backbones
  treeRoot.querySelectorAll(".tree-backbone").forEach(el => el.remove());

  const nodes = Array.from(treeRoot.querySelectorAll(".tree-node"));
  if (nodes.length === 0) return;

  const railSize = 20; // matches --rail-size

  // Group nodes by depth with their rects/colors (keep nested previews for ordering)
  const nodesByDepth = new Map();
  nodes.forEach(node => {
    const type = node.dataset.type || "";
    const depth = parseInt(node.dataset.depth || "0", 10);
    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;
    const entry = nodesByDepth.get(depth) || [];
    const color =
      node.dataset.color?.trim() ||
      "";
    entry.push({
      node,
      top,
      bottom,
      color,
      type,
      isBackboneNode: type !== "nested-branch",
    });
    nodesByDepth.set(depth, entry);
  });

  nodesByDepth.forEach((list, depth) => {
    // Sort by vertical position
    list.sort((a, b) => a.top - b.top);
    let lastColor = null;
    for (let i = 0; i < list.length - 1; i++) {
      const current = list[i];
      const next = list[i + 1];
      const inheritedColor = current.color || lastColor || getColor(depth);
      lastColor = inheritedColor;
      const gap = next.top - current.bottom;

      // Only fill meaningful gaps (skip near-adjacent nodes)
      if (gap <= 4) continue;

      // Do not extend a backbone from a collapsed branch; its chain is folded
      if (current.type === "branch" && !current.node.classList.contains("is-expanded")) {
        continue;
      }

      // Skip connecting through nested previews; they draw their own rails
      if (!current.isBackboneNode || !next.isBackboneNode) continue;

      const backbone = document.createElement("div");
      backbone.className = "tree-backbone";

      backbone.style.background = inheritedColor;

      backbone.style.left = `${(depth * railSize) + (railSize / 2) - 1}px`;
      // Overlap both ends to ensure connection into adjoining connectors
      const top = current.bottom - 6;
      const height = gap + 30;
      backbone.style.top = `${top}px`;
      backbone.style.height = `${height}px`;
      treeRoot.appendChild(backbone);
    }
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
  
  tooltip.textContent = text || "(empty message)";
  tooltip.className = "tooltip visible";
  if (type === "branch" || type === "nested-branch") tooltip.classList.add("tooltip-branch");
  
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
      tooltip.classList.remove("visible");
    }
  }, 100);
}

// Delegated event handlers for tree nodes (single handler for all nodes)
function setupTreeEventDelegation() {
  // Mouse events for tooltip
  treeRoot.addEventListener("mouseover", (e) => {
    const node = e.target.closest(".tree-node");
    if (node) {
      showTooltip(node, node.dataset.fullText, node.dataset.type);
    }
  });

  treeRoot.addEventListener("mouseout", (e) => {
    const node = e.target.closest(".tree-node");
    if (node) hideTooltip();
  });

  // Click handler using event delegation (no closure memory leaks)
  treeRoot.addEventListener("click", (e) => {
    const node = e.target.closest(".tree-node");
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

async function togglePanelVisibility() {
  try {
    const tab = await getActiveTab();
    const targetTabId = tab?.id || activeTabId;
    if (!targetTabId) {
      setStatus("No active tab");
      return;
    }
    await chrome.tabs.sendMessage(targetTabId, { type: "TOGGLE_PANEL" });
  } catch (e) {
    setStatus("Close failed");
  }
}

async function focusMessageInTab(tabId, nodeId, attempts = 6) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < attempts; i++) {
    const ok = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { type: "FOCUS_MESSAGE", nodeId },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve(false);
              return;
            }
            resolve(resp?.ok);
          }
        );
      } catch (e) {
        resolve(false);
      }
    });
    if (ok) return true;
    await delay(350 + i * 150);
  }
  return false;
}

async function handleNodeClick(node) {
  if (!activeTabId) return;

  const { id, type, targetConversationId } = node;
  const destinationConversationId = targetConversationId || currentConversationId;

  const preferredHost = (() => {
    try {
      const url = new URL(activeTabInfo?.url || "");
      return url.host || "chatgpt.com";
    } catch (e) {
      return "chatgpt.com";
    }
  })();

  try {
    // Navigate to conversation for branches, branchRoots, or ancestor titles with targetConversationId
    const isNavigableType = type === "branch" || type === "branchRoot" || type === "title" || type === "ancestor-title";
    if (isNavigableType && targetConversationId) {
      await chrome.runtime.sendMessage({
        type: "OPEN_OR_FOCUS_CONVERSATION",
        conversationId: targetConversationId,
        preferredHost,
      });
      return;
    }

    // If the message belongs to another conversation, open/focus it then scroll
    if (destinationConversationId && destinationConversationId !== currentConversationId) {
      const result = await chrome.runtime.sendMessage({
        type: "OPEN_OR_FOCUS_CONVERSATION",
        conversationId: destinationConversationId,
        preferredHost,
      });
      const targetTabId = result?.tabId || activeTabId;
      if (targetTabId) {
        activeTabId = targetTabId;
        activeTabInfo = { ...(activeTabInfo || {}), id: targetTabId, url: `https://${preferredHost}/c/${destinationConversationId}` };
        await focusMessageInTab(targetTabId, id);
      }
      return;
    }

    // Same conversation: scroll to message
    await focusMessageInTab(activeTabId, id);
  } catch (err) {
    setStatus("Action failed");
  }
}

async function fetchTree(tab = null) {
  const targetTab = tab || (await getActiveTab());
  
  if (!targetTab?.id) {
    setStatus("No active tab");
    return null;
  }

  if (!isChatUrl(targetTab.url)) {
    setStatus("Open a ChatGPT conversation");
    return null;
  }

  try {
    setStatus("Loading...", "loading");
    const response = await chrome.tabs.sendMessage(targetTab.id, {
      type: "GET_CONVERSATION_TREE",
    });

    if (response?.error) {
      setStatus(response.error);
      return null;
    }

    setStatus("Ready", "success");
    return response;
  } catch (err) {
    setStatus(err?.message || "Failed to load");
    return null;
  }
}

async function refresh() {
  // Prevent concurrent refreshes
  if (isRefreshing) return;
  isRefreshing = true;
  refreshBtn.disabled = true;
  
  const tab = await getActiveTab();
  
  if (!tab?.id || !isChatUrl(tab.url)) {
    treeRoot.innerHTML = "";
    setStatus("Open a ChatGPT conversation");
    refreshBtn.disabled = false;
    isRefreshing = false;
    return;
  }

  const data = await fetchTree(tab);
  if (data?.nodes) {
    currentConversationId = data.conversationId || null;
    renderTree(data.nodes, data.title, data.hasAncestry);
  } else {
    currentConversationId = null;
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
// Event Listeners
// ============================================

// Settings modal handlers
function openSettings() {
  settingsOverlay.classList.add("visible");
}

function closeSettings() {
  settingsOverlay.classList.remove("visible");
}

function openInfo() {
  if (infoOverlay) infoOverlay.classList.add("visible");
}

function closeInfo() {
  if (infoOverlay) infoOverlay.classList.remove("visible");
}

// Escape key handler (stored reference to avoid accumulation)
function handleEscapeKey(e) {
  if (e.key !== "Escape") return;
  if (settingsOverlay?.classList.contains("visible")) closeSettings();
  if (infoOverlay?.classList.contains("visible")) closeInfo();
}

// Setup all global event listeners (called once on init)
function setupGlobalListeners() {
  // Prevent duplicate registration
  if (globalListenersRegistered) return;
  globalListenersRegistered = true;

  // Settings button handlers
  settingsBtn.addEventListener("click", openSettings);
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      togglePanelVisibility();
    });
  }
  if (infoBtn) {
    infoBtn.addEventListener("click", openInfo);
  }
  if (infoOverlay) {
    infoOverlay.addEventListener("click", (e) => {
      if (e.target === infoOverlay) closeInfo();
    });
  }
  if (infoClose) {
    infoClose.addEventListener("click", closeInfo);
  }
  settingsClose.addEventListener("click", closeSettings);

  // Close settings when clicking overlay background
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) {
      closeSettings();
    }
  });

  // Close settings on Escape key (single listener)
  document.addEventListener("keydown", handleEscapeKey);

  // Refresh button
  refreshBtn.addEventListener("click", () => {
    closeSettings();
    refresh();
  });

  // Clear all branch data
  clearDataBtn.addEventListener("click", async () => {
    if (confirm("Clear all branch tracking data? This cannot be undone.")) {
      await chrome.storage.local.remove("chatgpt_branch_data");
      await chrome.storage.local.remove("pendingBranch");
      try {
        const tab = await getActiveTab();
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, { type: "CLEAR_CACHE" });
        }
      } catch (e) {
        // Ignore if we cannot reach the content script
      }
      setStatus("Data cleared", "success");
      closeSettings();
      refresh();
    }
  });

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "TREE_UPDATED" && msg.nodes) {
      currentConversationId = msg.conversationId || null;
      renderTree(msg.nodes, msg.title, msg.hasAncestry);
      setStatus("Updated", "success");
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
      if (tabId === activeTabId && (changeInfo.status === "complete" || changeInfo.url)) {
        debouncedRefresh();
      }
    });
  }

  // Visibility change
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      debouncedRefresh();
    }
  });

  // Setup tree event delegation (clicks and tooltips)
  setupTreeEventDelegation();
  
  // Setup settings listeners
  setupSettingsListeners();
}

// Initialize
async function init() {
  await loadSettings();
  setupGlobalListeners();
  refresh();
}

init();
