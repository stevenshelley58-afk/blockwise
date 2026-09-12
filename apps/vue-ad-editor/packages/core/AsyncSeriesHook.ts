type Tap<T> = (value: T) => unknown | Promise<unknown>;

export class AsyncSeriesHook<T = unknown> {
  private taps: Tap<T>[] = [];

  constructor(_args: string[] = []) {}

  tapPromise(_name: string, tap: Tap<T>) {
    this.taps.push(tap);
  }

  callAsync(value: T, callback: (error?: unknown) => void) {
    void this.run(value).then(() => callback(), (error) => callback(error));
  }

  private async run(value: T) {
    for (const tap of this.taps) await tap(value);
  }
}
