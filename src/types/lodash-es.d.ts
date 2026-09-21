declare module 'lodash-es' {
  export function cloneDeep<T>(value: T): T;
  export function isEqual(value: unknown, other: unknown): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lodash's _.omit returns a loosely-typed result; matches @types/lodash behavior where path-based overloads return `any`
  export function omit<T extends object>(object: T, ...paths: Array<string | number | symbol>): any;
}
