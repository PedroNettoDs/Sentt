// Rotas REST do CRUD de instâncias — §5.11 do prompt-motor.md.
// Todas as respostas passam por `toInstanceResponse` para garantir que o
// ciphertext de `credentials` nunca vaze para o cliente.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateInstanceDto } from './dto/create-instance.dto';
import {
  InstanceResponse,
  toInstanceResponse,
} from './dto/instance-response.dto';
import { ListInstancesDto } from './dto/list-instances.dto';
import { UpdateCredentialsDto } from './dto/update-credentials.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InstancesService } from './instances.service';

@Controller('whatsapp/instances')
export class InstancesController {
  constructor(private readonly service: InstancesService) {}

  @Get()
  async list(@Query() filters: ListInstancesDto): Promise<InstanceResponse[]> {
    const list = await this.service.list(filters);
    return list.map(toInstanceResponse);
  }

  @Get(':id')
  async get(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.get(id));
  }

  @Post()
  async create(@Body() dto: CreateInstanceDto): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.create(dto));
  }

  @Patch(':id/role')
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.updateRole(id, dto));
  }

  @Patch(':id/primary')
  async setPrimary(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.setPrimary(id));
  }

  @Patch(':id/credentials')
  async updateCredentials(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCredentialsDto,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.updateCredentials(id, dto));
  }

  @Post(':id/reconnect')
  @HttpCode(200)
  async reconnect(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.reconnect(id));
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  async disconnect(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.disconnect(id));
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InstanceResponse> {
    return toInstanceResponse(await this.service.softDelete(id));
  }
}
