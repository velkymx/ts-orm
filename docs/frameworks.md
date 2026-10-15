# Using ts-orm with a web framework

The pattern is the same in every framework: define each model once in a shared module, import it in handlers, and never open or close connections per request. The driver comes from the environment and is shared process-wide; the framework owns the request lifecycle, ts-orm owns the queries.

```ts
// db.ts, imported everywhere, instantiated once
import { defineStruct, defineModel } from '@velkymx/ts-orm';

const User = defineStruct('users', {
  id: { type: 'number', required: true, default: 'auto_increment' },
  name: { type: 'string', required: true, length: 50 },
});

export class Users extends defineModel(User) {}
```

Two rules cover the rest. Reads and writes use the bound driver, so handlers pass no driver. Inside a transaction, pass the tx handle explicitly (`Users.find(1, tx)`), or the statement silently runs outside the transaction. See [Transactions](transactions.md) for the full semantics.

## Express

```ts
import express from 'express';
import { Users } from './db.js';

const app = express();
app.use(express.json());

app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await Users.find(Number(req.params.id));
    if (user === null) {
      res.status(404).json({ error: 'No such user' });
      return;
    }
    res.json(user.toRow());
  } catch (error) {
    next(error);
  }
});

app.post('/users', async (req, res, next) => {
  try {
    const user = await Users.create({ name: req.body.name });
    res.status(201).json(user.toRow());
  } catch (error) {
    next(error);
  }
});

// Validation failures throw Error with a joined message; driver failures
// throw the mapped error. Shape them in one place:
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = message.includes('required') || message.includes('Validation failed') ? 400 : 500;
  res.status(status).json({ error: message });
});

app.listen(3000);
```

## Next.js App Router

Define models in a module outside `app/`, then use them in route handlers and server actions. Do not close the driver per request: under `next dev`, modules reload often, and the shared default driver survives reloads while a per-request driver would leak pools.

```ts
// app/api/users/[id]/route.ts
import { NextResponse } from 'next/server';
import { Users } from '@/db.js';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await Users.find(Number(params.id));
  if (user === null) {
    return NextResponse.json({ error: 'No such user' }, { status: 404 });
  }
  return NextResponse.json(user.toRow());
}
```

```ts
// app/actions.ts
'use server';

import { redirect } from 'next/navigation';
import { Users } from '@/db.js';

export async function createUser(formData: FormData) {
  const name = String(formData.get('name') ?? '');
  await Users.create({ name });
  redirect('/users');
}
```

A server action that writes then reads in one atomic unit takes the tx handle explicitly:

```ts
'use server';

import { getDefaultDriver, transaction } from '@velkymx/ts-orm';
import { Users } from '@/db.js';

export async function transferMembership(fromId: number, toId: number) {
  await transaction(getDefaultDriver(), async (tx) => {
    const from = await Users.findOrFail(fromId, tx);
    const to = await Users.findOrFail(toId, tx);
    from.fill({ name: `${from.toRow().name} (moved)` });
    await from.save(tx);
    await to.save(tx);
  });
}
```

## Other frameworks

Fastify, Hono, Koa, and SvelteKit all reduce to the same three lines: one shared `db.ts`, handlers that call finders with no driver, and an explicit tx handle wherever atomicity is required. If a framework guide would help, file an issue naming it.
