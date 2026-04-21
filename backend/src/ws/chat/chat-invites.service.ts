import {randomBytes} from 'node:crypto';
import {Logger} from '@nestjs/common';
import {createSession, hashPassword} from '../../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
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

  async invitesList(state: SocketState): Promise<ApiError | any[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const result = await db.invite.findMany({
      where: {
        createdById: state.user!.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        usedBy: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
      },
    });

    return result.map((row) => ({
      id: row.id,
      code: row.code,
      createdAt: row.createdAt.toISOString(),
      usedAt: row.usedAt ? row.usedAt.toISOString() : null,
      usedBy: row.usedBy
        ? {
          id: row.usedBy.id,
          nickname: row.usedBy.nickname,
          name: row.usedBy.name || row.usedBy.nickname,
          nicknameColor: row.usedBy.nicknameColor || DEFAULT_NICKNAME_COLOR,
          donationBadgeUntil: this.ctx.normalizeDonationBadgeUntil(row.usedBy.donationBadgeUntil),
        }
        : null,
      isUsed: Boolean(row.usedAt),
    }));
  }

  async invitesCreate(state: SocketState): Promise<ApiError | {
    id: number;
    code: string;
    createdAt: string;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(8).toString('hex');
      try {
        const created = await db.invite.create({
          data: {
            code,
            createdById: state.user!.id,
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
        };
      } catch (err) {
        if (this.ctx.isUniqueError(err)) continue;
        throw err;
      }
    }

    return {ok: false, error: 'failed_to_generate_invite'};
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
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        donationBadgeUntil: true,
      },
    });

    state.user = this.ctx.toPublicUser(updatedUser);
    return {ok: true, user: state.user};
  }

  async invitesRedeem(state: SocketState, payload: any): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: PublicUser;
  }>> {
    const code = (payload?.code || '').toString().trim();
    const nicknameParsed = this.ctx.parseNickname(payload?.nickname);
    if (!nicknameParsed.ok) {
      return {ok: false, error: nicknameParsed.error};
    }
    const nickname = nicknameParsed.nickname;
    const password = (payload?.password || '').toString();

    if (!code || !password) {
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
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
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

        const systemUser = await tx.user.findUnique({
          where: {
            nickname: SYSTEM_NICKNAME,
          },
          select: {id: true},
        });

        const groupRooms = await tx.room.findMany({
          where: {kind: 'group'},
          select: {id: true},
        });
        if (groupRooms.length > 0) {
          await tx.roomUser.createMany({
            data: groupRooms.map((room) => ({
              roomId: room.id,
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
            const createdRoom = await tx.room.create({
              data: {
                kind: 'direct',
              },
              select: {id: true},
            });
            await tx.roomUser.createMany({
              data: [
                {
                  roomId: createdRoom.id,
                  userId: systemUser.id,
                },
                {
                  roomId: createdRoom.id,
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
