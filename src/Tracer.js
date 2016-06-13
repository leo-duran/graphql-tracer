import now from 'performance-now';
import uuid from 'node-uuid';
import request from 'request';
import { forEachField } from 'graphql-tools';

// enum for event types:
//  - tick   -  an individual event
//  - start  -  the starting point of some event interval
//  - end    -  the end point of the event
const INTERVAL = {
  TICK: 0,
  START: 1,
  END: 2,
};

const TRACER_INGRESS_URL = process.env.TRACER_INGRESS_URL ||
      'https://nim-test-ingress.appspot.com';

class Tracer {
  // TODO make sure Tracer can NEVER crash the server.
  // maybe wrap everything in try/catch, but need to test that.

  constructor({ TRACER_APP_KEY, sendReports = true, reportFilterFn }) {
    if (!TRACER_APP_KEY || TRACER_APP_KEY.length < 36) {
      throw new Error('Tracer requires a well-formatted TRACER_APP_KEY');
    }
    // TODO check that sendReports is a boolean
    // TODO check that report filter fn is a function (if defined)
    this.TRACER_APP_KEY = TRACER_APP_KEY;
    this.startTime = (new Date()).getTime();
    this.startHrTime = now();
    this.sendReports = sendReports;
    this.reportFilterFn = reportFilterFn;
  }

  sendReport(report) {
    // so far collected a bunch of events that look like:
    //     { id, data, ..., eventType: tick|start|end }
    // group the corresponding start and end events

    const groupedEvents = [];
    const groupedEventById = {};
    report.events.forEach(event => {
      const groupedEvent = {
        query_id: event.queryId,
        start: event.timestamp,
        end: event.timestamp,
        resolver_name: event.resolverName,
        payload: event.data
      };

      if (event.eventType === INTERVAL.TICK) {
        groupedEvents.push(groupedEvent);
      } else if (event.eventType === INTERVAL.START) {
        groupedEvents.push(groupedEvent);
        groupedEventById[event.id] = groupedEvent;
      } else if (event.eventType === INTERVAL.END) {
        const startEvent = groupedEventById[event.id];
        startEvent.end = event.timestamp;
      }
    });

    let filteredEvents = groupedEvents;
    if (this.reportFilterFn) {
      filteredEvents = groupedEvents.filter(this.reportFilterFn);
    }
    const options = {
      url: TRACER_INGRESS_URL,
      method: 'PUT',
      headers: {
        'user-agent': `apollo tracer v${report.tracerApiVersion}`,
      },
      json: {
        ...report,
        events: filteredEvents,
      },
    };
    request(options, (err) => {
      if (err) {
        console.error('Error trying to report to tracer backend:', err.message);
        return;
      }
    });
  }

  newLoggerInstance() {
    const queryId = uuid.v4();
    const events = [];
    let idCounter = 0;
    const startTime = (new Date()).getTime();
    const startHrTime = now();

    // the idea is to automatically generate id's for the events
    // but in case it is an event that has a starting and an ending points
    // the caller should be able to take the id and pass it in saying
    // "this is the end point of the event with that id"
    const log = (
      type,
      resolverName = null,
      data = null,
      eventType = INTERVAL.TICK,
      id = null
    ) => {
      if (id === null) {
        id = idCounter++;
      }
      const timestamp = now();
      events.push({ id, timestamp, resolverName, type, data, eventType });
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
}

export { Tracer, INTERVAL };
