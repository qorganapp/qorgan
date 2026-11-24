import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { ScanModule } from '../../../common/security.types';

export class CreateScanDto {
  /** Не указано — Full Sweep (все модули). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ScanModule, { each: true })
  modules?: ScanModule[];
}
