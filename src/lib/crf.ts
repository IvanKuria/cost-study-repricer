/** Capital recovery factor: the annual payment that repays 1 dollar over `years` at `rate`. Same as the UC studies. */
export function crf(rate: number, years: number): number {
  if (years <= 0) return 1;
  if (rate === 0) return 1 / years;
  return rate / (1 - Math.pow(1 + rate, -years));
}
