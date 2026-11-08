# Shipped models

Trained models of the request cascade (docs/phases/55-ai-firewall/04-tree-models.md 4.5). Empty until the first training run.

| Stage | Library | Model file | Meta file |
|---|---|---|---|
| behaviour (stage 1) | LightGBM 4.7.0 | `behaviour.model.txt` (text model) | `behaviour.meta.json` |
| attack (stage 2) | XGBoost 3.4.2 | `attack.model.json` (JSON model) | `attack.meta.json` |

The meta file is `ShippedModelMeta` (`server/models/shipped-models.types.ts`); its `sha256` is the hex sha256 of the model file. Both
come from `npm run ai-firewall:train` (04.1), which writes into a folder of its own: copy a reviewed run here. A model trained on the
synthetic dataset (`synthetic: true` in its meta) is never embedded. After changing anything here run `npm run ai-firewall:embed-models`
and commit the generated file with it.
