import { IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

// The global ValidationPipe runs with `whitelist: true`, which strips any
// property without a validation decorator — with none present, the whole
// body would come through empty. These minimal decorators are what Task 8
// was slated to add; pulled forward here so this task's own controller
// test (which exercises the real global pipe) can pass dto.key through.
export class InitiateUploadDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  size?: number;
}
