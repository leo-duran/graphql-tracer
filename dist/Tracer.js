'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Tracer = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _performanceNow = require('performance-now');

var _performanceNow2 = _interopRequireDefault(_performanceNow);

var _nodeUuid = require('node-uuid');

var _nodeUuid2 = _interopRequireDefault(_nodeUuid);

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var TRACER_INGRESS_URL = process.env.TRACER_INGRESS_URL || 'https://nim-test-ingress.appspot.com';

var Tracer = function () {
  // TODO make sure Tracer can NEVER crash the server.
  // maybe wrap everything in try/catch, but need to test that.

  function Tracer(_ref) {
    var TRACER_APP_KEY = _ref.TRACER_APP_KEY;
    var _ref$sendReports = _ref.sendReports;
    var sendReports = _ref$sendReports === undefined ? true : _ref$sendReports;
    var reportFilterFn = _ref.reportFilterFn;

    _classCallCheck(this, Tracer);

    if (!TRACER_APP_KEY || TRACER_APP_KEY.length < 36) {
      throw new Error('Tracer requires a well-formatted TRACER_APP_KEY');
    }
    // TODO check that sendReports is a boolean
    // TODO check that report filter fn is a function (if defined)
    this.TRACER_APP_KEY = TRACER_APP_KEY;
    this.startTime = new Date().getTime();
    this.startHrTime = (0, _performanceNow2.default)();
    this.sendReports = sendReports;
    this.reportFilterFn = reportFilterFn;
  }

  _createClass(Tracer, [{
    key: 'sendReport',
    value: function sendReport(report) {
      var filteredEvents = report.events;
      if (this.reportFilterFn) {
        filteredEvents = report.events.filter(this.reportFilterFn);
      }
      var options = {
        url: TRACER_INGRESS_URL,
        method: 'PUT',
        headers: {
          'user-agent': 'apollo tracer v' + report.tracerApiVersion
        },
        json: _extends({}, report, {
          events: filteredEvents
        })
      };
      (0, _request2.default)(options, function (err) {
        if (err) {
          console.error('Error trying to report to tracer backend:', err.message);
          return;
        }
      });
    }
  }, {
    key: 'newLoggerInstance',
    value: function newLoggerInstance() {
      var _this = this;

      var queryId = _nodeUuid2.default.v4();
      var events = [];
      var idCounter = 0;
      var startTime = new Date().getTime();
      var startHrTime = (0, _performanceNow2.default)();

      var log = function log(type) {
        var data = arguments.length <= 1 || arguments[1] === undefined ? null : arguments[1];
        var startEventId = arguments.length <= 2 || arguments[2] === undefined ? null : arguments[2];

        var id = idCounter++;
        var timestamp = (0, _performanceNow2.default)();

        var extData = startEventId ? Object.assign({}, data, { startEventId: startEventId }) : data;

        events.push({
          id: id,
          timestamp: timestamp,
          type: type,
          data: extData
        });

        return id;
      };

      var report = function report() {
        return {
          TRACER_APP_KEY: _this.TRACER_APP_KEY,
          tracerApiVersion: '0.1.0',
          queryId: queryId,
          startTime: startTime,
          startHrTime: startHrTime,
          events: events
        };
      };

      var submit = function submit() {
        if (_this.sendReports) {
          _this.sendReport(report());
        }
      };

      var startEventIdMapping = {};
      var graphqlLogger = function graphqlLogger(tag, payload, info) {
        // XXX the graphql logger tags are capitalized words separated
        // with underscores
        tag = tag.toLowerCase().replace(/_/g, '.');
        var tagParts = tag.split('.');
        var lastTagPart = tagParts[tagParts.length - 1];

        // since the interface of graphql logging doesn't correlate
        // start and end events, we need to do it ourselves using path
        if (lastTagPart === 'start') {
          var id = log(tag, payload);
          var key = payload && payload.path ? JSON.stringify([tag, payload.path]) : tag;
          startEventIdMapping[key] = id;
        } else if (lastTagPart === 'end') {
          var _key = payload && payload.path ? JSON.stringify([tag.replace(/\.end$/, '.start'), payload.path]) : tag;
          var startEventId = startEventIdMapping[_key];
          delete startEventIdMapping[_key];
          log(tag, Object.assign({}, payload, { startEventId: startEventId }));
        } else {
          log(tag, payload);
        }
      };

      return {
        log: log,
        report: report,
        submit: submit,
        graphqlLogger: graphqlLogger
      };
    }
  }]);

  return Tracer;
}();

exports.Tracer = Tracer;