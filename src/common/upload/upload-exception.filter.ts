import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

const FILE_TOO_LARGE_MESSAGE = 'Tệp tải lên vượt quá dung lượng cho phép';
const TOO_MANY_FILES_MESSAGE = 'Chỉ được tải lên một tệp mỗi lần';

function getExceptionMessage(exception: HttpException) {
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return response;
  }

  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message?: unknown }).message;

    if (Array.isArray(message)) {
      return message.join(', ');
    }

    if (typeof message === 'string') {
      return message;
    }
  }

  return exception.message;
}

@Catch(PayloadTooLargeException, BadRequestException)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const statusCode = exception.getStatus();
    const message = getExceptionMessage(exception);
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof PayloadTooLargeException) {
      response.status(statusCode).json({
        statusCode,
        message: FILE_TOO_LARGE_MESSAGE,
        error: 'Payload Too Large',
      });
      return;
    }

    if (message === 'Too many files') {
      response.status(statusCode).json({
        statusCode,
        message: TOO_MANY_FILES_MESSAGE,
        error: 'Bad Request',
      });
      return;
    }

    response.status(statusCode).json(exception.getResponse());
  }
}
