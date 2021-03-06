import now from 'performance-now';
import uuid from 'node-uuid';
import request from 'request';
import { forEachField, addSchemaLevelResolveFunction } from 'graphql-tools';
import { print } from 'graphql/language';

const TRACER_INGRESS_URL = 'https://nim-test-ingress.appspot.com';

class Tracer {
  // TODO make sure Tracer can NEVER crash the server.
  // maybe wrap everything in try/catch, but need to test that.

  constructor({ TRACER_APP_KEY, sendReports = true, reportFilterFn, reportMapFn, proxy }) {
    if (!TRACER_APP_KEY || TRACER_APP_KEY.length !== 36) {
      throw new Error('Tracer requires a well-formatted TRACER_APP_KEY');
    }
    // TODO check that sendReports is a boolean
    // TODO check that report filter fn is a function (if defined)
    this.TRACER_APP_KEY = TRACER_APP_KEY;
    this.startTime = (new Date()).getTime();
    this.startHrTime = now();
    this.sendReports = sendReports;
    this.reportFilterFn = reportFilterFn;
    this.reportMapFn = reportMapFn;
    this.proxy = proxy;
  }

  sendReport(report) {
    let filteredEvents = report.events;
    if (this.reportFilterFn) {
      filteredEvents = report.events.filter(this.reportFilterFn);
    }
    if (this.reportMapFn) {
      filteredEvents = report.events.map(this.reportMapFn);
    }
    let body = '';
    try {
      body = JSON.stringify({ ...report, events: filteredEvents });
    } catch (e) {
      console.error('Cannot serialize tracer report');
      console.error(e.message);
      return;
    }

    const options = {
      url: TRACER_INGRESS_URL,
      proxy: this.proxy,
      method: 'PUT',
      headers: {
        'user-agent': `apollo tracer v${report.tracerApiVersion}`,
      },
      body,
    };
    request(options, (err) => {
      if (err) {
        console.error('Error trying to report to tracer backend:', err.message);
        return;
      }
      // console.log('status', response.statusCode);
    });
  }

  newLoggerInstance() {
    const queryId = uuid.v4();
    const events = [];
    let idCounter = 0;
    const startTime = (new Date()).getTime();
    const startHrTime = now();

    const log = (type, data = null) => {
      const id = idCounter++;
      const timestamp = now();
      // const timestamp = (new Date()).getTime();
      // console.log(timestamp, type, id, data);
      events.push({ id, timestamp, type, data });
      return id;
    };

    const report = () => {
      return {
        TRACER_APP_KEY: this.TRACER_APP_KEY,
        tracerApiVersion: '0.1.0',
        queryId,
        startTime,
        startHrTime,
        events,
      };
    };

    const submit = () => {
      if (this.sendReports) {
        this.sendReport(report());
      }
    };

    return {
      log,
      report,
      submit,
    };
  }

  /* log(type, data = null) {
    // TODO ensure props is a valid props thingy
    // TODO ensure info is a valid info thingy
    // TODO ensure type is a valid type thingy
    const id = this.idCounter++;
    const timestamp = now();
    // const timestamp = (new Date()).getTime();
    console.log(timestamp, type, id, data);
    this.events.push({ id, timestamp, type, data });
    return id;
  }

  report() {
    return {
      queryId: this.queryId,
      startTime: this.startTime,
      startHrTime: this.startHrTime,
      events: this.events,
    };
  } */
}

function decorateWithTracer(fn, info) {
  const decoratedResolver = (p, a, ctx, i) => {
    const startEventId = ctx.tracer.log('resolver.start', info);
    let result;
    try {
      result = fn(p, a, ctx, i);
    } catch (e) {
      // console.log('yeah, it errored directly');
      ctx.tracer.log('resolver.end', {
        ...info,
        resolverError: {
          message: e.message,
          stack: e.stack,
        },
        startEventId,
      });
      throw e;
    }

    try {
      if (result === null) {
        ctx.tracer.log('resolver.end', { ...info, returnedNull: true, startEventId });
        return result;
      }
      if (typeof result === 'undefined') {
        ctx.tracer.log('resolver.end', { ...info, returnedUndefined: true, startEventId });
        return result;
      }
      if (typeof result.then === 'function') {
        result.then((res) => {
          ctx.tracer.log('resolver.end', { ...info, startEventId });
          return res;
        })
        .catch((err) => {
          // console.log('whoa, it threw an error!');
          ctx.tracer.log('resolver.end', { ...info, startEventId });
          throw err;
        });
      } else {
        // console.log('did not return a promise. logging now');
        ctx.tracer.log('resolver.end', { ...info, startEventId });
      }
      return result;
    } catch (e) {
      // XXX this should basically never happen
      // if it does happen, we want to be able to collect these events.
      ctx.tracer.log('tracer.error', {
        ...info,
        result,
        tracerError: {
          message: e.message,
          stack: e.stack,
        },
        startEventId,
      });
      ctx.tracer.log('resolver.end', { ...info, startEventId });
      return result;
    }
  };

  // Add .$proxy to support graphql-sequelize.
  // See: https://github.com/mickhansen/graphql-sequelize/blob/edd4266bd55828157240fe5fe4d4381e76f041f8/src/generateIncludes.js#L37-L41
  decoratedResolver.$proxy = fn;

  return decoratedResolver;
}

// This function modifies the schema in place to add tracing around all resolve functions
function addTracingToResolvers(schema) {
  // XXX this is a hacky way of making sure that the schema only gets decorated
  // with tracer once.
  if (schema._apolloTracerApplied) {
    // console.log('Tracing already added to resolve functions. Not adding again.');
    return;
  }
  // eslint-disable-next-line no-param-reassign
  schema._apolloTracerApplied = true;

  forEachField(schema, (field, typeName, fieldName) => {
    const functionName = `${typeName}.${fieldName}`;
    if (field.resolve) {
      // eslint-disable-next-line no-param-reassign
      field.resolve = decorateWithTracer(
        field.resolve,
        { type: 'resolve', functionName },
      );
    }
  });
}

// This instruments a GraphQL.js schema when using tracer with express-graphql
function instrumentSchemaForExpressGraphQL(schema) {
  addTracingToResolvers(schema);
  addSchemaLevelResolveFunction(schema, (root, args, ctx, info) => {
    const operation = print(info.operation);
    const fragments = Object.keys(info.fragments).map(k => print(info.fragments[k])).join('\n');

    ctx.tracer.log('request.query', `${operation}\n${fragments}`);
    ctx.tracer.log('request.variables', info.variableValues);
    ctx.tracer.log('request.operationName', info.operation.name);
    return root;
  });
}

export { Tracer, decorateWithTracer, addTracingToResolvers, instrumentSchemaForExpressGraphQL };
