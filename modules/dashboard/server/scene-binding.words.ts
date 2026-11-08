import { loadServerT } from '@kuraykaraaslan-labs/i18n/server/messages'
import { dictionaries } from '../dictionaries'
import type { SceneViewWords } from './scene-binding.names'

/**
 * The words a view's label is made of (47.2, 47.3), from this module's dictionary in `locale`. The two kinds the platform ships have their own words
 * (`design` a 3D view, `diagram` a 2D drawing, as the Scene tab says them); a kind another module adds later reads as a plain "View" until the
 * scene kind seam carries a word of its own (docs/audits/2026-10-30-phases-46-50.md, P47-3).
 */
export async function sceneViewWords(locale: string): Promise<SceneViewWords> {
  const t = await loadServerT(dictionaries, locale)
  const kind = (k: string) => (k === 'design'
    ? t('dashboard.sceneViews.kindDesign', '3D view')
    : k === 'diagram' ? t('dashboard.sceneViews.kindDiagram', '2D drawing') : t('dashboard.sceneViews.kindOther', 'View'))
  const first = (k: string) => (k === 'design'
    ? t('dashboard.sceneViews.firstDesign', 'First 3D view')
    : k === 'diagram' ? t('dashboard.sceneViews.firstDiagram', 'First 2D drawing') : t('dashboard.sceneViews.firstOther', 'First view'))
  const nth = (k: string, n: number) => (k === 'design'
    ? t('dashboard.sceneViews.nthDesign', '3D view {{n}}', { n })
    : k === 'diagram' ? t('dashboard.sceneViews.nthDiagram', '2D drawing {{n}}', { n }) : t('dashboard.sceneViews.nthOther', 'View {{n}}', { n }))
  const notSetUp = (subjectType?: string) => (subjectType === undefined
    ? t('dashboard.sceneViews.notSetUpAnywhere', 'not set up anywhere')
    : subjectType === 'iot_device' ? t('dashboard.sceneViews.notSetUpDevice', 'not set up on this device')
      : subjectType === 'iot_asset' ? t('dashboard.sceneViews.notSetUpSite', 'not set up on this site') : t('dashboard.sceneViews.notSetUpHere', 'not set up here'))
  return {
    kind, first, nth, notSetUp,
    gone: t('dashboard.sceneViews.gone', 'the drawing was deleted'),
    more: (count) => t('dashboard.sceneViews.more', '+{{count}} more', { count }),
  }
}
