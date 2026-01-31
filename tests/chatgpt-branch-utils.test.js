const assert = require('node:assert/strict');

(async () => {
  const {
    cleanChatGPTConversationId,
    extractChatGPTConversationIdFromPath,
    isPreBranchChatGPTId,
    selectFirstMessageAfterTimestamp,
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
    extractChatGPTConversationIdFromPath('/c/web:abc-123'),
    'web:abc-123'
  );
  assert.equal(
    extractChatGPTConversationIdFromPath('/c/abc-123'),
    'abc-123'
  );
  assert.equal(extractChatGPTConversationIdFromPath('/foo'), null);

  // isPreBranchChatGPTId
  assert.equal(isPreBranchChatGPTId('WEB:abc-123'), true);
  assert.equal(isPreBranchChatGPTId('web:abc-123'), true);
  assert.equal(isPreBranchChatGPTId('abc-123'), false);
  assert.equal(isPreBranchChatGPTId(null), false);

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
  assert.equal(context.branchNodes[0].branchLabel, 'Branch: Child A');
  assert.equal(context.branchNodes[0].icon, 'branch');

  // selectFirstMessageAfterTimestamp
  const messageSample = [
    { text: 'old', createTime: 1 },
    { text: 'new', createTime: 5 }
  ];
  assert.equal(selectFirstMessageAfterTimestamp(messageSample, 4), 'new');
  assert.equal(selectFirstMessageAfterTimestamp(messageSample, 10), 'old');
  assert.equal(selectFirstMessageAfterTimestamp(messageSample, null), 'old');

  const unsortedSample = [
    { text: 'later', createTime: 9 },
    { text: 'first', createTime: 2 },
    { text: '', createTime: 4 }
  ];
  assert.equal(selectFirstMessageAfterTimestamp(unsortedSample, 3), 'later');
  assert.equal(selectFirstMessageAfterTimestamp(unsortedSample, 0), 'first');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
