import {
  ArgumentsHost,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { UploadExceptionFilter } from './upload-exception.filter';

describe('UploadExceptionFilter', () => {
  const makeHost = () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { status, json };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    return { host, response };
  };

  it('returns Vietnamese message for file-size upload errors', () => {
    const { host, response } = makeHost();

    new UploadExceptionFilter().catch(
      new PayloadTooLargeException('File too large'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: 'Tệp tải lên vượt quá dung lượng cho phép',
      error: 'Payload Too Large',
    });
  });

  it('returns Vietnamese message when too many files are uploaded', () => {
    const { host, response } = makeHost();

    new UploadExceptionFilter().catch(
      new BadRequestException('Too many files'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Chỉ được tải lên một tệp mỗi lần',
      error: 'Bad Request',
    });
  });
});
