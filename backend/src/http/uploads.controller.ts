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
import sharp from 'sharp';
import {resolveSession} from '../common/auth.js';
import {config} from '../config.js';
import {
  createUploadFileName,
  readUploadFile,
  saveUploadBuffer,
  sanitizeUploadName,
} from '../common/uploads.js';

const UPLOAD_INTERCEPTOR_CONFIG = {
  limits: {
    fileSize: Math.max(config.uploads.videoMaxBytes, config.uploads.maxBytes, 8 * 1024 * 1024),
  },
};
const MAX_UPLOAD_IMAGE_DIMENSION = 1024;

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

  private async normalizeImageForUpload(bufferRaw: Buffer, mimeRaw: string) {
    const mime = String(mimeRaw || '').toLowerCase();
    const buffer = Buffer.isBuffer(bufferRaw) ? bufferRaw : Buffer.from(bufferRaw || []);
    if (!mime.startsWith('image/')) {
      return {buffer, mime};
    }
    if (mime === 'image/gif' || mime === 'image/svg+xml') {
      return {buffer, mime};
    }

    try {
      const probe = sharp(buffer, {failOn: 'none'});
      const metadata = await probe.metadata();
      const width = Number(metadata.width || 0);
      const height = Number(metadata.height || 0);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        return {buffer, mime};
      }
      if (width <= MAX_UPLOAD_IMAGE_DIMENSION && height <= MAX_UPLOAD_IMAGE_DIMENSION) {
        return {buffer, mime};
      }

      const pipeline = sharp(buffer, {failOn: 'none'})
        .rotate()
        .resize({
          width: MAX_UPLOAD_IMAGE_DIMENSION,
          height: MAX_UPLOAD_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        });

      if (mime === 'image/png') {
        const resized = await pipeline.png({compressionLevel: 9, adaptiveFiltering: true}).toBuffer();
        return {buffer: resized, mime: 'image/png'};
      }
      if (mime === 'image/webp') {
        const resized = await pipeline.webp({quality: 86}).toBuffer();
        return {buffer: resized, mime: 'image/webp'};
      }
      if (mime === 'image/avif') {
        const resized = await pipeline.avif({quality: 55}).toBuffer();
        return {buffer: resized, mime: 'image/avif'};
      }

      const resized = await pipeline.jpeg({quality: 86, mozjpeg: true}).toBuffer();
      return {buffer: resized, mime: 'image/jpeg'};
    } catch {
      return {buffer, mime};
    }
  }

  private async uploadMediaFile(req: any, file: any, mode: 'image' | 'media') {
    const token = this.resolveToken(req);
    const session = token ? await resolveSession(token) : null;
    if (!session) {
      throw new UnauthorizedException('unauthorized');
    }

    if (!file?.buffer || !file?.mimetype) {
      throw new BadRequestException('file_required');
    }

    const mime = String(file.mimetype || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');
    if (mode === 'image' ? !isImage : (!isImage && !isVideo)) {
      throw new BadRequestException('invalid_file_type');
    }

    let uploadMime = mime;
    let uploadBuffer = file.buffer as Buffer;
    if (isImage) {
      const normalized = await this.normalizeImageForUpload(uploadBuffer, uploadMime);
      uploadMime = normalized.mime;
      uploadBuffer = normalized.buffer;
    }

    const size = Number(uploadBuffer.length || 0);
    if (size <= 0) {
      throw new BadRequestException('empty_file');
    }

    const maxBytes = isVideo
      ? config.uploads.videoMaxBytes
      : config.uploads.maxBytes;
    if (size > maxBytes) {
      throw new BadRequestException('file_too_large');
    }

    const fileName = createUploadFileName(uploadMime);
    const path = saveUploadBuffer(fileName, uploadBuffer);
    const origin = this.buildOrigin(req);

    return {
      ok: true,
      path,
      url: origin ? `${origin}${path}` : path,
      mime: uploadMime,
      size,
      uploadedBy: session.user.id,
    };
  }

  @Post('upload/image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_CONFIG))
  async uploadImage(
    @Req() req: any,
    @UploadedFile() file: any,
  ) {
    return this.uploadMediaFile(req, file, 'image');
  }

  @Post('upload/media')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_CONFIG))
  async uploadMedia(
    @Req() req: any,
    @UploadedFile() file: any,
  ) {
    return this.uploadMediaFile(req, file, 'media');
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
