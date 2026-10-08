# Visual harness (MOCKED data)

Renders the real `CodeActivityWorkspace` component in a bare Vite page. Everything the component fetches is answered by
`fixtures.ts`; the Magic Box is a labelled stub. Nothing here is GitHub, Supabase or a signed-in browser session, so it is
evidence for layout and states only, never for live behaviour.

    node output/code-activity-execution/visual-harness/capture.mjs
