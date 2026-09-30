# Builder

`validate-dataset.ts` is the P3-2 all-or-nothing validation gate. Call
`prepareDatasetWrite` before any future source or index write. Import and index
construction are implemented by the P3-3 JSONL and SQLite modules. Run
`npm run data:import-fixture` to install the clearly labelled contract fixture,
or `npm run data:rebuild-index` to rebuild the derived index from JSONL.
