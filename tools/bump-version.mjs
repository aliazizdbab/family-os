import fs from 'node:fs';
import path from 'node:path';

const swPath = path.resolve('public/sw.js');
const pkgPath = path.resolve('package.json');

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const newCacheVersion = `family-os-v${version}-${timestamp}`;

  let swContent = fs.readFileSync(swPath, 'utf8');
  swContent = swContent.replace(
    /const CACHE_VERSION = '.*?';/,
    `const CACHE_VERSION = '${newCacheVersion}';`
  );

  fs.writeFileSync(swPath, swContent);
  console.log(`✅ Updated public/sw.js CACHE_VERSION to: ${newCacheVersion}`);
} catch (err) {
  console.error('❌ Failed to bump version:', err);
  process.exit(1);
}
