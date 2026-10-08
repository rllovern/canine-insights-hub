// Data hooks for the SOP workspace. All calls go through the private guarded endpoint.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mopsCall } from "@/lib/mops";
import type { SopNode } from "./sopTree";
import type { SopStatus } from "./readiness";

export interface ClientPin { template_id: string; template_name: string; template_key: string; version_id: string; version_no: number; latest_id: string; latest_no: number; nodes: SopNode[] }
export interface SopClientData {
  classification: string | null;
  pins: ClientPin[];
  statuses: Record<string, { status: SopStatus; note: string | null; evidence: string | null; updated_at: string }>;
  auto: Record<string, SopStatus>;
  answers: Record<string, unknown> | null;
  attachments: { id: string; stable_key: string; file_name: string; size_bytes: number; client: boolean }[];
}
export interface Portfolio {
  versions: Record<string, SopNode[]>;
  clients: { property_id: string; classification: string | null; pins: string[]; statuses: Record<string, { status: SopStatus }>; auto: Record<string, SopStatus>; answers: Record<string, unknown> | null }[];
}

export const useSopClient = (pid: string) =>
  useQuery({ queryKey: ["mops", "sop_client", pid], queryFn: () => mopsCall<SopClientData>("sop_client", { property_id: pid }), enabled: !!pid });

export const useSopPortfolio = () =>
  useQuery({ queryKey: ["mops", "sop_portfolio"], queryFn: () => mopsCall<Portfolio>("sop_portfolio"), staleTime: 30_000 });

export function useMopsOp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ op, args }: { op: string; args: Record<string, unknown> }) => {
      const r = await mopsCall<any>(op, args);
      if (r?.error) throw new Error(String(r.error));
      return r;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mops"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

export async function fileToBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function openAttachment(id: string) {
  const w = window.open("", "_blank");
  try {
    const r = await mopsCall<{ url: string }>("sop_attach_url", { id });
    if (w) w.location.href = r.url; else window.location.href = r.url;
  } catch (e) { w?.close(); toast.error((e as Error).message); }
}
