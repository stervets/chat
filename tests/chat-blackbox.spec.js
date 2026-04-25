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

test('black-box: invite with roomIds=[] keeps invite rooms empty and does not join default group', async () => {
  await withClient(async (adminClient) => {
    await loginByPassword(adminClient, CONFIG.adminNickname, CONFIG.adminPassword);

    const invite = assertNoApiError(
      await adminClient.request('invites:create', {roomIds: []}),
      'invites:create roomIds=[]',
    );
    expect(Number(invite?.id || 0)).toBeGreaterThan(0);
    expect(Array.isArray(invite?.rooms)).toBe(true);
    expect(invite.rooms.length).toBe(0);

    const newcomer = new WsRpcClient(CONFIG.backendWsUrl);
    await newcomer.connect();
    try {
      const nickname = makeUniqueNickname('invite_empty');
      const password = '123';
      const redeemed = assertNoApiError(await newcomer.request('invites:redeem', {
        code: invite.code,
        nickname,
        name: nickname,
        password,
      }), 'invites:redeem roomIds=[]');
      expect(Number(redeemed?.user?.id || 0)).toBeGreaterThan(0);

      const joinedBeforeDefault = assertNoApiError(
        await newcomer.request('room:list', {kind: 'group', scope: 'joined'}),
        'room:list joined before default',
      );
      const joinedBeforeIds = new Set(
        (Array.isArray(joinedBeforeDefault) ? joinedBeforeDefault : [])
          .map((room) => Number(room?.roomId || room?.dialogId || room?.id || 0))
          .filter((roomId) => Number.isFinite(roomId) && roomId > 0),
      );
      const joinedBeforeTitles = new Set(
        (Array.isArray(joinedBeforeDefault) ? joinedBeforeDefault : [])
          .map((room) => String(room?.title || '').trim())
          .filter((title) => title.length > 0),
      );
      expect(joinedBeforeTitles.has('Общий чат')).toBe(false);

      const defaultGroup = assertNoApiError(
        await newcomer.request('room:group:get-default', {}),
        'room:group:get-default newcomer',
      );
      const defaultRoomId = Number(defaultGroup?.roomId || 0);
      expect(defaultRoomId).toBeGreaterThan(0);
      expect(defaultGroup?.joined).toBe(false);
      expect(joinedBeforeIds.has(defaultRoomId)).toBe(false);

      const joinedAfterDefault = assertNoApiError(
        await newcomer.request('room:list', {kind: 'group', scope: 'joined'}),
        'room:list joined after default',
      );
      const joinedAfterIds = new Set(
        (Array.isArray(joinedAfterDefault) ? joinedAfterDefault : [])
          .map((room) => Number(room?.roomId || room?.dialogId || room?.id || 0))
          .filter((roomId) => Number.isFinite(roomId) && roomId > 0),
      );
      const joinedAfterTitles = new Set(
        (Array.isArray(joinedAfterDefault) ? joinedAfterDefault : [])
          .map((room) => String(room?.title || '').trim())
          .filter((title) => title.length > 0),
      );
      expect(joinedAfterIds.has(defaultRoomId)).toBe(false);
      expect(joinedAfterTitles.has('Общий чат')).toBe(false);
    } finally {
      await newcomer.close();
    }
  });
});

