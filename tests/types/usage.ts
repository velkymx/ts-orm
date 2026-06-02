// Type-level fixture (PROD-4): proves the row generic flows through the public
// API. Compiled by `npm run typecheck`; never executed. If generics regress
// (data falls back to `unknown`), these annotations stop compiling.
import { model } from '../../src/index.js';

interface User {
  id: number;
  name: string;
}

async function check(): Promise<void> {
  const Users = model<User>('users', []);

  // find -> OrmResponse<User>
  const found = await Users.find(1);
  if (found.success) {
    const name: string = found.data.name;
    void name;
  } else {
    // Discriminated: on the failure branch, data is the error payload, not User.
    const err: string | string[] | null = found.data;
    void err;
  }

  // all -> OrmResponse<User[]>
  const list = await Users.all();
  if (list.success) {
    const first = list.data[0];
    if (first) {
      const n: string = first.name;
      void n;
    }
  }

  // builder chain -> OrmResponse<User[]> / OrmResponse<User>
  const filtered = await Users.where('id', 1).get();
  if (filtered.success) {
    const id: number = filtered.data[0]?.id ?? 0;
    void id;
  }

  const one = await Users.where('id', 1).first();
  if (one.success) {
    const nm: string = one.data.name;
    void nm;
  }
}

void check;
