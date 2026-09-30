# Schemas

P3-2 introduces JSON Schema 2020-12 contracts for temporal values, regions,
periods, events, placements, and the dataset envelope. JSON Schema validates
record shape; `src/builder/validate-dataset.ts` validates cross-record and
derived-value invariants before a dataset may be written.
