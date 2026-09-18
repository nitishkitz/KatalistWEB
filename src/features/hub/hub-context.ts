import { createContext, useContext } from "react";

/** Lets any hub surface (sidebar, landing) open the shared People & Contacts dialog. */
export const HubContext = createContext<{ openContacts: () => void }>({ openContacts: () => {} });

export function useHub() {
  return useContext(HubContext);
}
