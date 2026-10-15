import { BadRequestException } from '@nestjs/common';

export function assertAthleteEligibility(
  athlete: { gender: string; birthDate: Date | null; weight?: number | null },
  category: { gender: string; minAge: number | null; maxAge: number | null; minWeight: number | null; maxWeight: number | null },
  referenceDate: Date,
) {
  if (category.gender !== 'MIXED' && athlete.gender !== category.gender) {
    throw new BadRequestException('Giới tính vận động viên không đáp ứng điều kiện hạng mục');
  }
  if (athlete.weight != null && category.minWeight !== null && athlete.weight < category.minWeight) throw new BadRequestException('Vận động viên chưa đạt cân nặng tối thiểu');
  if (category.minAge !== null || category.maxAge !== null) {
    if (!athlete.birthDate) throw new BadRequestException('Hạng mục này bắt buộc có ngày sinh vận động viên');
    let age = referenceDate.getUTCFullYear() - athlete.birthDate.getUTCFullYear();
    const birthdayPassed = referenceDate.getUTCMonth() > athlete.birthDate.getUTCMonth()
      || (referenceDate.getUTCMonth() === athlete.birthDate.getUTCMonth() && referenceDate.getUTCDate() >= athlete.birthDate.getUTCDate());
    if (!birthdayPassed) age -= 1;
    if (category.minAge !== null && age < category.minAge) throw new BadRequestException('Vận động viên chưa đạt độ tuổi tối thiểu');
    if (category.maxAge !== null && age > category.maxAge) throw new BadRequestException('Vận động viên vượt quá độ tuổi tối đa');
  }
}

