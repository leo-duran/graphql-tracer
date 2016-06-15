import now from 'performance-now';
import uuid from 'node-uuid';
import request from 'request';

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
    let filteredEvents = report.events;
    if (this.reportFilterFn) {
      filteredEvents = report.events.filter(this.reportFilterFn);
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

    const log = (type, data = null) => {
      const id = idCounter++;
      const timestamp = now();
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
}

export { Tracer };
