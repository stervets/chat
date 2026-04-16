import {Module} from '@nestjs/common';
import {ChatGateway} from './ws/chat.gateway.js';
import {ChatService} from './ws/chat.service.js';
import {UploadsController} from './http/uploads.controller.js';

@Module({
  controllers: [UploadsController],
  providers: [ChatGateway, ChatService],
})
export class AppModule {}
