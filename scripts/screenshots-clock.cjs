// Moves the clock for `npm run screenshots`, so every screenshot shows the same time of day whenever it's taken: the
// development server loads this with --require, and so does each capture window's preload (screenshots-preload.cjs).
// PACEDMIND_CLOCK_OFFSET is how far to move it, in milliseconds; time goes on from there.
const offset = Number(process.env.PACEDMIND_CLOCK_OFFSET || 0);
if (offset) {
  const RealDate = globalThis.Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [RealDate.now() + offset]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  // Its own copies of Date.parse and Date.UTC: whatever copies Date's own properties (Next.js does) finds them.
  for (const name of ["parse", "UTC"]) Object.defineProperty(ShiftedDate, name, { value: RealDate[name], writable: true, configurable: true });
  globalThis.Date = ShiftedDate;
}
