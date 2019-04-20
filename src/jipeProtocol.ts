import { api } from './public';

/**
 * The `jipe.start` request is sent from a spawned process back to
 * jipe to help it route requests from interdependent tools in the
 * process composition.
 */
export class start implements api.Definition {
  method = 'jipe.start';
  params: {
    /** prefixed method names implemented by this tool */
    implements: string[];
  };
  result: {
    /** prefixed method names implemented by any connected tool */
    implements: string[];
  };
}