test('black-box: room pin/unpin allowed only for room admin', async () => {
  await withClient(async (adminClient) => {
    await loginByPassword(adminClient, CONFIG.adminNickname, CONFIG.adminPassword);

    const memberNickname = makeUniqueNickname('pin_member');
    const memberPassword = '123';
    const memberSeed = await createUserViaInvite(adminClient, memberNickname, memberPassword);
    expect(Number(memberSeed?.user?.id || 0)).toBeGreaterThan(0);

    const memberClient = new WsRpcClient(CONFIG.backendWsUrl);
    await memberClient.connect();
    try {
      await restoreSession(memberClient, memberSeed.token);

      const room = assertNoApiError(await adminClient.request('room:create', {
        title: `bb-pin-admin-${Date.now()}`,
        visibility: 'public',
      }), 'room:create for pin');
      const roomId = Number(room?.roomId || 0);
      expect(roomId).toBeGreaterThan(0);

      const joined = assertNoApiError(await memberClient.request('room:join', {
        roomId,
      }), 'member room:join');
      expect(joined.joined).toBe(true);

      const createdMessage = assertNoApiError(await adminClient.request('message:create', {
        roomId,
        text: `bb-pin-source-${Date.now()}`,
      }), 'message:create for pin');
      const messageId = Number(createdMessage?.message?.id || 0);
      expect(messageId).toBeGreaterThan(0);

      const pinByMember = await memberClient.request('room:pin:set', {
        roomId,
        nodeId: messageId,
      });
      expect(pinByMember).toMatchObject({
        ok: false,
        error: 'forbidden',
      });

      const unpinByMember = await memberClient.request('room:pin:clear', {
        roomId,
      });
      expect(unpinByMember).toMatchObject({
        ok: false,
        error: 'forbidden',
      });

      const pinByAdmin = assertNoApiError(await adminClient.request('room:pin:set', {
        roomId,
        nodeId: messageId,
      }), 'admin room:pin:set');
      expect(pinByAdmin.changed).toBe(true);
      expect(Number(pinByAdmin?.pinnedNodeId || 0)).toBe(messageId);

      const clearByAdmin = assertNoApiError(await adminClient.request('room:pin:clear', {
        roomId,
      }), 'admin room:pin:clear');
      expect(clearByAdmin.changed).toBe(true);
      expect(clearByAdmin.pinnedNodeId).toBeNull();
    } finally {
      await memberClient.close();
    }
  });
});

