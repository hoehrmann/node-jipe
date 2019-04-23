# node-jipe - Process composition via JSON-RPC pipes

When you enter `cat file | sort | uniq -c | sort -rn | head -n10` in
your terminal, your shell will spawn the listed processes; they talk
over stdio streams in an unidirectional and unstructured pipeline
with their neighbours. This package helps you do something like that,
but asynchronously, bidirectionally, and with structured data.

There is a library that implements JSON-RPC 2.0 helping you write
tools like those in the initial example, and a command line tool
called `jipe` that spawns such processes and routes requests to a
process that announced they can handle such requests.

## JSON-RPC 2.0 library

```typescript
import { Channel, api, jipe } from 'node-jipe';

/**
 * Type class for JSON-RPC 2.0 request `ping`.
 */
export class ping implements api.Definition {
  method = 'ping';
  params: any;
  result: any;
}

async function main() {

  const channel = new Channel(process.stdin, process.stdout);

  // manually do `jipe.start`
  const available = await channel.requestResult(jipe.start, {
    implements: []
  });

  // Could check here that available.implements has `request.ping`

  const result = await channel.requestResult(ping, {
    data: 123
  });

}

main();
```

```typescript

/**
 * Feature map mapping method names to api.Definition.
 */
class Features {
  ping = ping
}

class Pingme
// provides `start` method that does `jipe.start`
extends api.Jipe<Features>
// requires proper implementation of the Features
implements api.Interface<Features> {

  async ping(params: api.Params<ping>): api.Promised<ping> {
    // echo back parameters
    return params;
  }

}

async function main() {
  const us = new Pingme();

  // This automatically does `jipe.start` announcing the Features
  await us.start(new Features(), process.stdin, process.stdout);
}

```

Documentation of the library is available via something like:

```bash
% git clone https://github.com/hoehrmann/node-jipe.git
% cd node-jipe
% npm install -g yarn
% NODE_ENV=development yarn
% node_modules/.bin/typedoc --out docs  ./src/
% sensible-browser docs/index.html
```

## jipe

```plaintext
---------------------------------------------------------------------
  jipe - stdio ndjson jsonrpc process composition
---------------------------------------------------------------------

  Jipe allows you compose an implementation of a JSON-RPC 2.0 API
  from multiple independent processes. It spawns child process as
  specified on the command line and expects them to communicate
  with newline-delimited messages on their STDIN/STDOUT streams.

  In order for `jipe` to know where requests and notifications
  should be sent, child processes initially have to send a request
  for method `jipe.start` to `jipe` with `params.implements`
  set to an array of method names prefixed by `notification.` or
  `request.`. When all children have made such a request, `jipe`
  will send a result to all children with `params.implements` set
  to the union of all values it received, allowing children to
  complain when methods they need are missing.

  EXAMPLE:

    % jipe -- pinger -- pingme

  Here `jipe` will spawn `pinger` and `pingme` which are then
  expected to send a `jipe.start` request:

    pingme stdout: { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":["request.ping"]} }

    pinger stdout: { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":[]} }

  Now that all processes have signaled they are ready, `jipe` will
  send the union of all reported `implements` values as result:

    pingme stdin:  { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":["request.ping"]} }

    pinger stdin:  { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":["request.ping"]} }

  And then `pinger` can send a `ping` request to `jipe`:

    pinger stdout: { "jsonrpc" : "2.0",
                     "id"      : 2,
                     "method"  : "ping",
                     "params"  : {"value": 123} }

  Which `jipe` will then route to `pingme`:

    pingme stdin:  { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "ping",
                     "params"  : {} }

  Which could then respond by echoing the params back:

    pingme stdout: { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "params"  : {"value": 123} }

  And `jipe` will forward the result to `pinger`:

    pinger stdin:  { "jsonrpc" : "2.0",
                     "id"      : 2,
                     "params"  : {"value": 123} }

  Note that `jipe` does not blindly forward messages literally,
  it takes care to create new requests with appropriate `id`s.

---------------------------------------------------------------------
  https://github.com/hoehrmann/node-jipe/
---------------------------------------------------------------------
  Copyright (c) 2019 Bjoern Hoehrmann, https://bjoern.hoehrmann.de/
---------------------------------------------------------------------
```
