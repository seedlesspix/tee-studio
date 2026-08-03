// potrace ships no types.
declare module 'potrace' {
  type Cb = (err: Error | null, svg: string) => void
  export function trace(file: string | Buffer, options: Record<string, unknown>, cb: Cb): void
  export function trace(file: string | Buffer, cb: Cb): void
  export function posterize(file: string | Buffer, options: Record<string, unknown>, cb: Cb): void
  export class Potrace { constructor(options?: Record<string, unknown>) }
}
