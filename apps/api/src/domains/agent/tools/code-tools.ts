import { z } from 'zod';
import { AgentTool, defineTool } from '../runtime/agent-tool';
import { Workspace } from '../runtime/workspace';

/** Инструменты чтения кода — общие для всех навыков. */
export function codeReadTools(ws: Workspace): AgentTool[] {
  return [
    defineTool({
      name: 'list_files',
      description:
        'List repository files (recursively, skipping .git, node_modules, build output). Use to understand project layout.',
      schema: z.object({
        dir: z
          .string()
          .optional()
          .describe(
            'Directory relative to the repository root. Default: root.',
          ),
      }),
      run: async ({ dir }) => {
        const files = await ws.listFiles(dir ?? '.');
        return files.length ? files.join('\n') : 'No files';
      },
    }),
    defineTool({
      name: 'read_file',
      description:
        'Read a file with line numbers. Reads up to 400 lines per call; use start_line/end_line for large files.',
      schema: z.object({
        path: z.string().describe('Path relative to the repository root'),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      }),
      run: ({ path, start_line, end_line }) =>
        ws.readLines(path, start_line, end_line),
    }),
    defineTool({
      name: 'search_code',
      description:
        'Search the codebase. Case-insensitive substring match by default; set regex=true for a JavaScript regular expression. Returns file:line: text.',
      schema: z.object({
        query: z.string().min(1),
        regex: z.boolean().optional(),
        path_prefix: z
          .string()
          .optional()
          .describe('Only search under this directory'),
      }),
      run: ({ query, regex, path_prefix }) =>
        ws.search(query, { regex, pathPrefix: path_prefix }),
    }),
  ];
}
