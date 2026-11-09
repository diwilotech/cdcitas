// Base local para las pruebas. Las migraciones de producción de Citas incluyen una (0023_restore_spaces) que solo es válida sobre la
// historia real (restaura datos de un negocio de producción tras una migración borrada), así que no se puede aplicar a una base nueva.
// Aquí se copian las migraciones a una carpeta temporal con esa en no-op y se aplican a la base local. Producción no cambia.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
const tmp = resolve('.wrangler/test-migrations');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
cpSync('migrations', tmp + '/migrations', { recursive: true });
writeFileSync(tmp + '/migrations/0023_restore_spaces.sql', '-- no-op en pruebas\nSELECT 1;\n');
writeFileSync(tmp + '/wrangler.toml', `name = "cdcitas-test"\nmain = "${resolve('src/index.js')}"\ncompatibility_date = "2025-09-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "control-de-citas-db"\ndatabase_id = "2b827e45-bfef-4646-bbc3-23ffe75c9534"\nmigrations_dir = "${tmp}/migrations"\n`);
rmSync('.wrangler/state/v3/d1', { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply control-de-citas-db --local --persist-to "${resolve('.wrangler/state')}" -c "${tmp}/wrangler.toml"`, { stdio: 'inherit', env: { ...process.env, CI: '1' } });
