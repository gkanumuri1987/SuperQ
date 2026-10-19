# Coverage Lab

Open Studio → Coverage Lab or run `npx tsx src/cli.ts design examples/test-design.json`.

Define a named design with source/revision/excerpt and two to eight factors. Factor values are explicit strings: one per line in Studio. Each forbidden object excludes rows matching every listed field; multiple objects are alternatives. Unknown constraint fields/values, empty exclusions, duplicate names/values and impossible models are rejected. The full Cartesian model is limited to 4,096 candidates and generation has a fixed computation budget. Split larger models by business context.

The deterministic greedy algorithm chooses rows covering every feasible single value and pair of values across different factors. Its denominator is derived from all valid full combinations after constraints, not from the selected rows. Values made unreachable by constraints are reported separately. This is a covering design, not a guarantee of minimum size, exhaustive coverage or application correctness. Three-way interactions, state transitions, boundaries and business assertions need separate models/tests. Pairwise methodology is described in [NIST's combinatorial testing work](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software/combinatorial-methods-in-testing/interactions-involved-in-software-failures).

Studio can save the model in the local workspace and export a JSON dataset with the source context, constraints, algorithm version, counts and review-required flag. Exports do not approve tests or change promotion coverage. Review expected outcomes and map fields into case data before execution. A factor called `browser` is an input value; it does not automatically launch a browser profile. This version stores one model per workspace, not a versioned multi-design library. Importing a different project clears the saved model.

Generation uses no model provider, token budget or cloud browser. Local compute is bounded, not cost-free infrastructure. Evidence is supplied by the user and is not independently verified by the designer.
