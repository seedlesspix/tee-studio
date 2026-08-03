// paper-jsdom re-exports paper's runtime (headless, jsdom-backed) but ships no types.
// Borrow paper's own type surface.
declare module 'paper-jsdom' {
  import paper from 'paper'
  export = paper
}
