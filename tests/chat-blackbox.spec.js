const {test, expect} = require('@playwright/test');
const {
  CONFIG,
  WsRpcClient,
  assertNoApiError,
  loginByPassword,
  restoreSession,
  createUserViaInvite,
  uploadTinyPng,
  makeUniqueNickname,
} = require('./helpers/e2e');

async function withClient(fn) {
  const client = new WsRpcClient(CONFIG.backendWsUrl);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function waitForHttpStatus(url, expectedStatus, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let lastStatus = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const response = await fetch(url, {method: 'GET'});
      lastStatus = response.status;
      if (response.status === expectedStatus) {
        return;
      }
    } catch {
      lastStatus = -1;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`unexpected_status: ${url} expected=${expectedStatus} actual=${lastStatus}`);
}

test('black-box: login + restore session', async () => {
  await withClient(async (client) => {
    const logged = await loginByPassword(client, CONFIG.adminNickname, CONFIG.adminPassword);
    expect(typeof logged.token).toBe('string');
    expect(logged.token.length).toBeGreaterThan(10);

    const token = logged.token;

    const meBefore = assertNoApiError(await client.request('auth:me', {}), 'auth:me before restore');
    expect(meBefore.id).toBeGreaterThan(0);

    const restored = await withClient(async (sessionClient) => {
      const sessionResult = await restoreSession(sessionClient, token);
      const meAfter = assertNoApiError(await sessionClient.request('auth:me', {}), 'auth:me after restore');
      return {sessionResult, meAfter};
    });

    expect(restored.sessionResult.user.id).toBe(meBefore.id);
    expect(restored.meAfter.id).toBe(meBefore.id);
    expect(restored.sessionResult.token).toBe(token);
  });
});

test('black-box: send message in group/direct', async () => {
  await withClient(async (adminClientA) => {
    const adminLogin = await loginByPassword(adminClientA, CONFIG.adminNickname, CONFIG.adminPassword);

    const groupRoom = assertNoApiError(
      await adminClientA.request('room:group:get-default', {}),
      'room:group:get-default',
    );

    const groupText = `bb-group-${Date.now()}`;
    const groupCreated = assertNoApiError(await adminClientA.request('message:create', {
      roomId: groupRoom.roomId,
      text: groupText,
    }), 'message:create group');
    expect(Number(groupCreated?.message?.id || 0)).toBeGreaterThan(0);

    const groupMessages = assertNoApiError(await adminClientA.request('message:list', {
      roomId: groupRoom.roomId,
      limit: 50,
    }), 'message:list group');
    expect(Array.isArray(groupMessages)).toBe(true);
    expect(groupMessages.some((message) => message.id === groupCreated.message.id)).toBe(true);

    const peerNickname = makeUniqueNickname('peer');
    const peerPassword = '123';
    const peer = await createUserViaInvite(adminClientA, peerNickname, peerPassword);
    expect(peer.user.id).toBeGreaterThan(0);

    const adminClientB = new WsRpcClient(CONFIG.backendWsUrl);
    await adminClientB.connect();
    try {
      await restoreSession(adminClientB, adminLogin.token);

      const directRequests = [];
      for (let index = 0; index < 8; index += 1) {
        const client = index % 2 === 0 ? adminClientA : adminClientB;
        directRequests.push(client.request('room:direct:get-or-create', {userId: peer.user.id}));
      }

      const directResults = (await Promise.all(directRequests))
        .map((result) => assertNoApiError(result, 'room:direct:get-or-create'));

      const roomIds = Array.from(new Set(directResults.map((result) => Number(result.roomId || 0)).filter(Boolean)));
      expect(roomIds.length).toBe(1);

      const directRoomId = roomIds[0];
      const directText = `bb-direct-${Date.now()}`;

      const directCreated = assertNoApiError(await adminClientA.request('message:create', {
        roomId: directRoomId,
        text: directText,
      }), 'message:create direct');
      expect(Number(directCreated?.message?.id || 0)).toBeGreaterThan(0);

      const directMessages = assertNoApiError(await adminClientA.request('message:list', {
        roomId: directRoomId,
        limit: 50,
      }), 'message:list direct');
      expect(Array.isArray(directMessages)).toBe(true);
      expect(directMessages.some((message) => message.id === directCreated.message.id)).toBe(true);

      const directRooms = assertNoApiError(await adminClientA.request('room:list', {kind: 'direct'}), 'room:list direct');
      expect(Array.isArray(directRooms)).toBe(true);
      const dialogsWithPeer = directRooms.filter((item) => Number(item?.targetUser?.id || 0) === peer.user.id);
      expect(dialogsWithPeer).toHaveLength(1);
      expect(Number(dialogsWithPeer[0].roomId || 0)).toBe(directRoomId);
    } finally {
      await adminClientB.close();
    }
  });
});

