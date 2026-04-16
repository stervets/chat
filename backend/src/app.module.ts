import {Module} from '@nestjs/common';
import {ChatGateway} from './ws/chat.gateway.js';
import {ChatService} from './ws/chat.service.js';

@Module({
  providers: [ChatGateway, ChatService],
})
export class AppModule {}
