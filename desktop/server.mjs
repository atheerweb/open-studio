import { once } from 'node:events';
import { createStudio } from '../server/studio.mjs';

export async function startDesktopServer(options) {
  const server = createStudio(options);
  const ready = once(server,'listening');
  server.listen(0,'127.0.0.1');
  await ready;

  let shutdown;
  return {
    url:'http://localhost:' + server.address().port + '/',
    stop() {
      shutdown ??= Promise.all([
        new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())),
        server.closeWorkspace()
      ]);
      return shutdown;
    }
  };
}
