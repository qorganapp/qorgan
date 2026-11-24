import { SEVERITY_ORDER } from '../../common/security.types';
import { NormalizedFinding } from '../scanner/adapters/types';

/** OSV и Trivy часто находят одну и ту же CVE — сливаем по fingerprint. */
export function mergeDuplicates(
  findings: NormalizedFinding[],
): NormalizedFinding[] {
  const byFp = new Map<string, NormalizedFinding>();
  for (const f of findings) {
    const prev = byFp.get(f.fingerprint);
    if (!prev) {
      byFp.set(f.fingerprint, { ...f, data: { ...f.data, tools: [f.tool] } });
      continue;
    }
    const tools = [...new Set([...(prev.data.tools as string[]), f.tool])];
    const worse =
      SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(prev.severity)
        ? f
        : prev;
    byFp.set(f.fingerprint, {
      ...worse,
      tool: prev.tool,
      data: {
        ...f.data,
        ...prev.data,
        fixedVersion: prev.data.fixedVersion ?? f.data.fixedVersion,
        tools,
      },
    });
  }
  return [...byFp.values()];
}
