import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AgentConversation,
  AgentFix,
  AgentRun,
  AgentRunDetails,
  AgentSettings,
  AgentStatus,
  Finding,
  FindingStatus,
  FindingsQuery,
  GithubInstallation,
  Page,
  Repository,
  Scan,
  ScanModule,
  ScanSummary,
  SpaceDetail,
  SpaceGraph,
  SpaceListItem,
  SpaceOverview,
} from './api.types';

/** Единая точка доступа к данным: облачный API сейчас, локальный бэкенд — позже. */
@Injectable({ providedIn: 'root' })
export class QorganApi {
  private readonly http = inject(HttpClient);

  repositories(): Observable<Repository[]> {
    return this.http.get<Repository[]>('/api/repositories');
  }

  scans(repositoryId: string): Observable<Scan[]> {
    return this.http.get<Scan[]>(`/api/repositories/${repositoryId}/scans`);
  }

  scan(id: string): Observable<Scan> {
    return this.http.get<Scan>(`/api/scans/${id}`);
  }

  startScan(repositoryId: string, modules?: ScanModule[]): Observable<Scan> {
    return this.http.post<Scan>(`/api/repositories/${repositoryId}/scans`, { modules });
  }

  summary(scanId: string): Observable<ScanSummary> {
    return this.http.get<ScanSummary>(`/api/scans/${scanId}/summary`);
  }

  scanFindings(scanId: string, query: FindingsQuery = {}): Observable<Page<Finding>> {
    return this.http.get<Page<Finding>>(`/api/scans/${scanId}/findings`, { params: params(query) });
  }

  repositoryFindings(repositoryId: string, query: FindingsQuery = {}): Observable<Page<Finding>> {
    return this.http.get<Page<Finding>>(`/api/repositories/${repositoryId}/findings`, {
      params: params(query),
    });
  }

  setFindingStatus(id: string, status: Exclude<FindingStatus, 'fixed'>): Observable<Finding> {
    return this.http.patch<Finding>(`/api/findings/${id}`, { status });
  }

  agentStatus(): Observable<AgentStatus> {
    return this.http.get<AgentStatus>('/api/agent/status');
  }

  agentActivity(repositoryId: string): Observable<AgentRun[]> {
    return this.http.get<AgentRun[]>(`/api/repositories/${repositoryId}/agent/activity`);
  }

  agentRun(id: string): Observable<AgentRunDetails> {
    return this.http.get<AgentRunDetails>(`/api/agent/runs/${id}`);
  }

  agentFixes(repositoryId: string): Observable<AgentFix[]> {
    return this.http.get<AgentFix[]>(`/api/repositories/${repositoryId}/agent/fixes`);
  }

  updateAgentSettings(
    repositoryId: string,
    settings: Partial<AgentSettings>,
  ): Observable<Repository> {
    return this.http.patch<Repository>(
      `/api/repositories/${repositoryId}/agent/settings`,
      settings,
    );
  }

  conversations(spaceId: string): Observable<AgentConversation[]> {
    return this.http.get<AgentConversation[]>(`/api/spaces/${spaceId}/agent/conversations`);
  }

  conversation(id: string): Observable<AgentConversation> {
    return this.http.get<AgentConversation>(`/api/agent/conversations/${id}`);
  }

  /** `repositoryId` — фокус вопроса; null — всё пространство. */
  startConversation(
    spaceId: string,
    content: string,
    repositoryId: string | null,
  ): Observable<AgentConversation> {
    return this.http.post<AgentConversation>(`/api/spaces/${spaceId}/agent/conversations`, {
      content,
      repositoryId,
    });
  }

  sendMessage(
    conversationId: string,
    content: string,
    repositoryId: string | null,
  ): Observable<AgentConversation> {
    return this.http.post<AgentConversation>(
      `/api/agent/conversations/${conversationId}/messages`,
      { content, repositoryId },
    );
  }

  spaces(): Observable<SpaceListItem[]> {
    return this.http.get<SpaceListItem[]>('/api/spaces');
  }

  space(id: string): Observable<SpaceDetail> {
    return this.http.get<SpaceDetail>(`/api/spaces/${id}`);
  }

  createSpace(name: string, repositoryIds: string[]): Observable<SpaceDetail> {
    return this.http.post<SpaceDetail>('/api/spaces', { name, repositoryIds });
  }

  renameSpace(id: string, name: string): Observable<SpaceDetail> {
    return this.http.patch<SpaceDetail>(`/api/spaces/${id}`, { name });
  }

  deleteSpace(id: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${id}`);
  }

  addSpaceRepositories(id: string, repositoryIds: string[]): Observable<SpaceDetail> {
    return this.http.post<SpaceDetail>(`/api/spaces/${id}/repositories`, { repositoryIds });
  }

  removeSpaceRepository(id: string, repositoryId: string): Observable<SpaceDetail> {
    return this.http.delete<SpaceDetail>(`/api/spaces/${id}/repositories/${repositoryId}`);
  }

  spaceOverview(id: string): Observable<SpaceOverview> {
    return this.http.get<SpaceOverview>(`/api/spaces/${id}/overview`);
  }

  spaceGraph(id: string): Observable<SpaceGraph> {
    return this.http.get<SpaceGraph>(`/api/spaces/${id}/graph`);
  }

  refreshSpaceGraph(id: string): Observable<SpaceGraph> {
    return this.http.post<SpaceGraph>(`/api/spaces/${id}/graph/refresh`, {});
  }

  spaceActivity(id: string): Observable<AgentRun[]> {
    return this.http.get<AgentRun[]>(`/api/spaces/${id}/agent/activity`);
  }

  spaceFixes(id: string): Observable<AgentFix[]> {
    return this.http.get<AgentFix[]>(`/api/spaces/${id}/agent/fixes`);
  }

  installUrl(): Observable<{ url: string }> {
    return this.http.get<{ url: string }>('/api/github/install-url');
  }

  installations(): Observable<GithubInstallation[]> {
    return this.http.get<GithubInstallation[]>('/api/github/installations');
  }

  syncInstallation(id: string): Observable<void> {
    return this.http.post<void>(`/api/github/installations/${id}/sync`, {});
  }
}

function params(query: FindingsQuery): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') p = p.set(key, String(value));
  }
  return p;
}