test('black-box: direct room delete clears messages but keeps direct room', async () => {
  await withClient(async (userAClient) => {
    await loginByPassword(userAClient, CONFIG.adminNickname, CONFIG.adminPassword);
    const userAMe = assertNoApiError(await userAClient.request('auth:me', {}), 'A auth:me');
    const userAId = Number(userAMe?.id || 0);
    expect(userAId).toBeGreaterThan(0);

    const userBNickname = makeUniqueNickname('direct_peer');
    const userBPassword = '123';
    const userBSeed = await createUserViaInvite(userAClient, userBNickname, userBPassword);
    expect(Number(userBSeed?.user?.id || 0)).toBeGreaterThan(0);

    const userBClient = new WsRpcClient(CONFIG.backendWsUrl);
    await userBClient.connect();
    try {
      await restoreSession(userBClient, userBSeed.token);
      const userBId = Number(userBSeed?.user?.id || 0);

      const directByA = assertNoApiError(await userAClient.request('room:direct:get-or-create', {
        userId: userBId,
      }), 'A room:direct:get-or-create');
      const directByB = assertNoApiError(await userBClient.request('room:direct:get-or-create', {
        userId: userAId,
      }), 'B room:direct:get-or-create');
      const directRoomId = Number(directByA?.roomId || 0);
      expect(directRoomId).toBeGreaterThan(0);
      expect(Number(directByB?.roomId || 0)).toBe(directRoomId);

      const directByBSubscribed = assertNoApiError(await userBClient.request('room:get', {
        roomId: directRoomId,
        subscribe: true,
      }), 'B room:get subscribe direct');
      expect(Number(directByBSubscribed?.roomId || 0)).toBe(directRoomId);

      assertNoApiError(await userAClient.request('message:create', {
        roomId: directRoomId,
        text: `bb-direct-clear-a-${Date.now()}`,
      }), 'A message:create #1');
      assertNoApiError(await userAClient.request('message:create', {
        roomId: directRoomId,
        text: `bb-direct-clear-b-${Date.now()}`,
      }), 'A message:create #2');

      const messagesBeforeDelete = assertNoApiError(await userBClient.request('message:list', {
        roomId: directRoomId,
        limit: 50,
      }), 'B message:list before clear');
      expect(Array.isArray(messagesBeforeDelete)).toBe(true);
      expect(messagesBeforeDelete.length).toBeGreaterThan(0);

      const directClearedEventByBPromise = userBClient.waitForEvent('room:messages:cleared', {
        timeoutMs: 10_000,
        predicate: (payload) => Number(payload?.roomId || 0) === directRoomId,
      });
      const directDeletedEventByBPromise = userBClient.waitForEvent('room:deleted', {
        timeoutMs: 2_000,
        predicate: (payload) => Number(payload?.roomId || 0) === directRoomId,
      });

      const clearByA = assertNoApiError(await userAClient.request('room:delete', {
        roomId: directRoomId,
        confirm: true,
      }), 'A room:delete direct clear');
      expect(clearByA.changed).toBe(true);
      expect(clearByA.kind).toBe('direct');

      const directClearedEventByB = await directClearedEventByBPromise;
      expect(directClearedEventByB?.event).toBe('room:messages:cleared');
      expect(Number(directClearedEventByB?.payload?.roomId || 0)).toBe(directRoomId);
      expect(Number(directClearedEventByB?.payload?.dialogId || 0)).toBe(directRoomId);
      expect(String(directClearedEventByB?.payload?.kind || '')).toBe('direct');
      await expect(directDeletedEventByBPromise).rejects.toThrow('ws_event_timeout:room:deleted');

      const roomByAAfterClear = assertNoApiError(await userAClient.request('room:get', {
        roomId: directRoomId,
      }), 'A room:get after clear');
      const roomByBAfterClear = assertNoApiError(await userBClient.request('room:get', {
        roomId: directRoomId,
      }), 'B room:get after clear');
      expect(roomByAAfterClear.kind).toBe('direct');
      expect(roomByBAfterClear.kind).toBe('direct');

      const membersByA = assertNoApiError(await userAClient.request('room:members:list', {
        roomId: directRoomId,
      }), 'A room:members:list direct');
      const membersByB = assertNoApiError(await userBClient.request('room:members:list', {
        roomId: directRoomId,
      }), 'B room:members:list direct');
      expect(Array.isArray(membersByA)).toBe(true);
      expect(Array.isArray(membersByB)).toBe(true);
      const memberIdsA = new Set(membersByA.map((user) => Number(user?.id || 0)));
      const memberIdsB = new Set(membersByB.map((user) => Number(user?.id || 0)));
      expect(memberIdsA.has(userAId)).toBe(true);
      expect(memberIdsA.has(userBId)).toBe(true);
      expect(memberIdsB.has(userAId)).toBe(true);
      expect(memberIdsB.has(userBId)).toBe(true);

      const messagesAfterClearByA = assertNoApiError(await userAClient.request('message:list', {
        roomId: directRoomId,
        limit: 50,
      }), 'A message:list after clear');
      const messagesAfterClearByB = assertNoApiError(await userBClient.request('message:list', {
        roomId: directRoomId,
        limit: 50,
      }), 'B message:list after clear');
      expect(Array.isArray(messagesAfterClearByA)).toBe(true);
      expect(Array.isArray(messagesAfterClearByB)).toBe(true);
      expect(messagesAfterClearByA.length).toBe(0);
      expect(messagesAfterClearByB.length).toBe(0);

      const directAgainByA = assertNoApiError(await userAClient.request('room:direct:get-or-create', {
        userId: userBId,
      }), 'A room:direct:get-or-create after clear');
      const directAgainByB = assertNoApiError(await userBClient.request('room:direct:get-or-create', {
        userId: userAId,
      }), 'B room:direct:get-or-create after clear');
      expect(Number(directAgainByA?.roomId || 0)).toBe(directRoomId);
      expect(Number(directAgainByB?.roomId || 0)).toBe(directRoomId);

      assertNoApiError(await userAClient.request('message:create', {
        roomId: directRoomId,
        text: `bb-direct-clear-again-${Date.now()}`,
      }), 'A message:create after first clear');

      const clearByB = assertNoApiError(await userBClient.request('room:delete', {
        roomId: directRoomId,
        confirm: true,
      }), 'B room:delete direct clear');
      expect(clearByB.kind).toBe('direct');

      const messagesAfterSecondClearByA = assertNoApiError(await userAClient.request('message:list', {
        roomId: directRoomId,
        limit: 50,
      }), 'A message:list after B clear');
      const messagesAfterSecondClearByB = assertNoApiError(await userBClient.request('message:list', {
        roomId: directRoomId,
        limit: 50,
      }), 'B message:list after B clear');
      expect(messagesAfterSecondClearByA.length).toBe(0);
      expect(messagesAfterSecondClearByB.length).toBe(0);
    } finally {
      await userBClient.close();
    }
  });
});
