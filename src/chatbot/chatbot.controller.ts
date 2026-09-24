import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { ChatbotService } from './chatbot.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

type AuthRequest = Request & { user: { userId: number } };

@Controller('chatbot')
@UseGuards(JwtGuard)
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('conversations')
  conversations(
    @Req() req: AuthRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.chatbotService.listConversations(
      req.user.userId,
      Number(limit),
      cursor,
    );
  }

  @Get('conversations/:conversationId/messages')
  conversationHistory(
    @Req() req: AuthRequest,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Query('limit') limit?: string,
    @Query('before_id') beforeId?: string,
  ) {
    return this.chatbotService.getConversationHistory(
      req.user.userId,
      conversationId,
      Number(limit),
      Number(beforeId),
    );
  }

  @Get('messages')
  history(
    @Req() req: AuthRequest,
    @Query('limit') limit?: string,
    @Query('before_id') beforeId?: string,
  ) {
    return this.chatbotService.getHistory(
      req.user.userId,
      Number(limit),
      Number(beforeId),
    );
  }

  @Get('suggestions')
  suggestions(@Req() req: AuthRequest) {
    return this.chatbotService.getSuggestions(req.user.userId);
  }

  @Post('messages')
  send(@Req() req: AuthRequest, @Body() dto: SendChatMessageDto) {
    return this.chatbotService.send(req.user.userId, dto);
  }
}
