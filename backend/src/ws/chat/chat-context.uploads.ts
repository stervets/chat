import {Prisma} from '@prisma/client';
import {db} from '../../db.js';
import {deleteUploadFile, sanitizeUploadName} from '../../common/uploads.js';
import {MAX_MESSAGES_PER_ROOM, UPLOAD_LINK_RE} from './chat-context.types.js';

export class ChatContextUploads {
  async pruneRoomOverflow(roomId: number) {
    await db.$executeRaw(
      Prisma.sql`
        delete from nodes
        where id in (
          select id from (
            select
              m.id,
              row_number() over (order by m.created_at desc, m.id desc) as rn
            from messages m
            join nodes n on n.id = m.id
            left join rooms r on r.id = ${roomId}
            where n.parent_id = ${roomId}
              and (r.pinned_node_id is null or r.pinned_node_id <> m.id)
          ) ranked
          where rn > ${MAX_MESSAGES_PER_ROOM}
        )
      `,
    );
  }

  extractUploadNamesFromRawText(rawTextRaw: unknown) {
    const rawText = String(rawTextRaw || '');
    const names = new Set<string>();

    UPLOAD_LINK_RE.lastIndex = 0;
    for (const match of rawText.matchAll(UPLOAD_LINK_RE)) {
      const safeName = sanitizeUploadName(match[1]);
      if (!safeName) continue;
      names.add(safeName);
    }

    return Array.from(names);
  }

  async isUploadUsed(fileName: string) {
    const uploadPath = `/uploads/${fileName}`;
    const [message, user, room] = await Promise.all([
      db.message.findFirst({
        where: {
          rawText: {
            contains: uploadPath,
          },
        },
        select: {id: true},
      }),
      db.user.findFirst({
        where: {avatarPath: uploadPath},
        select: {id: true},
      }),
      db.room.findFirst({
        where: {avatarPath: uploadPath},
        select: {id: true},
      }),
    ]);

    return !!message?.id || !!user?.id || !!room?.id;
  }

  async cleanupUnusedUploads(uploadNamesRaw: string[]) {
    const uploadNames = Array.from(new Set(uploadNamesRaw.filter(Boolean)));
    if (!uploadNames.length) return;

    for (const fileName of uploadNames) {
      if (await this.isUploadUsed(fileName)) continue;
      deleteUploadFile(fileName);
    }
  }

  async collectUploadNamesFromNodeSubtree(rootNodeIdRaw: unknown): Promise<string[]> {
    const rootNodeId = Number(rootNodeIdRaw || 0);
    if (!Number.isFinite(rootNodeId) || rootNodeId <= 0) return [];

    const rows = await db.$queryRaw<Array<{rawText: string | null}>>(Prisma.sql`
      with recursive subtree as (
        select id
        from nodes
        where id = ${rootNodeId}
        union all
        select child.id
        from nodes child
        join subtree parent on parent.id = child.parent_id
      )
      select m.raw_text as "rawText"
      from messages m
      join subtree s on s.id = m.id
      union all
      select r.avatar_path as "rawText"
      from rooms r
      join subtree s on s.id = r.id
    `);

    const uploadNames = rows.flatMap((row) => this.extractUploadNamesFromRawText(row.rawText || ''));
    return Array.from(new Set(uploadNames));
  }
}
