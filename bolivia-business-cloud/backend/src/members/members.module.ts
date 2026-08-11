import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  providers: [MembersService],
  controllers: [MembersController],
})
export class MembersModule {}
