export function listCollaborationServerEnabled() {
  return process.env.LIST_COLLABORATION_ENABLED?.trim().toLowerCase() === "true";
}

export const listCollaborationClientEnabled =
  import.meta.env.VITE_LIST_COLLABORATION_ENABLED === "true";
