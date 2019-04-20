#!/usr/bin/env node

import { Channel, JsonrpcStdErrors } from './public';
import commandLineArgs = require('command-line-args');
import { spawn, ChildProcess } from 'child_process';
import { stackBy } from './stackBy';

class Child {
  process: ChildProcess;
  channel: Channel;
  startRequest: Promise<any>;

  constructor(process, channel, startRequest) {
    this.process = process;
    this.channel = channel;
    this.startRequest = startRequest;
  }

}

class Mediator {

  public start(argv: string[]) {

    const sep = '--';

    const stacks = Array.from(stackBy(argv, x => x === sep)).filter(
      x => x.length !== 1 || x[0] !== sep
    );

    const childArgs = stacks.slice(1);

    const children = childArgs.map((call, ix) => {
      const [ exec, ...args ] = call;
      const child = spawn(
        exec,
        args,
        {
          env: process.env,
          shell: false,
          stdio: ['pipe', 'pipe', 'inherit'],
        }
      );

      let channel: Channel;

      if (child.stdout && child.stdin) {
        channel = new Channel(child.stdout, child.stdin, {
          foo: true,
        });
      } else {
        throw `Child ${ix} (${exec} ${args}) has no stdio`;
      }

      const startRequest = new Promise((resolve, reject) => {
        channel.on('request.jipe.start', msg => {
          resolve(msg.request);
        });
      });

      return new Child(process, channel, startRequest);

    });

    children.forEach(child => {
      child.channel.on('message', (...args) => {
        // console.error(args);
      })
    });

    const dispatch = new Map<String, Child[]>();

    Promise.all(children.map(child => child.startRequest)).then(all => {

      all.forEach((request, ix) => {

        request.params.implements.forEach(name => {
          if (/^request\./.test(name)) {
            if (!dispatch.has(name)) {
              // First-come, first-served.
              dispatch.set(name, [children[ix]]);
            }
          }

/*
          if (/^notification\./.test(name)) {
            // Broadcast
            const old = dispatch.get(name) || [];
            dispatch.set(name, [...old, children[ix]]);
          }
*/

        });

      });

      children.forEach((child, ix) => {

/*
        child.channel.on('notification', msg => {
          const list = dispatch.get(msg.request.method) || [];
          list.forEach(subscriber => {
            subscriber.channel.sendNotification(
              msg.request.method,
              msg.request.params
            );
          })
        });
*/

        child.channel.on('request', async msg => {

          const name = `request.${msg.request.method}`;
          const handler = dispatch.get(name);

          if (handler) {

            const forwarded = await handler[0].channel.sendRequest(
              msg.request.method,
              msg.request.params,
              result => {
                if (msg.respond) {
                  child.channel.sendResult(msg.request, result);
                }
              },
              error => {
                if (msg.respond) {
                  child.channel.sendError(
                    msg.request,
                    error.code,
                    error.message,
                    error.data
                  );
                }
              }
            );

          } else {

            if (msg.respond) {
              child.channel.sendError(
                msg.request,
                -32601,
                `Method ${msg.request.method} not found`,
              );
            }

          }

        });

        child.channel.sendResult(all[ix], {
          implements: [...dispatch.keys()].filter(
            x => /^request\./.test(x.toString())
          )
        });
      });

    });

  }

}

async function main() {

  const options = commandLineArgs(
    [
      {
        name: 'help', type: Boolean,
      },
    ],
    {
      stopAtFirstUnknown: true
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
