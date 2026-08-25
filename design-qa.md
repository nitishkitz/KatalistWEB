# Collaboration Board visual QA

Reference: `/var/folders/k5/qys3hlzd50v85zh4yrt411x00000gn/T/codex-clipboard-40d6a2a8-c7f6-4f2c-be6f-f83eb376ace2.png`

Prototype: local Katalist demo at desktop viewport, authenticated as Priya Sharma.

## Comparison

- Magic Box preserves the existing white Katalist surface and icon language while matching the reference's bright rounded edge, purple outer bloom, and focused motion.
- Focused state uses `magic-box-glow` at 2.4 seconds; busy and recovery states have stronger/faster variants.
- Reduced-motion users receive the same visual emphasis without animation.
- The composer stays fixed above page content and does not overlap the List Chat composer.
- Court cards keep the Thing title and Catch action in separate layout areas.
- Court shows involved-person avatar filters and the actual assigner → assignee relationship.
- List Detail defaults to the table view with explicit Status and Assignee dropdowns.
- List Chat keeps its composer fixed to the bottom of the panel while only the message area scrolls.
- No cropped controls, broken borders, layout overflow, or inconsistent radii were visible at the tested desktop viewport.

final result: passed
