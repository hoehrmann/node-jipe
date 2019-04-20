import { Channel } from './public';
import { Writable, Readable } from 'stream';
import * as jipe from './jipeProtocol';

export interface Definition {
  /** JSON-RPC 2.0 method name */
  method: string;
  /** JSON RPC 2.0 request params type */
  params: any;
  /** JSON RPC 2.0 request result type */
  result: any;
}

/**
 * Params type of a definition.
 */
export type Params<T extends Definition> = T['params'];

/**
 * Result type of a definition.
 */
export type Result<T extends Definition> = T['result'];

/**
 * Promised result type of a definition.
 */
export type Promised<T extends Definition> = Promise<Result<T>>;

/**
 * Function type of a definition.
 */
export type Function<
  T extends Definition
> = (params: Params<T>) => Promised<T> | Result<T>;

export type Features = any;

/**
 * Interface from a feature class.
 */
export type Interface<T extends Features> = {
  [M in keyof T]: Function<T[M]>
}

/**
 * A public `start` method from a feature class.
 */
export class Jipe<T extends Features> {
  
  protected channel: Channel;

  public async start(imp: T, stdin: Readable, stdout: Writable): Promise<any> {

    this.channel = new Channel(stdin, stdout);

    const dispatch = new Map<string, Function<Definition>>();

    for (const [method, spec] of Object.entries(imp)) {

      const meta: Definition = new spec;

      dispatch.set(meta.method, this[method]);

    }

    this.channel.on(`request`, async msg => {

      const wantResult = true;

      try {

        const method = dispatch.get(msg.request.method);

        if (!method) {
          throw new Exception();
        }

        const result = await method.call(this, msg.request.params);

        if (result === undefined && wantResult) {
          throw new Exception();
        }

        if (result !== undefined) {
          this.channel.sendResult(msg.request, result);
        }

      } catch (e) {

        if (wantResult) {
          this.channel.sendError(msg.request, 0, '', e);
        }

      }
    });

    return await this.channel.requestResult(jipe.start, {
      implements: Array.from(dispatch.keys()).map(x => `request.${x}`)
    });

  }

}

/**
 * Protocol exceptions.
 */
export class Exception extends Error {
}
