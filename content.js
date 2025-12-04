/**
 * ChatGPT Branch Tree - Content Script
 * Handles conversation data fetching, tree building, and DOM interactions
 */
(() => {
  // Constants
  const STORAGE_KEY = "chatgpt_branch_data";
  const HIGHLIGHT_CLASS = "branch-tree-highlight";
  const PANEL_ID = "branch-tree-panel";
  const PANEL_STATE_KEY = "branchPanelOpen";
  const CACHE_TTL_MS = 30000; // 30 second cache TTL for conversations
  const OBSERVER_THROTTLE_MS = 500; // Throttle observer callbacks
  const DEBUG_FLAG_KEY = "branchTreeDebug";

  // Debug logging toggle (persisted in storage for dev mode)
  let debugLoggingEnabled = false;
  chrome.storage?.local?.get(DEBUG_FLAG_KEY, (data) => {
    debugLoggingEnabled = Boolean(data?.[DEBUG_FLAG_KEY]);
  });

  function debugLog(...args) {
    if (debugLoggingEnabled) {
      console.log(...args);
    }
  }

  // ============================================
  // Conversation Cache
  // ============================================

  // Simple cache for fetched conversations with TTL
  const conversationCache = new Map();

  function getCachedConversation(conversationId) {
    const cached = conversationCache.get(conversationId);
    if (!cached) return null;
    
    // Check if cache entry has expired
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      conversationCache.delete(conversationId);
      return null;
    }
    
    return cached.data;
  }

  function setCachedConversation(conversationId, data) {
    conversationCache.set(conversationId, {
      data,
      timestamp: Date.now(),
    });
  }

  function clearConversationCache() {
    conversationCache.clear();
  }

  // ============================================
  // API & Data Fetching
  // ============================================

  function getConversationId() {
    const match = location.pathname.match(/\/c\/([0-9a-f-]+)/i);
    return match?.[1] || null;
  }

  function getBaseUrl() {
    return location.hostname.includes("openai")
      ? "https://chat.openai.com"
      : "https://chatgpt.com";
  }

  async function getAccessToken() {
    const res = await fetch(`${getBaseUrl()}/api/auth/session`, { credentials: "include" });
    if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
    const data = await res.json();
    if (!data?.accessToken) throw new Error("No access token");
    return data.accessToken;
  }

  async function fetchConversation(conversationId, useCache = true) {
    // Check cache first (unless explicitly disabled)
    if (useCache) {
      const cached = getCachedConversation(conversationId);
      if (cached) {
        debugLog("[BranchTree] Using cached conversation:", conversationId);
        return cached;
      }
    }

    const token = await getAccessToken();
    const res = await fetch(`${getBaseUrl()}/backend-api/conversation/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Conversation fetch failed: ${res.status}`);
    const data = await res.json();
    
    // Cache the result
    setCachedConversation(conversationId, data);
    
    return data;
  }

  // ============================================
  // Storage Helpers
  // ============================================

  async function loadBranchData() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data?.[STORAGE_KEY] || { branches: {}, titles: {} };
  }

  async function saveBranchData(data) {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  /**
   * Record a branch relationship
   * @param parentConvId - Parent conversation ID
   * @param childConvId - Child conversation ID  
   * @param childTitle - Title of child conversation
   * @param branchTimestamp - Timestamp when branch was created
   * @param firstMessage - First user message in branch
   * @param existingData - Optional existing branch data to avoid re-loading
   */
  async function recordBranch(parentConvId, childConvId, childTitle, branchTimestamp, firstMessage, existingData = null) {
    const data = existingData || await loadBranchData();
    if (!data.branches[parentConvId]) data.branches[parentConvId] = [];
    
    const exists = data.branches[parentConvId].some((b) => b.childId === childConvId);
    if (!exists) {
      // Convert milliseconds to seconds to match ChatGPT's timestamp format
      const timestampInSeconds = Math.floor((branchTimestamp || Date.now()) / 1000);
      data.branches[parentConvId].push({
        childId: childConvId,
        title: childTitle || "Conversation",
        firstMessage: firstMessage || null, // Store first user message for better branch naming
        createdAt: timestampInSeconds,
      });
      debugLog("[BranchTree] Recorded branch:", {
        parentConvId,
        childConvId,
        firstMessage: firstMessage?.slice(0, 30),
        createdAt: timestampInSeconds,
        date: new Date(timestampInSeconds * 1000).toLocaleString()
      });
    }
    data.titles[childConvId] = childTitle || data.titles[childConvId] || "Conversation";
    await saveBranchData(data);
    return data;
  }

  // ============================================
  // Color Hashing
  // ============================================

  /**
   * Generate a deterministic color index from a conversation ID
   * This ensures the same branch always gets the same color
   */
  function hashConversationId(convId) {
    if (!convId) return 0;
    let hash = 0;
    for (let i = 0; i < convId.length; i++) {
      hash = ((hash << 5) - hash) + convId.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // ============================================
  // Tree Building
  // ============================================

  /**
   * Find if a conversation is a child branch and return parent info
   */
  function findParentBranch(conversationId, branchData) {
    for (const [parentId, children] of Object.entries(branchData.branches || {})) {
      const found = children.find((c) => c.childId === conversationId);
      if (found) {
        return { parentId, branchInfo: found };
      }
    }
    return null;
  }

  /**
   * Recursively fetch the ancestry chain for a conversation
   * Returns array of ancestors from root to immediate parent
   */
  async function fetchAncestryChain(conversationId, branchData, visited = new Set()) {
    // Prevent infinite loops
    if (visited.has(conversationId)) {
      return [];
    }
    visited.add(conversationId);

    const parentInfo = findParentBranch(conversationId, branchData);
    if (!parentInfo) {
      // This is a root conversation
      return [];
    }

    const { parentId, branchInfo } = parentInfo;

    try {
      // Fetch parent conversation data
      const parentConv = await fetchConversation(parentId);
      
      // Recursively get ancestors of the parent
      const ancestorChain = await fetchAncestryChain(parentId, branchData, visited);
      
      // Return chain with this parent added
      return [
        ...ancestorChain,
        {
          conversationId: parentId,
          conv: parentConv,
          title: parentConv.title || branchData.titles?.[parentId] || "Conversation",
          childBranchId: conversationId,
          branchInfo: branchInfo,
        }
      ];
    } catch (err) {
      console.error("[BranchTree] Failed to fetch ancestor:", parentId, err);
      return [];
    }
  }

  function extractText(message) {
    if (!message) return "";
    if (Array.isArray(message.content?.parts)) {
      return message.content.parts.join("\n").trim();
    }
    return message.content?.text?.trim() || "";
  }

  /**
   * Check if a message is an internal ChatGPT message that should be filtered
   */
  function isInternalMessage(text) {
    if (!text) return false;
    // Filter out internal ChatGPT branching messages
    return text.startsWith("Original custom instructions");
  }

  /**
   * Extract the first user message from a conversation mapping
   * Used for better branch naming
   * @param mapping - The conversation mapping
   * @param excludeTimestamps - Optional set of timestamps to exclude (for filtering carry-over messages)
   */
  function extractFirstUserMessage(mapping, excludeTimestamps = null) {
    const userMessages = [];
    for (const [id, entry] of Object.entries(mapping || {})) {
      const msg = entry?.message;
      if (!msg || msg.author?.role !== "user") continue;
      
      const text = extractText(msg);
      if (!text || !text.trim()) continue;
      if (isInternalMessage(text)) continue;
      
      const createTime = msg.create_time || 0;
      const timestampSeconds = Math.floor(toSeconds(createTime));
      
      // Filter out carry-over messages from parent if excludeTimestamps provided
      if (excludeTimestamps && excludeTimestamps.has(timestampSeconds)) continue;
      
      userMessages.push({
        text,
        createTime,
      });
    }
    userMessages.sort((a, b) => a.createTime - b.createTime);
    return userMessages[0]?.text || null;
  }

  /**
   * Get all user message timestamps from a conversation mapping
   */
  function getMessageTimestamps(mapping) {
    const timestamps = new Set();
    for (const [id, entry] of Object.entries(mapping || {})) {
      const msg = entry?.message;
      if (!msg || msg.author?.role !== "user") continue;
      const createTime = msg.create_time || 0;
      timestamps.add(Math.floor(toSeconds(createTime)));
    }
    return timestamps;
  }

  /**
   * Normalize timestamp to seconds (ChatGPT uses seconds)
   */
  function toSeconds(ts) {
    if (!ts || ts <= 0) return 0;
    // If timestamp > 1e12, it's in milliseconds, convert to seconds
    return ts > 1e12 ? ts / 1000 : ts;
  }

  /**
   * Recursively collect all nested branch nodes for a given conversation
   * Returns an array of branch node objects (without messages) for all descendants
   * @param conversationId - The conversation to get nested branches for
   * @param branchData - The branch data from storage
   * @param baseDepth - The depth level to start from
   * @param parentPath - The hierarchical path prefix (e.g., "1.2")
   * @param parentColorIndex - The color index of the parent for color inheritance
   * @param visited - Set of visited conversation IDs to prevent infinite loops
   */
  function collectNestedBranches(conversationId, branchData, baseDepth, parentPath, parentColorIndex, visited = new Set()) {
    if (visited.has(conversationId)) return [];
    visited.add(conversationId);

    const result = [];
    const directBranches = branchData.branches?.[conversationId] || [];
    
    // Sort branches by creation time
    const sortedBranches = [...directBranches].sort(
      (a, b) => toSeconds(a.createdAt || 0) - toSeconds(b.createdAt || 0)
    );

    sortedBranches.forEach((branch, idx) => {
      const branchPath = parentPath ? `${parentPath}.${idx + 1}` : `${idx + 1}`;
      // Use hash of conversation ID for consistent coloring
      const colorIndex = hashConversationId(branch.childId);
      const branchNode = {
        id: `nested-branch:${branch.childId}`,
        type: "nested-branch",
        text: branch.firstMessage || branch.title || "Branched conversation",
        createTime: toSeconds(branch.createdAt || 0),
        targetConversationId: branch.childId,
        colorIndex: colorIndex, // Deterministic color based on conversation ID
        nestedBranchIndex: idx, // Index within this level for potential differentiation
        depth: baseDepth,
        branchPath: branchPath,
        isNestedPreview: true, // Flag to indicate this is a compact preview node
      };
      result.push(branchNode);

      // Recursively collect deeper nested branches
      const deeperBranches = collectNestedBranches(
        branch.childId,
        branchData,
        baseDepth + 1,
        branchPath,
        colorIndex,
        visited
      );
      result.push(...deeperBranches);
    });

    return result;
  }

  /**
   * Build a unified tree showing full ancestry with current branch expanded
   */
  function buildAncestryTree(ancestryChain, currentConv, currentConvId, branchData) {
    const result = [];
    
    // Collect all ancestor message timestamps for filtering carry-over messages
    const ancestorTimestamps = new Set();
    
    // Track the branchIndex that leads to current conversation (for ordering)
    let currentBranchIndex = 0;
    // Track the colorIndex for consistent coloring (only when ancestry exists)
    let currentColorIndex = ancestryChain.length > 0
      ? hashConversationId(currentConvId)
      : undefined;
    
    // Track hierarchical branch path (e.g., "1", "1.2", "1.2.1")
    let branchPath = "";
    
    // Track the colorIndex from the previous level to apply to current level's messages
    let prevLevelColorIndex = null;
    
    // Store post-branch messages from ALL ancestors to show after current content
    // Each ancestor level may have messages sent after the branch point
    let allPostBranchItems = [];
    
    // Process each ancestor level
    for (let level = 0; level < ancestryChain.length; level++) {
      const ancestor = ancestryChain[level];
      const baseDepth = level;
      const isImmediateParent = level === ancestryChain.length - 1;
      const nextAncestorChildId = level < ancestryChain.length - 1 
        ? ancestryChain[level + 1].conversationId 
        : currentConvId;
      
      // Only add title node for the root level (level 0)
      // Other levels are indicated by the expanded branch that leads to them
      if (level === 0) {
        result.push({
          id: `title:${ancestor.conversationId}`,
          type: "title",
          text: ancestor.title,
          depth: baseDepth,
          ancestorLevel: level,
          targetConversationId: ancestor.conversationId,
        });
      }
      
      // Extract user messages from this ancestor
      const userMessages = [];
      const levelTimestamps = []; // Track timestamps from this level to add after filtering
      
      for (const [id, entry] of Object.entries(ancestor.conv.mapping || {})) {
        const msg = entry?.message;
        if (!msg || msg.author?.role !== "user") continue;
        
        const text = extractText(msg);
        if (!text || !text.trim()) continue;
        
        // Filter out internal ChatGPT messages
        if (isInternalMessage(text)) continue;
        
        const createTime = msg.create_time || 0;
        const timestampSeconds = Math.floor(toSeconds(createTime));
        
        // For levels > 0, filter out messages already shown from previous ancestors
        // This handles ChatGPT's carry-over messages when branching
        if (level > 0 && ancestorTimestamps.has(timestampSeconds)) {
          debugLog("[BranchTree] Filtering duplicate ancestor message:", text.slice(0, 30), "at level:", level);
          continue;
        }
        
        // Track this timestamp to add to ancestorTimestamps after processing this level
        levelTimestamps.push(timestampSeconds);
        
        userMessages.push({
          id,
          type: "message",
          role: "user",
          text,
          createTime,
          depth: baseDepth,
          ancestorLevel: level,
          // Apply branch color from the branch that led INTO this level
          // Level 0 (root) has no incoming branch, so no colorIndex
          colorIndex: level > 0 ? prevLevelColorIndex : undefined,
          targetConversationId: ancestor.conversationId,
        });
      }
      userMessages.sort((a, b) => a.createTime - b.createTime);
      
      // Add this level's timestamps to the cumulative set for filtering subsequent levels
      levelTimestamps.forEach(ts => ancestorTimestamps.add(ts));
      
      // Get branches from this ancestor
      const branches = branchData.branches?.[ancestor.conversationId] || [];
      const branchNodes = branches.map((branch, idx) => ({
        id: `branch:${branch.childId}`,
        type: "branch",
        // Use first message for better indication of branch content, fallback to title
        text: branch.firstMessage || branch.title || "Branched conversation",
        createTime: toSeconds(branch.createdAt || 0),
        targetConversationId: branch.childId,
        colorIndex: hashConversationId(branch.childId), // Deterministic color based on conversation ID
        branchIndex: idx, // Keep for ordering purposes
        depth: baseDepth + 1,
        // Mark if this branch leads to current conversation
        expanded: branch.childId === nextAncestorChildId,
        isCurrentPath: branch.childId === nextAncestorChildId,
        ancestorLevel: level,
      }));
      branchNodes.sort((a, b) => a.createTime - b.createTime);
      // Reassign branchIndex after sorting, and build branchPath for each
      branchNodes.forEach((node, idx) => { 
        node.branchIndex = idx;
        // Build hierarchical path: "1", "1.2", "1.2.1", etc.
        node.branchPath = branchPath ? `${branchPath}.${idx + 1}` : `${idx + 1}`;
        // Collect nested branches for non-expanded branches (for compact preview when collapsed)
        if (!node.expanded) {
          node.nestedBranches = collectNestedBranches(
            node.targetConversationId,
            branchData,
            node.depth + 1, // Nested branches start one level deeper
            node.branchPath,
            node.colorIndex // Pass colorIndex for color inheritance
          );
        }
      });
      
      // Find the branch that leads to current conversation
      const expandedBranch = branchNodes.find(b => b.expanded);
      if (expandedBranch) {
        currentBranchIndex = expandedBranch.branchIndex;
        currentColorIndex = expandedBranch.colorIndex; // Track color index for current path
        // Update branchPath for next level
        branchPath = expandedBranch.branchPath;
        // Store this colorIndex to apply to next level's messages
        prevLevelColorIndex = expandedBranch.colorIndex;
      }
      
      // Merge messages and branches chronologically
      const allItems = [...userMessages, ...branchNodes].sort(
        (a, b) => toSeconds(a.createTime) - toSeconds(b.createTime)
      );
      
      // For ANY ancestor with an expanded branch, split items around the branch
      // to collect post-branch messages that should appear after all child content
      if (expandedBranch) {
        // Mark if this is the immediate parent (for "viewing" label)
        if (isImmediateParent) {
          expandedBranch.isViewing = true;
        }
        
        const expandedBranchTime = toSeconds(expandedBranch.createTime);
        
        // Items before or at branch time (including the branch itself)
        const preBranchItems = allItems.filter(item => 
          toSeconds(item.createTime) <= expandedBranchTime
        );
        
        // Messages after branch time - these should appear AFTER all child content
        const postBranchItems = allItems.filter(item => 
          toSeconds(item.createTime) > expandedBranchTime
        );
        
        result.push(...preBranchItems);
        
        // Collect post-branch items from ALL ancestors
        if (postBranchItems.length > 0) {
          allPostBranchItems.push(...postBranchItems);
          debugLog("[BranchTree] Collected post-branch items from level", level, ":", postBranchItems.length);
        }
      } else {
        result.push(...allItems);
      }
    }
    
    // Now add the current conversation's content
    const currentDepth = ancestryChain.length;
    
    // Add current conversation's user messages
    const currentMessages = [];
    for (const [id, entry] of Object.entries(currentConv.mapping || {})) {
      const msg = entry?.message;
      if (!msg || msg.author?.role !== "user") continue;
      
      const text = extractText(msg);
      if (!text || !text.trim()) continue;
      
      // Filter out internal ChatGPT messages
      if (isInternalMessage(text)) continue;
      
      const createTime = msg.create_time || 0;
      const timestampSeconds = Math.floor(toSeconds(createTime));
      
      // Filter out carry-over messages that match ancestor timestamps (Issue 3)
      if (ancestorTimestamps.has(timestampSeconds)) {
        debugLog("[BranchTree] Filtering carry-over message:", text.slice(0, 30), "timestamp:", timestampSeconds);
        continue;
      }
      
      currentMessages.push({
        id,
        type: "message",
        role: "user",
        text,
        createTime,
        depth: currentDepth,
        isCurrent: true,
        colorIndex: currentColorIndex, // Propagate branch color using colorIndex
        targetConversationId: currentConvId,
      });
    }
    currentMessages.sort((a, b) => a.createTime - b.createTime);
    
    // Add branches from current conversation
    const currentBranches = branchData.branches?.[currentConvId] || [];
    const currentBranchNodes = currentBranches.map((branch, idx) => ({
      id: `branch:${branch.childId}`,
      type: "branch",
      // Use first message for better indication of branch content, fallback to title
      text: branch.firstMessage || branch.title || "Branched conversation",
      createTime: toSeconds(branch.createdAt || 0),
      targetConversationId: branch.childId,
      colorIndex: hashConversationId(branch.childId), // Deterministic color based on conversation ID
      branchIndex: idx, // Keep for ordering purposes
      depth: currentDepth + 1,
      expanded: false,
      isCurrent: true,
    }));
    currentBranchNodes.sort((a, b) => a.createTime - b.createTime);
    currentBranchNodes.forEach((node, idx) => { 
      node.branchIndex = idx;
      // Build hierarchical path for branches from current conversation
      node.branchPath = branchPath ? `${branchPath}.${idx + 1}` : `${idx + 1}`;
      // Collect nested branches for this branch (for compact preview when collapsed)
      node.nestedBranches = collectNestedBranches(
        node.targetConversationId,
        branchData,
        node.depth + 1, // Nested branches start one level deeper
        node.branchPath,
        node.colorIndex // Pass colorIndex for color inheritance
      );
    });
    
    // Add current items sorted chronologically (branches + messages)
    const currentItems = [...currentMessages, ...currentBranchNodes].sort(
      (a, b) => toSeconds(a.createTime) - toSeconds(b.createTime)
    );
    result.push(...currentItems);
    
    // Add ALL post-branch ancestor items AFTER all current conversation content
    // These are messages from ANY ancestor that were sent after their respective branch points
    // IMPORTANT: These items return to the main line, so clear their colorIndex
    if (allPostBranchItems.length > 0) {
      // Sort by creation time to maintain chronological order
      allPostBranchItems.sort((a, b) => toSeconds(a.createTime) - toSeconds(b.createTime));
      // For root depth (0), return to main line color; otherwise keep branch color
      const mainLineItems = allPostBranchItems.map(item => ({
        ...item,
        colorIndex: item.depth === 0 ? undefined : (item.colorIndex ?? currentColorIndex),
        isPostBranch: true, // Mark for debugging
      }));
      result.push(...mainLineItems);
      debugLog("[BranchTree] Added", mainLineItems.length, "post-branch items at the end (returned to main line)");
    }
    
    debugLog("[BranchTree] Ancestry tree built:", result.map(n => ({
      type: n.type,
      depth: n.depth,
      expanded: n.expanded,
      colorIndex: n.colorIndex,
      text: (n.text || "").slice(0, 25) + "..."
    })));
    
    return result;
  }

  /**
   * Build a flat display list from ChatGPT conversation mapping
   * Shows: user messages with branch indicators inserted at correct positions
   */
  function buildDisplayList(mapping, branchData, conversationId) {
    const branches = branchData.branches?.[conversationId] || [];
    
    // DEBUG: Log branch data
    debugLog("[BranchTree] Building display list for:", conversationId);
    debugLog("[BranchTree] Branch data:", JSON.stringify(branches, null, 2));
    
    // Step 1: Extract all user messages with timestamps
    const userMessages = [];
    for (const [id, entry] of Object.entries(mapping || {})) {
      const msg = entry?.message;
      if (!msg) continue;
      
      const role = msg.author?.role;
      if (role !== "user") continue;
      
      const createTime = msg.create_time || 0;
      const text = extractText(msg);
      
      // Filter out empty or internal ChatGPT messages
      if (!text || !text.trim()) continue;
      if (isInternalMessage(text)) continue;
      
      userMessages.push({
        id,
        type: "message",
        role: "user",
        text,
        createTime,
        targetConversationId: conversationId,
      });
    }
    
    // Sort by creation time
    userMessages.sort((a, b) => a.createTime - b.createTime);
    
    // DEBUG: Log user messages with timestamps
    debugLog("[BranchTree] User messages:", userMessages.map(m => ({
      id: m.id.slice(0, 8) + "...",
      text: m.text.slice(0, 30) + "...",
      createTime: m.createTime,
      date: new Date(m.createTime * 1000).toLocaleString()
    })));
    
    // Step 2: Create branch nodes with their timestamps (normalized to seconds)
    const branchNodes = branches.map((branch, index) => ({
      id: `branch:${branch.childId}`,
      type: "branch",
      role: "branch",
      // Use first message for better indication of branch content, fallback to title
      text: branch.firstMessage || branch.title || "Branched conversation",
      createTime: toSeconds(branch.createdAt || 0),
      targetConversationId: branch.childId,
      colorIndex: hashConversationId(branch.childId), // Deterministic color based on conversation ID
      branchIndex: index, // Keep for ordering purposes
    }));
    
    // Sort branches by creation time, then reassign indices based on sorted order
    branchNodes.sort((a, b) => a.createTime - b.createTime);
    branchNodes.forEach((node, idx) => {
      node.branchIndex = idx;
      node.branchPath = `${idx + 1}`;
      // Collect nested branches for this branch (for compact preview when collapsed)
      node.nestedBranches = collectNestedBranches(
        node.targetConversationId,
        branchData,
        2, // Start nested branches at depth 2 (branch is at depth 1)
        node.branchPath,
        node.colorIndex // Pass colorIndex for color inheritance
      );
    });
    
    // DEBUG: Log branch nodes with timestamps and indices
    debugLog("[BranchTree] Branch nodes (NORMALIZED):", branchNodes.map(b => ({
      id: b.id,
      text: b.text,
      colorIndex: b.colorIndex,
      createTime: b.createTime,
      date: new Date(b.createTime * 1000).toLocaleString()
    })));
    
    // Step 3: Build the display list
    // Branches are just markers - messages in the current conversation stay on the main chain
    const result = [];
    
    // Combine and sort all items by createTime
    const allItems = [...userMessages, ...branchNodes].sort(
      (a, b) => toSeconds(a.createTime) - toSeconds(b.createTime)
    );
    
    debugLog("[BranchTree] Sorted items:", allItems.map(i => ({
      type: i.type,
      text: (i.text || "").slice(0, 20),
      time: toSeconds(i.createTime)
    })));
    
    // Simply add all items in chronological order
    // User messages at depth 0, branches at depth 1 (indented to show they're markers)
    for (const item of allItems) {
      if (item.type === "branch") {
        result.push({
          ...item,
          depth: 1,
          hasChildren: false,
          childCount: 0,
        });
      } else if (item.role === "user") {
        result.push({
          ...item,
          depth: 0,
        });
      }
    }
    
    // Step 5: Check if this conversation was branched from another
    let branchRoot = null;
    for (const [parentId, children] of Object.entries(branchData.branches || {})) {
      const found = children.find((c) => c.childId === conversationId);
      if (found) {
        branchRoot = {
          id: "branch-root",
          type: "branchRoot",
          role: "branch-root",
          text: branchData.titles?.[parentId] || "Parent conversation",
          targetConversationId: parentId,
          depth: 0,
        };
        break;
      }
    }
    
    // Prepend branch root if exists
    if (branchRoot) {
      result.unshift(branchRoot);
    }
    
    // DEBUG: Log final result
    debugLog("[BranchTree] Final display list:", result.map(n => ({
      type: n.type,
      depth: n.depth,
      branchIndex: n.branchIndex,
      text: (n.text || "").slice(0, 30) + "...",
      createTime: n.createTime
    })));
    
    return result;
  }

  // ============================================
  // DOM Interaction
  // ============================================

  function findMessageElement(nodeId) {
    if (!nodeId || nodeId.startsWith("branch")) return null;
    return (
      document.querySelector(`[data-message-id="${nodeId}"]`) ||
      document.querySelector(`[data-testid="conversation-turn-${nodeId}"]`) ||
      document.getElementById(nodeId)
    );
  }

  function scrollToMessage(nodeId) {
    const el = findMessageElement(nodeId);
    if (!el) return false;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 1500);
    return true;
  }

  function injectStyles() {
    if (document.getElementById("branch-tree-styles")) return;
    const style = document.createElement("style");
    style.id = "branch-tree-styles";
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

  // ============================================
  // Branch Detection
  // ============================================

  let pendingBranch = null;

  document.addEventListener("click", (e) => {
    // Detect "Branch in new chat" click
    const text = e.target?.textContent?.trim();
    if (text === "Branch in new chat") {
      const convId = getConversationId();
      if (convId) {
        // Store timestamp in seconds to match ChatGPT's format
        const timestampInSeconds = Math.floor(Date.now() / 1000);
        pendingBranch = {
          parentId: convId,
          timestamp: timestampInSeconds,
        };
        chrome.storage.local.set({ pendingBranch });
      debugLog("[BranchTree] Pending branch created:", {
          parentId: convId,
          timestamp: timestampInSeconds,
          date: new Date(timestampInSeconds * 1000).toLocaleString()
        });
      }
    }
  }, true);

  /**
   * Check and process pending branch creation
   * @param currentConvId - Current conversation ID
   * @param currentTitle - Current conversation title
   * @param mapping - Current conversation mapping
   * @param branchData - Pre-loaded branch data to avoid re-loading
   * @returns Updated branch data if modified, null otherwise
   */
  async function checkPendingBranch(currentConvId, currentTitle, mapping, branchData) {
    const data = await chrome.storage.local.get("pendingBranch");
    const pending = data?.pendingBranch;
    if (!pending) return null;

    const nowInSeconds = Math.floor(Date.now() / 1000);
    
    // Expire after 2 minutes (120 seconds)
    if (nowInSeconds - pending.timestamp > 120) {
      await chrome.storage.local.remove("pendingBranch");
      return null;
    }

    // Don't process if we're on the parent conversation
    if (pending.parentId === currentConvId) return null;

    // Fetch parent conversation to get its message timestamps
    // This allows us to filter out carry-over messages when extracting first message
    let parentTimestamps = null;
    try {
      const parentConv = await fetchConversation(pending.parentId);
      parentTimestamps = getMessageTimestamps(parentConv.mapping);
    debugLog("[BranchTree] Parent timestamps for filtering:", parentTimestamps.size);
    } catch (err) {
    debugLog("[BranchTree] Could not fetch parent for timestamp filtering:", err);
    }

    // Extract first user message for better branch naming (excluding carry-over messages)
    const firstMessage = extractFirstUserMessage(mapping, parentTimestamps);
    debugLog("[BranchTree] First unique message for branch:", firstMessage?.slice(0, 30));

    // Record the branch relationship with the timestamp when branch was clicked
    // Pass existing branchData to avoid re-loading
    const updatedData = await recordBranch(
      pending.parentId, 
      currentConvId, 
      currentTitle, 
      pending.timestamp * 1000, 
      firstMessage,
      branchData
    );
    await chrome.storage.local.remove("pendingBranch");
    
    debugLog("[BranchTree] Consumed pending branch:", pending);
    return updatedData;
  }

  // ============================================
  // Floating Panel
  // ============================================

  function createFloatingPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const PANEL_WIDTH = 340;

    // Container
    const container = document.createElement("div");
    container.id = PANEL_ID;
    Object.assign(container.style, {
      position: "fixed",
      top: "0",
      right: "0",
      width: `${PANEL_WIDTH}px`,
      height: "100vh",
      zIndex: "2147483646",
      pointerEvents: "none",
      transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      padding: "12px 0",
      boxSizing: "border-box",
    });

    // Iframe
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("panel.html");
    Object.assign(frame.style, {
      width: "100%",
      height: "100%",
      border: "1px solid rgba(128, 128, 128, 0.2)",
      borderRight: "none",
      pointerEvents: "auto",
      borderRadius: "12px 0 0 12px",
      boxShadow: "none",
    });

    // Toggle button
    const toggle = document.createElement("button");
    toggle.id = "branch-tree-toggle";
    toggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;
    Object.assign(toggle.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      border: "1px solid rgba(99, 102, 241, 0.3)",
      background: "#6366f1",
      color: "#fff",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "transform 0.2s, background 0.2s",
      pointerEvents: "auto",
    });

    let isOpen = false;

    const updateState = (open) => {
      isOpen = open;
      container.style.transform = open ? "translateX(0)" : `translateX(${PANEL_WIDTH}px)`;
      frame.style.display = open ? "block" : "none";
      document.body.style.marginRight = open ? `${PANEL_WIDTH}px` : "";
      toggle.style.transform = open ? "rotate(180deg)" : "";
      toggle.style.display = open ? "none" : "flex";
      chrome.storage.local.set({ [PANEL_STATE_KEY]: open });
    };

    // Expose toggle function globally for external calls
    window.__branchTreeToggle = () => updateState(!isOpen);

    toggle.addEventListener("click", () => updateState(!isOpen));
    toggle.addEventListener("mouseenter", () => {
      toggle.style.transform = isOpen ? "rotate(180deg) scale(1.1)" : "scale(1.1)";
    });
    toggle.addEventListener("mouseleave", () => {
      toggle.style.transform = isOpen ? "rotate(180deg)" : "";
    });

    container.appendChild(frame);
    document.body.appendChild(container);
    document.body.appendChild(toggle);

    // Restore state
    chrome.storage.local.get(PANEL_STATE_KEY).then((data) => {
      updateState(data?.[PANEL_STATE_KEY] ?? false);
    });

    // Sync state across tabs
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && PANEL_STATE_KEY in changes) {
        const newVal = changes[PANEL_STATE_KEY].newValue;
        if (newVal !== isOpen) updateState(newVal);
      }
    });
  }

  // ============================================
  // Message Handlers
  // ============================================

  async function handleGetTree() {
    const conversationId = getConversationId();
    if (!conversationId) {
      return { error: "No conversation ID found" };
    }

    try {
      // Fetch current conversation (may use cache for current conv)
      const conv = await fetchConversation(conversationId, false); // Don't cache current conv to get fresh data
      const title = conv.title || "Conversation";
      
      // Load branch data ONCE at the start
      let branchData = await loadBranchData();
      
      // Check for pending branch (pass branchData to avoid re-loading)
      const updatedData = await checkPendingBranch(conversationId, title, conv.mapping, branchData);
      if (updatedData) {
        branchData = updatedData; // Use updated data if branch was recorded
      }
      
      // Update title in branch data
      branchData.titles[conversationId] = title;
      await saveBranchData(branchData);

      // Check if this conversation has ancestors (is a child branch)
      // Pass branchData to avoid re-loading in ancestry chain
      const ancestryChain = await fetchAncestryChain(conversationId, branchData);
      
      let nodes;
      if (ancestryChain.length > 0) {
        // Build full ancestry tree with current conversation expanded
        debugLog("[BranchTree] Building ancestry tree with", ancestryChain.length, "ancestors");
        nodes = buildAncestryTree(ancestryChain, conv, conversationId, branchData);
      } else {
        // Root conversation - use simple display list
        nodes = buildDisplayList(conv.mapping, branchData, conversationId);
      }

      return {
        conversationId,
        title,
        nodes,
        hasAncestry: ancestryChain.length > 0,
      };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "GET_CONVERSATION_TREE") {
      handleGetTree().then(sendResponse);
      return true;
    }

    if (msg?.type === "FOCUS_MESSAGE") {
      injectStyles();
      const ok = scrollToMessage(msg.nodeId);
      sendResponse({ ok });
      return false;
    }

    if (msg?.type === "OPEN_CONVERSATION") {
      const url = `${getBaseUrl()}/c/${msg.conversationId}`;
      window.location.href = url;
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === "TOGGLE_PANEL") {
      if (typeof window.__branchTreeToggle === "function") {
        window.__branchTreeToggle();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === "CLEAR_CACHE") {
      clearConversationCache();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // ============================================
  // Auto-refresh
  // ============================================

  let refreshTimer = null;
  let isRefreshing = false;
  let lastObserverTrigger = 0; // For throttling

  async function refreshTree() {
    if (isRefreshing) return;
    isRefreshing = true;

    try {
      const result = await handleGetTree();
      if (!result.error) {
        chrome.runtime.sendMessage({
          type: "TREE_UPDATED",
          ...result,
        });
      }
    } catch (e) {
      // Ignore errors during auto-refresh
    } finally {
      isRefreshing = false;
    }
  }

  function scheduleRefresh(delay = 800) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      // Double-check we're not already refreshing when timer fires
      if (!isRefreshing) {
        refreshTree();
      }
    }, delay);
  }

  // Throttled schedule refresh (for MutationObserver)
  function throttledScheduleRefresh() {
    const now = Date.now();
    if (now - lastObserverTrigger < OBSERVER_THROTTLE_MS) {
      return; // Skip if called too recently
    }
    lastObserverTrigger = now;
    scheduleRefresh();
  }

  /**
   * Check if a mutation is relevant to conversation content
   * Filters out mutations that are unlikely to affect the tree
   */
  function isRelevantMutation(mutation) {
    // Check if mutation target or added nodes are in conversation area
    const target = mutation.target;
    
    // Ignore mutations in our own panel
    if (target.id === PANEL_ID || target.closest?.(`#${PANEL_ID}`)) {
      return false;
    }
    
    // Ignore mutations in scroll indicators, tooltips, etc.
    const ignoredClasses = ['tooltip', 'popover', 'scroll', 'cursor'];
    const targetClasses = target.className || '';
    if (typeof targetClasses === 'string') {
      for (const cls of ignoredClasses) {
        if (targetClasses.toLowerCase().includes(cls)) {
          return false;
        }
      }
    }
    
    // Check if mutation involves message-related elements
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      
      // Look for message containers or conversation turns
      if (node.matches?.('[data-message-id]') ||
          node.matches?.('[data-testid*="conversation"]') ||
          node.querySelector?.('[data-message-id]')) {
        return true;
      }
    }
    
    // For significant structural changes, still trigger refresh
    if (mutation.addedNodes.length > 3 || mutation.removedNodes.length > 3) {
      return true;
    }
    
    return false;
  }

  // Watch for DOM changes with throttling and filtering
  const observer = new MutationObserver((mutations) => {
    // Check if any mutation is relevant
    for (const m of mutations) {
      if (m.addedNodes.length || m.removedNodes.length) {
        if (isRelevantMutation(m)) {
          throttledScheduleRefresh();
          return; // Only need to trigger once
        }
      }
    }
  });

  // ============================================
  // Initialize
  // ============================================

  function init() {
    injectStyles();
    createFloatingPanel();
    
    // Observe with more targeted configuration
    // Still watch subtree but with throttling and filtering
    observer.observe(document.body, { 
      childList: true, 
      subtree: true,
      // Don't observe attributes or character data (reduces noise)
      attributes: false,
      characterData: false,
    });
    
    scheduleRefresh(100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
