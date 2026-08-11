import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { TagsService } from './tags.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

@Controller('tags')
@UseGuards(JwtGuard)
export class TagsController {
  constructor(private tagsService: TagsService) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.tagsService.findAll(req.user.userId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: { name?: string }) {
    return this.tagsService.create(req.user.userId, body.name);
  }

  @Put(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string },
  ) {
    return this.tagsService.update(req.user.userId, id, body.name);
  }

  @Post(':id/merge')
  merge(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { targetName?: string },
  ) {
    return this.tagsService.merge(req.user.userId, id, body.targetName);
  }

  @Delete(':id')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.tagsService.remove(req.user.userId, id);
  }
}
