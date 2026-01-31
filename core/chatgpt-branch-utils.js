export function cleanChatGPTConversationId(id) {
  if (!id) return null;
  return id.replace(/^WEB:/i, '');
}

export function extractChatGPTConversationIdFromPath(pathname = '') {
  const match = pathname.match(/\/c\/((?:WEB:)?[0-9a-f-]+)/i);
  return match?.[1] || null;
}

export function findParentBranch(branchData, childId) {
  if (!branchData?.branches || !childId) return null;
  for (const [parentId, branches] of Object.entries(branchData.branches)) {
    const idx = branches.findIndex((branch) => branch.childId === childId);
    if (idx >= 0) {
      return { parentId, branchIndex: idx, branch: branches[idx] };
    }
  }
  return null;
}

export function buildBranchContextNodes({
  branchData,
  parentId,
  currentConversationId
}) {
  if (!branchData || !parentId) {
    return { ancestorTitle: null, branchRoot: null, branchNodes: [] };
  }

  const parentTitle = branchData.titles?.[parentId] || 'Conversation';

  const ancestorTitle = {
    id: `ancestor-title:${parentId}`,
    type: 'ancestor-title',
    text: parentTitle,
    depth: 0,
    targetConversationId: parentId,
    isMainViewing: false
  };

  const branchRoot = {
    id: `branch-root:${parentId}`,
    type: 'branchRoot',
    text: parentTitle,
    depth: 0,
    targetConversationId: parentId
  };

  const branches = branchData.branches?.[parentId] || [];
  const branchNodes = branches.map((branch, idx) => ({
    id: `branch:${branch.childId}`,
    type: 'branch',
    text: branch.firstMessage || branch.title || 'Branched conversation',
    createTime: branch.createdAt || 0,
    targetConversationId: branch.childId,
    branchIndex: idx,
    branchLabel: `Branch: ${branch.title || 'New Chat'}`,
    depth: 1,
    icon: 'branch',
    isViewing: branch.childId === currentConversationId
  }));

  return { ancestorTitle, branchRoot, branchNodes };
}
