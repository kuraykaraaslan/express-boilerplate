# automation_integrations

The types an automation integration is written against: `NodeContribution`, `NodeContext`, `ChoicesContribution`, `FlowTemplate`,
`FlowOwnerContribution` (a module that owns the flows it builds) and everything they reference. It carries **no code**, only declarations, and it is a Core module.

## Why it exists

A module that adds to the automation engine (the `ai.request` node, `action.notify`, the loyalty award nodes, ...) keeps that code **in its own
folder**, next to the services it calls, and declares it in its own `module.json` (`automation:node`, `automation:choices`, `automation:template`,
`automation:flow_owner`).
Writing it needs the engine's types. Importing them from `automation` would make `ai`, `notification` and `loyalty` depend on an Enterprise
module; importing them from here does not.

```ts
import type { NodeContribution, NodeContext } from '@kuraykaraaslan-labs/automation_integrations';
```

Use `import type` only (the engine's contributor kit checks it): the integration never needs the engine at run time, because the engine loads it.

## Generated, not written

`contract/` is produced from the engine by `scripts/gen-automation-contract.mjs` (the TypeScript compiler's declaration output of the engine files
the contract needs, with every class turned into an interface of its public members). The engine stays the source of truth.

```bash
npm run gen:automation-contract     # after changing the engine's contribution types
npm run check:automation-contract   # what CI runs: fails when the committed files are stale
```

Do not edit `contract/` by hand.

## Testing an integration

The contributor kit (`checkContributor`, `nodeHarness`) lives in `automation/testing`. Tests may import it, because tests are not part of what a
Core or Pro deployment installs.
