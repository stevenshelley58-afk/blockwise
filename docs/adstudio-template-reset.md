# AdStudio Template Reset

AdStudio templates have been hard-reset. The current template registry is intentionally empty, and no prior generated previews, generated registries, or template build outputs are installed in the working tree.

Fresh template work must start from raw source references only. Each future template must be built as a fully self-contained mini-build with its own visual implementation and gallery sample.

Future templates must not use shared visual infrastructure: no shared renderer, no shared layer schema, no shared layout DSL, no shared visual helpers, no shared component library, no shared template constants, and no shared visual fallback. Shared code is limited to non-visual app plumbing that cannot change a template's appearance, such as routing, persistence, auth, and gallery loading.

While this reset state is active:

- The built-in template registry stays empty.
- Template preview rendering fails closed.
- Selected-template generation fails closed.
- The gallery shows the intentional empty state.
- New templates are not added until the reset verification passes.
