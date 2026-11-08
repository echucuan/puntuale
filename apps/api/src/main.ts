import { loadConfig } from './config/app-config';
import { createApp } from './create-app';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.port);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
