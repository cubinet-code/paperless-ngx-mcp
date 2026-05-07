export const arrayNotEmpty = <T>(array: T[] | undefined): T[] | undefined =>
  array?.length ? array : undefined;
