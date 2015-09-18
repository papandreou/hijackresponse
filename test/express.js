/* global describe, it */
var expect = require('unexpected')
  .clone()
  .use(require('unexpected-express'))
var express = require('express')
var hijackResponse = require('../')

describe('Express Integration Tests', function () {
  it('simple case', function () {
    var app = express()
      .use(function (req, res, next) {
        hijackResponse(res, function (err, res) {
          var chunks = []
          res.on('data', function (chunk) {
            chunks.push(chunk)
          })
          res.on('end', function () {
            var result = Buffer.concat(chunks).toString('utf-8').toUpperCase()
            res.write(new Buffer(result))
            res.end()
          })
        })
        next()
      })
      .use(function (req, res, next) {
        res.setHeader('Content-Type', 'text/plain')
        return res.end('foobar')
      })

    return expect(app, 'to yield exchange', {
      request: 'GET /',
      response: {
        statusCode: 200,
        body: 'FOOBAR'
      }
    })
  })
  describe('adapted from express-hijackresponse', function () {
    it('Create a test server that pipes the hijacked response into itself, then do a request against it (simple variant)', function () {
      var app = express()
        .use(function (req, res, next) {
          hijackResponse(res, function (err, res) {
            res.pipe(res)
          })
          next()
        })
        .use(function (req, res, next) {
          res.send('foo')
        })

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: 'foo'
      })
    })
    it('Create a test server that pipes the hijacked response into itself, then do a request against it (streaming variant)', function () {
      var app = express()
        .use(function (req, res, next) {
          hijackResponse(res, function (err, res) {
            res.pipe(res)
          })
          next()
        })
        .use(function (req, res, next) {
          var num = 0
          res.setHeader('Content-Type', 'text/plain')
          (function proceed() {
            if (num < 5) {
              res.write('foo')
              num += 1
              process.nextTick(proceed)
            } else {
              res.end('bar')
            }
          }())
        })

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: 'foofoofoofoofoobar'
      })
    })
    it('Create a test server that pipes the original response through a buffered stream, then do a request against it (simple variant)', function () {
      var app = express()
        .use(function (req, res, next) {
          hijackResponse(res, function (err, res) {
            var bufferedStream = new (require('bufferedstream'))();
            res.pipe(bufferedStream);
            bufferedStream.pipe(res);
          });
          next();
        })
        .use(function (req, res, next) {
          res.send('foo');
        })

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: 'foo'
      })
    })
    it('Create a test server that pipes the original response through a buffered stream, then do a request against it (streaming variant)', function () {
      // When porting this test from express-hijackresponse I found the comment below. But it turns out that the test works now, using node 0.10.38
      // ----
      // The below test fails because Stream.prototype.pipe tears down the pipe when the destination stream emits the 'end' event.
      // There are plans to fix this as part of the streams2 effort: https://github.com/joyent/node/pull/2524
      var app = express()
        .use(function (req, res, next) {
          hijackResponse(res, function (err, res) {
            var bufferedStream = new (require('bufferedstream'))();
            res.pipe(bufferedStream);
            bufferedStream.pipe(res);
          });
          next();
        })
        .use(function (req, res, next) {
          res.contentType('text/plain')
          res.end('bar');
        })

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: 'bar'
      })
    })
    it('Create a test server that hijacks the response and passes an error to next(), then run a request against it', function () {
      // when porting the below test from express-hijackresponse I found the below comment. It seems to be resolved since.
      // ---
      // The following test fails with 'callback not called', can't see why
      var app = express()
        .use(function (req, res, next) {
          hijackResponse(res, function (err, res) {
            res.unhijack(function (res) {
                next(new Error('Error!'));
            });
          });
          next();
        })
        .use(function (req, res, next) {
          res.send("foo");
        })
        .use(require('errorhandler')({ log: false }))

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: 500
      })
    })
    it('Create a test server that hijacks the response and immediately unhijacks it, then run a request against it', function () {
      var app = express()
        .use(function (req, res, next) {
          hijackResponse(res, function (err, res) {
            res.unhijack(true);
          });
          next();
        })
        .use(function (req, res, next) {
          res.send("foo");
        })

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: 'foo'
      })
    })
    it.skip('Create a test server that pauses the original response after each emitted "data" event, then run a request against it', function () {
      // Fails due to pause/resume not being implemented in node 0.10 on the stream we're using
      var events = []
      var app = express()
        .use(function (req, res, next) {
          events.push("hijack");
          var isPaused = false;
          hijackResponse(res, function (err, res) {
            res.on('data', function (chunk) {
              events.push(chunk);
              if (!isPaused) {
                isPaused = true;
                events.push('pause');
                res.pause();
                setTimeout(function () {
                  events.push('resume');
                  res.resume();
                  isPaused = false;
                }, 2);
              }
            }).on('end', function () {
              events.push('end');
              res.send({events: events});
            });
          });
          next();
        })
        .use(function (req, res, next) {
          var num = 0;
          (function proceed() {
            if (num < 3) {
              num += 1;
              var isPaused = !res.write('foo' + num);
              if (isPaused) {
                res.once('drain', function () {
                  events.push('drain');
                  proceed();
                });
              } else {
                process.nextTick(proceed);
              }
            } else {
              res.end();
            }
          }());
        })

      return expect(app, 'to yield exchange', {
        request: 'GET /',
        response: {
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            events: [
              'hijack',
              'foo1',
              'pause',
              'resume',
              'drain',
              'foo2',
              'pause',
              'resume',
              'drain',
              'foo3',
              'pause',
              'resume',
              'drain',
              'end'
            ]
          }
        }
      })
    })
  })
})
