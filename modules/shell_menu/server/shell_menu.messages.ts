export const ShellMenuMessages = {
  DRAFT_CHANGED: 'Someone else saved the draft in the meantime',
  PUBLISHED_CHANGED: 'The published menu changed since this draft was started',
  NO_DRAFT: 'There is no draft to publish',
  DRAFT_HAS_ERRORS: 'The draft has errors; fix them before publishing',
  REVISION_NOT_FOUND: 'No such revision',
  ALREADY_PUBLISHED: 'A menu is already published; replace it explicitly',
  INVALID_FILE: 'Not a menu file',
  UNKNOWN_LANGUAGE: 'Unknown language',
  UNKNOWN_LINK_KIND: 'Unknown link kind',
} as const;

/** Open the editor and read the menu, its history and its catalog (system scope, root super-admin, GLOBAL). */
export const LAYOUT_READ_PERMISSION = 'shell_menu.layout.read';
/** Edit the draft, publish, restore and import (system scope, root super-admin, GLOBAL); audited. */
export const LAYOUT_MANAGE_PERMISSION = 'shell_menu.layout.manage';

/** The export file's format tag. */
export const MENU_FILE_FORMAT = 'nb-menu/1';
