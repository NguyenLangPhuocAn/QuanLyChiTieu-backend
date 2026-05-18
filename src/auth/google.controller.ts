import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleProfile = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
};

@Controller('auth')
export class GoogleController {
  constructor(private readonly usersService: UsersService) {}

  @Get('google')
  @Redirect()
  googleLogin() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const callbackUrl = this.getCallbackUrl();

    if (!clientId) {
      return this.redirectWithError('Chưa cấu hình GOOGLE_CLIENT_ID');
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');

    return { url: url.toString() };
  }

  @Get('google/callback')
  @Redirect()
  async googleCallback(@Query('code') code?: string, @Query('error') error?: string) {
    try {
      if (error) {
        throw new UnauthorizedException(error);
      }

      if (!code) {
        throw new UnauthorizedException('Google không trả về mã đăng nhập');
      }

      const profile = await this.fetchGoogleProfile(code);
      const result = await this.usersService.loginWithGoogle({
        email: profile.email!,
        providerId: profile.sub!,
        fullName: profile.name,
        avatar: profile.picture,
      });

      const redirectUrl = new URL(this.getWebAdminUrl('/login'));
      redirectUrl.searchParams.set('token', result.accessToken);
      redirectUrl.searchParams.set('refreshToken', result.refreshToken);
      redirectUrl.searchParams.set(
        'mustChangePassword',
        result.mustChangePassword ? '1' : '0',
      );

      return { url: redirectUrl.toString() };
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Đăng nhập Google thất bại';
      return this.redirectWithError(message);
    }
  }

  @Post('google/mobile')
  async googleMobile(@Body('idToken') idToken?: string) {
    if (!idToken) {
      throw new UnauthorizedException('Thiếu Google idToken');
    }

    const profile = await this.verifyGoogleIdToken(idToken);

    return this.usersService.loginMobileWithGoogle({
      email: profile.email!,
      providerId: profile.sub!,
      fullName: profile.name,
      avatar: profile.picture,
    });
  }

  private async fetchGoogleProfile(code: string): Promise<GoogleProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = this.getCallbackUrl();

    if (!clientId || !clientSecret) {
      throw new UnauthorizedException(
        'Chưa cấu hình GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET',
      );
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;

    if (!tokenResponse.ok || !tokenData.id_token) {
      throw new UnauthorizedException(
        tokenData.error_description || tokenData.error || 'Không lấy được Google token',
      );
    }

    const profileResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        tokenData.id_token,
      )}`,
    );
    const profile = (await profileResponse.json()) as GoogleProfile;

    if (
      !profileResponse.ok ||
      !profile.sub ||
      !profile.email ||
      profile.email_verified === false ||
      profile.email_verified === 'false'
    ) {
      throw new UnauthorizedException('Google email không hợp lệ hoặc chưa xác minh');
    }

    return profile;
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
    const profileResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        idToken,
      )}`,
    );
    const profile = (await profileResponse.json()) as GoogleProfile;

    if (
      !profileResponse.ok ||
      !profile.sub ||
      !profile.email ||
      profile.email_verified === false ||
      profile.email_verified === 'false'
    ) {
      throw new UnauthorizedException('Google idToken không hợp lệ');
    }

    const allowedAudiences = [
      process.env.GOOGLE_WEB_CLIENT_ID,
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
    ].filter(Boolean);

    if (
      allowedAudiences.length > 0 &&
      (!profile.aud || !allowedAudiences.includes(profile.aud))
    ) {
      throw new UnauthorizedException('Google client ID không khớp cấu hình');
    }

    return profile;
  }

  private getCallbackUrl() {
    return (
      process.env.GOOGLE_CALLBACK_URL ||
      `${process.env.API_URL || 'http://localhost:3000'}/auth/google/callback`
    );
  }

  private getWebAdminUrl(pathname: string) {
    const baseUrl = process.env.WEB_ADMIN_URL || 'http://localhost:3001';
    return `${baseUrl}${pathname}`;
  }

  private redirectWithError(message: string) {
    const redirectUrl = new URL(this.getWebAdminUrl('/login'));
    redirectUrl.searchParams.set('googleError', message);
    return { url: redirectUrl.toString() };
  }
}
