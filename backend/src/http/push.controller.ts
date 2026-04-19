import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {resolveSession} from '../common/auth.js';
import {WebPushService} from '../common/web-push.js';

@Controller('push')
export class PushController {
  private readonly logger = new Logger(PushController.name);

  constructor(private readonly webPushService: WebPushService) {}

  private resolveToken(req: any) {
    const header = String(req?.headers?.authorization || '').trim();
    if (!header.toLowerCase().startsWith('bearer ')) return '';
    return header.slice(7).trim();
  }

  private async resolveSessionOrThrow(req: any) {
    const token = this.resolveToken(req);
    if (!token) {
      throw new UnauthorizedException('unauthorized');
    }

    const session = await resolveSession(token);
    if (!session) {
      throw new UnauthorizedException('unauthorized');
    }

    return session;
  }

  private parseSubscription(payload: any) {
    const endpoint = String(payload?.endpoint || '').trim();
    const p256dh = String(payload?.keys?.p256dh || '').trim();
    const auth = String(payload?.keys?.auth || '').trim();

    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException('invalid_subscription');
    }

    if (!/^https?:\/\//i.test(endpoint)) {
      throw new BadRequestException('invalid_subscription_endpoint');
    }

    return {
      endpoint,
      keys: {
        p256dh,
        auth,
      },
    };
  }

  private shortEndpoint(endpointRaw: unknown) {
    const endpoint = String(endpointRaw || '').trim();
    if (!endpoint) return 'empty';
    if (endpoint.length <= 40) return endpoint;
    return `${endpoint.slice(0, 18)}...${endpoint.slice(-12)}`;
  }

  @Get('public-key')
  @HttpCode(200)
  getPublicKey() {
    return this.webPushService.getPublicConfig();
  }

  @Post('subscribe')
  @HttpCode(200)
  async subscribe(
    @Req() req: any,
    @Body() body: any,
  ) {
    const session = await this.resolveSessionOrThrow(req);
    const subscription = this.parseSubscription(body);
    this.logger.log(`Push subscribe request userId=${session.user.id} endpoint=${this.shortEndpoint(subscription.endpoint)}`);

    try {
      const result = await this.webPushService.upsertSubscription(session.user.id, subscription, req?.headers?.['user-agent']);
      this.logger.log(`Push subscribe success userId=${session.user.id} endpoint=${this.shortEndpoint(subscription.endpoint)}`);
      return result;
    } catch (error: any) {
      this.logger.error(
        `Push subscribe failed userId=${session.user.id} endpoint=${this.shortEndpoint(subscription.endpoint)} dbError="${String(error?.message || error || 'unknown_error').replace(/\s+/g, ' ').trim()}"`
      );
      throw error;
    }
  }

  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(
    @Req() req: any,
    @Body() body: any,
  ) {
    const session = await this.resolveSessionOrThrow(req);
    const endpoint = String(body?.endpoint || '').trim();
    if (!endpoint) {
      throw new BadRequestException('invalid_endpoint');
    }

    return this.webPushService.removeSubscription(session.user.id, endpoint);
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Req() req: any,
  ) {
    const session = await this.resolveSessionOrThrow(req);
    return this.webPushService.sendTestPushToUser(session.user.id);
  }
}
