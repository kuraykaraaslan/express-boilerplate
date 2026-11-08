import { legacyMenuFile, legacyShellProfile } from '../generated/install-config.legacy';

// Whether a file-based menu (docs/phases/45-install-config D45-3: config/menu.ts, app/shell.profile.ts) is still in the
// installation. The menu is set in Platform → Menu now (docs/phases/54-menu-editor); the check fails while one is left.
// The generated shim only records presence and never imports the files, so an old file cannot break the build.

export const legacyMenuFiles = (): { legacyMenuFile: boolean; legacyShellProfile: boolean } => ({ legacyMenuFile, legacyShellProfile });
