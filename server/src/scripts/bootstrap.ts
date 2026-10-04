import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { withTransaction, closeConnection } from '../config/db.js';
import { registration } from '../utils/validator.js';
// Credentials are passed via a hidden prompt, not CLI arguments, environment or source code.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
let hidden = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!hidden) process.stdout.write(chunk);
    callback();
  },
});
const prompt = createInterface({ input: process.stdin, output, terminal: true });
try {
  const username = await prompt.question('Admin username: ');
  const name = await prompt.question('Admin name: ');
  process.stdout.write('Admin password (hidden): ');
  hidden = true;
  const password = await prompt.question('');
  hidden = false;
  process.stdout.write('\n');
  const data = registration.parse({ username, name, password });
  const hash = await bcrypt.hash(data.password, 12);
  await withTransaction(async (tx) => {
    const id = (
      await tx
        .request()
        .input('username', data.username)
        .input('name', data.name)
        .input('hash', hash)
        .query(
          "INSERT INTO \"Users\"(username,name,password_hash,role) VALUES(@username,@name,@hash,'ADMIN') RETURNING id",
        )
    ).recordset[0].id;
    await tx
      .request()
      .input('id', id)
      .input('request', randomUUID())
      .query(
        "INSERT INTO \"AuditLog\"(user_id,action,resource_type,resource_id,request_id,ip_address) VALUES(NULL,'CREATE_USER','user',@id,@request,'bootstrap')",
      );
  });
  console.info('Admin created');
} catch {
  console.error('Admin creation failed; check validation/duplicate user/database');
  process.exitCode = 1;
} finally {
  prompt.close();
  await closeConnection();
}
