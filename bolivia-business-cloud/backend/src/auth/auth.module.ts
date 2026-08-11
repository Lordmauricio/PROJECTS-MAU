import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OrganizationsModule } from '../organizations/organizations.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), OrganizationsModule, MailModule],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
