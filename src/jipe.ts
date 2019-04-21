#!/usr/bin/env node

import { Channel, JsonrpcStdErrors, api } from './public';
import commandLineArgs = require('command-line-args');
import { spawn, ChildProcess } from 'child_process';
import { stackBy } from './stackBy';
import split2 = require('split2');
import through2 = require('through2');
import * as os from 'os';

class Child {
  process: ChildProcess | NodeJS.Process;
  channel: Channel;
  startRequest: Promise<any>;

  constructor(process, channel, startRequest) {
    this.process = process;
    this.channel = channel;
    this.startRequest = startRequest;
  }
}

process;
class Mediator {
  private spawnAndConnect(exec, args): [ChildProcess, Channel] {
    const child = spawn(exec, args, {
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdout && child.stdin && child.stderr) {
      const channel = new Channel(child.stdout, child.stdin);
      return [child, channel];
    } else {
      throw 'Child lacks stdio';
    }
  }

  public start(argv: string[]) {
    // TODO: make jipe jipe
    const lhsChannel = new Channel(process.stdin, process.stdout);

    const sep = '--';

    const stacks = Array.from(stackBy(argv, (x) => x === sep)).filter(
      (x) => x.length !== 1 || x[0] !== sep
    );

    const childArgs = stacks.slice(1);

    const children = childArgs.map((call, ix) => {
      const [exec, ...args] = call;
      const child = spawn(exec, args, {
        env: process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let channel: Channel;

      // FIXME: comment
      const prefix =
        `#${ix} ${exec} ${args.join(' ')}`.replace(
          /^(.{0,8})(.*?)(.{0,8})$/,
          (...x) => (x[2].length ? `${x[1]}...${x[3]}` : x[0])
        ) + ': ';

      if (child.stdout && child.stdin && child.stderr) {
        channel = new Channel(child.stdout, child.stdin);

        const prefixer = function(chunk, encoding, cb) {
          this.push(prefix + chunk + os.EOL);
          cb();
        };

        child.stderr
          .pipe(split2())
          .pipe(through2(prefixer))
          .pipe(process.stderr);
      } else {
        throw `Child ${ix} (${exec} ${args}) has no stdio`;
      }

      const startRequest = new Promise((resolve, reject) => {
        channel.on('request.jipe.start', (msg) => {
          resolve(msg.request);
        });
      });

      return new Child(process, channel, startRequest);
    });

    const dispatch = new Map<String, Child[]>();

    const forwarder = async (channel, msg) => {
      const name = `request.${msg.request.method}`;
      const handler = dispatch.get(name);

      if (handler && msg.respond) {
        const forwarded = await handler[0].channel.sendRequest(
          class implements api.Definition {
            method = msg.request.method;
            params: any;
            result: any;
          },
          msg.request.params,
          (result) => {
            if (msg.respond) {
              channel.sendResult(msg.request, result);
            }
          },
          (error) => {
            if (msg.respond) {
              channel.sendError(
                msg.request,
                error.code,
                error.message,
                error.data
              );
            }
          }
        );
      } else if (handler) {
        const forwarded = await handler[0].channel.sendNotification(
          class implements api.Definition {
            method = msg.request.method;
            params: any;
            result: any;
          },
          msg.request.params
        );
      } else {
        if (msg.respond) {
          channel.sendError(
            msg.request,
            -32601,
            `Method ${msg.request.method} not found`
          );
        }
      }
    };

    Promise.all(children.map((child) => child.startRequest)).then(
      (all) => {
        all.forEach((request, ix) => {
          request.params.implements.forEach((name) => {
            if (/^request\./.test(name)) {
              if (!dispatch.has(name)) {
                // First-come, first-served.
                dispatch.set(name, [children[ix]]);
              }
            }
          });
        });

        children.forEach((child, ix) => {
          child.channel.on('request', (msg) => {
            forwarder(child.channel, msg);
          });

          child.channel.sendResult(all[ix], {
            implements: [...dispatch.keys()].filter((x) =>
              /^request\./.test(x.toString())
            ),
          });
        });

        // TODO: make jipe jipe
        // lhsChannel.on('request', (msg) => {
        //   forwarder(lhsChannel, msg);
        // });
      }
    );
  }
}

async function main() {
  const options = commandLineArgs(
    [
      {
        name: 'help',
        type: Boolean,
      },
    ],
    {
      stopAtFirstUnknown: true,
    }
  );

  if (options.help || !options._unknown) {
    process.stdout.write(`
---------------------------------------------------------------------
  jipe - stdio ndjson jsonrpc process composition
---------------------------------------------------------------------

  Jipe allows you compose an implementation of a JSON-RPC 2.0 API 
  from multiple independent processes. It spawns child process as
  specified on the command line and expects them to communicate 
  with newline-delimited messages on their STDIN/STDOUT streams.

  In order for \`jipe\` to know where requests and notifications
  should be sent, child processes initially have to send a request
  for method \`jipe.start\` to \`jipe\` with \`params.implements\`
  set to an array of method names prefixed by \`notification.\` or
  \`request.\`. When all children have made such a request, \`jipe\`
  will send a result to all children with \`params.implements\` set
  to the union of all values it received, allowing children to 
  complain when methods they need are missing.

  EXAMPLE:

    % jipe -- pinger -- pingme

  Here \`jipe\` will spawn \`pinger\` and \`pingme\` which are then
  expected to send a \`jipe.start\` request:

    pingme stdout: { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":["request.ping"]} }

    pinger stdout: { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":[]} }

  Now that all processes have signaled they are ready, \`jipe\` will
  send the union of all reported \`implements\` values as result:

    pingme stdin:  { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":["request.ping"]} }

    pinger stdin:  { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "jipe.start",
                     "params"  : {"implements":["request.ping"]} }

  And then \`pinger\` can send a \`ping\` request to \`jipe\`:

    pinger stdout: { "jsonrpc" : "2.0",
                     "id"      : 2,
                     "method"  : "ping",
                     "params"  : {"value": 123} }

  Which \`jipe\` will then route to \`pingme\`:

    pingme stdin:  { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "method"  : "ping",
                     "params"  : {} }

  Which could then respond by echoing the params back:

    pingme stdout: { "jsonrpc" : "2.0",
                     "id"      : 1,
                     "params"  : {"value": 123} }

  And \`jipe\` will forward the result to \`pinger\`:

    pinger stdin:  { "jsonrpc" : "2.0",
                     "id"      : 2,
                     "params"  : {"value": 123} }

  Note that \`jipe\` does not blindly forward messages literally,
  it takes care to create new requests with appropriate \`id\`s.

---------------------------------------------------------------------
  https://github.com/hoehrmann/node-jipe/
---------------------------------------------------------------------
  Copyright (c) 2019 Bjoern Hoehrmann, https://bjoern.hoehrmann.de/
---------------------------------------------------------------------
`);
    process.exit(1);
  }

  const mediator = new Mediator();
  mediator.start(process.argv);
}

main();
