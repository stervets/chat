import {Prisma} from '@prisma/client';
import type {SocketState} from '../protocol.js';
import type {ApiError} from './chat-context.types.js';

export class ChatContextResult {
  isUniqueError(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError
      && (err as {code?: string}).code === 'P2002';
  }

  unauthorized(): ApiError {
    return {ok: false, error: 'unauthorized'};
  }

  requireAuth(state: SocketState): ApiError | null {
    if (!state.user) return this.unauthorized();
    return null;
  }
}
