import { cpSync, existsSync } from 'fs';
import { join } from 'path';

// Resolve the project root directory
const root = join(__dirname, '..');

const copyIfExists = (srcRelative: string, destRelative: string) => {
  const src = join(root, srcRelative);
  const dest = join(root, destRelative);

  if (existsSync(src)) {
    console.log(`Copying ${srcRelative} to ${destRelative}...`);
    cpSync(src, dest, { recursive: true });
    console.log(`Successfully copied ${srcRelative}`);
  } else {
    console.log(`Directory ${srcRelative} does not exist, skipping.`);
  }
};

copyIfExists('.next/static', '.next/standalone/.next/static');
copyIfExists('public', '.next/standalone/public');
