/**
 * Upload type policy: deny by default, per folder (docs/phases/38-security/04-xss-csp-uploads.md 4.5, IoT scoping rule 3).
 *
 * With no tenant setting the allowlist used to be EMPTY, which meant allow-all: a renamed `.exe`, an `.html` page or a scripted `.svg`
 * was accepted out of the box. Now an unconfigured tenant gets `DEFAULT_ALLOWED_EXTENSIONS` (every type the magic-byte check can
 * verify, the office formats and plain data text) and nothing else. `html`, `svg` and `xml` are excluded because a browser renders them
 * as active content; each can be enabled for a folder that needs it, with `registerFolderUploadPolicy`. A tenant's own
 * `allowedExtensions` setting, when set, is the explicit decision and replaces the default for every folder.
 *
 * Folders carry their own policy, so a future firmware folder (any binary, its own size cap) is a registration, not a loosening of the
 * default for everyone else.
 */

/** Types an unconfigured tenant may upload: verifiable signatures, office containers, plain data text. */
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico',
  'pdf', 'zip', 'gz', 'mp4', 'mp3',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub',
  'txt', 'csv', 'json', 'md', 'yaml', 'yml',
]

/** Extensions a browser renders as active content: never in the default, enabled per folder only. */
export const ACTIVE_CONTENT_EXTENSIONS: readonly string[] = ['html', 'htm', 'svg', 'xml', 'xhtml']

export interface FolderUploadPolicy {
  /** Extensions allowed in this folder IN ADDITION to the default (or the tenant's explicit list). */
  extraExtensions?: readonly string[]
  /** A per-file cap for this folder, bytes; never raises the tenant or transport cap, only lowers it. */
  maxBytes?: number
}

const folderPolicies = new Map<string, FolderUploadPolicy>()

/** Registers (replaces) the policy of one folder. Extensions are normalised to lower case without a dot. */
export function registerFolderUploadPolicy(folder: string, policy: FolderUploadPolicy): void {
  folderPolicies.set(folder, {
    extraExtensions: (policy.extraExtensions ?? []).map((e) => e.trim().toLowerCase().replace(/^\./, '')).filter(Boolean),
    maxBytes: policy.maxBytes && policy.maxBytes > 0 ? policy.maxBytes : undefined,
  })
}

export function folderUploadPolicy(folder: string | undefined): FolderUploadPolicy {
  return (folder && folderPolicies.get(folder)) || {}
}

/** Test helper. */
export function resetFolderUploadPolicies(): void {
  folderPolicies.clear()
}

/**
 * 04-tenant-setting 2.3: an allowlist no file name matches. A file's extension is what follows its last dot, so it never is `.`; and the list is
 * not empty, so the validator does not read it as allow-all.
 */
export const REFUSE_EVERY_EXTENSION: readonly string[] = ['.']

/**
 * The extension allowlist in force: the tenant's explicit list when it set one, else the default, plus the folder's extras
 * (the folder is the narrower, deliberate scope).
 *
 * 04-tenant-setting 2.3: the tenant-wide list never enables active content. A tenant-wide `svg` / `html` / `xml` would let scripted files into
 * every folder, which only a folder's own policy may do, so those entries are dropped here, where the setting takes effect (the settings API cannot
 * refuse them on write: storage requires tenant_setting, so tenant_setting may not import this list). A list that held nothing else is still the
 * tenant's explicit, narrow decision: it never widens to the default. It allows nothing beyond the folder's extras, and when that leaves the list
 * empty (which the validator reads as allow-all) the answer is `REFUSE_EVERY_EXTENSION`.
 */
export function effectiveExtensions(tenantList: readonly string[], folder: string | undefined): string[] {
  const tenantSafe = tenantList.filter((e) => !ACTIVE_CONTENT_EXTENSIONS.includes(e))
  const base = tenantList.length > 0 ? tenantSafe : DEFAULT_ALLOWED_EXTENSIONS
  const list = [...new Set([...base, ...(folderUploadPolicy(folder).extraExtensions ?? [])])]
  return list.length > 0 ? list : [...REFUSE_EVERY_EXTENSION]
}
