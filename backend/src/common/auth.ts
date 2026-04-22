import {randomBytes, randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {db} from '../db.js';
import {DEFAULT_NICKNAME_COLOR, SESSION_TTL_DAYS} from './const.js';

export type ResolvedSession = {
  user: {
    id: number;
    nickname: string;
    name: string;
    nicknameColor: string | null;
    donationBadgeUntil: string | null;
    pushDisableAllMentions: boolean;
  };
  token: string;
  expiresAt: string;
};

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function createSession(userId: number, meta?: {ip?: string | null; userAgent?: string | null}) {
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const expiresAtDate = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const ip = meta?.ip || null;
  const userAgent = meta?.userAgent || null;

  await db.session.create({
    data: {
      id: sessionId,
      userId,
      token,
      expiresAt: expiresAtDate,
      ip,
      userAgent,
    },
  });

  return {token, expiresAt: expiresAtDate.toISOString()};
}

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const now = new Date();
  const row = await db.session.findFirst({
    where: {
      token,
      expiresAt: {
        gt: now,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          nickname: true,
          name: true,
          nicknameColor: true,
          donationBadgeUntil: true,
          pushDisableAllMentions: true,
        },
      },
    },
  });

  if (!row || !row.user) return null;

  return {
    token: row.token,
    expiresAt: row.expiresAt.toISOString(),
    user: {
      id: row.user.id,
      nickname: row.user.nickname,
      name: row.user.name || row.user.nickname,
      nicknameColor: row.user.nicknameColor || DEFAULT_NICKNAME_COLOR,
      donationBadgeUntil: row.user.donationBadgeUntil ? row.user.donationBadgeUntil.toISOString() : null,
      pushDisableAllMentions: !!row.user.pushDisableAllMentions,
    },
  };
}

export async function revokeSession(token: string) {
  return db.session.deleteMany({
    where: {token},
  });
}
