const assert = require('node:assert/strict');

(async () => {
  const {
    cleanChatGPTConversationId,
    extractChatGPTConversationIdFromPath,
    findParentBranch,
    buildBranchContextNodes
  } = await import('../core/chatgpt-branch-utils.js');

  // cleanChatGPTConversationId
  assert.equal(cleanChatGPTConversationId('WEB:abc-123'), 'abc-123');
  assert.equal(cleanChatGPTConversationId('abc-123'), 'abc-123');
  assert.equal(cleanChatGPTConversationId(null), null);

  // extractChatGPTConversationIdFromPath
  assert.equal(
    extractChatGPTConversationIdFromPath('/c/WEB:abc-123'),
    'WEB:abc-123'
  );
  assert.equal(
    extractChatGPTConversationIdFromPath('/c/abc-123'),
    'abc-123'
  );
  assert.equal(extractChatGPTConversationIdFromPath('/foo'), null);

  // findParentBranch + buildBranchContextNodes
  const branchData = {
    branches: {
      parent1: [
        { childId: 'childA', title: 'Child A', firstMessage: 'Hi', createdAt: 10 },
        { childId: 'childB', title: 'Child B', firstMessage: 'Yo', createdAt: 20 }
      ]
    },
    titles: { parent1: 'Parent Chat' }
  };

  const parentInfo = findParentBranch(branchData, 'childB');
  assert.deepEqual(parentInfo, {
    parentId: 'parent1',
    branchIndex: 1,
    branch: branchData.branches.parent1[1]
  });

  const context = buildBranchContextNodes({
    branchData,
    parentId: 'parent1',
    currentConversationId: 'childB'
  });
  assert.equal(context.ancestorTitle?.type, 'ancestor-title');
  assert.equal(context.branchRoot?.type, 'branchRoot');
  assert.equal(context.branchNodes.length, 2);
  assert.equal(context.branchNodes[1].isViewing, true);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
