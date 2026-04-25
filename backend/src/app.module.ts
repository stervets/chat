import {Module} from '@nestjs/common';
import {ChatGateway} from './ws/chat.gateway.js';
import {UploadsController} from './http/uploads.controller.js';
import {PushController} from './http/push.controller.js';
import {WebPushService} from './common/web-push.js';

@Module({
  controllers: [UploadsController, PushController],
  providers: [ChatGateway, WebPushService],
})
export class AppModule {}
