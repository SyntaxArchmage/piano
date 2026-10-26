import type { Server } from "node:http";

export interface DashboardServerOptions {
  readonly runsRoot?: string;
  readonly stateFile?: string;
  readonly host?: string;
  readonly port?: number;
}

export interface DashboardListenInfo {
  readonly host: string;
  readonly port: number;
  readonly urlBase: string;
  readonly localUrlBase: string;
  readonly reused?: boolean;
}

export interface DashboardServer {
  readonly server: Server;
  listen(): Promise<DashboardListenInfo>;
  close(): Promise<void>;
}

export function createDashboardServer(options?: DashboardServerOptions): DashboardServer;
export function main(argv?: readonly string[]): Promise<void>;
