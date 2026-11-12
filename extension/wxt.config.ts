import { defineConfig } from 'wxt';

/**
 * Fixed public key so the extension ID is the same on every machine:
 *   nfdcncheigkogigcjnjpinbmfoibebme
 * The native host manifest (bridge/src/register.ts) allows only that ID.
 * If you replace this key, recompute the ID with `node scripts/extension-id.mjs`
 * and update EXTENSION_ID in bridge/src/constants.ts and extension/lib/constants.ts.
 */
const PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs458oSH/Uw//mR4kM6PxyA0JsmLhe/fCnRtZYlEoGCow9rW7SCmF8pB07esRoR73qCBRbpvwrcyxQ2zG3hNzSK2xooEOATHdrKYAk41PA6XSgBj07uR5HVnfJ1CO8zIbnwH+Gvx4k9G1JHCCArDdqlrNNvbZe7MvXgH4XuOD8tkkuCTnlWCvWlhp0AgyAs0nnPf847DSfDMGnpkVguU2oiRUsTZ7tz0hIcAnHfVwcUqBsAA0zOn2Jk8pAiOPgiv4I1LguGdWO+Eruf6Fg3AcrLMyVFrXiO8GCn6FgkUSp2Oq8LBFH+rKY9JoPsvzkxBkDT8wPLXftvhJPwy1xF807QIDAQAB';

export default defineConfig({
  browser: 'chrome',
  // Visible folder (not WXT's default hidden .output) so it's easy to pick in "Load unpacked".
  outDir: 'dist',
  manifestVersion: 3,
  manifest: {
    name: 'Spoor',
    description:
      'Records how you work in the browser, on your machine only, so you can analyze it with your own Claude.',
    key: PUBLIC_KEY,
    minimum_chrome_version: '116',
    permissions: [
      'tabs',
      'webNavigation',
      'idle',
      'storage',
      'unlimitedStorage',
      'scripting',
      'alarms',
      'nativeMessaging',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Spoor',
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    incognito: 'not_allowed',
  },
  zip: {
    artifactTemplate: 'spoor-extension-{{version}}.zip',
  },
});
