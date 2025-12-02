/**
 * ChatGPT Branch Tree - Panel Script
 * Renders the conversation tree in the side panel
 */

const statusEl = document.getElementById("status");
const treeRoot = document.getElementById("tree-root");
const refreshBtn = document.getElementById("refresh");
const clearDataBtn = document.getElementById("clear-data");
const tooltip = document.getElementById("tooltip");

let activeTabId = null;

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

function truncate(text, max = 80) {
  if (!text) return "";
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

function formatTimestamp(ts) {
  if (!ts || ts <= 0) return "";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${time} · ${day}`;
}

function setStatus(text) {
  statusEl.textContent = text;
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
      resolve(tab);
    });
  });
}

// ============================================
// Tree Rendering
// ============================================

function createNodeElement(node, index, total, prevNode, nextNode, allNodes) {
  const { id, type, role, text, depth, hasChildren, childCount, targetConversationId, createTime, colorIndex, branchIndex, expanded, isCurrent, isCurrentPath, isViewing, branchPath, isTerminal } = node;
  
  const row = document.createElement("div");
  row.className = "tree-node";
  row.dataset.nodeId = id;
  row.dataset.depth = depth ?? 0;
  
  const isBranch = type === "branch";
  const isBranchRoot = type === "branchRoot";
  const isTitle = type === "title" || type === "ancestor-title" || type === "current-title";
  const isAncestorTitle = type === "ancestor-title";
  const isCurrentTitle = type === "current-title";
  const isExpanded = expanded === true;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  
  if (isBranch) row.classList.add("is-branch");
  if (isBranchRoot) row.classList.add("is-branch-root");
  if (isTitle) row.classList.add("is-title");
  if (isAncestorTitle) row.classList.add("is-ancestor-title");
  if (isCurrentTitle) row.classList.add("is-current-title");
  if (isExpanded) row.classList.add("is-expanded");
  if (isCurrent) row.classList.add("is-current");
  if (isCurrentPath) row.classList.add("is-current-path");
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
  
  // Check what's around us - for T-junction logic
  const nextIsBranch = nextNode?.type === "branch";
  const prevIsBranch = prevNode?.type === "branch";
  
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
    prevIsExpandedBranch ||
    prevNode?.type === "title" || 
    prevNode?.type === "ancestor-title" || 
    prevNode?.type === "current-title"
  );
  
  // Show line below: has next node in same context that isn't a branch
  // Terminal nodes never show line below
  const showBelow = !isTerminal && nextHasSameContext;

  // Rail (visual connector)
  const rail = document.createElement("div");
  rail.className = "rail";
  rail.style.setProperty("--depth", depth ?? 0);
  rail.style.setProperty("--color", color);

  // Vertical lines for depth indentation
  for (let i = 0; i < (depth ?? 0); i++) {
    const line = document.createElement("span");
    line.className = "rail-line";
    // For branch content, hide ALL rail-lines to show grey backbones
    if (hasColorIndex) {
      line.classList.add("hidden-line");
    } else {
      line.style.setProperty("--line-color", getColor(i));
    }
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
    const mainColor = getColor(depth ?? 0);
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
      // Root/main title node
      const mainLabel = document.createElement("div");
      mainLabel.className = "card-main-label";
      mainLabel.textContent = "Main";
      card.appendChild(mainLabel);
    }
    const titleText = document.createElement("div");
    titleText.className = "card-title-text";
    titleText.textContent = truncate(text, 55);
    card.appendChild(titleText);
  } else {
    // Compact header: label + timestamp inline
    const header = document.createElement("div");
    header.className = "card-header";

    const label = document.createElement("span");
    label.className = "card-label";
    if (type === "branch") {
      // Use hierarchical branch path (e.g., "1", "1.1", "1.1.1")
      const pathLabel = branchPath || `${(branchIndex ?? 0) + 1}`;
      if (isViewing) {
        // Show "Viewing X.X" for the branch leading to current conversation
        label.textContent = `Viewing ${pathLabel}`;
        label.classList.add("label-viewing");
      } else if (isExpanded) {
        label.textContent = `Branch ${pathLabel}`;
        label.classList.add("label-expanded");
      } else {
        label.textContent = `Branch ${pathLabel}`;
      }
      label.classList.add("label-branch");
    } else if (type === "branchRoot") {
      label.textContent = "From";
      label.classList.add("label-branch-root");
    } else {
      label.textContent = "You";
      label.classList.add("label-user");
    }
    header.appendChild(label);

    // Timestamp on the right
    const timestamp = formatTimestamp(createTime);
    if (timestamp) {
      const timeEl = document.createElement("span");
      timeEl.className = "card-time";
      timeEl.textContent = timestamp;
      header.appendChild(timeEl);
    }

    card.appendChild(header);

    // Text preview - only show if there's actual content
    // Don't show preview for viewing branch (first message will appear below)
    const trimmedText = truncate(text, 70);
    if (trimmedText && !isViewing) {
      const preview = document.createElement("div");
      preview.className = "card-preview";
      preview.textContent = trimmedText;
      card.appendChild(preview);
    }
  }

  row.appendChild(card);

  // Store full text for tooltip
  row.dataset.fullText = text || "";
  row.dataset.type = type || "message";
  row.dataset.targetConv = targetConversationId || "";

  // Click handler
  row.addEventListener("click", () => handleNodeClick(node));

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

  // Rail (visual connector)
  const rail = document.createElement("div");
  rail.className = "rail nested-rail";
  rail.style.setProperty("--depth", depth ?? 0);

  // Depth indentation lines:
  // Hide ALL rail-lines for nested branch elements - grey backbones provide visual guide
  for (let i = 0; i < (depth ?? 0); i++) {
    const line = document.createElement("span");
    line.className = "rail-line nested-rail-line";
    // Hide all rail-lines to show grey backbones
    line.classList.add("hidden-line");
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

  // Store data for tooltip and click handling
  row.dataset.fullText = text || "";
  row.dataset.type = "nested-branch";
  row.dataset.targetConv = targetConversationId || "";

  // Click handler - navigate to conversation
  row.addEventListener("click", () => handleNodeClick({
    id,
    type: "branch",
    targetConversationId,
  }));

  return row;
}

function renderTree(nodes, title, hasAncestry = false) {
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
    empty.textContent = "No conversation found";
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
    });
  }
  allNodes.push(...filteredNodes);

  // Mark terminal nodes before rendering
  markTerminalNodes(allNodes);

  // Calculate max depth for backbone lines (including nested branches)
  let maxDepth = 0;
  allNodes.forEach(node => {
    maxDepth = Math.max(maxDepth, node.depth ?? 0);
    // Check nested branches for deeper depths
    if (node.nestedBranches) {
      node.nestedBranches.forEach(nested => {
        maxDepth = Math.max(maxDepth, nested.depth ?? 0);
      });
    }
  });

  // Create grey backbone lines for each depth column
  const railSize = 20; // var(--rail-size) = 20px
  for (let d = 0; d <= maxDepth; d++) {
    const backbone = document.createElement("div");
    backbone.className = "tree-backbone";
    // Position at center of each column: (d * railSize) + (railSize / 2)
    backbone.style.left = `${(d * railSize) + (railSize / 2) - 1.2}px`;
    treeRoot.appendChild(backbone);
  }

  const fragment = document.createDocumentFragment();
  allNodes.forEach((node, idx) => {
    const prevNode = idx > 0 ? allNodes[idx - 1] : null;
    const nextNode = idx < allNodes.length - 1 ? allNodes[idx + 1] : null;
    fragment.appendChild(createNodeElement(node, idx, allNodes.length, prevNode, nextNode, allNodes));
    
    // If this is a collapsed branch with nested branches, render them
    if (node.type === "branch" && !node.expanded && node.nestedBranches?.length > 0) {
      // Check if main line continues after this branch and its nested branches
      const mainLineContinues = findMainLineContinuation(allNodes, idx, node.depth ?? 0);
      
      node.nestedBranches.forEach((nestedNode, nestedIdx) => {
        const isFirstNested = nestedIdx === 0;
        const isLastNested = nestedIdx === node.nestedBranches.length - 1;
        fragment.appendChild(createNestedBranchElement(
          nestedNode, 
          node.colorIndex,
          isFirstNested,
          isLastNested,
          mainLineContinues
        ));
      });
    }
  });
  treeRoot.appendChild(fragment);
}

// ============================================
// Tooltip
// ============================================

let tooltipTimer = null;

function showTooltip(el, text, type) {
  clearTimeout(tooltipTimer);
  
  const rect = el.getBoundingClientRect();
  const containerRect = treeRoot.getBoundingClientRect();
  
  tooltip.textContent = text || "(empty message)";
  tooltip.className = "tooltip visible";
  if (type === "branch") tooltip.classList.add("tooltip-branch");
  
  // Position tooltip
  const top = rect.top - containerRect.top + treeRoot.scrollTop;
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${rect.left - containerRect.left + 40}px`;
  tooltip.style.maxWidth = `${containerRect.width - 60}px`;
}

function hideTooltip() {
  tooltipTimer = setTimeout(() => {
    tooltip.classList.remove("visible");
  }, 100);
}

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

// ============================================
// Actions
// ============================================

async function handleNodeClick(node) {
  if (!activeTabId) return;

  const { id, type, targetConversationId } = node;

  try {
    // Navigate to conversation for branches, branchRoots, or ancestor titles with targetConversationId
    const isNavigableType = type === "branch" || type === "branchRoot" || type === "title" || type === "ancestor-title";
    if (isNavigableType && targetConversationId) {
      // Navigate to the conversation
      await chrome.tabs.sendMessage(activeTabId, {
        type: "OPEN_CONVERSATION",
        conversationId: targetConversationId,
      });
    } else {
      // Scroll to message
      await chrome.tabs.sendMessage(activeTabId, {
        type: "FOCUS_MESSAGE",
        nodeId: id,
      });
    }
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
    setStatus("Loading...");
    const response = await chrome.tabs.sendMessage(targetTab.id, {
      type: "GET_CONVERSATION_TREE",
    });

    if (response?.error) {
      setStatus(response.error);
      return null;
    }

    setStatus("Ready");
    return response;
  } catch (err) {
    setStatus(err?.message || "Failed to load");
    return null;
  }
}

async function refresh() {
  refreshBtn.disabled = true;
  const tab = await getActiveTab();
  
  if (!tab?.id || !isChatUrl(tab.url)) {
    treeRoot.innerHTML = "";
    setStatus("Open a ChatGPT conversation");
    refreshBtn.disabled = false;
    return;
  }

  const data = await fetchTree(tab);
  if (data?.nodes) {
    renderTree(data.nodes, data.title, data.hasAncestry);
  }
  refreshBtn.disabled = false;
}

// ============================================
// Event Listeners
// ============================================

refreshBtn.addEventListener("click", refresh);

// Clear all branch data
clearDataBtn.addEventListener("click", async () => {
  if (confirm("Clear all branch tracking data? This cannot be undone.")) {
    await chrome.storage.local.remove("chatgpt_branch_data");
    await chrome.storage.local.remove("pendingBranch");
    setStatus("Data cleared");
    refresh();
  }
});

// Listen for updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "TREE_UPDATED" && msg.nodes) {
    renderTree(msg.nodes, msg.title, msg.hasAncestry);
    setStatus("Updated");
  }
});

// Tab change detection
if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener((info) => {
    activeTabId = info.tabId;
    setTimeout(refresh, 100);
  });
}

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && (changeInfo.status === "complete" || changeInfo.url)) {
      setTimeout(refresh, 100);
    }
  });
}

// Visibility change
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refresh();
  }
});

// Initial load
refresh();
