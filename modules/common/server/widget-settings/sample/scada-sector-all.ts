// NB-owned, never re-vendored (was kui-react f886cc7: modules/app/WidgetKit/sample/scada-sector-all.ts). NB changes it itself; scripts/kui/vendor-widgetkit.mjs keeps it and refuses to overwrite it (docs/phases/07-dashboard/31-scada-pieces.md).
// Every sector sample (scenes and boards) in one list, in the order of the gallery.

import type { BoardDocument } from '../settings/board';
import type { ScadaScene } from './scada-scenes';
import * as process from './scada-sector-process';
import * as hvac from './scada-sector-hvac';
import * as power from './scada-sector-power';
import * as wastewater from './scada-sector-wastewater';
import * as oilgas from './scada-sector-oilgas';
import * as telecom from './scada-sector-telecom';
import * as food from './scada-sector-food';
import * as factory from './scada-sector-factory';
import * as mining from './scada-sector-mining';
import * as agri from './scada-sector-agri';
import * as city from './scada-sector-city';
import * as home from './scada-sector-home';
import * as appliance from './scada-sector-appliance';
import * as plant from './scada-sector-plant';
import * as states from './scada-sector-states';
import * as kitchen from './scada-sector-kitchen';
import * as pharma from './scada-sector-pharma';
import * as paper from './scada-sector-paper';
import * as steel from './scada-sector-steel';
import * as storage from './scada-sector-storage';
import * as gasnet from './scada-sector-gasnet';
import * as hydro from './scada-sector-hydro';
import * as building from './scada-sector-building';
import * as logistics from './scada-sector-logistics';
import * as utility from './scada-sector-utility';
import * as watergas from './scada-sector-watergas';
import * as access from './scada-sector-access';
import * as turkish from './scada-sector-turkish';
import * as heating from './scada-sector-heating';

const modules = [process, hvac, power, wastewater, oilgas, telecom, food, factory, mining, agri, city, home, appliance, plant, states, kitchen, pharma, paper, steel, storage, gasnet, hydro, building, logistics, utility, watergas, access, turkish, heating];

export const SECTOR_SCENES: readonly ScadaScene[] = modules.map((m) => m.SECTOR_SCENE).filter((s): s is ScadaScene => s !== null);
export const SECTOR_BOARDS: readonly BoardDocument[] = modules.map((m) => m.SECTOR_BOARD).filter((b): b is BoardDocument => b !== null);
