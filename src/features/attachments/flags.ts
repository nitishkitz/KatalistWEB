export function attachmentsServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MAGIC_BOX_ATTACHMENTS_ENABLED === "true";
}

export function attachmentsUiEnabled(): boolean {
  return import.meta.env.VITE_MAGIC_BOX_ATTACHMENTS_ENABLED === "true";
}
