import {randomBytes} from 'node:crypto';
import {Logger} from '@nestjs/common';
import {createSession, hashPassword} from '../../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {createRoomNode} from '../../common/nodes.js';
import {getOrCreateGroupRoom} from '../../common/rooms.js';
import {WgAdminClient, WgAdminClientError} from '../../common/wg-admin.client.js';
import {config} from '../../config.js';
import {db} from '../../db.js';
import {
  ChatContext,
  DAY_MS,
  DONATION_BADGE_TTL_DAYS,
  SYSTEM_NICKNAME,
  type ApiError,
  type ApiOk,
  type PublicUser,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatInvitesService {
  private readonly logger = new Logger(ChatInvitesService.name);
  private readonly wgAdminClient = new WgAdminClient(config.wgAdminSocketPath);

  constructor(private readonly ctx: ChatContext) {}

  private publicUserSelect() {
    return {
      id: true,
      nickname: true,
      name: true,
      info: true,
      avatarPath: true,
      nicknameColor: true,
      donationBadgeUntil: true,
      pushDisableAllMentions: true,
    } as const;
  }

  private async resolveDefaultGroupRoomId() {
    const room = await getOrCreateGroupRoom();
    return room.id;
  }

  private async cleanupUsedInvites(ownerId: number) {
    await db.invite.deleteMany({
      where: {
        createdById: ownerId,
        usedAt: {
          not: null,
        },
      },
    });
  }

  async invitesList(state: SocketState): Promise<ApiError | any[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    await this.cleanupUsedInvites(state.user!.id);

    const result = await db.invite.findMany({
      where: {
        createdById: state.user!.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        rooms: {
          include: {
            room: {
              select: {
                id: true,
                title: true,
                visibility: true,
              },
            },
          },
        },
        usedBy: {
          select: this.publicUserSelect(),
        },
      },
    });

    return result.map((row) => ({
      id: row.id,
      code: row.code,
      createdAt: row.createdAt.toISOString(),
      usedAt: row.usedAt ? row.usedAt.toISOString() : null,
      usedBy: row.usedBy
        ? this.ctx.toPublicUser(row.usedBy)
        : null,
      isUsed: Boolean(row.usedAt),
      rooms: row.rooms.map((item) => ({
        roomId: item.room.id,
        title: item.room.title || 'Комната',
        visibility: item.room.visibility === 'private' ? 'private' : 'public',
      })),
    }));
  }

  async invitesCreate(state: SocketState, payloadRaw: {roomIds?: unknown}): Promise<ApiError | {
    id: number;
    code: string;
    createdAt: string;
    rooms: Array<{roomId: number; title: string; visibility: 'public' | 'private'}>;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const requestedRoomIds = Array.isArray(payloadRaw?.roomIds)
      ? Array.from(new Set(payloadRaw.roomIds
        .map((value) => Number.parseInt(String(value ?? ''), 10))
        .filter((value) => Number.isFinite(value) && value > 0)))
      : [];
    const defaultGroupRoomId = await this.resolveDefaultGroupRoomId();

    const selectedRooms = requestedRoomIds.length > 0
      ? await db.room.findMany({
        where: {
          id: {
            in: requestedRoomIds,
          },
          kind: 'group',
          roomUsers: {
            some: {
              userId: state.user!.id,
            },
          },
        },
        select: {
          id: true,
          title: true,
          visibility: true,
        },
      })
      : await db.room.findMany({
        where: {
          id: defaultGroupRoomId,
        },
        select: {
          id: true,
          title: true,
          visibility: true,
        },
      });

    if (!selectedRooms.length) {
      return {ok: false, error: 'invalid_rooms'};
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(8).toString('hex');
      try {
        const created = await db.invite.create({
          data: {
            code,
            createdById: state.user!.id,
            rooms: {
              create: selectedRooms.map((room) => ({
                roomId: room.id,
              })),
            },
          },
          select: {
            id: true,
            code: true,
            createdAt: true,
          },
        });

        return {
          id: created.id,
          code: created.code,
          createdAt: created.createdAt.toISOString(),
          rooms: selectedRooms.map((room) => ({
            roomId: room.id,
            title: room.title || 'Комната',
            visibility: room.visibility === 'private' ? 'private' : 'public',
          })),
        };
      } catch (err) {
        if (this.ctx.isUniqueError(err)) continue;
        throw err;
      }
    }

    return {ok: false, error: 'failed_to_generate_invite'};
  }

  async invitesAvailableRooms(state: SocketState): Promise<ApiError | Array<{
    roomId: number;
    title: string;
    visibility: 'public' | 'private';
    checkedByDefault: boolean;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const defaultGroupRoomId = await this.resolveDefaultGroupRoomId();
    const rooms = await db.room.findMany({
      where: {
        kind: 'group',
        roomUsers: {
          some: {
            userId: state.user!.id,
          },
        },
      },
      orderBy: [
        {id: 'asc'},
      ],
      select: {
        id: true,
        title: true,
        visibility: true,
      },
    });

    return rooms.map((room) => ({
      roomId: room.id,
      title: room.title || 'Комната',
      visibility: room.visibility === 'private' ? 'private' : 'public',
      checkedByDefault: room.id === defaultGroupRoomId,
    }));
  }

  async invitesDelete(state: SocketState, payloadRaw: {inviteId?: unknown}): Promise<ApiError | ApiOk<{deleted: boolean; inviteId: number}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const inviteId = Number.parseInt(String(payloadRaw?.inviteId ?? ''), 10);
    if (!Number.isFinite(inviteId) || inviteId <= 0) {
      return {ok: false, error: 'invalid_invite'};
    }

    const result = await db.invite.deleteMany({
      where: {
        id: inviteId,
        createdById: state.user!.id,
      },
    });

    return {
      ok: true,
      deleted: result.count > 0,
      inviteId,
    };
  }

  async invitesCheck(_state: SocketState, payload: any): Promise<ApiError | ApiOk<{code: string}>> {
    const code = (payload?.code || '').toString().trim();
    if (!code) {
      return {ok: false, error: 'invalid_input'};
    }

    const invite = await db.invite.findUnique({
      where: {code},
      select: {
        id: true,
        usedAt: true,
        expiresAt: true,
      },
    });

    if (!invite) {
      return {ok: false, error: 'invite_not_found'};
    }

    const isExpired = invite.expiresAt && invite.expiresAt < new Date();
    const isUsedUp = !!invite.usedAt;
    if (isExpired || isUsedUp) {
      return {ok: false, error: 'invite_invalid'};
    }

    return {
      ok: true,
      code,
    };
  }

  publicVpnInfo(_state: SocketState): ApiOk<{
    donationPhone: string;
    donationBank: string;
  }> {
    return {
      ok: true,
      donationPhone: String(config.vpn.donationPhone || ''),
      donationBank: String(config.vpn.donationBank || ''),
    };
  }

  async publicVpnProvision(state: SocketState): Promise<ApiError | ApiOk<{
    link: string;
    configText: string;
    qrText: string;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const awgUserName = String(state.user?.nickname || '').trim();
    if (!awgUserName) return this.ctx.unauthorized();

    try {
      const artifacts = await this.wgAdminClient.createOrGetUser(awgUserName);
      return {
        ok: true,
        link: artifacts.link,
        configText: artifacts.configText,
        qrText: artifacts.qrText,
      };
    } catch (err: any) {
      if (err instanceof WgAdminClientError) {
        this.logger.error(`vpn provision failed for "${awgUserName}": ${JSON.stringify({
          code: err.code,
          message: err.message,
          details: err.details || null,
        })}`);
      } else {
        this.logger.error(`vpn provision failed for "${awgUserName}": ${String(err?.message || err)}`);
      }

      return {ok: false, error: 'vpn_provision_failed'};
    }
  }

  async publicVpnDonation(state: SocketState, payload: any): Promise<ApiError | ApiOk<{user: PublicUser}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const hasSent = Object.prototype.hasOwnProperty.call(payload || {}, 'sent');
    if (!hasSent) {
      return {ok: false, error: 'invalid_input'};
    }

    const sent = Boolean(payload?.sent);
    const donationBadgeUntil = sent
      ? new Date(Date.now() + DONATION_BADGE_TTL_DAYS * DAY_MS)
      : null;

    const updatedUser = await db.user.update({
      where: {id: state.user!.id},
      data: {donationBadgeUntil},
      select: this.publicUserSelect(),
    });

    state.user = this.ctx.toPublicUser(updatedUser);
    return {ok: true, user: state.user};
  }

  async invitesRedeem(state: SocketState, payload: any): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: PublicUser;
  } | {
    appliedToExistingUser: true;
    addedRoomIds: number[];
    roomsAdded: number;
    user: PublicUser;
  }>> {
    const code = (payload?.code || '').toString().trim();
    if (!code) {
      return {ok: false, error: 'invalid_input'};
    }
    const defaultGroupRoomId = await this.resolveDefaultGroupRoomId();
    const authorizedUserId = Number(state.user?.id || 0);

    const resolveTargetRoomIds = async (
      tx: any,
      inviteRoomIds: number[],
    ) => {
      const newsRoom = await tx.room.findFirst({
        where: {
          kind: 'group',
          postOnlyByAdmin: true,
          title: {
            in: ['Новости MARX', 'MARX'],
          },
        },
        select: {
          id: true,
        },
      });

      const targetRoomIdsSet = new Set<number>(
        inviteRoomIds.length > 0
          ? inviteRoomIds
          : [defaultGroupRoomId],
      );
      if (newsRoom?.id) {
        targetRoomIdsSet.add(newsRoom.id);
      }

      return Array.from(targetRoomIdsSet);
    };

    if (Number.isFinite(authorizedUserId) && authorizedUserId > 0) {
      try {
        const redeemed = await db.$transaction(async (tx) => {
          const invite = await tx.invite.findUnique({
            where: {code},
            select: {
              id: true,
              usedAt: true,
              expiresAt: true,
              rooms: {
                select: {
                  roomId: true,
                },
              },
            },
          });

          if (!invite) {
            throw new Error('invite_not_found');
          }

          const isExpired = invite.expiresAt && invite.expiresAt < new Date();
          const isUsedUp = !!invite.usedAt;
          if (isExpired || isUsedUp) {
            throw new Error('invite_invalid');
          }

          const targetRoomIds = await resolveTargetRoomIds(
            tx,
            invite.rooms.map((room) => room.roomId),
          );

          const existingMemberships = targetRoomIds.length > 0
            ? await tx.roomUser.findMany({
              where: {
                userId: authorizedUserId,
                roomId: {
                  in: targetRoomIds,
                },
              },
              select: {
                roomId: true,
              },
            })
            : [];
          const existingRoomIds = new Set(existingMemberships.map((row) => Number(row.roomId || 0)));
          const addedRoomIds = targetRoomIds.filter((roomId) => !existingRoomIds.has(roomId));

          if (addedRoomIds.length > 0) {
            await tx.roomUser.createMany({
              data: addedRoomIds.map((roomId) => ({
                roomId,
                userId: authorizedUserId,
              })),
              skipDuplicates: true,
            });
          }

          const updatedInvite = await tx.invite.updateMany({
            where: {
              id: invite.id,
              usedAt: null,
            },
            data: {
              usedById: authorizedUserId,
              usedAt: new Date(),
            },
          });
          if (updatedInvite.count === 0) {
            throw new Error('invite_invalid');
          }

          await tx.invite.deleteMany({
            where: {
              id: invite.id,
            },
          });

          return {
            addedRoomIds,
          };
        });

        return {
          ok: true,
          appliedToExistingUser: true,
          addedRoomIds: redeemed.addedRoomIds,
          roomsAdded: redeemed.addedRoomIds.length,
          user: state.user!,
        };
      } catch (err: any) {
        const knownError = String(err?.message || '');
        if (knownError === 'invite_not_found' || knownError === 'invite_invalid') {
          return {ok: false, error: knownError};
        }
        throw err;
      }
    }

    const nicknameParsed = this.ctx.parseNickname(payload?.nickname);
    if (!nicknameParsed.ok) {
      return {ok: false, error: nicknameParsed.error};
    }
    const nickname = nicknameParsed.nickname;
    const password = (payload?.password || '').toString();

    if (!password) {
      return {ok: false, error: 'invalid_input'};
    }

    const passwordHash = await hashPassword(password);
    const name = this.ctx.normalizeName(payload?.name, nickname);

    try {
      const createdUser = await db.$transaction(async (tx) => {
        const invite = await tx.invite.findUnique({
          where: {code},
          select: {
            id: true,
            usedAt: true,
            expiresAt: true,
            rooms: {
              select: {
                roomId: true,
              },
            },
          },
        });

        if (!invite) {
          throw new Error('invite_not_found');
        }

        const isExpired = invite.expiresAt && invite.expiresAt < new Date();
        const isUsedUp = !!invite.usedAt;
        if (isExpired || isUsedUp) {
          throw new Error('invite_invalid');
        }

        const existingUser = await tx.user.findUnique({
          where: {nickname},
          select: {id: true},
        });
        if (existingUser) {
          throw new Error('nickname_taken');
        }

        const user = await tx.user.create({
          data: {
            nickname,
            name,
            nicknameColor: DEFAULT_NICKNAME_COLOR,
            passwordHash,
          },
          select: this.publicUserSelect(),
        });

        const updatedInvite = await tx.invite.updateMany({
          where: {
            id: invite.id,
            usedAt: null,
          },
          data: {
            usedById: user.id,
            usedAt: new Date(),
          },
        });

        if (updatedInvite.count === 0) {
          throw new Error('invite_invalid');
        }

        await tx.invite.deleteMany({
          where: {
            id: invite.id,
          },
        });

        const systemUser = await tx.user.findUnique({
          where: {
            nickname: SYSTEM_NICKNAME,
          },
          select: {id: true},
        });

        const targetRoomIds = await resolveTargetRoomIds(
          tx,
          invite.rooms.map((room) => room.roomId),
        );
        if (targetRoomIds.length > 0) {
          await tx.roomUser.createMany({
            data: targetRoomIds.map((roomId) => ({
              roomId,
              userId: user.id,
            })),
            skipDuplicates: true,
          });
        }

        if (systemUser && systemUser.id !== user.id) {
          const existingSystemRoom = await tx.room.findFirst({
            where: {
              kind: 'direct',
              roomUsers: {
                some: {userId: systemUser.id},
              },
              AND: [
                {
                  roomUsers: {
                    some: {userId: user.id},
                  },
                },
                {
                  roomUsers: {
                    every: {
                      userId: {
                        in: [systemUser.id, user.id],
                      },
                    },
                  },
                },
              ],
            },
            select: {id: true},
          });

          if (!existingSystemRoom) {
            const createdRoom = await createRoomNode(tx, {
              kind: 'direct',
              title: null,
              nodeData: {},
            });
            await tx.roomUser.createMany({
              data: [
                {
                  roomId: createdRoom.room.id,
                  userId: systemUser.id,
                },
                {
                  roomId: createdRoom.room.id,
                  userId: user.id,
                },
              ],
              skipDuplicates: true,
            });
          }
        }

        return user;
      });

      const session = await createSession(createdUser.id, {
        ip: state.ip,
        userAgent: state.userAgent,
      });

      state.user = this.ctx.toPublicUser(createdUser);
      state.token = session.token;

      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: state.user,
      };
    } catch (err: any) {
      const knownError = String(err?.message || '');
      if (knownError === 'invite_not_found' || knownError === 'invite_invalid' || knownError === 'nickname_taken') {
        return {ok: false, error: knownError};
      }
      if (this.ctx.isUniqueError(err)) {
        return {ok: false, error: 'nickname_taken'};
      }
      throw err;
    }
  }
}
