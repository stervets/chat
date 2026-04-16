import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {resolveSession} from '../common/auth.js';
import {config} from '../config.js';
import {
  createUploadFileName,
  readUploadFile,
  saveUploadBuffer,
  sanitizeUploadName,
} from '../common/uploads.js';

@Controller()
export class UploadsController {
  private resolveToken(req: any) {
    const header = String(req?.headers?.authorization || '').trim();
    if (!header.toLowerCase().startsWith('bearer ')) return '';
    return header.slice(7).trim();
  }

  private buildOrigin(req: any) {
    const host = String(req?.headers?.host || '').trim();
    if (!host) return '';
    const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwarded || req?.protocol || 'http';
    return `${proto}://${host}`;
  }

  @Post('upload/image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: Math.max(config.uploads.maxBytes * 8, 8 * 1024 * 1024),
    },
  }))
  uploadImage(
    @Req() req: any,
    @UploadedFile() file: any,
  ) {
    const token = this.resolveToken(req);
    const session = token ? resolveSession(token) : null;
    if (!session) {
      throw new UnauthorizedException('unauthorized');
    }

    if (!file?.buffer || !file?.mimetype) {
      throw new BadRequestException('file_required');
    }

    const mime = String(file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      throw new BadRequestException('invalid_file_type');
    }

    const size = Number(file.size || file.buffer.length || 0);
    if (size <= 0) {
      throw new BadRequestException('empty_file');
    }

    if (size > config.uploads.maxBytes) {
      throw new BadRequestException('file_too_large');
    }

    const fileName = createUploadFileName(mime);
    const path = saveUploadBuffer(fileName, file.buffer as Buffer);
    const origin = this.buildOrigin(req);

    return {
      ok: true,
      path,
      url: origin ? `${origin}${path}` : path,
      mime,
      size,
      uploadedBy: session.user.id,
    };
  }

  @Get('uploads/:name')
  getUpload(
    @Param('name') nameRaw: string,
    @Res({passthrough: true}) res: any,
  ) {
    const name = sanitizeUploadName(nameRaw);
    if (!name) {
      throw new BadRequestException('invalid_file_name');
    }

    const file = readUploadFile(name);
    if (!file) {
      throw new NotFoundException('file_not_found');
    }

    if (res?.setHeader) {
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('Content-Length', file.content.length);
    }

    return new StreamableFile(file.content);
  }
}
