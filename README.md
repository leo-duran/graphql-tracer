# Apollo Tracer Agent

Trace collection library for GraphQL servers.

This library is designed to be used for two purposes:

- collecting traces from JavaScript `graphql`
  [reference implementation](github.com/graphql/graphql-js)
- collecting custom events from resolvers

## Setup

First, initialize Tracer with the application key.

Then, on every new query, generate a new tracer object, and pass it to the
`graphql` logging, and attach it to the context object so that resolvers
can call it.

```javascript
import express from 'express';
import { Tracer } from 'apollo-tracer';
import { execute, parse, Source } from 'graphql';

const app = express();

const executableSchema = ...;
const tracer = new Tracer({ TRACER_APP_KEY: '...' });
app.use('/graphql', (req, res) => {
    // ...
    // get query, variables, operationName
    // ...
    const source = new Source(query, 'GraphQL request');
    const documentAST = parse(source);
    const context = { tracer };
    execute(
        executableSchema,
        documentAST,
        rootValue,
        context,
        variables,
        operationName,
        logFn: tracer.graphqlLogger
    );
});

app.listen(3000);
```
