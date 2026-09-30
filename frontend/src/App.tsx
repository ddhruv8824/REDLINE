import { Workspace } from "@/components/Workspace";
import { resolveWorkspace } from "@/lib/workspace";

const workspace = resolveWorkspace();

export default function App() {
  return <Workspace workspace={workspace} />;
}
