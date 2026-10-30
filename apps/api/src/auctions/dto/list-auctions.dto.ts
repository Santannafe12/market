import { IsIn } from 'class-validator';

export class ListAuctionsQueryDto {
  @IsIn(['live', 'scheduled', 'ended'], {
    message: 'O status precisa ser live, scheduled ou ended.',
  })
  status!: 'live' | 'scheduled' | 'ended';
}
