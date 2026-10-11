import {notFound} from "next/navigation";
import {getViewer} from "@/lib/server/workspace-context";
import {WorkspaceSettings} from "@/components/workspaces/WorkspaceSettings";
export const dynamic="force-dynamic";
export default async function WorkspaceSettingsPage(){const viewer=await getViewer();if(!viewer.isAdmin&&viewer.workspaceRole!=="owner")notFound();return <WorkspaceSettings/>;}
