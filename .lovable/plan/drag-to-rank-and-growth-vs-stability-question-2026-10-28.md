# Drag-to-rank and growth vs. stability question

## 1. Drag and drop ranking
- The ranking list ("Rank the problems customers come to you with") becomes drag and drop: grab any row and drop it where it belongs. The numbers update as you drag.
- Each row gets a grip handle. Dragging works with a mouse and with touch on phones.
- Keyboard users can still reorder by focusing a row and pressing the arrow keys. The visible arrow buttons go away.
- Saved answers keep the same format, so existing questionnaires and exports don't change.

## 2. New question in Step 1 (Budget and targets)
**How should we balance proven campaigns with testing new ones?** (required)

The note shown above the choices:
> Playing it completely safe can make an account stall. Newer Google campaign types, like ads across YouTube, Gmail and Discover, or campaigns that run across all of Google at once, often unlock growth we can't reach otherwise. Tests may take a few weeks to prove themselves, and some won't work. Your answer tells us how much room you want us to have to try them.

Choices:
- **Keep it steady**: stick mostly to what is already working.
- **Balanced**: keep the core steady and test new campaigns with some of the budget.
- **Push for growth**: test new campaign types boldly, accepting some weeks may underperform.

- The answer shows in the admin review, PDF and exports.
- The server requires it on new submissions. Questionnaires already submitted are not affected.

## Technical details
- Add `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities`. Rewrite `RankList` in `FieldInput.tsx` with `SortableContext` (vertical list), with Pointer, Touch and Keyboard sensors. The value stays a `string[]`.
- `schema.ts`: add a `growth_appetite` radio-style field with options and help text, after `growth_goal` in `budget`. Because `radio` has no renderer, render it using the existing select or card buttons.
- `validate.ts`: add `{ key: "growth_appetite" }` to REQUIRED.budget. The Test link still bypasses it.
