export * from './chat-context.types.js';
import {ChatContextInput} from './chat-context.input.js';
import {ChatContextMessages} from './chat-context.messages.js';
import {ChatContextResult} from './chat-context.result.js';
import {ChatContextSystem} from './chat-context.system.js';
import {ChatContextUploads} from './chat-context.uploads.js';
import {ChatContextUsers} from './chat-context.users.js';

export class ChatContext {
  readonly result = new ChatContextResult();
  readonly input = new ChatContextInput();
  readonly uploads = new ChatContextUploads();
  readonly users = new ChatContextUsers();
  readonly system = new ChatContextSystem();
  readonly messages = new ChatContextMessages(this.users);
}
