import { Readable, Writable, Transform } from 'stream';
import split2 = require('split2');
import through2 = require('through2');
import { EventEmitter } from 'events';
import * as rpc from './jsonrpc'
import { fail } from 'assert';
import { api } from './public';

/**
 * Internal interface to represent pending requests on a channel.
 */
interface RequestAndCallback {
  request: rpc.JsonrpcRequest;
  resolve: (result: rpc.JsonrpcResult) => void;
  reject: (error: rpc.JsonrpcError) => void;
}

/**
 * Given a JSON-RPC 2.0 message object, this determines the type of
 * the message object based on the properties of the message object.
 * Responses are subdivided into `failure` and `result` types, and
 * if a message does not conform to `request`, the function returns
 * `malformed`.
 * 
 * @param message Object to check for relevant properties.
 * @returns Message type as a string.
 */
function getMessageType(message: any): rpc.JsonrpcMessageType {

  const has = (name) => Object.prototype.hasOwnProperty.call(
    message,
    name
  );

  if (!has('jsonrpc')) {
    return 'malformed';
  }

  if (has('method')) {
    return 'request';
  }

  if (has('error')) {
    return 'failure';
  }

  if (has('result')) {
    return 'result';
  }

  return 'malformed';

}

export interface ChannelOptions {
  foo?: Boolean;
};

/**
 * Channel.
 * 
 */
export class Channel extends EventEmitter {

  /** Writable object stream for JSON-RPC messages. */
  protected pipedWrite: Transform;

  protected others: Transform;

  protected awaiting = new Map<number, RequestAndCallback>();
  protected processing = new Set<number>();

  /** Configuration */
  protected options: ChannelOptions;

  /**
   * Construct a new channel from a pair of streams.
   * 
   * @param read Readable stream on which messages are received.
   * @param write Writable stream on which messages are sent.
   * @param options ...
   */
  constructor(read: Readable, write: Writable, options: ChannelOptions = {}) {
    super();

    this.options = options;

    const dissect = (data: string) => {
      const parsed = JSON.parse(data);
      const type = getMessageType(parsed);
      return [type, parsed];
    };

    const encode = function(chunk, encoding, cb) {
      cb(null, JSON.stringify(chunk) + '\n');
    };

    const encoder = through2({ objectMode: true }, encode)

    this.pipedWrite = encoder;

    this.pipedWrite.pipe(write);

    const dissected = read.pipe(split2(dissect));
    const responses = through2({ objectMode: true });
    const others = through2({ objectMode: true });

    this.others = others;

    const demux = function(chunk, encoding, cb) {
      const [ type, message ] = chunk;

      if (type === 'result' || type === 'failure') {
        responses.push(chunk);
        responses.resume(); // drain
      } else {
        others.push(chunk);
      }

      cb();
    };

    dissected.pipe(through2({ objectMode: true }, demux));

    const handler = ([type, obj]) => {

      const message: rpc.JsonrpcMessage = obj;

      let request: any = message;

      if (type === 'result' || type === 'failure') {
        
        const response = message as rpc.JsonrpcResponse;
        const rcb = this.awaiting.get(response.id);

        if (rcb) {

          this.awaiting.delete(rcb.request.id);

          request = rcb.request;

          if (type === 'failure') {
            const failure = response as rpc.JsonrpcResponseError;
            rcb.reject(failure.error);
          } else {
            const result = response as rpc.JsonrpcResponseResult;
            rcb.resolve(result.result);
          }

        } else {

          fail(
            `Response for unknown request: ${
              process.argv
            }: ${JSON.stringify(obj)}`
          );

        }

      } else {

        this.processing.add(request.id);
        this.others.pause();

      }

      for (const event of this.getEventSequence(type, request)) {
        this.emit(event, {
          type: type,
          respond: Object.prototype.hasOwnProperty.call(request, 'id'),
          message: message,
          request: request
        });
      }
    };

    responses.on('data', handler);
    others.on('data', handler);

  }

  /** Mapping from message types to message groups */
  private path = {
    'result': ['message', 'response.', 'result.'],
    'failure': ['message', 'response.', 'failure.'],
    'request': ['message', 'request.'],
    'malformed': ['malformed.'],
  };

