import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { MailModule } from '../mail/mail.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [MailModule, AuditModule],
  providers: [MembersService],
  controllers: [MembersController],
})
export class MembersModule {}