test('black-box: create comment room', async () => {
  await withClient(async (client) => {
    await loginByPassword(client, CONFIG.adminNickname, CONFIG.adminPassword);

    const groupRoom = assertNoApiError(
      await client.request('room:group:get-default', {}),
      'room:group:get-default',
    );

    const sourceCreated = assertNoApiError(await client.request('message:create', {
      roomId: groupRoom.roomId,
      text: `bb-comment-source-${Date.now()}`,
    }), 'message:create source');
    const sourceMessageId = Number(sourceCreated?.message?.id || 0);
    expect(sourceMessageId).toBeGreaterThan(0);

    const commentCreated = assertNoApiError(await client.request('message:comment-room:create', {
      messageId: sourceMessageId,
    }), 'message:comment-room:create');
    expect(Number(commentCreated.commentRoomId || 0)).toBeGreaterThan(0);

    const commentRoomId = Number(commentCreated.commentRoomId || 0);

    const commentGet = assertNoApiError(await client.request('message:comment-room:get', {
      messageId: sourceMessageId,
    }), 'message:comment-room:get');
    expect(Number(commentGet.commentRoomId || 0)).toBe(commentRoomId);

    const roomDetails = assertNoApiError(await client.request('room:get', {
      roomId: commentRoomId,
    }), 'room:get comment');
    expect(roomDetails.kind).toBe('comment');
    expect(Number(roomDetails?.discussion?.sourceMessageId || 0)).toBe(sourceMessageId);

    const commentText = `bb-comment-reply-${Date.now()}`;
    const commentMessage = assertNoApiError(await client.request('message:create', {
      roomId: commentRoomId,
      text: commentText,
    }), 'message:create comment');
    expect(Number(commentMessage?.message?.id || 0)).toBeGreaterThan(0);

    const commentMessages = assertNoApiError(await client.request('message:list', {
      roomId: commentRoomId,
      limit: 50,
    }), 'message:list comment');
    expect(Array.isArray(commentMessages)).toBe(true);
    expect(commentMessages.some((item) => item.id === commentMessage.message.id)).toBe(true);
  });
});

test('black-box: upload image + delete source + verify cleanup', async () => {
  await withClient(async (client) => {
    const login = await loginByPassword(client, CONFIG.adminNickname, CONFIG.adminPassword);
    const token = String(login.token || '').trim();
    expect(token.length).toBeGreaterThan(10);

    const roomForMessageDelete = assertNoApiError(await client.request('room:create', {
      title: `bb-upload-message-delete-${Date.now()}`,
    }), 'room:create message delete room');
    expect(Number(roomForMessageDelete.roomId || 0)).toBeGreaterThan(0);

    const uploadRoot = await uploadTinyPng(CONFIG.backendHttpBase, token, `root-${Date.now()}`);
    const uploadChild = await uploadTinyPng(CONFIG.backendHttpBase, token, `child-${Date.now()}`);

    await waitForHttpStatus(uploadRoot.url, 200);
    await waitForHttpStatus(uploadChild.url, 200);

    const rootMessage = assertNoApiError(await client.request('message:create', {
      roomId: roomForMessageDelete.roomId,
      text: `file-root ${uploadRoot.url}`,
    }), 'message:create root with upload');

    const branch = assertNoApiError(await client.request('message:comment-room:create', {
      messageId: rootMessage.message.id,
    }), 'message:comment-room:create for root message');

    const branchRoomId = Number(branch.commentRoomId || 0);
    expect(branchRoomId).toBeGreaterThan(0);

    assertNoApiError(await client.request('message:create', {
      roomId: branchRoomId,
      text: `file-child ${uploadChild.url}`,
    }), 'message:create child with upload');

    const deletedRoot = assertNoApiError(await client.request('message:delete', {
      messageId: rootMessage.message.id,
    }), 'message:delete root');
    expect(deletedRoot.changed).toBe(true);

    await waitForHttpStatus(uploadRoot.url, 404);
    await waitForHttpStatus(uploadChild.url, 404);

    const roomForRoomDelete = assertNoApiError(await client.request('room:create', {
      title: `bb-upload-room-delete-${Date.now()}`,
    }), 'room:create room delete room');
    expect(Number(roomForRoomDelete.roomId || 0)).toBeGreaterThan(0);

    const uploadRoomRoot = await uploadTinyPng(CONFIG.backendHttpBase, token, `room-root-${Date.now()}`);
    const uploadRoomChild = await uploadTinyPng(CONFIG.backendHttpBase, token, `room-child-${Date.now()}`);

    await waitForHttpStatus(uploadRoomRoot.url, 200);
    await waitForHttpStatus(uploadRoomChild.url, 200);

    const roomRootMessage = assertNoApiError(await client.request('message:create', {
      roomId: roomForRoomDelete.roomId,
      text: `file-room-root ${uploadRoomRoot.url}`,
    }), 'message:create room root with upload');

    const roomBranch = assertNoApiError(await client.request('message:comment-room:create', {
      messageId: roomRootMessage.message.id,
    }), 'message:comment-room:create for room root');

    assertNoApiError(await client.request('message:create', {
      roomId: Number(roomBranch.commentRoomId || 0),
      text: `file-room-child ${uploadRoomChild.url}`,
    }), 'message:create room child with upload');

    const roomDeleted = assertNoApiError(await client.request('room:delete', {
      roomId: roomForRoomDelete.roomId,
      confirm: true,
    }), 'room:delete');
    expect(roomDeleted.changed).toBe(true);

    await waitForHttpStatus(uploadRoomRoot.url, 404);
    await waitForHttpStatus(uploadRoomChild.url, 404);
  });
});