  /**
   * Messages can be listened for and be intercepted using specific
   * names or more general groups. For instance, successful responses
   * to requests for the `example` method would be reported as all of
   * `result.example`, `response.example`, `response`, and `message`
   * in that order. This method maps a type name to such a sequence.
   * 
   * @param type - Message type
   * @param request - Related request to get the method name from
   * @returns The expanded list of event names.
   */
  protected getEventSequence(
    type: rpc.JsonrpcMessageType,
    request?: any
  ): string[] {

    return this.path[type].reduce((acc: string[], event) => {

      const match = event.match(/^(.*?)(\.)?$/s);

      if (!match) {
        return acc;
      }

      const [, prefix, dot] = match;

      const more = [prefix];

      if (dot && request) {
        more.push(`${prefix}.${request.method}`);
      }

      return acc.concat(more);

    }, []);

  }

  protected next_id: number = 1;

  /**
   * Send a notification message.
   * 
   * @param method Name of the notification.
   * @param params Parameters of the notification.
   * @returns Promise that resolves when the message was sent.
   */
  public sendNotification<T extends api.Definition>(
    method: { new(): T },
    params: rpc.JsonrpcParams,
  ): Promise<any> {

    const created = new method;

    return this.sendMessage({
      jsonrpc: '2.0',
      params: params,
      method: created.method,
    });
    
  }

  /**
   * Call a remote procedure.
   * 
   * @param method Name of the requested procedure.
   * @param params Parameters for the procedure.
   * @param resultCb Callback for successful response.
   * @param errorCb Callback for error response.
   * @returns Promise that resolves when the request was sent.
   */
  public sendRequest<T extends api.Definition>(
    method: { new(): T },
    params: rpc.JsonrpcParams,
    resultCb: (result: rpc.JsonrpcResult) => void,
    errorCb: (error: rpc.JsonrpcError) => void,
  ): Promise<rpc.JsonrpcRequest> {

    const created = new method;

    const request: rpc.JsonrpcRequest = {
      jsonrpc: '2.0',
      id: this.next_id++,
      method: created.method,
      params: params,
    };

    return this.sendMessage(request).then(sent => {

      this.awaiting.set(request.id, {
        request: request,
        resolve: resultCb,
        reject: errorCb,
      });

      return sent;

    });

  }

  /**
   * Convenience method to call a remote procedure that returns a 
   * Promise for the result and rejects with an error response if 
   * any. Uses [[Channel.sendRequest]] internally.
   * 
   * @param method Meta class of the requested procedure.
   * @param params Parameters for the procedure.
   * @returns Promise that resolves with the response and rejects
   *          with error response
   */
  public async requestResult<T extends api.Definition>(
    method: new() => T,
    params: api.Params<T>
  ): api.Promised<T> {

    return new Promise((resolve, reject) => {
      this.sendRequest(method, params, resolve, reject);
    });

  }

  /**
   * Respond to the given request with an error.
   * 
   * @param request The request that is being answered.
   * @param code JSON-RPC 2.0 error code.
   * @param message Short human-readable description of the error.
   * @param data Machine-readable error data.
   * @returns Promise that resolves when the message was sent.
   */
  public sendError(
    request: rpc.JsonrpcRequest,
    code: number,
    message: string,
    data?: any
  ): Promise<any> {

    this.processing.delete(request.id);

    if (this.processing.size === 0) {
      this.others.resume();
    }

    return this.sendMessage({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: code,
        message: message,
        data: data
      }
    });

  }

  /**
   * Respond to the given request with a result.
   * 
   * @param request The request that is being answered.
   * @param result Result data.
   * @returns Promise that resolves when the message was sent.
   */
  public sendResult(
    request: rpc.JsonrpcRequest,
    result: any
  ): Promise<any> {

    this.processing.delete(request.id);

    if (this.processing.size === 0) {
      this.others.resume();
    }

    return this.sendMessage({
      jsonrpc: '2.0',
      id: request.id,
      result: result
    });

  }

  /**
   * Write a message to the channel.
   * 
   * @param message The message to send.
   * @returns Promise that resolves when the message was sent.
   */
  protected sendMessage(
    message: rpc.JsonrpcMessage
  ): Promise<any> {

    return new Promise((resolve, reject) => {
      this.pipedWrite.write(message, 'utf-8', error => {
        if (error) {
          reject(error);
        } else {
          resolve(message);
        }
      });

    });

  }
  
}
