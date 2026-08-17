import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ReceiptsService } from './receipts.service';
import { IssueReceiptDto } from './dto/issue-receipt.dto';
import { PdfQueryDto } from './dto/pdf-query.dto';
import { SendReceiptEmailDto } from './dto/send-receipt-email.dto';
import { renderReceiptPdf } from './receipt-pdf.util';
import { ReceiptSnapshot } from './receipt-snapshot';

// Recibos comerciales NO FISCALES — ver docs/architecture.md sección 14.
// Este controller nunca importa nada de `fiscal/` (no existe todavía) y
// `sales.controller.ts` nunca importa nada de acá — la UI de /sales/[id]
// consulta este controller de forma independiente
// (GET /receipts/by-sale/:saleId).
@Controller('receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post()
  @RequirePermissions('receipts.manage')
  issue(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: IssueReceiptDto) {
    return this.receipts.issue(auth.organizationId, dto.saleId, auth.sub);
  }

  /** `null` si la venta todavía no tiene recibo emitido — nunca un 404. */
  @Get('by-sale/:saleId')
  @RequirePermissions('receipts.read')
  findBySale(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('saleId') saleId: string,
  ) {
    return this.receipts.findBySale(auth.organizationId, saleId);
  }

  @Get(':id')
  @RequirePermissions('receipts.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.receipts.findById(auth.organizationId, id);
  }

  /**
   * PDF generado EN VIVO a partir del `snapshot` guardado — nunca
   * reconstruye desde `Sale`/`Customer`/`Organization`. `format=a4`
   * (default) o `format=thermal80`.
   */
  @Get(':id/pdf')
  @RequirePermissions('receipts.read')
  async pdf(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Query() query: PdfQueryDto,
    @Res() res: Response,
  ) {
    const receipt = await this.receipts.findById(auth.organizationId, id);
    const format = query.format ?? 'a4';
    const buffer = await renderReceiptPdf(
      receipt.snapshot as unknown as ReceiptSnapshot,
      format,
    );
    await this.receipts.logDownload(auth.organizationId, auth.sub, id, format);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="recibo-${receipt.series}-${receipt.number}-${format}.pdf"`,
    });
    res.send(buffer);
  }

  /**
   * Encola el envío del recibo por email (PDF A4 adjunto, generado desde
   * el snapshot inmutable). No bloquea esperando al proveedor — responde
   * apenas el job queda en la cola.
   */
  @Post(':id/email')
  @RequirePermissions('receipts.manage')
  async sendEmail(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SendReceiptEmailDto,
  ) {
    await this.receipts.sendByEmail(
      auth.organizationId,
      id,
      auth.sub,
      dto.email,
    );
    return { queued: true };
  }
}
