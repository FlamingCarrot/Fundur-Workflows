import {notFound} from "next/navigation";
import {getViewer} from "@/lib/server/workspace-context";
import {RulesView} from "@/components/layout/RulesView";
export default async function RulesPage(){if((await getViewer()).features?.layout===false)notFound();return <RulesView/>;}
