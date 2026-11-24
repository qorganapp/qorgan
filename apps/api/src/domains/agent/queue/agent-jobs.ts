export interface FixJob {
  repositoryId: string;
  findingIds: string[];
}

export interface ReviewJob {
  repositoryId: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
}

export interface ChatJob {
  conversationId: string;
  messageId: string;
}

export type AgentJobName = 'fix' | 'review' | 'chat';
