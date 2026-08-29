# Runtime Schema Library Spike

## Decision

Use **Zod 4** as the Phase 1 runtime-schema authority for the strict TypeScript
domain package. Start with the regular `zod` API. Keep domain schemas compatible
with JSON Schema, export AI/tool contracts with `z.toJSONSchema()`, and perform
state migrations or lossy transformations outside the schema definition.

Do not adopt Zod Mini until a production bundle measurement demonstrates a
meaningful mobile/WebView cost. Do not depend on experimental
`z.fromJSONSchema()` in Phase 1.

## Repository constraints

- The application is already ESM-first (`"type": "module"`) and uses Vite 7,
  TypeScript 5.9, Electron and the same browser bundle in Android WebView.
- Runtime AI tools already consume JSON Schema-like objects in
  `src/Game/AI/gameplaySchemas.js`; schema export is therefore a first-class
  requirement, not a documentation convenience.
- The domain contract requires strict runtime rejection at mutation boundaries,
  stable discriminated commands/events and useful path-level errors.
- Zod currently appears only as a transitive package. Phase 1 must add it as a
  direct dependency when implementation #18 begins; transitive availability is
  not an application contract.

## Compared options

### Option A — Zod 4

Official references:

- [Zod package and parsing API](https://zod.dev/packages/zod)
- [JSON Schema conversion](https://zod.dev/json-schema)
- [Structured validation errors](https://zod.dev/error-customization)
- [Zod Mini and measured example bundles](https://zod.dev/packages/mini)

Fit:

- TypeScript-first inference, strict objects and discriminated unions are
  built into the primary API.
- `z.toJSONSchema()` is first-party and supports Draft 4, Draft 7, Draft
  2020-12 and OpenAPI 3.0 targets. The official documentation explicitly calls
  out structured-output/AI use.
- Validation issues contain a structured `path`, `code` and human-readable
  `message`; input values are not included unless explicitly requested.
- Defaults, coercion, transforms and pipes are explicit. However, transforms
  and several non-JSON types cannot be represented faithfully in JSON Schema;
  tool-facing schemas must stay within the documented convertible subset.
- The regular API prioritizes developer experience. The official Zod Mini page
  reports example gzip bundles of 5.91–13.1 KB for regular Zod and 2.12–4.0 KB
  for Mini, while also recommending regular Zod unless bundle constraints are
  unusually strict. These are examples, not a project benchmark.

Risk:

- Runtime input/output types can diverge when coercion, defaults or transforms
  are embedded in schemas. Phase 1 avoids that ambiguity by keeping persisted
  and AI-facing schemas declarative and running migrations separately.
- JSON Schema import is experimental, so external JSON Schema is not a source
  from which Phase 1 reconstructs typed domain schemas.

### Option B — Valibot

Official references:

- [Valibot introduction](https://valibot.dev/guides/introduction/)
- [`strictObject`](https://valibot.dev/api/strictObject/)
- [`variant`](https://valibot.dev/api/variant/)
- [Parsing and structured issues](https://valibot.dev/guides/parse-data/)
- [Official JSON Schema converter package](https://github.com/open-circle/valibot/tree/main/packages/to-json-schema)

Fit:

- Modular functions tree-shake well and cover strict objects, discriminated
  variants, typed parsing and structured issue paths.
- The project maintains an official `@valibot/to-json-schema` package with
  Draft 7, Draft 2020-12 and OpenAPI targets.
- It is the strongest choice if measured download size becomes a hard product
  constraint.

Tradeoff:

- JSON Schema export is a second direct package and the functional API adds
  more migration surface for a team moving from JavaScript to strict
  TypeScript.
- Choosing it now optimizes an unmeasured cost while giving up the simpler
  Phase 1 adoption path and larger Zod ecosystem.

### Option C — TypeBox

Official reference:

- [TypeBox JSON Schema builder and validators](https://github.com/sinclairzx81/typebox)

Fit:

- TypeBox schemas are JSON Schema objects by construction and infer static
  TypeScript types.
- Its optional `Value` module can check values dynamically; the optional
  compiler can precompile validators and expose path-level errors.
- This is the cleanest schema-first choice when JSON Schema itself must be the
  canonical authoring format.

Tradeoff:

- Validation, conversion/defaulting and compilation are deliberately separate
  concepts, which increases the number of policies Phase 1 must standardize.
- Its JSON-Schema-first semantics are powerful but less direct for application
  domain parsing than Zod's single parse/safe-parse boundary.
- No project-specific bundle measurement exists, so performance claims are not
  used to decide.

## Representative contract

The selected Zod form keeps stable IDs, discriminator fields and unknown-key
rejection explicit:

```ts
import * as z from "zod";

const CommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: z.string().min(1),
    kind: z.literal("diplomacy.propose"),
    actorId: z.string().min(1),
    targetId: z.string().min(1),
    proposal: z.string().min(1),
  }),
  z.strictObject({
    id: z.string().min(1),
    kind: z.literal("economy.allocate"),
    actorId: z.string().min(1),
    category: z.enum(["civilian", "military", "infrastructure"]),
    amount: z.number().finite().nonnegative(),
  }),
]);

type Command = z.infer<typeof CommandSchema>;
const commandJsonSchema = z.toJSONSchema(CommandSchema, {
  target: "draft-07",
});
```

Rules for the implementation:

1. Use `strictObject` for authoritative commands, events and persisted
   projections; do not silently strip protected unknown fields.
2. Use discriminated unions for versioned command/event families.
3. Keep dates and stable IDs as validated strings at serialization boundaries.
4. Do not put `transform`, `date`, `map`, `set`, custom predicates or other
   non-representable constructs in schemas exported to AI providers.
5. Run migrations before validation and domain construction, never as an
   implicit parse side effect.
6. Add a parity test for every exported tool schema: representative accepted
   and rejected fixtures must agree between Zod parsing and the provider-facing
   JSON Schema contract.

## Compatibility conclusion

All three candidates are pure JavaScript/TypeScript libraries with no native
runtime requirement and are viable in the project's Vite browser bundle,
Electron Node runtime and Android WebView bundle. The repository is already ESM
first, so no CommonJS migration is required for domain code. Electron's `.cjs`
entry points should not import domain schemas directly; they continue loading
the built application/server boundary.

## 80/20 rationale

Zod 4 wins because it combines the shortest adoption path, strict TypeScript
inference, high-quality errors and first-party JSON Schema export in one direct
dependency. Valibot remains the measured-size fallback, and TypeBox remains the
JSON-Schema-first fallback. Neither fallback solves a demonstrated Phase 1
problem better enough to justify additional integration policy now.

The architecture decision is complete. Issue #18 may use Zod 4 once its atomic
state dependency (#17) is integrated.
