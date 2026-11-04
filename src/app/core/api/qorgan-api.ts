import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Finding,
  FindingStatus,
  FindingsQuery,
  GithubInstallation,
  Page,
  Repository,
  Scan,
  ScanModule,
  ScanSummary,
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
