// GENERATED from modules/automation/server/catalog/types.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
/** The editor's icon object; the server never reads it. */
type IconDefinition = unknown;
/**
 * Block catalog: the vocabulary of a rule editor, as data.
 * The shape follows the `roltek-automation-1` block declarations (`blocks.d/*.json`),
 * so those can be loaded through `catalogFromBlocks()` without translation.
 */
export type ParamPrimitive = string | number | boolean | null;
/** field types a param can have; the form renders each one with a kui-react component */
export type ParamType = 'string' | 'text' | 'number' | 'bool' | 'enum' | 'duration' | 'time' | 'weekdays' | 'cron' | 'code' | 'json' | 'secret' | 'source' | 'ref' | 'list' | 'value' | 'rules' | 'path' | 'template' | 'expr' | 'hex' | 'topic' | 'mac' | 'ip';
/** show a field only when another param has (or, with `not`, lacks) a value */
export type WhenCondition = {
    param: string;
    value: ParamPrimitive | ParamPrimitive[];
    not?: undefined;
} | {
    param: string;
    not: ParamPrimitive[];
    value?: undefined;
};
export type ParamSpec = {
    type: ParamType;
    label?: string;
    hint?: string;
    default?: unknown;
    required?: boolean;
    when?: WhenCondition;
    /** `enum`: the allowed values */
    options?: ParamPrimitive[];
    option_labels?: Record<string, string>;
    /** `enum`: text for the empty option */
    empty_label?: string;
    min?: number;
    max?: number;
    /** `number`: whole numbers only */
    int?: boolean;
    step?: number;
    max_len?: number;
    /** `template` / `value`: the field is templatable, so `{{secret:NAME}}` may name a secret of the node's config (10 §10.1); the host substitutes it at call time. */
    secrets?: boolean;
    pattern?: string;
    /** `source` / `list`: name of a host-provided choice list (see `ParamChoices`) */
    source?: string;
    /** `source`: allow a value that is not in the list */
    free?: boolean;
    multiple?: boolean;
    /** `list`: the type of one item; `rules`: the fields of one row */
    items?: ParamSpec | Record<string, ParamSpec>;
    /** `code`: language of the editor */
    lang?: 'js' | 'json' | 'text';
    /** `number` that sets an output count: key of the param holding the pin names */
    pins?: string;
    unit?: string;
    suggest?: string[];
    /** `value` / `path`: variable scopes the user can pick from */
    scopes?: string[];
    /** where the value lives on the node: `params` (default) or the `script` field */
    store?: 'params' | 'script';
};
/** `string[]` is a fixed list of ports; the object forms depend on a param of the node */
export type OutputsSpec = string[] | {
    dynamic: string;
    prefix?: string;
    max?: number;
    extra?: string[];
} | {
    count: string;
    prefix?: string;
    max?: number;
};
export type BlockVisual = {
    icon?: IconDefinition;
    /** icon name for hosts that map names to icons themselves (e.g. `blocks.d` files) */
    iconName?: string;
    /** Tailwind token classes */
    iconColor?: string;
    headerBg?: string;
};
export type BlockRisk = 'none' | 'low' | 'external' | 'control' | 'system' | 'code';
export type BlockDecl = {
    type: string;
    title: string;
    description?: string;
    /** palette group id, see `Catalog.groups` */
    group?: string;
    /** `trigger` | `cond` | `logic` | `action` | `flow` … (taken from the type prefix when missing) */
    category?: string;
    params?: Record<string, ParamSpec>;
    /** 0 = no input port; default 1 */
    inputs?: 0 | 1;
    outputs?: OutputsSpec;
    /** display name per port id */
    port_labels?: Record<string, string>;
    /** `${param} ${param}` shown under the node title */
    summary?: string;
    risk?: BlockRisk;
    role?: string;
    tier?: string;
    features?: string[];
    visual?: BlockVisual;
    /** not offered in the palette (placeholders) */
    internal?: boolean;
};
export type CatalogGroup = {
    id: string;
    label: string;
};
export type Catalog = {
    blocks: Record<string, BlockDecl>;
    /** palette groups in display order; blocks of another group go to the end */
    groups: CatalogGroup[];
    /** every node with an input also has an `error` output (the roltek-automation-1 model) */
    errorPort?: boolean;
};
export type PortDef = {
    id: string;
    label: string;
};
export type NodePorts = {
    inputs: PortDef[];
    outputs: PortDef[];
};
/** values the host injects for `source` and `list` fields, by source name */
export type ParamChoices = Record<string, {
    value: ParamPrimitive;
    label: string;
}[]>;
export type ParamIssue = {
    param: string;
    code: 'required' | 'number' | 'min' | 'max' | 'int' | 'enum' | 'max_len' | 'pattern';
    message: string;
};
export {};
