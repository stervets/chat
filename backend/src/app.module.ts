import {Module} from '@nestjs/common';
import {ChatGateway} from './ws/chat.gateway.js';
import {UploadsController} from './http/uploads.controller.js';
import {NativePushService} from './common/native-push.js';

@Module({
  controllers: [UploadsController],
  providers: [ChatGateway, NativePushService],
})
export class AppModule {}
