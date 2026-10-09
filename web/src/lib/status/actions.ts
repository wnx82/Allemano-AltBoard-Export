"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { syncStatusRuntime } from "./runtime";

export type RefreshState = { message?: string; error?: string };

/**
 * Contrôle à la demande. L'action ne reçoit aucun paramètre : les adresses sondées sont celles de
 * la configuration en service, jamais une valeur jointe à la demande.
 */
export async function refreshServerStatusAction(): Promise<RefreshState> {
  await requireSession();
  const result = await (await syncStatusRuntime()).monitor.refresh();
  revalidatePath("/servers");
  switch (result) {
    case "unconfigured":
      return { error: "Aucune adresse configurée : rien à contrôler." };
    case "recent":
      return { message: "Dernier contrôle il y a moins de 10 secondes : pas de nouvelle mesure." };
    case "joined":
      return { message: "Un contrôle était déjà en cours : son résultat est affiché." };
    default:
      return { message: "Contrôle effectué." };
  }
}
