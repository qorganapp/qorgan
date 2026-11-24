import { IsIn } from 'class-validator';
import { FindingStatus } from '../finding.entity';

export class UpdateFindingDto {
  /** `fixed` ставит только сканер, когда находка пропала. */
  @IsIn([FindingStatus.Open, FindingStatus.Ignored])
  status: FindingStatus.Open | FindingStatus.Ignored;
}
