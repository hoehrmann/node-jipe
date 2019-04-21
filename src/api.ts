import { Channel } from './public';
import { Writable, Readable } from 'stream';
import * as jipe from './jipeProtocol';
import { JsonrpcRequest } from './jsonrpc';

/**
 * Interface for type classes for individual JSON-RPC 2.0 request
 * types.
 */
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
export type Function<T extends Definition> = (
  params: Params<T>
) => Promised<T> | Result<T>;

/**
 * Typed [[JsonrpcRequest]].
 */
export interface Request<T extends Definition>
  extends JsonrpcRequest {
  method: T['method'];
  params: Params<T>;
}

/**
 * Retrieve method name of method meta.
 *
 * @param method ...
 *
 * @returns Method name as string
 */
export function methodname<T extends Definition>(method: {
  new (): T;
}): string {
  return new method().method;
}

/**
 * TODO: documentation
 */
export type Features = any;

/**
 * Interface from a feature class.
 */
export type Interface<T extends Features> = {
  [M in keyof T]: Function<T[M]>
};

/**
 * A public `start` method from a feature class that automatically
 * handles reporting implemented request methods to `jipe`.
 */
export class Jipe<T extends Features> {
  /** Channel over which to talk JSON-RPC 2.0 */
  protected channel: Channel;

  /**
   * ...
   *
   * @param imp Feature map of requests implemented by this class.
   * @param stdin Readable for incoming messages.
   * @param stdout Writable for outgoing messages.
   */
  public async start(
    imp: T,
    stdin: Readable,
    stdout: Writable
  ): Promise<any> {
    this.channel = new Channel(stdin, stdout);

    const dispatch = new Map<string, Function<Definition>>();

    for (const [method, spec] of Object.entries(imp)) {
      const meta: Definition = new spec();

      dispatch.set(meta.method, this[method]);
    }

    this.channel.on(`request`, async (msg) => {
      const wantResult = msg.respond;

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
          // FIXME(bh): strange things
          this.channel.sendError(
            msg.request,
            0,
            `Caught exception thrown in ${[
              ...process.execArgv,
              ...process.argv,
            ].join(' ')}`,
            {
              exception: e,
            }
          );
        }
      }
    });

    return await this.channel.requestResult(jipe.start, {
      implements: Array.from(dispatch.keys()).map(
        (x) => `request.${x}`
      ),
    });
  }
}

/**
 * Protocol exceptions.
 */
export class Exception extends Error {}
