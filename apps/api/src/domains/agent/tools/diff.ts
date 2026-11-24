/** Номера добавленных/изменённых строк (новая версия файла) по unified diff. */
export function parseAddedLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let current: Set<number> | null = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).trim();
      if (path === '/dev/null') {
        current = null;
      } else {
        const clean = path.replace(/^b\//, '');
        current = files.get(clean) ?? new Set<number>();
        files.set(clean, current);
      }
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (
      !current ||
      raw.startsWith('--- ') ||
      raw.startsWith('diff ') ||
      raw.startsWith('index ')
    )
      continue;
    if (raw.startsWith('+')) {
      current.add(line);
      line++;
    } else if (raw.startsWith(' ')) {
      line++;
    }
    // '-' строки в новой версии не существуют, '\' — служебная.
  }
  return files;
}
